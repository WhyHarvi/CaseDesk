import assert from "node:assert/strict";
import test from "node:test";
import { appointmentInsightIntent, crmMetricIntent, resolveCaseDeskAIInsight, resolveProactiveNovaInsight } from "../src/services/aiInsightService.js";

function request(role = "admin", permissions = {}) {
  return {
    auth: {
      agencyId: "agency-1",
      userId: "user-1",
      role,
      permissions,
    },
  };
}

function database({ count = 10, appointments = [], timezone = "America/Toronto" } = {}) {
  const calls = { count: [], findMany: [] };
  return {
    calls,
    appointment: {
      async count(args) { calls.count.push(args); return count; },
      async findMany(args) { calls.findMany.push(args); return appointments; },
    },
    bookingSettings: {
      async findUnique() { return { timezone }; },
    },
  };
}

test("Nova answers an upcoming personal appointment count from live scoped data", async () => {
  const db = database({ count: 10 });
  const now = new Date("2026-08-15T22:00:00.000Z");
  const result = await resolveCaseDeskAIInsight(
    request(),
    [{ role: "user", content: "How many appointments do I have in upcoming days?" }],
    { db, now },
  );

  assert.equal(result.answer, "You have 10 upcoming appointments. Would you like to see which days they are on?\n\n[Open Calendar](/app/calendar)");
  assert.deepEqual(db.calls.count[0].where, {
    agencyId: "agency-1",
    status: "Scheduled",
    startsAt: { gte: now },
    assignedToId: "user-1",
  });
  assert.equal(db.calls.findMany.length, 0);
});

test("an affirmative follow-up groups upcoming appointments by local calendar day", async () => {
  const db = database({
    count: 3,
    appointments: [
      { startsAt: "2026-08-16T14:00:00.000Z" },
      { startsAt: "2026-08-16T15:30:00.000Z" },
      { startsAt: "2026-08-18T17:00:00.000Z" },
    ],
  });
  const result = await resolveCaseDeskAIInsight(request(), [
    { role: "user", content: "How many appointments do I have?" },
    { role: "assistant", content: "You have 3 upcoming appointments. Would you like to see which days they are on?" },
    { role: "user", content: "Yes" },
  ], { db, now: new Date("2026-08-15T22:00:00.000Z") });

  assert.match(result.answer, /3 upcoming appointments are scheduled on 2 days/);
  assert.match(result.answer, /Sunday, Aug 16/);
  assert.match(result.answer, /10:00 a\.m\., 11:30 a\.m\./);
  assert.match(result.answer, /Tuesday, Aug 18/);
  assert.match(result.answer, /\/app\/calendar/);
});

test("saved access overrides cannot hide the shared staff Calendar", async () => {
  const permissions = { portalAccess: { pages: { calendar: false } } };
  const result = await resolveCaseDeskAIInsight(
    request("frontdesk", permissions),
    [{ role: "user", content: "How many upcoming appointments are there?" }],
    { db: database() },
  );
  assert.match(result.answer, /10 upcoming appointments/);
});

test("consultants are always limited to their own appointment scope", () => {
  assert.deepEqual(
    appointmentInsightIntent([{ role: "user", content: "How many appointments are upcoming?" }], "consultant"),
    { kind: "count", personal: true, question: "How many appointments are upcoming?" },
  );
});

test("Nova answers total leads from the Standard pipeline and states assigned and Import Review counts", async () => {
  const db = {
    lead: {
      async groupBy({ where }) {
        const values = where.ownerUserId
          ? { OPEN: 39 }
          : { OPEN: 145, NURTURE: 3, LOST: 38, CONVERTED: 23 };
        return Object.entries(values).map(([status, count]) => ({ status, _count: { _all: count } }));
      },
      async count() { return 64; },
    },
  };
  const result = await resolveCaseDeskAIInsight(
    request(),
    [{ role: "user", content: "How many total leads do I have?" }],
    { db },
  );

  assert.match(result.answer, /209 Standard-pipeline leads in total/);
  assert.match(result.answer, /145 open, 3 nurture, 38 lost, and 23 converted/);
  assert.match(result.answer, /39 leads are assigned directly to you/);
  assert.match(result.answer, /Import Review contains another 64 records/);
  assert.match(result.answer, /\[Open Leads\]\(\/leads\)/);
});

test("Nova resolves a named lead assignee instead of falling back to the authenticated user", async () => {
  const groupedWhere = [];
  const db = {
    user: {
      async findMany() {
        return [
          { id: "user-1", fullName: "Gagandeep Singh Dhillon", email: "gagandeep@example.com" },
          { id: "user-2", fullName: "Manpreet Kaur", email: "manpreet@example.com" },
        ];
      },
    },
    lead: {
      async groupBy({ where }) {
        groupedWhere.push(where);
        return [
          { status: "OPEN", _count: { _all: 7 } },
          { status: "NURTURE", _count: { _all: 2 } },
          { status: "CONVERTED", _count: { _all: 1 } },
        ];
      },
    },
  };
  const result = await resolveCaseDeskAIInsight(
    request(),
    [{ role: "user", content: "I want to see total lead sassigned to Manpreet" }],
    { db },
  );

  assert.equal(groupedWhere.length, 1);
  assert.equal(groupedWhere[0].ownerUserId, "user-2");
  assert.match(result.answer, /Manpreet Kaur has 10 Standard-pipeline leads assigned/);
  assert.match(result.answer, /7 open, 2 nurture, 0 lost, and 1 converted/);
  assert.doesNotMatch(result.answer, /assigned directly to you/);
});

test("Nova recognizes lead-count-for phrasing with a consultant's full or first name", async () => {
  const db = {
    user: {
      async findMany() {
        return [
          { id: "user-1", fullName: "Gagandeep Singh Dhillon", email: "gagandeep@example.com" },
          { id: "user-2", fullName: "Manpreet Kaur", email: "manpreet@example.com" },
        ];
      },
    },
    lead: {
      async groupBy({ where }) {
        assert.equal(where.ownerUserId, "user-2");
        return [{ status: "OPEN", _count: { _all: 7 } }];
      },
    },
  };

  for (const content of [
    "tell me the lead count for manpreet kaur consultant",
    "tell me the lead count for manpreet kaur",
  ]) {
    const result = await resolveCaseDeskAIInsight(request(), [{ role: "user", content }], { db });
    assert.match(result.answer, /Manpreet Kaur has 7 Standard-pipeline leads assigned/);
    assert.doesNotMatch(result.answer, /The workspace has/);
  }
});

test("Nova treats a bare named-assignment question as a live count request", async () => {
  const db = {
    user: {
      async findMany() {
        return [{
          id: "frontdesk-1",
          fullName: "Afi Mariam",
          email: "afi@example.com",
          memberships: [{ role: "frontdesk" }],
        }];
      },
    },
    lead: {
      async groupBy({ where }) {
        assert.deepEqual(where.ownerUserId, { in: ["frontdesk-1"] });
        return [
          { status: "OPEN", _count: { _all: 8 } },
          { status: "NURTURE", _count: { _all: 1 } },
          { status: "LOST", _count: { _all: 1 } },
          { status: "CONVERTED", _count: { _all: 2 } },
        ];
      },
    },
  };
  const result = await resolveCaseDeskAIInsight(
    request(),
    [{ role: "user", content: "leads assigned to frontdesk?" }],
    { db },
  );

  assert.match(result.answer, /Front desk staff have 12 Standard-pipeline leads assigned/);
});

test("named teammate lead totals require workspace-wide Lead data access", async () => {
  let queriedUsers = false;
  const db = {
    user: { async findMany() { queriedUsers = true; return []; } },
  };
  const result = await resolveCaseDeskAIInsight(
    request("consultant"),
    [{ role: "user", content: "How many leads are assigned to Manpreet?" }],
    { db },
  );

  assert.match(result.answer, /limited to records assigned to you/);
  assert.equal(queriedUsers, false);
});

test("Nova asks for a full name when a named lead assignee is ambiguous", async () => {
  const db = {
    user: {
      async findMany() {
        return [
          { id: "user-2", fullName: "Manpreet Kaur", email: "manpreet.kaur@example.com" },
          { id: "user-3", fullName: "Manpreet Singh", email: "manpreet.singh@example.com" },
        ];
      },
    },
  };
  const result = await resolveCaseDeskAIInsight(
    request(),
    [{ role: "user", content: "How many leads are assigned to Manpreet?" }],
    { db },
  );

  assert.match(result.answer, /more than one matching team member/);
  assert.match(result.answer, /Manpreet Kaur, Manpreet Singh/);
});

test("Nova turns incentive questions into an admin-only verified monthly performance summary", async () => {
  const seen = { conversions: null, appointments: null };
  const db = {
    user: {
      async findMany() {
        return [{ id: "user-2", fullName: "Manpreet Kaur", email: "manpreet@example.com", memberships: [{ role: "consultant" }] }];
      },
    },
    agency: { async findUnique() { return { timezone: "America/Toronto" }; } },
    lead: {
      async groupBy() {
        return [
          { status: "OPEN", _count: { _all: 10 } },
          { status: "CONVERTED", _count: { _all: 3 } },
          { status: "LOST", _count: { _all: 2 } },
        ];
      },
      async count({ where }) { seen.conversions = where; return 2; },
    },
    appointment: { async count({ where }) { seen.appointments = where; return 4; } },
    case: { async count() { return 6; } },
    followUp: {
      async count({ where }) {
        if (where.status === "Completed") return 5;
        if (where.dueDate?.lt) return 2;
        return 7;
      },
    },
    leadFollowUp: {
      async count({ where }) {
        if (where.status === "COMPLETED") return 1;
        if (where.dueAt?.lt) return 1;
        return 3;
      },
    },
  };
  const now = new Date("2026-08-16T13:00:00.000Z");
  const result = await resolveCaseDeskAIInsight(
    request(),
    [{ role: "user", content: "What are the incentives for Manpreet?" }],
    { db, now },
  );

  assert.match(result.answer, /verified performance summary—not an incentive amount/);
  assert.match(result.answer, /Manpreet Kaur · August 2026/);
  assert.match(result.answer, /15 Standard-pipeline leads \(10 open, 0 nurture, 3 converted, 2 lost\)/);
  assert.match(result.answer, /Leads converted this month: 2/);
  assert.match(result.answer, /Appointments attended this month: 4/);
  assert.match(result.answer, /Active cases currently owned: 6/);
  assert.match(result.answer, /Follow-ups completed this month: 6/);
  assert.match(result.answer, /Follow-ups currently pending: 10 \(3 overdue\)/);
  assert.match(result.answer, /\[Open Workload\]\(\/app\/workload\)/);
  assert.doesNotMatch(result.answer, /\$/);
  assert.equal(seen.conversions.ownerUserId, "user-2");
  assert.equal(seen.conversions.convertedAt.gte.toISOString(), "2026-08-01T04:00:00.000Z");
  assert.equal(seen.conversions.convertedAt.lt.toISOString(), "2026-09-01T04:00:00.000Z");
  assert.equal(seen.appointments.status, "Completed");
  assert.equal(seen.appointments.assignedToId, "user-2");
});

test("a structured conversational follow-up keeps the metric but changes the named teammate", async () => {
  const seenOwners = [];
  const db = {
    user: {
      async findMany() {
        return [
          { id: "user-2", fullName: "Manpreet Kaur", email: "manpreet@example.com", memberships: [{ role: "consultant" }] },
          { id: "user-3", fullName: "Harpreet Kaur", email: "harpreet@example.com", memberships: [{ role: "consultant" }] },
        ];
      },
    },
    agency: { async findUnique() { return { timezone: "America/Toronto" }; } },
    lead: {
      async groupBy({ where }) { seenOwners.push(where.ownerUserId); return [{ status: "OPEN", _count: { _all: 4 } }]; },
      async count({ where }) { seenOwners.push(where.ownerUserId); return 1; },
    },
    appointment: { async count({ where }) { assert.equal(where.assignedToId, "user-3"); return 2; } },
    case: { async count({ where }) { assert.equal(where.assignedUserId, "user-3"); return 3; } },
    followUp: { async count() { return 0; } },
    leadFollowUp: { async count() { return 0; } },
  };
  const structuredIntent = {
    kind: "metric",
    domain: "performance",
    metric: "summary",
    subject: { type: "team_member", name: "Harpreet Kaur", role: null },
    status: null,
    period: "current_month",
    compare: "none",
    confidence: 0.98,
    needsClarification: false,
  };
  const result = await resolveCaseDeskAIInsight(request(), [
    { role: "user", content: "What are the incentives for Manpreet?" },
    { role: "assistant", content: "Here is Manpreet's verified performance summary." },
    { role: "user", content: "What about Harpreet?" },
  ], { db, now: new Date("2026-08-16T13:00:00.000Z"), structuredIntent });

  assert.match(result.answer, /Harpreet Kaur · August 2026/);
  assert.doesNotMatch(result.answer, /Manpreet Kaur ·/);
  assert.ok(seenOwners.every((ownerId) => ownerId === "user-3"));
  assert.match(result.answer, /ownerUserId=user-3/);
  assert.match(result.answer, /assignedUserId=user-3/);
});

test("structured performance periods use the requested agency-local month", async () => {
  const windows = [];
  const db = {
    user: { async findMany() { return [{ id: "user-2", fullName: "Manpreet Kaur", email: "manpreet@example.com", memberships: [{ role: "consultant" }] }]; } },
    agency: { async findUnique() { return { timezone: "America/Toronto" }; } },
    lead: {
      async groupBy() { return []; },
      async count({ where }) { windows.push(where.convertedAt); return 0; },
    },
    appointment: { async count({ where }) { windows.push(where.startsAt); return 0; } },
    case: { async count() { return 0; } },
    followUp: {
      async count({ where }) {
        if (where.completedAt) windows.push(where.completedAt);
        return 0;
      },
    },
    leadFollowUp: {
      async count({ where }) {
        if (where.completedAt) windows.push(where.completedAt);
        return 0;
      },
    },
  };
  const result = await resolveCaseDeskAIInsight(
    request(),
    [{ role: "user", content: "Last month?" }],
    {
      db,
      now: new Date("2026-08-16T13:00:00.000Z"),
      structuredIntent: {
        kind: "metric",
        domain: "performance",
        metric: "summary",
        subject: { type: "team_member", name: "Manpreet Kaur", role: null },
        status: null,
        period: "previous_month",
        compare: "previous_period",
        confidence: 0.95,
        needsClarification: false,
      },
    },
  );

  assert.match(result.answer, /Manpreet Kaur · July 2026/);
  assert.match(result.answer, /Leads converted in July 2026/);
  assert.doesNotMatch(result.answer, /Compared with/);
  assert.equal(windows.length, 4);
  assert.ok(windows.every((window) => window.gte.toISOString() === "2026-07-01T04:00:00.000Z"));
  assert.ok(windows.every((window) => window.lt.toISOString() === "2026-08-01T04:00:00.000Z"));
});

test("an explicit comparison with last month compares the current month against the previous one", async () => {
  const windows = [];
  const db = {
    user: { async findMany() { return [{ id: "user-2", fullName: "Manpreet Kaur", email: "manpreet@example.com", memberships: [{ role: "consultant" }] }]; } },
    agency: { async findUnique() { return { timezone: "America/Toronto" }; } },
    lead: {
      async groupBy() { return []; },
      async count({ where }) { windows.push(where.convertedAt); return 1; },
    },
    appointment: { async count({ where }) { windows.push(where.startsAt); return 1; } },
    case: { async count() { return 0; } },
    followUp: {
      async count({ where }) {
        if (where.completedAt) windows.push(where.completedAt);
        return 0;
      },
    },
    leadFollowUp: {
      async count({ where }) {
        if (where.completedAt) windows.push(where.completedAt);
        return 0;
      },
    },
  };
  const result = await resolveCaseDeskAIInsight(
    request(),
    [{ role: "user", content: "Compare Manpreet performance with last month" }],
    { db, now: new Date("2026-08-16T13:00:00.000Z") },
  );

  assert.match(result.answer, /Manpreet Kaur · August 2026/);
  assert.match(result.answer, /Compared with July 2026/);
  assert.equal(windows.length, 8);
  assert.equal(windows.filter((window) => window.gte.toISOString() === "2026-08-01T04:00:00.000Z").length, 4);
  assert.equal(windows.filter((window) => window.gte.toISOString() === "2026-07-01T04:00:00.000Z").length, 4);
});

test("structured named appointment totals remain server-scoped to that active teammate", async () => {
  const db = {
    user: {
      async findMany() {
        return [{ id: "user-3", fullName: "Harpreet Kaur", email: "harpreet@example.com", memberships: [{ role: "consultant" }] }];
      },
    },
    appointment: {
      async count({ where }) {
        assert.equal(where.assignedToId, "user-3");
        return 5;
      },
    },
  };
  const result = await resolveCaseDeskAIInsight(
    request(),
    [{ role: "user", content: "What about Harpreet?" }],
    {
      db,
      structuredIntent: {
        kind: "metric",
        domain: "appointments",
        metric: "count",
        subject: { type: "team_member", name: "Harpreet Kaur", role: null },
        status: null,
        period: null,
        compare: "none",
        confidence: 0.95,
        needsClarification: false,
      },
    },
  );
  assert.match(result.answer, /Harpreet Kaur has 5 upcoming appointments/);
});

test("non-admin users cannot request another team member's performance summary", async () => {
  const result = await resolveCaseDeskAIInsight(
    request("consultant"),
    [{ role: "user", content: "What are the incentives for Manpreet?" }],
    { db: {} },
  );
  assert.match(result.answer, /Only workspace administrators/);
});

test("live lead totals are denied when both Leads and Lead Intake are disabled", async () => {
  const permissions = { portalAccess: { pages: { leads: false, leadIntake: false } } };
  const result = await resolveCaseDeskAIInsight(
    request("frontdesk", permissions),
    [{ role: "user", content: "How many total leads are there?" }],
    { db: {} },
  );
  assert.match(result.answer, /don’t currently have access to the Leads/);
});

test("consultant lead metrics carry the existing assigned-record access predicate into every aggregate", async () => {
  const groupedWhere = [];
  const db = {
    lead: {
      async groupBy({ where }) { groupedWhere.push(where); return []; },
      async count() { return 0; },
    },
  };
  await resolveCaseDeskAIInsight(
    request("consultant"),
    [{ role: "user", content: "How many total leads are visible to me?" }],
    { db },
  );
  assert.equal(groupedWhere.length, 2);
  for (const where of groupedWhere) {
    assert.equal(where.agencyId, "agency-1");
    assert.equal(where.pipelineSegment, "STANDARD");
    assert.equal(where.AND[0].AND[0].OR[0].ownerUserId, "user-1");
    assert.equal(where.AND[0].AND[0].OR[1].followUps.some.assignedUserId, "user-1");
  }
});

test("client and case metrics use their permission-aware access filters", async () => {
  const clientDb = {
    client: {
      async count({ where }) {
        if (where.archivedAt?.not === null) return 4;
        if (where.assignedUserId) return where.status === "Active" ? 8 : 9;
        return { Active: 80, Inactive: 10, Closed: 5, Lead: 5 }[where.status] ?? 100;
      },
    },
  };
  const clients = await resolveCaseDeskAIInsight(request(), [{ role: "user", content: "How many active clients do I have?" }], { db: clientDb });
  assert.match(clients.answer, /You have 8 active clients assigned to you/);

  const caseDb = {
    case: {
      async count({ where }) {
        const personal = Array.isArray(where.AND) && where.AND.length > 1;
        if (where.archivedAt?.not === null) return 6;
        if (where.status?.notIn) return personal ? 12 : 30;
        if (where.status?.in) return 14;
        return personal ? 15 : 50;
      },
    },
  };
  const cases = await resolveCaseDeskAIInsight(request(), [{ role: "user", content: "How many total cases do I have?" }], { db: caseDb });
  assert.match(cases.answer, /50 non-deleted cases in total: 30 active, 14 closed, and 6 archived/);
  assert.match(cases.answer, /assigned to or collaborating on 15 cases/);
});

test("follow-up totals merge case and Standard lead follow-ups using the same day boundary", async () => {
  const db = {
    agency: { async findUnique() { return { timezone: "America/Toronto" }; } },
    followUp: {
      async count({ where }) {
        if (where.status === "Completed") return 10;
        if (where.dueDate?.gte) return 1;
        if (where.dueDate?.lt) return 2;
        return 5;
      },
    },
    leadFollowUp: {
      async count({ where }) {
        if (where.status === "COMPLETED") return 4;
        if (where.dueAt?.gte) return 1;
        if (where.dueAt?.lt) return 1;
        return 3;
      },
    },
  };
  const result = await resolveCaseDeskAIInsight(
    request(),
    [{ role: "user", content: "How many pending follow ups are there?" }],
    { db, now: new Date("2026-08-15T22:00:00.000Z") },
  );
  assert.match(result.answer, /8 pending follow-ups across the workspace: 3 overdue and 2 due today/);
});

test("non-admin follow-up metrics never widen beyond the authenticated assignee", async () => {
  const seen = [];
  const db = {
    agency: { async findUnique() { return { timezone: "America/Toronto" }; } },
    followUp: { async count({ where }) { seen.push(where); return 0; } },
    leadFollowUp: { async count({ where }) { seen.push(where); return 0; } },
  };
  await resolveCaseDeskAIInsight(
    request("consultant"),
    [{ role: "user", content: "How many pending follow ups are there?" }],
    { db, now: new Date("2026-08-15T22:00:00.000Z") },
  );
  assert.ok(seen.length > 0);
  assert.ok(seen.every((where) => where.assignedUserId === "user-1"));
});

test("payment metrics require both page and financial permission and remain read-only", async () => {
  let options;
  const paymentSummary = async (_agencyId, incoming) => {
    options = incoming;
    return {
      totalCollected: 12500,
      totalRefunded: 500,
      outstandingBalance: 2300,
      paidThisMonth: 1500,
      cashOnHand: 700,
      totalTransactions: 42,
    };
  };
  const db = { agency: { async findUnique() { return { defaultCurrency: "CAD" }; } } };
  const result = await resolveCaseDeskAIInsight(
    request(),
    [{ role: "user", content: "How much money have we collected?" }],
    { db, paymentSummary },
  );
  assert.match(result.answer, /\$12,500\.00/);
  assert.match(result.answer, /\$500\.00/);
  assert.deepEqual(options, { reconcile: false });

  const denied = await resolveCaseDeskAIInsight(
    request("frontdesk"),
    [{ role: "user", content: "How much money have we collected?" }],
    { db, paymentSummary },
  );
  assert.match(denied.answer, /don’t currently have access to the Payments/);
});

test("number intent only activates for an allowlisted CRM domain", () => {
  assert.equal(crmMetricIntent([{ role: "user", content: "How many total leads do we have?" }])?.domain, "leads");
  assert.equal(crmMetricIntent([{ role: "user", content: "What are the incentives for Manpreet?" }])?.domain, "performance");
  assert.equal(crmMetricIntent([{ role: "user", content: "How many coffees did I drink?" }]), null);
});

test("a documents question mentioning cases in passing still resolves as the documents domain", () => {
  assert.equal(crmMetricIntent([{ role: "user", content: "How many documents are outstanding on my cases?" }])?.domain, "documents");
});

// A real reported exchange: "What does the overdue count mean?" contains
// "overdue" and "count" — the exact words the number-question detector
// looks for — so it got refused with "I can't verify that live number yet."
test("a definitional question is never treated as a live-number request, even when it names a real domain", async () => {
  const definitional = await resolveCaseDeskAIInsight(request(), [{ role: "user", content: "What does the overdue count mean?" }], { db: {} });
  assert.match(definitional.answer, /active workflow tasks/);
  assert.match(definitional.answer, /still marked \*\*Pending\*\*/);
  assert.match(definitional.answer, /due before today/);
  assert.match(definitional.answer, /agency’s timezone/);
  assert.match(definitional.answer, /does not include overdue follow-ups, unpaid balances, or pending documents/);
  assert.match(definitional.answer, /\[Open Dashboard\]\(\/app\/dashboard\)/);

  assert.equal(crmMetricIntent([{ role: "user", content: "What does a nurture lead mean?" }]), null);
  assert.equal(crmMetricIntent([{ role: "user", content: "What do overdue leads mean?" }]), null);

  // A genuine number question with the same keywords still works normally.
  assert.equal(crmMetricIntent([{ role: "user", content: "How many leads are overdue?" }])?.domain, "leads");
});

test("document metrics use the same access-scoped filter as related-record permissions, break down by status, and never leave an uploaded-but-unreviewed document uncounted", async () => {
  const seenWhere = [];
  const db = {
    clientDocument: {
      async count({ where }) {
        seenWhere.push(where);
        if (where.status?.in?.includes("Requested")) return 12; // outstanding = Requested + Uploaded + UnderReview + ChangesRequested
        if (where.status === "Requested") return 3;
        if (where.status?.in?.includes("Uploaded")) return 5; // awaiting review = Uploaded + UnderReview
        if (where.status === "ChangesRequested") return 4;
        if (where.status?.in?.includes("Approved")) return 15;
        if (where.status === "NotRequired") return 3;
        return 33; // total
      },
    },
  };
  const total = await resolveCaseDeskAIInsight(request(), [{ role: "user", content: "How many documents do we have on file?" }], { db });
  assert.match(total.answer, /33 document records .* 12 outstanding \(3 not yet uploaded, 5 awaiting staff review, 4 sent back for changes\), 15 approved or finalized, and 3 marked not required/);
  assert.ok(seenWhere.every((where) => where.agencyId === "agency-1" && Array.isArray(where.AND)));
  // 3 + 5 + 4 = 12: every outstanding document is accounted for in the
  // breakdown, unlike an earlier version that silently dropped "Uploaded"
  // (client submitted, nobody has reviewed it yet) between the buckets.
  assert.equal(3 + 5 + 4, 12);

  const outstanding = await resolveCaseDeskAIInsight(request(), [{ role: "user", content: "How many documents are outstanding?" }], { db });
  assert.match(outstanding.answer, /There are 12 outstanding documents/);

  const awaitingReview = await resolveCaseDeskAIInsight(request(), [{ role: "user", content: "How many documents are awaiting review?" }], { db });
  assert.match(awaitingReview.answer, /There are 5 documents waiting on staff review/);

  const consultant = await resolveCaseDeskAIInsight(
    request("consultant", { portalAccess: { pages: { documents: false } } }),
    [{ role: "user", content: "How many documents are outstanding?" }],
    { db },
  );
  assert.match(consultant.answer, /don’t currently have access to the Documents/);
});

test("proactive insight is null on pages with nothing to flag, and reuses the same verified counts elsewhere", async () => {
  const quiet = await resolveProactiveNovaInsight(request(), {
    currentPath: "/app/follow-ups",
    db: {
      agency: { async findUnique() { return { timezone: "America/Toronto" }; } },
      followUp: { async count() { return 0; } },
      leadFollowUp: { async count() { return 0; } },
    },
  });
  assert.equal(quiet, null);

  const overdue = await resolveProactiveNovaInsight(request(), {
    currentPath: "/app/follow-ups",
    db: {
      agency: { async findUnique() { return { timezone: "America/Toronto" }; } },
      followUp: { async count({ where }) { return where.dueDate?.lt ? 4 : 0; } },
      leadFollowUp: { async count() { return 0; } },
    },
  });
  assert.match(overdue.message, /The workspace has 4 overdue follow-ups/);
  assert.equal(overdue.scope, "page");
  assert.equal(overdue.kind, "followups");
  assert.equal(overdue.severity, "attention");
  assert.deepEqual(overdue.action, { label: "Open Follow-ups", href: "/app/follow-ups" });

  const noRoute = await resolveProactiveNovaInsight(request(), { currentPath: "/app/dashboard", db: {} });
  assert.equal(noRoute, null);
});

test("proactive insight on the Leads page only ever speaks for the authenticated user, never a workspace total", async () => {
  let seenWhere;
  const db = {
    lead: {
      async count({ where }) {
        seenWhere = where;
        return 6;
      },
    },
  };
  const consultant = await resolveProactiveNovaInsight(request("consultant"), { currentPath: "/leads", db });
  assert.match(consultant.message, /You have 6 open leads assigned to you/);
  assert.equal(consultant.persona, "Lead analyst");
  assert.equal(seenWhere.ownerUserId, "user-1");

  const admin = await resolveProactiveNovaInsight(request("admin"), { currentPath: "/leads", db: { lead: { async count() { return 6; } } } });
  assert.equal(admin, null);

  const reviewQueue = await resolveProactiveNovaInsight(request("consultant"), { currentPath: "/leads/review", db });
  assert.equal(reviewQueue, null);
});

test("entity insight verifies tenant/permission access before running any priority-chain check", async () => {
  let followUpCalled = false;
  const db = {
    client: { async findFirst() { return null; } }, // outside this caller's access scope
    followUp: { async count() { followUpCalled = true; return 4; } },
  };
  const result = await resolveProactiveNovaInsight(request(), {
    entityType: "client", entityId: "client-1", db,
  });
  assert.equal(result, null);
  assert.equal(followUpCalled, false, "no priority-chain check may run before access is verified");
});

test("client entity insight walks the priority chain in order and stops at the first real signal", async () => {
  let documentsCalled = false;
  const db = {
    client: { async findFirst() { return { id: "client-1" }; } },
    case: { async findMany() { return [{ id: "case-1" }, { id: "case-2" }]; } },
    agency: { async findUnique() { return { timezone: "America/Toronto" }; } },
    followUp: { async count({ where }) { return where.dueDate?.lt ? 2 : 0; } },
    clientDocument: { async count() { documentsCalled = true; return 5; } },
  };
  const now = new Date("2026-09-04T12:00:00.000Z");
  const result = await resolveProactiveNovaInsight(request(), {
    entityType: "client", entityId: "client-1", db, now,
  });
  assert.equal(result.scope, "entity");
  assert.equal(result.kind, "client");
  assert.equal(result.persona, "Client assistant");
  assert.equal(result.severity, "attention");
  assert.match(result.message, /2 overdue follow-ups on this client\./);
  assert.deepEqual(result.entity, { type: "client", id: "client-1" });
  assert.deepEqual(result.action, { label: "Open Client", href: "/app/clients/client-1" });
  assert.equal(result.generatedAt, now.toISOString());
  assert.equal(documentsCalled, false, "a later check must never run once an earlier one already found something");
});

test("client entity insight falls through to the next check once the earlier ones are clear, and reports a positive insight when the whole chain is clear", async () => {
  const clear = {
    client: { async findFirst() { return { id: "client-1" }; } },
    case: { async findMany() { return [{ id: "case-1" }]; } },
    agency: { async findUnique() { return { timezone: "America/Toronto" }; } },
    followUp: { async count() { return 0; } },
    clientDocument: { async count() { return 0; } },
    caseInvoice: { async findMany() { return []; } },
    questionnaireAssignment: { async count() { return 0; } },
    appointment: { async findFirst() { return null; } },
    caseWorkflowStep: { async findFirst() { return null; } },
  };
  const positive = await resolveProactiveNovaInsight(request(), { entityType: "client", entityId: "client-1", db: clear });
  assert.equal(positive.severity, "success");
  assert.match(positive.message, /Nothing needs attention on this client right now\./);

  const withDocuments = { ...clear, clientDocument: { async count() { return 3; } } };
  const documents = await resolveProactiveNovaInsight(request(), { entityType: "client", entityId: "client-1", db: withDocuments });
  assert.equal(documents.severity, "attention");
  assert.match(documents.message, /3 documents missing or needing changes on this client\./);
});

test("an overdue invoice on an entity is urgent, a merely outstanding one is only attention", async () => {
  const base = {
    client: { async findFirst() { return { id: "client-1" }; } },
    case: { async findMany() { return [{ id: "case-1" }]; } },
    agency: { async findUnique() { return { timezone: "America/Toronto", defaultCurrency: "CAD" }; } },
    followUp: { async count() { return 0; } },
    clientDocument: { async count() { return 0; } },
  };
  const now = new Date("2026-09-04T12:00:00.000Z");

  const overdue = await resolveProactiveNovaInsight(request(), {
    entityType: "client", entityId: "client-1", now,
    db: { ...base, caseInvoice: { async findMany() { return [{ balance: 500, dueDate: new Date("2026-08-01T00:00:00.000Z") }]; } } },
  });
  assert.equal(overdue.severity, "urgent");
  assert.match(overdue.message, /\$500\.00 overdue on this client\./);

  const outstanding = await resolveProactiveNovaInsight(request(), {
    entityType: "client", entityId: "client-1", now,
    db: { ...base, caseInvoice: { async findMany() { return [{ balance: 500, dueDate: new Date("2026-10-01T00:00:00.000Z") }]; } } },
  });
  assert.equal(outstanding.severity, "attention");
  assert.match(outstanding.message, /\$500\.00 outstanding on this client\./);
});

test("a case entity scopes every check to that one case, never the client's other unrelated cases", async () => {
  const seenWhere = { documents: null, invoices: null, forms: null, appointments: null };
  const db = {
    case: { async findFirst() { return { id: "case-1", clientId: "client-1" }; } },
    agency: { async findUnique() { return { timezone: "America/Toronto" }; } },
    followUp: { async count() { return 0; } },
    clientDocument: { async count({ where }) { seenWhere.documents = where; return 0; } },
    caseInvoice: { async findMany({ where }) { seenWhere.invoices = where; return []; } },
    questionnaireAssignment: { async count({ where }) { seenWhere.forms = where; return 0; } },
    appointment: { async findFirst({ where }) { seenWhere.appointments = where; return null; } },
    caseWorkflowStep: { async findFirst() { return null; } },
  };
  const result = await resolveProactiveNovaInsight(request(), { entityType: "case", entityId: "case-1", db });
  assert.equal(result.kind, "case");
  assert.equal(result.persona, "Case assistant");
  assert.match(result.message, /Nothing needs attention on this case right now\./);
  assert.deepEqual(result.action, { label: "Open Case", href: "/app/cases/case-1" });
  for (const where of Object.values(seenWhere)) {
    assert.equal(where.caseId, "case-1");
    assert.equal(where.clientId, undefined, "a case-entity check must never widen back out to the whole client");
  }
});
