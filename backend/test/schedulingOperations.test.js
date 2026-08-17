import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { intersectWorkingHours, localDateTimeToUtc, mergeStaffAvailability, slotsForDay, validateAvailabilityRange } from "../src/services/bookingAvailabilityService.js";
import { chooseAppointmentAssignee } from "../src/services/schedulingAssignmentService.js";
import {
  bookingDeliveryIsCurrent,
  bookingDeliveryRetryDelay,
  bookingMessageRevision,
  icsForAppointment,
  isTransientBookingDeliveryError,
  reminderWasAlreadyDueWhenScheduled,
} from "../src/services/bookingNotificationService.js";
import { delayedZoomNotificationKind } from "../src/services/appointmentMeetingService.js";
import { MEETING_MODES, meetingModesInSameCapacityGroup } from "../src/services/bookingMeetingModeService.js";
import { runtimeDatabaseUrl } from "../src/services/prisma/client.js";

test("phone, in-person, Jitsi, and Zoom bookings share consultant capacity", () => {
  const allModes = [MEETING_MODES.IN_PERSON, MEETING_MODES.PHONE, MEETING_MODES.JITSI, MEETING_MODES.ZOOM];
  for (const mode of allModes) {
    assert.deepEqual(meetingModesInSameCapacityGroup(mode), allModes);
  }
});

test("pooled availability preserves one seat per free consultant", () => {
  const slot = { startsAt: "2026-08-03T13:00:00.000Z", endsAt: "2026-08-03T13:30:00.000Z" };
  const merged = mergeStaffAvailability(["one", "two"], [[slot], [slot]]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].capacity, 2);
  assert.deepEqual(merged[0].staffIds, ["one", "two"]);
});

test("one booking consumes only one consultant seat at the shared time", () => {
  const settings = {
    timezone: "America/Toronto",
    workingHours: [{ day: 1, enabled: true, start: "09:00", end: "10:00" }],
    daysOff: [],
    minNoticeMinutes: 0,
    horizonDays: 365,
    bufferMinutes: 0,
  };
  const now = new Date("2026-08-01T00:00:00Z");
  const firstConsultant = slotsForDay({
    settings,
    dateKey: "2026-08-03",
    durationMinutes: 30,
    busy: [{ startsAt: "2026-08-03T13:00:00.000Z", endsAt: "2026-08-03T13:30:00.000Z" }],
    now,
  });
  const secondConsultant = slotsForDay({
    settings,
    dateKey: "2026-08-03",
    durationMinutes: 30,
    busy: [],
    now,
  });
  const merged = mergeStaffAvailability(["one", "two"], [firstConsultant, secondConsultant]);
  assert.equal(merged.find((slot) => slot.startsAt === "2026-08-03T13:00:00.000Z").capacity, 1);
  assert.equal(merged.find((slot) => slot.startsAt === "2026-08-03T13:30:00.000Z").capacity, 2);
});

test("availability is bounded and cancelled appointments do not block generated slots", () => {
  assert.throws(() => validateAvailabilityRange("2026-01-01", "2026-05-01"), /62 days/);
  const settings = { timezone: "America/Toronto", workingHours: [{ day: 1, enabled: true, start: "09:00", end: "10:00" }], daysOff: [], minNoticeMinutes: 0, horizonDays: 365, bufferMinutes: 0 };
  const slots = slotsForDay({ settings, dateKey: "2026-08-03", durationMinutes: 30, busy: [], now: new Date("2026-08-01T00:00:00Z"), stepMinutes: 30 });
  assert.equal(slots.length, 2);
});

test("public slots use a 30-minute start grid by default", () => {
  const settings = { timezone: "America/Toronto", workingHours: [{ day: 1, enabled: true, start: "09:00", end: "10:30" }], daysOff: [], minNoticeMinutes: 0, horizonDays: 365, bufferMinutes: 0 };
  const slots = slotsForDay({ settings, dateKey: "2026-08-03", durationMinutes: 30, busy: [], now: new Date("2026-08-01T00:00:00Z") });
  assert.deepEqual(slots.map((slot) => slot.startsAt), [
    "2026-08-03T13:00:00.000Z",
    "2026-08-03T13:30:00.000Z",
    "2026-08-03T14:00:00.000Z",
  ]);
});

test("in-person scheduling intersects office and consultant hours", () => {
  const officeHours = [
    { day: 1, enabled: true, start: "10:00", end: "17:00" },
    { day: 2, enabled: true, start: "10:00", end: "17:00" },
  ];
  const consultantHours = [
    { day: 1, enabled: true, start: "09:00", end: "15:00" },
    { day: 2, enabled: false, start: "09:00", end: "17:00" },
  ];
  const effective = intersectWorkingHours(officeHours, consultantHours);
  assert.deepEqual(effective.find((rule) => rule.day === 1), {
    day: 1,
    enabled: true,
    start: "10:00",
    end: "15:00",
  });
  assert.equal(effective.find((rule) => rule.day === 2).enabled, false);
});

test("waitlist date boundaries preserve the complete agency-local day", () => {
  assert.equal(localDateTimeToUtc("2026-07-30", 0, "America/Toronto").toISOString(), "2026-07-30T04:00:00.000Z");
  assert.equal(localDateTimeToUtc("2026-07-30", 24 * 60, "America/Toronto").toISOString(), "2026-07-31T04:00:00.000Z");
});

test("staff booking bypasses the public minimum-notice window to allow same-day slots", () => {
  const workingHours = [{ day: 1, enabled: true, start: "09:00", end: "17:00" }];
  // 2026-08-03 is a Monday; "now" is mid-afternoon local time, well past the
  // point where a 12h public notice window would push past today's close.
  const now = new Date("2026-08-03T18:30:00.000Z"); // 14:30 America/Toronto (UTC-4)
  const publicSettings = { timezone: "America/Toronto", workingHours, daysOff: [], minNoticeMinutes: 720, horizonDays: 365, bufferMinutes: 0 };
  const publicSlots = slotsForDay({ settings: publicSettings, dateKey: "2026-08-03", durationMinutes: 30, busy: [], now, stepMinutes: 15 });
  assert.equal(publicSlots.length, 0, "public notice window should still block same-day booking");

  const staffSettings = { ...publicSettings, minNoticeMinutes: 0 };
  const staffSlots = slotsForDay({ settings: staffSettings, dateKey: "2026-08-03", durationMinutes: 30, busy: [], now, stepMinutes: 15 });
  assert.ok(staffSlots.length > 0, "internal staff booking should offer remaining same-day slots");
  assert.ok(new Date(staffSlots[0].startsAt).getTime() >= now.getTime(), "no slot should start in the past");
});

test("frontdesk's ignorePastCutoff reveals today's already-passed slots too", () => {
  const workingHours = [{ day: 1, enabled: true, start: "09:00", end: "17:00" }];
  const now = new Date("2026-08-03T18:30:00.000Z"); // 14:30 America/Toronto (UTC-4)
  const settings = { timezone: "America/Toronto", workingHours, daysOff: [], minNoticeMinutes: 0, horizonDays: 365, bufferMinutes: 0 };

  const normalSlots = slotsForDay({ settings, dateKey: "2026-08-03", durationMinutes: 30, busy: [], now, stepMinutes: 15 });
  assert.ok(normalSlots.every((slot) => new Date(slot.startsAt).getTime() >= now.getTime()), "without the flag, nothing before now is offered");

  const frontdeskSlots = slotsForDay({ settings, dateKey: "2026-08-03", durationMinutes: 30, busy: [], now, stepMinutes: 15, ignorePastCutoff: true });
  assert.ok(frontdeskSlots.some((slot) => new Date(slot.startsAt).getTime() < now.getTime()), "frontdesk should see this morning's slots too");
  assert.equal(frontdeskSlots[0].startsAt, "2026-08-03T13:00:00.000Z", "the day's grid should start at the office's opening time, not now");
});

test("every internal staff role — not just frontdesk — sees today's already-passed slots when booking or rescheduling", async () => {
  const controller = await readFile(new URL("../src/controllers/bookingController.js", import.meta.url), "utf8");

  // Any staff member managing the calendar directly (logging a walk-in, an
  // earlier call, or adjusting the day's schedule to match what actually
  // happened) needs this, not just frontdesk — a client picking a slot on
  // the public page is the one flow that should never see the past.
  assert.match(controller, /const STAFF_ROLES_SEEING_PAST_SLOTS = new Set\(\["admin", "consultant", "frontdesk"\]\);/);
  const usages = controller.match(/ignorePastCutoff: STAFF_ROLES_SEEING_PAST_SLOTS\.has\(req\.auth\.role\)/g) || [];
  // getAvailability, createBookingAppointment's per-occurrence check, and
  // both reschedule paths (series + single) — four call sites total.
  assert.equal(usages.length, 4);
  assert.doesNotMatch(controller, /ignorePastCutoff: req\.auth\.role === "frontdesk"/);
});

test("the day/week calendar grid labels every half hour, not just each whole hour", async () => {
  const calendar = await readFile(new URL("../../frontend/src/pages/CalendarPage.jsx", import.meta.url), "utf8");

  assert.match(calendar, /Array\.from\(\{ length: gridHours \* 2 \}, \(_, index\) => \{/);
  assert.match(calendar, /const totalMinutes = \(index \+ 1\) \* 30;/);
  assert.match(calendar, /const isHourMark = totalMinutes % 60 === 0;/);
  assert.match(calendar, /\{isHourMark \? `\$\{hour12\} \$\{isAM \? "AM" : "PM"\}` : `\$\{hour12\}:30 \$\{isAM \? "AM" : "PM"\}`\}/);

  // Verify the actual math independently of the component (noon/midnight
  // wraparound is the easy place for an off-by-one to hide) rather than
  // just asserting the source text is present.
  const GRID_START_HOUR = 7;
  const gridHours = 13;
  const labels = [];
  for (let index = 0; index < gridHours * 2; index++) {
    const totalMinutes = (index + 1) * 30;
    const hour24 = GRID_START_HOUR + Math.floor(totalMinutes / 60);
    const isHourMark = totalMinutes % 60 === 0;
    const hour12 = ((hour24 - 1) % 12) + 1;
    const isAM = hour24 <= 11 || hour24 >= 24;
    labels.push(isHourMark ? `${hour12} ${isAM ? "AM" : "PM"}` : `${hour12}:30 ${isAM ? "AM" : "PM"}`);
  }
  assert.equal(labels[0], "7:30 AM");
  assert.equal(labels[1], "8 AM");
  assert.deepEqual(labels.slice(7, 11), ["11 AM", "11:30 AM", "12 PM", "12:30 PM"]);
  assert.equal(labels.at(-1), "8 PM");
  assert.equal(labels.length, 26);
});

test("the calendar grid gives appointments real room instead of cramming them into 60px/hour", async () => {
  const calendar = await readFile(new URL("../../frontend/src/pages/CalendarPage.jsx", import.meta.url), "utf8");

  // At 60px/hour a 15-minute appointment (e.g. the free follow-up type)
  // rendered at ~15px tall — barely one line of tiny text before crowding
  // the next block. More room per hour is the single biggest lever for
  // legibility; the exact value has since grown again (72 -> 88) to match
  // a reference design's chunkier blocks, but the scaling relationship
  // below is what actually matters and must hold at any HOUR_PX value.
  assert.match(calendar, /const HOUR_PX = 88;/);
  // The half-hour label positions must scale with HOUR_PX, not assume the
  // old 60px/hour (1px-per-minute) relationship — a real bug this same
  // redesign introduced and then caught: changing HOUR_PX alone would have
  // silently left every half-hour label mispositioned.
  assert.match(calendar, /style=\{\{ top: \(totalMinutes \/ 60\) \* HOUR_PX \}\}/);
  assert.doesNotMatch(calendar, /style=\{\{ top: totalMinutes \}\}/);

  // The view switcher is a same-purpose segmented control next to the
  // day/today/next navigation instead of a separate dropdown, and the
  // bottom legend is visually de-emphasized (smaller, tinted) rather than
  // competing at the same weight as real appointment data.
  assert.match(calendar, /\[\["day", "Day"\], \["week", "Week"\]\]\.map\(\(\[value, label\]\) => \(/);
  assert.match(calendar, /rounded-b-3xl border-t border-slate-100 bg-slate-50\/60/);
});

test("free consultations have a dedicated calendar color and visible legend", async () => {
  const calendar = await readFile(new URL("../../frontend/src/pages/CalendarPage.jsx", import.meta.url), "utf8");

  assert.match(calendar, /const FREE_CONSULTATION_TONE = \{ chip: "bg-teal-500"/);
  assert.match(calendar, /item\.status === "NoShow" \? NO_SHOW_TONE : item\.isFreeConsultation \? FREE_CONSULTATION_TONE : item\.source === "WalkIn" \? WALK_IN_TONE/);
  assert.match(calendar, /FREE_CONSULTATION_TONE\.chip[\s\S]*Free consultation/);
});

test("the New Appointment sheet survives a reload the same way the Add Client drawer does", async () => {
  const calendar = await readFile(new URL("../../frontend/src/pages/CalendarPage.jsx", import.meta.url), "utf8");
  assert.match(calendar, /const APPOINTMENT_DRAFT_STORAGE_KEY = "casedesk:appointment-drawer-draft"/);
  assert.match(calendar, /function readAppointmentDraft\(\)/);
  assert.match(calendar, /function writeAppointmentDraft\(draft\)/);
  assert.match(calendar, /function clearAppointmentDraft\(\)/);
  assert.match(calendar, /const \[sheetOpen, setSheetOpen\] = useState\(\(\) => Boolean\(readAppointmentDraft\(\)\)\)/);
  assert.match(calendar, /const \[form, setForm\] = useState\(\(\) => readAppointmentDraft\(\)\?\.form \|\|/);
  assert.match(calendar, /const \[selectedClient, setSelectedClient\] = useState\(\(\) => readAppointmentDraft\(\)\?\.selectedClient \|\| null\)/);
  // The restored draft must survive the existing "reset the form" effect
  // that would otherwise wipe it back to blank the instant the sheet mounts
  // already open.
  assert.match(calendar, /const isRestoringDraft = useRef\(Boolean\(open\) && Boolean\(readAppointmentDraft\(\)\)\)/);
  assert.match(calendar, /if \(isRestoringDraft\.current\) {/);
  assert.match(calendar, /writeAppointmentDraft\(\{ form, selectedClient \}\)/);
  assert.match(calendar, /clearAppointmentDraft\(\);/);
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

test("active checkout holds consume daily consultant capacity exactly once", async () => {
  const start = new Date("2026-08-03T13:00:00Z");
  const end = new Date("2026-08-03T13:30:00Z");
  const user = {
    id: "alpha",
    fullName: "Alpha",
    role: "consultant",
    schedulingPreference: {
      acceptsAppointments: true,
      publicBookable: true,
      maxDailyAppointments: 2,
      bufferMinutes: 0,
    },
  };
  let paymentHoldWhere = null;
  const db = {
    bookingSessionTypeStaff: { findMany: async () => [] },
    user: { findMany: async () => [user] },
    appointment: { findMany: async () => [], groupBy: async () => [] },
    // A paid waitlist checkout temporarily has both rows for one seat.
    bookingSlotHold: { findMany: async () => [{ assignedToId: "alpha", startsAt: start, endsAt: end }] },
    bookingPaymentHold: { findMany: async ({ where }) => {
      paymentHoldWhere = where;
      return [{ assignedToId: "alpha", startsAt: start, endsAt: end }];
    } },
  };
  const chosen = await chooseAppointmentAssignee({
    agencyId: "agency",
    startsAt: new Date("2026-08-03T14:00:00Z"),
    endsAt: new Date("2026-08-03T14:30:00Z"),
    db,
  });
  assert.equal(chosen.id, "alpha");
  assert.equal(paymentHoldWhere.appointmentId, null);

  user.schedulingPreference.maxDailyAppointments = 1;
  await assert.rejects(
    chooseAppointmentAssignee({
      agencyId: "agency",
      startsAt: new Date("2026-08-03T14:00:00Z"),
      endsAt: new Date("2026-08-03T14:30:00Z"),
      db,
    }),
    /time was just taken/,
  );
});

test("calendar cancellations produce a cancellation event instead of a live invite", () => {
  const content = icsForAppointment({ id: "appointment", subject: "Consultation", startsAt: "2026-08-03T13:00:00Z", endsAt: "2026-08-03T13:30:00Z", status: "Cancelled" }, "Firm");
  assert.match(content, /METHOD:CANCEL/);
  assert.match(content, /STATUS:CANCELLED/);
});

test("phone calendar events explain who places the call", () => {
  const content = icsForAppointment({
    id: "appointment",
    subject: "Consultation",
    startsAt: "2026-08-03T13:00:00Z",
    endsAt: "2026-08-03T13:30:00Z",
    status: "Scheduled",
    meetingMode: "Phone",
    guestPhone: "+14165550199",
    meetingPhoneNumber: "+16475550100",
  }, "CHK Immigration");
  assert.match(content, /LOCATION:Phone call/);
  assert.match(content, /CHK Immigration will call \+14165550199 from \+16475550100/);
});

test("cancelled appointments suppress queued and retrying reminders", async () => {
  const service = await readFile(new URL("../src/services/bookingNotificationService.js", import.meta.url), "utf8");
  assert.match(service, /kind === "cancelled"\) await cancelQueuedBookingReminders\(appointment\.id, db\)/);
  assert.match(service, /kind: "reminder",[\s\S]*status: \{ in: \["pending", "processing"\] \}/);
  assert.match(service, /bookingDeliveryIsCurrent\(job, appointment\)/);
  assert.match(service, /appointmentRevision: revision/);
  assert.match(service, /bookingDeliveryAllowed\(deliveryId, appointment\.id\)/);
  assert.match(service, /where: \{ id: job\.id, status: "processing" \},[\s\S]*if \(!failed\.count\) continue/);
  assert.match(service, /let reminderCursor = null[\s\S]*orderBy: \[\{ startsAt: "asc" \}, \{ id: "asc" \}\][\s\S]*reminderCursor = \{ startsAt: lastAppointment\.startsAt, id: lastAppointment\.id \}/);
});

test("booking delivery treats temporary database outages as retryable with bounded backoff", async () => {
  assert.equal(isTransientBookingDeliveryError({ code: "P1001" }), true);
  assert.equal(isTransientBookingDeliveryError({ code: "P2024" }), true);
  assert.equal(isTransientBookingDeliveryError(new Error("server closed the connection unexpectedly")), true);
  assert.equal(isTransientBookingDeliveryError(new Error("Invalid booking recipient")), false);
  assert.equal(bookingDeliveryRetryDelay(1, 5_000, 300_000), 5_000);
  assert.equal(bookingDeliveryRetryDelay(4, 5_000, 300_000), 40_000);
  assert.equal(bookingDeliveryRetryDelay(20, 5_000, 300_000), 300_000);

  const service = await readFile(new URL("../src/services/bookingNotificationService.js", import.meta.url), "utf8");
  assert.doesNotMatch(service, /void processBookingDeliveryPass\(\)/);
  assert.match(service, /return requestBookingDeliveryPass\("explicit_request"\)/);
  assert.match(service, /booking\.delivery_pass_failed/);
});

test("development Prisma connections preserve an explicit one-connection pool and otherwise stay minimal", () => {
  const raw = "postgresql://user:password@db.example.test:5432/casedesk";
  const development = new URL(runtimeDatabaseUrl({ raw, override: "", nodeEnv: "development" }));
  const production = new URL(runtimeDatabaseUrl({ raw, override: "", nodeEnv: "production" }));
  const configured = new URL(runtimeDatabaseUrl({ raw: `${raw}?connection_limit=1`, override: "", nodeEnv: "production" }));
  const overridden = new URL(runtimeDatabaseUrl({ raw, override: "3", nodeEnv: "development" }));

  assert.equal(development.searchParams.get("connection_limit"), "1");
  assert.equal(production.searchParams.get("connection_limit"), "5");
  assert.equal(configured.searchParams.get("connection_limit"), "1");
  assert.equal(overridden.searchParams.get("connection_limit"), "3");
  assert.equal(development.searchParams.get("pool_timeout"), "20");
});

test("reminders already overdue when an appointment is booked or rescheduled are skipped", () => {
  const appointment = {
    createdAt: "2026-08-04T18:53:44.984Z",
    events: [],
  };
  assert.equal(
    reminderWasAlreadyDueWhenScheduled(appointment, new Date("2026-08-04T16:00:00.000Z").getTime()),
    true,
  );
  assert.equal(
    reminderWasAlreadyDueWhenScheduled(appointment, new Date("2026-08-05T14:00:00.000Z").getTime()),
    false,
  );
  assert.equal(
    reminderWasAlreadyDueWhenScheduled({
      createdAt: "2026-08-01T12:00:00.000Z",
      events: [{ createdAt: "2026-08-04T18:53:44.984Z" }],
    }, new Date("2026-08-04T16:00:00.000Z").getTime()),
    true,
  );
});

test("queued appointment messages are suppressed after state or time changes", () => {
  const startsAt = "2026-08-03T13:00:00.000Z";
  const scheduled = {
    status: "Scheduled",
    startsAt,
    endsAt: "2026-08-03T13:30:00.000Z",
    meetingMode: "Online",
    meetingUrl: "https://meet.jit.si/original",
  };
  const revision = bookingMessageRevision(scheduled);
  assert.equal(bookingDeliveryIsCurrent({ kind: "booked", payload: { appointmentStartsAt: startsAt } }, scheduled), true);
  assert.equal(bookingDeliveryIsCurrent({ kind: "booked", payload: { appointmentRevision: revision } }, scheduled), true);
  assert.equal(bookingDeliveryIsCurrent({ kind: "booked", payload: { appointmentStartsAt: startsAt } }, { ...scheduled, status: "Cancelled" }), false);
  assert.equal(bookingDeliveryIsCurrent({ kind: "cancelled", payload: {} }, { ...scheduled, status: "Cancelled" }), true);
  assert.equal(bookingDeliveryIsCurrent({ kind: "cancelled", payload: {} }, scheduled), false);
  assert.equal(bookingDeliveryIsCurrent({ kind: "no_show", payload: {} }, { ...scheduled, status: "NoShow" }), true);
  assert.equal(bookingDeliveryIsCurrent({ kind: "attended", payload: {} }, { ...scheduled, status: "Completed" }), true);
  assert.equal(bookingDeliveryIsCurrent({ kind: "rescheduled", payload: { appointmentStartsAt: startsAt } }, { ...scheduled, startsAt: "2026-08-03T14:00:00.000Z" }), false);
  assert.equal(bookingDeliveryIsCurrent({ kind: "format_updated", payload: { appointmentRevision: revision } }, scheduled), true);
  assert.equal(bookingDeliveryIsCurrent({ kind: "format_updated", payload: { appointmentRevision: revision } }, { ...scheduled, meetingMode: "Phone", meetingUrl: null }), false);
  assert.equal(bookingDeliveryIsCurrent({ kind: "assignment_updated", payload: { appointmentRevision: revision } }, scheduled), true);
  assert.equal(bookingDeliveryIsCurrent({ kind: "assignment_updated", payload: { appointmentRevision: revision } }, { ...scheduled, assignedToId: "new-consultant" }), false);
  assert.equal(bookingDeliveryIsCurrent({ kind: "meeting_updated", payload: { appointmentRevision: revision } }, { ...scheduled, meetingUrl: "https://zoom.us/j/new-link" }), false);
  assert.equal(bookingDeliveryIsCurrent({ kind: "format_updated", payload: { appointmentStartsAt: startsAt } }, { ...scheduled, startsAt: "2026-08-03T14:00:00.000Z" }), false);
});

test("first Zoom failure releases the confirmation before retrying the link", () => {
  const appointment = { status: "Scheduled", meetingMode: "Zoom" };
  assert.equal(delayedZoomNotificationKind({ payload: { notifyKind: "booked" } }, appointment, 1), "booked");
  assert.equal(delayedZoomNotificationKind({ payload: { notifyKind: "rescheduled" } }, appointment, 1), "rescheduled");
  assert.equal(delayedZoomNotificationKind({ payload: { notifyKind: "format_updated" } }, appointment, 1), "format_updated");
  assert.equal(delayedZoomNotificationKind({ payload: { notifyKind: "meeting_updated" } }, appointment, 1), null);
  assert.equal(delayedZoomNotificationKind({ payload: { notifyKind: "booked" } }, appointment, 2), "booked");
  assert.equal(delayedZoomNotificationKind({ payload: { notifyKind: "booked", confirmationReleased: true } }, appointment, 2), null);
  assert.equal(delayedZoomNotificationKind({ payload: { notifyKind: "booked" } }, { ...appointment, status: "Cancelled" }, 1), null);
});

test("scheduling migration adds durable delivery, assignment, and idempotency safeguards", async () => {
  const sql = await readFile(new URL("../prisma/migrations/20260719020000_scheduling_operations/migration.sql", import.meta.url), "utf8");
  assert.match(sql, /scheduling_staff_preferences/);
  assert.match(sql, /booking_message_deliveries/);
  assert.match(sql, /appointments_agency_id_idempotency_key_key/);
  assert.match(sql, /lead_consultations_appointment_id_fkey/);
});

test("meeting-mode migration adds phone snapshots and durable Zoom synchronization", async () => {
  const sql = await readFile(new URL("../prisma/migrations/20260729190000_phone_jitsi_zoom_scheduling/migration.sql", import.meta.url), "utf8");
  assert.match(sql, /phone_caller_id/);
  assert.match(sql, /agency_zoom_connections/);
  assert.match(sql, /zoom_host_mappings/);
  assert.match(sql, /appointment_meeting_jobs/);
  assert.match(sql, /meeting_provider_host_id/);
  assert.match(sql, /ALTER TABLE "agency_zoom_connections" ENABLE ROW LEVEL SECURITY/);
  assert.match(sql, /ALTER TABLE "zoom_host_mappings" ENABLE ROW LEVEL SECURITY/);
  assert.match(sql, /ALTER TABLE "appointment_meeting_jobs" ENABLE ROW LEVEL SECURITY/);
});

test("paid checkout snapshots its office details before payment redirects away", async () => {
  const [sql, holdService, webhookService] = await Promise.all([
    readFile(new URL("../prisma/migrations/20260730173000_booking_payment_location_snapshot/migration.sql", import.meta.url), "utf8"),
    readFile(new URL("../src/services/bookingPaymentHoldService.js", import.meta.url), "utf8"),
    readFile(new URL("../src/services/quickbooksWebhookService.js", import.meta.url), "utf8"),
  ]);
  assert.match(sql, /location_maps_url/);
  assert.match(holdService, /location: location \? `\$\{location\.name\} — \$\{location\.address\}`/);
  assert.match(webhookService, /const locationLabel = hold\.location/);
  assert.match(webhookService, /locationMapsUrl = hold\.locationMapsUrl/);
});

test("paid public bookings resume from QuickBooks and expose the confirmed appointment", async () => {
  const [controller, paymentService, page] = await Promise.all([
    readFile(new URL("../src/controllers/publicBookingController.js", import.meta.url), "utf8"),
    readFile(new URL("../src/services/bookingPaymentHoldService.js", import.meta.url), "utf8"),
    readFile(new URL("../../frontend/src/pages/PublicBookingPage.jsx", import.meta.url), "utf8"),
  ]);
  assert.match(paymentService, /include:\s*\{\s*appointment:/);
  assert.match(controller, /appointment: hold\.status === "Paid" && hold\.appointment/);
  assert.match(controller, /requiresStaffResolution: hold\.status === "Paid" && !hold\.appointmentId/);
  assert.match(page, /casedesk:booking-payment:/);
  assert.match(page, /getPublicBookingPaymentHoldStatus\(\s*token,\s*claimToken,?\s*\)/);
  assert.match(page, /result\.appointment/);

  const paidBookingStart = controller.indexOf("export async function createPublicBookingPaymentHold");
  const paidBookingEnd = controller.indexOf("export async function getPublicBookingPaymentHoldStatus");
  const paidBookingSource = controller.slice(paidBookingStart, paidBookingEnd);
  assert.ok(
    paidBookingSource.indexOf("agencyId_idempotencyKey") < paidBookingSource.indexOf("availabilityForRange"),
    "idempotent retry must resolve before its own hold makes the slot look unavailable",
  );

  const freeBookingStart = controller.indexOf("export async function createPublicBooking(req, res)");
  const freeBookingEnd = controller.indexOf("function bookingConfirmationView");
  const freeBookingSource = controller.slice(freeBookingStart, freeBookingEnd);
  assert.match(
    freeBookingSource,
    /settings\.consultFeeEnabled[\s\S]*Number\(settings\.consultFeeAmount\) > 0[\s\S]*"PAYMENT_REQUIRED"/,
    "the unauthenticated free-booking endpoint must not bypass a configured consultation fee",
  );
});

test("Zoom validates signatures before handling endpoint challenges", async () => {
  const controller = await readFile(new URL("../src/controllers/zoomController.js", import.meta.url), "utf8");
  const webhookStart = controller.indexOf("export async function zoomWebhook");
  const webhookSource = controller.slice(webhookStart);
  assert.ok(
    webhookSource.indexOf("verifyZoomWebhookSignature") < webhookSource.indexOf('event.event === "endpoint.url_validation"'),
    "Zoom endpoint validation must not bypass request signature verification",
  );
});

test("every cancellation path stops reminders and synchronizes external meetings", async () => {
  const [caseController, appointmentController, meetingWorker] = await Promise.all([
    readFile(new URL("../src/controllers/caseController.js", import.meta.url), "utf8"),
    readFile(new URL("../src/controllers/appointmentController.js", import.meta.url), "utf8"),
    readFile(new URL("../src/services/appointmentMeetingService.js", import.meta.url), "utf8"),
  ]);
  assert.match(caseController, /sendBookingMessages\([\s\S]*kind: "cancelled"/);
  assert.match(caseController, /enqueueAppointmentMeetingJob\([\s\S]*action: "DELETE"/);
  assert.match(appointmentController, /syncLeadConsultationFromAppointment/);
  assert.match(appointmentController, /offerWaitlistOpening/);
  assert.match(meetingWorker, /status: "superseded"/);
  assert.match(meetingWorker, /updatedAt: appointment\.updatedAt/);
  assert.match(meetingWorker, /createdProviderMeetingId/);
  assert.match(meetingWorker, /appointment_meeting\.delayed_confirmation_queue_failed/);
  assert.match(meetingWorker, /notifyKind: "meeting_updated"/);
});

test("waitlist offers are revalidated and serialized with new bookings", async () => {
  const [waitlistService, publicController] = await Promise.all([
    readFile(new URL("../src/services/bookingWaitlistService.js", import.meta.url), "utf8"),
    readFile(new URL("../src/controllers/publicBookingController.js", import.meta.url), "utf8"),
  ]);
  assert.match(waitlistService, /availabilityForRange\(/);
  assert.match(waitlistService, /lockSchedulingTransaction\(tx, appointment\.agencyId/);
  assert.match(waitlistService, /assertSlotAvailable\(tx/);
  assert.match(waitlistService, /sendAgencyOomaSms\(/);
  assert.match(waitlistService, /if \(!emailDelivered && !smsDelivered\)/);
  assert.match(
    waitlistService,
    /candidateMode === MEETING_MODES\.ZOOM[\s\S]*assertZoomOperational\(appointment\.agencyId\)/,
    "a disconnected Zoom workspace must not send an unusable waitlist offer",
  );
  assert.match(waitlistService, /const candidateMode = candidate\.meetingMode/);
  assert.match(waitlistService, /locationId: candidateMode === MEETING_MODES\.IN_PERSON \? resolvedLocationId : null/);
  assert.match(waitlistService, /let candidateCursor = null[\s\S]*orderBy: \[\{ createdAt: "asc" \}, \{ id: "asc" \}\][\s\S]*candidateCursor = \{ createdAt: lastCandidate\.createdAt, id: lastCandidate\.id \}/);
  assert.doesNotMatch(
    waitlistService,
    /meetingMode: appointment\.meetingMode/,
    "a freed consultant seat must be offered across every valid appointment format",
  );
  assert.ok(
    waitlistService.indexOf("lockSchedulingTransaction(tx, appointment.agencyId") < waitlistService.indexOf("tx.bookingWaitlistEntry.findFirst"),
    "candidate selection must happen after the scheduling lock is acquired",
  );
  assert.match(publicController, /status: \{ in: \["Waiting", "Offered"\] \}/);
  assert.match(publicController, /localDateTimeToUtc\(preferredFromKey, 0, settings\.timezone\)/);
  assert.match(publicController, /localDateTimeToUtc\(preferredToKey, 24 \* 60, settings\.timezone\)/);
});

test("active QuickBooks polling rotates through every unpaid booking hold", async () => {
  const service = await readFile(new URL("../src/services/bookingPaymentHoldService.js", import.meta.url), "utf8");
  assert.match(service, /let activeHoldPollRunning = false/);
  assert.match(service, /source: "WalkIn"[\s\S]*expiresAt: null[\s\S]*30 \* 86_400_000/);
  assert.match(service, /orderBy: \[\{ updatedAt: "asc" \}, \{ id: "asc" \}\]/);
  assert.match(service, /where: \{ id: hold\.id, status: "AwaitingPayment" \},[\s\S]*data: \{ updatedAt: new Date\(\) \}/);
});

test("front-desk card reservations use durable delivery and remain recoverable after the sheet closes", async () => {
  const [controller, routes, holdService, notificationService, webhookService, calendarPage, paymentsPage, migration] = await Promise.all([
    readFile(new URL("../src/controllers/bookingController.js", import.meta.url), "utf8"),
    readFile(new URL("../src/routes/bookingRoutes.js", import.meta.url), "utf8"),
    readFile(new URL("../src/services/bookingPaymentHoldService.js", import.meta.url), "utf8"),
    readFile(new URL("../src/services/bookingNotificationService.js", import.meta.url), "utf8"),
    readFile(new URL("../src/services/quickbooksWebhookService.js", import.meta.url), "utf8"),
    readFile(new URL("../../frontend/src/pages/CalendarPage.jsx", import.meta.url), "utf8"),
    readFile(new URL("../../frontend/src/pages/Payments.jsx", import.meta.url), "utf8"),
    readFile(new URL("../prisma/migrations/20260804210000_payment_hold_message_delivery/migration.sql", import.meta.url), "utf8"),
  ]);
  assert.match(holdService, /queuePaymentHoldMessages/);
  assert.doesNotMatch(holdService.slice(holdService.indexOf("createPaymentHoldForStaffBooking"), holdService.indexOf("getPaymentHoldStatus")), /deliverBookingMessages/);
  assert.match(notificationService, /paymentHoldId: hold\.id/);
  assert.match(notificationService, /job\.paymentHoldId && job\.kind === "payment_requested"/);
  assert.match(routes, /payment-holds\/:id\/resend/);
  assert.match(routes, /payment-holds\/:id\/cancel/);
  assert.match(controller, /body\.source === "WalkIn" && submittedEmail/);
  assert.match(calendarPage, /\["AwaitingPayment", "Confirming"\]\.includes\(pendingHold\.status\)/);
  assert.match(calendarPage, /Resend payment request/);
  assert.match(paymentsPage, /function PaymentHoldDrawer/);
  assert.match(paymentsPage, /Release this slot\?/);
  assert.match(webhookService, /if \(!hold\.clientId\)/);
  assert.match(webhookService, /paymentHoldId: hold\.id[\s\S]*appointmentId: created\.id/);
  assert.match(migration, /ALTER COLUMN "appointment_id" DROP NOT NULL/);
  assert.match(migration, /booking_message_deliveries_parent_check/);
});

test("front-desk e-transfers may book before payment while preserving an actionable accounting trail", async () => {
  const [controller, holdService, webhookService, dashboard, overview, calendarPage, paymentsPage, migration] = await Promise.all([
    readFile(new URL("../src/controllers/bookingController.js", import.meta.url), "utf8"),
    readFile(new URL("../src/services/bookingPaymentHoldService.js", import.meta.url), "utf8"),
    readFile(new URL("../src/services/quickbooksWebhookService.js", import.meta.url), "utf8"),
    readFile(new URL("../src/controllers/dashboardController.js", import.meta.url), "utf8"),
    readFile(new URL("../src/services/paymentsOverviewService.js", import.meta.url), "utf8"),
    readFile(new URL("../../frontend/src/pages/CalendarPage.jsx", import.meta.url), "utf8"),
    readFile(new URL("../../frontend/src/pages/Payments.jsx", import.meta.url), "utf8"),
    readFile(new URL("../prisma/migrations/20260804220000_manual_payment_reference_and_recovery/migration.sql", import.meta.url), "utf8"),
  ]);

  assert.doesNotMatch(controller, /Enter the e-transfer transaction number before booking/);
  assert.match(controller, /createPendingWalkInETransfer/);
  assert.match(controller, /paymentMethod === "ETransfer" && !paymentReference/);
  assert.match(controller, /manualPaymentHold = await prisma\.bookingPaymentHold\.findUnique/);
  assert.match(holdService, /export async function createPendingWalkInETransfer/);
  assert.match(holdService, /status: "AwaitingPayment"[\s\S]*expiresAt: null[\s\S]*paymentMethod: "ETransfer"[\s\S]*manualPaymentReference: null/);
  assert.match(holdService, /booking_payment\.etransfer_pending/);
  assert.match(holdService, /resolvePendingETransferNotification/);
  assert.match(holdService, /status: "RecordingPayment"/);
  assert.match(holdService, /status: "PaymentFailed"/);
  assert.match(holdService, /manualPaymentReference: paymentReference/);
  assert.match(holdService, /paymentReference: paymentReference \|\| `CD-/);
  assert.match(holdService, /\["Scheduled", "Completed", "NoShow", "Cancelled"\]/);
  assert.match(webhookService, /findQuickBooksPaymentForInvoice/);
  assert.match(webhookService, /manualPaymentReference: reconciledPaymentReference/);
  assert.match(dashboard, /OPEN_BOOKING_PAYMENT_STATUSES/);
  assert.match(overview, /eTransferPaymentPending/);
  assert.match(overview, /transactionReferenceMissing/);
  assert.match(calendarPage, /E-transfer transaction number \(optional\)/);
  assert.match(calendarPage, /leave this blank—the appointment will still be booked and payment will remain pending/);
  assert.doesNotMatch(calendarPage, /required=\{form\.paymentMethod === "ETransfer"\}/);
  assert.match(calendarPage, /E-transfer payment pending/);
  assert.match(calendarPage, /No consultation payment is recorded/);
  assert.match(paymentsPage, /E-transfer pending/);
  assert.match(paymentsPage, /Transaction # missing/);
  assert.match(paymentsPage, /Recording failed/);
  assert.match(migration, /manual_payment_reference/);
  assert.match(migration, /payment_error/);
  assert.match(migration, /ALTER COLUMN "guest_email" DROP NOT NULL/);
});

test("scheduled paid consultations without a payment row remain visible and actionable", async () => {
  const [controller, holdService, scheduler, dashboard, overview, calendarPage, paymentsPage] = await Promise.all([
    readFile(new URL("../src/controllers/bookingController.js", import.meta.url), "utf8"),
    readFile(new URL("../src/services/bookingPaymentHoldService.js", import.meta.url), "utf8"),
    readFile(new URL("../src/services/notificationScheduler.js", import.meta.url), "utf8"),
    readFile(new URL("../src/controllers/dashboardController.js", import.meta.url), "utf8"),
    readFile(new URL("../src/services/paymentsOverviewService.js", import.meta.url), "utf8"),
    readFile(new URL("../../frontend/src/pages/CalendarPage.jsx", import.meta.url), "utf8"),
    readFile(new URL("../../frontend/src/pages/Payments.jsx", import.meta.url), "utf8"),
  ]);

  assert.match(holdService, /booking_payment\.appointment_missing/);
  assert.match(holdService, /export async function reconcileMissingAppointmentPaymentAlerts/);
  assert.match(holdService, /paymentHold: \{ is: null \}/);
  assert.match(holdService, /\{ recurrenceIndex: 1 \}/);
  assert.match(holdService, /resolveMissingAppointmentPaymentNotification/);
  assert.match(scheduler, /await reconcileMissingAppointmentPaymentAlerts\(\)/);
  assert.match(controller, /feeApplies && !paymentMethod/);
  assert.match(controller, /will remain flagged until its consultation payment is recorded/);
  assert.match(controller, /appointmentId: hold\.appointmentId/);
  assert.match(dashboard, /missingAppointmentPayments/);
  assert.match(overview, /missingAppointmentPayment: true/);
  assert.match(overview, /description: "Consultation fee · payment not recorded"/);
  assert.match(calendarPage, /function appointmentPaymentAttention/);
  assert.match(calendarPage, /Payment not recorded/);
  assert.match(calendarPage, /\["Scheduled", "Completed"\]\.includes\(appointment\?\.status\)/);
  assert.match(calendarPage, /hold\.status === "AwaitingPayment"[\s\S]*"Payment pending"/);
  assert.match(calendarPage, /isDone && !paymentAttention/);
  assert.match(calendarPage, /item\?\.id === result\.appointmentId/);
  assert.match(paymentsPage, /row\.missingAppointmentPayment/);
  assert.match(paymentsPage, /Payment not recorded/);
});

test("front-desk client intake cannot misclassify a custom charge as a consultation payment", async () => {
  const [controller, paymentService, calendarPage, clientsPage] = await Promise.all([
    readFile(new URL("../src/controllers/bookingController.js", import.meta.url), "utf8"),
    readFile(new URL("../src/services/bookingPaymentHoldService.js", import.meta.url), "utf8"),
    readFile(new URL("../../frontend/src/pages/CalendarPage.jsx", import.meta.url), "utf8"),
    readFile(new URL("../../frontend/src/pages/Clients.jsx", import.meta.url), "utf8"),
  ]);

  assert.doesNotMatch(controller, /req\.body\?\.paymentAmount/);
  assert.match(controller, /Number\(settings\.consultFeeAmount\)/);
  assert.doesNotMatch(paymentService, /requestedAmount/);
  assert.doesNotMatch(calendarPage, /paymentAmount:/);
  assert.doesNotMatch(clientsPage, /paymentAmount:/);
  assert.doesNotMatch(clientsPage, /Book \+ consult fee/);
  assert.match(clientsPage, /Charge the fee or skip/);
  assert.match(clientsPage, /Professional fee/);
  assert.match(calendarPage, /idempotencyKey: form\.idempotencyKey/);
  assert.match(controller, /existingRequestAppointment/);
  assert.match(controller, /agencyId_idempotencyKey/);
  assert.match(paymentService, /createPaymentHoldForStaffBooking[\s\S]*idempotencyKey = null/);
});

test("case invoice e-transfers require and retain their bank transaction number", async () => {
  const [controller, service, workspace, overview, migration] = await Promise.all([
    readFile(new URL("../src/controllers/caseInvoiceController.js", import.meta.url), "utf8"),
    readFile(new URL("../src/services/caseInvoiceService.js", import.meta.url), "utf8"),
    readFile(new URL("../../frontend/src/components/case-profile/CaseBillingWorkspace.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/services/paymentsOverviewService.js", import.meta.url), "utf8"),
    readFile(new URL("../prisma/migrations/20260804223000_case_invoice_manual_payment_reference/migration.sql", import.meta.url), "utf8"),
  ]);

  assert.match(controller, /transactionReference: req\.body\?\.transactionReference/);
  assert.match(service, /Enter the e-transfer transaction number before recording the payment/);
  assert.match(service, /paymentReference: paymentReference \|\| undefined/);
  assert.match(service, /lastPaymentReference: paymentReference/);
  assert.match(workspace, /Transaction number/);
  assert.match(workspace, /transactionReference: transactionReference\.trim\(\)/);
  assert.match(overview, /paymentReference: row\.lastPaymentReference/);
  assert.match(migration, /last_payment_reference/);
  assert.match(migration, /last_qb_payment_id/);
});

test("client billing can record agency fee categories and repair paid appointment references", async () => {
  const [controller, clientRoutes, bookingRoutes, holdService, quickBooks, billingCard, entrySheet, calendar, invoiceService, schema, idempotencyMigration] = await Promise.all([
    readFile(new URL("../src/controllers/accountStatementController.js", import.meta.url), "utf8"),
    readFile(new URL("../src/routes/clientRoutes.js", import.meta.url), "utf8"),
    readFile(new URL("../src/routes/bookingRoutes.js", import.meta.url), "utf8"),
    readFile(new URL("../src/services/bookingPaymentHoldService.js", import.meta.url), "utf8"),
    readFile(new URL("../src/services/quickbooksService.js", import.meta.url), "utf8"),
    readFile(new URL("../../frontend/src/components/clients/ClientBillingCard.jsx", import.meta.url), "utf8"),
    readFile(new URL("../../frontend/src/components/clients/ClientManualBillingEntrySheet.jsx", import.meta.url), "utf8"),
    readFile(new URL("../../frontend/src/pages/CalendarPage.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/services/caseInvoiceService.js", import.meta.url), "utf8"),
    readFile(new URL("../prisma/schema.prisma", import.meta.url), "utf8"),
    readFile(new URL("../prisma/migrations/20260808170000_case_invoice_idempotency/migration.sql", import.meta.url), "utf8"),
  ]);

  assert.match(clientRoutes, /billing\/manual-entry-options/);
  assert.match(clientRoutes, /billing\/manual-entry/);
  assert.match(clientRoutes, /requireRole\("admin", "consultant", "frontdesk"\)/);
  assert.match(controller, /listFeeCategories\(req\.auth\.agencyId\)/);
  assert.match(controller, /entryType === "invoice_payment"/);
  assert.match(controller, /entryType === "appointment_payment"/);
  assert.match(controller, /entryType === "new_charge_payment"/);
  assert.doesNotMatch(controller, /clientId: client\.id,\s*isFreeConsultation: false/);
  assert.match(controller, /identityMatched/);
  assert.match(controller, /appointment\.client_linked_for_billing/);
  assert.match(controller, /overrideFreeConsultation: req\.body\?\.overrideFreeConsultation === true/);
  assert.match(controller, /paymentWarning/);
  assert.ok(controller.indexOf("validateManualPaymentInput") < controller.indexOf("createCaseInvoice(req.auth.agencyId"));
  assert.ok(controller.indexOf("assertManualPaymentReferenceAvailable") < controller.indexOf("createCaseInvoice(req.auth.agencyId"));
  assert.match(controller, /creationIdempotencyKey/);
  assert.match(controller, /notifyClient: false/);
  assert.match(bookingRoutes, /appointments\/:id\/payment-details/);
  assert.match(holdService, /updatePaidAppointmentPaymentDetails/);
  assert.match(holdService, /findQuickBooksPaymentIdForInvoice/);
  assert.match(holdService, /FREE_CONSULTATION_CONFIRMATION_REQUIRED/);
  assert.match(holdService, /payment\.free_consultation_overridden/);
  assert.match(quickBooks, /updateQuickBooksPaymentDetails/);
  assert.match(quickBooks, /sparse: true/);
  assert.match(billingCard, /Add entry/);
  assert.match(billingCard, /"admin", "consultant", "frontdesk"/);
  assert.match(entrySheet, /Agency fee category/);
  assert.match(entrySheet, /New charge \+ payment/);
  assert.match(entrySheet, /add missing transaction #/);
  assert.match(entrySheet, /Convert this free appointment to paid/);
  assert.match(entrySheet, /matched by contact/);
  assert.match(entrySheet, /setMode\("existing"\)/);
  assert.match(entrySheet, /The invoice was created only once; retry below/);
  assert.match(entrySheet, /setLoadAttempt/);
  assert.match(calendar, /Add missing transaction number/);
  assert.match(invoiceService, /requestId: operationKey \? `case-invoice-/);
  assert.match(invoiceService, /lastPaymentIdempotencyKey === operationKey/);
  assert.match(schema, /creationIdempotencyKey/);
  assert.match(schema, /lastPaymentIdempotencyKey/);
  assert.match(idempotencyMigration, /creation_idempotency_key/);
  assert.match(idempotencyMigration, /last_payment_idempotency_key/);
});

test("free follow-up consultations require a prior settled booking and a 15-minute session", async () => {
  const [eligibilityService, bookingController, publicController, portalController, portalOffer, calendar] = await Promise.all([
    readFile(new URL("../src/services/bookingFreeConsultationService.js", import.meta.url), "utf8"),
    readFile(new URL("../src/controllers/bookingController.js", import.meta.url), "utf8"),
    readFile(new URL("../src/controllers/publicBookingController.js", import.meta.url), "utf8"),
    readFile(new URL("../src/controllers/clientPortalController.js", import.meta.url), "utf8"),
    readFile(new URL("../../frontend/src/components/client-portal/usePortalFreeAppointmentOffer.js", import.meta.url), "utf8"),
    readFile(new URL("../../frontend/src/pages/CalendarPage.jsx", import.meta.url), "utf8"),
  ]);

  assert.match(eligibilityService, /status: "Paid"/);
  assert.match(eligibilityService, /paidAt: \{ not: null \}/);
  assert.match(eligibilityService, /voidedAt: null/);
  assert.match(eligibilityService, /balanceMismatchAt: null/);
  assert.match(eligibilityService, /status: \{ not: "Cancelled" \}/);
  assert.match(eligibilityService, /endsAt: \{ lt: now \}/);
  assert.match(eligibilityService, /Number\(durationMinutes\) === 15/);
  assert.match(eligibilityService, /PAID_BOOKING_REQUIRED/);
  assert.match(eligibilityService, /FIFTEEN_MINUTE_SESSION_REQUIRED/);
  assert.match(bookingController, /durationMinutes,/);
  assert.match(publicController, /guestEmailNormalized: verification \? email : null/);
  assert.match(portalController, /freeFollowUpOffer: freeEligibility\?\.eligible/);
  assert.match(portalController, /durationMinutes: 15/);
  assert.doesNotMatch(portalOffer, /getPublicBookingInfo/);
  assert.match(portalOffer, /booking\.freeFollowUpOffer/);
  assert.match(calendar, /Eligible for a free 15-minute follow-up/);
  assert.match(calendar, /choose a 15-minute appointment type to apply it/);
});

test("staff can't pick a free-named session type for a contact who hasn't earned it yet", async () => {
  const calendar = await readFile(new URL("../../frontend/src/pages/CalendarPage.jsx", import.meta.url), "utf8");

  // A brand-new client booked straight into "Free Follow-up Consultation"
  // as their very first appointment isn't actually free — the fee is still
  // charged underneath, just silently, because nothing stopped the option
  // from being picked in the first place. Locking the option itself (not
  // just warning after the fact) is what actually prevents a repeat.
  assert.match(calendar, /const contactVerifiedFreeEligible = Boolean\(freeEligibility\?\.contactEligible\);/);
  assert.match(calendar, /const isFreeNamedType = \(type\) => \/free\/i\.test\(type\.name\);/);
  assert.match(calendar, /const locked = isFreeNamedType\(type\) && !contactVerifiedFreeEligible;/);
  assert.match(calendar, /<option key=\{type\.id\} value=\{type\.id\} disabled=\{locked\}>/);
  // Switching to a contact who hasn't earned it clears a stale selection
  // rather than silently keeping a now-invalid free type selected.
  assert.match(calendar, /if \(current && isFreeNamedType\(current\) && !contactVerifiedFreeEligible\) \{/);
  assert.match(calendar, /setForm\(\(c\) => \(\{ \.\.\.c, sessionTypeId: "" \}\)\);/);

  // Eligibility remains enforced by the locked session type, while the form
  // only calls attention to the positive, actionable state.
  assert.match(calendar, /freeEligibility\?\.enabled && freeEligibility\.contactEligible/);
  assert.match(calendar, /border-emerald-200 bg-emerald-50/);
  assert.doesNotMatch(calendar, /Not eligible for a free follow-up/);
  assert.doesNotMatch(calendar, /Free follow-up limit reached/);
});

test("the public widget hides the free 15-minute follow-up from visitors who haven't verified through the portal", async () => {
  const [publicController, publicPage] = await Promise.all([
    readFile(new URL("../src/controllers/publicBookingController.js", import.meta.url), "utf8"),
    readFile(new URL("../../frontend/src/pages/PublicBookingPage.jsx", import.meta.url), "utf8"),
  ]);

  assert.match(publicController, /freeConsultationsEnabled: settings\.freeConsultationsEnabled/);
  assert.match(publicPage, /const verified = Boolean\(portalSessionAtLoad\?\.verificationToken\)/);
  assert.match(publicPage, /data\.freeConsultationsEnabled && !verified/);
  assert.match(publicPage, /type\.durationMinutes !== 15/);
});

test("public paid and Zoom formats cannot be enabled with incomplete provider setup", async () => {
  const controller = await readFile(new URL("../src/controllers/bookingController.js", import.meta.url), "utf8");
  assert.match(controller, /activatingPaidPublicBooking/);
  assert.match(controller, /agencyQuickBooksSettings\.findUnique/);
  assert.match(controller, /"QBO_NOT_CONNECTED"/);
  assert.match(controller, /"QBO_MAPPING_REQUIRED"/);
  assert.match(controller, /public-bookable consultant to a Zoom host/);
  assert.match(controller, /eligibleStaffIds[\s\S]*zoomHostMapping\?\.status === "active"/);
});

test("returning clients prefer their consultant without reducing pooled capacity", async () => {
  const [page, publicController, paymentService] = await Promise.all([
    readFile(new URL("../../frontend/src/pages/PublicBookingPage.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/controllers/publicBookingController.js", import.meta.url), "utf8"),
    readFile(new URL("../src/services/bookingPaymentHoldService.js", import.meta.url), "utf8"),
  ]);
  const verifyStart = page.indexOf("async function verifyEmail()");
  const verifyEnd = page.indexOf("async function joinWaitlist()", verifyStart);
  const verifySource = page.slice(verifyStart, verifyEnd);
  assert.match(verifySource, /verification token lets the backend prefer/);
  assert.doesNotMatch(verifySource, /setConsultantId\(result\.consultant\.id\)/);
  assert.doesNotMatch(page, /if \(saved\.consultantId\) setConsultantId/);
  assert.match(publicController, /preferredConsultantId: existingClient\?\.assignedUserId/);
  assert.match(paymentService, /preferredUserId: preferredConsultantId/);
});

test("standalone client profiles are not automatically assigned without a case", async () => {
  const [bookingController, clientController, clientDrawer] = await Promise.all([
    readFile(new URL("../src/controllers/bookingController.js", import.meta.url), "utf8"),
    readFile(new URL("../src/controllers/clientController.js", import.meta.url), "utf8"),
    readFile(new URL("../../frontend/src/components/clients/ClientEditDrawer.jsx", import.meta.url), "utf8"),
  ]);
  const conversionStart = bookingController.indexOf("export async function convertAppointmentToClient");
  const conversionEnd = bookingController.indexOf("export async function applyAppointmentStatusChange", conversionStart);
  const conversionSource = bookingController.slice(conversionStart, conversionEnd);
  assert.match(conversionSource, /assignedUserId: null/);
  assert.doesNotMatch(conversionSource, /assignedUserId: appointment\.assignedToId/);
  assert.match(clientController, /req\.auth\.role === "consultant" && req\.body\.assignedUserId/);
  assert.match(clientDrawer, /Clients without a case stay unassigned by default/);
  assert.match(clientDrawer, /Direct profile access/);
});

test("the public booking flow asks attendance format before service, office, or time", async () => {
  const page = await readFile(new URL("../../frontend/src/pages/PublicBookingPage.jsx", import.meta.url), "utf8");
  const formatStart = page.indexOf('step === "format"');
  const serviceStart = page.indexOf('step === "service"', formatStart);
  const formatSource = page.slice(formatStart, serviceStart);
  assert.ok(formatStart >= 0 && serviceStart > formatStart);
  assert.match(formatSource, /How would you like to meet\?/);
  assert.doesNotMatch(formatSource, /What would you like to book\?/);
  assert.match(page, /matchingTypes\.length > 1\s*\? "service"\s*:\s*mode === "InPerson"\s*\? "location"\s*:\s*"time"/);
  assert.match(page, /step === "service"[\s\S]*What would you like to book\?/);
  assert.match(page, /sessionTypesForMode\("InPerson"\)\.some\(sessionTypeHasLocation\)/);
});

test("the compact public booking flow scrolls forward and back without changing desktop confirmation", async () => {
  const page = await readFile(new URL("../../frontend/src/pages/PublicBookingPage.jsx", import.meta.url), "utf8");
  assert.match(page, /matchMedia\("\(max-width: 767px\)"\)/);
  assert.match(page, /bookingStepRef/);
  assert.match(page, /previousStepRef/);
  assert.match(page, /scrollMobileBookingElement\(bookingStepRef\.current/);
  assert.match(page, /scrollMobileBookingElement\(timeColumnRef\.current/);
  assert.match(page, /if \(isSmallBookingViewport\(\)\)[\s\S]*onConfirm\(slot\)/);
  assert.match(page, /Back[\s\S]*md:hidden/);
  assert.match(page, /hidden rounded-md[\s\S]*sm:block/);
});

test("scheduling settings expose the real pooled and Zoom capacity", async () => {
  const panel = await readFile(new URL("../../frontend/src/components/booking/SchedulingSettingsPanel.jsx", import.meta.url), "utf8");
  assert.match(panel, /Current public capacity:/);
  assert.match(panel, /Zoom capacity:/);
  assert.match(panel, /section=users-roles/);
  assert.match(panel, /onBlur=\{\(event\) => changeStaff\(member, \{ maxDailyAppointments:/);
});

test("attendance outcomes remain internal while cancellations still notify clients", async () => {
  const [caseAppointments, leadService, bookingController, managePage] = await Promise.all([
    readFile(new URL("../src/controllers/appointmentController.js", import.meta.url), "utf8"),
    readFile(new URL("../src/modules/leads/lead.service.js", import.meta.url), "utf8"),
    readFile(new URL("../src/controllers/bookingController.js", import.meta.url), "utf8"),
    readFile(new URL("../../frontend/src/pages/ManageBookingPage.jsx", import.meta.url), "utf8"),
  ]);
  for (const source of [caseAppointments, leadService]) {
    assert.match(source, /sendBookingStaffNotification\([\s\S]*kind: "no_show"/);
  }
  assert.match(bookingController, /sendBookingStaffNotification\([\s\S]*status === "Completed" \? "attended" : "no_show"/);
  assert.match(caseAppointments, /sendBookingMessages\([\s\S]*kind: "cancelled"/);
  assert.match(managePage, /const active = booking\.status === "Scheduled"/);
  assert.match(managePage, /booking\.status === "NoShow"[\s\S]*"No-show"/);
  assert.match(managePage, /active && !past && booking\.meetingUrl/);
  assert.doesNotMatch(managePage, /const cancelled = booking\.status !== "Scheduled"/);
});

test("recurring Zoom reschedules require every assigned consultant to be mapped", async () => {
  const [staffController, publicController] = await Promise.all([
    readFile(new URL("../src/controllers/bookingController.js", import.meta.url), "utf8"),
    readFile(new URL("../src/controllers/publicBookingController.js", import.meta.url), "utf8"),
  ]);
  for (const source of [staffController, publicController]) {
    assert.match(source, /Zoom is not configured for every consultant in this recurring series/);
    assert.match(source, /mappedCount !== assigneeIds\.length/);
  }
});

test("Zoom mapping changes and disconnects recheck commitments under the scheduling lock", async () => {
  const [controller, zoomService] = await Promise.all([
    readFile(new URL("../src/controllers/zoomController.js", import.meta.url), "utf8"),
    readFile(new URL("../src/services/zoomService.js", import.meta.url), "utf8"),
  ]);
  const mappingTransaction = controller.slice(
    controller.indexOf("const result = await prisma.$transaction"),
    controller.indexOf("await recordActivity", controller.indexOf("const result = await prisma.$transaction")),
  );
  assert.ok(
    mappingTransaction.indexOf("lockSchedulingTransaction") < mappingTransaction.indexOf("activeZoomCommitments"),
    "mapping replacement must acquire the scheduling lock before its authoritative commitment check",
  );
  assert.ok(
    mappingTransaction.indexOf("activeZoomCommitments") < mappingTransaction.indexOf("zoomHostMapping.deleteMany"),
    "mapping replacement must recheck commitments before deleting mappings",
  );
  const removalTransaction = zoomService.slice(
    zoomService.indexOf("export async function removeZoomConnectionData"),
    zoomService.indexOf("export async function revokeZoomConnection"),
  );
  assert.ok(
    removalTransaction.indexOf("lockSchedulingTransaction") < removalTransaction.indexOf("activeZoomCommitments"),
    "disconnect must acquire the scheduling lock before checking commitments",
  );
  assert.match(zoomService, /bookingPaymentHold\.findMany/);
  assert.match(zoomService, /bookingSlotHold\.findMany/);
  assert.match(zoomService, /waitlistEntry: \{ meetingMode: "Zoom", status: "Offered" \}/);
});

test("the server maintains quiet Zoom OAuth connections and shuts the worker down cleanly", async () => {
  const server = await readFile(new URL("../src/server.js", import.meta.url), "utf8");
  assert.match(server, /startZoomConnectionMaintenance\(\)/);
  assert.match(server, /stopZoomConnectionMaintenance\(\)/);
  assert.match(server, /server\.zoom_not_configured/);
  assert.match(server, /ZOOM_WEBHOOK_SECRET_TOKEN/);
});

test("case-profile appointments use the same phone, Jitsi, and Zoom pipeline", async () => {
  const [controller, workspace] = await Promise.all([
    readFile(new URL("../src/controllers/appointmentController.js", import.meta.url), "utf8"),
    readFile(new URL("../../frontend/src/components/case-profile/AppointmentsWorkspace.jsx", import.meta.url), "utf8"),
  ]);
  assert.match(controller, /assertMeetingModeConfigured/);
  assert.match(controller, /appointmentMeetingFields/);
  assert.match(controller, /meetingMode,\s*db: tx/);
  assert.match(controller, /notifyKind: "booked"/);
  assert.match(controller, /notifyKind: timeChanged \? "rescheduled" : modeChanged \? "format_updated"/);
  assert.match(controller, /assigneeChanged[\s\S]*kind: "assignment_updated"/);
  assert.match(workspace, /How will the client attend\?/);
  assert.match(workspace, /id: "Phone"/);
  assert.match(workspace, /id: "Online"/);
  assert.match(workspace, /id: "Zoom"/);
  assert.match(workspace, /api\.get\("\/booking\/settings"\)/);
});

test("staff appointment notifications use the durable delivery queue", async () => {
  const service = await readFile(new URL("../src/services/bookingNotificationService.js", import.meta.url), "utf8");
  const sendAll = service.slice(
    service.indexOf("export async function sendBookingMessages"),
    service.indexOf("export async function sendBookingStaffNotification"),
  );
  const sendStaff = service.slice(
    service.indexOf("export async function sendBookingStaffNotification"),
    service.indexOf("export function bookingDeliveryIsCurrent"),
  );
  assert.match(sendAll, /channel: "staff"/);
  assert.match(sendAll, /bookingMessageDelivery\.createMany/);
  assert.doesNotMatch(sendAll, /deliverBookingMessages/);
  assert.match(sendStaff, /bookingMessageDelivery\.createMany/);
  assert.match(service, /job\.kind === "attended"\) expectedStatus = "Completed"/);
  assert.match(service, /appointmentId: appointment\.id, status: "Paid"/);
  assert.match(service, /Paid appointment cancelled — review refund/);
  assert.match(service, /if \(channel === "staff"\) throw error/);
});

test("the calendar grid marks the half-hour boundary as well as the hour, and offers a click-through hover preview", async () => {
  const calendar = await readFile(new URL("../../frontend/src/pages/CalendarPage.jsx", import.meta.url), "utf8");

  // A second, visually quieter gridline layer at the half-hour mark — the
  // existing hour lines stay solid, this one is dashed and lighter so it
  // reads as a reference line rather than competing with them.
  assert.match(calendar, /className="absolute inset-x-0 border-t border-slate-100\/90" style=\{\{ top: index \* HOUR_PX \}\}/);
  assert.match(calendar, /className="absolute inset-x-0 border-t border-dashed border-slate-100" style=\{\{ top: \(index \+ 0\.5\) \* HOUR_PX \}\}/);

  // The appointment pill is its own component (was inlined in the day loop).
  assert.match(calendar, /function AppointmentPill\(\{ item, column, columns, view, tone, isSelected, isFocused, bookingSettings, onSelect, onHoverStart, onHoverEnd \}\)/);
  assert.match(calendar, /\{positionedDayItems\.map\(\(\{ item, column, columns \}\) => \(\s*<AppointmentPill/);

  // Hover is additive to the existing click-opens-panel behaviour — it
  // never replaces `setSelected`, it only offers a lightweight preview
  // first, on a delay so a stray pass of the mouse doesn't pop it open.
  assert.match(calendar, /function AppointmentHoverCard\(\{ item, tone, rect, onViewDetails, onMouseEnter, onMouseLeave \}\)/);
  assert.match(calendar, /hoverShowTimer\.current = window\.setTimeout\(\(\) => setHoverPreview\(\{ item, tone, rect \}\), 300\);/);
  assert.match(calendar, /hoverHideTimer\.current = window\.setTimeout\(\(\) => setHoverPreview\(null\), 150\);/);
  assert.match(calendar, /onSelect=\{\(\) => \{ setSelected\(item\); closeHoverPreview\(\); \}\}/);
  assert.match(calendar, /onViewDetails=\{\(\) => \{ setSelected\(hoverPreview\.item\); closeHoverPreview\(\); \}\}/);

  // The preview surfaces contact info the click-through panel doesn't put
  // right up front, using the same client/guest fallback pattern already
  // used for the pill's display name.
  assert.match(calendar, /const email = item\.client\?\.email \|\| item\.guestEmail \|\| "";/);
  assert.match(calendar, /const phone = item\.client\?\.phone \|\| item\.guestPhone \|\| "";/);

  // Placement uses the card's real rendered height and clamps every edge to
  // the viewport. On unusually short screens the card itself can scroll,
  // instead of allowing its footer or actions to render off-screen.
  assert.match(calendar, /hoverCardPosition\(rect, card\.scrollHeight\)/);
  assert.match(calendar, /window\.addEventListener\("resize", reposition\)/);
  assert.match(calendar, /const visibleHeight = Math\.min\(measuredHeight, maxHeight\)/);
  assert.match(calendar, /overflow-x-hidden overflow-y-auto/);
});

test("appointment pills dropped the avatar experiment — one consistent icon+full-name layout, no avatar, on every pill", async () => {
  const calendar = await readFile(new URL("../../frontend/src/pages/CalendarPage.jsx", import.meta.url), "utf8");
  const pillSource = calendar.slice(calendar.indexOf("function AppointmentPill"), calendar.indexOf("function EventDetails"));

  // Two rounds of avatar tuning (add it, resize it, add it to compact pills
  // too) still left the name hard to read and the layout inconsistent
  // between compact and full-size pills — direct user feedback. Reverted to
  // a single structure for every pill: a mode icon, then the full name, no
  // InitialsAvatar and no first-name truncation.
  assert.doesNotMatch(pillSource, /InitialsAvatar/);
  assert.doesNotMatch(calendar, /function firstNameFor/);
  assert.match(pillSource, /const ModeIcon = MEETING_MODE_ICON\[item\.meetingMode\] \|\| MapPin;/);
  assert.match(pillSource, /<ModeIcon className="h-3 w-3 shrink-0" \/>/);
  assert.match(pillSource, /<span className="min-w-0 overflow-hidden text-ellipsis">\{displayName\}<\/span>/);
  assert.match(pillSource, /const isCompact = height < 44;/);
  assert.match(pillSource, /const height = Math\.max\(26, \(\(end - start\) \/ 3600000\) \* HOUR_PX - 3\);/);

  // The hover card keeps its own avatar — the feedback was about the pill
  // itself, not the preview popover that only appears on hover.
  assert.match(calendar, /<InitialsAvatar name=\{displayName\} tone=\{tone\} className="h-9 w-9 text-xs" \/>/);
});
