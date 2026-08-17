import assert from "node:assert/strict";
import test from "node:test";
import {
  expandedSchedulingBlocks,
  parseSchedulingBlockDateTime,
  schedulingBlockRecurrenceDays,
  schedulingBlockRecurrenceEnd,
} from "../src/services/bookingAvailabilityService.js";

const TORONTO = "America/Toronto";

test("scheduling block form values are interpreted in the configured timezone", () => {
  assert.equal(parseSchedulingBlockDateTime("2026-08-17T15:00", TORONTO).toISOString(), "2026-08-17T19:00:00.000Z");
  assert.equal(parseSchedulingBlockDateTime("2026-12-17T15:00", TORONTO).toISOString(), "2026-12-17T20:00:00.000Z");
  assert.equal(parseSchedulingBlockDateTime("2026-08-17T19:00:00.000Z", TORONTO).toISOString(), "2026-08-17T19:00:00.000Z");
});

test("repeat-until dates include the selected local calendar day", () => {
  const startsAt = parseSchedulingBlockDateTime("2026-08-17T15:00", TORONTO);
  assert.equal(schedulingBlockRecurrenceEnd("2026-12-31", TORONTO).toISOString(), "2027-01-01T05:00:00.000Z");
  assert.equal(schedulingBlockRecurrenceDays(startsAt, "2026-12-31", TORONTO), 136);
});

test("daily recurring blocks preserve local wall time across daylight saving changes", () => {
  const startsAt = parseSchedulingBlockDateTime("2026-10-31T15:00", TORONTO);
  const endsAt = parseSchedulingBlockDateTime("2026-10-31T16:00", TORONTO);
  const occurrences = expandedSchedulingBlocks(
    [{ userId: "staff-1", startsAt, endsAt, recurrence: "DAILY", recurrenceUntil: schedulingBlockRecurrenceEnd("2026-11-02", TORONTO) }],
    new Date("2026-10-30T00:00:00.000Z"),
    new Date("2026-11-04T00:00:00.000Z"),
    TORONTO,
  );

  assert.deepEqual(
    occurrences.map((item) => [item.startsAt.toISOString(), item.endsAt.toISOString()]),
    [
      ["2026-10-31T19:00:00.000Z", "2026-10-31T20:00:00.000Z"],
      ["2026-11-01T20:00:00.000Z", "2026-11-01T21:00:00.000Z"],
      ["2026-11-02T20:00:00.000Z", "2026-11-02T21:00:00.000Z"],
    ],
  );
});
