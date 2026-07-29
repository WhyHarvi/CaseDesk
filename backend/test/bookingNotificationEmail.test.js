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
  assert.match(online.html, /Join online appointment/);
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
