import assert from "node:assert/strict";
import test from "node:test";
import { buildFunnel, parseReportDays } from "../src/modules/leads/lead.metrics.js";
import { getAgeingReport, getConversionTrendReport, getEmployeeReport, getFunnelReport, getLostReport, getResponseTimeReport, getSourceReport, getWorkloadReport } from "../src/modules/leads/lead.report.service.js";

test("funnel definitions calculate share and adjacent drop-off consistently", () => {
  const funnel = buildFunnel({ RECEIVED: 100, CONTACTED: 80, CONNECTED: 50, QUALIFIED: 40, CONVERTED: 10 });
  assert.equal(funnel[1].shareOfReceived, 80);
  assert.equal(funnel[1].dropOffFromPrevious, 20);
  assert.equal(funnel.at(-1).shareOfReceived, 10);
  assert.equal(parseReportDays("90"), 90);
  assert.equal(parseReportDays("unsupported"), 30);
  assert.equal(parseReportDays("all"), null);
});

test("consultant funnel is agency, owner, and period scoped", async () => {
  const queries = [];
  let value = 9;
  const db = { lead: { count: async ({ where }) => { queries.push(where); return value--; } } };
  const req = { auth: { agencyId: "agency-1", userId: "consultant-1", role: "consultant" }, query: { days: "30" } };
  const report = await getFunnelReport(req, db, new Date("2026-07-14T12:00:00Z"));
  assert.equal(report.funnel[0].count, 9);
  assert.ok(queries.every((where) => where.agencyId === "agency-1" && where.ownerUserId === "consultant-1" && where.createdAt.gte));
});

test("source report normalizes database values and calculates conversion", async () => {
  let query;
  const db = { $queryRaw: async (statement) => {
    query = statement;
    return [{ id: "source-1", name: "Referral", type: "REFERRAL", leadsReceived: 8, contacted: 7, qualified: 5, consultations: 4, converted: 2, lost: 1, pipelineValue: "12000", convertedValue: "5000", averageResponseMinutes: "14.5", mainLostReason: "PRICE_CONCERN" }];
  } };
  const req = { auth: { agencyId: "agency-1", userId: "consultant-1", role: "consultant" }, query: { days: "30" } };
  const report = await getSourceReport(req, db, new Date("2026-07-14T12:00:00Z"));
  assert.equal(report.sources[0].conversionRate, 25);
  assert.equal(report.sources[0].pipelineValue, 12000);
  assert.equal(report.sources[0].averageResponseMinutes, 14.5);
  assert.ok(query.values.includes("agency-1"));
  assert.ok(query.values.includes("consultant-1"));
});

test("employee report calculates conversion and follow-up completion rates", async () => {
  let query;
  const db = { $queryRaw: async (statement) => {
    query = statement;
    return [{ id: "user-1", name: "Avery Consultant", email: "avery@example.ca", leadsAssigned: 10, newLeadsHandled: 8, contactAttempts: 14, callsCompleted: 9, successfulConnections: 6, noAnswerCalls: 3, followUpsDue: 8, followUpsCompleted: 6, followUpsOverdue: 2, consultationsBooked: 4, consultationsCompleted: 3, converted: 2, lost: 1, averageResponseMinutes: "12.5", averageConnectionMinutes: "45", convertedRevenue: "6500", currency: "CAD" }];
  } };
  const req = { auth: { agencyId: "agency-1", userId: "user-1", role: "consultant" }, query: { days: "30" } };
  const report = await getEmployeeReport(req, db, new Date("2026-07-14T12:00:00Z"));
  assert.equal(report.employees[0].conversionRate, 20);
  assert.equal(report.employees[0].followUpCompletionRate, 75);
  assert.equal(report.summary.convertedRevenue, 6500);
  assert.ok(query.values.includes("agency-1"));
  assert.ok(query.values.includes("user-1"));
});

test("lost report groups reasons, owners, and sources within consultant scope", async () => {
  const leadQueries = [];
  let countValue = 6;
  const db = {
    lead: {
      count: async ({ where }) => { leadQueries.push(where); return countValue--; },
      groupBy: async ({ by, where }) => { leadQueries.push(where); return by[0] === "ownerUserId" ? [{ ownerUserId: "user-1", _count: { id: 3 } }] : [{ originalSourceId: "source-1", _count: { id: 3 } }]; },
    },
    leadLostDetail: { groupBy: async () => [{ reasonCode: "NO_RESPONSE", _count: { id: 3 } }] },
    user: { findMany: async () => [{ id: "user-1", fullName: "Avery Consultant" }] },
    leadSource: { findMany: async () => [{ id: "source-1", name: "Referral", type: "REFERRAL" }] },
  };
  const req = { auth: { agencyId: "agency-1", userId: "user-1", role: "consultant" }, query: { days: "30" } };
  const report = await getLostReport(req, db, new Date("2026-07-14T12:00:00Z"));
  assert.equal(report.summary.totalLost, 6);
  assert.equal(report.reasons[0].share, 50);
  assert.equal(report.employees[0].name, "Avery Consultant");
  assert.equal(report.sources[0].name, "Referral");
  assert.ok(leadQueries.every((where) => where.agencyId === "agency-1" && where.ownerUserId === "user-1"));
});

test("response-time report normalizes SLA and duration metrics", async () => {
  const queries = [];
  const db = { $queryRaw: async (statement) => {
    queries.push(statement);
    if (queries.length === 1) return [{ evaluated: 8, onTime: 6, late: 2, neverContacted: 1, averageFirstAttemptMinutes: "11.5", averageConnectionMinutes: "42" }];
    return [{ id: `row-${queries.length}`, name: "Referral", type: "REFERRAL", evaluated: 4, onTime: 3, late: 1, neverContacted: 1, averageResponseMinutes: "15" }];
  } };
  const req = { auth: { agencyId: "agency-1", userId: "user-1", role: "consultant" }, query: { days: "30" } };
  const report = await getResponseTimeReport(req, db, new Date("2026-07-14T12:00:00Z"));
  assert.equal(report.summary.slaCompliance, 75);
  assert.equal(report.summary.averageFirstAttemptMinutes, 11.5);
  assert.equal(report.employees[0].slaCompliance, 75);
  assert.ok(queries.every((query) => query.values.includes("agency-1") && query.values.includes("user-1")));
});

test("ageing report fills empty buckets and normalizes pipeline values", async () => {
  let queryCount = 0;
  const db = {
    $queryRaw: async () => {
      queryCount += 1;
      if (queryCount === 1) return [{ totalOpen: 3, averageAgeDays: "9.5", oldestAgeDays: 20, inactive: 1, pipelineValue: "12000" }];
      if (queryCount === 2) return [{ bucket: "8_14_DAYS", count: 2, pipelineValue: "8000" }];
      if (queryCount === 3) return [{ stage: "QUALIFIED", count: 2, averageAgeDays: "8" }];
      return [{ id: "lead-1", leadNumber: "LD-1", ageDays: 20 }];
    },
    agency: { findUnique: async () => ({ defaultCurrency: "CAD" }) },
  };
  const report = await getAgeingReport({ auth: { agencyId: "agency-1", userId: "user-1", role: "consultant" } }, db, new Date("2026-07-14T12:00:00Z"));
  assert.equal(report.summary.averageAgeDays, 9.5);
  assert.equal(report.summary.pipelineValue, 12000);
  assert.equal(report.buckets.length, 6);
  assert.equal(report.buckets.find((item) => item.bucket === "8_14_DAYS").count, 2);
  assert.equal(report.buckets.find((item) => item.bucket === "31_PLUS_DAYS").count, 0);
});

test("conversion trend normalizes event values and selects a useful granularity", async () => {
  let queryCount = 0;
  const db = {
    agency: { findUnique: async () => ({ timezone: "America/Toronto", defaultCurrency: "CAD" }) },
    $queryRaw: async () => {
      queryCount += 1;
      return queryCount === 1
        ? [{ period: "2026-07-14", received: 5, converted: 2, lost: 1, convertedValue: "5500" }]
        : [{ received: 5, converted: 2, lost: 1, convertedValue: "5500", averageConversionDays: "12.5" }];
    },
  };
  const report = await getConversionTrendReport({ auth: { agencyId: "agency-1", userId: "user-1", role: "consultant" }, query: { days: "30" } }, db, new Date("2026-07-14T12:00:00Z"));
  assert.equal(report.range.granularity, "day");
  assert.equal(report.summary.conversionRate, 40);
  assert.equal(report.summary.averageConversionDays, 12.5);
  assert.equal(report.trend[0].convertedValue, 5500);
});

test("workload report aggregates current employee queues", async () => {
  const db = {
    agency: { findUnique: async () => ({ timezone: "America/Toronto", defaultCurrency: "CAD" }) },
    $queryRaw: async () => [{ id: "user-1", name: "Avery Consultant", email: "avery@example.ca", openLeads: 8, overdueActions: 2, actionsToday: 3, readyToConvert: 1, pipelineValue: "24000", pendingFollowUps: 5, overdueFollowUps: 1, upcomingConsultations: 2 }],
  };
  const report = await getWorkloadReport({ auth: { agencyId: "agency-1", userId: "user-1", role: "consultant" } }, db, new Date("2026-07-14T12:00:00Z"));
  assert.equal(report.summary.openLeads, 8);
  assert.equal(report.summary.overdueActions, 2);
  assert.equal(report.summary.pipelineValue, 24000);
  assert.equal(report.employees[0].pipelineValue, 24000);
});
