import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  activeZoomCommitments,
  assertZoomGrantedScopes,
  buildZoomOAuthState,
  parseZoomOAuthState,
  verifyZoomWebhookSignature,
  zoomConnectionNeedsMaintenance,
  zoomConfigured,
  zoomEndpointValidationResponse,
} from "../src/services/zoomService.js";

function withZoomEnvironment(values, callback) {
  const keys = [
    "ZOOM_CLIENT_ID",
    "ZOOM_CLIENT_SECRET",
    "ZOOM_REDIRECT_URI",
    "ZOOM_WEBHOOK_SECRET_TOKEN",
    "MAIL_SETTINGS_ENCRYPTION_KEY",
  ];
  const original = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  Object.entries(values).forEach(([key, value]) => {
    if (value == null) delete process.env[key];
    else process.env[key] = value;
  });
  try {
    return callback();
  } finally {
    keys.forEach((key) => {
      if (original[key] == null) delete process.env[key];
      else process.env[key] = original[key];
    });
  }
}

test("Zoom is only offered when OAuth and webhook verification are fully configured", () => {
  withZoomEnvironment({
    ZOOM_CLIENT_ID: "client-id",
    ZOOM_CLIENT_SECRET: "client-secret",
    ZOOM_REDIRECT_URI: "https://api.example.com/api/zoom/callback",
    ZOOM_WEBHOOK_SECRET_TOKEN: null,
    MAIL_SETTINGS_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString("base64"),
  }, () => assert.equal(zoomConfigured(), false));

  withZoomEnvironment({
    ZOOM_CLIENT_ID: "client-id",
    ZOOM_CLIENT_SECRET: "client-secret",
    ZOOM_REDIRECT_URI: "https://api.example.com/api/zoom/callback",
    ZOOM_WEBHOOK_SECRET_TOKEN: "webhook-secret",
    MAIL_SETTINGS_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString("base64"),
  }, () => assert.equal(zoomConfigured(), true));
});

test("Zoom OAuth state is signed and rejects tampering", () => {
  withZoomEnvironment({
    MAIL_SETTINGS_ENCRYPTION_KEY: "state-signing-secret",
  }, () => {
    const state = buildZoomOAuthState("agency-1", "user-1");
    assert.deepEqual(parseZoomOAuthState(state), { agencyId: "agency-1", userId: "user-1" });
    const decoded = Buffer.from(state, "base64url").toString();
    const tampered = Buffer.from(decoded.replace("agency-1", "agency-2")).toString("base64url");
    assert.equal(parseZoomOAuthState(tampered), null);
  });
});

test("Zoom OAuth rejects incomplete scopes before accepting bookings", () => {
  // Self-scoped (non-admin) names are the primary requirement — a
  // single-user Zoom account is never offered the ":admin" scopes at all,
  // since there's no organization for them to administer.
  assert.throws(
    () => assertZoomGrantedScopes("user:read:user meeting:write:meeting"),
    (error) => error.code === "ZOOM_SCOPES_MISSING" && /update Zoom meetings/.test(error.message) && /delete Zoom meetings/.test(error.message),
  );
  assert.equal(
    assertZoomGrantedScopes([
      "user:read:user",
      "meeting:write:meeting",
      "meeting:update:meeting",
      "meeting:delete:meeting",
    ].join(" ")),
    "meeting:delete:meeting meeting:update:meeting meeting:write:meeting user:read:user",
  );
  // The ":admin" scopes remain accepted as an alternative for a future
  // Business/Enterprise, multi-user Zoom connection.
  assert.equal(
    assertZoomGrantedScopes("user:read:admin meeting:write:admin"),
    "meeting:write:admin user:read:admin",
  );
});

test("Zoom webhook signature validates the raw body and rejects stale or changed payloads", () => {
  withZoomEnvironment({ ZOOM_WEBHOOK_SECRET_TOKEN: "webhook-secret" }, () => {
    const body = Buffer.from(JSON.stringify({ event: "meeting.updated", payload: { object: { id: 42 } } }));
    const timestamp = String(Math.floor(Date.now() / 1000));
    const message = `v0:${timestamp}:${body.toString("utf8")}`;
    const signature = `v0=${createHmac("sha256", "webhook-secret").update(message).digest("hex")}`;

    assert.equal(verifyZoomWebhookSignature(body, signature, timestamp), true);
    assert.equal(verifyZoomWebhookSignature(Buffer.from("{}"), signature, timestamp), false);
    assert.equal(verifyZoomWebhookSignature(body, signature, String(Number(timestamp) - 601)), false);
  });
});

test("Zoom endpoint validation uses the webhook secret", () => {
  withZoomEnvironment({ ZOOM_WEBHOOK_SECRET_TOKEN: "webhook-secret" }, () => {
    const response = zoomEndpointValidationResponse("plain-token");
    assert.equal(response.plainToken, "plain-token");
    assert.equal(
      response.encryptedToken,
      createHmac("sha256", "webhook-secret").update("plain-token").digest("hex"),
    );
  });
});

test("active Zoom commitments include appointments, paid checkouts, and waitlist offers", async () => {
  const db = {
    appointment: {
      findMany: async () => [{ assignedToId: "consultant-a" }],
    },
    bookingPaymentHold: {
      findMany: async () => [{ assignedToId: "consultant-b" }],
    },
    bookingSlotHold: {
      findMany: async () => [
        { assignedToId: "consultant-a" },
        { assignedToId: "consultant-c" },
      ],
    },
  };
  const commitments = await activeZoomCommitments("agency-1", db);
  assert.deepEqual(commitments, {
    futureMeetings: 1,
    activePaymentHolds: 1,
    activeWaitlistOffers: 2,
    assigneeIds: ["consultant-a", "consultant-b", "consultant-c"],
  });
});

test("quiet Zoom connections are renewed well before the refresh token expires", () => {
  const now = new Date("2026-07-30T12:00:00.000Z").getTime();
  assert.equal(zoomConnectionNeedsMaintenance({
    status: "connected",
    updatedAt: new Date(now - 29 * 24 * 60 * 60_000),
  }, now), false);
  assert.equal(zoomConnectionNeedsMaintenance({
    status: "connected",
    updatedAt: new Date(now - 30 * 24 * 60 * 60_000),
  }, now), true);
  assert.equal(zoomConnectionNeedsMaintenance({
    status: "error",
    updatedAt: new Date(now - 90 * 24 * 60 * 60_000),
  }, now), false);
});

test("Zoom maintenance cannot starve a connection behind a fixed batch cap", async () => {
  const source = await readFile(new URL("../src/services/zoomService.js", import.meta.url), "utf8");
  const maintenance = source.slice(
    source.indexOf("export async function maintainZoomConnections"),
    source.indexOf("export function startZoomConnectionMaintenance"),
  );
  assert.match(maintenance, /orderBy: \[\{ updatedAt: "asc" \}, \{ id: "asc" \}\]/);
  assert.doesNotMatch(maintenance, /take:\s*\d+/);
});
