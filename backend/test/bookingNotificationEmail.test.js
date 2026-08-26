import assert from "node:assert/strict";
import test from "node:test";
import { bookingEmailContent } from "../src/services/bookingNotificationService.js";

const baseAppointment = {
  id: "appointment-1",
  subject: "Initial consultation",
  startsAt: new Date("2026-07-21T14:00:00.000Z"),
  endsAt: new Date("2026-07-21T14:30:00.000Z"),
  location: "Downtown Office — 100 King Street West, Toronto",
  locationMapsUrl: "https://maps.google.com/?q=100+King+Street+West",
  assignedTo: { fullName: "Avery Singh" },
};

const agency = {
  name: "North Star Immigration",
  email: "hello@example.test",
  phone: "+1 416 555 0100",
};

test("booking email presents branded appointment details and safe actions", () => {
  const email = bookingEmailContent({
    appointment: baseAppointment,
    kind: "booked",
    agency,
    timezone: "America/Toronto",
    contactName: "Jordan Lee",
    manageUrl: "https://case-desk.example/book/manage/token-1",
  });

  assert.match(email.subject, /Appointment confirmed/);
  assert.match(email.html, /North Star Immigration/);
  assert.match(email.html, /Open directions/);
  assert.match(email.html, /Reschedule or cancel/);
  assert.match(email.html, /Avery Singh/);
  assert.match(email.text, /Add|Directions:/);
});

test("payment request clearly remains unconfirmed, shows expiry, and does not claim an ICS is attached", () => {
  const email = bookingEmailContent({
    appointment: { ...baseAppointment, status: "AwaitingPayment" },
    kind: "payment_requested",
    agency,
    timezone: "America/Toronto",
    contactName: "Jordan Lee",
    manageUrl: null,
    payNowUrl: "https://payments.example.test/invoice/1001",
    amount: 150,
    expiresAt: new Date("2026-07-21T13:30:00.000Z"),
    includeIcs: false,
  });

  assert.match(email.html, /Not confirmed yet/);
  assert.match(email.html, /booked only after payment is completed/);
  assert.match(email.html, /Pay consultation fee/);
  assert.match(email.text, /not confirmed until payment is completed/i);
  assert.match(email.text, /Reservation expires:/);
  assert.doesNotMatch(email.html, /A calendar file is attached/);
  assert.match(email.html, /separate confirmation with your calendar file/);
});

test("payment request for an existing consultation asks for payment without claiming it is unbooked", () => {
  const email = bookingEmailContent({
    appointment: { ...baseAppointment, status: "Completed", paymentRequestForBookedAppointment: true },
    kind: "payment_requested",
    agency,
    timezone: "America/Toronto",
    contactName: "Jordan Lee",
    manageUrl: null,
    payNowUrl: "https://payments.example.test/invoice/1002",
    amount: 150,
    includeIcs: false,
  });

  assert.match(email.html, /Payment outstanding/);
  assert.match(email.html, /consultation fee remains due/i);
  assert.match(email.text, /consultation is already recorded/i);
  assert.doesNotMatch(email.html, /Not confirmed yet|booked only after payment/);
  assert.doesNotMatch(email.text, /not confirmed until payment/i);
});

test("booking email escapes visitor-controlled content", () => {
  const email = bookingEmailContent({
    appointment: { ...baseAppointment, subject: '<img src=x onerror="alert(1)">' },
    kind: "booked",
    agency,
    timezone: "America/Toronto",
    contactName: "<script>bad()</script>",
    manageUrl: "https://case-desk.example/book/manage/token-1",
  });

  assert.doesNotMatch(email.html, /<script>|<img src=x/);
  assert.match(email.html, /&lt;script&gt;bad\(\)&lt;\/script&gt;/);
  assert.match(email.html, /&lt;img src=x onerror=&quot;alert\(1\)&quot;&gt;/);
});

test("booking email uses the workspace avatar ahead of the legacy logo", () => {
  const email = bookingEmailContent({
    appointment: baseAppointment,
    kind: "booked",
    agency: { ...agency, logoUrl: "https://legacy.example.test/logo.png" },
    timezone: "America/Toronto",
    contactName: "Jordan Lee",
    manageUrl: "https://case-desk.example/book/manage/token-1",
    brandImageUrl: "cid:workspace-avatar-appointment-1@casedesk",
  });

  assert.match(email.html, /src="cid:workspace-avatar-appointment-1@casedesk"/);
  assert.match(email.html, /border-radius:50%/);
  assert.doesNotMatch(email.html, /legacy\.example\.test/);
});

test("online and cancelled emails show only relevant actions", () => {
  const online = bookingEmailContent({
    appointment: { ...baseAppointment, location: null, locationMapsUrl: null, meetingUrl: "https://meet.example.test/room" },
    kind: "reminder",
    agency,
    timezone: "America/Toronto",
    contactName: "Jordan Lee",
    manageUrl: "https://case-desk.example/book/manage/token-1",
  });
  assert.match(online.html, /Join Jitsi appointment/);
  assert.doesNotMatch(online.html, /Open directions/);

  const cancelled = bookingEmailContent({
    appointment: baseAppointment,
    kind: "cancelled",
    agency,
    timezone: "America/Toronto",
    contactName: "Jordan Lee",
    manageUrl: "https://case-desk.example/book/manage/token-1",
  });
  assert.doesNotMatch(cancelled.html, /Reschedule or cancel|Open directions/);
  assert.match(cancelled.html, /No action is required/);
  assert.doesNotMatch(cancelled.text, /Manage appointment/);
});

test("phone emails say that CHK calls the client and never ask the client to dial", () => {
  const email = bookingEmailContent({
    appointment: {
      ...baseAppointment,
      meetingMode: "Phone",
      meetingPhoneNumber: "+16475550100",
      guestPhone: "+14165550199",
      location: null,
      locationMapsUrl: null,
    },
    kind: "booked",
    agency,
    timezone: "America/Toronto",
    contactName: "Jordan Lee",
    manageUrl: "https://case-desk.example/book/manage/token-1",
    phoneCallInstructions: "Keep your phone nearby at the scheduled time.",
  });

  assert.match(email.html, /North Star Immigration will call \+14165550199 from \+16475550100/);
  assert.match(email.html, /Keep your phone nearby/);
  assert.match(email.html, /Manage appointment/);
  assert.doesNotMatch(email.html, /href="tel:/);
  assert.match(email.text, /Format: Phone call/);
});

test("in-person emails always include a friendly early-arrival note, phone emails always include a friendly timing note, and neither shows up for Zoom", () => {
  const inPerson = bookingEmailContent({
    appointment: { ...baseAppointment, meetingMode: "InPerson", location: "Main Office — 123 Main St" },
    kind: "booked",
    agency,
    timezone: "America/Toronto",
    contactName: "Jordan Lee",
    manageUrl: "https://case-desk.example/book/manage/token-1",
  });
  assert.match(inPerson.html, /Please try to arrive no more than 10 minutes before your appointment time/);
  assert.match(inPerson.text, /Please try to arrive no more than 10 minutes before your appointment time/);

  const phone = bookingEmailContent({
    appointment: { ...baseAppointment, meetingMode: "Phone", meetingPhoneNumber: "+16475550100", location: null, locationMapsUrl: null },
    kind: "booked",
    agency,
    timezone: "America/Toronto",
    contactName: "Jordan Lee",
    manageUrl: "https://case-desk.example/book/manage/token-1",
  });
  assert.match(phone.html, /call timing can shift a little depending on how many appointments/);
  assert.match(phone.text, /call timing can shift a little depending on how many appointments/);

  const zoom = bookingEmailContent({
    appointment: { ...baseAppointment, meetingMode: "Zoom", meetingUrl: "https://zoom.us/j/123", location: null, locationMapsUrl: null },
    kind: "booked",
    agency,
    timezone: "America/Toronto",
    contactName: "Jordan Lee",
    manageUrl: "https://case-desk.example/book/manage/token-1",
  });
  assert.doesNotMatch(zoom.html, /arrive no more than 10 minutes/);
  assert.doesNotMatch(zoom.html, /call timing can shift/);

  // A cancellation shouldn't tell someone to arrive early or expect a call.
  const cancelled = bookingEmailContent({
    appointment: { ...baseAppointment, meetingMode: "InPerson", location: "Main Office — 123 Main St" },
    kind: "cancelled",
    agency,
    timezone: "America/Toronto",
    contactName: "Jordan Lee",
    manageUrl: "https://case-desk.example/book/manage/token-1",
  });
  assert.doesNotMatch(cancelled.html, /arrive no more than 10 minutes/);
});

test("Zoom emails identify Zoom separately from Jitsi", () => {
  const email = bookingEmailContent({
    appointment: {
      ...baseAppointment,
      meetingMode: "Zoom",
      meetingUrl: "https://zoom.us/j/123456789",
      location: null,
      locationMapsUrl: null,
    },
    kind: "booked",
    agency,
    timezone: "America/Toronto",
    contactName: "Jordan Lee",
    manageUrl: "https://case-desk.example/book/manage/token-1",
  });

  assert.match(email.html, /Zoom video call/);
  assert.match(email.html, /Join Zoom appointment/);
  assert.doesNotMatch(email.html, /Jitsi/);
});

test("a remapped Zoom host sends an updated link without claiming the time changed", () => {
  const email = bookingEmailContent({
    appointment: {
      ...baseAppointment,
      meetingMode: "Zoom",
      meetingUrl: "https://zoom.us/j/987654321",
      location: null,
      locationMapsUrl: null,
    },
    kind: "meeting_updated",
    agency,
    timezone: "America/Toronto",
    contactName: "Jordan Lee",
    manageUrl: "https://case-desk.example/book/manage/token-1",
  });

  assert.match(email.subject, /Zoom link updated/);
  assert.match(email.text, /time has not changed/i);
  assert.match(email.html, /Join Zoom appointment/);
});

test("a format-only change does not tell the client their appointment time moved", () => {
  const email = bookingEmailContent({
    appointment: {
      ...baseAppointment,
      meetingMode: "Phone",
      meetingPhoneNumber: "+16475550100",
      guestPhone: "+14165550199",
      location: null,
      locationMapsUrl: null,
    },
    kind: "format_updated",
    agency,
    timezone: "America/Toronto",
    contactName: "Jordan Lee",
    manageUrl: "https://case-desk.example/book/manage/token-1",
  });

  assert.match(email.subject, /Appointment format updated/);
  assert.match(email.text, /date and time remain the same/i);
  assert.doesNotMatch(email.text, /moved to the new date/i);
  assert.match(email.text, /Format: Phone call/);
});

test("a consultant-only change explains that the appointment time and format stay the same", () => {
  const email = bookingEmailContent({
    appointment: {
      ...baseAppointment,
      assignedTo: { fullName: "New Consultant" },
    },
    kind: "assignment_updated",
    agency,
    timezone: "America/Toronto",
    contactName: "Jordan Lee",
    manageUrl: "https://case-desk.example/book/manage/token-1",
  });

  assert.match(email.subject, /Appointment consultant updated/);
  assert.match(email.text, /consultant for your appointment has changed/i);
  assert.match(email.text, /date, time, and format remain the same/i);
  assert.match(email.text, /With: New Consultant/);
  assert.doesNotMatch(email.text, /appointment has been moved/i);
});
