import { Prisma } from "@prisma/client";
import prisma from "../../services/prisma/client.js";
import { loadAgencyWorkloads } from "../../controllers/adminConsultantController.js";
import { DUE_SOON_DAYS, parseWorkloadPeriod, workloadPeriodBounds } from "./workload.metrics.js";

// Case counts, capacity, and "overdue" deadlines all need the ownership-
// inheritance chain (explicit assignee -> case's primary CaseAssignment ->
// case owner -> client owner) that loadAgencyWorkloads()/resolveWorkOwner()
// already implement correctly — reused here rather than duplicated.
// Everything else in this report has direct FK attribution (createdById,
// handledByUserId, etc.) and doesn't need that inheritance, so it's
// computed fresh with one raw-SQL pass and merged in by user id.
export async function getTeamWorkloadReport(req, db = prisma, now = new Date()) {
  const agencyId = req.auth.agencyId;
  const period = parseWorkloadPeriod(req.query?.period);
  const { from, to } = workloadPeriodBounds(period, now);
  const dueSoonAt = new Date(now.getTime() + DUE_SOON_DAYS * 24 * 60 * 60_000);

  const [roster, agency, rows] = await Promise.all([
    // Default sliceLimit (10 items/category/person) — kept, not zeroed, so
    // the frontend's per-person drawer can reuse the existing WorkDetails/
    // ViewAllDrawer components against this same payload with no second
    // request; only a category with more than 10 items falls back to the
    // existing drill-down endpoint, exactly as the old per-consultant card
    // already did.
    loadAgencyWorkloads(agencyId),
    db.agency.findUnique({ where: { id: agencyId }, select: { defaultCurrency: true } }),
    db.$queryRaw(Prisma.sql`
      SELECT
        u.id,
        (SELECT COUNT(*)::int FROM "appointments" ap
          WHERE ap."agency_id" = ${agencyId} AND ap."created_by_id" = u.id
            AND ap."created_at" >= ${from} AND ap."created_at" <= ${to}) AS "appointmentsBooked",
        (SELECT COUNT(*)::int FROM "ooma_call_sessions" oc
          WHERE oc."agency_id" = ${agencyId} AND oc."handled_by_user_id" = u.id
            AND oc."started_at" >= ${from} AND oc."started_at" <= ${to}) AS "callsHandled",
        (SELECT COALESCE(SUM(oc."duration_seconds"), 0)::int FROM "ooma_call_sessions" oc
          WHERE oc."agency_id" = ${agencyId} AND oc."handled_by_user_id" = u.id
            AND oc."started_at" >= ${from} AND oc."started_at" <= ${to}) AS "callSeconds",
        (SELECT COUNT(DISTINCT al."case_id")::int FROM "activity_logs" al
          WHERE al."agency_id" = ${agencyId} AND al."user_id" = u.id AND al."case_id" IS NOT NULL
            AND al."created_at" >= ${from} AND al."created_at" <= ${to}) AS "casesWorkedOn",
        (SELECT COUNT(*)::int FROM "activity_logs" al
          WHERE al."agency_id" = ${agencyId} AND al."user_id" = u.id
            AND al."action" NOT IN ('USER_LOGIN', 'USER_LOGOUT')
            AND al."created_at" >= ${from} AND al."created_at" <= ${to}) AS "activityCount",
        -- Posted + Payment only — the settled, "real money moved" signal
        -- (mirrors paymentsOverviewService.js's getCashOnHand/cashDayTotals),
        -- narrower than that convention by excluding type='Refund' outflows,
        -- since money *collected* shouldn't count money going back out.
        (SELECT COALESCE(SUM(ct."amount"), 0) FROM "cash_transactions" ct
          WHERE ct."created_by_id" = u.id AND ct."status" = 'Posted' AND ct."type" = 'Payment'
            AND ct."occurred_at" >= ${from} AND ct."occurred_at" <= ${to}) AS "moneyCollected",
        (SELECT COALESCE(SUM(pa."active_seconds"), 0)::int FROM "user_portal_activity" pa
          WHERE pa."agency_id" = ${agencyId} AND pa."user_id" = u.id
            AND pa."activity_date" >= ${from}::date AND pa."activity_date" <= ${to}::date) AS "portalActiveSeconds",
        -- All-time (not period-bound) most recent heartbeat — the online/
        -- last-active indicator needs "have they pinged recently at all",
        -- not "did they ping within whatever period filter is selected".
        (SELECT MAX(pa."last_ping_at") FROM "user_portal_activity" pa
          WHERE pa."agency_id" = ${agencyId} AND pa."user_id" = u.id) AS "lastActiveAt",
        (
          (SELECT COUNT(*)::int FROM "follow_ups" f
            WHERE f."agency_id" = ${agencyId} AND f."assigned_user_id" = u.id
              AND f."status"::text = 'Pending' AND f."due_date" BETWEEN ${now} AND ${dueSoonAt})
          + (SELECT COUNT(*)::int FROM "lead_follow_ups" lf
            WHERE lf."agency_id" = ${agencyId} AND lf."assigned_user_id" = u.id
              AND lf."status"::text = 'PENDING' AND lf."due_at" BETWEEN ${now} AND ${dueSoonAt})
          + (SELECT COUNT(*)::int FROM "case_workflow_steps" cws
            WHERE cws."agency_id" = ${agencyId} AND cws."assigned_to_id" = u.id
              AND cws."status"::text = 'Pending' AND cws."is_active" = true
              AND cws."due_at" BETWEEN ${now} AND ${dueSoonAt})
        )::int AS "deadlinesDueSoon"
      FROM "users" u
      JOIN "agency_members" m ON m."user_id" = u.id AND m."agency_id" = ${agencyId}
        AND m."is_active" = true AND m.role::text IN ('admin', 'consultant', 'frontdesk')
      WHERE u."agency_id" = ${agencyId} AND u.status::text = 'active'
    `),
  ]);

  const metricsByUserId = new Map(rows.map((row) => [row.id, row]));
  const members = roster.consultants.map((member) => {
    const metrics = metricsByUserId.get(member.consultant.id) || {};
    return {
      ...member,
      appointmentsBooked: Number(metrics.appointmentsBooked || 0),
      callsHandled: Number(metrics.callsHandled || 0),
      callSeconds: Number(metrics.callSeconds || 0),
      casesWorkedOn: Number(metrics.casesWorkedOn || 0),
      activityCount: Number(metrics.activityCount || 0),
      moneyCollected: Number(metrics.moneyCollected || 0),
      portalActiveSeconds: Number(metrics.portalActiveSeconds || 0),
      lastActiveAt: metrics.lastActiveAt || null,
      // "Overdue" is free from the roster call (already computed by
      // addWork() from the same FollowUp/LeadFollowUp/CaseWorkflowStep
      // models); only "due soon" needed a new query.
      deadlinesOverdue: member.overdueTasks + member.overdueFollowUps,
      deadlinesDueSoon: Number(metrics.deadlinesDueSoon || 0),
    };
  });

  const unassignedWork =
    roster.unassigned.activeLeads +
    roster.unassigned.activeCases +
    roster.unassigned.pendingTasks +
    roster.unassigned.documentsWaitingReview +
    roster.unassigned.pendingFollowUps +
    roster.unassigned.upcomingAppointments;

  const summary = {
    activeStaff: members.length,
    activeCases: roster.summary.activeCases,
    appointmentsBooked: members.reduce((sum, item) => sum + item.appointmentsBooked, 0),
    callsHandled: members.reduce((sum, item) => sum + item.callsHandled, 0),
    moneyCollected: members.reduce((sum, item) => sum + item.moneyCollected, 0),
    portalActiveSeconds: members.reduce((sum, item) => sum + item.portalActiveSeconds, 0),
    unassignedWork,
  };

  return {
    generatedAt: now,
    currency: agency?.defaultCurrency || "CAD",
    period: { value: period, from, to },
    summary,
    members,
    unassigned: roster.unassigned,
  };
}

// Day-by-day series for the roster (or a specific subset — the Compare
// view passes 2-4 userIds), reusing the exact same five sources as the
// period-summed report above, just grouped by calendar day instead of
// summed once across the whole window. This is what makes "how did today
// compare to yesterday" answerable at all — everything elsewhere on this
// page only ever shows one number per person per period.
export async function getWorkloadDailyTrend(req, db = prisma, now = new Date()) {
  const agencyId = req.auth.agencyId;
  const days = Math.min(60, Math.max(1, Number.parseInt(req.query?.days, 10) || 14));
  const requestedIds = String(req.query?.userIds || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
    .slice(0, 6);

  const to = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const from = new Date(to.getTime() - (days - 1) * 24 * 60 * 60_000);

  const rows = await db.$queryRaw(Prisma.sql`
    WITH days AS (
      SELECT generate_series(${from}::date, ${to}::date, interval '1 day')::date AS day
    ),
    roster AS (
      SELECT u.id, u.full_name AS "fullName"
      FROM "users" u
      JOIN "agency_members" m ON m."user_id" = u.id AND m."agency_id" = ${agencyId}
        AND m."is_active" = true AND m.role::text IN ('admin', 'consultant', 'frontdesk')
      WHERE u."agency_id" = ${agencyId} AND u.status::text = 'active'
        ${requestedIds.length ? Prisma.sql`AND u.id IN (${Prisma.join(requestedIds)})` : Prisma.empty}
    )
    SELECT
      r.id AS "userId",
      r."fullName",
      d.day,
      COALESCE(pa.active_seconds, 0)::int AS "activeSeconds",
      COALESCE(ap.cnt, 0)::int AS "appointmentsBooked",
      COALESCE(oc.cnt, 0)::int AS "callsHandled",
      COALESCE(ct.amt, 0) AS "moneyCollected",
      COALESCE(al.cnt, 0)::int AS "activityCount"
    FROM roster r
    CROSS JOIN days d
    LEFT JOIN "user_portal_activity" pa
      ON pa.user_id = r.id AND pa.agency_id = ${agencyId} AND pa.activity_date = d.day
    LEFT JOIN (
      SELECT created_by_id AS user_id, created_at::date AS day, COUNT(*) AS cnt
      FROM "appointments" WHERE agency_id = ${agencyId} GROUP BY created_by_id, created_at::date
    ) ap ON ap.user_id = r.id AND ap.day = d.day
    LEFT JOIN (
      SELECT handled_by_user_id AS user_id, started_at::date AS day, COUNT(*) AS cnt
      FROM "ooma_call_sessions" WHERE agency_id = ${agencyId} GROUP BY handled_by_user_id, started_at::date
    ) oc ON oc.user_id = r.id AND oc.day = d.day
    LEFT JOIN (
      SELECT created_by_id AS user_id, occurred_at::date AS day, SUM(amount) AS amt
      FROM "cash_transactions" WHERE status = 'Posted' AND type = 'Payment' GROUP BY created_by_id, occurred_at::date
    ) ct ON ct.user_id = r.id AND ct.day = d.day
    LEFT JOIN (
      SELECT user_id, created_at::date AS day, COUNT(*) AS cnt
      FROM "activity_logs" WHERE agency_id = ${agencyId} AND action NOT IN ('USER_LOGIN', 'USER_LOGOUT') GROUP BY user_id, created_at::date
    ) al ON al.user_id = r.id AND al.day = d.day
    ORDER BY r.id, d.day
  `);

  const byUser = new Map();
  for (const row of rows) {
    if (!byUser.has(row.userId)) {
      byUser.set(row.userId, { userId: row.userId, fullName: row.fullName, days: [] });
    }
    byUser.get(row.userId).days.push({
      day: row.day.toISOString().slice(0, 10),
      activeSeconds: Number(row.activeSeconds || 0),
      appointmentsBooked: Number(row.appointmentsBooked || 0),
      callsHandled: Number(row.callsHandled || 0),
      moneyCollected: Number(row.moneyCollected || 0),
      activityCount: Number(row.activityCount || 0),
    });
  }

  return {
    from: from.toISOString().slice(0, 10),
    to: to.toISOString().slice(0, 10),
    members: [...byUser.values()],
  };
}
