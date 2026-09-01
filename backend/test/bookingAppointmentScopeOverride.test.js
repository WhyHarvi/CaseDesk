import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { portalDataScope, normalizePortalAccess } from "../src/services/portalAccessService.js";

const source = (relativePath) =>
  readFile(new URL(relativePath, import.meta.url), "utf8");

// Helper: mock a request object with auth and optional permissions
function mockRequest(role, userId, { cases = "assigned" } = {}) {
  const agencyId = "agency-1";
  return {
    auth: {
      role,
      userId,
      agencyId,
      permissions: {
        portalAccess: normalizePortalAccess(role, {
          data: { cases },
        }),
      },
    },
    params: {},
    body: {},
  };
}

// ==================== UNIT TESTS: portalDataScope and defaults ====================

test("portalDataScope returns 'all' for admin regardless of settings", () => {
  const req = mockRequest("admin", "admin-1");
  assert.equal(portalDataScope(req, "cases"), "all");
});

test("portalDataScope returns consultant's case scope setting", () => {
  const assigned = mockRequest("consultant", "consultant-1", { cases: "assigned" });
  const all = mockRequest("consultant", "consultant-1", { cases: "all" });
  const none = mockRequest("consultant", "consultant-1", { cases: "none" });

  assert.equal(portalDataScope(assigned, "cases"), "assigned");
  assert.equal(portalDataScope(all, "cases"), "all");
  assert.equal(portalDataScope(none, "cases"), "none");
});

test("portalDataScope defaults to 'assigned' for consultant with no explicit settings", () => {
  const req = mockRequest("consultant", "consultant-1");
  assert.equal(portalDataScope(req, "cases"), "assigned");
});

test("consultant default portal access uses 'assigned' case scope, not 'all'", async () => {
  const accessService = await source("../src/services/portalAccessService.js");

  // Verify that the default consultant access uses "assigned" for cases
  assert.match(accessService, /data: \{ leads: "assigned", clients: "assigned", cases: "assigned" \}/);

  // Verify the scope values are limited to the known set
  assert.match(accessService, /const dataScopes = new Set\(\["none", "assigned", "all"\]\)/);
});

test("normal consultant restrictions still apply with default 'assigned' scope", () => {
  const req = mockRequest("consultant", "consultant-1", { cases: "assigned" });

  // With default scope, consultant should be restricted
  const scope = portalDataScope(req, "cases");
  assert.equal(scope, "assigned");

  // The check `scope !== "all"` evaluates to true, meaning restriction applies
  const shouldRestrict = scope !== "all";
  assert.equal(shouldRestrict, true);
});

test("admin-granted all-scope overrides consultant appointment restrictions", () => {
  const req = mockRequest("consultant", "consultant-1", { cases: "all" });

  // With admin-override scope, consultant gets unrestricted access
  const scope = portalDataScope(req, "cases");
  assert.equal(scope, "all");

  // The check `scope !== "all"` evaluates to false, meaning no restriction
  const shouldRestrict = scope !== "all";
  assert.equal(shouldRestrict, false);
});

test("frontdesk always gets all-scope access to cases", () => {
  // Create frontdesk request with no data scope override (use default)
  const agencyId = "agency-1";
  const req = {
    auth: {
      role: "frontdesk",
      userId: "frontdesk-1",
      agencyId,
      permissions: {
        portalAccess: normalizePortalAccess("frontdesk"),
      },
    },
  };

  // Frontdesk's role bypasses the check entirely (role !== "consultant")
  // and by default has "all" scope for cases
  const scope = portalDataScope(req, "cases");
  assert.equal(scope, "all");
});

// ==================== SOURCE-TEXT VERIFICATION TESTS ====================
// These tests verify that the scope override logic is correctly implemented in the controller.
// They act as regression checks: if someone removes the scope check, these will fail.

test("all 6 appointment mutation endpoints use the scope-override check", async () => {
  const controller = await source("../src/controllers/bookingController.js");

  // Verify portalDataScope is imported
  assert.match(controller, /import \{ (?:.*\s+)?portalDataScope(?:\s+.*?)?\s*\} from/);

  // Count exact text matches of the scope check pattern
  const exactPattern = 'req.auth.role === "consultant" && portalDataScope(req, "cases") !== "all" ? { assignedToId: req.auth.userId } : {}';
  let count = 0;
  let idx = 0;
  while ((idx = controller.indexOf(exactPattern, idx)) !== -1) {
    count++;
    idx += exactPattern.length;
  }
  assert.equal(count, 6, "should have exactly 6 scope-override checks in the controller");
});

test("updateBookingAppointmentStatus applies scope restriction in its appointment lookup", async () => {
  const controller = await source("../src/controllers/bookingController.js");

  // Find the function
  const funcStart = controller.indexOf("export async function updateBookingAppointmentStatus");
  assert.ok(funcStart > -1, "updateBookingAppointmentStatus should exist");

  // Extract a reasonable section after the function declaration
  const section = controller.slice(funcStart, funcStart + 600);

  // Should have the scope-check pattern
  assert.match(section, /prisma\.appointment\.findFirst/);
  assert.match(section, /req\.auth\.role === "consultant" && portalDataScope\(req, "cases"\) !== "all"/);
  assert.match(section, /assignedToId: req\.auth\.userId/);

  // Verify it's being used to gate access, not just as a comment
  assert.match(section, /\.\.\.\(req\.auth\.role === "consultant"/);
});

test("cancelBookingAppointment applies scope restriction in main appointment lookup", async () => {
  const controller = await source("../src/controllers/bookingController.js");

  const funcStart = controller.indexOf("export async function cancelBookingAppointment");
  assert.ok(funcStart > -1, "cancelBookingAppointment should exist");

  const section = controller.slice(funcStart, funcStart + 700);

  // Should have the scope-check pattern in a findFirst
  assert.match(section, /prisma\.appointment\.findFirst/);
  assert.match(section, /req\.auth\.role === "consultant" && portalDataScope\(req, "cases"\) !== "all"/);
  assert.match(section, /id: req\.params\.id/);
});

test("cancelBookingAppointment applies scope restriction in series lookup", async () => {
  const controller = await source("../src/controllers/bookingController.js");

  const funcStart = controller.indexOf("export async function cancelBookingAppointment");
  const nextFunc = controller.indexOf("export async function rescheduleBookingAppointment", funcStart);
  const section = controller.slice(funcStart, nextFunc);

  // Should find seriesKey query with scope check
  assert.match(section, /seriesKey: existing\.seriesKey/);
  assert.match(section, /\.findMany/);

  // Count scope checks within cancelBookingAppointment — should have 2 (main + series)
  const scopeChecks = section.match(/req\.auth\.role === "consultant" && portalDataScope\(req, "cases"\) !== "all"/g) || [];
  assert.equal(scopeChecks.length, 2, "cancelBookingAppointment should have 2 scope checks (main + series)");
});

test("rescheduleBookingAppointment applies scope restriction in main lookup", async () => {
  const controller = await source("../src/controllers/bookingController.js");

  const funcStart = controller.indexOf("export async function rescheduleBookingAppointment");
  assert.ok(funcStart > -1, "rescheduleBookingAppointment should exist");

  const section = controller.slice(funcStart, funcStart + 800);

  // Should have scope check in findFirst
  assert.match(section, /prisma\.appointment\.findFirst/);
  assert.match(section, /status: \{ in: \["Scheduled", "NoShow"\]/);
  assert.match(section, /req\.auth\.role === "consultant" && portalDataScope\(req, "cases"\) !== "all"/);
  assert.match(section, /assignedToId: req\.auth\.userId/);
});

test("rescheduleBookingAppointment applies scope restriction in series lookup", async () => {
  const controller = await source("../src/controllers/bookingController.js");

  const funcStart = controller.indexOf("export async function rescheduleBookingAppointment");
  const nextFunc = controller.indexOf("export async function convertAppointmentToClient", funcStart);
  const section = controller.slice(funcStart, nextFunc);

  // Should find seriesKey query with scope check
  assert.match(section, /seriesKey: existing\.seriesKey/);
  assert.match(section, /\.findMany/);

  // Count scope checks — should have 2 (main + series)
  const scopeChecks = section.match(/req\.auth\.role === "consultant" && portalDataScope\(req, "cases"\) !== "all"/g) || [];
  assert.equal(scopeChecks.length, 2, "rescheduleBookingAppointment should have 2 scope checks (main + series)");
});

test("convertAppointmentToClient applies scope restriction in its lookup", async () => {
  const controller = await source("../src/controllers/bookingController.js");

  const funcStart = controller.indexOf("export async function convertAppointmentToClient");
  assert.ok(funcStart > -1, "convertAppointmentToClient should exist");

  const section = controller.slice(funcStart, funcStart + 500);

  // Should have scope check in findFirst
  assert.match(section, /prisma\.appointment\.findFirst/);
  assert.match(section, /req\.auth\.role === "consultant" && portalDataScope\(req, "cases"\) !== "all"/);
  assert.match(section, /assignedToId: req\.auth\.userId/);
});

test("all appointment scope checks use the same portal access domain ('cases')", async () => {
  const controller = await source("../src/controllers/bookingController.js");

  // Every scope check should use "cases" domain, not "leads" or "clients"
  const casesScopeChecks = controller.match(/portalDataScope\(req, "cases"\)/g) || [];
  const leadsScopeChecks = controller.match(/portalDataScope\(req, "leads"\)/g) || [];
  const clientsScopeChecks = controller.match(/portalDataScope\(req, "clients"\)/g) || [];

  assert.equal(casesScopeChecks.length, 6, "should use 'cases' domain exactly 6 times in appointment scope checks");
  assert.equal(leadsScopeChecks.length, 0, "should not use 'leads' domain in appointment scope checks");
  assert.equal(clientsScopeChecks.length, 0, "should not use 'clients' domain in appointment scope checks");
});

test("appointments scope check is only applied to consultants, not admins or frontdesk", async () => {
  const controller = await source("../src/controllers/bookingController.js");

  // The scope check explicitly gates on consultant role
  const scopeCheckPattern = 'req.auth.role === "consultant" && portalDataScope(req, "cases") !== "all"';
  assert.match(controller, new RegExp(scopeCheckPattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));

  // This means admins (role !== "consultant") and frontdesk (role !== "consultant")
  // will always get the {} branch (no restriction)
});

test("the fix preserves backward compatibility: default consultant behavior unchanged", () => {
  // Before: consultant always restricted to their own appointments
  // After: consultant with "assigned" scope still restricted (unchanged)
  //        consultant with "all" scope now unrestricted (new opt-in by admin)

  const assignedScope = mockRequest("consultant", "consultant-1", { cases: "assigned" });
  const assignedScopeValue = portalDataScope(assignedScope, "cases");

  // Default scope should still be "assigned", preserving old behavior
  assert.equal(assignedScopeValue, "assigned");

  // New behavior only activates when admin sets scope to "all"
  const allScope = mockRequest("consultant", "consultant-1", { cases: "all" });
  const allScopeValue = portalDataScope(allScope, "cases");
  assert.equal(allScopeValue, "all");
});
