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
import { hasPortalCapability } from "../services/portalAccessService.js";

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
export const DASHBOARD_FINANCIAL_ACTIVITY_ACTIONS = Object.freeze([
  "invoice.created",
  "invoice.manual_payment_recorded",
  "invoice.paid",
  "payment_schedule.created",
  "payment_schedule.updated",
  "payment_schedule.voided",
  "payment_schedule.installment_invoiced",
  "payment_schedule.installment_invoice_voided",
  "appointment.payment_refunded",
  "payment_settings.updated",
  "quickbooks.connected",
  "quickbooks.disconnected",
  "quickbooks.item_created",
  "quickbooks.mapping_updated",
]);

export function canViewDashboardFinancialData(req) {
  return hasPortalCapability(req, "financialData");
}

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
      // Internal-visibility documents are staff-only working files — e.g.
      // the source copy behind an issued agreement/letter (see
      // correspondenceController.js's updateCorrespondenceStatus, which
      // creates a separate Client-visibility copy once issued). Once that
      // exists, the internal source has already done its job; counting it
      // as a still-pending action alongside the issued copy is what made
      // the same document appear to show up twice.
      visibility: "Client",
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
    caseInvoiceWhere: req.auth.role === "admin"
      ? agencyWhere
      : { ...agencyWhere, client: clientAccessWhere(req) },
    // BookingPaymentHold has no clientId (guest bookings, pre-lead) — the
    // closest equivalent scoping for a non-admin is their own assigned
    // consultations.
    bookingPaymentHoldWhere: req.auth.role === "admin"
      ? agencyWhere
      : { ...agencyWhere, assignedToId: req.auth.userId },
  };
}

const PRIORITY_CLIENT_LIMIT = 8;
const WORK_TONE_RANK = { urgent: 0, info: 1, warning: 2 };

// Groups overdue tasks, due-today tasks, pending client-facing documents,
// and cases needing a next action by client, so the Priority Work widget
// can show "N clients with M things to do" instead of a flat agency-wide
// list where one client's backlog can crowd every other client out of the
// visible slots entirely.
// Standalone tasks (added via the case Tasks tab's "+ Task" button) render
// as individual, highlightable rows there — the case's template/checklist
// workflow steps don't have a per-item destination anywhere in the case
// workspace yet, so those just link to the case itself. Mirrors the same
// distinction in DashboardListDrawer.jsx's taskLink() on the frontend.
function taskLink(task) {
  return task.isStandaloneTask
    ? `/app/cases/${task.case.id}?tab=tasks&highlight=${task.id}`
    : `/app/cases/${task.case.id}`;
}

function groupWorkByClient({ overdueTasksByClient, todayTasksByClient, documentActionsByClient, casesWaitingUpdateByClient }) {
  const byClient = new Map();
  function bucket(client) {
    if (!client) return null;
    if (!byClient.has(client.id)) byClient.set(client.id, { client, overdueCount: 0, currentCount: 0, items: [] });
    return byClient.get(client.id);
  }

  for (const task of overdueTasksByClient) {
    const b = bucket(task.case?.client);
    if (!b) continue;
    b.overdueCount += 1;
    b.items.push({
      id: `task-${task.id}`,
      to: taskLink(task),
      caseType: task.case.caseType,
      title: task.title,
      detail: task.description || `${task.priority} priority task`,
      dueAt: task.dueAt,
      tone: "urgent",
      badge: "Overdue",
    });
  }
  for (const task of todayTasksByClient) {
    const b = bucket(task.case?.client);
    if (!b) continue;
    b.currentCount += 1;
    b.items.push({
      id: `task-${task.id}`,
      to: taskLink(task),
      caseType: task.case.caseType,
      title: task.title,
      detail: task.description || `${task.priority} priority task`,
      dueAt: task.dueAt,
      tone: "info",
      badge: "Due today",
    });
  }
  for (const document of documentActionsByClient) {
    const b = bucket(document.client);
    if (!b) continue;
    b.currentCount += 1;
    b.items.push({
      id: `document-${document.id}`,
      to: document.case ? `/app/cases/${document.case.id}?tab=documents&highlight=${document.id}` : `/app/documents?highlight=${document.id}`,
      caseType: document.case?.caseType || "Client document",
      title: document.documentName,
      detail: `Document status: ${document.status.replace(/([a-z])([A-Z])/g, "$1 $2")}`,
      dueAt: document.updatedAt,
      tone: "warning",
      badge: "Document",
    });
  }
  for (const caseRecord of casesWaitingUpdateByClient) {
    const b = bucket(caseRecord.client);
    if (!b) continue;
    b.currentCount += 1;
    b.items.push({
      id: `case-${caseRecord.id}`,
      to: `/app/cases/${caseRecord.id}`,
      caseType: caseRecord.caseType,
      title: "Case needs a next action",
      detail: caseRecord.nextAction || "No pending workflow step or next action is recorded.",
      dueAt: caseRecord.updatedAt,
      tone: "warning",
      badge: "Needs update",
    });
  }

  const clients = [...byClient.values()].map((entry) => ({
    client: entry.client,
    overdueCount: entry.overdueCount,
    totalCount: entry.overdueCount + entry.currentCount,
    items: entry.items.sort((a, b) => (WORK_TONE_RANK[a.tone] - WORK_TONE_RANK[b.tone]) || (new Date(a.dueAt || 0) - new Date(b.dueAt || 0))),
  }));
  clients.sort((a, b) => b.overdueCount - a.overdueCount || b.totalCount - a.totalCount || a.client.fullName.localeCompare(b.client.fullName));
  return clients.slice(0, PRIORITY_CLIENT_LIMIT);
}

export async function getDashboardSummary(req, res) {
  const cacheKey = dashboardCacheKey(req.auth);
  const cached = getCachedDashboard(cacheKey);
  if (cached) {
    res.set("X-CaseDesk-Cache", "hit");
    return res.json({ data: cached });
  }
  res.set("X-CaseDesk-Cache", "miss");
  const canViewFinancialData = canViewDashboardFinancialData(req);
  const {
    clientWhere,
    caseWhere,
    taskWhere,
    appointmentWhere,
    documentWhere,
    followUpWhere,
    activityWhere,
    paymentWhere,
    caseInvoiceWhere,
    bookingPaymentHoldWhere,
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
    pendingLegacyPayments,
    pendingLegacyPaymentTotals,
    pendingCaseInvoices,
    pendingCaseInvoiceTotals,
    pendingBookingHolds,
    pendingBookingHoldTotals,
    casePipelineRaw,
    upcomingAppointments,
    upcomingFollowUps,
    followUpsDueTodayList,
    casesWaitingUpdateCount,
    casesWaitingUpdate,
    recentActivity,
    overdueTasksByClient,
    todayTasksByClient,
    documentActionsByClient,
    casesWaitingUpdateByClient,
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
    canViewFinancialData
      ? prisma.payment.count({
          where: { ...paymentWhere, status: { in: ["Unpaid", "Partial"] } },
        })
      : Promise.resolve(0),
    canViewFinancialData
      ? prisma.payment.aggregate({
          where: { ...paymentWhere, status: { in: ["Unpaid", "Partial"] } },
          _sum: { balance: true },
        })
      : Promise.resolve({ _sum: { balance: null } }),
    canViewFinancialData
      ? prisma.caseInvoice.count({
          where: { ...caseInvoiceWhere, status: { in: ["Open", "Overdue", "PartiallyPaid"] } },
        })
      : Promise.resolve(0),
    canViewFinancialData
      ? prisma.caseInvoice.aggregate({
          where: { ...caseInvoiceWhere, status: { in: ["Open", "Overdue", "PartiallyPaid"] } },
          _sum: { balance: true },
        })
      : Promise.resolve({ _sum: { balance: null } }),
    canViewFinancialData
      ? prisma.bookingPaymentHold.count({
          where: { ...bookingPaymentHoldWhere, status: "AwaitingPayment" },
        })
      : Promise.resolve(0),
    canViewFinancialData
      ? prisma.bookingPaymentHold.aggregate({
          where: { ...bookingPaymentHoldWhere, status: "AwaitingPayment" },
          _sum: { amount: true },
        })
      : Promise.resolve({ _sum: { amount: null } }),
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
        description: true,
        location: true,
        startsAt: true,
        endsAt: true,
        status: true,
        meetingMode: true,
        guestName: true,
        client: { select: { id: true, fullName: true } },
        case: { select: caseSummarySelect },
        assignedTo: { select: { id: true, fullName: true } },
        sessionType: { select: { name: true } },
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
    prisma.followUp.findMany({
      where: { ...openFollowUpWhere, dueDate: { gte: todayStart, lt: tomorrowStart } },
      orderBy: { dueDate: "asc" },
      take: 300,
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
          {
            action: {
              notIn: canViewFinancialData
                ? DASHBOARD_HIDDEN_ACTIVITY_ACTIONS
                : [
                    ...DASHBOARD_HIDDEN_ACTIVITY_ACTIONS,
                    ...DASHBOARD_FINANCIAL_ACTIVITY_ACTIONS,
                  ],
            },
          },
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
    // Kept separate from the take:5 "Cases Waiting for Update" query below,
    // which relies on staying capped for its own card layout — these feed
    // the Priority Work widget's per-client grouping, and are also exposed
    // flat as data.todayTasks/overdueTasks/documentActions for the dashboard
    // drawers, so a client with a lot of open work can't crowd every other
    // client out of the visible slots. Bounded generously rather than left
    // uncapped, as a defensive limit against a pathological agency-wide
    // backlog, not a designed UX cap.
    prisma.caseWorkflowStep.findMany({
      where: { ...pendingTaskWhere, dueAt: { lt: todayStart } },
      orderBy: { dueAt: "asc" },
      take: 300,
      select: { id: true, title: true, description: true, priority: true, dueAt: true, isStandaloneTask: true, case: { select: caseSummarySelect } },
    }),
    prisma.caseWorkflowStep.findMany({
      where: { ...pendingTaskWhere, dueAt: { gte: todayStart, lt: tomorrowStart } },
      orderBy: [{ priority: "desc" }, { dueAt: "asc" }],
      take: 300,
      select: { id: true, title: true, description: true, priority: true, dueAt: true, isStandaloneTask: true, case: { select: caseSummarySelect } },
    }),
    prisma.clientDocument.findMany({
      where: { ...documentWhere, status: { in: ["Requested", "Uploaded", "UnderReview", "ChangesRequested"] } },
      orderBy: { updatedAt: "asc" },
      take: 300,
      select: { id: true, documentName: true, status: true, updatedAt: true, client: { select: { id: true, fullName: true } }, case: { select: { id: true, caseType: true } } },
    }),
    prisma.case.findMany({
      where: waitingCaseWhere,
      orderBy: { updatedAt: "asc" },
      take: 300,
      select: caseSummarySelect,
    }),
  ]);

  const priorityWork = groupWorkByClient({
    overdueTasksByClient,
    todayTasksByClient,
    documentActionsByClient,
    casesWaitingUpdateByClient,
  });

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
        ...(canViewFinancialData
          ? {
              // Combines legacy retainers, case invoices, and consultation
              // payment holds. The entire block is omitted when Financial
              // Information is disabled for the team member.
              pendingPayments:
                pendingLegacyPayments + pendingCaseInvoices + pendingBookingHolds,
              pendingPaymentBalance:
                Number(pendingLegacyPaymentTotals._sum.balance ?? 0) +
                Number(pendingCaseInvoiceTotals._sum.balance ?? 0) +
                Number(pendingBookingHoldTotals._sum.amount ?? 0),
            }
          : {}),
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
      // Reuses the take:300 *ByClient lists already fetched for the Priority
      // Work grouping above — these are the same underlying data, just also
      // exposed flat for the dashboard drawers (Pending Documents / Tasks
      // Due Today / Overdue Tasks) to drill into without a second fetch.
      todayTasks: todayTasksByClient,
      overdueTasks: overdueTasksByClient,
      documentActions: documentActionsByClient,
      priorityWork,
      upcomingFollowUps,
      followUpsDueTodayList,
      casesWaitingUpdate,
      recentActivity,
  };
  const [registry, analytics, waitlist] = await Promise.all([
    buildAppointmentRegistry(req, { attendance: "all", range: "today", page: 1, limit: 6 }).catch(() => null),
    req.auth.role === "admin" ? buildSchedulingAnalytics(req, { range: "today" }).catch(() => null) : Promise.resolve(null),
    req.auth.role === "admin" ? buildBookingWaitlist(req, "Waiting").catch(() => null) : Promise.resolve(null),
  ]);
  data.scheduling = { registry, analytics, waitlist };

  setCachedDashboard(cacheKey, data);
  return res.json({ data });
}

export default { getDashboardSummary };
