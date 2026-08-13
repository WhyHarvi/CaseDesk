// Overdue-lead-action alerts. Mirrors lead.staleOutreach.service.js's
// per-agency-settings-gated pass shape: find agencies that opted in, run one
// pass per agency, record when it last ran. Two tiers per agency: the owner
// gets a personal daily nudge for their own overdue count, and admins get a
// separate alert only for whichever owner has crossed the configured
// threshold — so a handful of overdue leads doesn't page an admin, but a
// pile building toward another Manpreet-sized imbalance does.
import prisma from "../../services/prisma/client.js";
import { logger } from "../../services/logger.js";
import { notifyUsers, adminRecipientIds } from "../../services/notificationService.js";

function dateKey(date) {
  return date.toISOString().slice(0, 10);
}

export function overdueLeadWhere(agencyId, now = new Date()) {
  return {
    agencyId,
    deletedAt: null,
    status: "OPEN",
    pipelineSegment: "STANDARD",
    nextActionAt: { lt: now },
  };
}

// Pure: turns raw per-owner overdue counts into the notify plan, with no DB
// or notification-service dependency — the part worth unit testing directly.
export function planOverdueAlerts(grouped, threshold) {
  return grouped
    .filter((row) => row.ownerUserId && row._count)
    .map((row) => ({ ownerId: row.ownerUserId, count: row._count, notifyAdmin: row._count >= threshold }));
}

export async function runOverdueLeadAlertForAgency(agencyId, db = prisma, now = new Date(), knownSettings = null) {
  const settings = knownSettings || await db.leadSettings.findUnique({ where: { agencyId } });
  if (!settings?.overdueAlertEnabled) return { agencies: 0, ownersNotified: 0, adminAlertsSent: 0 };

  const grouped = await db.lead.groupBy({
    by: ["ownerUserId"],
    where: overdueLeadWhere(agencyId, now),
    _count: true,
  });
  const plan = planOverdueAlerts(grouped, settings.overdueAlertAdminThreshold);
  const totals = { agencies: 1, ownersNotified: 0, adminAlertsSent: 0 };

  if (db === prisma && plan.length) {
    const todayKey = dateKey(now);
    let adminRecipients = null;
    for (const { ownerId, count, notifyAdmin } of plan) {
      await notifyUsers({
        agencyId,
        recipientIds: [ownerId],
        type: "lead.overdue_actions",
        category: "leads",
        title: `You have ${count} overdue lead${count === 1 ? "" : "s"}`,
        body: "Their next action is past due — worth clearing before the backlog grows.",
        severity: notifyAdmin ? "warning" : "info",
        entityType: "user",
        entityId: ownerId,
        actionUrl: "/leads",
        // "update" (not the severity-derived default) is what makes this
        // eligible for the existing daily digest email batch — this alert is
        // meant to land as a rollup, not interrupt like zero-activity does.
        attentionLevel: "update",
        dedupeKey: `lead-overdue:${agencyId}:${ownerId}:${todayKey}`,
      });
      totals.ownersNotified += 1;

      if (notifyAdmin) {
        if (adminRecipients === null) adminRecipients = await adminRecipientIds(agencyId);
        if (adminRecipients.length) {
          await notifyUsers({
            agencyId,
            recipientIds: adminRecipients,
            type: "lead.overdue_actions_admin",
            category: "leads",
            title: `A team member has ${count} overdue leads`,
            body: "Their overdue count has crossed your alert threshold.",
            severity: "warning",
            entityType: "user",
            entityId: ownerId,
            actionUrl: "/leads",
            attentionLevel: "update",
            dedupeKey: `lead-overdue-admin:${agencyId}:${ownerId}:${todayKey}`,
          });
          totals.adminAlertsSent += 1;
        }
      }
    }
    logger.info("lead.overdue_alert_pass_completed", { agencyId, ...totals });
  }

  await db.leadSettings.update({ where: { id: settings.id }, data: { overdueAlertLastRunAt: now } });
  return totals;
}

export async function runOverdueLeadAlertPass(db = prisma, now = new Date()) {
  const settingsRows = await db.leadSettings.findMany({ where: { overdueAlertEnabled: true }, take: 100 });
  const totals = { agencies: 0, ownersNotified: 0, adminAlertsSent: 0 };
  for (const settings of settingsRows) {
    const result = await runOverdueLeadAlertForAgency(settings.agencyId, db, now, settings);
    totals.agencies += result.agencies;
    totals.ownersNotified += result.ownersNotified;
    totals.adminAlertsSent += result.adminAlertsSent;
  }
  return totals;
}
