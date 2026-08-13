// Zero-activity threshold alert (Team Workload refinement plan, Phase 6 —
// micro-management). Flags a staff member who has logged zero portal
// activity for N consecutive *working* days (weekends don't count against
// anyone) and tells the admin team once per person per day, not once per
// worker tick.
import prisma from "../../services/prisma/client.js";
import { logger } from "../../services/logger.js";
import { notifyUsers, adminRecipientIds } from "../../services/notificationService.js";

const DEFAULT_THRESHOLD_DAYS = Math.max(Number(process.env.WORKLOAD_ZERO_ACTIVITY_DAYS) || 2, 1);

function dateKey(date) {
  return date.toISOString().slice(0, 10);
}

// Most recent N weekday (Mon-Fri) dates strictly before today, most-recent
// first — "today" is excluded since the day isn't over yet.
export function lastWorkingDays(count, now = new Date()) {
  const days = [];
  const cursor = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  cursor.setUTCDate(cursor.getUTCDate() - 1);
  while (days.length < count) {
    const dow = cursor.getUTCDay();
    if (dow !== 0 && dow !== 6) days.push(new Date(cursor));
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }
  return days;
}

export async function runZeroActivityAlertPass(db = prisma, now = new Date(), thresholdDays = DEFAULT_THRESHOLD_DAYS) {
  const windowDays = lastWorkingDays(thresholdDays, now);
  const windowStart = windowDays[windowDays.length - 1];
  const windowDateKeys = new Set(windowDays.map(dateKey));

  const agencies = await db.agency.findMany({
    where: { status: "active" },
    select: { id: true },
  });

  const totals = { agencies: agencies.length, flagged: 0 };
  for (const agency of agencies) {
    const flagged = await checkAgencyZeroActivity(agency.id, { db, now, windowStart, windowDateKeys, thresholdDays });
    totals.flagged += flagged;
  }
  return totals;
}

async function checkAgencyZeroActivity(agencyId, { db, now, windowStart, windowDateKeys, thresholdDays }) {
  const members = await db.agencyMember.findMany({
    where: {
      agencyId,
      isActive: true,
      role: { in: ["admin", "consultant", "frontdesk"] },
      user: { status: "active" },
      // A brand-new hire hasn't had the chance to be inactive yet — only
      // flag people whose membership predates the whole check window.
      createdAt: { lte: windowStart },
    },
    select: { userId: true, user: { select: { id: true, fullName: true } } },
  });
  if (!members.length) return 0;

  const activityRows = await db.userPortalActivity.findMany({
    where: {
      agencyId,
      userId: { in: members.map((item) => item.userId) },
      activityDate: { gte: windowStart },
      activeSeconds: { gt: 0 },
    },
    select: { userId: true, activityDate: true },
  });
  const activeDaysByUser = new Map();
  for (const row of activityRows) {
    const key = dateKey(row.activityDate);
    if (!windowDateKeys.has(key)) continue;
    if (!activeDaysByUser.has(row.userId)) activeDaysByUser.set(row.userId, new Set());
    activeDaysByUser.get(row.userId).add(key);
  }

  const silentMembers = members.filter((member) => !(activeDaysByUser.get(member.userId)?.size));
  if (!silentMembers.length) return 0;

  const recipientIds = await adminRecipientIds(agencyId);
  if (!recipientIds.length) return 0;

  const todayKey = dateKey(now);
  for (const member of silentMembers) {
    await notifyUsers({
      agencyId,
      recipientIds,
      type: "workload.zero_activity",
      category: "team",
      title: `${member.user.fullName} has had no portal activity in ${thresholdDays} working day${thresholdDays === 1 ? "" : "s"}`,
      body: "No logins, actions, or portal time recorded — worth a quick check-in.",
      severity: "warning",
      entityType: "user",
      entityId: member.userId,
      actionUrl: "/app/workload",
      dedupeKey: `zero-activity:${agencyId}:${member.userId}:${todayKey}`,
    });
  }
  logger.info("workload.zero_activity_pass_completed", { agencyId, flagged: silentMembers.length });
  return silentMembers.length;
}
