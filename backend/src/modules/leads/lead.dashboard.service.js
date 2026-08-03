import prisma from "../../services/prisma/client.js";
import { createHttpError } from "../../utils/http.js";
import { leadAccessWhere } from "./lead.permissions.js";
import { conversionRate, DEFAULT_INACTIVE_LEAD_DAYS, INVALID_CONVERSION_STATUSES, reportingBounds } from "./lead.metrics.js";

const DRILLDOWN_METRICS = ["followUpsDueToday", "overdueFollowUps", "slaMissed", "consultationsToday"];
const leadStub = { id: true, leadNumber: true, firstName: true, lastName: true, phone: true, stage: true, status: true };

function issueFor(lead, now) {
  if (!lead.firstContactAt && lead.firstContactDueAt && lead.firstContactDueAt < now) return "First response overdue";
  if (!lead.nextActionAt) return "Next action missing";
  if (lead.nextActionAt < now) return "Action overdue";
  if (lead.stage === "RETAINER_PENDING") return "Retainer pending";
  if (lead.stage === "PAYMENT_PENDING") return "Payment pending";
  return "Due today";
}

function operationalIssues(lead, inactiveBefore) {
  const issues = [];
  if (!lead.firstContactAt) issues.push("AWAITING_FIRST_CONTACT");
  if (!lead.nextActionAt || !lead.nextActionDescription) issues.push("NEXT_ACTION_MISSING");
  if (lead.updatedAt < inactiveBefore) issues.push("INACTIVE");
  if (lead.consultations?.length) issues.push("CONSULTATION_NO_SHOW");
  if (lead.stage === "RETAINER_PENDING") issues.push("RETAINER_PENDING");
  if (lead.stage === "PAYMENT_PENDING") issues.push("PAYMENT_PENDING");
  return issues;
}

export async function getLeadDashboard(req, db = prisma, now = new Date()) {
  const agencyId = req.auth.agencyId;
  const agency = await db.agency.findUnique({ where: { id: agencyId }, select: { timezone: true, defaultCurrency: true } });
  const timezone = agency?.timezone || "America/Toronto";
  const { todayStart, tomorrowStart, weekStart } = reportingBounds(now, timezone);
  const inactiveBefore = new Date(now.getTime() - DEFAULT_INACTIVE_LEAD_DAYS * 24 * 60 * 60_000);
  const access = leadAccessWhere(req);
  const baseLeadWhere = { agencyId, deletedAt: null, ...access };
  const openLeadWhere = { ...baseLeadWhere, status: "OPEN" };
  const relatedLeadWhere = { agencyId, deletedAt: null, ...access };

  const [
    newToday,
    uncontacted,
    slaMissed,
    followUpsDueToday,
    overdueFollowUps,
    consultationsToday,
    convertedThisWeek,
    lostThisWeek,
    pipeline,
    validTotal,
    convertedTotal,
    work,
    awaitingFirstContact,
    withoutNextAction,
    inactiveLeads,
    consultationNoShows,
    pendingStageCounts,
    watchlist,
  ] = await Promise.all([
    db.lead.count({ where: { ...baseLeadWhere, createdAt: { gte: todayStart, lt: tomorrowStart } } }),
    db.lead.count({ where: { ...openLeadWhere, firstContactAt: null } }),
    db.lead.count({ where: { ...openLeadWhere, firstContactAt: null, firstContactDueAt: { lt: now } } }),
    db.leadFollowUp.count({ where: { agencyId, status: "PENDING", dueAt: { gte: todayStart, lt: tomorrowStart }, lead: relatedLeadWhere } }),
    db.leadFollowUp.count({ where: { agencyId, status: "PENDING", dueAt: { lt: now }, lead: relatedLeadWhere } }),
    db.leadConsultation.count({ where: { agencyId, startAt: { gte: todayStart, lt: tomorrowStart }, status: { in: ["SCHEDULED", "CONFIRMED", "RESCHEDULED"] }, lead: relatedLeadWhere } }),
    db.lead.count({ where: { ...baseLeadWhere, status: "CONVERTED", convertedAt: { gte: weekStart, lt: tomorrowStart } } }),
    db.lead.count({ where: { ...baseLeadWhere, status: "LOST", lostAt: { gte: weekStart, lt: tomorrowStart } } }),
    db.lead.aggregate({ where: openLeadWhere, _sum: { estimatedValue: true } }),
    db.lead.count({ where: { ...baseLeadWhere, status: { notIn: INVALID_CONVERSION_STATUSES } } }),
    db.lead.count({ where: { ...baseLeadWhere, status: "CONVERTED" } }),
    db.lead.findMany({
      where: { ...openLeadWhere, OR: [{ nextActionAt: { lt: tomorrowStart } }, { nextActionAt: null }, { firstContactAt: null, firstContactDueAt: { lt: now } }] },
      orderBy: [{ nextActionAt: { sort: "asc", nulls: "first" } }, { createdAt: "asc" }],
      take: 25,
      select: {
        id: true, leadNumber: true, firstName: true, lastName: true, phone: true, stage: true,
        nextActionType: true, nextActionDescription: true, nextActionAt: true, firstContactAt: true, firstContactDueAt: true,
        owner: { select: { id: true, fullName: true } },
        originalSource: { select: { id: true, name: true } },
      },
    }),
    db.lead.count({ where: { ...openLeadWhere, firstContactAt: null } }),
    db.lead.count({ where: { ...openLeadWhere, OR: [{ nextActionAt: null }, { nextActionDescription: null }] } }),
    db.lead.count({ where: { ...openLeadWhere, updatedAt: { lt: inactiveBefore } } }),
    db.leadConsultation.count({ where: { agencyId, status: "NO_SHOW", lead: { ...relatedLeadWhere, status: "OPEN" } } }),
    db.lead.groupBy({ by: ["stage"], where: { ...openLeadWhere, stage: { in: ["RETAINER_PENDING", "PAYMENT_PENDING"] } }, _count: { stage: true } }),
    db.lead.findMany({
      where: {
        ...openLeadWhere,
        OR: [
          { firstContactAt: null },
          { nextActionAt: null },
          { nextActionDescription: null },
          { updatedAt: { lt: inactiveBefore } },
          { stage: { in: ["RETAINER_PENDING", "PAYMENT_PENDING"] } },
          { consultations: { some: { status: "NO_SHOW" } } },
        ],
      },
      orderBy: [{ updatedAt: "asc" }],
      take: 25,
      select: {
        id: true, leadNumber: true, firstName: true, lastName: true, phone: true, stage: true, updatedAt: true,
        firstContactAt: true, nextActionAt: true, nextActionDescription: true,
        owner: { select: { id: true, fullName: true } },
        originalSource: { select: { id: true, name: true } },
        consultations: { where: { status: "NO_SHOW" }, select: { id: true }, take: 1 },
      },
    }),
  ]);

  const stageCount = Object.fromEntries(pendingStageCounts.map((item) => [item.stage, item._count.stage]));

  return {
    timezone,
    currency: agency?.defaultCurrency || "CAD",
    generatedAt: now,
    summary: {
      newToday,
      uncontacted,
      slaMissed,
      followUpsDueToday,
      overdueFollowUps,
      consultationsToday,
      convertedThisWeek,
      lostThisWeek,
      openPipelineValue: Number(pipeline._sum.estimatedValue || 0),
      overallConversionRate: conversionRate(convertedTotal, validTotal),
    },
    todayWork: work.map((lead) => ({ ...lead, currentIssue: issueFor(lead, now) })),
    operational: {
      inactiveThresholdDays: DEFAULT_INACTIVE_LEAD_DAYS,
      counts: {
        awaitingFirstContact,
        withoutNextAction,
        inactive: inactiveLeads,
        consultationNoShows,
        retainerPending: stageCount.RETAINER_PENDING || 0,
        paymentPending: stageCount.PAYMENT_PENDING || 0,
      },
      watchlist: watchlist.map((lead) => ({ ...lead, issues: operationalIssues(lead, inactiveBefore) })),
    },
  };
}

// Mirrors the exact where-clauses used for the top-4 summary counts above,
// so a card's number and its drill-down list can never disagree.
export async function getLeadDashboardDrilldown(req, db = prisma, now = new Date()) {
  const metric = req.query.metric;
  if (!DRILLDOWN_METRICS.includes(metric)) throw createHttpError(400, "Unknown dashboard metric.", "VALIDATION_ERROR");

  const agencyId = req.auth.agencyId;
  const agency = await db.agency.findUnique({ where: { id: agencyId }, select: { timezone: true } });
  const timezone = agency?.timezone || "America/Toronto";
  const { todayStart, tomorrowStart } = reportingBounds(now, timezone);
  const access = leadAccessWhere(req);
  const relatedLeadWhere = { agencyId, deletedAt: null, ...access };

  if (metric === "followUpsDueToday" || metric === "overdueFollowUps") {
    const dueAt = metric === "followUpsDueToday" ? { gte: todayStart, lt: tomorrowStart } : { lt: now };
    const rows = await db.leadFollowUp.findMany({
      where: { agencyId, status: "PENDING", dueAt, lead: relatedLeadWhere },
      orderBy: { dueAt: "asc" },
      take: 100,
      select: { id: true, type: true, description: true, dueAt: true, lead: { select: leadStub } },
    });
    return rows.map((row) => ({ id: row.id, kind: "followUp", type: row.type, description: row.description, dueAt: row.dueAt, lead: row.lead }));
  }

  if (metric === "consultationsToday") {
    const rows = await db.leadConsultation.findMany({
      where: { agencyId, startAt: { gte: todayStart, lt: tomorrowStart }, status: { in: ["SCHEDULED", "CONFIRMED", "RESCHEDULED"] }, lead: relatedLeadWhere },
      orderBy: { startAt: "asc" },
      take: 100,
      select: { id: true, appointmentType: true, startAt: true, status: true, location: true, lead: { select: leadStub } },
    });
    return rows.map((row) => ({ id: row.id, kind: "consultation", appointmentType: row.appointmentType, startAt: row.startAt, status: row.status, location: row.location, lead: row.lead }));
  }

  const rows = await db.lead.findMany({
    where: { ...relatedLeadWhere, status: "OPEN", firstContactAt: null, firstContactDueAt: { lt: now } },
    orderBy: { firstContactDueAt: "asc" },
    take: 100,
    select: { ...leadStub, firstContactDueAt: true },
  });
  return rows.map((row) => ({ id: row.id, kind: "lead", firstContactDueAt: row.firstContactDueAt, lead: row }));
}
