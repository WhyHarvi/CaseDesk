import test from "node:test";
import assert from "node:assert/strict";
import {
  AUTOMATED_REMINDER_DEFAULTS,
  effectiveReminderDueAt,
  fillAutomatedReminderTemplate,
  renderAutomatedReminderPreview,
} from "../src/services/automatedReminderService.js";

test("automated reminder templates replace supported placeholders", () => {
  assert.equal(
    fillAutomatedReminderTemplate("Hello {{ clientName }}, reminder {{reminderNumber}}.", { clientName: "Alex", reminderNumber: 2 }),
    "Hello Alex, reminder 2.",
  );
});

test("effective due date preserves an explicit due date", () => {
  const explicit = new Date("2026-09-01T12:00:00.000Z");
  assert.equal(effectiveReminderDueAt(explicit, new Date("2026-07-01T12:00:00.000Z"), 30).toISOString(), explicit.toISOString());
});

test("effective due date falls back to the configured number of days", () => {
  assert.equal(
    effectiveReminderDueAt(null, new Date("2026-07-01T12:00:00.000Z"), 30).toISOString(),
    "2026-07-31T12:00:00.000Z",
  );
});

test("preview renders human-readable sample content", () => {
  const preview = renderAutomatedReminderPreview({
    kind: "Agreement",
    maxReminders: 3,
    ...AUTOMATED_REMINDER_DEFAULTS.Agreement,
  }, "North Star Immigration");
  assert.match(preview.subject, /Immigration Service Agreement/);
  assert.match(preview.message, /Alex Morgan/);
  assert.match(preview.message, /North Star Immigration/);
  assert.doesNotMatch(preview.message, /\{\{/);
});
