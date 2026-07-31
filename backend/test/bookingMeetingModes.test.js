import assert from "node:assert/strict";
import test from "node:test";
import {
  MEETING_MODES,
  appointmentMeetingFields,
  assertMeetingModeConfigured,
  meetingModeLabel,
  paymentHoldMeetingFields,
} from "../src/services/bookingMeetingModeService.js";
import { appointmentFieldsAfterZoomDeletion } from "../src/services/appointmentMeetingService.js";
import {
  leadConsultationAppointmentType,
  leadConsultationStatusForAppointment,
  syncLeadConsultationFromAppointment,
} from "../src/services/leadConsultationAppointmentService.js";

test("phone bookings snapshot the CHK caller ID for later notifications", () => {
  const settings = { phoneBookingEnabled: true, phoneCallerId: "+16475550100" };
  assert.doesNotThrow(() => assertMeetingModeConfigured({
    settings,
    mode: MEETING_MODES.PHONE,
    guestPhone: "+14165550199",
  }));
  assert.deepEqual(appointmentMeetingFields({ mode: MEETING_MODES.PHONE, settings }), {
    meetingMode: "Phone",
    meetingUrl: null,
    meetingPhoneNumber: "+16475550100",
    meetingProvider: null,
    meetingProviderId: null,
    meetingProviderHostId: null,
    meetingSyncStatus: "NotRequired",
    meetingSyncError: null,
  });
  assert.equal(paymentHoldMeetingFields({ mode: MEETING_MODES.PHONE, settings }).meetingPhoneNumber, "+16475550100");
});

test("phone bookings require both an enabled caller ID and a valid client number", () => {
  assert.throws(() => assertMeetingModeConfigured({
    settings: { phoneBookingEnabled: true, phoneCallerId: "+16475550100" },
    mode: MEETING_MODES.PHONE,
    guestPhone: "123",
  }), /Client phone number is invalid/);
  assert.throws(() => assertMeetingModeConfigured({
    settings: { phoneBookingEnabled: true },
    mode: MEETING_MODES.PHONE,
    guestPhone: "+14165550199",
  }), /not configured/);
});

test("Jitsi is ready immediately while Zoom waits for the durable worker", () => {
  const jitsi = appointmentMeetingFields({ mode: MEETING_MODES.JITSI, settings: {} });
  const zoom = appointmentMeetingFields({ mode: MEETING_MODES.ZOOM, settings: {} });
  assert.match(jitsi.meetingUrl, /^https:\/\/meet\.jit\.si\/CaseDesk-/);
  assert.equal(jitsi.meetingSyncStatus, "Ready");
  assert.equal(zoom.meetingUrl, null);
  assert.equal(zoom.meetingProvider, "Zoom");
  assert.equal(zoom.meetingSyncStatus, "Pending");
  assert.equal(meetingModeLabel(MEETING_MODES.ZOOM), "Zoom video call");
});

test("deleting an obsolete Zoom meeting preserves a replacement Jitsi link", () => {
  const fields = appointmentFieldsAfterZoomDeletion({
    status: "Scheduled",
    meetingMode: "Online",
    meetingUrl: "https://meet.jit.si/CaseDesk-replacement",
  });
  assert.equal(fields.meetingUrl, "https://meet.jit.si/CaseDesk-replacement");
  assert.equal(fields.meetingProvider, "Jitsi");
  assert.equal(fields.meetingSyncStatus, "Ready");

  const cancelled = appointmentFieldsAfterZoomDeletion({
    status: "Cancelled",
    meetingMode: "Zoom",
    meetingUrl: "https://zoom.us/j/obsolete",
  });
  assert.equal(cancelled.meetingUrl, null);
  assert.equal(cancelled.meetingProvider, null);
  assert.equal(cancelled.meetingSyncStatus, "NotRequired");
});

test("linked lead consultations mirror appointment format and status", () => {
  assert.equal(leadConsultationAppointmentType("InPerson"), "IN_PERSON");
  assert.equal(leadConsultationAppointmentType("Phone"), "PHONE");
  assert.equal(leadConsultationAppointmentType("Online"), "JITSI");
  assert.equal(leadConsultationAppointmentType("Zoom"), "ZOOM");
  assert.equal(leadConsultationStatusForAppointment("Completed"), "COMPLETED");
  assert.equal(leadConsultationStatusForAppointment("Cancelled"), "CANCELLED");
  assert.equal(leadConsultationStatusForAppointment("NoShow"), "NO_SHOW");
  assert.equal(leadConsultationStatusForAppointment("Scheduled"), "SCHEDULED");
});

test("appointment cancellation is added to lead history once", async () => {
  const activities = [];
  const db = {
    leadConsultation: {
      findFirst: async () => ({ id: "consultation-1", agencyId: "agency-1", leadId: "lead-1" }),
      updateMany: async () => ({ count: 1 }),
    },
    leadActivity: {
      findFirst: async ({ where }) => activities.find((item) => item.externalId === where.externalId) || null,
      create: async ({ data }) => {
        activities.push(data);
        return data;
      },
    },
  };
  const appointment = {
    id: "appointment-1",
    agencyId: "agency-1",
    leadId: "lead-1",
    startsAt: new Date("2026-07-30T15:00:00.000Z"),
    endsAt: new Date("2026-07-30T16:00:00.000Z"),
    updatedAt: new Date("2026-07-29T14:00:00.000Z"),
    cancelledAt: new Date("2026-07-29T13:55:00.000Z"),
    cancelledById: "user-1",
    cancellationReason: "Client requested a different date.",
    meetingMode: "Online",
    meetingUrl: "https://meet.jit.si/example",
  };

  await syncLeadConsultationFromAppointment(db, appointment, { consultationStatus: "CANCELLED" });
  await syncLeadConsultationFromAppointment(db, appointment, { consultationStatus: "CANCELLED" });

  assert.equal(activities.length, 1);
  assert.equal(activities[0].activityType, "CONSULTATION_CANCELLED");
  assert.equal(activities[0].title, "Consultation cancelled");
  assert.equal(activities[0].performedById, "user-1");
  assert.equal(activities[0].occurredAt.toISOString(), "2026-07-29T13:55:00.000Z");
  assert.match(activities[0].externalId, /^appointment:appointment-1:consultation:cancelled:/);
});
