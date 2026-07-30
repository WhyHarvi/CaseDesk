import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { intersectWorkingHours, localDateTimeToUtc, mergeStaffAvailability, slotsForDay, validateAvailabilityRange } from "../src/services/bookingAvailabilityService.js";
import { chooseAppointmentAssignee } from "../src/services/schedulingAssignmentService.js";
import { bookingDeliveryIsCurrent, bookingMessageRevision, icsForAppointment } from "../src/services/bookingNotificationService.js";
import { delayedZoomNotificationKind } from "../src/services/appointmentMeetingService.js";

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
  const db = {
    bookingSessionTypeStaff: { findMany: async () => [] },
    user: { findMany: async () => [user] },
    appointment: { findMany: async () => [], groupBy: async () => [] },
    // A paid waitlist checkout temporarily has both rows for one seat.
    bookingSlotHold: { findMany: async () => [{ assignedToId: "alpha", startsAt: start, endsAt: end }] },
    bookingPaymentHold: { findMany: async () => [{ assignedToId: "alpha", startsAt: start, endsAt: end }] },
  };
  const chosen = await chooseAppointmentAssignee({
    agencyId: "agency",
    startsAt: new Date("2026-08-03T14:00:00Z"),
    endsAt: new Date("2026-08-03T14:30:00Z"),
    db,
  });
  assert.equal(chosen.id, "alpha");

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
  assert.match(page, /getPublicBookingPaymentHoldStatus\(token, claimToken\)/);
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

test("the public booking flow asks attendance format before service, office, or time", async () => {
  const page = await readFile(new URL("../../frontend/src/pages/PublicBookingPage.jsx", import.meta.url), "utf8");
  const formatStart = page.indexOf('step === "format"');
  const serviceStart = page.indexOf('step === "service"', formatStart);
  const formatSource = page.slice(formatStart, serviceStart);
  assert.ok(formatStart >= 0 && serviceStart > formatStart);
  assert.match(formatSource, /How would you like to meet\?/);
  assert.doesNotMatch(formatSource, /What would you like to book\?/);
  assert.match(page, /matchingTypes\.length > 1 \? "service" : mode === "InPerson" \? "location" : "time"/);
  assert.match(page, /step === "service"[\s\S]*What would you like to book\?/);
  assert.match(page, /sessionTypesForMode\("InPerson"\)\.some\(sessionTypeHasLocation\)/);
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
