import assert from "node:assert/strict";
import test from "node:test";
import { resolveCaseDeskAIInsight } from "../src/services/aiInsightService.js";

// A small, fixed set of realistic staff questions with a known-correct
// answer for each, run end-to-end through the real resolver pipeline
// (intent matching -> access checks -> live-data formatting) that Nova's
// chat endpoint actually uses. Unlike the surrounding unit tests, which each
// probe one behavior or edge case in isolation, this file is meant to read
// as a single golden reference: every CaseDesk-supported metric domain gets
// at least one representative question, so a change to prompt matching, a
// resolver, or an access rule shows up here as a named, specific failure
// instead of a silent drift in what Nova tells staff. Add a case here
// whenever a new domain or a materially new phrasing is supported.

const NOW = new Date("2026-08-15T22:00:00.000Z");

function request(role = "admin", permissions = {}) {
  return { auth: { agencyId: "agency-1", userId: "user-1", role, permissions } };
}

function deniedPermissions(page) {
  return { portalAccess: { pages: { [page]: false } } };
}

const CASES = [
  {
    name: "appointments · personal upcoming count",
    question: "How many appointments do I have coming up?",
    db: {
      appointment: { async count() { return 4; } },
      bookingSettings: { async findUnique() { return { timezone: "America/Toronto" }; } },
    },
    expect: /You have 4 upcoming appointments/,
  },
  {
    name: "leads · workspace open count",
    question: "How many leads are open right now?",
    db: {
      lead: {
        async groupBy({ where }) {
          const values = where.ownerUserId ? { OPEN: 3 } : { OPEN: 20, NURTURE: 5, LOST: 2, CONVERTED: 8 };
          return Object.entries(values).map(([status, count]) => ({ status, _count: { _all: count } }));
        },
        async count() { return 7; },
      },
    },
    expect: /There are 20 open leads in the Standard workspace pipeline/,
  },
  {
    name: "clients · workspace active count",
    question: "How many active clients are there?",
    db: {
      client: {
        async count({ where }) {
          if (where.archivedAt?.not === null) return 4;
          if (where.assignedUserId) return where.status === "Active" ? 8 : 9;
          return { Active: 80, Inactive: 10, Closed: 5, Lead: 5 }[where.status] ?? 100;
        },
      },
    },
    expect: /The workspace has 80 active clients/,
  },
  {
    name: "cases · workspace totals",
    question: "How many total cases do we have?",
    db: {
      case: {
        async count({ where }) {
          const personal = Array.isArray(where.AND) && where.AND.length > 1;
          if (where.archivedAt?.not === null) return 6;
          if (where.status?.notIn) return personal ? 12 : 30;
          if (where.status?.in) return 14;
          return personal ? 15 : 50;
        },
      },
    },
    expect: /50 non-deleted cases in total: 30 active, 14 closed, and 6 archived/,
  },
  {
    name: "documents · outstanding count",
    question: "How many documents are outstanding across our cases?",
    db: {
      clientDocument: {
        async count({ where }) {
          if (where.status?.in?.includes("Requested")) return 12;
          if (where.status === "Requested") return 3;
          if (where.status?.in?.includes("Uploaded")) return 5;
          if (where.status === "ChangesRequested") return 4;
          if (where.status?.in?.includes("Approved")) return 15;
          if (where.status === "NotRequired") return 3;
          return 33;
        },
      },
    },
    expect: /There are 12 outstanding documents/,
  },
  {
    name: "follow-ups · workspace overdue count",
    question: "How many follow-ups are overdue?",
    db: {
      agency: { async findUnique() { return { timezone: "America/Toronto" }; } },
      followUp: {
        async count({ where }) {
          if (where.status === "Pending" && where.dueDate?.lt) return 2;
          if (where.status === "Pending" && where.dueDate?.gte) return 1;
          if (where.status === "Completed") return 10;
          return 5;
        },
      },
      leadFollowUp: {
        async count({ where }) {
          if (where.status === "PENDING" && where.dueAt?.lt) return 1;
          if (where.status === "PENDING" && where.dueAt?.gte) return 0;
          if (where.status === "COMPLETED") return 3;
          return 2;
        },
      },
    },
    expect: /There are 3 overdue follow-ups across the workspace/,
  },
  {
    name: "payments · outstanding balance",
    question: "What's our outstanding balance?",
    db: { agency: { async findUnique() { return { defaultCurrency: "CAD" }; } } },
    options: {
      paymentSummary: async () => ({
        totalCollected: 12500,
        totalRefunded: 500,
        outstandingBalance: 2300,
        paidThisMonth: 1500,
        cashOnHand: 700,
        totalTransactions: 42,
      }),
    },
    expect: /\$2,300\.00/,
  },
  {
    name: "guardrail · access-denied domain never fabricates a number",
    question: "How many documents are outstanding?",
    role: "frontdesk",
    permissions: deniedPermissions("documents"),
    db: {},
    expect: /don’t currently have access to the Documents/,
  },
  {
    name: "guardrail · unsupported number question refuses to guess",
    question: "How many coffees did the team drink this week?",
    db: {},
    expect: /I can’t verify that live number yet, so I won’t guess/,
  },
];

for (const testCase of CASES) {
  test(`Nova eval: ${testCase.name}`, async () => {
    const result = await resolveCaseDeskAIInsight(
      request(testCase.role, testCase.permissions),
      [{ role: "user", content: testCase.question }],
      { db: testCase.db, now: NOW, ...testCase.options },
    );
    assert.ok(result, `expected an answer for: ${testCase.question}`);
    assert.match(result.answer, testCase.expect);
  });
}

test("Nova eval set covers every live-verifiable metric domain at least once", () => {
  const coveredDomains = ["appointments", "leads", "clients", "cases", "documents", "follow-ups", "payments"];
  const names = CASES.map((testCase) => testCase.name);
  for (const domain of coveredDomains) {
    assert.ok(names.some((name) => name.startsWith(domain)), `no eval case covers ${domain}`);
  }
});
