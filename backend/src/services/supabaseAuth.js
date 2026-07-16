import { createHttpError } from "../utils/http.js";

function config() {
  const url = process.env.SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw createHttpError(503, "Authentication is not configured.", "AUTH_NOT_CONFIGURED");
  }
  return { url: url.replace(/\/$/, ""), anonKey };
}

async function supabaseRequest(path, { token, serviceRole = false, method = "GET", body } = {}) {
  const { url, anonKey } = config();
  const apiKey = serviceRole ? process.env.SUPABASE_SERVICE_ROLE_KEY : anonKey;
  if (!apiKey) {
    throw createHttpError(503, "Authentication administration is not configured.", "AUTH_NOT_CONFIGURED");
  }

  const response = await fetch(`${url}${path}`, {
    method,
    headers: {
      apikey: apiKey,
      Authorization: `Bearer ${token || apiKey}`,
      "Content-Type": "application/json",
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload.msg || payload.message || "Supabase authentication request failed");
    error.statusCode = response.status;
    error.code = payload.error_code || payload.code || "SUPABASE_AUTH_ERROR";
    error.supabasePayload = payload;
    throw error;
  }
  return payload;
}

export function verifyAccessToken(token) {
  return supabaseRequest("/auth/v1/user", { token });
}

export function updateAuthenticatedUser(token, attributes) {
  return supabaseRequest("/auth/v1/user", { token, method: "PUT", body: attributes });
}

export function sendPasswordRecovery(email, redirectTo) {
  const query = redirectTo ? `?redirect_to=${encodeURIComponent(redirectTo)}` : "";
  return supabaseRequest(`/auth/v1/recover${query}`, { method: "POST", body: { email } });
}

export function createAuthUser({ email, password, fullName, mustChangePassword = false }) {
  return supabaseRequest("/auth/v1/admin/users", {
    serviceRole: true,
    method: "POST",
    body: {
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: fullName },
      app_metadata: { must_change_password: mustChangePassword },
    },
  });
}

export async function inviteAuthUser({ email, fullName, redirectTo }) {
  const query = redirectTo ? `?redirect_to=${encodeURIComponent(redirectTo)}` : "";
  const payload = await supabaseRequest(`/auth/v1/invite${query}`, {
    serviceRole: true,
    method: "POST",
    body: {
      email,
      data: { full_name: fullName },
    },
  });
  return payload.user || payload;
}

export async function generateAuthLink({ type, email, fullName, redirectTo }) {
  const query = redirectTo ? `?redirect_to=${encodeURIComponent(redirectTo)}` : "";
  const payload = await supabaseRequest(`/auth/v1/admin/generate_link${query}`, {
    serviceRole: true,
    method: "POST",
    body: {
      type,
      email,
      data: { full_name: fullName },
    },
  });
  return {
    actionLink: payload.properties?.action_link || payload.action_link,
    user: payload.user || payload,
  };
}

export function updateAuthUser(authUserId, attributes) {
  return supabaseRequest(`/auth/v1/admin/users/${encodeURIComponent(authUserId)}`, {
    serviceRole: true,
    method: "PUT",
    body: attributes,
  });
}

export function deleteAuthUser(authUserId) {
  return supabaseRequest(`/auth/v1/admin/users/${encodeURIComponent(authUserId)}`, {
    serviceRole: true,
    method: "DELETE",
  });
}

export async function findAuthUserByEmail(email) {
  const payload = await supabaseRequest("/auth/v1/admin/users?page=1&per_page=1000", { serviceRole: true });
  return (payload.users || []).find((user) => user.email?.toLowerCase() === email.toLowerCase()) || null;
}
