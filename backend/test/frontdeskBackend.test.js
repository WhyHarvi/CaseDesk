import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  canCreateLead,
  leadAccessWhere,
} from "../src/modules/leads/lead.permissions.js";
import {
  parseLeadActivity,
  parseLeadAssignment,
  parseLeadFollowUp,
  parseLeadFollowUpOutcome,
  parseLeadLost,
  parseLeadNurture,
} from "../src/modules/leads/lead.validation.js";

const source = (relativePath) =>
  readFile(new URL(relativePath, import.meta.url), "utf8");

test("front desk receives agency-wide lead access without changing consultant scope", () => {
  assert.deepEqual(
    leadAccessWhere({ auth: { role: "admin", userId: "admin-1" } }),
    {},
  );
  assert.deepEqual(
    leadAccessWhere({ auth: { role: "consultant", userId: "consultant-1" } }),
    {
      AND: [
        {
          OR: [
            { ownerUserId: "consultant-1" },
            { followUps: { some: { assignedUserId: "consultant-1", status: "PENDING" } } },
          ],
        },
      ],
    },
  );
  assert.deepEqual(
    leadAccessWhere({ auth: { role: "frontdesk", userId: "frontdesk-1" } }),
    {},
  );
  assert.equal(canCreateLead({ auth: { role: "frontdesk" } }), true);
  assert.equal(canCreateLead({ auth: { role: "client" } }), false);
});

test("front desk role reaches only areas explicitly enabled by portal access", async () => {
  const [schema, auth, server] = await Promise.all([
    source("../prisma/schema.prisma"),
    source("../src/middleware/authMiddleware.js"),
    source("../src/server.js"),
  ]);
  assert.match(schema, /enum UserRole \{[\s\S]*frontdesk/);
  assert.match(auth, /\["admin", "consultant", "frontdesk", "client"\]/);
  assert.match(
    server,
    /const staffUser = requireRole\("admin", "consultant", "frontdesk"\)/,
  );
  assert.match(
    server,
    /const leadUser = requireRole\("admin", "consultant", "frontdesk"\)/,
  );
  assert.match(
    server,
    /app\.use\([\s\S]*?"\/api\/leads",[\s\S]*?requireAuth,[\s\S]*?leadUser,[\s\S]*?requireAnyPortalPage\("leads", "leadIntake"\),[\s\S]*?leadRoutes,[\s\S]*?\)/,
  );
  assert.match(
    server,
    /app\.use\([\s\S]*?"\/api\/clients",[\s\S]*?requireAuth,[\s\S]*?staffUser,[\s\S]*?requirePortalPage\("clients"\),[\s\S]*?clientRoutes,[\s\S]*?\)/,
  );
  assert.match(
    server,
    /app\.use\([\s\S]*?"\/api\/cases",[\s\S]*?requireAuth,[\s\S]*?staffUser,[\s\S]*?requirePortalPage\("cases"\),[\s\S]*?caseRoutes,[\s\S]*?\)/,
  );
});

test("lead router separates reception work from privileged decisions and administration", async () => {
  const routes = await source("../src/modules/leads/lead.routes.js");
  for (const path of [
    "/:id/activities",
    "/:id/follow-ups",
    "/:id/assign",
    "/:id/nurture",
    "/:id/lost",
    "/:id/consultations",
  ])
    assert.match(routes, new RegExp(path.replaceAll("/", "\\/")));
  assert.match(
    routes,
    /"\/:id\/qualify", requireRole\("admin", "consultant"\)/,
  );
  assert.match(
    routes,
    /"\/:id\/commercial-status", requireRole\("admin", "consultant"\)/,
  );
  assert.match(
    routes,
    /"\/:id\/convert", requireRole\("admin", "consultant"\)/,
  );
  assert.match(routes, /"\/dashboard", requireRole\("admin"\)/);
  assert.match(routes, /"\/intake\/operations", requireRole\("admin"\)/);
  assert.match(routes, /"\/intake\/connections", requireRole\("admin"\)/);
  assert.match(routes, /"\/imports", requireRole\("admin", "consultant"\)/);
});

test("front desk operational payloads are constrained and auditable", () => {
  const activity = parseLeadActivity({
    activityType: "OUTGOING_CALL",
    direction: "OUTBOUND",
    channel: "PHONE",
    title: "Called lead",
    durationSeconds: 120,
  });
  assert.equal(activity.activityType, "OUTGOING_CALL");
  assert.equal(activity.durationSeconds, 120);
  assert.throws(
    () =>
      parseLeadActivity({ activityType: "LEAD_CONVERTED", title: "Invalid" }),
    /activityType is invalid/,
  );

  const followUp = parseLeadFollowUp({
    assignedUserId: "user-1",
    type: "CALL",
    description: "Call tomorrow",
    dueAt: "2027-01-01T15:00:00Z",
  });
  assert.equal(followUp.assignedUserId, "user-1");
  assert.equal(
    parseLeadFollowUpOutcome({
      status: "COMPLETED",
      completionOutcome: "Reached client",
    }).status,
    "COMPLETED",
  );
  assert.throws(
    () =>
      parseLeadFollowUpOutcome({
        status: "PENDING",
        completionOutcome: "No change",
      }),
    /status is invalid/,
  );

  assert.equal(
    parseLeadAssignment({
      ownerUserId: "user-2",
      reason: "Assigned for intake",
    }).ownerUserId,
    "user-2",
  );
  assert.equal(
    parseLeadLost({ reasonCode: "NO_RESPONSE", notes: "Three attempts" })
      .reasonCode,
    "NO_RESPONSE",
  );
  assert.throws(
    () => parseLeadLost({ reasonCode: "MADE_UP", notes: "Invalid" }),
    /reasonCode is invalid/,
  );
  assert.ok(
    parseLeadNurture({
      nurtureUntil: "2030-01-01T00:00:00Z",
      reason: "Future intake",
    }).nurtureUntil instanceof Date,
  );
});

test("team member administration supports consultant and front desk without exposing admin creation", async () => {
  const [routes, controller] = await Promise.all([
    source("../src/routes/adminRoutes.js"),
    source("../src/controllers/adminTeamMemberController.js"),
  ]);
  assert.match(routes, /router\.use\(requireRole\("admin"\)\)/);
  assert.match(routes, /"\/team-members"/);
  assert.match(
    controller,
    /managedRoles = new Set\(\["consultant", "frontdesk"\]\)/,
  );
  assert.match(controller, /Role must be consultant or frontdesk/);
  assert.match(controller, /leadAccess: "all"/);
  assert.match(controller, /ROLE_CHANGE_NOT_ALLOWED/);
  assert.match(controller, /ACTIVE_ASSIGNMENTS/);
  assert.doesNotMatch(controller, /managedRoles[^\n]*admin/);
});

test("front desk RLS is limited to lead-domain policies", async () => {
  const [roleMigration, accessMigration] = await Promise.all([
    source(
      "../prisma/migrations/20260715215900_add_frontdesk_role/migration.sql",
    ),
    source(
      "../prisma/migrations/20260715220000_add_frontdesk_lead_access/migration.sql",
    ),
  ]);
  assert.match(
    roleMigration,
    /ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'frontdesk'/,
  );
  assert.match(
    accessMigration,
    /current_user_role\(\) IN \('admin','consultant','frontdesk'\)/,
  );
  assert.match(accessMigration, /lead_intake_forms_frontdesk_read/);
  assert.doesNotMatch(
    accessMigration,
    /ON "clients"|ON "cases"|ON "payments"|ON "client_documents"/,
  );
  assert.doesNotMatch(
    accessMigration,
    /lead_qualifications_(insert|update)[\s\S]*frontdesk/,
  );
});

test("the default lead list excludes converted leads unless a status is explicitly picked", async () => {
  const service = await source("../src/modules/leads/lead.service.js");
  const listSection = service.slice(
    service.indexOf("export async function listLeads"),
    service.indexOf("export async function getLead"),
  );
  assert.match(listSection, /\(status \? \{ status \} : \{ status: \{ not: "CONVERTED" \} \}\)/);
});

test("lead list search cannot replace assignment scope", async () => {
  const service = await source("../src/modules/leads/lead.service.js");
  const listSection = service.slice(
    service.indexOf("export async function listLeads"),
    service.indexOf("export async function getLead"),
  );
  assert.match(listSection, /AND: \[[\s\S]*leadAccessWhere\(req\)/);
  assert.doesNotMatch(
    listSection,
    /\.\.\.leadAccessWhere\(req\)[\s\S]*\.\.\.\(search \? \{ OR:/,
  );
});
