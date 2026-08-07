import assert from "node:assert/strict";
import test from "node:test";
import { ensureRetainerCaseForClient, ensureRetainerClientForLead } from "../src/modules/leads/lead.retainer.service.js";

function baseAppointment(overrides = {}) {
  return { id: "appointment-1", agencyId: "agency-1", leadId: "lead-1", manageToken: "token-abc", caseId: null, clientId: null, ...overrides };
}

function baseLead(overrides = {}) {
  return {
    id: "lead-1", agencyId: "agency-1", leadNumber: "LD-2026-000001", status: "OPEN",
    firstName: "Avery", lastName: "Singh", phone: "+14165550100", phoneNormalized: "+14165550100",
    email: "avery@example.ca", emailNormalized: "avery@example.ca", preferredLanguage: "English",
    immigrationInterest: "Work Permit", ownerUserId: "user-1", earlyClientId: null, earlyCaseId: null,
    ...overrides,
  };
}

function makeDb({ lead } = {}) {
  const calls = [];
  const tx = {
    $queryRaw: async () => [{ lock_status: "" }],
    lead: {
      findUnique: async () => lead,
      findFirst: async () => null, // assertNoContactDuplicate's lead-side duplicate scan
      update: async ({ data }) => calls.push(["lead", data]),
    },
    client: {
      findFirst: async () => null,
      create: async ({ data }) => { calls.push(["client", data]); return { id: "client-1", fullName: data.fullName, email: data.email, phone: data.phone, clientNumber: data.clientNumber, ...data }; },
    },
    case: { create: async ({ data }) => { calls.push(["case", data]); return { id: "case-1", ...data }; } },
    appointment: { findMany: async () => [{ id: "appointment-1" }], updateMany: async ({ data }) => calls.push(["linkedAppointments", data]) },
    note: { updateMany: async ({ data }) => calls.push(["linkedNotes", data]) },
    followUp: { updateMany: async ({ data }) => calls.push(["linkedFollowUps", data]) },
    agencyClientSequence: { upsert: async () => ({ nextValue: 2 }) },
    clientDocument: { create: async ({ data }) => { calls.push(["clientDocument", data]); return { id: "client-document-1", ...data }; } },
    writtenDocument: { create: async ({ data }) => { calls.push(["writtenDocument", data]); return { id: "written-document-1", ...data }; } },
    leadActivity: { create: async ({ data }) => calls.push(["leadActivity", data]) },
    activityLog: { create: async ({ data }) => calls.push(["activityLog", data]) },
    leadMessageDelivery: { create: async ({ data }) => calls.push(["messageDelivery", data]) },
  };
  const db = {
    lead: tx.lead,
    agency: { findUnique: async () => ({ id: "agency-1", name: "CHK Immigration", legalName: "CHK Immigration Services Inc.", email: "hello@chk.ca", phone: "416-555-0000", avatarStorageKey: null }) },
    user: { findUnique: async () => ({ id: "user-1", fullName: "Jordan Consultant", email: "jordan@chk.ca", licenseNumber: null }) },
    leadConsultation: { findFirst: async () => ({ id: "consultation-1", fee: 150 }) },
    leadMessageDelivery: tx.leadMessageDelivery,
    $transaction: async (operation) => operation(tx),
  };
  return { db, calls };
}

test("ensureRetainerClientForLead creates a client, case, and issued retainer document on first confirmation", async () => {
  const { db, calls } = makeDb({ lead: baseLead() });
  const sentEmails = [];
  const sentSms = [];
  const writtenFiles = [];

  const result = await ensureRetainerClientForLead(baseAppointment(), {
    db,
    fetchLogo: async () => null,
    writeFile: async (key, buffer) => writtenFiles.push({ key, size: buffer.length }),
    sendEmail: async (payload) => sentEmails.push(payload),
    sendSms: async (payload) => sentSms.push(payload),
  });

  assert.equal(result.client.id, "client-1");
  assert.equal(result.caseItem.id, "case-1");
  assert.equal(calls.find(([kind]) => kind === "case")[1].stage, "Retainer Pending");
  assert.equal(calls.find(([kind]) => kind === "client")[1].fullName, "Avery Singh");
  assert.equal(calls.filter(([kind]) => kind === "lead").find((entry) => entry[1].earlyClientId)[1].earlyClientId, "client-1");
  assert.equal(calls.filter(([kind]) => kind === "lead").find((entry) => entry[1].retainerStatus)[1].retainerStatus, "SENT");
  assert.equal(calls.find(([kind]) => kind === "writtenDocument")[1].correspondenceStatus, "Issued");
  assert.match(calls.find(([kind]) => kind === "writtenDocument")[1].contentHtml, /Avery Singh/);
  assert.equal(writtenFiles.length, 1);
  assert.equal(sentEmails.length, 1);
  assert.equal(sentEmails[0].kind, "retainer");
  assert.equal(sentSms.length, 1);
  assert.ok(sentSms[0].body.includes("token-abc"));
  assert.equal(calls.filter(([kind]) => kind === "messageDelivery").length, 2);
});

test("ensureRetainerClientForLead is a no-op for a lead that already has an early client", async () => {
  const { db, calls } = makeDb({ lead: baseLead({ earlyClientId: "client-existing", earlyCaseId: "case-existing" }) });
  const result = await ensureRetainerClientForLead(baseAppointment(), { db, writeFile: async () => {}, sendEmail: async () => {}, sendSms: async () => {} });
  assert.equal(result, null);
  assert.equal(calls.length, 0);
});

test("ensureRetainerClientForLead does nothing for an appointment with no lead", async () => {
  const { db, calls } = makeDb({ lead: baseLead() });
  const result = await ensureRetainerClientForLead(baseAppointment({ leadId: null }), { db, writeFile: async () => {}, sendEmail: async () => {}, sendSms: async () => {} });
  assert.equal(result, null);
  assert.equal(calls.length, 0);
});

// --- ensureRetainerCaseForClient: the other real gap — an appointment
// linked straight to an existing Client (no Lead at all) whose client has
// no Case yet.

function baseClient(overrides = {}) {
  return { id: "client-1", agencyId: "agency-1", fullName: "Narinder Singh", email: "narinder@example.ca", phone: "+14165550199", status: "Active", clientNumber: "CL-2026-000042", assignedUserId: "user-1", ...overrides };
}

function makeClientDb({ client, existingCase = null } = {}) {
  const calls = [];
  const tx = {
    case: {
      findFirst: async () => existingCase,
      create: async ({ data }) => { calls.push(["case", data]); return { id: "case-1", ...data }; },
    },
    clientDocument: { create: async ({ data }) => { calls.push(["clientDocument", data]); return { id: "client-document-1", ...data }; } },
    writtenDocument: { create: async ({ data }) => { calls.push(["writtenDocument", data]); return { id: "written-document-1", ...data }; } },
    activityLog: { create: async ({ data }) => calls.push(["activityLog", data]) },
  };
  const db = {
    client: { findUnique: async () => client },
    case: { findFirst: async () => existingCase },
    agency: { findUnique: async () => ({ id: "agency-1", name: "CHK Immigration", legalName: "CHK Immigration Services Inc.", email: "hello@chk.ca", phone: "416-555-0000", avatarStorageKey: null }) },
    user: { findUnique: async () => ({ id: "user-1", fullName: "Jordan Consultant", email: "jordan@chk.ca", licenseNumber: null }) },
    $transaction: async (operation) => operation(tx),
  };
  return { db, calls };
}

test("ensureRetainerCaseForClient creates a case and issued retainer document for a client with none yet", async () => {
  const { db, calls } = makeClientDb({ client: baseClient() });
  const sentEmails = [];
  const sentSms = [];
  const writtenFiles = [];

  const result = await ensureRetainerCaseForClient(baseAppointment({ leadId: null, clientId: "client-1", assignedToId: "user-1", subject: "Initial Consultation" }), {
    db,
    fetchLogo: async () => null,
    writeFile: async (key, buffer) => writtenFiles.push({ key, size: buffer.length }),
    sendEmail: async (payload) => sentEmails.push(payload),
    sendSms: async (payload) => sentSms.push(payload),
  });

  assert.equal(result.client.id, "client-1");
  assert.equal(result.caseItem.id, "case-1");
  assert.equal(calls.find(([kind]) => kind === "case")[1].stage, "Retainer Pending");
  assert.equal(calls.find(([kind]) => kind === "writtenDocument")[1].correspondenceStatus, "Issued");
  assert.match(calls.find(([kind]) => kind === "writtenDocument")[1].contentHtml, /Narinder Singh/);
  assert.ok(calls.some(([kind]) => kind === "activityLog"));
  assert.equal(writtenFiles.length, 1);
  assert.equal(sentEmails.length, 1);
  assert.equal(sentSms.length, 1);
});

test("ensureRetainerCaseForClient is a no-op for a client that already has a case", async () => {
  const { db, calls } = makeClientDb({ client: baseClient(), existingCase: { id: "case-existing" } });
  const result = await ensureRetainerCaseForClient(baseAppointment({ leadId: null, clientId: "client-1" }), { db, writeFile: async () => {}, sendEmail: async () => {}, sendSms: async () => {} });
  assert.equal(result, null);
  assert.equal(calls.length, 0);
});

test("ensureRetainerCaseForClient does nothing for an appointment with no client", async () => {
  const { db, calls } = makeClientDb({ client: baseClient() });
  const result = await ensureRetainerCaseForClient(baseAppointment({ leadId: null, clientId: null }), { db, writeFile: async () => {}, sendEmail: async () => {}, sendSms: async () => {} });
  assert.equal(result, null);
  assert.equal(calls.length, 0);
});
