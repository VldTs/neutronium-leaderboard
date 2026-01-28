/**
 * Supabase client factory for Cloudflare Functions
 */

import { createClient } from '@supabase/supabase-js';

/**
 * Create a Supabase client with service role key
 * @param {Object} env - Cloudflare environment variables
 * @returns {SupabaseClient}
 */
export function createSupabaseClient(env) {
  const supabaseUrl = env.SUPABASE_URL;
  const supabaseKey = env.SUPABASE_SERVICE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    throw new Error('Missing Supabase configuration');
  }

  return createClient(supabaseUrl, supabaseKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}