import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders, isAllowedOrigin, jsonResponse } from '../_shared/http.ts';

const roomRates: Record<string, number> = {
  'Superior Room': 3800,
  'Deluxe Room': 4600,
  'Premium Room': 5400,
  Suite: 7200,
};
const depositRupees = 1000;
const guestOptions = new Set(['1 guest', '2 guests', '3+ guests']);

function validDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders(request) });
  }
  if (request.method !== 'POST') return jsonResponse(request, { error: 'Method not allowed.' }, 405);
  if (!isAllowedOrigin(request)) return jsonResponse(request, { error: 'Request origin is not allowed.' }, 403);

  const authorization = request.headers.get('Authorization');
  if (!authorization?.startsWith('Bearer ')) {
    return jsonResponse(request, { error: 'Sign in before starting a booking.' }, 401);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const razorpayKeyId = Deno.env.get('RAZORPAY_KEY_ID');
  const razorpayKeySecret = Deno.env.get('RAZORPAY_KEY_SECRET');
  if (!supabaseUrl || !anonKey || !serviceRoleKey || !razorpayKeyId || !razorpayKeySecret) {
    console.error('Booking order function is missing required server configuration.');
    return jsonResponse(request, { error: 'Online booking is temporarily unavailable. Please contact the homestay.' }, 503);
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return jsonResponse(request, { error: 'Invalid booking details.' }, 400);
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return jsonResponse(request, { error: 'Invalid booking details.' }, 400);
  }

  const { checkIn, checkOut, guests, roomType } = body;
  if (
    !validDate(checkIn) ||
    !validDate(checkOut) ||
    typeof guests !== 'string' ||
    !guestOptions.has(guests) ||
    typeof roomType !== 'string' ||
    !Object.hasOwn(roomRates, roomType)
  ) {
    return jsonResponse(request, { error: 'Choose valid dates, a room, and a guest option.' }, 400);
  }

  const start = Date.parse(`${checkIn}T00:00:00.000Z`);
  const end = Date.parse(`${checkOut}T00:00:00.000Z`);
  const nights = (end - start) / 86_400_000;
  const totalAmount = roomRates[roomType] * nights;
  if (
    checkIn < new Date().toISOString().slice(0, 10) ||
    nights < 1 ||
    !Number.isSafeInteger(totalAmount) ||
    totalAmount > 2_147_483_647
  ) {
    return jsonResponse(request, { error: 'Choose valid future dates for your stay.' }, 400);
  }

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: userData, error: userError } = await userClient.auth.getUser();
  if (userError || !userData.user) {
    return jsonResponse(request, { error: 'Your session has expired. Sign in and try again.' }, 401);
  }

  const serviceClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const nightlyRate = roomRates[roomType];
  const receipt = `ph-${crypto.randomUUID().replaceAll('-', '').slice(0, 24)}`;

  let providerResponse: Response;
  try {
    providerResponse = await fetch('https://api.razorpay.com/v1/orders', {
      method: 'POST',
      headers: {
        Authorization: `Basic ${btoa(`${razorpayKeyId}:${razorpayKeySecret}`)}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        amount: depositRupees * 100,
        currency: 'INR',
        receipt,
        notes: { user_id: userData.user.id },
      }),
    });
  } catch (error) {
    console.error('Razorpay order request failed.', error);
    return jsonResponse(request, { error: 'Could not start payment. Please try again.' }, 502);
  }

  if (!providerResponse.ok) {
    console.error('Razorpay rejected order creation.', await providerResponse.text());
    return jsonResponse(request, { error: 'Could not start payment. Please try again.' }, 502);
  }

  let providerOrder: Record<string, unknown>;
  try {
    providerOrder = await providerResponse.json();
  } catch (error) {
    console.error('Razorpay returned an invalid order response.', error);
    return jsonResponse(request, { error: 'Could not start payment. Please try again.' }, 502);
  }
  if (
    typeof providerOrder.id !== 'string' ||
    !/^order_[A-Za-z0-9]+$/.test(providerOrder.id) ||
    providerOrder.amount !== depositRupees * 100 ||
    providerOrder.currency !== 'INR'
  ) {
    console.error('Razorpay returned an incomplete order response.');
    return jsonResponse(request, { error: 'Could not start payment. Please try again.' }, 502);
  }
  const { error: insertError } = await serviceClient.from('payment_orders').insert({
    order_id: providerOrder.id,
    user_id: userData.user.id,
    check_in: checkIn,
    check_out: checkOut,
    guests,
    room_type: roomType,
    nightly_rate: nightlyRate,
    total_amount: totalAmount,
    deposit_amount: depositRupees,
  });
  if (insertError) {
    console.error('Could not save the payment order.', insertError);
    return jsonResponse(request, { error: 'Could not save your booking request. Please contact the homestay before retrying payment.' }, 500);
  }

  return jsonResponse(request, {
    orderId: providerOrder.id,
    amount: providerOrder.amount,
    currency: providerOrder.currency,
    keyId: razorpayKeyId,
  });
});
