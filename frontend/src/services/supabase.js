import { createClient } from "@supabase/supabase-js";

const environment = import.meta.env || {};
const url = environment.VITE_SUPABASE_URL;
const anonKey = environment.VITE_SUPABASE_ANON_KEY;

export const supabase = url && anonKey
  ? createClient(url, anonKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    })
  : null;

export function requireSupabase() {
  if (!supabase) throw new Error("CaseDesk authentication is not configured.");
  return supabase;
}
