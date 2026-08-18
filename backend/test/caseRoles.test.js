import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = (relativePath) => readFile(new URL(relativePath, import.meta.url), "utf8");

test("case-role settings CRUD mirrors the fee-category admin-list pattern", async () => {
  const [service, controller, routes] = await Promise.all([
    source("../src/services/caseRoleService.js"),
    source("../src/controllers/caseRoleController.js"),
    source("../src/routes/caseRoleRoutes.js"),
  ]);

  // Reads are open to any staff, writes are admin-only — same split as
  // feeCategoryRoutes.js.
  assert.match(routes, /router\.get\("\/", asyncHandler\(list\)\)/);
  assert.match(routes, /router\.post\("\/", requireRole\("admin"\)/);
  assert.match(routes, /router\.patch\("\/:id", requireRole\("admin"\)/);
  assert.match(routes, /router\.delete\("\/:id", requireRole\("admin"\)/);

  // Built-in roles can be hidden but never hard-deleted, and a role already
  // assigned on a case can't be deleted out from under that history either —
  // both guards mirror deleteFeeCategory's shape.
  assert.match(service, /if \(current\.isSystem\) throw createHttpError\(409, "Built-in case roles can be hidden but not deleted\."/);
  assert.match(service, /prisma\.caseRoleAssignment\.count\(\{ where: \{ agencyId, caseRoleId: id \} \}\)/);
  assert.match(service, /throw createHttpError\(409, "This role is already assigned on a case\. Hide it instead/);

  // Duplicate code/name is a real unique constraint (agencyId, code), not
  // just app-level validation — confirm the P2002 translation exists so a
  // duplicate submit gets a real error message instead of a raw 500.
  assert.match(service, /error\?\.code === "P2002"/);

  assert.match(controller, /listCaseRoles\(req\.auth\.agencyId/);
  assert.match(controller, /createCaseRole\(req\.auth\.agencyId, req\.body/);
});

test("per-case incentive role assignments are scoped, validated, and wired under /cases/:id/roles", async () => {
  const [controller, caseRoutes] = await Promise.all([
    source("../src/controllers/caseRoleAssignmentController.js"),
    source("../src/routes/caseRoutes.js"),
  ]);

  // Nested under the case router's existing requireCaseAccess() gate — no
  // separate admin restriction, matching the decision that anyone who can
  // already edit the case can edit its incentive-role holders.
  assert.match(caseRoutes, /router\.get\("\/:id\/roles", asyncHandler\(listCaseRoleAssignments\)\)/);
  assert.match(caseRoutes, /router\.put\("\/:id\/roles", asyncHandler\(replaceCaseRoleAssignments\)\)/);
  assert.match(caseRoutes, /router\.delete\("\/:id\/roles\/:assignmentId", asyncHandler\(removeCaseRoleAssignment\)\)/);
  assert.match(caseRoutes, /router\.use\("\/:id", requireCaseAccess\(\)\)/);

  // A restored/active, non-archived case is required before roles can change.
  assert.match(controller, /if \(caseItem\.archivedAt\) throw createHttpError\(409, "Restore this case before changing its incentive roles\."/);

  // The PUT is replace-style: dedupes (caseRoleId, userId) pairs, validates
  // every referenced role/user belongs to this agency and is active, then
  // diffs against the existing set inside one transaction rather than
  // blindly deleting-and-recreating everything (which would needlessly
  // rewrite assignedAt/assignedById on rows that didn't actually change).
  assert.match(controller, /const toRemove = existing\.filter\(\(row\) => !nextKeys\.has/);
  assert.match(controller, /if \(existingByKey\.has\(`\$\{pair\.caseRoleId\}:\$\{pair\.userId\}`\)\) continue;/);
  assert.match(controller, /validRoleIds\.has\(pair\.caseRoleId\) \|\| !validUserIds\.has\(pair\.userId\)/);
  assert.match(controller, /await prisma\.\$transaction\(async \(tx\) => \{/);
});

test("case roles and case-role assignments are mounted with the same auth chain as sibling admin-list routes", async () => {
  const server = await source("../src/server.js");
  assert.match(
    server,
    /app\.use\(\s*"\/api\/case-roles",\s*requireAuth,\s*staffUser,\s*requirePortalPage\("cases"\),\s*caseRoleRoutes,\s*\);/,
  );
});
