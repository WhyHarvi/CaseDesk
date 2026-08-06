import { createClient } from "@supabase/supabase-js";

const environment = import.meta.env || {};
const url = environment.VITE_SUPABASE_URL;
const anonKey = environment.VITE_SUPABASE_ANON_KEY;

export function normalizeSupabaseAuthCallback({ location, history } = {}) {
  const currentLocation = location || (typeof window !== "undefined" ? window.location : null);
  const currentHistory = history || (typeof window !== "undefined" ? window.history : null);
  if (!currentLocation || !currentHistory?.replaceState || currentLocation.pathname !== "/") return false;
  const query = new URLSearchParams(currentLocation.search || "");
  const hash = new URLSearchParams(String(currentLocation.hash || "").replace(/^#/, ""));
  const hasAuthCallback = Boolean(
    query.get("code") ||
    query.get("error") ||
    query.get("error_code") ||
    hash.get("access_token") ||
    hash.get("error") ||
    hash.get("error_code"),
  );
  if (!hasAuthCallback) return false;
  currentHistory.replaceState(
    currentHistory.state,
    "",
    `/auth/accept-invite${currentLocation.search || ""}${currentLocation.hash || ""}`,
  );
  return true;
}

// If Supabase falls back to its configured Site URL, preserve the auth
// parameters but move the browser onto CaseDesk's dedicated callback route
// before React Router or the Supabase client can treat it as a normal visit.
normalizeSupabaseAuthCallback();

export const supabase = url && anonKey
  ? createClient(url, anonKey, {
      // Dedicated callback pages exchange the code/hash explicitly. Allowing
      // the SDK to auto-detect here creates a race where it consumes and
      // removes the tokens before AcceptInvite can verify the link.
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
    })
  : null;

export function requireSupabase() {
  if (!supabase) throw new Error("CaseDesk authentication is not configured.");
  return supabase;
}
