import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const supabaseUrl = 'https://YOUR_PROJECT_ID.supabase.co';
const supabaseAnonKey = 'YOUR_SUPABASE_ANON_KEY';

export const isSupabaseConfigured =
  !supabaseUrl.includes('YOUR_PROJECT_ID') &&
  !supabaseAnonKey.includes('YOUR_SUPABASE_ANON_KEY');

export const supabase = isSupabaseConfigured
  ? createClient(supabaseUrl, supabaseAnonKey)
  : null;
