import assert from "node:assert/strict";
import test from "node:test";
import { conversionRate, reportingBounds } from "../src/modules/leads/lead.metrics.js";
import { getLeadDashboard } from "../src/modules/leads/lead.dashboard.service.js";

test("lead reporting uses the agency-local day and Monday week boundary", () => {
  const bounds = reportingBounds(new Date("2026-07-14T15:00:00Z"), "America/Toronto");
  assert.equal(bounds.previousDayStart.toISOString(), "2026-07-13T04:00:00.000Z");
  assert.equal(bounds.todayStart.toISOString(), "2026-07-14T04:00:00.000Z");
  assert.equal(bounds.tomorrowStart.toISOString(), "2026-07-15T04:00:00.000Z");
  assert.equal(bounds.previousWeekStart.toISOString(), "2026-07-06T04:00:00.000Z");
  assert.equal(bounds.weekStart.toISOString(), "2026-07-13T04:00:00.000Z");
  assert.equal(bounds.twoMonthsAgoStart.toISOString(), "2026-05-01T04:00:00.000Z");
  assert.equal(bounds.previousMonthStart.toISOString(), "2026-06-01T04:00:00.000Z");
  assert.equal(bounds.monthStart.toISOString(), "2026-07-01T04:00:00.000Z");
  assert.equal(bounds.nextMonthStart.toISOString(), "2026-08-01T04:00:00.000Z");
});

test("overall conversion rate is stable and safe for an empty funnel", () => {
  assert.equal(conversionRate(3, 8), 37.5);
  assert.equal(conversionRate(0, 0), 0);
});

test("consultant dashboard queries stay agency scoped and include owned or assigned-work leads", async () => {
  const leadWheres = [];
  const relatedWheres = [];
  const db = {
    agency: { findUnique: async () => ({ timezone: "America/Toronto", defaultCurrency: "CAD" }) },
    lead: {
      count: async ({ where }) => {
        leadWheres.push(where);
        const exactOpenQueue = where.status === "OPEN" && where.AND?.[0]?.OR?.[0]?.ownerUserId === "consultant-1";
        return exactOpenQueue ? 17 : 0;
      },
      aggregate: async ({ where }) => { leadWheres.push(where); return { _sum: { estimatedValue: 2000 } }; },
      findMany: async ({ where }) => { leadWheres.push(where); return []; },
      groupBy: async ({ where }) => { leadWheres.push(where); return []; },
    },
    leadFollowUp: { count: async ({ where }) => { relatedWheres.push(where); return 0; } },
    leadConsultation: { count: async ({ where }) => { relatedWheres.push(where); return 0; } },
  };
  const req = { auth: { agencyId: "agency-1", userId: "consultant-1", role: "consultant" } };

  const dashboard = await getLeadDashboard(req, db, new Date("2026-07-14T15:00:00Z"));

  assert.ok(leadWheres.every((where) => where.agencyId === "agency-1" && where.AND?.[0]?.OR?.[0]?.ownerUserId === "consultant-1" && where.AND?.[0]?.OR?.[1]?.followUps?.some?.assignedUserId === "consultant-1"));
  assert.ok(relatedWheres.every((where) => where.agencyId === "agency-1" && where.lead.agencyId === "agency-1" && where.lead.AND?.[0]?.OR?.[0]?.ownerUserId === "consultant-1"));
  assert.equal(dashboard.summary.openLeads, 17);
  assert.equal(dashboard.summary.openPipelineValue, 2000);
});
