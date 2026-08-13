import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { bulkReassignLeads } from "../src/modules/leads/lead.service.js";

function buildFakeDb({ leadsById, groupByRows = [], activeStaffIds }) {
  const historyCalls = [];
  const auditCalls = [];
  const tx = {
    lead: {
      findFirst: async ({ where }) => leadsById[where.id] || null,
      update: async ({ where, data }) => {
        Object.assign(leadsById[where.id], data);
        return leadsById[where.id];
      },
    },
    leadFollowUp: { updateMany: async () => {} },
    leadAssignmentHistory: { create: async ({ data }) => historyCalls.push(data) },
    leadActivity: { create: async () => {} },
    activityLog: { create: async ({ data }) => auditCalls.push(data) },
  };
  const db = {
    user: {
      findFirst: async ({ where }) => (activeStaffIds.has(where.id) ? { id: where.id, fullName: `Staff ${where.id}` } : null),
    },
    lead: {
      groupBy: async () => groupByRows,
    },
    $transaction: async (operation) => operation(tx),
  };
  return { db, historyCalls, auditCalls, leadsById };
}

test("bulk reassign gives each lead to whoever currently has the fewest open leads, correcting an imbalance", async () => {
  const leadsById = {
    "lead-1": { id: "lead-1", leadNumber: "LD-2026-000001", ownerUserId: "other-owner", stage: "CONTACTING" },
    "lead-2": { id: "lead-2", leadNumber: "LD-2026-000002", ownerUserId: "other-owner", stage: "CONTACTING" },
    "lead-3": { id: "lead-3", leadNumber: "LD-2026-000003", ownerUserId: "other-owner", stage: "CONTACTING" },
  };
  const { db } = buildFakeDb({
    leadsById,
    // target-1 already has 1 open lead, target-2 has 0.
    groupByRows: [{ ownerUserId: "target-1", _count: 1 }],
    activeStaffIds: new Set(["target-1", "target-2"]),
  });
  const req = {
    auth: { role: "admin", agencyId: "agency-1", userId: "admin-1" },
    body: { leadIds: ["lead-1", "lead-2", "lead-3"], targetUserIds: ["target-1", "target-2"] },
  };

  const result = await bulkReassignLeads(req, db);

  assert.deepEqual(result.skipped, []);
  // target-2 starts lowest (0 vs 1) so it wins lead-1, tying counts at 1-1;
  // the tie breaks toward target-1 (declared first) for lead-2, then
  // target-2 is lowest again for lead-3.
  assert.deepEqual(
    result.reassigned.map((item) => item.ownerUserId),
    ["target-2", "target-1", "target-2"],
  );
  assert.equal(leadsById["lead-1"].ownerUserId, "target-2");
  assert.equal(leadsById["lead-2"].ownerUserId, "target-1");
  assert.equal(leadsById["lead-3"].ownerUserId, "target-2");
});

test("bulk reassign tags history with ROUND_ROBIN and bumps a NEW lead to ASSIGNED", async () => {
  const leadsById = {
    "lead-1": { id: "lead-1", leadNumber: "LD-2026-000001", ownerUserId: "other-owner", stage: "NEW", nextActionOwnerId: "other-owner" },
  };
  const { db, historyCalls } = buildFakeDb({
    leadsById,
    groupByRows: [],
    activeStaffIds: new Set(["target-1"]),
  });
  const req = {
    auth: { role: "admin", agencyId: "agency-1", userId: "admin-1" },
    body: { leadIds: ["lead-1"], targetUserIds: ["target-1"] },
  };

  const result = await bulkReassignLeads(req, db);

  assert.equal(result.reassigned.length, 1);
  assert.equal(historyCalls[0].assignmentType, "ROUND_ROBIN");
  assert.equal(leadsById["lead-1"].stage, "ASSIGNED");
  assert.equal(leadsById["lead-1"].nextActionOwnerId, "target-1");
});

test("bulk reassign skips a lead already owned by the chosen target without affecting the rest", async () => {
  const leadsById = {
    "lead-1": { id: "lead-1", leadNumber: "LD-2026-000001", ownerUserId: "target-1", stage: "CONTACTING" },
    "lead-2": { id: "lead-2", leadNumber: "LD-2026-000002", ownerUserId: "other-owner", stage: "CONTACTING" },
  };
  const { db } = buildFakeDb({
    leadsById,
    groupByRows: [],
    activeStaffIds: new Set(["target-1"]),
  });
  const req = {
    auth: { role: "admin", agencyId: "agency-1", userId: "admin-1" },
    body: { leadIds: ["lead-1", "lead-2"], targetUserIds: ["target-1"] },
  };

  const result = await bulkReassignLeads(req, db);

  assert.equal(result.reassigned.length, 1);
  assert.equal(result.reassigned[0].id, "lead-2");
  assert.equal(result.skipped.length, 1);
  assert.equal(result.skipped[0].id, "lead-1");
  assert.match(result.skipped[0].reason, /already owned/i);
});

test("bulk reassign skips a lead that no longer exists without rolling back the rest of the batch", async () => {
  const leadsById = {
    "lead-1": { id: "lead-1", leadNumber: "LD-2026-000001", ownerUserId: "other-owner", stage: "CONTACTING" },
  };
  const { db } = buildFakeDb({
    leadsById,
    groupByRows: [],
    activeStaffIds: new Set(["target-1"]),
  });
  const req = {
    auth: { role: "admin", agencyId: "agency-1", userId: "admin-1" },
    body: { leadIds: ["missing-lead", "lead-1"], targetUserIds: ["target-1"] },
  };

  const result = await bulkReassignLeads(req, db);

  assert.equal(result.reassigned.length, 1);
  assert.equal(result.reassigned[0].id, "lead-1");
  assert.equal(result.skipped.length, 1);
  assert.equal(result.skipped[0].id, "missing-lead");
});

test("bulk reassign rejects a target who is not an active lead team member", async () => {
  const { db } = buildFakeDb({ leadsById: {}, groupByRows: [], activeStaffIds: new Set() });
  const req = {
    auth: { role: "admin", agencyId: "agency-1", userId: "admin-1" },
    body: { leadIds: ["lead-1"], targetUserIds: ["inactive-user"] },
  };

  await assert.rejects(
    () => bulkReassignLeads(req, db),
    (error) => error.code === "INVALID_LEAD_OWNER" && /active lead team member/i.test(error.message),
  );
});

test("bulk reassign requires at least one lead id", async () => {
  await assert.rejects(
    () => bulkReassignLeads({ auth: { role: "admin", agencyId: "agency-1", userId: "admin-1" }, body: { leadIds: [], targetUserIds: ["target-1"] } }, {}),
    /Select at least one lead/,
  );
});

test("bulk reassign requires at least one target team member", async () => {
  await assert.rejects(
    () => bulkReassignLeads({ auth: { role: "admin", agencyId: "agency-1", userId: "admin-1" }, body: { leadIds: ["lead-1"], targetUserIds: [] } }, {}),
    /Select at least one team member/,
  );
});

test("the reassign-bulk route is admin-only and the standard Leads page wires it up alongside bulk promote", async () => {
  const [routes, leadsPage, reassignModal] = await Promise.all([
    readFile(new URL("../src/modules/leads/lead.routes.js", import.meta.url), "utf8"),
    readFile(new URL("../../frontend/src/modules/leads/pages/LeadsPage.jsx", import.meta.url), "utf8"),
    readFile(new URL("../../frontend/src/modules/leads/components/BulkReassignLeadsModal.jsx", import.meta.url), "utf8"),
  ]);
  assert.match(routes, /router\.post\("\/reassign-bulk", requireRole\("admin"\), asyncHandler\(bulkReassignLeads\)\)/);
  assert.match(leadsPage, /canBulkReassign = segment === "STANDARD" && role === "admin"/);
  assert.match(leadsPage, /canBulkSelect = canBulkPromote \|\| canBulkReassign/);
  assert.match(reassignModal, /api\.post\("\/leads\/reassign-bulk", \{ leadIds, targetUserIds: \[\.\.\.selectedStaffIds\] \}\)/);
});
