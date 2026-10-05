# Pradhan Homestay

A responsive multi-page website for Pradhan Homestay in Badamtam, Naya Busty, Lebong, Darjeeling, West Bengal 734105.

## Run locally

Serve the site over HTTP (ES modules and Supabase authentication do not work reliably from `file://`):

```bash
python -m http.server 8000
```

Then visit `http://localhost:8000`.

## Account, booking and payment setup

The account and booking pages use Supabase Auth, Supabase Edge Functions and Razorpay. The website intentionally does not contain any server credentials; **real sign-in and payments remain disabled until the steps below are completed**.

1. Create a Supabase project. In **Authentication → URL Configuration**, set the site URL to `https://dinchenhomestay.com` and allow the deployed site's login and signup URLs. Enable email/password sign-in and configure email delivery/confirmation for production.
2. Run [`supabase/schema.sql`](./supabase/schema.sql) in the Supabase SQL editor. Booking requests are visible only to their authenticated owner; payment orders and payment verification are server-only.
3. Copy the Supabase project URL and its public anon/publishable key into [`supabase-client.js`](./supabase-client.js). These two values are used by the public website. Never put a service-role key or Razorpay secret in a browser file.
4. Install and authenticate the Supabase CLI, link this project, then deploy the three Edge Functions:

   ```bash
   supabase login
   supabase link --project-ref YOUR_PROJECT_ID
   supabase functions deploy create-razorpay-order
   supabase functions deploy verify-razorpay-payment
   supabase functions deploy handle-razorpay-webhook
   ```

5. Configure Edge Function secrets in Supabase. Supabase supplies `SUPABASE_URL`, `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` to hosted functions; set the site URL and Razorpay secrets:

   ```bash
   supabase secrets set SITE_URL=https://dinchenhomestay.com RAZORPAY_KEY_ID=YOUR_KEY_ID RAZORPAY_KEY_SECRET=YOUR_KEY_SECRET RAZORPAY_WEBHOOK_SECRET=YOUR_WEBHOOK_SECRET
   ```

   For local function development, set the same values in the local Supabase secrets file. Never commit secrets.
6. Start with Razorpay **test-mode** API keys and enable automatic payment capture. In the Razorpay dashboard, create a webhook for `https://YOUR_PROJECT_ID.supabase.co/functions/v1/handle-razorpay-webhook`, subscribe to `payment.captured`, and use the same webhook secret configured in Supabase. Test successful, failed, cancelled and repeated payment callbacks before switching to live keys.
7. Host the static files over HTTPS. If the site uses a different hostname, set `SITE_URL` to that exact origin and add the relevant login/signup URLs in Supabase Auth.

The backend charges a fixed **₹1,000 deposit** and calculates the stay total using the room rates in the rooms page. The guest choices preserve the current form's `1 guest`, `2 guests` and `3+ guests` options. A paid request remains **pending host confirmation** because the site does not have a live availability calendar; the remaining stay balance is due at the homestay. If a request cannot be confirmed, the deposit is retained as credit for another date; a host can record this as `credit_issued` on the booking in Supabase, and the guest's account will show the available credit. Credit application to a replacement booking is coordinated manually with the host. Confirm the room rates and booking/cancellation policy with the property before accepting live payments.

## Included

- Responsive pages for home, rooms, dining, events, gallery, attractions, contact, about, offers, account, login, signup, terms and privacy.
- Shared CSS design system, mobile navigation, hero slider and gallery lightbox.
- Authenticated booking request flow with server-calculated prices, Razorpay checkout, signature/capture verification and a payment webhook for recovery.
- Account page showing the signed-in guest's own booking requests and deposit status.
- Google Maps area and Unsplash image placeholders.
