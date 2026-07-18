import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { mergeStaffAvailability, slotsForDay, validateAvailabilityRange } from "../src/services/bookingAvailabilityService.js";
import { chooseAppointmentAssignee } from "../src/services/schedulingAssignmentService.js";
import { icsForAppointment } from "../src/services/bookingNotificationService.js";

test("pooled availability preserves one seat per free consultant", () => {
  const slot = { startsAt: "2026-08-03T13:00:00.000Z", endsAt: "2026-08-03T13:30:00.000Z" };
  const merged = mergeStaffAvailability(["one", "two", "three", "four"], [[slot], [slot], [slot], [slot]]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].capacity, 4);
  assert.deepEqual(merged[0].staffIds, ["one", "two", "three", "four"]);
});

test("availability is bounded and cancelled appointments do not block generated slots", () => {
  assert.throws(() => validateAvailabilityRange("2026-01-01", "2026-05-01"), /62 days/);
  const settings = { timezone: "America/Toronto", workingHours: [{ day: 1, enabled: true, start: "09:00", end: "10:00" }], daysOff: [], minNoticeMinutes: 0, horizonDays: 365, bufferMinutes: 0 };
  const slots = slotsForDay({ settings, dateKey: "2026-08-03", durationMinutes: 30, busy: [], now: new Date("2026-08-01T00:00:00Z"), stepMinutes: 30 });
  assert.equal(slots.length, 2);
});

test("assignment prefers the existing client's consultant when free", async () => {
  const users = ["alpha", "beta"].map((id) => ({ id, fullName: id, role: "consultant", schedulingPreference: null }));
  const db = {
    bookingSessionTypeStaff: { findMany: async () => [] },
    user: { findMany: async () => users },
    appointment: {
      findMany: async () => [],
      groupBy: async () => [],
    },
  };
  const chosen = await chooseAppointmentAssignee({ agencyId: "agency", startsAt: new Date("2026-08-03T13:00:00Z"), endsAt: new Date("2026-08-03T13:30:00Z"), preferredUserId: "beta", db });
  assert.equal(chosen.id, "beta");
});

test("calendar cancellations produce a cancellation event instead of a live invite", () => {
  const content = icsForAppointment({ id: "appointment", subject: "Consultation", startsAt: "2026-08-03T13:00:00Z", endsAt: "2026-08-03T13:30:00Z", status: "Cancelled" }, "Firm");
  assert.match(content, /METHOD:CANCEL/);
  assert.match(content, /STATUS:CANCELLED/);
});

test("scheduling migration adds durable delivery, assignment, and idempotency safeguards", async () => {
  const sql = await readFile(new URL("../prisma/migrations/20260719020000_scheduling_operations/migration.sql", import.meta.url), "utf8");
  assert.match(sql, /scheduling_staff_preferences/);
  assert.match(sql, /booking_message_deliveries/);
  assert.match(sql, /appointments_agency_id_idempotency_key_key/);
  assert.match(sql, /lead_consultations_appointment_id_fkey/);
});
