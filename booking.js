import { isSupabaseConfigured, supabase } from './supabase-client.js';

const form = document.querySelector('[data-booking-form]');
const bookingStorageKey = 'pradhan-booking-request';

function showMessage(message) {
  const output = form.querySelector('.form-message');
  output.textContent = message;
}

function saveBookingRequest() {
  const dates = form.querySelectorAll('input[type="date"]');
  const selects = form.querySelectorAll('select');
  return {
    checkIn: dates[0].value,
    checkOut: dates[1].value,
    guests: selects[0].value,
    roomType: selects[1].value,
  };
}

function restoreBookingRequest() {
  const saved = sessionStorage.getItem(bookingStorageKey);
  if (!saved) return;

  try {
    const request = JSON.parse(saved);
    const dates = form.querySelectorAll('input[type="date"]');
    const selects = form.querySelectorAll('select');
    dates[0].value = request.checkIn;
    dates[1].value = request.checkOut;
    selects[0].value = request.guests;
    selects[1].value = request.roomType;
  } catch (error) {
    sessionStorage.removeItem(bookingStorageKey);
    console.error('Could not restore the saved booking request.', error);
  }
}

async function loadRazorpay() {
  if (window.Razorpay) return;
  await new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://checkout.razorpay.com/v1/checkout.js';
    script.onload = resolve;
    script.onerror = () => reject(new Error('Secure payment could not be loaded. Please try again.'));
    document.head.append(script);
  });
}

async function getFunctionError(error) {
  if (error.context instanceof Response) {
    try {
      const body = await error.context.json();
      if (body.error) return body.error;
    } catch {
      return error.message;
    }
  }
  return error.message;
}

if (form) {
  restoreBookingRequest();

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!form.reportValidity()) return;

    if (!isSupabaseConfigured || !supabase) {
      showMessage('Online booking is not configured yet. Please contact the homestay directly.');
      return;
    }

    let session;
    try {
      const { data, error } = await supabase.auth.getSession();
      if (error) throw error;
      session = data.session;
    } catch (error) {
      showMessage(`Could not check your account: ${error.message}`);
      return;
    }
    if (!session) {
      sessionStorage.setItem(bookingStorageKey, JSON.stringify(saveBookingRequest()));
      window.location.assign('login.html?next=booking');
      return;
    }

    const submit = form.querySelector('button[type="submit"]');
    submit.disabled = true;
    showMessage('Preparing your secure payment…');

    try {
      const { data: order, error: orderError } = await supabase.functions.invoke('create-razorpay-order', {
        body: saveBookingRequest(),
      });
      if (orderError) throw new Error(await getFunctionError(orderError));
      await loadRazorpay();

      const checkout = new window.Razorpay({
        key: order.keyId,
        amount: order.amount,
        currency: order.currency,
        order_id: order.orderId,
        name: 'Pradhan Homestay',
        description: '₹1,000 booking deposit',
        prefill: { email: session.user.email },
        theme: { color: '#12364a' },
        handler: async (payment) => {
          showMessage('Verifying your payment securely…');
          try {
            const { data: confirmation, error: verifyError } = await supabase.functions.invoke('verify-razorpay-payment', {
              body: {
                orderId: payment.razorpay_order_id,
                paymentId: payment.razorpay_payment_id,
                signature: payment.razorpay_signature,
              },
            });
            if (verifyError) throw new Error(await getFunctionError(verifyError));

            sessionStorage.removeItem(bookingStorageKey);
            form.reset();
            showMessage(`Deposit received. Your request (${confirmation.bookingId}) is pending host confirmation. The remaining balance is payable at the homestay.`);
          } catch (error) {
            showMessage(`Payment could not be verified: ${error.message} If you were charged, contact the homestay before paying again.`);
          } finally {
            submit.disabled = false;
          }
        },
        modal: {
          ondismiss: () => {
            showMessage('Payment was cancelled. Your booking request has not been submitted.');
            submit.disabled = false;
          },
        },
      });
      checkout.on('payment.failed', (event) => {
        showMessage(`Payment failed: ${event.error.description || 'Please try again.'}`);
        submit.disabled = false;
      });
      checkout.open();
    } catch (error) {
      showMessage(error.message || 'Could not start payment. Please try again.');
      submit.disabled = false;
    }
  });
}
