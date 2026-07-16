import assert from "node:assert/strict";
import test from "node:test";
import { normalizeEmail, normalizePhone, parseCommercialStatus, parseCreateConsultation, parseCreateLead, parseLeadConversion, parseLeadListQuery, parseLeadQualification, parseUpdateConsultation } from "../src/modules/leads/lead.validation.js";

test("lead input normalizes email and common phone formatting", () => {
  assert.equal(normalizeEmail("  Person@Example.CA "), "person@example.ca");
  assert.equal(normalizePhone("+1 (416) 555-0100"), "+14165550100");
});

test("an open lead requires an owner, source, and next action", () => {
  assert.throws(() => parseCreateLead({ phone: "+14165550100" }), /ownerUserId is required/);
  assert.throws(() => parseCreateLead({ phone: "+14165550100", ownerUserId: "user-1" }), /originalSourceId is required/);
  assert.throws(() => parseCreateLead({ phone: "+14165550100", ownerUserId: "user-1", originalSourceId: "source-1" }), /nextActionDescription is required/);
});

test("valid intake produces canonical foundation values", () => {
  const result = parseCreateLead({ phone: "+1 416 555 0100", ownerUserId: "user-1", originalSourceId: "source-1", nextActionType: "CALL", nextActionDescription: "Call the lead", nextActionAt: "2026-07-15T14:00:00Z" });
  assert.equal(result.phoneNormalized, "+14165550100");
  assert.equal(result.priority, "NORMAL");
  assert.equal(result.temperature, "COLD");
  assert.equal(result.nextActionOwnerId, "user-1");
});

test("lead list query accepts only supported filters and sorting", () => {
  assert.deepEqual(parseLeadListQuery({ page: "2", limit: "500", status: "OPEN", sortBy: "nextActionAt", sortDirection: "asc" }), {
    page: 2, limit: 100, status: "OPEN", stage: null, sortBy: "nextActionAt", sortDirection: "asc", search: "", sourceId: null,
  });
  assert.throws(() => parseLeadListQuery({ status: "UNKNOWN" }), /status is invalid/);
});

test("qualification validates outcome, confidence, and required explanation", () => {
  const result = parseLeadQualification({ immigrationService: "Study Permit", outcome: "QUALIFIED", eligibilityConfidence: 80, previousRefusals: false });
  assert.equal(result.outcome, "QUALIFIED");
  assert.equal(result.eligibilityConfidence, 80);
  assert.equal(result.previousRefusals, false);
  assert.throws(() => parseLeadQualification({ immigrationService: "Study Permit", outcome: "NOT_ELIGIBLE" }), /notes are required/);
  assert.throws(() => parseLeadQualification({ immigrationService: "Study Permit", outcome: "QUALIFIED", eligibilityConfidence: 101 }), /eligibilityConfidence is invalid/);
});

test("consultation validation enforces time ranges and completed outcomes", () => {
  const booking = parseCreateConsultation({ consultantUserId: "user-1", startAt: "2026-08-01T14:00:00Z", endAt: "2026-08-01T15:00:00Z", appointmentType: "VIDEO", meetingUrl: "https://meet.example.ca/room" });
  assert.equal(booking.appointmentType, "VIDEO");
  assert.equal(booking.paymentStatus, "UNPAID");
  assert.throws(() => parseCreateConsultation({ consultantUserId: "user-1", startAt: "2026-08-01T15:00:00Z", endAt: "2026-08-01T14:00:00Z", appointmentType: "VIDEO" }), /endAt must be later/);
  assert.throws(() => parseUpdateConsultation({ status: "COMPLETED" }), /outcome is required/);
  assert.equal(parseUpdateConsultation({ status: "COMPLETED", outcome: "READY_TO_PROCEED" }).outcome, "READY_TO_PROCEED");
});

test("commercial tracking accepts supported retainer and payment states", () => {
  assert.deepEqual(parseCommercialStatus({ retainerStatus: "SIGNED", initialPaymentStatus: "PAID", notes: "Received" }), { retainerStatus: "SIGNED", initialPaymentStatus: "PAID", notes: "Received" });
  assert.throws(() => parseCommercialStatus({}), /status is required/);
  assert.throws(() => parseCommercialStatus({ retainerStatus: "UNKNOWN" }), /retainerStatus is invalid/);
});

test("conversion requires a client identity, case type, and first action", () => {
  const conversion = parseLeadConversion({ fullName: "Avery Singh", caseType: "Work Permit", caseNextAction: "Collect identity documents", actualValue: 3200 });
  assert.equal(conversion.caseStage, "Intake");
  assert.equal(conversion.actualValue, 3200);
  assert.throws(() => parseLeadConversion({ caseType: "Work Permit", caseNextAction: "Collect documents" }), /fullName is required/);
  assert.throws(() => parseLeadConversion({ fullName: "Avery Singh", caseType: "Work Permit" }), /caseNextAction is required/);
});
