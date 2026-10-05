import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders, jsonResponse } from '../_shared/http.ts';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function constantTimeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}

async function signatureFor(body: Uint8Array, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, body);
  return Array.from(new Uint8Array(signature), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders(request) });
  }
  if (request.method !== 'POST') return jsonResponse(request, { error: 'Method not allowed.' }, 405);

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const webhookSecret = Deno.env.get('RAZORPAY_WEBHOOK_SECRET');
  if (!supabaseUrl || !serviceRoleKey || !webhookSecret) {
    console.error('Razorpay webhook is missing required server configuration.');
    return jsonResponse(request, { error: 'Webhook is not configured.' }, 503);
  }

  const suppliedSignature = request.headers.get('x-razorpay-signature');
  if (!suppliedSignature || !/^[A-Fa-f0-9]{64}$/.test(suppliedSignature)) {
    return jsonResponse(request, { error: 'Invalid webhook signature.' }, 401);
  }

  const rawBody = new Uint8Array(await request.arrayBuffer());
  const expectedSignature = await signatureFor(rawBody, webhookSecret);
  if (!constantTimeEqual(expectedSignature, suppliedSignature.toLowerCase())) {
    return jsonResponse(request, { error: 'Invalid webhook signature.' }, 401);
  }

  let event: unknown;
  try {
    event = JSON.parse(new TextDecoder().decode(rawBody));
  } catch {
    return jsonResponse(request, { error: 'Invalid webhook payload.' }, 400);
  }
  if (!isRecord(event)) return jsonResponse(request, { error: 'Invalid webhook payload.' }, 400);
  if (event.event !== 'payment.captured') return jsonResponse(request, { received: true });

  const payload = isRecord(event.payload) ? event.payload : null;
  const paymentEntity = payload && isRecord(payload.payment) ? payload.payment : null;
  const entity = paymentEntity && isRecord(paymentEntity.entity) ? paymentEntity.entity : null;
  const orderId = entity?.order_id;
  const paymentId = entity?.id;
  const amount = entity?.amount;
  if (
    typeof orderId !== 'string' ||
    !/^order_[A-Za-z0-9]+$/.test(orderId) ||
    typeof paymentId !== 'string' ||
    !/^pay_[A-Za-z0-9]+$/.test(paymentId) ||
    typeof amount !== 'number' ||
    entity?.currency !== 'INR' ||
    entity?.status !== 'captured' ||
    entity?.captured !== true
  ) {
    return jsonResponse(request, { error: 'Invalid captured payment.' }, 400);
  }

  const serviceClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: paymentOrder, error: orderError } = await serviceClient
    .from('payment_orders')
    .select('deposit_amount, payment_id, status')
    .eq('order_id', orderId)
    .maybeSingle();
  if (orderError) {
    console.error('Could not load the webhook payment order.', orderError);
    return jsonResponse(request, { error: 'Could not process the payment.' }, 500);
  }
  if (!paymentOrder) return jsonResponse(request, { error: 'Payment order not found.' }, 404);
  if (amount !== paymentOrder.deposit_amount * 100) {
    return jsonResponse(request, { error: 'Captured payment amount does not match the booking deposit.' }, 400);
  }
  if (paymentOrder.status === 'paid') {
    if (paymentOrder.payment_id !== paymentId) {
      console.error('Razorpay reported a second captured payment for an already-paid order.', { orderId, paymentId });
      return jsonResponse(request, { error: 'Order was already paid with a different payment.' }, 409);
    }
    const { data: booking, error: bookingError } = await serviceClient
      .from('bookings')
      .select('id')
      .eq('payment_order_id', orderId)
      .maybeSingle();
    if (bookingError || !booking) {
      console.error('Could not load booking for repeated webhook.', bookingError);
      return jsonResponse(request, { error: 'Could not load the booking.' }, 500);
    }
    return jsonResponse(request, { received: true });
  }

  const { error: confirmationError } = await serviceClient.rpc('confirm_booking_payment', {
    p_order_id: orderId,
    p_payment_id: paymentId,
  });
  if (confirmationError) {
    console.error('Could not confirm booking from webhook.', confirmationError);
    return jsonResponse(request, { error: 'Could not process the paid booking.' }, 500);
  }

  return jsonResponse(request, { received: true });
});
