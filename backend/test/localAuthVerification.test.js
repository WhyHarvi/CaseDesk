import assert from "node:assert/strict";
import test from "node:test";
import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair } from "jose";
import {
  getAuthenticatedUser,
  verifyAccessToken,
  verifySupabaseJwt,
} from "../src/services/supabaseAuth.js";

const issuer = "https://example-project.supabase.co/auth/v1";
const subject = "7dbf1f7f-a811-4d70-83a8-605417fc0267";

async function fixture() {
  const { publicKey, privateKey } = await generateKeyPair("ES256");
  const publicJwk = await exportJWK(publicKey);
  Object.assign(publicJwk, { kid: "test-key", alg: "ES256", use: "sig" });
  const jwks = createLocalJWKSet({ keys: [publicJwk] });
  const sign = ({
    audience = "authenticated",
    role = "authenticated",
    issuedAt = Math.floor(Date.now() / 1000),
    expiresAt = Math.floor(Date.now() / 1000) + 3600,
    tokenIssuer = issuer,
  } = {}) =>
    new SignJWT({
      role,
      email: "member@example.com",
      app_metadata: { provider: "email" },
      user_metadata: { full_name: "Test Member" },
    })
      .setProtectedHeader({ alg: "ES256", kid: "test-key", typ: "JWT" })
      .setSubject(subject)
      .setIssuer(tokenIssuer)
      .setAudience(audience)
      .setIssuedAt(issuedAt)
      .setExpirationTime(expiresAt)
      .sign(privateKey);
  return { jwks, sign };
}

test("normal API authentication verifies Supabase JWTs locally", async () => {
  const { jwks, sign } = await fixture();
  const token = await sign();
  const user = await verifySupabaseJwt(token, { jwks, issuer });

  assert.equal(user.id, subject);
  assert.equal(user.email, "member@example.com");
  assert.equal(user.role, "authenticated");
  assert.equal(user.user_metadata.full_name, "Test Member");
  assert.notEqual(verifyAccessToken, getAuthenticatedUser);
});

test("local verification rejects expired, foreign, privileged, and tampered tokens", async () => {
  const { jwks, sign } = await fixture();
  const now = Math.floor(Date.now() / 1000);
  const options = { jwks, issuer };

  await assert.rejects(
    verifySupabaseJwt(
      await sign({ issuedAt: now - 7200, expiresAt: now - 3600 }),
      options,
    ),
  );
  await assert.rejects(
    verifySupabaseJwt(await sign({ audience: "service_role" }), options),
  );
  await assert.rejects(
    verifySupabaseJwt(await sign({ role: "service_role" }), options),
  );
  await assert.rejects(
    verifySupabaseJwt(
      await sign({ tokenIssuer: "https://foreign.example/auth/v1" }),
      options,
    ),
  );

  const valid = await sign();
  const parts = valid.split(".");
  parts[2] = `${parts[2][0] === "a" ? "b" : "a"}${parts[2].slice(1)}`;
  const tampered = parts.join(".");
  await assert.rejects(verifySupabaseJwt(tampered, options));
});

test("normal token verification has no Auth user endpoint in its code path", async () => {
  const source = await import("node:fs/promises").then(({ readFile }) =>
    readFile(
      new URL("../src/services/supabaseAuth.js", import.meta.url),
      "utf8",
    ),
  );
  const localSection = source.slice(
    source.indexOf("export function verifyAccessToken"),
    source.indexOf("export function getAuthenticatedUser"),
  );

  assert.match(localSection, /verifySupabaseJwt/);
  assert.doesNotMatch(localSection, /supabaseRequest\("\/auth\/v1\/user"/);
  assert.match(source, /export function getAuthenticatedUser/);
});
