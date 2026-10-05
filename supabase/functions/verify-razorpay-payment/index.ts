import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders, isAllowedOrigin, jsonResponse } from '../_shared/http.ts';

function constantTimeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}

async function signatureFor(orderId: string, paymentId: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(`${orderId}|${paymentId}`),
  );
  return Array.from(new Uint8Array(signature), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders(request) });
  }
  if (request.method !== 'POST') return jsonResponse(request, { error: 'Method not allowed.' }, 405);
  if (!isAllowedOrigin(request)) return jsonResponse(request, { error: 'Request origin is not allowed.' }, 403);

  const authorization = request.headers.get('Authorization');
  if (!authorization?.startsWith('Bearer ')) {
    return jsonResponse(request, { error: 'Sign in before verifying payment.' }, 401);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const razorpayKeyId = Deno.env.get('RAZORPAY_KEY_ID');
  const razorpayKeySecret = Deno.env.get('RAZORPAY_KEY_SECRET');
  if (!supabaseUrl || !anonKey || !serviceRoleKey || !razorpayKeyId || !razorpayKeySecret) {
    console.error('Payment verification function is missing required server configuration.');
    return jsonResponse(request, { error: 'Payment verification is temporarily unavailable. Contact the homestay before retrying.' }, 503);
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return jsonResponse(request, { error: 'Invalid payment verification details.' }, 400);
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return jsonResponse(request, { error: 'Invalid payment verification details.' }, 400);
  }
  const { orderId, paymentId, signature } = body;
  if (
    typeof orderId !== 'string' ||
    !/^order_[A-Za-z0-9]+$/.test(orderId) ||
    typeof paymentId !== 'string' ||
    !/^pay_[A-Za-z0-9]+$/.test(paymentId) ||
    typeof signature !== 'string' ||
    !/^[A-Fa-f0-9]{64}$/.test(signature)
  ) {
    return jsonResponse(request, { error: 'Invalid payment verification details.' }, 400);
  }

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: userData, error: userError } = await userClient.auth.getUser();
  if (userError || !userData.user) {
    return jsonResponse(request, { error: 'Your session has expired. Sign in and contact the homestay to confirm your payment.' }, 401);
  }

  const serviceClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: paymentOrder, error: orderError } = await serviceClient
    .from('payment_orders')
    .select('order_id, user_id, deposit_amount, payment_id, status')
    .eq('order_id', orderId)
    .eq('user_id', userData.user.id)
    .maybeSingle();

  if (orderError) {
    console.error('Could not load the payment order.', orderError);
    return jsonResponse(request, { error: 'Could not verify this payment. Contact the homestay before retrying.' }, 500);
  }
  if (!paymentOrder) return jsonResponse(request, { error: 'Payment order not found for this account.' }, 404);

  const expectedSignature = await signatureFor(orderId, paymentId, razorpayKeySecret);
  if (!constantTimeEqual(expectedSignature, signature.toLowerCase())) {
    return jsonResponse(request, { error: 'Payment signature did not match.' }, 400);
  }

  if (paymentOrder.status === 'paid') {
    if (paymentOrder.payment_id !== paymentId) {
      return jsonResponse(request, { error: 'This order has already been paid with a different payment.' }, 409);
    }
    const { data: booking, error: bookingError } = await serviceClient
      .from('bookings')
      .select('id, status')
      .eq('payment_order_id', orderId)
      .maybeSingle();
    if (bookingError || !booking) {
      console.error('Could not load the booking for a paid order.', bookingError);
      return jsonResponse(request, { error: 'Payment was recorded but the booking could not be loaded. Contact the homestay.' }, 500);
    }
    return jsonResponse(request, { bookingId: booking.id, status: booking.status });
  }

  let providerResponse: Response;
  try {
    providerResponse = await fetch(`https://api.razorpay.com/v1/payments/${paymentId}`, {
      headers: { Authorization: `Basic ${btoa(`${razorpayKeyId}:${razorpayKeySecret}`)}` },
    });
  } catch (error) {
    console.error('Razorpay payment lookup failed.', error);
    return jsonResponse(request, { error: 'Could not confirm payment status. Contact the homestay before retrying.' }, 502);
  }

  if (!providerResponse.ok) {
    console.error('Razorpay rejected payment lookup.', await providerResponse.text());
    return jsonResponse(request, { error: 'Could not confirm payment status. Contact the homestay before retrying.' }, 502);
  }

  let providerPayment: Record<string, unknown>;
  try {
    providerPayment = await providerResponse.json();
  } catch (error) {
    console.error('Razorpay returned an invalid payment response.', error);
    return jsonResponse(request, { error: 'Could not confirm payment status. Contact the homestay before retrying.' }, 502);
  }
  if (
    providerPayment.order_id !== orderId ||
    providerPayment.amount !== paymentOrder.deposit_amount * 100 ||
    providerPayment.currency !== 'INR' ||
    providerPayment.status !== 'captured' ||
    providerPayment.captured !== true
  ) {
    return jsonResponse(request, { error: 'Payment is not captured for this booking. Contact the homestay if you were charged.' }, 400);
  }

  const { data: bookingId, error: confirmationError } = await serviceClient.rpc('confirm_booking_payment', {
    p_order_id: orderId,
    p_payment_id: paymentId,
  });
  if (confirmationError || !bookingId) {
    console.error('Could not confirm the paid booking.', confirmationError);
    return jsonResponse(request, { error: 'Payment was received but the booking needs help from the host. Please contact the homestay.' }, 500);
  }

  return jsonResponse(request, { bookingId, status: 'pending_confirmation' });
});
