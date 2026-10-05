import { isSupabaseConfigured, supabase } from './supabase-client.js';

const form = document.querySelector('[data-auth-form]');
if (form) {
  const message = form.querySelector('.form-message');
  const submit = form.querySelector('button[type="submit"]');
  const next = new URLSearchParams(window.location.search).get('next');
  const destination = next === 'booking' ? 'index.html#booking' : 'account.html';
  const switchLink = document.querySelector('.auth-switch a');
  if (next === 'booking' && switchLink) {
    switchLink.href = `${switchLink.getAttribute('href')}?next=booking`;
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!isSupabaseConfigured || !supabase) {
      message.textContent = 'Account sign-in is not configured yet. Add your Supabase project URL and anon key in supabase-client.js.';
      return;
    }

    submit.disabled = true;
    message.textContent = '';
    const values = new FormData(form);
    const email = String(values.get('email')).trim();
    const password = String(values.get('password'));

    try {
      if (form.dataset.authForm === 'signup') {
        const name = String(values.get('name')).trim();
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: { data: { full_name: name } },
        });
        if (error) throw error;

        if (!data.session) {
          message.textContent = 'Check your email to confirm your account, then sign in to continue.';
          submit.disabled = false;
          return;
        }
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      }

      window.location.assign(destination);
    } catch (error) {
      message.textContent = error.message || 'We could not complete sign-in. Please try again.';
      submit.disabled = false;
    }
  });
}
