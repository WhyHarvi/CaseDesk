import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  qualificationWorkflow,
  recordLeadActivity,
  updateConsultation,
  updateLeadDetails,
} from "../src/modules/leads/lead.service.js";
import { reactivateDueNurtureLeads } from "../src/modules/leads/lead.reactivation.worker.js";
import { parseCommercialStatus } from "../src/modules/leads/lead.validation.js";

const source = (relativePath) => readFile(new URL(relativePath, import.meta.url), "utf8");

test("every qualification outcome produces an explicit next action", () => {
  const expected = {
    QUALIFIED: ["QUALIFIED", "BOOK_CONSULTATION"],
    CONSULTATION_REQUIRED: [null, "BOOK_CONSULTATION"],
    MORE_INFORMATION_REQUIRED: [null, "FOLLOW_UP"],
    NOT_ELIGIBLE: [null, "MARK_LOST"],
    FUTURE_OPPORTUNITY: [null, "NURTURE"],
    SERVICE_NOT_OFFERED: [null, "MARK_LOST"],
  };
  for (const [outcome, [stage, type]] of Object.entries(expected)) {
    const workflow = qualificationWorkflow(outcome);
    assert.equal(workflow.stage, stage);
    assert.equal(workflow.type, type);
    assert.ok(workflow.description);
    assert.ok(workflow.at instanceof Date);
  }
});

test("completing a consultation maps every outcome to the correct stage and replaces stale work", async () => {
  const expectedStages = {
    READY_TO_PROCEED: "RETAINER_PENDING",
    AGREEMENT_REQUIRED: "RETAINER_PENDING",
    PAYMENT_REQUIRED: "PAYMENT_PENDING",
    FOLLOW_UP_REQUIRED: "CONSULTATION_COMPLETED",
    NOT_ELIGIBLE: "CONSULTATION_COMPLETED",
    NOT_INTERESTED: "CONSULTATION_COMPLETED",
    FUTURE_OPPORTUNITY: "CONSULTATION_COMPLETED",
    LOST: "CONSULTATION_COMPLETED",
  };

  for (const [outcome, expectedStage] of Object.entries(expectedStages)) {
    const calls = [];
    const existing = {
      id: "consultation-1",
      appointmentId: null,
      consultantUserId: "consultant-1",
      startAt: new Date("2026-08-10T14:00:00.000Z"),
      status: "SCHEDULED",
    };
    const tx = {
      lead: {
        findFirst: async () => ({ id: "lead-1", leadNumber: "LD-1", status: "OPEN", stage: "CONSULTATION_BOOKED" }),
        update: async ({ data }) => calls.push(["lead", data]),
      },
      leadConsultation: {
        findFirst: async () => existing,
        update: async ({ data }) => ({ ...existing, ...data }),
      },
      leadStageHistory: { create: async ({ data }) => calls.push(["stage", data]) },
      leadFollowUp: {
        updateMany: async ({ data }) => calls.push(["superseded", data]),
        create: async ({ data }) => calls.push(["followUp", data]),
      },
      leadActivity: { create: async ({ data }) => calls.push(["activity", data]) },
      activityLog: { create: async ({ data }) => calls.push(["audit", data]) },
    };
    const db = { $transaction: async (operation) => operation(tx) };
    await updateConsultation({
      auth: { agencyId: "agency-1", userId: "consultant-1", role: "consultant" },
      params: { id: "lead-1", consultationId: "consultation-1" },
      body: { status: "COMPLETED", outcome, notes: "Outcome recorded." },
    }, db);

    assert.equal(calls.find(([kind]) => kind === "lead")[1].stage, expectedStage);
    assert.equal(calls.filter(([kind]) => kind === "superseded").length, 1);
    assert.equal(calls.filter(([kind]) => kind === "followUp").length, 1);
  }
});

test("a connected activity records the first connection once and advances the lead", async () => {
  async function record(firstConnectedAt, occurredAt) {
    let update;
    const tx = {
      lead: {
        findFirst: async () => ({ id: "lead-1", leadNumber: "LD-1", status: "OPEN", stage: "CONTACTING", firstContactAt: new Date("2026-08-01T12:00:00.000Z"), firstConnectedAt }),
        update: async ({ data }) => { update = data; },
      },
      leadActivity: { create: async ({ data }) => ({ id: "activity-1", ...data }) },
      leadStageHistory: { create: async () => {} },
      activityLog: { create: async () => {} },
    };
    await recordLeadActivity({
      auth: { agencyId: "agency-1", userId: "consultant-1", role: "consultant" },
      params: { id: "lead-1" },
      body: { activityType: "OUTGOING_CALL", direction: "OUTBOUND", channel: "PHONE", title: "Spoke with lead", occurredAt, connected: true },
    }, { $transaction: async (operation) => operation(tx) });
    return update;
  }

  const firstAt = "2026-08-02T15:00:00.000Z";
  const first = await record(null, firstAt);
  assert.equal(first.stage, "CONNECTED");
  assert.equal(first.firstConnectedAt.toISOString(), firstAt);

  const original = new Date(firstAt);
  const second = await record(original, "2026-08-03T15:00:00.000Z");
  assert.equal(second.firstConnectedAt, original);
});

test("due nurture leads automatically reopen and close their reactivation work", async () => {
  const calls = [];
  const now = new Date("2026-08-06T16:00:00.000Z");
  const tx = {
    lead: { updateMany: async ({ data }) => { calls.push(["lead", data]); return { count: 1 }; } },
    leadFollowUp: { updateMany: async ({ data }) => calls.push(["followUp", data]) },
    leadActivity: { create: async ({ data }) => calls.push(["activity", data]) },
  };
  const db = {
    lead: { findMany: async () => [{ id: "lead-1", agencyId: "agency-1", leadNumber: "LD-1" }] },
    $transaction: async (operation) => operation(tx),
  };

  const result = await reactivateDueNurtureLeads(db, now);
  assert.deepEqual(result, { checked: 1, reactivated: 1 });
  assert.equal(calls.find(([kind]) => kind === "lead")[1].status, "OPEN");
  assert.equal(calls.find(([kind]) => kind === "followUp")[1].completionOutcome, "Automatically reactivated");
  assert.equal(calls.find(([kind]) => kind === "activity")[1].activityType, "LEAD_REACTIVATED");
});

test("sensitive commercial states require evidence and converted leads reject independent edits", async () => {
  assert.throws(
    () => parseCommercialStatus({ retainerStatus: "SIGNED" }),
    (error) => error.code === "VALIDATION_ERROR",
  );
  assert.equal(parseCommercialStatus({ initialPaymentStatus: "PAID", notes: "Invoice QB-104 paid." }).notes, "Invoice QB-104 paid.");

  const db = {
    $transaction: async (operation) => operation({
      lead: { findFirst: async () => ({ id: "lead-1", status: "CONVERTED" }) },
    }),
  };
  await assert.rejects(
    () => updateLeadDetails({
      auth: { agencyId: "agency-1", userId: "admin-1", role: "admin" },
      params: { id: "lead-1" },
      body: { preferredContactTime: "Weekday afternoons" },
    }, db),
    (error) => error.code === "LEAD_CONVERTED",
  );
});

test("the lead UI exposes completion, duplicate resolution, and real availability instead of dead ends", async () => {
  const [routes, completeSheet, bookingSheet, duplicateSheet] = await Promise.all([
    source("../src/modules/leads/lead.routes.js"),
    source("../../frontend/src/modules/leads/components/CompleteConsultationSheet.jsx"),
    source("../../frontend/src/modules/leads/components/BookConsultationSheet.jsx"),
    source("../../frontend/src/modules/leads/components/DuplicateReviewSheet.jsx"),
  ]);
  assert.match(routes, /intake\/events\/:eventId\/duplicates/);
  assert.match(routes, /\/:id\/reactivate/);
  assert.match(completeSheet, /status === "COMPLETED" && !form\.outcome/);
  assert.match(bookingSheet, /\/booking\/availability/);
  assert.match(bookingSheet, /!form\.startAt \|\| !form\.endAt/);
  assert.match(duplicateSheet, /Link to this lead/);
  assert.match(duplicateSheet, /Create as a new lead anyway/);
});
