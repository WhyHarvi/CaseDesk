import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("consultants, front desk, and managers can edit only their own validated profile", async () => {
  const [controller, routes, settings] = await Promise.all([
    readFile(new URL("../src/controllers/consultantProfileController.js", import.meta.url), "utf8"),
    readFile(new URL("../src/routes/consultantRoutes.js", import.meta.url), "utf8"),
    readFile(new URL("../../frontend/src/pages/Settings.jsx", import.meta.url), "utf8"),
  ]);
  assert.match(routes, /router\.get\("\/me\/profile", requireRole\("consultant", "frontdesk", "manager"\)/);
  assert.match(routes, /router\.patch\("\/me\/profile", requireRole\("consultant", "frontdesk", "manager"\)/);
  assert.match(routes, /router\.get\("\/me\/avatar", requireRole\("consultant", "frontdesk", "manager"\)/);
  assert.match(routes, /router\.delete\("\/me\/avatar", requireRole\("consultant", "frontdesk", "manager"\)/);
  assert.match(routes, /router\.use\(requireRole\("consultant"\)\)/);
  assert.match(controller, /where: \{ id: req\.auth\.userId, agencyId: req\.auth\.agencyId, role: \{ in: \["consultant", "frontdesk", "manager"\] \} \}/);
  assert.match(controller, /if \(!fullName\) throw createHttpError\(400, "Full name is required/);
  assert.match(controller, /data: \{[\s\S]*?fullName,[\s\S]*?phone/);
  assert.match(controller, /Consultant changed their name from/);
  assert.match(settings, /data\.append\("fullName", form\.fullName\.trim\(\)\)/);
  assert.match(settings, />\s*Full name\s*</);
  assert.doesNotMatch(settings, /Your name and sign-in email are managed by an/);
});
