import prisma from "../../services/prisma/client.js";
import { leadAccessWhere } from "./lead.permissions.js";
import { leadSearchWhere } from "./lead.service.js";

const PRE_CONSULTATION_SUBMITTED = "PRE_CONSULTATION_INTAKE_SUBMITTED";

function cleanText(value) {
  return String(value || "").trim();
}

function expiryDate(value) {
  const raw = cleanText(value).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const date = new Date(`${raw}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? null : { raw, date };
}

function permitExpiryFromAnswers(answers = {}) {
  const currentStatus = cleanText(answers.canadaStatus?.currentStatus);
  const candidates = [
    {
      type: "Work permit",
      value: answers.work?.workPermitExpiryDate,
      relevant: currentStatus === "Work Permit" || Boolean(answers.work?.workPermitExpiryDate),
    },
    {
      type: "Study permit",
      value: answers.study?.permitExpiryDate,
      relevant: currentStatus === "Study Permit" || Boolean(answers.study?.permitExpiryDate),
    },
    {
      type: currentStatus || "Immigration status",
      value: answers.canadaStatus?.statusExpiryDate,
      relevant: Boolean(answers.canadaStatus?.statusExpiryDate),
    },
  ]
    .filter((item) => item.relevant)
    .map((item) => ({ ...item, expiry: expiryDate(item.value) }))
    .filter((item) => item.expiry)
    .sort((left, right) => left.expiry.date - right.expiry.date);

  return candidates[0] || null;
}

function latestSubmission(appointments = []) {
  return appointments
    .flatMap((appointment) => (appointment.events || []).map((event) => ({ ...event, appointmentId: appointment.id })))
    .sort((left, right) => new Date(right.createdAt) - new Date(left.createdAt))[0] || null;
}

function clientNames(client, lead) {
  if (client?.givenNames || client?.familyName) {
    return {
      firstName: client.givenNames || null,
      lastName: client.familyName || null,
    };
  }
  const fullName = cleanText(client?.fullName);
  if (!fullName) return { firstName: lead.firstName, lastName: lead.lastName };
  const parts = fullName.split(/\s+/);
  if (parts.length === 1) return { firstName: parts[0], lastName: null };
  return { firstName: parts.slice(0, -1).join(" "), lastName: parts.at(-1) };
}

function urgencyForDays(days) {
  if (days <= 30) return { priority: "URGENT", temperature: "HOT" };
  if (days <= 60) return { priority: "HIGH", temperature: "HOT" };
  if (days <= 90) return { priority: "HIGH", temperature: "WARM" };
  if (days <= 180) return { priority: "NORMAL", temperature: "WARM" };
  return { priority: "NORMAL", temperature: "COLD" };
}

function parseQueueQuery(query = {}) {
  return {
    page: Math.max(Number(query.page) || 1, 1),
    limit: Math.min(Math.max(Number(query.limit) || 25, 1), 100),
    search: cleanText(query.search).slice(0, 200),
    ownerUserId: cleanText(query.ownerUserId).slice(0, 100),
  };
}

export async function listPermitExpiryLeads(req) {
  const { page, limit, search, ownerUserId } = parseQueueQuery(req.query);
  const today = new Date();
  const todayUtc = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());

  // This queue intentionally reuses the original converted lead as the
  // outreach record. We do not create a second Lead row for an existing
  // client just because a permit is approaching expiry.
  const convertedLeads = await prisma.lead.findMany({
    where: {
      agencyId: req.auth.agencyId,
      deletedAt: null,
      convertedClientId: { not: null },
      AND: [
        leadAccessWhere(req),
        ...(search ? [leadSearchWhere(search)] : []),
      ],
    },
    select: {
      id: true,
      leadNumber: true,
      firstName: true,
      lastName: true,
      phone: true,
      email: true,
      currentImmigrationStatus: true,
      ownerUserId: true,
      owner: { select: { id: true, fullName: true, email: true } },
      convertedClient: {
        select: {
          id: true,
          clientNumber: true,
          fullName: true,
          givenNames: true,
          familyName: true,
          phone: true,
          email: true,
          assignedUserId: true,
          assignedUser: { select: { id: true, fullName: true, email: true } },
        },
      },
      appointments: {
        where: {
          events: { some: { type: PRE_CONSULTATION_SUBMITTED } },
        },
        select: {
          id: true,
          events: {
            where: { type: PRE_CONSULTATION_SUBMITTED },
            orderBy: { createdAt: "desc" },
            take: 1,
            select: { id: true, createdAt: true, metadata: true },
          },
        },
      },
    },
  });

  const queue = convertedLeads
    .map((lead) => {
      const client = lead.convertedClient;
      if (!client) return null;
      if (ownerUserId && (client.assignedUserId || lead.ownerUserId) !== ownerUserId) return null;

      const submission = latestSubmission(lead.appointments);
      const answers = submission?.metadata?.answers;
      const permit = permitExpiryFromAnswers(answers);
      if (!permit) return null;

      const expiryMs = permit.expiry.date.getTime();
      // The proactive queue is for upcoming expiries. Once already expired,
      // the matter belongs in an urgent/status-restoration workflow instead.
      if (expiryMs < todayUtc) return null;

      const daysUntilExpiry = Math.ceil((expiryMs - todayUtc) / 86_400_000);
      const urgency = urgencyForDays(daysUntilExpiry);
      const names = clientNames(client, lead);
      const owner = client.assignedUser || lead.owner || null;

      return {
        id: lead.id,
        leadType: "PERMIT_EXPIRY",
        clientId: client.id,
        clientNumber: client.clientNumber,
        leadNumber: client.clientNumber || lead.leadNumber,
        firstName: names.firstName,
        lastName: names.lastName,
        phone: client.phone || lead.phone,
        email: client.email || lead.email,
        currentImmigrationStatus: cleanText(answers?.canadaStatus?.currentStatus) || lead.currentImmigrationStatus,
        immigrationInterest: `${permit.type} renewal`,
        permitType: permit.type,
        permitExpiryDate: permit.expiry.raw,
        daysUntilExpiry,
        status: "OPEN",
        stage: "CONTACTING",
        priority: urgency.priority,
        temperature: urgency.temperature,
        owner,
        ownerUserId: owner?.id || null,
        originalSource: { id: null, name: "Existing client", type: "OTHER" },
        nextActionDescription: `${permit.type} expires ${permit.expiry.raw}`,
        nextActionAt: permit.expiry.date.toISOString(),
        questionnaireSubmittedAt: submission.createdAt,
        retainerStatus: "NOT_REQUIRED",
        initialPaymentStatus: "WAIVED",
      };
    })
    .filter(Boolean)
    .sort((left, right) => {
      const expiryOrder = new Date(left.permitExpiryDate) - new Date(right.permitExpiryDate);
      if (expiryOrder !== 0) return expiryOrder;
      return String(left.clientNumber || "").localeCompare(String(right.clientNumber || ""));
    });

  const total = queue.length;
  const start = (page - 1) * limit;
  return {
    data: queue.slice(start, start + limit),
    meta: { page, limit, total, queueType: "PERMIT_EXPIRY" },
  };
}
