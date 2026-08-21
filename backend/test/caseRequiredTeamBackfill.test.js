import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { getCasesMissingRequiredTeam } from "../src/services/caseRequiredTeamService.js";

const source = (relativePath) => readFile(new URL(relativePath, import.meta.url), "utf8");

const AGENCY_ID = "agency-1";
const RCIC_ROLE = { id: "role-rcic", code: "rcic", name: "RCIC" };
const WORKER_ROLE = { id: "role-worker", code: "case-worker", name: "Case Worker" };

function fakeDb({ cases }) {
  return {
    agencyCaseRole: {
      // ensureRequiredCaseRoles upserts both required roles on every call —
      // a fake db only needs to hand back the same two rows each time.
      upsert: async ({ where }) => (where.agencyId_code.code === "rcic" ? RCIC_ROLE : WORKER_ROLE),
    },
    case: {
      findMany: async () => cases,
    },
  };
}

test("getCasesMissingRequiredTeam only reports cases missing an RCIC and/or a Case Worker, not fully-staffed ones", async () => {
  const db = fakeDb({
    cases: [
      {
        id: "case-complete",
        caseType: "Study Permit",
        assignedUserId: "user-rcic",
        client: { fullName: "Fully Staffed" },
        roleAssignments: [
          { caseRoleId: RCIC_ROLE.id, userId: "user-rcic" },
          { caseRoleId: WORKER_ROLE.id, userId: "user-worker" },
        ],
      },
      {
        id: "case-missing-worker",
        caseType: "Work Permit",
        assignedUserId: "user-rcic",
        client: { fullName: "Missing Worker" },
        roleAssignments: [{ caseRoleId: RCIC_ROLE.id, userId: "user-rcic" }],
      },
      {
        id: "case-missing-both",
        caseType: "Visitor Visa",
        assignedUserId: null,
        client: { fullName: "Missing Both" },
        roleAssignments: [],
      },
    ],
  });

  const missing = await getCasesMissingRequiredTeam(AGENCY_ID, db);
  assert.equal(missing.length, 2);
  const byId = Object.fromEntries(missing.map((item) => [item.caseId, item]));
  assert.equal(byId["case-missing-worker"].rcicUserId, "user-rcic");
  assert.equal(byId["case-missing-worker"].caseWorkerUserId, null);
  assert.equal(byId["case-missing-both"].rcicUserId, null);
  assert.equal(byId["case-missing-both"].caseWorkerUserId, null);
  assert.ok(!("case-complete" in byId), "a case with both roles filled must not be reported");
});

test("backfillRequiredCaseTeams applies the same sole-eligible-candidate default every other automated path uses, preserves existing collaborators, and reports the rest for manual review", async () => {
  const service = await source("../src/services/caseRequiredTeamService.js");
  const fnStart = service.indexOf("export async function backfillRequiredCaseTeams(");
  const fnBody = service.slice(fnStart, service.indexOf("\n}\n", fnStart));

  assert.match(fnBody, /getCasesMissingRequiredTeam\(agencyId, db\)/);
  assert.match(fnBody, /requiredCaseTeamOptions\(agencyId, db\)/);
  // Sole-eligible-candidate default, same rule as every other automated
  // case-creation path (public booking, bulk import, etc.).
  assert.match(fnBody, /if \(options\.rcicUsers\.length === 1\) rcicUserId = options\.rcicUsers\[0\]\.id;/);
  assert.match(fnBody, /if \(options\.caseWorkerUsers\.length === 1\) caseWorkerUserId = options\.caseWorkerUsers\[0\]\.id;/);
  // Falls back to the case's current assignee only if they're actually
  // eligible for the role — never invents attribution for someone who
  // isn't qualified.
  assert.match(fnBody, /options\.rcicUsers\.some\(\(user\) => user\.id === item\.assignedUserId\)/);
  assert.match(fnBody, /options\.caseWorkerUsers\.some\(\(user\) => user\.id === item\.assignedUserId\)/);
  // Never blocks/throws — an unresolved case is reported back, not failed.
  assert.match(fnBody, /if \(!rcicUserId \|\| !caseWorkerUserId\) \{/);
  assert.match(fnBody, /stillNeedsReview\.push/);
  // Existing supporting collaborators are read back and re-passed through,
  // so applyRequiredCaseTeam's full-replace semantics don't silently strip
  // anyone already on the case for an unrelated reason.
  assert.match(fnBody, /caseAssignment\.findMany\(\{\s*\n\s*where: \{ agencyId, caseId: item\.caseId, assignmentType: "supporting", status: "active" \},/);
  assert.match(fnBody, /collaboratorUserIds: existingCollaborators\.map\(\(row\) => row\.consultantUserId\),/);
  assert.match(fnBody, /return \{ fixedCount, stillNeedsReviewCount: stillNeedsReview\.length, stillNeedsReview \};/);
});

test("the backfill endpoint is admin-only, rate-limited, and reuses the same required-team logic Collaboration itself uses", async () => {
  const [controller, routes] = await Promise.all([
    source("../src/controllers/caseTeamController.js"),
    source("../src/routes/caseRoutes.js"),
  ]);
  assert.match(controller, /export async function backfillCaseTeams\(req, res\) \{\s*\n\s*const data = await backfillRequiredCaseTeams\(req\.auth\.agencyId, req\.auth\.userId\);/);
  assert.match(
    routes,
    /router\.post\(\s*\n\s*"\/collaboration-backfill",\s*\n\s*requireRole\("admin"\),\s*\n\s*rateLimit\(\{ windowMs: 60_000, max: 5 \}\),\s*\n\s*asyncHandler\(backfillCaseTeams\),\s*\n\);/,
  );
});
