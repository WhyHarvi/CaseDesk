import assert from "node:assert/strict";
import test from "node:test";
import { sendLeadWelcomeEmail } from "../src/modules/leads/lead.welcomeEmail.service.js";

function welcomeDb() {
  let delivery = null;
  return {
    leadSettings: { findUnique: async () => ({ welcomeEmailEnabled: true }) },
    agency: { findUnique: async () => ({ legalName: "CHK Immigration" }) },
    bookingSettings: { findUnique: async () => ({ publicSlug: "consultation" }) },
    leadMessageDelivery: {
      upsert: async ({ create }) => {
        if (!delivery) delivery = { id: "delivery-1", attempts: 0, ...create };
        return { ...delivery };
      },
      updateMany: async ({ where, data }) => {
        if (!delivery || delivery.id !== where.id || delivery.status !== where.status) return { count: 0 };
        delivery = {
          ...delivery,
          ...data,
          attempts: data.attempts?.increment ? delivery.attempts + data.attempts.increment : delivery.attempts,
        };
        return { count: 1 };
      },
      update: async ({ data }) => {
        delivery = { ...delivery, ...data };
        return { ...delivery };
      },
    },
    currentDelivery: () => delivery,
  };
}

test("website lead welcome SMS records its provider result on the lead", async () => {
  const db = welcomeDb();
  let outbound;

  const result = await sendLeadWelcomeEmail("agency-1", {
    id: "lead-1",
    firstName: "Arshdeep",
    phone: "4387797766",
    sourceChannel: "WEBSITE_CONNECTOR",
  }, {
    db,
    sendSms: async (message) => {
      outbound = message;
      return { id: "provider-message-1", provider: "Twilio" };
    },
  });

  assert.equal(outbound.to, "4387797766");
  assert.equal(outbound.idempotencyKey, "lead-welcome:lead-1");
  assert.match(outbound.body, /Arshdeep/);
  assert.match(outbound.body, /\/b\/consultation/);
  assert.equal(result.status, "sent");
  assert.equal(result.provider, "Twilio");
  assert.equal(result.providerId, "provider-message-1");
  assert.equal(result.attempts, 1);
  assert.equal(result.sourceChannel, "WEBSITE_CONNECTOR");
});

test("website lead welcome SMS records a failed delivery instead of disappearing", async () => {
  const db = welcomeDb();

  const result = await sendLeadWelcomeEmail("agency-1", {
    id: "lead-2",
    firstName: "Test",
    phone: "+14165550100",
    sourceChannel: "WEBSITE_CONNECTOR",
  }, {
    db,
    sendSms: async () => { throw new Error("Twilio rejected the message"); },
  });

  assert.equal(result, null);
  assert.equal(db.currentDelivery().status, "failed");
  assert.equal(db.currentDelivery().attempts, 1);
  assert.match(db.currentDelivery().lastError, /Twilio rejected/);
  assert.ok(db.currentDelivery().failedAt instanceof Date);
});
