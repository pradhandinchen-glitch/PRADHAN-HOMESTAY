import { isSupabaseConfigured, supabase } from './supabase-client.js';

const message = document.querySelector('[data-account-message]');
const list = document.querySelector('[data-account-list]');
const signOutButton = document.querySelector('[data-sign-out]');

function formatDate(value) {
  return new Date(`${value}T00:00:00.000Z`).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

function addBooking(booking) {
  const card = document.createElement('article');
  card.className = 'account-booking';

  const details = document.createElement('div');
  const title = document.createElement('h2');
  title.textContent = booking.room_type;
  const dates = document.createElement('p');
  dates.textContent = `${formatDate(booking.check_in)} – ${formatDate(booking.check_out)} · ${booking.guests}`;
  const price = document.createElement('p');
  const balanceDue = booking.total_amount - booking.deposit_amount;
  price.textContent = booking.status === 'credit_issued'
    ? `₹${booking.deposit_amount.toLocaleString('en-IN')} deposit held as credit`
    : booking.status === 'credit_redeemed'
      ? `₹${booking.deposit_amount.toLocaleString('en-IN')} deposit credit applied`
      : `₹${booking.total_amount.toLocaleString('en-IN')} stay total · ₹${booking.deposit_amount.toLocaleString('en-IN')} deposit paid · ₹${balanceDue.toLocaleString('en-IN')} due at the homestay`;
  details.append(title, dates, price);

  const status = document.createElement('span');
  status.className = 'account-booking-status';
  status.textContent = booking.status === 'pending_confirmation'
    ? 'Pending host confirmation'
    : booking.status === 'confirmed'
      ? 'Confirmed'
      : booking.status === 'credit_issued'
        ? `₹${booking.deposit_amount.toLocaleString('en-IN')} credit available — contact the host`
        : 'Deposit credit applied to another stay';
  card.append(details, status);
  list.append(card);
}

async function loadAccount() {
  if (!isSupabaseConfigured || !supabase) {
    message.textContent = 'Account access is not configured yet. Add your Supabase project URL and anon key in supabase-client.js.';
    return;
  }

  let session;
  try {
    const { data, error } = await supabase.auth.getSession();
    if (error) throw error;
    session = data.session;
  } catch (error) {
    message.textContent = `Could not load your account: ${error.message}`;
    return;
  }
  if (!session) {
    window.location.assign('login.html');
    return;
  }

  signOutButton.hidden = false;
  const { data: bookings, error } = await supabase
    .from('bookings')
    .select('id, check_in, check_out, guests, room_type, total_amount, deposit_amount, status')
    .order('created_at', { ascending: false });

  if (error) {
    message.textContent = `Could not load booking requests: ${error.message}`;
    return;
  }
  if (!bookings.length) {
    message.textContent = 'You do not have any booking requests yet.';
    return;
  }

  message.textContent = '';
  bookings.forEach(addBooking);
}

signOutButton.addEventListener('click', async () => {
  signOutButton.disabled = true;
  try {
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
  } catch (error) {
    message.textContent = `Could not sign out: ${error.message}`;
    signOutButton.disabled = false;
    return;
  }
  window.location.assign('login.html');
});

loadAccount();
