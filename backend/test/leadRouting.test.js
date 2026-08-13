import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createLeadRoutingRule, matchLeadRoutingRules, resolveRoutedOwner, updateLeadRoutingRule } from "../src/modules/leads/lead.routing.service.js";
import { createLead } from "../src/modules/leads/lead.service.js";

function rule(overrides = {}) {
  return { id: "rule-1", name: "rule-1", isActive: true, sortOrder: 0, conditions: [], targetUserId: "target-1", ...overrides };
}

test("a substring field matches case-insensitively as a substring of the lead's text", () => {
  const rules = [rule({ conditions: [{ field: "initialMessage", value: "study permit" }] })];

  const matches = matchLeadRoutingRules(rules, { initialMessage: "Hi, I need help with a STUDY PERMIT application" });

  assert.equal(matches.length, 1);
  assert.equal(matches[0].id, "rule-1");
});

test("a substring value can list comma-separated alternatives — any one of them matching is enough", () => {
  const rules = [rule({ conditions: [{ field: "initialMessage", value: "study, study permit, student visa" }] })];

  assert.equal(matchLeadRoutingRules(rules, { initialMessage: "I want to know about the study permit process" }).length, 1);
  assert.equal(matchLeadRoutingRules(rules, { initialMessage: "Looking into a student visa" }).length, 1);
  assert.equal(matchLeadRoutingRules(rules, { initialMessage: "I'd like a work permit instead" }).length, 0);
});

test("an exact field requires the whole trimmed value to match, case-insensitively", () => {
  const rules = [rule({ conditions: [{ field: "province", value: "Ontario" }] })];

  assert.equal(matchLeadRoutingRules(rules, { province: "  ontario  " }).length, 1);
  assert.equal(matchLeadRoutingRules(rules, { province: "Ontario, Canada" }).length, 0);
});

test("all conditions on a rule must match — it's an AND, not an OR", () => {
  const rules = [rule({ conditions: [{ field: "province", value: "Ontario" }, { field: "priority", value: "HIGH" }] })];

  assert.equal(matchLeadRoutingRules(rules, { province: "Ontario", priority: "HIGH" }).length, 1);
  assert.equal(matchLeadRoutingRules(rules, { province: "Ontario", priority: "NORMAL" }).length, 0);
});

test("a rule with zero conditions never matches, so it can't silently catch every lead", () => {
  const rules = [rule({ conditions: [] })];

  assert.deepEqual(matchLeadRoutingRules(rules, { province: "Ontario", initialMessage: "anything" }), []);
});

test("originalSourceType is matched from the third argument, not the attrs object", () => {
  const rules = [rule({ conditions: [{ field: "originalSourceType", value: "website" }] })];

  assert.equal(matchLeadRoutingRules(rules, {}, "WEBSITE").length, 1);
  assert.equal(matchLeadRoutingRules(rules, {}, "OOMA").length, 0);
});

test("matches come back ordered by sortOrder so the caller can walk them in priority order", () => {
  const rules = [
    rule({ id: "rule-b", sortOrder: 2, conditions: [{ field: "province", value: "Ontario" }] }),
    rule({ id: "rule-a", sortOrder: 1, conditions: [{ field: "province", value: "Ontario" }] }),
  ];

  const matches = matchLeadRoutingRules(rules, { province: "Ontario" });

  assert.deepEqual(matches.map((item) => item.id), ["rule-a", "rule-b"]);
});

test("no active rule matches returns an empty array, not null or undefined", () => {
  assert.deepEqual(matchLeadRoutingRules([rule({ conditions: [{ field: "province", value: "Ontario" }] })], { province: "Quebec" }), []);
});

function routingTx({ rules, activeUserIds }) {
  const updates = [];
  return {
    leadRoutingRule: {
      findMany: async () => rules,
      update: async ({ where, data }) => updates.push({ id: where.id, data }),
    },
    user: {
      findFirst: async ({ where }) => (activeUserIds.has(where.id) ? { id: where.id } : null),
    },
    updates,
  };
}

test("resolveRoutedOwner falls through to the next-best rule when the first match's target has gone inactive", async () => {
  const tx = routingTx({
    rules: [
      rule({ id: "rule-1", sortOrder: 1, targetUserId: "inactive-user", conditions: [{ field: "province", value: "Ontario" }] }),
      rule({ id: "rule-2", sortOrder: 2, targetUserId: "active-user", conditions: [{ field: "province", value: "Ontario" }] }),
    ],
    activeUserIds: new Set(["active-user"]),
  });

  const result = await resolveRoutedOwner(tx, "agency-1", { province: "Ontario" }, "WEBSITE");

  assert.equal(result.ownerUserId, "active-user");
  assert.equal(result.ruleId, "rule-2");
  assert.equal(tx.updates.length, 1);
  assert.equal(tx.updates[0].id, "rule-2");
  assert.deepEqual(tx.updates[0].data.matchCount, { increment: 1 });
});

test("resolveRoutedOwner returns null when nothing matches, or every match's target is stale", async () => {
  const tx = routingTx({
    rules: [rule({ targetUserId: "inactive-user", conditions: [{ field: "province", value: "Ontario" }] })],
    activeUserIds: new Set(),
  });

  assert.equal(await resolveRoutedOwner(tx, "agency-1", { province: "Ontario" }, "WEBSITE"), null);
  assert.equal(await resolveRoutedOwner(tx, "agency-1", { province: "Quebec" }, "WEBSITE"), null);
});

function createLeadTx({ routingRules = [], activeStaffIds }) {
  const created = [];
  return {
    $queryRaw: async () => [{ lock_status: "" }],
    client: { findFirst: async () => null },
    leadSource: { findFirst: async ({ where }) => (where.id === "source-1" ? { id: "source-1", type: "WEBSITE" } : null) },
    leadRoutingRule: { findMany: async () => routingRules, update: async () => {} },
    user: {
      findMany: async ({ where }) => where.id.in.filter((id) => activeStaffIds.has(id)).map((id) => ({ id })),
      findFirst: async ({ where }) => (activeStaffIds.has(where.id) ? { id: where.id } : null),
    },
    leadCampaign: { findFirst: async () => null },
    agencyLeadSequence: { upsert: async () => ({ nextValue: 2 }) },
    lead: {
      findFirst: async () => null,
      create: async ({ data }) => ({ id: "lead-1", ...data }),
    },
    leadActivity: { create: async () => {} },
    leadStageHistory: { create: async () => {} },
    leadAssignmentHistory: { create: async ({ data }) => created.push(data) },
    leadFollowUp: { create: async () => {} },
    activityLog: { create: async () => {} },
    created,
  };
}

test("createLead resolves the owner from a matching routing rule when ownerUserId is omitted", async () => {
  const tx = createLeadTx({
    routingRules: [rule({ conditions: [{ field: "immigrationInterest", value: "study permit" }], targetUserId: "target-1" })],
    activeStaffIds: new Set(["target-1"]),
  });
  const db = { $transaction: async (operation) => operation(tx) };
  const req = {
    auth: { role: "consultant", agencyId: "agency-1", userId: "user-1" },
    body: {
      phone: "+14165550100",
      originalSourceId: "source-1",
      immigrationInterest: "Study Permit",
      nextActionType: "CALL",
      nextActionDescription: "Call the lead",
      nextActionAt: "2026-07-15T14:00:00Z",
    },
  };

  const lead = await createLead(req, db);

  assert.equal(lead.ownerUserId, "target-1");
  assert.equal(lead.nextActionOwnerId, "target-1");
  assert.equal(tx.created[0].assignmentType, "RULE_BASED");
  assert.match(tx.created[0].reason, /rule-1/);
});

test("createLead still requires ownerUserId when it's omitted and no rule matches — today's exact fallback", async () => {
  const tx = createLeadTx({ routingRules: [], activeStaffIds: new Set() });
  const db = { $transaction: async (operation) => operation(tx) };
  const req = {
    auth: { role: "consultant", agencyId: "agency-1", userId: "user-1" },
    body: {
      phone: "+14165550100",
      originalSourceId: "source-1",
      nextActionType: "CALL",
      nextActionDescription: "Call the lead",
      nextActionAt: "2026-07-15T14:00:00Z",
    },
  };

  await assert.rejects(
    () => createLead(req, db),
    (error) => error.message === "ownerUserId is required." && error.code === "VALIDATION_ERROR",
  );
});

test("createLead keeps assignmentType MANUAL when an explicit ownerUserId is supplied, exactly as before", async () => {
  const tx = createLeadTx({ routingRules: [rule({ conditions: [{ field: "province", value: "Ontario" }] })], activeStaffIds: new Set(["user-1"]) });
  const db = { $transaction: async (operation) => operation(tx) };
  const req = {
    auth: { role: "consultant", agencyId: "agency-1", userId: "user-1" },
    body: {
      phone: "+14165550100",
      ownerUserId: "user-1",
      originalSourceId: "source-1",
      province: "Ontario",
      nextActionType: "CALL",
      nextActionDescription: "Call the lead",
      nextActionAt: "2026-07-15T14:00:00Z",
    },
  };

  const lead = await createLead(req, db);

  assert.equal(lead.ownerUserId, "user-1");
  assert.equal(tx.created[0].assignmentType, "MANUAL");
});

test("the intake worker gives a routing-rule match priority over the intake stream's static owner", async () => {
  const source = await readFile(new URL("../src/modules/leads/lead.intake.worker.js", import.meta.url), "utf8");
  assert.match(source, /resolveRoutedOwner\(tx, event\.agencyId,/);
  assert.match(source, /const ownerUserId = routed\?\.ownerUserId \|\| event\.intakeForm\?\.ownerUserId/);
  assert.match(source, /assignmentType: routed \? "RULE_BASED" : "SYSTEM"/);
});

function crudTx({ existingRules = [], activeStaffIds }) {
  return {
    user: { findFirst: async ({ where }) => (activeStaffIds.has(where.id) ? { id: where.id, fullName: "Staff" } : null) },
    leadRoutingRule: {
      findFirst: async ({ where }) => existingRules.find((item) => {
        if (where.id !== undefined) {
          if (where.id && typeof where.id === "object") { if (item.id === where.id.not) return false; }
          else if (item.id !== where.id) return false;
        }
        if (where.name !== undefined && item.name !== where.name) return false;
        return true;
      }) || null,
      create: async ({ data }) => ({ ...data, id: "new-rule" }),
      update: async ({ where, data }) => ({ ...existingRules.find((item) => item.id === where.id), ...data }),
    },
  };
}

test("creating a routing rule rejects a duplicate name within the agency", async () => {
  const tx = crudTx({ existingRules: [{ id: "rule-1", name: "Study Permit" }], activeStaffIds: new Set(["target-1"]) });
  const db = { $transaction: async (operation) => operation(tx) };
  const req = {
    auth: { role: "admin", agencyId: "agency-1", userId: "admin-1" },
    body: { name: "Study Permit", targetUserId: "target-1", conditions: [{ field: "province", value: "Ontario" }] },
  };

  await assert.rejects(
    () => createLeadRoutingRule(req, db),
    (error) => error.code === "DUPLICATE_ROUTING_RULE",
  );
});

test("creating a routing rule rejects an unknown field, an empty value, and a target who isn't active staff", async () => {
  const tx = crudTx({ activeStaffIds: new Set(["target-1"]) });
  const db = { $transaction: async (operation) => operation(tx) };
  const base = { auth: { role: "admin", agencyId: "agency-1", userId: "admin-1" } };

  await assert.rejects(
    () => createLeadRoutingRule({ ...base, body: { name: "Rule", targetUserId: "target-1", conditions: [{ field: "notAField", value: "x" }] } }, db),
    /not a field a rule can match on/,
  );
  await assert.rejects(
    () => createLeadRoutingRule({ ...base, body: { name: "Rule", targetUserId: "target-1", conditions: [{ field: "province", value: "" }] } }, db),
    /needs a value/,
  );
  await assert.rejects(
    () => createLeadRoutingRule({ ...base, body: { name: "Rule", targetUserId: "inactive-user", conditions: [{ field: "province", value: "Ontario" }] } }, db),
    (error) => error.code === "INVALID_LEAD_OWNER",
  );
});

test("a bare isActive patch skips full revalidation, but a full edit re-checks the target and name uniqueness", async () => {
  const existing = { id: "rule-1", name: "Study Permit", targetUserId: "target-1", conditions: [{ field: "province", value: "Ontario" }], isActive: true, sortOrder: 0 };
  const tx = crudTx({ existingRules: [existing, { id: "rule-2", name: "Other Rule" }], activeStaffIds: new Set(["target-1", "target-2"]) });
  const db = { $transaction: async (operation) => operation(tx) };
  const base = { auth: { role: "admin", agencyId: "agency-1", userId: "admin-1" }, params: { id: "rule-1" } };

  const toggled = await updateLeadRoutingRule({ ...base, body: { isActive: false } }, db);
  assert.equal(toggled.isActive, false);
  assert.equal(toggled.targetUserId, "target-1");

  await assert.rejects(
    () => updateLeadRoutingRule({ ...base, body: { name: "Other Rule", targetUserId: "target-1", conditions: existing.conditions } }, db),
    (error) => error.code === "DUPLICATE_ROUTING_RULE",
  );

  const retargeted = await updateLeadRoutingRule({ ...base, body: { name: "Study Permit", targetUserId: "target-2", conditions: existing.conditions } }, db);
  assert.equal(retargeted.targetUserId, "target-2");
});

test("the routing-rule CRUD routes are admin-only", async () => {
  const routes = await readFile(new URL("../src/modules/leads/lead.routes.js", import.meta.url), "utf8");
  assert.match(routes, /router\.get\("\/routing-rules", requireRole\("admin"\), asyncHandler\(listLeadRoutingRules\)\)/);
  assert.match(routes, /router\.post\("\/routing-rules", requireRole\("admin"\), asyncHandler\(createLeadRoutingRule\)\)/);
  assert.match(routes, /router\.patch\("\/routing-rules\/:id", requireRole\("admin"\), asyncHandler\(updateLeadRoutingRule\)\)/);
  assert.match(routes, /router\.delete\("\/routing-rules\/:id", requireRole\("admin"\), asyncHandler\(deleteLeadRoutingRule\)\)/);
});
