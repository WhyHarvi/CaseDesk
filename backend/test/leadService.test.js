import assert from "node:assert/strict";
import test from "node:test";
import { convertLead, createConsultation, createLead, listLeadSources, qualifyLead, updateCommercialStatus } from "../src/modules/leads/lead.service.js";

test("lead creation writes its operational foundation in one transaction", async () => {
  const created = [];
  const tx = {
    $queryRaw: async () => [{ lock_status: "" }],
    client: { findFirst: async () => null },
    user: { findMany: async ({ where }) => where.id.in.map((id) => ({ id })) },
    leadSource: { findFirst: async () => ({ id: "source-1" }) },
    leadCampaign: { findFirst: async () => null },
    agencyLeadSequence: { upsert: async () => ({ nextValue: 2 }) },
    lead: {
      findFirst: async () => null,
      create: async ({ data }) => {
        created.push(["lead", data]);
        return { id: "lead-1", ...data };
      },
    },
    leadActivity: { create: async ({ data }) => created.push(["activity", data]) },
    leadStageHistory: { create: async ({ data }) => created.push(["stage", data]) },
    leadAssignmentHistory: { create: async ({ data }) => created.push(["assignment", data]) },
    leadFollowUp: { create: async ({ data }) => created.push(["followUp", data]) },
    activityLog: { create: async ({ data }) => created.push(["audit", data]) },
  };
  let transactionCount = 0;
  let transactionOptions;
  const db = { $transaction: async (operation, options) => { transactionCount += 1; transactionOptions = options; return operation(tx); } };
  const req = {
    auth: { role: "consultant", agencyId: "agency-1", userId: "user-1" },
    body: {
      phone: "+14165550100",
      ownerUserId: "user-1",
      originalSourceId: "source-1",
      nextActionType: "CALL",
      nextActionDescription: "Call the lead",
      nextActionAt: "2026-07-15T14:00:00Z",
    },
  };

  const lead = await createLead(req, db);

  assert.equal(transactionCount, 1);
  assert.equal(transactionOptions.timeout, 20_000);
  assert.equal(transactionOptions.maxWait, 10_000);
  assert.equal(lead.leadNumber, `LD-${new Date().getUTCFullYear()}-000001`);
  assert.deepEqual(created.map(([kind]) => kind).sort(), ["activity", "assignment", "audit", "followUp", "lead", "stage"].sort());
  assert.equal(created.find(([kind]) => kind === "lead")[1].agencyId, "agency-1");
});

test("qualified outcome advances an earlier lead and records history atomically", async () => {
  const calls = [];
  const tx = {
    $executeRaw: async () => 1,
    $queryRaw: async () => [{ lock_status: "" }],
    lead: {
      findFirst: async () => ({ id: "lead-1", leadNumber: "LD-2026-000001", status: "OPEN", stage: "CONNECTED" }),
      update: async ({ data }) => calls.push(["lead", data]),
    },
    leadQualification: {
      findUnique: async () => null,
      upsert: async ({ create }) => ({ id: "qualification-1", ...create }),
    },
    leadStageHistory: { create: async ({ data }) => calls.push(["stage", data]) },
    leadActivity: { create: async ({ data }) => calls.push(["activity", data]) },
    activityLog: { create: async ({ data }) => calls.push(["audit", data]) },
  };
  const db = { $transaction: async (operation) => operation(tx) };
  const req = {
    auth: { role: "consultant", agencyId: "agency-1", userId: "user-1" },
    params: { id: "lead-1" },
    body: { immigrationService: "Study Permit", outcome: "QUALIFIED", eligibilityConfidence: 75, notes: "Suitable for consultant review." },
  };

  const result = await qualifyLead(req, db);

  assert.equal(result.outcome, "QUALIFIED");
  assert.equal(calls.find(([kind]) => kind === "lead")[1].stage, "QUALIFIED");
  assert.equal(calls.filter(([kind]) => kind === "activity").length, 2);
  assert.ok(calls.some(([kind]) => kind === "stage"));
  assert.ok(calls.some(([kind]) => kind === "audit"));
});

test("listing sources provisions the standard agency catalog when it is missing", async () => {
  let inserted = [];
  const db = {
    leadSource: {
      createMany: async ({ data, skipDuplicates }) => { inserted = data; assert.equal(skipDuplicates, true); },
      findMany: async () => inserted.map((item, index) => ({ id: `source-${index}`, ...item })),
    },
  };

  const data = await listLeadSources({ auth: { agencyId: "agency-1" } }, db);

  assert.ok(data.length >= 10);
  assert.ok(data.some((source) => source.type === "PHONE"));
  assert.ok(data.every((source) => source.agencyId === "agency-1"));
});

test("booking a consultation updates the lead work queue in the same transaction", async () => {
  const calls = [];
  const tx = {
    $executeRaw: async () => 1,
    lead: {
      findFirst: async () => ({ id: "lead-1", leadNumber: "LD-2026-000001", status: "OPEN", stage: "QUALIFIED" }),
      update: async ({ data }) => calls.push(["lead", data]),
    },
    user: { findFirst: async () => ({ id: "consultant-1" }) },
    bookingSettings: { findUnique: async () => ({ bufferMinutes: 15, reminderMinutes: 1440 }) },
    appointment: {
      findFirst: async () => null,
      create: async ({ data }) => { calls.push(["appointment", data]); return { id: "appointment-1", ...data }; },
    },
    leadConsultation: { create: async ({ data }) => ({ id: "consultation-1", ...data }) },
    leadStageHistory: { create: async ({ data }) => calls.push(["stage", data]) },
    leadFollowUp: { create: async ({ data }) => calls.push(["followUp", data]) },
    leadActivity: { create: async ({ data }) => calls.push(["activity", data]) },
    activityLog: { create: async ({ data }) => calls.push(["audit", data]) },
  };
  let options;
  const db = { $transaction: async (operation, transactionOptions) => { options = transactionOptions; return operation(tx); } };
  const req = { auth: { role: "consultant", agencyId: "agency-1", userId: "user-1" }, params: { id: "lead-1" }, body: { consultantUserId: "consultant-1", startAt: "2026-08-01T14:00:00Z", endAt: "2026-08-01T15:00:00Z", appointmentType: "VIDEO" } };

  const result = await createConsultation(req, db);

  assert.equal(result.status, "SCHEDULED");
  assert.equal(options.timeout, 20_000);
  assert.equal(calls.find(([kind]) => kind === "lead")[1].stage, "CONSULTATION_BOOKED");
  assert.ok(calls.some(([kind]) => kind === "followUp"));
  assert.ok(calls.some(([kind]) => kind === "activity"));
  assert.ok(calls.some(([kind]) => kind === "appointment"));
});

test("signed retainer and paid initial payment make a lead ready to convert", async () => {
  const calls = [];
  const tx = {
    lead: {
      findFirst: async () => ({ id: "lead-1", leadNumber: "LD-2026-000001", status: "OPEN", stage: "PAYMENT_PENDING", ownerUserId: "user-1", retainerStatus: "SENT", initialPaymentStatus: "REQUESTED" }),
      update: async ({ data }) => { calls.push(["lead", data]); return { id: "lead-1", ...data }; },
    },
    leadStageHistory: { create: async ({ data }) => calls.push(["stage", data]) },
    leadFollowUp: { create: async ({ data }) => calls.push(["followUp", data]) },
    leadActivity: { create: async ({ data }) => calls.push(["activity", data]) },
    activityLog: { create: async ({ data }) => calls.push(["audit", data]) },
  };
  const db = { $transaction: async (operation) => operation(tx) };
  const req = { auth: { role: "consultant", agencyId: "agency-1", userId: "user-1" }, params: { id: "lead-1" }, body: { retainerStatus: "SIGNED", initialPaymentStatus: "PAID" } };

  await updateCommercialStatus(req, db);

  const update = calls.find(([kind]) => kind === "lead")[1];
  assert.equal(update.stage, "READY_TO_CONVERT");
  assert.equal(update.nextActionType, "REVIEW_CONVERSION");
  assert.equal(calls.filter(([kind]) => kind === "activity").length, 2);
});

test("conversion creates and links the client and case atomically", async () => {
  const calls = [];
  const convertibleLead = { id: "lead-1", leadNumber: "LD-2026-000001", status: "OPEN", stage: "READY_TO_CONVERT", ownerUserId: "user-1", phone: "+14165550100", phoneNormalized: "+14165550100", email: "avery@example.ca", emailNormalized: "avery@example.ca", retainerStatus: "SIGNED", initialPaymentStatus: "PAID", estimatedValue: 4000, originalSourceId: "source-1", campaignId: null };
  const tx = {
    $queryRaw: async () => [{ lock_status: "" }],
    lead: {
      findFirst: async ({ where }) => where.id?.not ? null : convertibleLead,
      update: async ({ data }) => calls.push(["lead", data]),
    },
    leadConversion: {
      findUnique: async () => null,
      create: async ({ data }) => { calls.push(["conversion", data]); return { id: "conversion-1", ...data }; },
    },
    leadQualification: { findUnique: async () => ({ immigrationService: "Work Permit", eligibilityConfidence: 85, notes: "Qualified" }) },
    agencyClientSequence: { upsert: async () => ({ nextValue: 2 }) },
    client: { findFirst: async () => null, create: async ({ data }) => { calls.push(["client", data]); return { id: "client-1", ...data }; } },
    case: { create: async ({ data }) => { calls.push(["case", data]); return { id: "case-1", ...data }; } },
    note: { create: async ({ data }) => calls.push(["note", data]) },
    followUp: { create: async ({ data }) => calls.push(["clientFollowUp", data]) },
    leadFollowUp: { updateMany: async ({ data }) => calls.push(["closedLeadFollowUps", data]) },
    leadActivity: { create: async ({ data }) => calls.push(["activity", data]) },
    activityLog: { create: async ({ data }) => calls.push(["audit", data]) },
  };
  let transactionCount = 0;
  const db = { $transaction: async (operation) => { transactionCount += 1; return operation(tx); } };
  const req = { auth: { role: "consultant", agencyId: "agency-1", userId: "user-1" }, params: { id: "lead-1" }, body: { fullName: "Avery Singh", caseType: "Work Permit", caseNextAction: "Collect identity documents", actualValue: 3500 } };

  const result = await convertLead(req, db);

  assert.equal(transactionCount, 1);
  assert.equal(result.client.id, "client-1");
  assert.equal(result.case.id, "case-1");
  assert.equal(calls.find(([kind]) => kind === "lead")[1].status, "CONVERTED");
  assert.equal(calls.find(([kind]) => kind === "lead")[1].convertedClientId, "client-1");
  assert.equal(calls.find(([kind]) => kind === "closedLeadFollowUps")[1].status, "CANCELLED");
  assert.ok(calls.some(([kind]) => kind === "clientFollowUp"));
  assert.ok(calls.some(([kind]) => kind === "audit"));
});

test("conversion rejects leads that have not completed commercial requirements", async () => {
  const tx = { lead: { findFirst: async () => ({ id: "lead-1", status: "OPEN", stage: "PAYMENT_PENDING", retainerStatus: "SIGNED", initialPaymentStatus: "REQUESTED" }) } };
  const db = { $transaction: async (operation) => operation(tx) };
  const req = { auth: { role: "consultant", agencyId: "agency-1", userId: "user-1" }, params: { id: "lead-1" }, body: { fullName: "Avery Singh", caseType: "Work Permit", caseNextAction: "Collect documents" } };
  await assert.rejects(() => convertLead(req, db), (error) => error.code === "LEAD_NOT_READY_TO_CONVERT");
});
