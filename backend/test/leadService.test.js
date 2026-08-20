import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { approveLeadTransferRequest, assignLead, bulkPromoteLeadsToPipeline, changeLeadPriority, changeLeadStage, convertLead, convertLeadCore, createConsultation, createLead, listLeadSources, qualifyLead, requestLeadTransfer, updateCommercialStatus, visibleLeadActivities } from "../src/modules/leads/lead.service.js";
import { createOrLinkLeadForConsultation } from "../src/modules/leads/lead.booking.js";

test("lead timelines hide superseded spreadsheet imports while retaining their reconciliation audit", () => {
  const activities = [
    { id: "legacy-follow-up", title: "Follow-up (imported)", description: "Call again" },
    { id: "blank-follow-up", title: "Follow-up (imported)", description: "" },
    { id: "fixed-follow-up", title: "Follow-up (reconciled)", description: "Call again" },
    { id: "legacy-admissions", title: "Admissions detail (imported)", description: "Wrong lead" },
    { id: "fixed-admissions", title: "Admissions detail (reconciled)", description: "Correct lead" },
    { id: "audit", title: "Admissions import association corrected", description: "Moved to the correct lead" },
    { id: "normal", title: "Client called", description: "Normal activity" },
  ];

  assert.deepEqual(
    visibleLeadActivities(activities).map((activity) => activity.id),
    ["fixed-follow-up", "fixed-admissions", "audit", "normal"],
  );
});

test("lead timelines keep legacy imports until a reconciliation exists", () => {
  const activities = [
    { id: "follow-up", title: "Follow-up (imported)", description: "Call again" },
    { id: "admissions", title: "Admissions detail (imported)", description: "Imported detail" },
  ];

  assert.deepEqual(visibleLeadActivities(activities).map((activity) => activity.id), ["follow-up", "admissions"]);
});

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

test("admin transfers a lead to front desk in one action with an automatic audit reason", async () => {
  const calls = [];
  const lead = {
    id: "lead-1",
    leadNumber: "LD-2026-000001",
    status: "OPEN",
    stage: "NEW",
    priority: "NORMAL",
    ownerUserId: "consultant-1",
    nextActionOwnerId: "consultant-1",
  };
  const tx = {
    lead: {
      findFirst: async () => lead,
      update: async ({ data }) => {
        calls.push(["lead", data]);
        return {
          ...lead,
          ...data,
          ownerUserId: "frontdesk-1",
          stage: "ASSIGNED",
          updatedAt: new Date("2026-08-11T12:00:00Z"),
        };
      },
    },
    user: {
      findFirst: async ({ where }) => {
        calls.push(["ownerLookup", where]);
        return { id: "frontdesk-1", fullName: "Manpreet Kaur" };
      },
    },
    leadFollowUp: {
      updateMany: async ({ data }) => calls.push(["followUps", data]),
    },
    leadTransferRequest: {
      findMany: async () => [],
      updateMany: async ({ data }) => calls.push(["staleRequests", data]),
    },
    leadAssignmentHistory: {
      create: async ({ data }) => calls.push(["assignment", data]),
    },
    leadActivity: {
      create: async ({ data }) => calls.push(["activity", data]),
    },
    activityLog: {
      create: async ({ data }) => calls.push(["audit", data]),
    },
  };
  const db = { $transaction: async (operation) => operation(tx) };
  const req = {
    auth: { role: "admin", agencyId: "agency-1", userId: "admin-1" },
    params: { id: "lead-1" },
    body: { ownerUserId: "frontdesk-1" },
  };

  const result = await assignLead(req, db);

  const automaticReason = "Transferred by an administrator to Manpreet Kaur";
  assert.equal(result.ownerUserId, "frontdesk-1");
  assert.equal(result.stage, "ASSIGNED");
  assert.equal(calls.find(([kind]) => kind === "lead")[1].nextActionOwnerId, "frontdesk-1");
  assert.equal(calls.find(([kind]) => kind === "followUps")[1].assignedUserId, "frontdesk-1");
  assert.equal(calls.find(([kind]) => kind === "assignment")[1].reason, automaticReason);
  assert.equal(calls.find(([kind]) => kind === "activity")[1].description, automaticReason);
  assert.match(calls.find(([kind]) => kind === "audit")[1].details, new RegExp(automaticReason));
  assert.deepEqual(
    calls.find(([kind]) => kind === "ownerLookup")[1].memberships.some.role.in,
    ["admin", "consultant", "frontdesk"],
  );
});

test("lead transfers reject targets who are not active lead team members", async () => {
  const tx = {
    lead: {
      findFirst: async () => ({
        id: "lead-1",
        status: "OPEN",
        ownerUserId: "consultant-1",
      }),
    },
    user: { findFirst: async () => null },
  };
  const db = { $transaction: async (operation) => operation(tx) };
  const req = {
    auth: { role: "admin", agencyId: "agency-1", userId: "admin-1" },
    params: { id: "lead-1" },
    body: { ownerUserId: "inactive-user-1" },
  };

  await assert.rejects(
    () => assignLead(req, db),
    (error) => error.code === "INVALID_LEAD_OWNER" && /active lead team member/i.test(error.message),
  );
});

test("an owning consultant requests a transfer without changing lead ownership", async () => {
  const calls = [];
  const lead = { id: "lead-1", leadNumber: "LD-2026-000001", status: "OPEN", ownerUserId: "consultant-1" };
  const tx = {
    lead: { findFirst: async () => lead },
    user: { findFirst: async () => ({ id: "frontdesk-1", fullName: "Front Desk" }) },
    leadTransferRequest: {
      findFirst: async () => null,
      create: async ({ data }) => {
        calls.push(["request", data]);
        return { id: "request-1", ...data, status: "PENDING", lead, fromOwner: { id: "consultant-1", fullName: "Consultant One" }, toOwner: { id: "frontdesk-1", fullName: "Front Desk" }, requestedBy: { id: "consultant-1", fullName: "Consultant One" }, reviewedBy: null };
      },
    },
    leadActivity: { create: async ({ data }) => calls.push(["activity", data]) },
    activityLog: { create: async ({ data }) => calls.push(["audit", data]) },
  };
  const db = { $transaction: async (operation) => operation(tx) };
  const request = await requestLeadTransfer({ auth: { role: "consultant", agencyId: "agency-1", userId: "consultant-1" }, params: { id: "lead-1" }, body: { ownerUserId: "frontdesk-1" } }, db);

  assert.equal(request.status, "PENDING");
  assert.equal(calls.find(([kind]) => kind === "request")[1].fromOwnerId, "consultant-1");
  assert.equal(calls.some(([kind]) => kind === "lead"), false);
  assert.match(calls.find(([kind]) => kind === "activity")[1].description, /administrator approval/i);
});

test("approving a consultant transfer moves the lead and pending follow-ups atomically", async () => {
  const calls = [];
  const lead = { id: "lead-1", leadNumber: "LD-2026-000001", status: "OPEN", stage: "CONTACTING", priority: "NORMAL", ownerUserId: "consultant-1", nextActionOwnerId: "consultant-1" };
  const transfer = { id: "request-1", agencyId: "agency-1", leadId: "lead-1", fromOwnerId: "consultant-1", toOwnerId: "frontdesk-1", requestedById: "consultant-1", status: "PENDING", lead, fromOwner: { id: "consultant-1", fullName: "Consultant One" }, toOwner: { id: "frontdesk-1", fullName: "Front Desk" }, requestedBy: { id: "consultant-1", fullName: "Consultant One" }, reviewedBy: null };
  const tx = {
    leadTransferRequest: {
      findFirst: async () => transfer,
      updateMany: async () => ({ count: 1 }),
      findUnique: async () => ({ ...transfer, status: "APPROVED" }),
    },
    lead: {
      findFirst: async () => lead,
      update: async ({ data }) => { calls.push(["lead", data]); return { ...lead, ...data, ownerUserId: "frontdesk-1", updatedAt: new Date() }; },
    },
    user: { findFirst: async () => ({ id: "frontdesk-1", fullName: "Front Desk" }) },
    leadFollowUp: { updateMany: async ({ data }) => calls.push(["followUps", data]) },
    leadAssignmentHistory: { create: async ({ data }) => calls.push(["assignment", data]) },
    leadActivity: { create: async ({ data }) => calls.push(["activity", data]) },
    activityLog: { create: async ({ data }) => calls.push(["audit", data]) },
  };
  const db = { $transaction: async (operation) => operation(tx) };
  const result = await approveLeadTransferRequest({ auth: { role: "admin", agencyId: "agency-1", userId: "admin-1" }, params: { requestId: "request-1" } }, db);

  assert.equal(result.lead.ownerUserId, "frontdesk-1");
  assert.equal(calls.find(([kind]) => kind === "lead")[1].nextActionOwnerId, "frontdesk-1");
  assert.equal(calls.find(([kind]) => kind === "followUps")[1].assignedUserId, "frontdesk-1");
  assert.match(calls.find(([kind]) => kind === "assignment")[1].reason, /approved by an administrator/i);
});

test("a stale transfer approval closes the request without changing ownership", async () => {
  const transfer = { id: "request-1", agencyId: "agency-1", leadId: "lead-1", fromOwnerId: "consultant-1", toOwnerId: "consultant-2", requestedById: "consultant-1", status: "PENDING", lead: { id: "lead-1", leadNumber: "LD-2026-000001", ownerUserId: "consultant-2" }, fromOwner: { id: "consultant-1", fullName: "One" }, toOwner: { id: "consultant-2", fullName: "Two" }, requestedBy: { id: "consultant-1", fullName: "One" }, reviewedBy: null };
  let leadUpdated = false;
  const tx = {
    leadTransferRequest: { findFirst: async () => transfer, updateMany: async () => ({ count: 1 }), findUnique: async () => ({ ...transfer, status: "STALE" }) },
    lead: { findFirst: async () => ({ id: "lead-1", status: "OPEN", ownerUserId: "consultant-2" }), update: async () => { leadUpdated = true; } },
  };
  const db = { $transaction: async (operation) => operation(tx) };
  await assert.rejects(() => approveLeadTransferRequest({ auth: { role: "admin", agencyId: "agency-1", userId: "admin-1" }, params: { requestId: "request-1" } }, db), (error) => error.code === "TRANSFER_REQUEST_STALE");
  assert.equal(leadUpdated, false);
});

test("qualified outcome advances an earlier lead and records history atomically", async () => {
  const calls = [];
  const tx = {
    $executeRaw: async () => 1,
    $queryRaw: async () => [{ lock_status: "" }],
    lead: {
      findFirst: async () => ({ id: "lead-1", leadNumber: "LD-2026-000001", status: "OPEN", stage: "CONNECTED", ownerUserId: "user-1", estimatedValue: null }),
      update: async ({ data }) => calls.push(["lead", data]),
    },
    leadQualification: {
      findUnique: async () => null,
      upsert: async ({ create }) => ({ id: "qualification-1", ...create }),
    },
    leadStageHistory: { create: async ({ data }) => calls.push(["stage", data]) },
    leadFollowUp: {
      updateMany: async ({ data }) => calls.push(["closedFollowUp", data]),
      create: async ({ data }) => calls.push(["followUp", data]),
    },
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

test("manual stage change is allowed for the assigned consultant and records history atomically", async () => {
  const calls = [];
  const tx = {
    lead: {
      findFirst: async () => ({ id: "lead-1", leadNumber: "LD-2026-000001", status: "OPEN", stage: "NEW", ownerUserId: "user-1" }),
      update: async ({ data }) => { calls.push(["lead", data]); return { id: "lead-1", ...data }; },
    },
    leadStageHistory: { create: async ({ data }) => calls.push(["stage", data]) },
    leadActivity: { create: async ({ data }) => calls.push(["activity", data]) },
    activityLog: { create: async ({ data }) => calls.push(["audit", data]) },
  };
  const db = { $transaction: async (operation) => operation(tx) };
  const req = {
    auth: { role: "consultant", agencyId: "agency-1", userId: "user-1" },
    params: { id: "lead-1" },
    body: { stage: "CONTACTING", reason: "Called the client before this lead existed in the CRM." },
  };

  const result = await changeLeadStage(req, db);

  assert.equal(result.stage, "CONTACTING");
  const stageHistory = calls.find(([kind]) => kind === "stage")[1];
  assert.equal(stageHistory.previousStage, "NEW");
  assert.equal(stageHistory.newStage, "CONTACTING");
  assert.ok(calls.some(([kind]) => kind === "activity"));
  assert.ok(calls.some(([kind]) => kind === "audit"));
});

test("manual stage change rejects a consultant who does not own the lead", async () => {
  const tx = {
    lead: { findFirst: async () => ({ id: "lead-1", leadNumber: "LD-2026-000001", status: "OPEN", stage: "NEW", ownerUserId: "someone-else" }) },
  };
  await assert.rejects(
    () => changeLeadStage({ auth: { role: "consultant", agencyId: "agency-1", userId: "user-1" }, params: { id: "lead-1" }, body: { stage: "CONTACTING" } }, { $transaction: (op) => op(tx) }),
    /Only an admin or this lead's assigned consultant/,
  );
});

test("manual priority change is admin-accessible on any lead and records an audit trail", async () => {
  const calls = [];
  const tx = {
    lead: {
      findFirst: async () => ({ id: "lead-1", leadNumber: "LD-2026-000001", status: "OPEN", priority: "NORMAL", ownerUserId: "someone-else" }),
      update: async ({ data }) => { calls.push(["lead", data]); return { id: "lead-1", ...data }; },
    },
    leadActivity: { create: async ({ data }) => calls.push(["activity", data]) },
    activityLog: { create: async ({ data }) => calls.push(["audit", data]) },
  };
  const db = { $transaction: async (operation) => operation(tx) };
  const req = {
    auth: { role: "admin", agencyId: "agency-1", userId: "admin-1" },
    params: { id: "lead-1" },
    body: { priority: "URGENT" },
  };

  const result = await changeLeadPriority(req, db);

  assert.equal(result.priority, "URGENT");
  assert.ok(calls.some(([kind]) => kind === "activity"));
  assert.ok(calls.some(([kind]) => kind === "audit"));
});

test("bulk promote processes each lead independently, skipping ones already promoted or not found", async () => {
  const activityCalls = [];
  const leadsById = {
    "lead-1": { id: "lead-1", leadNumber: "LD-2026-000001", pipelineSegment: "IMPORT_REVIEW" },
    "lead-2": { id: "lead-2", leadNumber: "LD-2026-000002", pipelineSegment: "STANDARD" },
  };
  const tx = {
    lead: {
      findFirst: async ({ where }) => leadsById[where.id] || null,
      update: async ({ where, data }) => { Object.assign(leadsById[where.id], data); return leadsById[where.id]; },
    },
    leadActivity: { create: async ({ data }) => activityCalls.push(data) },
    activityLog: { create: async () => {} },
  };
  const db = { $transaction: async (operation) => operation(tx) };
  const req = { auth: { role: "admin", agencyId: "agency-1", userId: "admin-1" }, body: { leadIds: ["lead-1", "lead-2", "missing-lead"] } };

  const result = await bulkPromoteLeadsToPipeline(req, db);

  assert.deepEqual(result.promoted.map((item) => item.id), ["lead-1"]);
  assert.equal(result.skipped.length, 2);
  assert.ok(result.skipped.some((item) => item.id === "lead-2" && /already/i.test(item.reason)));
  assert.ok(result.skipped.some((item) => item.id === "missing-lead"));
  assert.equal(leadsById["lead-1"].pipelineSegment, "STANDARD");
  assert.equal(activityCalls.length, 1);
});

test("bulk promote requires at least one lead id", async () => {
  await assert.rejects(
    () => bulkPromoteLeadsToPipeline({ auth: { role: "admin", agencyId: "agency-1", userId: "admin-1" }, body: { leadIds: [] } }, {}),
    /Select at least one lead/,
  );
});

test("manual priority change rejects a consultant who does not own the lead", async () => {
  const tx = {
    lead: { findFirst: async () => ({ id: "lead-1", leadNumber: "LD-2026-000001", status: "OPEN", priority: "NORMAL", ownerUserId: "someone-else" }) },
  };
  await assert.rejects(
    () => changeLeadPriority({ auth: { role: "consultant", agencyId: "agency-1", userId: "user-1" }, params: { id: "lead-1" }, body: { priority: "HIGH" } }, { $transaction: (op) => op(tx) }),
    /Only an admin or this lead's assigned consultant/,
  );
});

test("manual stage change rejects a no-op and leads that are not open or nurturing", async () => {
  const sameStageTx = {
    lead: { findFirst: async () => ({ id: "lead-1", leadNumber: "LD-2026-000001", status: "OPEN", stage: "CONTACTING" }) },
  };
  await assert.rejects(
    () => changeLeadStage({ auth: { role: "admin", agencyId: "agency-1", userId: "user-1" }, params: { id: "lead-1" }, body: { stage: "CONTACTING" } }, { $transaction: (op) => op(sameStageTx) }),
    /already at that stage/,
  );

  const convertedTx = {
    lead: { findFirst: async () => ({ id: "lead-1", leadNumber: "LD-2026-000001", status: "CONVERTED", stage: "READY_TO_CONVERT" }) },
  };
  await assert.rejects(
    () => changeLeadStage({ auth: { role: "admin", agencyId: "agency-1", userId: "user-1" }, params: { id: "lead-1" }, body: { stage: "NEW" } }, { $transaction: (op) => op(convertedTx) }),
    /Only open or nurtured leads/,
  );
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
    leadFollowUp: {
      updateMany: async ({ data }) => calls.push(["closedFollowUp", data]),
      create: async ({ data }) => calls.push(["followUp", data]),
    },
    leadActivity: { create: async ({ data }) => calls.push(["activity", data]) },
    activityLog: { create: async ({ data }) => calls.push(["audit", data]) },
  };
  let options;
  const db = { $transaction: async (operation, transactionOptions) => { options = transactionOptions; return operation(tx); } };
  const req = { auth: { role: "consultant", agencyId: "agency-1", userId: "user-1" }, params: { id: "lead-1" }, body: { consultantUserId: "consultant-1", startAt: "2026-08-01T14:00:00Z", endAt: "2026-08-01T14:30:00Z", appointmentType: "VIDEO" } };

  const result = await createConsultation(req, db);

  assert.equal(result.status, "SCHEDULED");
  assert.equal(options.timeout, 20_000);
  assert.equal(calls.find(([kind]) => kind === "lead")[1].stage, "CONSULTATION_BOOKED");
  assert.ok(calls.some(([kind]) => kind === "followUp"));
  assert.ok(calls.some(([kind]) => kind === "activity"));
  assert.ok(calls.some(([kind]) => kind === "appointment"));
});

test("public booking links an existing client and website lead to the same consultation", async () => {
  const calls = [];
  const lead = {
    id: "lead-1",
    leadNumber: "LD-2026-000008",
    stage: "NEW",
    firstContactAt: null,
    firstConnectedAt: null,
  };
  const tx = {
    lead: {
      findFirst: async ({ where }) => where.emailNormalized === "person@example.ca" ? lead : null,
      update: async ({ data }) => calls.push(["lead", data]),
    },
    client: { findFirst: async () => ({ id: "client-1" }) },
    appointment: { update: async ({ data }) => calls.push(["appointment", data]) },
    bookingPaymentHold: { updateMany: async ({ data }) => calls.push(["hold", data]) },
    leadConsultation: { create: async ({ data }) => ({ id: "consultation-1", ...data }) },
    leadStageHistory: { create: async ({ data }) => calls.push(["stage", data]) },
    leadFollowUp: {
      updateMany: async ({ data }) => calls.push(["closedFollowUp", data]),
      create: async ({ data }) => calls.push(["followUp", data]),
    },
    leadActivity: { create: async ({ data }) => calls.push(["activity", data]) },
  };
  const appointment = {
    id: "appointment-1",
    status: "Scheduled",
    startsAt: new Date("2026-08-04T14:00:00Z"),
    endsAt: new Date("2026-08-04T14:30:00Z"),
    createdAt: new Date("2026-07-30T21:13:00Z"),
    assignedToId: "consultant-1",
    meetingMode: "Zoom",
  };

  const linked = await createOrLinkLeadForConsultation(tx, {
    agencyId: "agency-1",
    appointment,
    guestName: "Person Example",
    guestEmail: "person@example.ca",
    guestPhone: "+14165550100",
    paymentStatus: "PAID",
    fee: 100,
    holdId: "hold-1",
  });

  assert.deepEqual(linked, { clientId: "client-1", leadId: "lead-1" });
  assert.ok(calls.some(([kind, data]) => kind === "appointment" && data.clientId === "client-1"));
  assert.ok(calls.some(([kind, data]) => kind === "appointment" && data.leadId === "lead-1"));
  assert.equal(calls.find(([kind]) => kind === "lead")[1].stage, "CONSULTATION_BOOKED");
  assert.equal(calls.find(([kind]) => kind === "closedFollowUp")[1].completionOutcome, "Consultation booked");
  assert.equal(calls.find(([kind]) => kind === "followUp")[1].type, "CONFIRM_CONSULTATION");
  assert.equal(calls.find(([kind]) => kind === "activity")[1].occurredAt.toISOString(), appointment.createdAt.toISOString());
  assert.equal(calls.find(([kind]) => kind === "stage")[1].createdAt.toISOString(), appointment.createdAt.toISOString());
});

test("paid initial payment cannot be asserted without a posted financial record", async () => {
  const req = { auth: { role: "admin", agencyId: "agency-1", userId: "user-1" }, params: { id: "lead-1" }, body: { retainerStatus: "SIGNED", initialPaymentStatus: "PAID", notes: "Receipt note only." } };
  await assert.rejects(() => updateCommercialStatus(req, {}), (error) => error.code === "PAYMENT_EVIDENCE_REQUIRED");
});

test("an owning consultant also cannot assert a paid initial payment", async () => {
  const req = { auth: { role: "consultant", agencyId: "agency-1", userId: "user-1" }, params: { id: "lead-1" }, body: { retainerStatus: "SIGNED", initialPaymentStatus: "PAID", notes: "Signed agreement and payment receipt verified." } };
  await assert.rejects(() => updateCommercialStatus(req, {}), (error) => error.code === "PAYMENT_EVIDENCE_REQUIRED");
});

test("commercial status update rejects a consultant who does not own the lead when confirming signed or paid", async () => {
  const tx = {
    lead: { findFirst: async () => ({ id: "lead-1", leadNumber: "LD-2026-000001", status: "OPEN", stage: "PAYMENT_PENDING", ownerUserId: "someone-else", retainerStatus: "SENT", initialPaymentStatus: "REQUESTED" }) },
  };
  const db = { $transaction: async (operation) => operation(tx) };
  const req = { auth: { role: "consultant", agencyId: "agency-1", userId: "user-1" }, params: { id: "lead-1" }, body: { retainerStatus: "SIGNED", notes: "Signed copy on file." } };

  await assert.rejects(
    () => updateCommercialStatus(req, db),
    /Only an admin or this lead's assigned consultant/,
  );
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
    appointment: {
      findMany: async () => [{ id: "appointment-1" }],
      updateMany: async ({ data }) => calls.push(["linkedAppointments", data]),
    },
    note: {
      create: async ({ data }) => calls.push(["note", data]),
      updateMany: async ({ data }) => calls.push(["linkedAppointmentNotes", data]),
    },
    followUp: {
      create: async ({ data }) => calls.push(["clientFollowUp", data]),
      updateMany: async ({ data }) => calls.push(["linkedAppointmentFollowUps", data]),
    },
    leadFollowUp: { updateMany: async ({ data }) => calls.push(["closedLeadFollowUps", data]) },
    caseManualLedgerEntry: { updateMany: async ({ data }) => calls.push(["linkedLedger", data]) },
    leadActivity: { create: async ({ data }) => calls.push(["activity", data]) },
    activityLog: { create: async ({ data }) => calls.push(["audit", data]) },
  };
  let transactionCount = 0;
  const db = {
    lead: { findFirst: async () => convertibleLead },
    $transaction: async (operation) => { transactionCount += 1; return operation(tx); },
  };
  const req = { auth: { role: "consultant", agencyId: "agency-1", userId: "user-1" }, params: { id: "lead-1" }, body: { fullName: "Avery Singh", caseType: "Work Permit", caseNextAction: "Collect identity documents", actualValue: 3500 } };

  const result = await convertLead(req, db);

  assert.equal(transactionCount, 1);
  assert.equal(result.client.id, "client-1");
  assert.equal(result.case.id, "case-1");
  assert.equal(calls.find(([kind]) => kind === "lead")[1].status, "CONVERTED");
  assert.equal(calls.find(([kind]) => kind === "lead")[1].convertedClientId, "client-1");
  assert.equal(calls.find(([kind]) => kind === "closedLeadFollowUps")[1].status, "CANCELLED");
  assert.ok(calls.some(([kind]) => kind === "clientFollowUp"));
  assert.equal(calls.find(([kind]) => kind === "linkedAppointments")[1].clientId, "client-1");
  assert.equal(calls.find(([kind]) => kind === "linkedAppointmentNotes")[1].clientId, "client-1");
  assert.equal(calls.find(([kind]) => kind === "linkedAppointmentFollowUps")[1].clientId, "client-1");
  assert.ok(calls.some(([kind]) => kind === "audit"));
});

test("conversion reuses an already-created retainer client/case instead of creating a second one", async () => {
  const calls = [];
  const convertibleLead = { id: "lead-1", leadNumber: "LD-2026-000001", status: "OPEN", stage: "READY_TO_CONVERT", ownerUserId: "user-1", phone: "+14165550100", phoneNormalized: "+14165550100", email: "avery@example.ca", emailNormalized: "avery@example.ca", retainerStatus: "SIGNED", initialPaymentStatus: "PAID", estimatedValue: 4000, originalSourceId: "source-1", campaignId: null, earlyClientId: "client-early", earlyCaseId: "case-early" };
  const tx = {
    lead: {
      findFirst: async ({ where }) => where.id?.not ? null : convertibleLead,
      update: async ({ data }) => calls.push(["lead", data]),
    },
    leadConversion: {
      findUnique: async () => null,
      create: async ({ data }) => { calls.push(["conversion", data]); return { id: "conversion-1", ...data }; },
    },
    leadQualification: { findUnique: async () => null },
    // No client.create/case.create mocked — the reuse branch must not call
    // them, so an accidental call here fails the test with a clear error
    // instead of silently creating a second client.
    client: { update: async ({ data }) => { calls.push(["client", data]); return { id: "client-early", ...data }; } },
    case: { update: async ({ data }) => { calls.push(["case", data]); return { id: "case-early", ...data }; } },
    appointment: { findMany: async () => [], updateMany: async () => {} },
    note: { updateMany: async () => {} },
    followUp: {
      create: async ({ data }) => calls.push(["clientFollowUp", data]),
      updateMany: async () => {},
    },
    leadFollowUp: { updateMany: async () => {} },
    caseManualLedgerEntry: { updateMany: async () => {} },
    leadActivity: { create: async () => {} },
    activityLog: { create: async () => {} },
  };
  const db = {
    lead: { findFirst: async () => convertibleLead },
    $transaction: async (operation) => operation(tx),
  };
  const req = { auth: { role: "consultant", agencyId: "agency-1", userId: "user-1" }, params: { id: "lead-1" }, body: { fullName: "Avery Singh", caseType: "Work Permit", caseStage: "Documents Pending", caseNextAction: "Collect identity documents", actualValue: 3500 } };

  const result = await convertLead(req, db);

  assert.equal(result.client.id, "client-early");
  assert.equal(result.case.id, "case-early");
  assert.equal(calls.find(([kind]) => kind === "client")[1].fullName, "Avery Singh");
  assert.equal(calls.find(([kind]) => kind === "case")[1].stage, "Documents Pending");
  assert.equal(calls.find(([kind]) => kind === "lead")[1].convertedClientId, "client-early");
});

test("conversion rejects leads that have not completed commercial requirements", async () => {
  const notReadyLead = { id: "lead-1", leadNumber: "LD-2026-000001", ownerUserId: "user-1", status: "OPEN", stage: "PAYMENT_PENDING", retainerStatus: "SIGNED", initialPaymentStatus: "REQUESTED" };
  const tx = { lead: { findFirst: async () => notReadyLead } };
  const db = {
    lead: { findFirst: async () => notReadyLead },
    $transaction: async (operation) => operation(tx),
  };
  const req = { auth: { role: "consultant", agencyId: "agency-1", userId: "user-1" }, params: { id: "lead-1" }, body: { fullName: "Avery Singh", caseType: "Work Permit", caseNextAction: "Collect documents" } };
  await assert.rejects(() => convertLead(req, db), (error) => error.code === "LEAD_NOT_READY_TO_CONVERT");
});

test("conversion rejects a consultant who can see but does not own the lead", async () => {
  const wrongOwnerLead = { id: "lead-1", leadNumber: "LD-2026-000001", ownerUserId: "other-consultant", status: "OPEN", stage: "READY_TO_CONVERT", retainerStatus: "SIGNED", initialPaymentStatus: "PAID" };
  const tx = {
    lead: {
      findFirst: async () => wrongOwnerLead,
    },
  };
  const db = {
    lead: { findFirst: async () => wrongOwnerLead },
    $transaction: async (operation) => operation(tx),
  };
  const req = {
    auth: { role: "consultant", agencyId: "agency-1", userId: "user-1" },
    params: { id: "lead-1" },
    body: { fullName: "Avery Singh", caseType: "Work Permit", caseNextAction: "Collect documents" },
  };

  await assert.rejects(
    () => convertLead(req, db),
    /Only an admin or this lead's assigned consultant/,
  );
});

const source = (relativePath) => readFile(new URL(relativePath, import.meta.url), "utf8");

// Regression coverage for a real bug: an early client (retainer signed
// before formal lead conversion) never got convertedClientId set unless a
// human separately opened the Convert form and submitted it. Once the
// retainer AND initial payment were both genuinely ready, nothing was left
// to decide — so this closes it automatically, deriving the same defaults
// ConvertLeadSheet.jsx pre-fills for a human.
test("an unattended conversion (no values passed) derives the same defaults the manual conversion form pre-fills", async () => {
  const calls = [];
  const readyEarlyClientLead = {
    id: "lead-1", leadNumber: "LD-2026-000305", status: "OPEN", stage: "READY_TO_CONVERT",
    ownerUserId: "owner-1", firstName: "Lovedeep", lastName: "Singh",
    retainerStatus: "SIGNED", initialPaymentStatus: "PAID",
    immigrationInterest: "Study Permit", estimatedValue: 4000,
    earlyClientId: "client-early", earlyCaseId: "case-early",
    originalSourceId: "source-1", campaignId: null,
  };
  const tx = {
    lead: {
      findFirst: async () => readyEarlyClientLead,
      update: async ({ data }) => calls.push(["lead", data]),
    },
    leadConversion: {
      findUnique: async () => null,
      create: async ({ data }) => { calls.push(["conversion", data]); return { id: "conversion-1", ...data }; },
    },
    leadQualification: { findUnique: async () => null },
    case: {
      findUnique: async () => ({ caseType: "Study Permit" }), // the fallback lookup — unused here since immigrationInterest is set
      update: async ({ data }) => { calls.push(["case", data]); return { id: "case-early", ...data }; },
    },
    client: { update: async ({ data }) => { calls.push(["client", data]); return { id: "client-early", ...data }; } },
    appointment: { findMany: async () => [], updateMany: async () => {} },
    note: { updateMany: async () => {} },
    followUp: { create: async ({ data }) => calls.push(["clientFollowUp", data]), updateMany: async () => {} },
    leadFollowUp: { updateMany: async () => {} },
    caseManualLedgerEntry: { updateMany: async () => {} },
    leadActivity: { create: async () => {} },
    activityLog: { create: async () => {} },
  };
  const db = { $transaction: async (operation) => operation(tx) };

  const result = await convertLeadCore("agency-1", "lead-1", { actorId: "owner-1" }, db);

  assert.equal(result.client.id, "client-early");
  assert.equal(result.case.id, "case-early");
  assert.equal(calls.find(([kind]) => kind === "case")[1].caseType, "Study Permit");
  assert.equal(calls.find(([kind]) => kind === "case")[1].stage, "Documents Pending");
  assert.equal(calls.find(([kind]) => kind === "case")[1].nextAction, "Complete client intake and collect initial documents");
  assert.equal(calls.find(([kind]) => kind === "conversion")[1].convertedById, "owner-1");
  assert.equal(calls.find(([kind]) => kind === "lead")[1].convertedClientId, "client-early");
  assert.equal(calls.find(([kind]) => kind === "lead")[1].convertedCaseId, "case-early");
});

test("an unattended conversion falls back to the early case's own case type when the lead has no immigration interest on file", async () => {
  const calls = [];
  const leadWithNoInterest = {
    id: "lead-1", leadNumber: "LD-2026-000306", status: "OPEN", stage: "READY_TO_CONVERT",
    ownerUserId: "owner-1", firstName: "No", lastName: "Interest",
    retainerStatus: "SIGNED", initialPaymentStatus: "PAID",
    immigrationInterest: null, estimatedValue: null,
    earlyClientId: "client-early", earlyCaseId: "case-early",
    originalSourceId: "source-1", campaignId: null,
  };
  const tx = {
    lead: { findFirst: async () => leadWithNoInterest, update: async ({ data }) => calls.push(["lead", data]) },
    leadConversion: { findUnique: async () => null, create: async ({ data }) => { calls.push(["conversion", data]); return { id: "conversion-1", ...data }; } },
    leadQualification: { findUnique: async () => null },
    case: {
      findUnique: async () => ({ caseType: "Work Permit" }),
      update: async ({ data }) => { calls.push(["case", data]); return { id: "case-early", ...data }; },
    },
    client: { update: async ({ data }) => ({ id: "client-early", ...data }) },
    appointment: { findMany: async () => [], updateMany: async () => {} },
    note: { updateMany: async () => {} },
    followUp: { create: async () => {}, updateMany: async () => {} },
    leadFollowUp: { updateMany: async () => {} },
    caseManualLedgerEntry: { updateMany: async () => {} },
    leadActivity: { create: async () => {} },
    activityLog: { create: async () => {} },
  };
  const db = { $transaction: async (operation) => operation(tx) };

  await convertLeadCore("agency-1", "lead-1", { actorId: "owner-1" }, db);

  assert.equal(calls.find(([kind]) => kind === "case")[1].caseType, "Work Permit");
});

test("financial evidence auto-converts an early client's lead only once retainer and payment are both ready — best-effort, outside the payment-status transaction", async () => {
  const financialService = await source("../src/modules/leads/lead.financial.service.js");
  assert.match(financialService, /import \{ convertLeadCore \} from "\.\/lead\.service\.js";/);
  const fnStart = financialService.indexOf("export async function syncLeadInitialPaymentFromEvidence(");
  const fnBody = financialService.slice(fnStart, financialService.indexOf("\nexport ", fnStart + 1));
  assert.match(fnBody, /if \(ready && lead\.earlyClientId && lead\.earlyCaseId\) \{/);
  assert.match(fnBody, /convertLeadCore\(agencyId, lead\.id, \{ actorId: lead\.ownerUserId \}\)\.catch/);
  // Fired after updates.push(updated) — i.e. after the payment-status
  // transaction above it has already committed, not nested inside it.
  const triggerIndex = fnBody.indexOf("if (ready && lead.earlyClientId");
  const pushIndex = fnBody.indexOf("updates.push(updated);");
  assert.ok(pushIndex !== -1 && triggerIndex > pushIndex, "auto-conversion must fire after the payment-status transaction commits, not inside it");
});
