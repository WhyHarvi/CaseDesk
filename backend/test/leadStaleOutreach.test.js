import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  sendStaleLeadOutreach,
  staleLeadWhere,
  staleOutreachContent,
} from "../src/modules/leads/lead.staleOutreach.service.js";

const source = (relativePath) => readFile(new URL(relativePath, import.meta.url), "utf8");

const settings = {
  id: "settings-1",
  agencyId: "agency-1",
  staleOutreachEnabled: true,
  staleOutreachDays: 14,
  staleOutreachEmailEnabled: true,
  staleOutreachSmsEnabled: true,
};

test("stale outreach is a professional consultation invitation", () => {
  const content = staleOutreachContent({
    agencyName: "CHK Immigration Services",
    firstName: "Avery",
    bookingUrl: "https://casedesk.chkimmigration.ca/b/chk-immigration-services-inc-421a",
  });

  assert.equal(content.subject, "A quick check-in from CHK Immigration Services");
  assert.match(content.text, /high volume of active files/i);
  assert.match(content.text, /dedicated time and guidance/i);
  assert.match(content.text, /book a consultation/i);
  assert.match(content.sms, /casedesk\.chkimmigration\.ca\/b\/chk-immigration-services-inc-421a/);
  assert.doesNotMatch(content.text, /forgot|hard to follow/i);
});

test("stale outreach only selects consented unattended open pipeline leads", () => {
  const now = new Date("2026-08-12T16:00:00.000Z");
  const where = staleLeadWhere(settings, now);

  assert.equal(where.status, "OPEN");
  assert.equal(where.pipelineSegment, "STANDARD");
  assert.equal(where.consentGiven, true);
  assert.deepEqual(where.stage.in, ["NEW", "ASSIGNED", "CONTACTING", "CONNECTED", "QUALIFIED"]);
  assert.equal(where.followUps.none.status, "PENDING");
  assert.equal(where.followUps.none.dueAt.gt, now);
  assert.deepEqual(where.consultations.none.status.in, ["SCHEDULED", "CONFIRMED"]);
  assert.equal(where.messageDeliveries.none.kind, "stale_outreach");
  assert.equal(where.OR[1].lastContactAt, null);
  assert.equal(where.OR[1].inquiryDate.lte.toISOString(), "2026-07-29T16:00:00.000Z");
});

function outreachDb() {
  const deliveries = new Map();
  const activities = [];
  const leadUpdates = [];
  const db = {
    lead: {
      findFirst: async () => ({ id: "lead-1" }),
      update: async ({ data }) => { leadUpdates.push(data); return { id: "lead-1" }; },
      updateMany: async ({ data }) => { leadUpdates.push(data); return { count: 1 }; },
    },
    agency: { findUnique: async () => ({ id: "agency-1", legalName: "CHK Immigration Services", email: "hello@chkimmigration.ca" }) },
    bookingSettings: { findUnique: async () => ({ publicSlug: "chk-immigration-services-inc-421a" }) },
    leadActivity: { create: async ({ data }) => { activities.push(data); return data; } },
    $transaction: async (callback) => callback(db),
    leadMessageDelivery: {
      upsert: async ({ create }) => {
        const existing = deliveries.get(create.dedupeKey);
        if (existing) return { ...existing };
        const delivery = { id: `delivery-${deliveries.size + 1}`, attempts: 0, ...create };
        deliveries.set(create.dedupeKey, delivery);
        return { ...delivery };
      },
      updateMany: async ({ where, data }) => {
        const delivery = [...deliveries.values()].find((item) => item.id === where.id);
        if (!delivery || delivery.status !== where.status) return { count: 0 };
        Object.assign(delivery, data, { attempts: delivery.attempts + (data.attempts?.increment || 0) });
        return { count: 1 };
      },
      update: async ({ where, data }) => {
        const delivery = [...deliveries.values()].find((item) => item.id === where.id);
        Object.assign(delivery, data);
        return { ...delivery };
      },
    },
    deliveries,
    activities,
    leadUpdates,
  };
  return db;
}

test("stale outreach sends every available enabled channel and keeps a delivery audit", async () => {
  const db = outreachDb();
  const mail = [];
  const sms = [];
  const result = await sendStaleLeadOutreach(settings, {
    id: "lead-1",
    agencyId: "agency-1",
    firstName: "Avery",
    email: "avery@example.com",
    phone: "+14165550123",
    firstContactAt: null,
  }, {
    db,
    now: new Date("2026-08-12T16:00:00.000Z"),
    resolveMailConfig: async () => ({ from: "hello@chkimmigration.ca" }),
    makeMailTransport: () => ({ sendMail: async (message) => { mail.push(message); return { messageId: "mail-1" }; } }),
    sendSms: async (message) => { sms.push(message); return { id: "sms-1", provider: "Zapier / Ooma" }; },
  });

  assert.equal(result.sent, 2);
  assert.equal(mail.length, 1);
  assert.equal(sms.length, 1);
  assert.match(mail[0].html, /Book a consultation/);
  assert.match(mail[0].text, /chk-immigration-services-inc-421a/);
  assert.match(sms[0].body, /chk-immigration-services-inc-421a/);
  assert.deepEqual([...db.deliveries.values()].map((item) => item.status), ["sent", "sent"]);
  assert.deepEqual([...db.deliveries.values()].map((item) => item.dedupeKey), ["lead-stale-outreach:lead-1:email", "lead-stale-outreach:lead-1:sms"]);
  assert.deepEqual(db.activities.map((item) => item.activityType).sort(), ["EMAIL_SENT", "SMS_SENT"]);
  assert.equal(db.leadUpdates.length, 4);
});

test("stale outreach UI exposes controls, counts, and the per-lead message audit", async () => {
  const [settingsPage, detail, routes, server, migration] = await Promise.all([
    source("../../frontend/src/modules/leads/pages/LeadIntakePage.jsx"),
    source("../../frontend/src/modules/leads/components/LeadDetailSheet.jsx"),
    source("../src/modules/leads/lead.routes.js"),
    source("../src/server.js"),
    source("../prisma/migrations/20260812100000_lead_stale_outreach/migration.sql"),
  ]);
  assert.match(settingsPage, /Stale lead consultation check-in/);
  assert.match(settingsPage, /Eligible leads/);
  assert.match(settingsPage, /Recent delivery log/);
  assert.match(settingsPage, /leads\?lead=/);
  assert.match(settingsPage, /Run now/);
  assert.match(detail, /Automatic consultation check-in/);
  assert.match(routes, /settings\/stale-outreach\/run/);
  assert.match(server, /startLeadStaleOutreachWorker\(\)/);
  assert.match(migration, /stale_outreach_enabled/);
});
