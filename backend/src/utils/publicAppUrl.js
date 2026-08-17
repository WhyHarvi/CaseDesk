// FRONTEND_URL can hold a comma-separated list of origins for CORS (server.js
// splits it into an array there). Auth redirect links need exactly ONE,
// correct URL — Supabase silently falls back to its own Site URL if the
// requested redirect_to isn't an allowlisted match, so picking the wrong
// entry out of a multi-value FRONTEND_URL breaks every invite/reset link
// without ever throwing an error. PUBLIC_APP_URL lets that be set explicitly,
// decoupled from the CORS list, so link generation never has to guess.
export const DEFAULT_PUBLIC_APP_URL = "https://casedesk.chkimmigration.ca";

function isLocalHostname(hostname) {
  const value = hostname.toLowerCase();
  return value === "localhost" || value === "127.0.0.1" || value === "::1" || value.endsWith(".localhost");
}

export function publicAppUrl(environment = process.env) {
  const raw = String(environment.PUBLIC_APP_URL || environment.FRONTEND_URL || "http://localhost:5173");
  const candidate = raw.split(",")[0].trim().replace(/\/$/, "");

  try {
    const parsed = new URL(candidate);
    if (environment.NODE_ENV === "production" && (parsed.protocol !== "https:" || isLocalHostname(parsed.hostname))) {
      return DEFAULT_PUBLIC_APP_URL;
    }
    return parsed.origin;
  } catch {
    return environment.NODE_ENV === "production" ? DEFAULT_PUBLIC_APP_URL : "http://localhost:5173";
  }
}

export function normalizeAuthActionLink(actionLink, redirectTo) {
  if (!actionLink || !redirectTo) return actionLink;
  const parsed = new URL(actionLink);
  parsed.searchParams.set("redirect_to", redirectTo);
  return parsed.toString();
}
