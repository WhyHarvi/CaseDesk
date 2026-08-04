import { createHttpError } from "../utils/http.js";
import { createRemoteJWKSet, jwtVerify } from "jose";

const SUPPORTED_USER_TOKEN_ALGORITHMS = Object.freeze([
  "ES256",
  "RS256",
  "EdDSA",
]);
let cachedProjectVerifier = null;

function config() {
  const url = process.env.SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw createHttpError(
      503,
      "Authentication is not configured.",
      "AUTH_NOT_CONFIGURED",
    );
  }
  return { url: url.replace(/\/$/, ""), anonKey };
}

async function supabaseRequest(
  path,
  { token, serviceRole = false, method = "GET", body } = {},
) {
  const { url, anonKey } = config();
  const apiKey = serviceRole ? process.env.SUPABASE_SERVICE_ROLE_KEY : anonKey;
  if (!apiKey) {
    throw createHttpError(
      503,
      "Authentication administration is not configured.",
      "AUTH_NOT_CONFIGURED",
    );
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
    const error = new Error(
      payload.msg ||
        payload.message ||
        "Supabase authentication request failed",
    );
    error.statusCode = response.status;
    error.code = payload.error_code || payload.code || "SUPABASE_AUTH_ERROR";
    error.supabasePayload = payload;
    throw error;
  }
  return payload;
}

export function verifyAccessToken(token) {
  return verifySupabaseJwt(token);
}

function projectVerifier() {
  const { url } = config();
  const issuer = `${url}/auth/v1`;
  if (!cachedProjectVerifier || cachedProjectVerifier.issuer !== issuer) {
    cachedProjectVerifier = {
      issuer,
      jwks: createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks.json`), {
        cacheMaxAge: 10 * 60_000,
        cooldownDuration: 30_000,
        timeoutDuration: 5_000,
      }),
    };
  }
  return cachedProjectVerifier;
}

/**
 * Verifies a Supabase user access token against the project's public signing
 * keys. Tests may inject a local key set and issuer; production always uses
 * the configured project's cached remote JWKS.
 */
export async function verifySupabaseJwt(
  token,
  { jwks: injectedJwks, issuer: injectedIssuer } = {},
) {
  if (!token || typeof token !== "string") {
    throw new Error("A Supabase access token is required.");
  }
  const verifier =
    injectedJwks && injectedIssuer
      ? { jwks: injectedJwks, issuer: injectedIssuer }
      : projectVerifier();
  const { payload } = await jwtVerify(token, verifier.jwks, {
    algorithms: [...SUPPORTED_USER_TOKEN_ALGORITHMS],
    issuer: verifier.issuer,
    audience: "authenticated",
    typ: "JWT",
    clockTolerance: 5,
  });
  if (!payload.sub || payload.role !== "authenticated") {
    throw new Error("The token is not an authenticated Supabase user token.");
  }
  if (!Number.isFinite(payload.iat)) {
    throw new Error("The token is missing its issued-at claim.");
  }
  if (payload.iat > Math.floor(Date.now() / 1000) + 60) {
    throw new Error("The token issued-at claim is in the future.");
  }
  return {
    ...payload,
    id: payload.sub,
    app_metadata: payload.app_metadata || {},
    user_metadata: payload.user_metadata || {},
  };
}

/**
 * Fetches the complete Auth user record. Normal API authentication must not
 * use this; it exists for rare screens that need MFA/sign-in metadata absent
 * from JWT claims.
 */
export function getAuthenticatedUser(token) {
  return supabaseRequest("/auth/v1/user", { token });
}

export function updateAuthenticatedUser(token, attributes) {
  return supabaseRequest("/auth/v1/user", {
    token,
    method: "PUT",
    body: attributes,
  });
}

export function sendPasswordRecovery(email, redirectTo) {
  const query = redirectTo
    ? `?redirect_to=${encodeURIComponent(redirectTo)}`
    : "";
  return supabaseRequest(`/auth/v1/recover${query}`, {
    method: "POST",
    body: { email },
  });
}

export function createAuthUser({
  email,
  password,
  fullName,
  mustChangePassword = false,
}) {
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
  const query = redirectTo
    ? `?redirect_to=${encodeURIComponent(redirectTo)}`
    : "";
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
  const query = redirectTo
    ? `?redirect_to=${encodeURIComponent(redirectTo)}`
    : "";
  const payload = await supabaseRequest(
    `/auth/v1/admin/generate_link${query}`,
    {
      serviceRole: true,
      method: "POST",
      body: {
        type,
        email,
        data: { full_name: fullName },
      },
    },
  );
  return {
    actionLink: payload.properties?.action_link || payload.action_link,
    user: payload.user || payload,
  };
}

export function updateAuthUser(authUserId, attributes) {
  return supabaseRequest(
    `/auth/v1/admin/users/${encodeURIComponent(authUserId)}`,
    {
      serviceRole: true,
      method: "PUT",
      body: attributes,
    },
  );
}

export function deleteAuthUser(authUserId) {
  return supabaseRequest(
    `/auth/v1/admin/users/${encodeURIComponent(authUserId)}`,
    {
      serviceRole: true,
      method: "DELETE",
    },
  );
}

export async function findAuthUserByEmail(email) {
  const payload = await supabaseRequest(
    "/auth/v1/admin/users?page=1&per_page=1000",
    { serviceRole: true },
  );
  return (
    (payload.users || []).find(
      (user) => user.email?.toLowerCase() === email.toLowerCase(),
    ) || null
  );
}
