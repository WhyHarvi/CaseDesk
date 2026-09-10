import assert from "node:assert/strict";
import test from "node:test";
import { consultationDisplayState, featuredConsultation } from "../../frontend/src/modules/leads/consultationPresentation.js";

const now = new Date("2026-09-10T14:00:00.000Z");

test("future consultation status is explicitly upcoming and cannot record an outcome", () => {
  const state = consultationDisplayState({
    status: "SCHEDULED",
    startAt: "2026-09-10T15:00:00.000Z",
    endAt: "2026-09-10T16:00:00.000Z",
  }, now);

  assert.equal(state.label, "Upcoming");
  assert.equal(state.timingPrefix, "Starts");
  assert.equal(state.canRecordOutcome, false);
});

test("future time wins over an inconsistent saved completed status", () => {
  const state = consultationDisplayState({
    status: "COMPLETED",
    startAt: "2026-09-10T15:00:00.000Z",
    endAt: "2026-09-10T16:00:00.000Z",
  }, now);

  assert.equal(state.label, "Upcoming");
  assert.match(state.description, /has not happened yet/i);
  assert.equal(state.canRecordOutcome, false);
});

test("started and elapsed consultations get distinct operational statuses", () => {
  const inProgress = consultationDisplayState({
    status: "CONFIRMED",
    startAt: "2026-09-10T13:30:00.000Z",
    endAt: "2026-09-10T14:30:00.000Z",
  }, now);
  const awaiting = consultationDisplayState({
    status: "SCHEDULED",
    startAt: "2026-09-10T12:00:00.000Z",
    endAt: "2026-09-10T13:00:00.000Z",
  }, now);

  assert.equal(inProgress.label, "In progress");
  assert.equal(inProgress.canRecordOutcome, true);
  assert.equal(awaiting.label, "Awaiting outcome");
  assert.equal(awaiting.canRecordOutcome, true);
});

test("overview highlights a current consultation, then the nearest upcoming one", () => {
  const consultations = [
    { id: "past", status: "SCHEDULED", startAt: "2026-09-10T10:00:00.000Z", endAt: "2026-09-10T11:00:00.000Z" },
    { id: "later", status: "SCHEDULED", startAt: "2026-09-12T15:00:00.000Z", endAt: "2026-09-12T16:00:00.000Z" },
    { id: "next", status: "CONFIRMED", startAt: "2026-09-11T15:00:00.000Z", endAt: "2026-09-11T16:00:00.000Z" },
  ];

  assert.equal(featuredConsultation(consultations, now).id, "next");
  assert.equal(featuredConsultation([
    ...consultations,
    { id: "current", status: "CONFIRMED", startAt: "2026-09-10T13:30:00.000Z", endAt: "2026-09-10T14:30:00.000Z" },
  ], now).id, "current");
});

test("overview surfaces a future consultation even when legacy data says completed", () => {
  const result = featuredConsultation([
    { id: "old-awaiting", status: "SCHEDULED", startAt: "2026-09-09T10:00:00.000Z", endAt: "2026-09-09T11:00:00.000Z" },
    { id: "bad-future", status: "COMPLETED", startAt: "2026-09-11T15:00:00.000Z", endAt: "2026-09-11T16:00:00.000Z" },
  ], now);

  assert.equal(result.id, "bad-future");
  assert.equal(consultationDisplayState(result, now).label, "Upcoming");
});
