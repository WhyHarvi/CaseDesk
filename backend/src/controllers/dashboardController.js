import prisma from "../services/prisma/client.js";
import { buildAppointmentRegistry, buildSchedulingAnalytics, buildBookingWaitlist } from "./bookingController.js";
import {
  caseAccessWhere,
  clientAccessWhere,
  relatedRecordAccessWhere,
} from "../middleware/authorization.js";
import { reportingBounds } from "../modules/leads/lead.metrics.js";
import {
  dashboardCacheKey,
  getCachedDashboard,
  setCachedDashboard,
} from "../services/dashboardCache.js";

const caseSummarySelect = {
  id: true,
  caseType: true,
  stage: true,
  status: true,
  nextAction: true,
  updatedAt: true,
  client: { select: { id: true, fullName: true } },
};
const OPEN_CASE_STATUSES = ["Open", "Active", "On Hold"];
export const DASHBOARD_HIDDEN_ACTIVITY_ACTIONS = Object.freeze(["USER_LOGIN", "USER_LOGOUT"]);

function consultantTaskAccess(req) {
  if (req.auth.role === "admin") return {};
  return {
    OR: [
      { assignedToId: req.auth.userId },
      { assignedToId: null, case: caseAccessWhere(req) },
    ],
  };
}

export function dashboardScopes(req) {
  const agencyWhere = { agencyId: req.auth.agencyId };
  const activeCaseAccess = { deletedAt: null, status: { in: OPEN_CASE_STATUSES }, ...caseAccessWhere(req) };
  const caseWhere = { ...agencyWhere, ...activeCaseAccess };

  return {
    agencyWhere,
    clientWhere: { ...agencyWhere, ...clientAccessWhere(req) },
    caseWhere,
    taskWhere: { ...agencyWhere, ...consultantTaskAccess(req), case: activeCaseAccess },
    appointmentWhere: req.auth.role === "admin"
      ? agencyWhere
      : { ...agencyWhere, OR: [{ assignedToId: req.auth.userId }, { case: activeCaseAccess }] },
    documentWhere: {
      ...agencyWhere,
      OR: [
        { case: activeCaseAccess },
        { caseId: null, ...(req.auth.role === "admin" ? {} : { client: clientAccessWhere(req) }) },
      ],
    },
    followUpWhere: {
      ...agencyWhere,
      AND: [
        { OR: [{ caseId: null }, { case: activeCaseAccess }] },
        ...(req.auth.role === "admin" ? [] : [{ OR: [{ assignedUserId: req.auth.userId }, { case: activeCaseAccess }] }]),
      ],
    },
    activityWhere: {
      ...agencyWhere,
      ...relatedRecordAccessWhere(req),
    },
    paymentWhere: req.auth.role === "admin"
      ? agencyWhere
      : { ...agencyWhere, client: clientAccessWhere(req) },
  };
}

export async function getDashboardSummary(req, res) {
  const cacheKey = dashboardCacheKey(req.auth);
  const cached = getCachedDashboard(cacheKey);
  if (cached) {
    res.set("X-CaseDesk-Cache", "hit");
    return res.json({ data: cached });
  }
  res.set("X-CaseDesk-Cache", "miss");
  const {
    clientWhere,
    caseWhere,
    taskWhere,
    appointmentWhere,
    documentWhere,
    followUpWhere,
    activityWhere,
    paymentWhere,
  } = dashboardScopes(req);
  const now = new Date();
  const agency = await prisma.agency.findUnique({
    where: { id: req.auth.agencyId },
    select: { timezone: true },
  });
  const timezone = agency?.timezone || "America/Toronto";
  const { todayStart, tomorrowStart } = reportingBounds(now, timezone);
  const pendingTaskWhere = { ...taskWhere, status: "Pending", isActive: true };
  const openFollowUpWhere = { ...followUpWhere, status: { not: "Completed" } };
  const waitingCaseWhere = {
    agencyId: req.auth.agencyId,
    deletedAt: null,
    status: { in: OPEN_CASE_STATUSES },
    AND: [
      caseAccessWhere(req),
      {
        OR: [
          { nextAction: null },
          { nextAction: "" },
          { workflowSteps: { none: { isActive: true, status: "Pending" } } },
        ],
      },
    ],
  };

  const [
    totalClients,
    activeClients,
    openCases,
    tasksDueToday,
    overdueTaskCount,
    pendingDocuments,
    followUpsDueToday,
    overdueFollowUpCount,
    appointmentsToday,
    pendingPayments,
    pendingPaymentTotals,
    casePipelineRaw,
    upcomingAppointments,
    todayTasks,
    overdueTasks,
    documentActions,
    upcomingFollowUps,
    casesWaitingUpdateCount,
    casesWaitingUpdate,
    recentActivity,
  ] = await Promise.all([
    prisma.client.count({ where: clientWhere }),
    prisma.client.count({ where: { ...clientWhere, status: "Active" } }),
    prisma.case.count({ where: caseWhere }),
    prisma.caseWorkflowStep.count({
      where: { ...pendingTaskWhere, dueAt: { gte: todayStart, lt: tomorrowStart } },
    }),
    prisma.caseWorkflowStep.count({
      where: { ...pendingTaskWhere, dueAt: { lt: todayStart } },
    }),
    prisma.clientDocument.count({
      where: {
        ...documentWhere,
        status: { in: ["Requested", "Uploaded", "UnderReview", "ChangesRequested"] },
      },
    }),
    prisma.followUp.count({
      where: { ...openFollowUpWhere, dueDate: { gte: todayStart, lt: tomorrowStart } },
    }),
    prisma.followUp.count({
      where: { ...openFollowUpWhere, dueDate: { lt: todayStart } },
    }),
    prisma.appointment.count({
      where: {
        ...appointmentWhere,
        status: "Scheduled",
        startsAt: { gte: todayStart, lt: tomorrowStart },
      },
    }),
    prisma.payment.count({
      where: { ...paymentWhere, status: { in: ["Unpaid", "Partial"] } },
    }),
    prisma.payment.aggregate({
      where: { ...paymentWhere, status: { in: ["Unpaid", "Partial"] } },
      _sum: { balance: true },
    }),
    prisma.case.groupBy({
      by: ["stage"],
      where: caseWhere,
      _count: { stage: true },
      orderBy: { stage: "asc" },
    }),
    prisma.appointment.findMany({
      where: { ...appointmentWhere, status: "Scheduled", startsAt: { gte: now } },
      orderBy: { startsAt: "asc" },
      take: 5,
      select: {
        id: true,
        subject: true,
        location: true,
        startsAt: true,
        endsAt: true,
        status: true,
        meetingMode: true,
        guestName: true,
        case: { select: caseSummarySelect },
        assignedTo: { select: { id: true, fullName: true } },
        sessionType: { select: { name: true } },
      },
    }),
    prisma.caseWorkflowStep.findMany({
      where: { ...pendingTaskWhere, dueAt: { gte: todayStart, lt: tomorrowStart } },
      orderBy: [{ priority: "desc" }, { dueAt: "asc" }],
      take: 5,
      select: {
        id: true,
        title: true,
        description: true,
        priority: true,
        dueAt: true,
        case: { select: caseSummarySelect },
      },
    }),
    prisma.caseWorkflowStep.findMany({
      where: { ...pendingTaskWhere, dueAt: { lt: todayStart } },
      orderBy: { dueAt: "asc" },
      take: 5,
      select: {
        id: true,
        title: true,
        description: true,
        priority: true,
        dueAt: true,
        case: { select: caseSummarySelect },
      },
    }),
    prisma.clientDocument.findMany({
      where: {
        ...documentWhere,
        status: { in: ["Requested", "Uploaded", "UnderReview", "ChangesRequested"] },
      },
      orderBy: { updatedAt: "asc" },
      take: 5,
      select: {
        id: true,
        documentName: true,
        status: true,
        updatedAt: true,
        client: { select: { id: true, fullName: true } },
        case: { select: { id: true, caseType: true } },
      },
    }),
    prisma.followUp.findMany({
      where: openFollowUpWhere,
      orderBy: [{ dueDate: "asc" }, { createdAt: "desc" }],
      take: 6,
      select: {
        id: true,
        title: true,
        dueDate: true,
        status: true,
        client: { select: { id: true, fullName: true } },
        case: { select: { id: true, caseType: true } },
        assignedUser: { select: { id: true, fullName: true } },
      },
    }),
    prisma.case.count({ where: waitingCaseWhere }),
    prisma.case.findMany({
      where: waitingCaseWhere,
      orderBy: { updatedAt: "asc" },
      take: 5,
      select: caseSummarySelect,
    }),
    prisma.activityLog.findMany({
      where: {
        AND: [
          activityWhere,
          { action: { notIn: DASHBOARD_HIDDEN_ACTIVITY_ACTIONS } },
        ],
      },
      orderBy: { createdAt: "desc" },
      take: 6,
      select: {
        id: true,
        action: true,
        details: true,
        createdAt: true,
        user: { select: { id: true, fullName: true } },
        client: { select: { id: true, fullName: true } },
        case: { select: { id: true, caseType: true } },
      },
    }),
  ]);

  const data = {
      timezone,
      stats: {
        totalClients,
        activeClients,
        openCases,
        tasksDueToday,
        overdueTasks: overdueTaskCount,
        pendingDocuments,
        followUpsDueToday,
        overdueFollowUps: overdueFollowUpCount,
        appointmentsToday,
        pendingPayments,
        pendingPaymentBalance: pendingPaymentTotals._sum.balance ?? 0,
        casesWaitingUpdate: casesWaitingUpdateCount,
      },
      casePipeline: casePipelineRaw.map((item) => ({
        stage: item.stage,
        count: item._count.stage,
      })),
      upcomingAppointments: upcomingAppointments.map((appointment) => ({
        ...appointment,
        isMine: appointment.assignedTo?.id === req.auth.userId,
      })),
      todayTasks,
      overdueTasks,
      documentActions,
      upcomingFollowUps,
      casesWaitingUpdate,
      recentActivity,
  };
  const [registry, analytics, waitlist] = await Promise.all([
    buildAppointmentRegistry(req, { attendance: "all", range: "all", page: 1, limit: 6 }).catch(() => null),
    req.auth.role === "admin" ? buildSchedulingAnalytics(req, { range: "all" }).catch(() => null) : Promise.resolve(null),
    req.auth.role === "admin" ? buildBookingWaitlist(req, "Waiting").catch(() => null) : Promise.resolve(null),
  ]);
  data.scheduling = { registry, analytics, waitlist };

  setCachedDashboard(cacheKey, data);
  return res.json({ data });
}

export default { getDashboardSummary };
