import assert from "node:assert/strict";
import test from "node:test";
import {
  CLIENT_PORTAL_INVITE_TTL_MS,
  createClientPortalInviteToken,
  verifyClientPortalInviteToken,
} from "../src/services/clientPortalInviteToken.js";

const secret = "test-client-portal-invitation-signing-key";
const issuedAt = Date.UTC(2026, 8, 9, 12);

test("client portal onboarding tokens remain valid for seven days", () => {
  const token = createClientPortalInviteToken(
    { userId: "user-1", authUserId: "auth-1" },
    { now: issuedAt, secret },
  );
  const payload = verifyClientPortalInviteToken(token, {
    now: issuedAt + CLIENT_PORTAL_INVITE_TTL_MS - 1,
    secret,
  });
  assert.equal(payload.sub, "user-1");
  assert.equal(payload.aid, "auth-1");
  assert.equal(payload.exp - payload.iat, 7 * 24 * 60 * 60_000);
});

test("client portal onboarding tokens expire at the seven-day boundary", () => {
  const token = createClientPortalInviteToken(
    { userId: "user-1", authUserId: "auth-1" },
    { now: issuedAt, secret },
  );
  assert.throws(
    () => verifyClientPortalInviteToken(token, {
      now: issuedAt + CLIENT_PORTAL_INVITE_TTL_MS,
      secret,
    }),
    (error) => error.statusCode === 410 && error.code === "CLIENT_INVITE_EXPIRED",
  );
});

test("resending does not invalidate an earlier unexpired onboarding token", () => {
  const first = createClientPortalInviteToken(
    { userId: "user-1", authUserId: "auth-1" },
    { now: issuedAt, secret },
  );
  const second = createClientPortalInviteToken(
    { userId: "user-1", authUserId: "auth-1" },
    { now: issuedAt + 60_000, secret },
  );
  assert.notEqual(first, second);
  assert.equal(verifyClientPortalInviteToken(first, { now: issuedAt + 120_000, secret }).sub, "user-1");
  assert.equal(verifyClientPortalInviteToken(second, { now: issuedAt + 120_000, secret }).sub, "user-1");
});

test("client portal onboarding tokens reject payload and signature tampering", () => {
  const token = createClientPortalInviteToken(
    { userId: "user-1", authUserId: "auth-1" },
    { now: issuedAt, secret },
  );
  const [version, payload, signature] = token.split(".");
  assert.throws(
    () => verifyClientPortalInviteToken(`${version}.${payload}x.${signature}`, { now: issuedAt, secret }),
    (error) => error.code === "CLIENT_INVITE_INVALID",
  );
});
