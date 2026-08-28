import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { normalizeContactMatchInput } from "../src/services/contactDuplicateService.js";

test("calendar contact matching tolerates malformed legacy guest values", () => {
  assert.deepEqual(
    normalizeContactMatchInput({ email: "not-an-email", phone: "not a phone" }),
    { emailNormalized: null, phoneNormalized: null },
  );
});

test("calendar route uses tolerant legacy contact matching", async () => {
  const [controller, routes] = await Promise.all([
    readFile(new URL("../src/controllers/calendarController.js", import.meta.url), "utf8"),
    readFile(new URL("../src/routes/bookingRoutes.js", import.meta.url), "utf8"),
  ]);

  assert.match(controller, /normalizeContactMatchInput/);
  assert.match(controller, /\.map\(calendarContactMatch\)\s*\.filter\(Boolean\)/);
  assert.match(routes, /from "\.\.\/controllers\/calendarController\.js"/);
  assert.match(routes, /router\.get\("\/calendar", asyncHandler\(listCalendarAppointments\)\)/);
});
