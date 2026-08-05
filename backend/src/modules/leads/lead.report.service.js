import { Prisma } from "@prisma/client";
import prisma from "../../services/prisma/client.js";
import { leadAccessWhere } from "./lead.permissions.js";
import { buildFunnel, DEFAULT_INACTIVE_LEAD_DAYS, INVALID_CONVERSION_STATUSES, parseReportDays, reportingBounds } from "./lead.metrics.js";

export async function getFunnelReport(req, db = prisma, now = new Date()) {
  const agencyId = req.auth.agencyId;
  const days = parseReportDays(req.query?.days);
  const access = leadAccessWhere(req);
  const period = days ? { gte: new Date(now.getTime() - days * 24 * 60 * 60_000), lte: now } : undefined;
  const base = {
    agencyId,
    deletedAt: null,
    status: { notIn: INVALID_CONVERSION_STATUSES },
    ...access,
    ...(period ? { createdAt: period } : {}),
  };
  const reachedStage = (stage) => ({ OR: [{ stage }, { stageHistory: { some: { agencyId, newStage: stage } } }] });

  const [received, contacted, connected, qualified, consultationBooked, consultationCompleted, retainerPending, paymentPending, converted] = await Promise.all([
    db.lead.count({ where: base }),
    db.lead.count({ where: { ...base, firstContactAt: { not: null } } }),
    db.lead.count({ where: { ...base, firstConnectedAt: { not: null } } }),
    db.lead.count({ where: { ...base, OR: [{ qualification: { outcome: "QUALIFIED" } }, { stageHistory: { some: { agencyId, newStage: "QUALIFIED" } } }] } }),
    db.lead.count({ where: { ...base, consultations: { some: {} } } }),
    db.lead.count({ where: { ...base, consultations: { some: { status: "COMPLETED" } } } }),
    db.lead.count({ where: { ...base, ...reachedStage("RETAINER_PENDING") } }),
    db.lead.count({ where: { ...base, ...reachedStage("PAYMENT_PENDING") } }),
    db.lead.count({ where: { ...base, status: "CONVERTED" } }),
  ]);

  const counts = {
    RECEIVED: received,
    CONTACTED: contacted,
    CONNECTED: connected,
    QUALIFIED: qualified,
    CONSULTATION_BOOKED: consultationBooked,
    CONSULTATION_COMPLETED: consultationCompleted,
    RETAINER_PENDING: retainerPending,
    PAYMENT_PENDING: paymentPending,
    CONVERTED: converted,
  };
  return {
    generatedAt: now,
    range: { days, from: period?.gte || null, to: now },
    overallConversionRate: received ? Math.round((converted / received) * 1000) / 10 : 0,
    funnel: buildFunnel(counts),
  };
}

export async function getSourceReport(req, db = prisma, now = new Date()) {
  const agencyId = req.auth.agencyId;
  const days = parseReportDays(req.query?.days);
  const from = days ? new Date(now.getTime() - days * 24 * 60 * 60_000) : null;
  const ownerScope = req.auth.role === "admin" ? Prisma.empty : Prisma.sql`AND l."owner_user_id" = ${req.auth.userId}`;
  const periodScope = from ? Prisma.sql`AND l."created_at" >= ${from} AND l."created_at" <= ${now}` : Prisma.empty;

  const rows = await db.$queryRaw(Prisma.sql`
    SELECT
      s.id,
      s.name,
      s.type::text AS type,
      a."default_currency" AS currency,
      COUNT(l.id)::int AS "leadsReceived",
      COUNT(l.id) FILTER (WHERE l."first_contact_at" IS NOT NULL)::int AS contacted,
      COUNT(l.id) FILTER (WHERE q.outcome::text = 'QUALIFIED' OR EXISTS (
        SELECT 1 FROM "lead_stage_history" sh WHERE sh."lead_id" = l.id AND sh."agency_id" = ${agencyId} AND sh."new_stage"::text = 'QUALIFIED'
      ))::int AS qualified,
      COUNT(l.id) FILTER (WHERE EXISTS (SELECT 1 FROM "lead_consultations" c WHERE c."lead_id" = l.id AND c."agency_id" = ${agencyId}))::int AS consultations,
      COUNT(l.id) FILTER (WHERE l.status::text = 'CONVERTED')::int AS converted,
      COUNT(l.id) FILTER (WHERE l.status::text = 'LOST')::int AS lost,
      COALESCE(SUM(l."estimated_value") FILTER (WHERE l.status::text = 'OPEN'), 0) AS "pipelineValue",
      COALESCE(SUM(cv."actual_value") FILTER (WHERE l.status::text = 'CONVERTED'), 0) AS "convertedValue",
      ROUND(AVG(EXTRACT(EPOCH FROM (l."first_contact_at" - l."created_at")) / 60) FILTER (WHERE l."first_contact_at" IS NOT NULL), 1) AS "averageResponseMinutes",
      MODE() WITHIN GROUP (ORDER BY ld."reason_code"::text) FILTER (WHERE l.status::text = 'LOST') AS "mainLostReason"
    FROM "lead_sources" s
    JOIN "agencies" a ON a.id = s."agency_id"
    LEFT JOIN "leads" l ON l."original_source_id" = s.id
      AND l."agency_id" = ${agencyId}
      AND l."deleted_at" IS NULL
      AND l.status::text NOT IN ('DUPLICATE', 'ARCHIVED')
      AND NOT EXISTS (SELECT 1 FROM "lead_import_rows" lir WHERE lir."created_lead_id" = l.id) AND NOT EXISTS (SELECT 1 FROM "lead_activities" la WHERE la."lead_id" = l.id AND la.title = 'Admissions detail (imported)')
      ${ownerScope}
      ${periodScope}
    LEFT JOIN "lead_qualifications" q ON q."lead_id" = l.id AND q."agency_id" = ${agencyId}
    LEFT JOIN "lead_conversions" cv ON cv."lead_id" = l.id AND cv."agency_id" = ${agencyId}
    LEFT JOIN "lead_lost_details" ld ON ld."lead_id" = l.id AND ld."agency_id" = ${agencyId}
    WHERE s."agency_id" = ${agencyId} AND s."is_active" = true
    GROUP BY s.id, s.name, s.type, a."default_currency"
    HAVING COUNT(l.id) > 0
    ORDER BY COUNT(l.id) DESC, s.name ASC
  `);

  const sources = rows.map((row) => ({
    ...row,
    pipelineValue: Number(row.pipelineValue || 0),
    convertedValue: Number(row.convertedValue || 0),
    averageResponseMinutes: row.averageResponseMinutes === null ? null : Number(row.averageResponseMinutes),
    conversionRate: row.leadsReceived ? Math.round((row.converted / row.leadsReceived) * 1000) / 10 : 0,
  }));
  return {
    generatedAt: now,
    currency: sources[0]?.currency || "CAD",
    range: { days, from, to: now },
    summary: {
      sourcesWithLeads: sources.length,
      leadsReceived: sources.reduce((sum, source) => sum + source.leadsReceived, 0),
      converted: sources.reduce((sum, source) => sum + source.converted, 0),
    },
    sources,
  };
}

export async function getEmployeeReport(req, db = prisma, now = new Date()) {
  const agencyId = req.auth.agencyId;
  const days = parseReportDays(req.query?.days);
  const from = days ? new Date(now.getTime() - days * 24 * 60 * 60_000) : null;
  const leadOwnerScope = req.auth.role === "admin" ? Prisma.empty : Prisma.sql`AND l."owner_user_id" = ${req.auth.userId}`;
  const employeeScope = req.auth.role === "admin" ? Prisma.empty : Prisma.sql`AND u.id = ${req.auth.userId}`;
  const periodScope = from ? Prisma.sql`AND l."created_at" >= ${from} AND l."created_at" <= ${now}` : Prisma.empty;

  const rows = await db.$queryRaw(Prisma.sql`
    WITH scoped_leads AS (
      SELECT l.* FROM "leads" l
      WHERE l."agency_id" = ${agencyId}
        AND l."deleted_at" IS NULL
        AND l.status::text NOT IN ('DUPLICATE', 'ARCHIVED')
        AND NOT EXISTS (SELECT 1 FROM "lead_import_rows" lir WHERE lir."created_lead_id" = l.id) AND NOT EXISTS (SELECT 1 FROM "lead_activities" la WHERE la."lead_id" = l.id AND la.title = 'Admissions detail (imported)')
        ${leadOwnerScope}
        ${periodScope}
    ),
    lead_metrics AS (
      SELECT
        sl."owner_user_id" AS user_id,
        COUNT(*)::int AS "leadsAssigned",
        COUNT(*) FILTER (WHERE sl."first_contact_at" IS NOT NULL)::int AS "newLeadsHandled",
        COUNT(*) FILTER (WHERE sl."first_connected_at" IS NOT NULL)::int AS "successfulConnections",
        COUNT(*) FILTER (WHERE sl.status::text = 'CONVERTED')::int AS converted,
        COUNT(*) FILTER (WHERE sl.status::text = 'LOST')::int AS lost,
        ROUND(AVG(EXTRACT(EPOCH FROM (sl."first_contact_at" - sl."created_at")) / 60) FILTER (WHERE sl."first_contact_at" IS NOT NULL), 1) AS "averageResponseMinutes",
        ROUND(AVG(EXTRACT(EPOCH FROM (sl."first_connected_at" - sl."created_at")) / 60) FILTER (WHERE sl."first_connected_at" IS NOT NULL), 1) AS "averageConnectionMinutes",
        COALESCE(SUM(cv."actual_value") FILTER (WHERE sl.status::text = 'CONVERTED'), 0) AS "convertedRevenue"
      FROM scoped_leads sl
      LEFT JOIN "lead_conversions" cv ON cv."lead_id" = sl.id AND cv."agency_id" = ${agencyId}
      GROUP BY sl."owner_user_id"
    ),
    activity_metrics AS (
      SELECT
        a."performed_by" AS user_id,
        COUNT(*) FILTER (WHERE a."activity_type"::text IN ('OUTGOING_CALL', 'WHATSAPP_SENT', 'SMS_SENT', 'EMAIL_SENT'))::int AS "contactAttempts",
        COUNT(*) FILTER (WHERE a."activity_type"::text = 'OUTGOING_CALL')::int AS "callsCompleted",
        COUNT(*) FILTER (WHERE a."activity_type"::text = 'OUTGOING_CALL' AND a.outcome IN ('NO_ANSWER', 'VOICEMAIL_LEFT'))::int AS "noAnswerCalls"
      FROM "lead_activities" a
      JOIN scoped_leads sl ON sl.id = a."lead_id"
      WHERE a."agency_id" = ${agencyId} AND a."performed_by" IS NOT NULL
      GROUP BY a."performed_by"
    ),
    follow_up_metrics AS (
      SELECT
        f."assigned_user_id" AS user_id,
        COUNT(*) FILTER (WHERE f."due_at" <= ${now})::int AS "followUpsDue",
        COUNT(*) FILTER (WHERE f.status::text = 'COMPLETED')::int AS "followUpsCompleted",
        COUNT(*) FILTER (WHERE f.status::text = 'PENDING' AND f."due_at" < ${now})::int AS "followUpsOverdue"
      FROM "lead_follow_ups" f
      JOIN scoped_leads sl ON sl.id = f."lead_id"
      WHERE f."agency_id" = ${agencyId}
      GROUP BY f."assigned_user_id"
    ),
    consultation_metrics AS (
      SELECT
        c."consultant_user_id" AS user_id,
        COUNT(*)::int AS "consultationsBooked",
        COUNT(*) FILTER (WHERE c.status::text = 'COMPLETED')::int AS "consultationsCompleted"
      FROM "lead_consultations" c
      JOIN scoped_leads sl ON sl.id = c."lead_id"
      WHERE c."agency_id" = ${agencyId}
      GROUP BY c."consultant_user_id"
    )
    SELECT
      u.id,
      u."full_name" AS name,
      u.email,
      COALESCE(lm."leadsAssigned", 0)::int AS "leadsAssigned",
      COALESCE(lm."newLeadsHandled", 0)::int AS "newLeadsHandled",
      COALESCE(am."contactAttempts", 0)::int AS "contactAttempts",
      COALESCE(am."callsCompleted", 0)::int AS "callsCompleted",
      COALESCE(lm."successfulConnections", 0)::int AS "successfulConnections",
      COALESCE(am."noAnswerCalls", 0)::int AS "noAnswerCalls",
      COALESCE(fm."followUpsDue", 0)::int AS "followUpsDue",
      COALESCE(fm."followUpsCompleted", 0)::int AS "followUpsCompleted",
      COALESCE(fm."followUpsOverdue", 0)::int AS "followUpsOverdue",
      COALESCE(cm."consultationsBooked", 0)::int AS "consultationsBooked",
      COALESCE(cm."consultationsCompleted", 0)::int AS "consultationsCompleted",
      COALESCE(lm.converted, 0)::int AS converted,
      COALESCE(lm.lost, 0)::int AS lost,
      lm."averageResponseMinutes",
      lm."averageConnectionMinutes",
      COALESCE(lm."convertedRevenue", 0) AS "convertedRevenue",
      a."default_currency" AS currency
    FROM "users" u
    JOIN "agencies" a ON a.id = u."agency_id"
    JOIN "agency_members" m ON m."user_id" = u.id AND m."agency_id" = ${agencyId} AND m."is_active" = true AND m.role::text IN ('admin', 'consultant', 'frontdesk')
    LEFT JOIN lead_metrics lm ON lm.user_id = u.id
    LEFT JOIN activity_metrics am ON am.user_id = u.id
    LEFT JOIN follow_up_metrics fm ON fm.user_id = u.id
    LEFT JOIN consultation_metrics cm ON cm.user_id = u.id
    WHERE u."agency_id" = ${agencyId} AND u.status::text = 'active' ${employeeScope}
    ORDER BY COALESCE(lm.converted, 0) DESC, COALESCE(lm."leadsAssigned", 0) DESC, u."full_name" ASC
  `);

  const employees = rows.map((row) => ({
    ...row,
    averageResponseMinutes: row.averageResponseMinutes === null ? null : Number(row.averageResponseMinutes),
    averageConnectionMinutes: row.averageConnectionMinutes === null ? null : Number(row.averageConnectionMinutes),
    convertedRevenue: Number(row.convertedRevenue || 0),
    conversionRate: row.leadsAssigned ? Math.round((row.converted / row.leadsAssigned) * 1000) / 10 : 0,
    followUpCompletionRate: row.followUpsDue ? Math.round((row.followUpsCompleted / row.followUpsDue) * 1000) / 10 : 0,
  }));
  return {
    generatedAt: now,
    currency: employees[0]?.currency || "CAD",
    range: { days, from, to: now },
    summary: {
      employees: employees.length,
      leadsAssigned: employees.reduce((sum, employee) => sum + employee.leadsAssigned, 0),
      converted: employees.reduce((sum, employee) => sum + employee.converted, 0),
      convertedRevenue: employees.reduce((sum, employee) => sum + employee.convertedRevenue, 0),
    },
    employees,
  };
}

export async function getLostReport(req, db = prisma, now = new Date()) {
  const agencyId = req.auth.agencyId;
  const days = parseReportDays(req.query?.days);
  const from = days ? new Date(now.getTime() - days * 24 * 60 * 60_000) : null;
  const access = leadAccessWhere(req);
  const base = {
    agencyId,
    deletedAt: null,
    status: "LOST",
    ...access,
    ...(from ? { createdAt: { gte: from, lte: now } } : {}),
  };
  const relatedLead = { ...base };

  const [totalLost, noResponse, reactivationOpportunities, lostAfterConsultation, lostAfterAgreement, lostAfterPayment, reasonGroups, employeeGroups, sourceGroups] = await Promise.all([
    db.lead.count({ where: base }),
    db.lead.count({ where: { ...base, lostDetail: { reasonCode: "NO_RESPONSE" } } }),
    db.lead.count({ where: { ...base, lostDetail: { reactivationAllowed: true } } }),
    db.lead.count({ where: { ...base, OR: [{ consultations: { some: { status: { in: ["COMPLETED", "NO_SHOW"] } } } }, { stageHistory: { some: { newStage: "CONSULTATION_COMPLETED" } } }] } }),
    db.lead.count({ where: { ...base, OR: [{ retainerStatus: { in: ["DECLINED", "EXPIRED"] } }, { stageHistory: { some: { newStage: "RETAINER_PENDING" } } }] } }),
    db.lead.count({ where: { ...base, OR: [{ initialPaymentStatus: { in: ["FAILED", "REFUNDED"] } }, { stageHistory: { some: { newStage: "PAYMENT_PENDING" } } }] } }),
    db.leadLostDetail.groupBy({ by: ["reasonCode"], where: { agencyId, lead: relatedLead }, _count: { id: true }, orderBy: { _count: { id: "desc" } } }),
    db.lead.groupBy({ by: ["ownerUserId"], where: base, _count: { id: true }, orderBy: { _count: { id: "desc" } } }),
    db.lead.groupBy({ by: ["originalSourceId"], where: base, _count: { id: true }, orderBy: { _count: { id: "desc" } } }),
  ]);

  const employeeIds = employeeGroups.map((item) => item.ownerUserId);
  const sourceIds = sourceGroups.map((item) => item.originalSourceId);
  const [employees, sources] = await Promise.all([
    employeeIds.length ? db.user.findMany({ where: { agencyId, id: { in: employeeIds } }, select: { id: true, fullName: true } }) : [],
    sourceIds.length ? db.leadSource.findMany({ where: { agencyId, id: { in: sourceIds } }, select: { id: true, name: true, type: true } }) : [],
  ]);
  const employeeNames = new Map(employees.map((item) => [item.id, item.fullName]));
  const sourceNames = new Map(sources.map((item) => [item.id, item]));

  return {
    generatedAt: now,
    range: { days, from, to: now },
    summary: { totalLost, noResponse, reactivationOpportunities, lostAfterConsultation, lostAfterAgreement, lostAfterPayment },
    reasons: reasonGroups.map((item) => ({ reason: item.reasonCode, count: item._count.id, share: totalLost ? Math.round((item._count.id / totalLost) * 1000) / 10 : 0 })),
    employees: employeeGroups.map((item) => ({ id: item.ownerUserId, name: employeeNames.get(item.ownerUserId) || "Unknown employee", count: item._count.id })),
    sources: sourceGroups.map((item) => ({ id: item.originalSourceId, name: sourceNames.get(item.originalSourceId)?.name || "Unknown source", type: sourceNames.get(item.originalSourceId)?.type || null, count: item._count.id })),
  };
}

export async function getResponseTimeReport(req, db = prisma, now = new Date()) {
  const agencyId = req.auth.agencyId;
  const days = parseReportDays(req.query?.days);
  const from = days ? new Date(now.getTime() - days * 24 * 60 * 60_000) : null;
  const ownerScope = req.auth.role === "admin" ? Prisma.empty : Prisma.sql`AND l."owner_user_id" = ${req.auth.userId}`;
  const periodScope = from ? Prisma.sql`AND l."created_at" >= ${from} AND l."created_at" <= ${now}` : Prisma.empty;
  const scopedLeads = Prisma.sql`
    SELECT l.* FROM "leads" l
    WHERE l."agency_id" = ${agencyId}
      AND l."deleted_at" IS NULL
      AND l.status::text NOT IN ('DUPLICATE', 'ARCHIVED')
      AND NOT EXISTS (SELECT 1 FROM "lead_import_rows" lir WHERE lir."created_lead_id" = l.id) AND NOT EXISTS (SELECT 1 FROM "lead_activities" la WHERE la."lead_id" = l.id AND la.title = 'Admissions detail (imported)')
      ${ownerScope}
      ${periodScope}
  `;

  const [summaryRows, employeeRows, sourceRows] = await Promise.all([
    db.$queryRaw(Prisma.sql`
      WITH scoped_leads AS (${scopedLeads})
      SELECT
        COUNT(*) FILTER (WHERE "first_contact_due_at" IS NOT NULL AND ("first_contact_at" IS NOT NULL OR "first_contact_due_at" <= ${now}))::int AS evaluated,
        COUNT(*) FILTER (WHERE "first_contact_due_at" IS NOT NULL AND "first_contact_at" IS NOT NULL AND "first_contact_at" <= "first_contact_due_at")::int AS "onTime",
        COUNT(*) FILTER (WHERE "first_contact_due_at" IS NOT NULL AND (("first_contact_at" > "first_contact_due_at") OR ("first_contact_at" IS NULL AND "first_contact_due_at" <= ${now})))::int AS late,
        COUNT(*) FILTER (WHERE "first_contact_at" IS NULL)::int AS "neverContacted",
        ROUND(AVG(EXTRACT(EPOCH FROM ("first_contact_at" - "created_at")) / 60) FILTER (WHERE "first_contact_at" IS NOT NULL), 1) AS "averageFirstAttemptMinutes",
        ROUND(AVG(EXTRACT(EPOCH FROM ("first_connected_at" - "created_at")) / 60) FILTER (WHERE "first_connected_at" IS NOT NULL), 1) AS "averageConnectionMinutes"
      FROM scoped_leads
    `),
    db.$queryRaw(Prisma.sql`
      WITH scoped_leads AS (${scopedLeads})
      SELECT
        u.id,
        u."full_name" AS name,
        COUNT(sl.id) FILTER (WHERE sl."first_contact_due_at" IS NOT NULL AND (sl."first_contact_at" IS NOT NULL OR sl."first_contact_due_at" <= ${now}))::int AS evaluated,
        COUNT(sl.id) FILTER (WHERE sl."first_contact_due_at" IS NOT NULL AND sl."first_contact_at" IS NOT NULL AND sl."first_contact_at" <= sl."first_contact_due_at")::int AS "onTime",
        COUNT(sl.id) FILTER (WHERE sl."first_contact_due_at" IS NOT NULL AND ((sl."first_contact_at" > sl."first_contact_due_at") OR (sl."first_contact_at" IS NULL AND sl."first_contact_due_at" <= ${now})))::int AS late,
        COUNT(sl.id) FILTER (WHERE sl."first_contact_at" IS NULL)::int AS "neverContacted",
        ROUND(AVG(EXTRACT(EPOCH FROM (sl."first_contact_at" - sl."created_at")) / 60) FILTER (WHERE sl."first_contact_at" IS NOT NULL), 1) AS "averageResponseMinutes"
      FROM "users" u
      JOIN scoped_leads sl ON sl."owner_user_id" = u.id
      WHERE u."agency_id" = ${agencyId}
      GROUP BY u.id, u."full_name"
      ORDER BY late DESC, u."full_name" ASC
    `),
    db.$queryRaw(Prisma.sql`
      WITH scoped_leads AS (${scopedLeads})
      SELECT
        s.id,
        s.name,
        s.type::text AS type,
        COUNT(sl.id) FILTER (WHERE sl."first_contact_due_at" IS NOT NULL AND (sl."first_contact_at" IS NOT NULL OR sl."first_contact_due_at" <= ${now}))::int AS evaluated,
        COUNT(sl.id) FILTER (WHERE sl."first_contact_due_at" IS NOT NULL AND sl."first_contact_at" IS NOT NULL AND sl."first_contact_at" <= sl."first_contact_due_at")::int AS "onTime",
        COUNT(sl.id) FILTER (WHERE sl."first_contact_due_at" IS NOT NULL AND ((sl."first_contact_at" > sl."first_contact_due_at") OR (sl."first_contact_at" IS NULL AND sl."first_contact_due_at" <= ${now})))::int AS late,
        COUNT(sl.id) FILTER (WHERE sl."first_contact_at" IS NULL)::int AS "neverContacted",
        ROUND(AVG(EXTRACT(EPOCH FROM (sl."first_contact_at" - sl."created_at")) / 60) FILTER (WHERE sl."first_contact_at" IS NOT NULL), 1) AS "averageResponseMinutes"
      FROM "lead_sources" s
      JOIN scoped_leads sl ON sl."original_source_id" = s.id
      WHERE s."agency_id" = ${agencyId}
      GROUP BY s.id, s.name, s.type
      ORDER BY late DESC, s.name ASC
    `),
  ]);

  const normalizeRow = (row) => ({
    ...row,
    averageResponseMinutes: row.averageResponseMinutes === null ? null : Number(row.averageResponseMinutes),
    slaCompliance: row.evaluated ? Math.round((row.onTime / row.evaluated) * 1000) / 10 : 0,
  });
  const summaryRow = summaryRows[0] || { evaluated: 0, onTime: 0, late: 0, neverContacted: 0, averageFirstAttemptMinutes: null, averageConnectionMinutes: null };
  return {
    generatedAt: now,
    range: { days, from, to: now },
    summary: {
      ...summaryRow,
      averageFirstAttemptMinutes: summaryRow.averageFirstAttemptMinutes === null ? null : Number(summaryRow.averageFirstAttemptMinutes),
      averageConnectionMinutes: summaryRow.averageConnectionMinutes === null ? null : Number(summaryRow.averageConnectionMinutes),
      slaCompliance: summaryRow.evaluated ? Math.round((summaryRow.onTime / summaryRow.evaluated) * 1000) / 10 : 0,
    },
    employees: employeeRows.map(normalizeRow),
    sources: sourceRows.map(normalizeRow),
  };
}

export async function getAgeingReport(req, db = prisma, now = new Date()) {
  const agencyId = req.auth.agencyId;
  const ownerScope = req.auth.role === "admin" ? Prisma.empty : Prisma.sql`AND l."owner_user_id" = ${req.auth.userId}`;
  const scopedLeads = Prisma.sql`
    SELECT l.* FROM "leads" l
    WHERE l."agency_id" = ${agencyId}
      AND l."deleted_at" IS NULL
      AND l.status::text = 'OPEN'
      AND NOT EXISTS (SELECT 1 FROM "lead_import_rows" lir WHERE lir."created_lead_id" = l.id) AND NOT EXISTS (SELECT 1 FROM "lead_activities" la WHERE la."lead_id" = l.id AND la.title = 'Admissions detail (imported)')
      ${ownerScope}
  `;
  const [summaryRows, bucketRows, stageRows, oldestRows] = await Promise.all([
    db.$queryRaw(Prisma.sql`
      WITH scoped_leads AS (${scopedLeads})
      SELECT
        COUNT(*)::int AS "totalOpen",
        ROUND(AVG(EXTRACT(EPOCH FROM (${now} - "created_at")) / 86400), 1) AS "averageAgeDays",
        COALESCE(FLOOR(MAX(EXTRACT(EPOCH FROM (${now} - "created_at")) / 86400)), 0)::int AS "oldestAgeDays",
        COUNT(*) FILTER (WHERE "updated_at" < ${new Date(now.getTime() - DEFAULT_INACTIVE_LEAD_DAYS * 24 * 60 * 60_000)})::int AS inactive,
        COALESCE(SUM("estimated_value"), 0) AS "pipelineValue"
      FROM scoped_leads
    `),
    db.$queryRaw(Prisma.sql`
      WITH scoped_leads AS (${scopedLeads}), aged AS (
        SELECT *, FLOOR(EXTRACT(EPOCH FROM (${now} - "created_at")) / 86400)::int AS age_days FROM scoped_leads
      )
      SELECT
        CASE WHEN age_days <= 1 THEN '0_1_DAYS' WHEN age_days <= 3 THEN '2_3_DAYS' WHEN age_days <= 7 THEN '4_7_DAYS' WHEN age_days <= 14 THEN '8_14_DAYS' WHEN age_days <= 30 THEN '15_30_DAYS' ELSE '31_PLUS_DAYS' END AS bucket,
        COUNT(*)::int AS count,
        COALESCE(SUM("estimated_value"), 0) AS "pipelineValue"
      FROM aged
      GROUP BY bucket
    `),
    db.$queryRaw(Prisma.sql`
      WITH scoped_leads AS (${scopedLeads})
      SELECT stage::text AS stage, COUNT(*)::int AS count, ROUND(AVG(EXTRACT(EPOCH FROM (${now} - "created_at")) / 86400), 1) AS "averageAgeDays"
      FROM scoped_leads GROUP BY stage ORDER BY count DESC, stage ASC
    `),
    db.$queryRaw(Prisma.sql`
      WITH scoped_leads AS (${scopedLeads})
      SELECT l.id, l."lead_number" AS "leadNumber", l."first_name" AS "firstName", l."last_name" AS "lastName", l.phone,
        l.stage::text AS stage, l."next_action_description" AS "nextActionDescription", l."next_action_at" AS "nextActionAt", l."updated_at" AS "updatedAt",
        FLOOR(EXTRACT(EPOCH FROM (${now} - l."created_at")) / 86400)::int AS "ageDays",
        FLOOR(EXTRACT(EPOCH FROM (${now} - l."updated_at")) / 86400)::int AS "inactiveDays",
        u."full_name" AS "ownerName", s.name AS "sourceName"
      FROM scoped_leads l
      JOIN "users" u ON u.id = l."owner_user_id"
      JOIN "lead_sources" s ON s.id = l."original_source_id"
      ORDER BY l."created_at" ASC LIMIT 25
    `),
  ]);
  const summary = summaryRows[0] || { totalOpen: 0, averageAgeDays: null, oldestAgeDays: 0, inactive: 0, pipelineValue: 0 };
  const bucketOrder = ["0_1_DAYS", "2_3_DAYS", "4_7_DAYS", "8_14_DAYS", "15_30_DAYS", "31_PLUS_DAYS"];
  const bucketsByName = new Map(bucketRows.map((row) => [row.bucket, row]));
  return {
    generatedAt: now,
    currency: (await db.agency.findUnique({ where: { id: agencyId }, select: { defaultCurrency: true } }))?.defaultCurrency || "CAD",
    inactiveThresholdDays: DEFAULT_INACTIVE_LEAD_DAYS,
    summary: { ...summary, averageAgeDays: summary.averageAgeDays === null ? null : Number(summary.averageAgeDays), pipelineValue: Number(summary.pipelineValue || 0) },
    buckets: bucketOrder.map((bucket) => ({ bucket, count: bucketsByName.get(bucket)?.count || 0, pipelineValue: Number(bucketsByName.get(bucket)?.pipelineValue || 0) })),
    stages: stageRows.map((row) => ({ ...row, averageAgeDays: row.averageAgeDays === null ? null : Number(row.averageAgeDays) })),
    oldestLeads: oldestRows,
  };
}

export async function getConversionTrendReport(req, db = prisma, now = new Date()) {
  const agencyId = req.auth.agencyId;
  const days = parseReportDays(req.query?.days);
  const from = days ? new Date(now.getTime() - days * 24 * 60 * 60_000) : null;
  const agency = await db.agency.findUnique({ where: { id: agencyId }, select: { timezone: true, defaultCurrency: true } });
  const timezone = agency?.timezone || "America/Toronto";
  const granularity = days && days <= 30 ? "day" : days && days <= 90 ? "week" : "month";
  const ownerScope = req.auth.role === "admin" ? Prisma.empty : Prisma.sql`AND l."owner_user_id" = ${req.auth.userId}`;
  const eventPeriod = from ? Prisma.sql`WHERE occurred_at >= ${from} AND occurred_at <= ${now}` : Prisma.empty;
  const scopedLeads = Prisma.sql`
    SELECT l.* FROM "leads" l WHERE l."agency_id" = ${agencyId} AND l."deleted_at" IS NULL
      AND l.status::text NOT IN ('DUPLICATE', 'ARCHIVED')
      AND NOT EXISTS (SELECT 1 FROM "lead_import_rows" lir WHERE lir."created_lead_id" = l.id) AND NOT EXISTS (SELECT 1 FROM "lead_activities" la WHERE la."lead_id" = l.id AND la.title = 'Admissions detail (imported)') ${ownerScope}
  `;
  const events = Prisma.sql`
    SELECT sl."created_at" AS occurred_at, 'RECEIVED'::text AS event_type, 0::numeric AS value FROM scoped_leads sl
    UNION ALL
    SELECT sl."converted_at", 'CONVERTED'::text, COALESCE(cv."actual_value", 0) FROM scoped_leads sl
      LEFT JOIN "lead_conversions" cv ON cv."lead_id" = sl.id AND cv."agency_id" = ${agencyId} WHERE sl."converted_at" IS NOT NULL
    UNION ALL
    SELECT sl."lost_at", 'LOST'::text, 0::numeric FROM scoped_leads sl WHERE sl."lost_at" IS NOT NULL
  `;
  const [trendRows, summaryRows] = await Promise.all([
    db.$queryRaw(Prisma.sql`
      WITH scoped_leads AS (${scopedLeads}), events AS (${events}), period_events AS (SELECT * FROM events ${eventPeriod})
      SELECT date_trunc(${granularity}, occurred_at AT TIME ZONE ${timezone})::date::text AS period,
        COUNT(*) FILTER (WHERE event_type = 'RECEIVED')::int AS received,
        COUNT(*) FILTER (WHERE event_type = 'CONVERTED')::int AS converted,
        COUNT(*) FILTER (WHERE event_type = 'LOST')::int AS lost,
        COALESCE(SUM(value) FILTER (WHERE event_type = 'CONVERTED'), 0) AS "convertedValue"
      FROM period_events GROUP BY period ORDER BY period ASC
    `),
    db.$queryRaw(Prisma.sql`
      WITH scoped_leads AS (${scopedLeads}), events AS (${events}), period_events AS (SELECT * FROM events ${eventPeriod})
      SELECT COUNT(*) FILTER (WHERE event_type = 'RECEIVED')::int AS received,
        COUNT(*) FILTER (WHERE event_type = 'CONVERTED')::int AS converted,
        COUNT(*) FILTER (WHERE event_type = 'LOST')::int AS lost,
        COALESCE(SUM(value) FILTER (WHERE event_type = 'CONVERTED'), 0) AS "convertedValue",
        (SELECT ROUND(AVG(EXTRACT(EPOCH FROM (sl."converted_at" - sl."created_at")) / 86400), 1) FROM scoped_leads sl
          WHERE sl."converted_at" IS NOT NULL ${from ? Prisma.sql`AND sl."converted_at" >= ${from} AND sl."converted_at" <= ${now}` : Prisma.empty}) AS "averageConversionDays"
      FROM period_events
    `),
  ]);
  const summary = summaryRows[0] || { received: 0, converted: 0, lost: 0, convertedValue: 0, averageConversionDays: null };
  return {
    generatedAt: now,
    currency: agency?.defaultCurrency || "CAD",
    range: { days, from, to: now, granularity },
    summary: {
      ...summary,
      convertedValue: Number(summary.convertedValue || 0),
      averageConversionDays: summary.averageConversionDays === null ? null : Number(summary.averageConversionDays),
      conversionRate: summary.received ? Math.round((summary.converted / summary.received) * 1000) / 10 : 0,
    },
    trend: trendRows.map((row) => ({ ...row, convertedValue: Number(row.convertedValue || 0) })),
  };
}

export async function getWorkloadReport(req, db = prisma, now = new Date()) {
  const agencyId = req.auth.agencyId;
  const agency = await db.agency.findUnique({ where: { id: agencyId }, select: { timezone: true, defaultCurrency: true } });
  const { todayStart, tomorrowStart } = reportingBounds(now, agency?.timezone || "America/Toronto");
  const weekAhead = new Date(now.getTime() + 7 * 24 * 60 * 60_000);
  const leadOwnerScope = req.auth.role === "admin" ? Prisma.empty : Prisma.sql`AND l."owner_user_id" = ${req.auth.userId}`;
  const employeeScope = req.auth.role === "admin" ? Prisma.empty : Prisma.sql`AND u.id = ${req.auth.userId}`;
  const rows = await db.$queryRaw(Prisma.sql`
    WITH scoped_leads AS (
      SELECT l.* FROM "leads" l WHERE l."agency_id" = ${agencyId} AND l."deleted_at" IS NULL AND l.status::text = 'OPEN'
        AND NOT EXISTS (SELECT 1 FROM "lead_import_rows" lir WHERE lir."created_lead_id" = l.id) AND NOT EXISTS (SELECT 1 FROM "lead_activities" la WHERE la."lead_id" = l.id AND la.title = 'Admissions detail (imported)') ${leadOwnerScope}
    )
    SELECT u.id, u."full_name" AS name, u.email,
      (SELECT COUNT(*)::int FROM scoped_leads sl WHERE sl."owner_user_id" = u.id) AS "openLeads",
      (SELECT COUNT(*)::int FROM scoped_leads sl WHERE sl."owner_user_id" = u.id AND sl."next_action_at" < ${now}) AS "overdueActions",
      (SELECT COUNT(*)::int FROM scoped_leads sl WHERE sl."owner_user_id" = u.id AND sl."next_action_at" >= ${todayStart} AND sl."next_action_at" < ${tomorrowStart}) AS "actionsToday",
      (SELECT COUNT(*)::int FROM scoped_leads sl WHERE sl."owner_user_id" = u.id AND sl.stage::text = 'READY_TO_CONVERT') AS "readyToConvert",
      (SELECT COALESCE(SUM(sl."estimated_value"), 0) FROM scoped_leads sl WHERE sl."owner_user_id" = u.id) AS "pipelineValue",
      (SELECT COUNT(*)::int FROM "lead_follow_ups" f JOIN scoped_leads sl ON sl.id = f."lead_id" WHERE f."agency_id" = ${agencyId} AND f."assigned_user_id" = u.id AND f.status::text = 'PENDING') AS "pendingFollowUps",
      (SELECT COUNT(*)::int FROM "lead_follow_ups" f JOIN scoped_leads sl ON sl.id = f."lead_id" WHERE f."agency_id" = ${agencyId} AND f."assigned_user_id" = u.id AND f.status::text = 'PENDING' AND f."due_at" < ${now}) AS "overdueFollowUps",
      (SELECT COUNT(*)::int FROM "lead_consultations" c JOIN scoped_leads sl ON sl.id = c."lead_id" WHERE c."agency_id" = ${agencyId} AND c."consultant_user_id" = u.id AND c.status::text IN ('SCHEDULED', 'CONFIRMED', 'RESCHEDULED') AND c."start_at" >= ${now} AND c."start_at" <= ${weekAhead}) AS "upcomingConsultations"
    FROM "users" u JOIN "agency_members" m ON m."user_id" = u.id AND m."agency_id" = ${agencyId} AND m."is_active" = true AND m.role::text IN ('admin', 'consultant', 'frontdesk')
    WHERE u."agency_id" = ${agencyId} AND u.status::text = 'active' ${employeeScope}
    ORDER BY "overdueActions" DESC, "overdueFollowUps" DESC, "openLeads" DESC, u."full_name" ASC
  `);
  const employees = rows.map((row) => ({ ...row, pipelineValue: Number(row.pipelineValue || 0) }));
  return {
    generatedAt: now,
    currency: agency?.defaultCurrency || "CAD",
    summary: {
      employees: employees.length,
      openLeads: employees.reduce((sum, item) => sum + item.openLeads, 0),
      overdueActions: employees.reduce((sum, item) => sum + item.overdueActions, 0),
      overdueFollowUps: employees.reduce((sum, item) => sum + item.overdueFollowUps, 0),
      pipelineValue: employees.reduce((sum, item) => sum + item.pipelineValue, 0),
    },
    employees,
  };
}
