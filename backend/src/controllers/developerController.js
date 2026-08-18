import prisma from "../services/prisma/client.js";
import { createHttpError } from "../utils/http.js";
import { listFeatureFlags, setFeatureFlag } from "../services/featureFlags.js";

const ACTIVE_CASE_STATUSES = ["Active", "In Progress", "On Hold"];
// The developer role's own home agency (see getDeveloperOverview) — never a
// real customer, so every cross-agency view here excludes it the same way.
const DEVELOPER_AGENCY_FILTER = { slug: { not: "casedesk-developer" } };
const SUPPORT_TICKET_STATUSES = ["Submitted", "Investigating", "Resolved", "Closed"];

export async function getDeveloperOverview(req, res) {
  const now = new Date();
  const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const [
    agencies,
    activeAgencies,
    staff,
    clients,
    activeCases,
    openLeads,
    activity24h,
    activeUsers7d,
    supportOpen,
    supportDeliveryPending,
  ] = await Promise.all([
    prisma.agency.count({ where: { slug: { not: "casedesk-developer" } } }),
    prisma.agency.count({ where: { status: "active", accessStatus: "active", slug: { not: "casedesk-developer" } } }),
    prisma.user.count({ where: { status: "active", role: { in: ["admin", "consultant", "frontdesk"] }, agency: { slug: { not: "casedesk-developer" } } } }),
    prisma.client.count({ where: { archivedAt: null, agency: { slug: { not: "casedesk-developer" } } } }),
    prisma.case.count({ where: { deletedAt: null, status: { in: ACTIVE_CASE_STATUSES }, agency: { slug: { not: "casedesk-developer" } } } }),
    prisma.lead.count({ where: { status: { in: ["OPEN", "NURTURE"] }, agency: { slug: { not: "casedesk-developer" } } } }),
    prisma.activityLog.count({ where: { createdAt: { gte: dayAgo }, agency: { slug: { not: "casedesk-developer" } } } }),
    prisma.activityLog.groupBy({ by: ["userId"], where: { createdAt: { gte: weekAgo }, userId: { not: null }, agency: { slug: { not: "casedesk-developer" } } } }),
    prisma.$queryRaw`SELECT COUNT(*)::int AS "count" FROM "support_tickets" WHERE "status" IN ('Submitted', 'Investigating')`,
    prisma.$queryRaw`SELECT COUNT(*)::int AS "count" FROM "support_tickets" WHERE "delivery_status" <> 'Delivered'`,
  ]);

  res.json({
    success: true,
    data: {
      generatedAt: now.toISOString(),
      adoption: { agencies, activeAgencies, staff, clients, activeCases, openLeads },
      usage: { activity24h, activeUsers7d: activeUsers7d.length },
      support: { open: supportOpen[0]?.count || 0, deliveryPending: supportDeliveryPending[0]?.count || 0 },
    },
  });
}

// One row per real customer agency, with the counts an operator actually
// wants at a glance — active staff, clients, active cases, open leads.
// Small dataset (agency count), so a per-agency Promise.all is simpler and
// plenty fast rather than a groupBy that would need four separate ones
// anyway (users/clients/cases/leads aren't the same table).
export async function listDeveloperAgencies(req, res) {
  const agencies = await prisma.agency.findMany({
    where: DEVELOPER_AGENCY_FILTER,
    select: { id: true, name: true, slug: true, status: true, accessStatus: true, onboardingStatus: true, createdAt: true },
    orderBy: { createdAt: "desc" },
  });
  const data = await Promise.all(agencies.map(async (agency) => {
    const [staff, clients, activeCases, openLeads] = await Promise.all([
      prisma.user.count({ where: { agencyId: agency.id, status: "active", role: { in: ["admin", "consultant", "frontdesk"] } } }),
      prisma.client.count({ where: { agencyId: agency.id, archivedAt: null } }),
      prisma.case.count({ where: { agencyId: agency.id, deletedAt: null, status: { in: ACTIVE_CASE_STATUSES } } }),
      prisma.lead.count({ where: { agencyId: agency.id, status: { in: ["OPEN", "NURTURE"] } } }),
    ]);
    return { ...agency, staff, clients, activeCases, openLeads };
  }));
  res.json({ data });
}

export async function getDeveloperAgency(req, res) {
  const agency = await prisma.agency.findFirst({ where: { id: req.params.id, ...DEVELOPER_AGENCY_FILTER } });
  if (!agency) throw createHttpError(404, "Agency not found.", "NOT_FOUND");
  const [staff, clients, activeCases, openLeads, recentActivity, openSupportTickets] = await Promise.all([
    prisma.user.findMany({ where: { agencyId: agency.id, status: "active" }, select: { id: true, fullName: true, email: true, role: true, createdAt: true }, orderBy: { createdAt: "asc" } }),
    prisma.client.count({ where: { agencyId: agency.id, archivedAt: null } }),
    prisma.case.count({ where: { agencyId: agency.id, deletedAt: null, status: { in: ACTIVE_CASE_STATUSES } } }),
    prisma.lead.count({ where: { agencyId: agency.id, status: { in: ["OPEN", "NURTURE"] } } }),
    prisma.activityLog.findMany({ where: { agencyId: agency.id }, orderBy: { createdAt: "desc" }, take: 25, include: { user: { select: { fullName: true } } } }),
    prisma.supportTicket.count({ where: { agencyId: agency.id, status: { in: ["Submitted", "Investigating"] } } }),
  ]);
  res.json({ data: { agency, staff, clients, activeCases, openLeads, recentActivity, openSupportTickets } });
}

// Every agency's reports land in one place — previously visible only by
// email (see supportTicketService.js), never inside the app itself.
export async function listDeveloperSupportTickets(req, res) {
  const status = String(req.query.status || "").trim();
  const where = status && SUPPORT_TICKET_STATUSES.includes(status) ? { status } : {};
  const tickets = await prisma.supportTicket.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: 200,
    include: { agency: { select: { name: true } }, reportedBy: { select: { fullName: true, email: true } } },
  });
  res.json({ data: tickets });
}

export async function updateDeveloperSupportTicketStatus(req, res) {
  const status = String(req.body?.status || "").trim();
  if (!SUPPORT_TICKET_STATUSES.includes(status)) throw createHttpError(400, `Status must be one of: ${SUPPORT_TICKET_STATUSES.join(", ")}`, "VALIDATION_ERROR");
  const ticket = await prisma.supportTicket.update({ where: { id: req.params.id }, data: { status } }).catch(() => null);
  if (!ticket) throw createHttpError(404, "Support ticket not found.", "NOT_FOUND");
  res.json({ data: ticket });
}

// A single cross-agency feed instead of having to open each agency's own
// activity log separately — mirrors the per-agency ActivityLog UI, just
// unscoped.
export async function listDeveloperActivity(req, res) {
  const agencyId = String(req.query.agencyId || "").trim();
  const where = { ...DEVELOPER_AGENCY_FILTER, ...(agencyId ? { agencyId } : {}) };
  const activity = await prisma.activityLog.findMany({
    where: { agency: where },
    orderBy: { createdAt: "desc" },
    take: 100,
    include: { agency: { select: { name: true } }, user: { select: { fullName: true } } },
  });
  res.json({ data: activity });
}

export async function getDeveloperFeatureFlags(req, res) {
  res.json({ data: await listFeatureFlags() });
}

export async function updateDeveloperFeatureFlag(req, res) {
  const enabled = Boolean(req.body?.enabled);
  await setFeatureFlag(req.params.key, enabled, req.auth.userId);
  res.json({ data: await listFeatureFlags() });
}

export default {
  getDeveloperOverview,
  listDeveloperAgencies,
  getDeveloperAgency,
  listDeveloperSupportTickets,
  updateDeveloperSupportTicketStatus,
  listDeveloperActivity,
  getDeveloperFeatureFlags,
  updateDeveloperFeatureFlag,
};
