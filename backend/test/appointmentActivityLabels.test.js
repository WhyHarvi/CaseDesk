import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("appointment activity uses the session type and rejects receipt text as a title", async () => {
  const controller = await source("../src/controllers/bookingController.js");
  const calendar = await source("../../frontend/src/pages/CalendarPage.jsx");

  assert.match(controller, /PAYMENT_DETAILS_IN_SUBJECT/);
  assert.match(controller, /`\$\{sessionType\?\.name \|\| subject\} booked for/);
  assert.match(controller, /`\$\{existing\.sessionType\?\.name \|\| existing\.subject\} rescheduled`/);
  assert.match(controller, /sessionType: \{ select: \{ name: true, bufferMinutes: true/);
  assert.match(calendar, /Use an appointment title such as Initial Consultation\. Enter the e-transfer transaction number in the payment field\./);
});
