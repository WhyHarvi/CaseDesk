import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { overdueLeadWhere, planOverdueAlerts, runOverdueLeadAlertForAgency } from "../src/modules/leads/lead.overdueAlert.service.js";

test("overdue-lead where clause scopes to open, standard-pipeline leads whose next action is past due", () => {
  const now = new Date("2026-08-13T16:00:00.000Z");
  const where = overdueLeadWhere("agency-1", now);

  assert.equal(where.agencyId, "agency-1");
  assert.equal(where.status, "OPEN");
  assert.equal(where.pipelineSegment, "STANDARD");
  assert.equal(where.deletedAt, null);
  assert.equal(where.nextActionAt.lt, now);
});

test("the notify plan flags an owner for the admin alert only once their overdue count reaches the threshold", () => {
  const grouped = [
    { ownerUserId: "owner-a", _count: 3 },
    { ownerUserId: "owner-b", _count: 5 },
    { ownerUserId: "owner-c", _count: 12 },
    { ownerUserId: null, _count: 4 },
    { ownerUserId: "owner-d", _count: 0 },
  ];

  const plan = planOverdueAlerts(grouped, 5);

  assert.deepEqual(plan, [
    { ownerId: "owner-a", count: 3, notifyAdmin: false },
    { ownerId: "owner-b", count: 5, notifyAdmin: true },
    { ownerId: "owner-c", count: 12, notifyAdmin: true },
  ]);
});

test("nothing is planned when no lead is overdue", () => {
  assert.deepEqual(planOverdueAlerts([], 5), []);
});

function buildFakeDb({ settings, grouped = [] }) {
  const settingsUpdates = [];
  const db = {
    leadSettings: {
      findUnique: async () => settings,
      update: async ({ data }) => { settingsUpdates.push(data); return { ...settings, ...data }; },
    },
    lead: {
      groupBy: async () => grouped,
    },
  };
  return { db, settingsUpdates };
}

test("a disabled agency is skipped without touching the database", async () => {
  const { db, settingsUpdates } = buildFakeDb({ settings: { id: "settings-1", agencyId: "agency-1", overdueAlertEnabled: false } });

  const result = await runOverdueLeadAlertForAgency("agency-1", db);

  assert.deepEqual(result, { agencies: 0, ownersNotified: 0, adminAlertsSent: 0 });
  assert.equal(settingsUpdates.length, 0);
});

test("an enabled agency records the run even with a fake db (real notifyUsers calls only fire against the live prisma client)", async () => {
  const now = new Date("2026-08-13T16:00:00.000Z");
  const { db, settingsUpdates } = buildFakeDb({
    settings: { id: "settings-1", agencyId: "agency-1", overdueAlertEnabled: true, overdueAlertAdminThreshold: 5 },
    grouped: [{ ownerUserId: "owner-a", _count: 8 }],
  });

  const result = await runOverdueLeadAlertForAgency("agency-1", db, now);

  // With a fake (non-prisma) db, notifyUsers is intentionally never called —
  // it always hits the real database internally and isn't injectable, so
  // every mutating caller in this codebase gates it behind `db === prisma`.
  assert.deepEqual(result, { agencies: 1, ownersNotified: 0, adminAlertsSent: 0 });
  assert.equal(settingsUpdates[0].overdueAlertLastRunAt, now);
});

test("attentionLevel: 'update' is set on both notify calls, which is what makes them digest-eligible", async () => {
  const source = await readFile(new URL("../src/modules/leads/lead.overdueAlert.service.js", import.meta.url), "utf8");
  const occurrences = source.match(/attentionLevel:\s*"update"/g) || [];
  assert.equal(occurrences.length, 2);
});

test("the overdue-alert worker is wired into server.js startup and shutdown, and the settings route accepts the two new fields", async () => {
  const [serverSource, leadService] = await Promise.all([
    readFile(new URL("../src/server.js", import.meta.url), "utf8"),
    readFile(new URL("../src/modules/leads/lead.service.js", import.meta.url), "utf8"),
  ]);
  assert.match(serverSource, /startLeadOverdueAlertWorker\(\)/);
  assert.match(serverSource, /stopLeadOverdueAlertWorker\(\)/);
  assert.match(leadService, /"overdueAlertEnabled"/);
  assert.match(leadService, /overdueAlertAdminThreshold/);
});
