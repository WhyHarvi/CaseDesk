// FRONTEND_URL can hold a comma-separated list of origins for CORS (server.js
// splits it into an array there). Auth redirect links need exactly ONE,
// correct URL — Supabase silently falls back to its own Site URL if the
// requested redirect_to isn't an allowlisted match, so picking the wrong
// entry out of a multi-value FRONTEND_URL breaks every invite/reset link
// without ever throwing an error. PUBLIC_APP_URL lets that be set explicitly,
// decoupled from the CORS list, so link generation never has to guess.
export function publicAppUrl() {
  const raw = String(process.env.PUBLIC_APP_URL || process.env.FRONTEND_URL || "http://localhost:5173");
  return raw.split(",")[0].trim().replace(/\/$/, "");
}
