import { requireSupabase } from "./supabase.js";

const AUTH_QUERY_KEYS = ["code", "error", "error_code", "error_description"];

export function readLinkParameters(location) {
  const query = new URLSearchParams(location?.search || "");
  const hash = new URLSearchParams(String(location?.hash || "").replace(/^#/, ""));
  const value = (key) => hash.get(key) || query.get(key) || "";

  return {
    code: query.get("code") || "",
    accessToken: hash.get("access_token") || "",
    refreshToken: hash.get("refresh_token") || "",
    type: value("type"),
    error: value("error"),
    errorCode: value("error_code"),
    errorDescription: value("error_description"),
  };
}

export function linkErrorMessage(parameters) {
  if (!parameters.error && !parameters.errorCode && !parameters.errorDescription) return "";
  if (parameters.errorCode === "otp_expired") {
    return "This secure link has already been used or has expired. Request a new password reset link.";
  }
  return parameters.errorDescription
    ? parameters.errorDescription
    : "This secure link is no longer valid. Request a new password reset link.";
}

function cleanAuthParameters(location, history) {
  if (!location || !history?.replaceState) return;
  const url = new URL(location.href);
  AUTH_QUERY_KEYS.forEach((key) => url.searchParams.delete(key));
  url.hash = "";
  history.replaceState(history.state, "", `${url.pathname}${url.search}`);
}

function waitForRecoverySession(client, timeoutMs) {
  return new Promise((resolve) => {
    let settled = false;
    let subscription;
    let timer;
    const finish = (session) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      subscription?.unsubscribe();
      resolve(session || null);
    };
    timer = setTimeout(() => finish(null), timeoutMs);
    const { data } = client.auth.onAuthStateChange((event, session) => {
      if (["PASSWORD_RECOVERY", "SIGNED_IN", "INITIAL_SESSION"].includes(event) && session) finish(session);
    });
    subscription = data.subscription;
    client.auth.getSession().then(({ data: current }) => {
      if (current.session) finish(current.session);
    }).catch(() => {});
  });
}

/**
 * Converts a Supabase invite/recovery URL into an authenticated session.
 * Supabase can return either a PKCE `?code=` or implicit hash tokens,
 * depending on project/client configuration. Supporting both keeps emailed
 * links working while the SDK is also doing its normal URL detection.
 */
export async function establishAuthLinkSession({
  client = requireSupabase(),
  location = window.location,
  history = window.history,
  timeoutMs = 5000,
} = {}) {
  const parameters = readLinkParameters(location);
  const linkError = linkErrorMessage(parameters);
  if (linkError) {
    cleanAuthParameters(location, history);
    throw new Error(linkError);
  }

  const hasCode = Boolean(parameters.code);
  const hasHashSession = Boolean(parameters.accessToken && parameters.refreshToken);
  if (!hasCode && !hasHashSession) {
    throw new Error("Open the newest secure link from your password reset email. The link may have expired or already been used.");
  }

  let session = null;
  if (hasCode) {
    const result = await client.auth.exchangeCodeForSession(parameters.code);
    if (result.error) throw new Error("This secure link could not be verified. Request a new password reset link and try again.");
    session = result.data.session;
  }

  if (!session && hasHashSession) {
    const result = await client.auth.setSession({
      access_token: parameters.accessToken,
      refresh_token: parameters.refreshToken,
    });
    if (result.error) throw new Error("This secure link could not be verified. Request a new password reset link and try again.");
    session = result.data.session;
  }

  if (!session) session = await waitForRecoverySession(client, timeoutMs);
  if (!session) {
    throw new Error("Open the newest secure link from your password reset email. The link may have expired or already been used.");
  }

  cleanAuthParameters(location, history);
  return session;
}
