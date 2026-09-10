import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { sendLeadEmail } from "../src/modules/leads/lead.email.service.js";

const source = (path) => readFile(new URL(path, import.meta.url), "utf8");

function request(overrides = {}) {
  return {
    auth: { agencyId: "agency-1", userId: "user-1", role: "consultant" },
    user: { agencyId: "agency-1", id: "user-1", role: "consultant" },
    params: { id: "lead-1" },
    body: { subject: "Your consultation options", bodyText: "Hello, here are the next steps." },
    header: () => "operation-1",
    ...overrides,
  };
}

test("manual lead email is permission-checked, tenant-scoped, idempotent, and audited", async () => {
  const calls = { activities: [], leadUpdates: [], stageHistory: [], audit: [] };
  const lead = {
    id: "lead-1",
    agencyId: "agency-1",
    leadNumber: "LD-2026-000001",
    email: "lead@example.com",
    status: "OPEN",
    stage: "NEW",
    firstContactAt: null,
  };
  const db = {
    lead: {
      findFirst: async ({ where }) => {
        assert.equal(where.agencyId, "agency-1");
        assert.equal(where.id, "lead-1");
        return lead;
      },
    },
    leadMessageDelivery: {
      upsert: async ({ where, create }) => {
        assert.deepEqual(where, { agencyId_dedupeKey: { agencyId: "agency-1", dedupeKey: "lead-manual-email:lead-1:operation-1" } });
        assert.equal(create.recipient, lead.email);
        return { id: "delivery-1", ...create };
      },
      updateMany: async () => ({ count: 1 }),
      update: async ({ data }) => ({ id: "delivery-1", ...data }),
    },
    $transaction: async (operation) => operation({
      leadActivity: { create: async ({ data }) => calls.activities.push(data) },
      lead: { update: async ({ data }) => calls.leadUpdates.push(data) },
      leadStageHistory: { create: async ({ data }) => calls.stageHistory.push(data) },
      activityLog: { create: async ({ data }) => calls.audit.push(data) },
    }),
  };
  let permissionChecked = false;
  let sentPayload = null;
  const result = await sendLeadEmail(request(), {
    db,
    requirePermission: async (_req, permission) => { permissionChecked = permission === "canSendEmail"; },
    sendEmail: async (payload) => { sentPayload = payload; return { id: "provider-1", provider: "Microsoft 365" }; },
  });

  assert.equal(permissionChecked, true);
  assert.deepEqual(sentPayload.to, [lead.email]);
  assert.equal(sentPayload.agencyId, "agency-1");
  assert.equal(sentPayload.userId, "user-1");
  assert.equal(result.status, "sent");
  assert.equal(calls.activities[0].activityType, "EMAIL_SENT");
  assert.equal(calls.leadUpdates[0].stage, "CONTACTING");
  assert.equal(calls.stageHistory.length, 1);
  assert.equal(calls.audit[0].action, "lead.email_sent");
});

test("manual lead email refuses a missing address before creating a delivery", async () => {
  let deliveryCreated = false;
  const db = {
    lead: { findFirst: async () => ({ id: "lead-1", status: "OPEN", email: null }) },
    leadMessageDelivery: { upsert: async () => { deliveryCreated = true; } },
  };
  await assert.rejects(
    () => sendLeadEmail(request(), { db, requirePermission: async () => {}, sendEmail: async () => {} }),
    (error) => error.code === "LEAD_EMAIL_REQUIRED",
  );
  assert.equal(deliveryCreated, false);
});

test("lead contact values open the shared dialer and a pre-addressed Chats email composer", async () => {
  const [sheet, chats, composer, routes] = await Promise.all([
    source("../../frontend/src/modules/leads/components/LeadDetailSheet.jsx"),
    source("../../frontend/src/pages/ChatsPage.jsx"),
    source("../../frontend/src/components/case-profile/communication/CommunicationComposer.jsx"),
    source("../src/modules/leads/lead.routes.js"),
  ]);
  assert.match(sheet, /<button type="button" onClick=\{startCall\} disabled=\{!lead\.phone \|\| softphoneStatus !== "ready" \|\| Boolean\(activeCall\)\}/);
  assert.match(sheet, /\/app\/chats\?kind=email&compose=lead-email&lead=\$\{encodeURIComponent\(lead\.id\)\}/);
  assert.match(chats, /searchParams\.get\("compose"\) === "lead-email"/);
  assert.match(chats, /lead=\{leadEmailTarget\}/);
  assert.match(composer, /api\.post\(`\/leads\/\$\{encodeURIComponent\(lead\.id\)\}\/email`/);
  assert.match(routes, /router\.post\("\/:id\/email", asyncHandler\(sendLeadEmail\)\)/);
});
