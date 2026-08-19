import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("calendar contact lookup can select and link an existing open lead", async () => {
  const [controller, routes, api, page, leadBooking] = await Promise.all([
    read("../src/controllers/bookingController.js"),
    read("../src/routes/bookingRoutes.js"),
    read("../../frontend/src/api/bookingApi.js"),
    read("../../frontend/src/pages/CalendarPage.jsx"),
    read("../src/modules/leads/lead.booking.js"),
  ]);
  assert.match(routes, /contact-lookup/);
  assert.match(controller, /export async function lookupBookingContacts/);
  assert.match(controller, /leadId: lead\?\.id \|\| null/);
  assert.match(controller, /createOrLinkLeadForConsultation/);
  assert.match(leadBooking, /leadId \? await tx\.lead\.findFirst/);
  assert.match(api, /lookupBookingContacts/);
  assert.match(page, /Lead selected:/);
  assert.match(page, /leadId: form\.mode === "guest"/);
  assert.match(page, /does not have a valid phone number saved/);
  assert.match(page, /form\.meetingMode === "Phone" && !hasValidPhoneBookingNumber/);
});
