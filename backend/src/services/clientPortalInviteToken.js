import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { createHttpError } from "../utils/http.js";

export const CLIENT_PORTAL_INVITE_TTL_MS = 7 * 24 * 60 * 60_000;

function signingKey(environment = process.env) {
  const value = String(
    environment.PORTAL_INVITE_SIGNING_KEY
      || environment.SUPABASE_SERVICE_ROLE_KEY
      || "",
  ).trim();
  if (value.length < 32) {
    throw createHttpError(
      503,
      "Client portal invitations are not configured.",
      "AUTH_NOT_CONFIGURED",
    );
  }
  return value;
}

function signature(encodedPayload, secret) {
  return createHmac("sha256", secret)
    .update(`casedesk.client-portal-invite.v1.${encodedPayload}`)
    .digest("base64url");
}

export function createClientPortalInviteToken(
  { userId, authUserId },
  { now = Date.now(), secret = signingKey() } = {},
) {
  if (!userId || !authUserId) throw new TypeError("A user and auth identity are required.");
  const payload = Buffer.from(JSON.stringify({
    v: 1,
    sub: userId,
    aid: authUserId,
    iat: now,
    exp: now + CLIENT_PORTAL_INVITE_TTL_MS,
    nonce: randomUUID(),
  })).toString("base64url");
  return `v1.${payload}.${signature(payload, secret)}`;
}

export function verifyClientPortalInviteToken(
  token,
  { now = Date.now(), secret = signingKey() } = {},
) {
  const [version, encodedPayload, suppliedSignature, ...extra] = String(token || "").split(".");
  if (String(token || "").length > 2048 || version !== "v1" || !encodedPayload || !suppliedSignature || extra.length) {
    throw createHttpError(400, "This onboarding link is invalid.", "CLIENT_INVITE_INVALID");
  }

  const expectedSignature = signature(encodedPayload, secret);
  const supplied = Buffer.from(suppliedSignature);
  const expected = Buffer.from(expectedSignature);
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
    throw createHttpError(400, "This onboarding link is invalid.", "CLIENT_INVITE_INVALID");
  }

  let payload;
  try {
    payload = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8"));
  } catch {
    throw createHttpError(400, "This onboarding link is invalid.", "CLIENT_INVITE_INVALID");
  }
  if (
    payload?.v !== 1
    || typeof payload.sub !== "string"
    || typeof payload.aid !== "string"
    || typeof payload.nonce !== "string"
    || !Number.isFinite(payload.iat)
    || !Number.isFinite(payload.exp)
    || payload.iat <= 0
    || payload.exp - payload.iat !== CLIENT_PORTAL_INVITE_TTL_MS
    || payload.iat > now + 60_000
  ) {
    throw createHttpError(400, "This onboarding link is invalid.", "CLIENT_INVITE_INVALID");
  }
  if (now >= payload.exp) {
    throw createHttpError(
      410,
      "This onboarding link expired after seven days. Ask your case team to send a new one.",
      "CLIENT_INVITE_EXPIRED",
    );
  }
  return payload;
}
