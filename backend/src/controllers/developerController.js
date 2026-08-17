import prisma from "../services/prisma/client.js";

const ACTIVE_CASE_STATUSES = ["Active", "In Progress", "On Hold"];

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

export default { getDeveloperOverview };
