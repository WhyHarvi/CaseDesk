import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { delegateLeadBacklog } from "../src/modules/leads/lead.service.js";

function fakeDb(leads) {
  const created = [];
  const collaborators = [];
  const tx = {
    leadCollaborator: {
      upsert: async ({ create }) => { collaborators.push(create); return create; },
    },
    leadFollowUp: {
      findFirst: async ({ where }) => created.find((item) => item.leadId === where.leadId) || null,
      create: async ({ data }) => { const row = { id: `task-${created.length + 1}`, ...data }; created.push(row); return row; },
    },
    leadActivity: { create: async () => {} },
    activityLog: { create: async () => {} },
  };
  return {
    created,
    collaborators,
    user: { findMany: async ({ where }) => where.id.in.map((id) => ({ id })) },
    leadFollowUp: { groupBy: async () => [] },
    lead: { findMany: async () => leads },
    $transaction: async (operation) => operation(tx),
  };
}

test("backlog delegation balances work without changing lead ownership", async () => {
  const leads = [
    { id: "lead-1", leadNumber: "LD-1", ownerUserId: "owner" },
    { id: "lead-2", leadNumber: "LD-2", ownerUserId: "owner" },
    { id: "lead-3", leadNumber: "LD-3", ownerUserId: "owner" },
  ];
  const db = fakeDb(leads);
  const result = await delegateLeadBacklog({ auth: { agencyId: "agency", userId: "admin" }, body: { targetUserIds: ["c1", "c2"] } }, db);
  assert.deepEqual(result.delegated.map((item) => item.assignedUserId), ["c1", "c2", "c1"]);
  assert.deepEqual(leads.map((lead) => lead.ownerUserId), ["owner", "owner", "owner"]);
  assert.deepEqual(db.collaborators.map((item) => item.userId), ["c1", "c2", "c1"]);
  assert.ok(db.created.every((item) => item.description === "Collaborative lead outreach" && item.type === "PHONE_CALL"));
});

test("delegation never assigns the owner as their own collaborator", async () => {
  const db = fakeDb([{ id: "lead-1", leadNumber: "LD-1", ownerUserId: "c1" }]);
  const result = await delegateLeadBacklog({ auth: { agencyId: "agency", userId: "admin" }, body: { targetUserIds: ["c1", "c2"] } }, db);
  assert.equal(result.delegated[0].assignedUserId, "c2");
  assert.equal(result.delegated[0].ownerUserId, "c1");
});

test("targeted preview filters by owner and performs no writes", async () => {
  let receivedWhere = null;
  const db = fakeDb([{ id: "lead-1", leadNumber: "LD-1", ownerUserId: "manpreet" }]);
  db.lead.findMany = async ({ where }) => {
    receivedWhere = where;
    return [{ id: "lead-1", leadNumber: "LD-1", ownerUserId: "manpreet" }];
  };
  db.$transaction = async () => { throw new Error("preview must not write"); };
  const result = await delegateLeadBacklog({ auth: { agencyId: "agency", userId: "admin" }, body: { ownerUserId: "manpreet", targetUserIds: ["simar"], preview: true } }, db);
  assert.equal(receivedWhere.ownerUserId, "manpreet");
  assert.equal(result.eligibleCount, 1);
  assert.equal(db.created.length, 0);
});

test("delegation endpoint is admin-only and UI explains incentive preservation", async () => {
  const [routes, panel, incentives] = await Promise.all([
    readFile(new URL("../src/modules/leads/lead.routes.js", import.meta.url), "utf8"),
    readFile(new URL("../../frontend/src/modules/leads/components/LeadRoutingRulesPanel.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/services/incentiveCreditingService.js", import.meta.url), "utf8"),
  ]);
  assert.match(routes, /router\.post\("\/delegate-backlog", requireRole\("admin"\), asyncHandler\(delegateLeadBacklog\)\)/);
  assert.match(panel, /Ownership and incentive credit were preserved/);
  assert.match(incentives, /leadOwnerUserId:\s*lead\?\.ownerUserId/);
});

test("a durable collaborator can close the owner's overdue follow-ups without taking ownership", async () => {
  const [service, detailSheet] = await Promise.all([
    readFile(new URL("../src/modules/leads/lead.service.js", import.meta.url), "utf8"),
    readFile(new URL("../../frontend/src/modules/leads/components/LeadDetailSheet.jsx", import.meta.url), "utf8"),
  ]);
  assert.match(service, /leadCollaborator\.findUnique\(\{ where: \{ leadId_userId:/);
  assert.match(service, /delegated collaborator, or an administrator can close this follow-up/);
  assert.match(detailSheet, /role === "admin" \|\| ownsLead \|\| collaboratesOnLead \|\| item\.assignedUserId === appUser\?\.id/);
});
