import prisma from "../services/prisma/client.js";
import {
  requireCommunicationAdministrator,
  requireCommunicationPermission,
} from "../services/communicationPermissions.js";
import { recordCommunicationAudit } from "../services/communicationAudit.js";
import { createHttpError } from "../utils/http.js";

const channels = new Set(["Email", "Sms", "Chat", "Call"]);
const triggers = new Set([
  "InboundReceived",
  "DeliveryFailed",
  "MissedCall",
  "ConversationOverdue",
  "ResolutionOverdue",
]);
const clean = (value, max = 300) =>
  String(value ?? "")
    .trim()
    .slice(0, max);
const object = (value) =>
  value && typeof value === "object" && !Array.isArray(value) ? value : {};
const date = (value, fallback) => {
  const parsed = value ? new Date(value) : fallback;
  if (!parsed || Number.isNaN(parsed.getTime()))
    throw createHttpError(400, "Enter a valid date range");
  return parsed;
};
const pageValues = (query, defaultLimit = 50) => {
  const page = Math.max(Number(query.page) || 1, 1);
  const limit = Math.min(Math.max(Number(query.limit) || defaultLimit, 1), 100);
  return { page, limit, skip: (page - 1) * limit };
};

async function scopedCase(req, caseId) {
  const data = await prisma.case.findFirst({
    where: { id: caseId, agencyId: req.user.agencyId },
    include: { client: true },
  });
  if (!data) throw createHttpError(404, "Case not found");
  return data;
}

function preferenceInput(body) {
  const preferredChannel = channels.has(body.preferredChannel)
    ? body.preferredChannel
    : null;
  const quietHoursStart = clean(body.quietHoursStart, 5) || null;
  const quietHoursEnd = clean(body.quietHoursEnd, 5) || null;
  if (
    (quietHoursStart && !/^([01]\d|2[0-3]):[0-5]\d$/.test(quietHoursStart)) ||
    (quietHoursEnd && !/^([01]\d|2[0-3]):[0-5]\d$/.test(quietHoursEnd))
  ) {
    throw createHttpError(
      400,
      "Quiet hours must use 24-hour time, such as 21:00",
    );
  }
  const timezone =
    clean(body.timezone, 80, "America/Toronto") || "America/Toronto";
  try {
    new Intl.DateTimeFormat("en", { timeZone: timezone }).format();
  } catch {
    throw createHttpError(400, "Choose a valid timezone");
  }
  return {
    preferredChannel,
    language: clean(body.language, 80, "English") || "English",
    timezone,
    quietHoursStart,
    quietHoursEnd,
    allowEmail: body.allowEmail !== false,
    allowSms: body.allowSms !== false,
    allowChat: body.allowChat !== false,
    allowCalls: body.allowCalls !== false,
    doNotContact: body.doNotContact === true,
    notes: clean(body.notes, 2000) || null,
  };
}

export async function getCommunicationPreference(req, res) {
  await requireCommunicationPermission(req, "canView");
  const caseItem = await scopedCase(req, req.params.caseId);
  const data = await prisma.communicationPreference.findUnique({
    where: { clientId: caseItem.clientId },
  });
  res.json({
    data: data || {
      clientId: caseItem.clientId,
      preferredChannel: null,
      language: "English",
      timezone: "America/Toronto",
      quietHoursStart: null,
      quietHoursEnd: null,
      allowEmail: true,
      allowSms: true,
      allowChat: true,
      allowCalls: true,
      doNotContact: false,
      notes: null,
    },
  });
}

export async function updateCommunicationPreference(req, res) {
  await requireCommunicationPermission(req, "canManageConsent");
  const caseItem = await scopedCase(req, req.params.caseId);
  const values = preferenceInput(req.body);
  const data = await prisma.communicationPreference.upsert({
    where: { clientId: caseItem.clientId },
    create: {
      agencyId: req.user.agencyId,
      clientId: caseItem.clientId,
      ...values,
    },
    update: values,
  });
  await recordCommunicationAudit({
    agencyId: req.user.agencyId,
    userId: req.user.id,
    action: "communication.preference_updated",
    details: `Communication preferences updated for ${caseItem.client.fullName}`,
    metadata: {
      clientId: caseItem.clientId,
      preferredChannel: data.preferredChannel,
      doNotContact: data.doNotContact,
    },
  });
  res.json({ data });
}

export async function getCommunicationSlaPolicy(req, res) {
  await requireCommunicationPermission(req, "canView");
  const data = await prisma.communicationSlaPolicy.findUnique({
    where: { agencyId: req.user.agencyId },
  });
  res.json({
    data: data || {
      firstResponseMinutes: 240,
      resolutionHours: 48,
      businessHoursOnly: false,
      timezone: "America/Toronto",
      businessHoursStart: "09:00",
      businessHoursEnd: "17:00",
    },
  });
}

export async function updateCommunicationSlaPolicy(req, res) {
  requireCommunicationAdministrator(req);
  const firstResponseMinutes = Math.min(
    Math.max(Number(req.body.firstResponseMinutes) || 240, 5),
    10_080,
  );
  const resolutionHours = Math.min(
    Math.max(Number(req.body.resolutionHours) || 48, 1),
    720,
  );
  const timezone =
    clean(req.body.timezone, 80, "America/Toronto") || "America/Toronto";
  try {
    new Intl.DateTimeFormat("en", { timeZone: timezone }).format();
  } catch {
    throw createHttpError(400, "Choose a valid service-target timezone");
  }
  const businessHoursStart =
    clean(req.body.businessHoursStart, 5, "09:00") || "09:00";
  const businessHoursEnd =
    clean(req.body.businessHoursEnd, 5, "17:00") || "17:00";
  if (
    ![businessHoursStart, businessHoursEnd].every((value) =>
      /^([01]\d|2[0-3]):[0-5]\d$/.test(value),
    ) ||
    businessHoursStart === businessHoursEnd
  )
    throw createHttpError(
      400,
      "Enter valid and different business start and end times",
    );
  const values = {
    firstResponseMinutes,
    resolutionHours,
    businessHoursOnly: req.body.businessHoursOnly === true,
    timezone,
    businessHoursStart,
    businessHoursEnd,
  };
  const data = await prisma.communicationSlaPolicy.upsert({
    where: { agencyId: req.user.agencyId },
    create: { agencyId: req.user.agencyId, ...values },
    update: values,
  });
  await recordCommunicationAudit({
    agencyId: req.user.agencyId,
    userId: req.user.id,
    action: "communication.sla_updated",
    details: "Communication service targets updated",
    metadata: values,
  });
  res.json({ data });
}

function automationInput(req, existing = {}) {
  const name = clean(req.body.name ?? existing.name, 160);
  const trigger = clean(req.body.trigger ?? existing.trigger, 80);
  const channelValue =
    req.body.channel === undefined ? existing.channel : req.body.channel;
  const channel = channels.has(channelValue) ? channelValue : null;
  if (!name || !triggers.has(trigger))
    throw createHttpError(
      400,
      "Automation name and a supported trigger are required",
    );
  const actions = object(req.body.actions ?? existing.actions);
  if (!Object.keys(actions).length)
    throw createHttpError(400, "Add at least one automation action");
  return {
    name,
    trigger,
    channel,
    conditions: object(req.body.conditions ?? existing.conditions),
    actions,
    isActive:
      req.body.isActive === undefined
        ? existing.isActive !== false
        : req.body.isActive === true,
    sortOrder: Math.min(
      Math.max(Number(req.body.sortOrder ?? existing.sortOrder) || 0, 0),
      10_000,
    ),
  };
}

export async function listCommunicationAutomations(req, res) {
  await requireCommunicationPermission(req, "canView");
  const data = await prisma.communicationAutomationRule.findMany({
    where: { agencyId: req.user.agencyId },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    include: {
      createdBy: { select: { id: true, fullName: true } },
      updatedBy: { select: { id: true, fullName: true } },
    },
  });
  res.json({ data });
}

export async function createCommunicationAutomation(req, res) {
  requireCommunicationAdministrator(req);
  const values = automationInput(req);
  const data = await prisma.communicationAutomationRule.create({
    data: {
      agencyId: req.user.agencyId,
      ...values,
      createdById: req.user.id,
      updatedById: req.user.id,
    },
  });
  await recordCommunicationAudit({
    agencyId: req.user.agencyId,
    userId: req.user.id,
    action: "communication.automation_created",
    details: `Automation created: ${data.name}`,
    metadata: { ruleId: data.id },
  });
  res.status(201).json({ data });
}

export async function updateCommunicationAutomation(req, res) {
  requireCommunicationAdministrator(req);
  const existing = await prisma.communicationAutomationRule.findFirst({
    where: { id: req.params.id, agencyId: req.user.agencyId },
  });
  if (!existing)
    throw createHttpError(404, "Communication automation not found");
  const values = automationInput(req, existing);
  const data = await prisma.communicationAutomationRule.update({
    where: { id: existing.id },
    data: { ...values, updatedById: req.user.id },
  });
  await recordCommunicationAudit({
    agencyId: req.user.agencyId,
    userId: req.user.id,
    action: "communication.automation_updated",
    details: `Automation updated: ${data.name}`,
    metadata: { ruleId: data.id },
  });
  res.json({ data });
}

export async function deleteCommunicationAutomation(req, res) {
  requireCommunicationAdministrator(req);
  const existing = await prisma.communicationAutomationRule.findFirst({
    where: { id: req.params.id, agencyId: req.user.agencyId },
  });
  if (!existing)
    throw createHttpError(404, "Communication automation not found");
  await prisma.communicationAutomationRule.delete({
    where: { id: existing.id },
  });
  await recordCommunicationAudit({
    agencyId: req.user.agencyId,
    userId: req.user.id,
    action: "communication.automation_deleted",
    details: `Automation deleted: ${existing.name}`,
    metadata: { ruleId: existing.id },
  });
  res.status(204).send();
}

export async function getCommunicationAnalytics(req, res) {
  await requireCommunicationPermission(req, "canView");
  const now = new Date();
  const to = date(req.query.to, now);
  const from = date(req.query.from, new Date(to.getTime() - 30 * 86_400_000));
  if (to < from || to.getTime() - from.getTime() > 366 * 86_400_000)
    throw createHttpError(
      400,
      "Analytics range must be between 1 and 366 days",
    );
  const caseId = clean(req.query.caseId, 80) || null;
  if (caseId) await scopedCase(req, caseId);
  const where = {
    agencyId: req.user.agencyId,
    occurredAt: { gte: from, lte: to },
    deletedAt: null,
    ...(caseId ? { caseId } : {}),
  };
  const [
    byChannel,
    byStatus,
    byDirection,
    messages,
    overdue,
    resolutionOverdue,
    open,
    unread,
    responses,
  ] = await Promise.all([
    prisma.communicationMessage.groupBy({
      by: ["channel"],
      where,
      _count: { _all: true },
    }),
    prisma.communicationMessage.groupBy({
      by: ["status"],
      where,
      _count: { _all: true },
    }),
    prisma.communicationMessage.groupBy({
      by: ["direction"],
      where,
      _count: { _all: true },
    }),
    prisma.communicationMessage.findMany({
      where,
      select: { occurredAt: true },
      orderBy: { occurredAt: "asc" },
    }),
    prisma.communicationConversation.count({
      where: {
        agencyId: req.user.agencyId,
        responseDueAt: { lt: now },
        firstRespondedAt: null,
        state: "WaitingOnAgency",
        deletedAt: null,
        ...(caseId ? { caseId } : {}),
      },
    }),
    prisma.communicationConversation.count({
      where: {
        agencyId: req.user.agencyId,
        resolutionDueAt: { lt: now },
        state: { not: "Closed" },
        deletedAt: null,
        ...(caseId ? { caseId } : {}),
      },
    }),
    prisma.communicationConversation.count({
      where: {
        agencyId: req.user.agencyId,
        state: { not: "Closed" },
        deletedAt: null,
        ...(caseId ? { caseId } : {}),
      },
    }),
    prisma.communicationConversation.aggregate({
      where: {
        agencyId: req.user.agencyId,
        deletedAt: null,
        ...(caseId ? { caseId } : {}),
      },
      _sum: { unreadCount: true },
    }),
    prisma.communicationConversation.findMany({
      where: {
        agencyId: req.user.agencyId,
        firstInboundAt: { gte: from, lte: to },
        firstRespondedAt: { not: null },
        deletedAt: null,
        ...(caseId ? { caseId } : {}),
      },
      select: { firstInboundAt: true, firstRespondedAt: true },
    }),
  ]);
  const deliveryTotal = byStatus
    .filter((item) =>
      ["Sent", "Delivered", "Bounced", "Failed", "Blocked"].includes(
        item.status,
      ),
    )
    .reduce((sum, item) => sum + item._count._all, 0);
  const delivered = byStatus
    .filter((item) => ["Sent", "Delivered"].includes(item.status))
    .reduce((sum, item) => sum + item._count._all, 0);
  const days = new Map();
  for (const item of messages) {
    const key = item.occurredAt.toISOString().slice(0, 10);
    days.set(key, (days.get(key) || 0) + 1);
  }
  const responseMinutes = responses.map(
    (item) =>
      Math.max(
        0,
        item.firstRespondedAt.getTime() - item.firstInboundAt.getTime(),
      ) / 60_000,
  );
  const averageFirstResponseMinutes = responseMinutes.length
    ? Math.round(
        responseMinutes.reduce((sum, value) => sum + value, 0) /
          responseMinutes.length,
      )
    : null;
  res.json({
    data: {
      range: { from, to },
      total: messages.length,
      openConversations: open,
      unread: unread._sum.unreadCount || 0,
      overdue,
      resolutionOverdue,
      averageFirstResponseMinutes,
      deliveryRate: deliveryTotal
        ? Math.round((delivered / deliveryTotal) * 1000) / 10
        : null,
      byChannel: Object.fromEntries(
        byChannel.map((item) => [item.channel, item._count._all]),
      ),
      byStatus: Object.fromEntries(
        byStatus.map((item) => [item.status, item._count._all]),
      ),
      byDirection: Object.fromEntries(
        byDirection.map((item) => [item.direction, item._count._all]),
      ),
      dailyVolume: [...days].map(([day, count]) => ({ day, count })),
    },
  });
}

export async function listCommunicationAudit(req, res) {
  await requireCommunicationPermission(req, "canView");
  const { page, limit, skip } = pageValues(req.query);
  const where = {
    agencyId: req.user.agencyId,
    ...(req.query.conversationId
      ? { conversationId: clean(req.query.conversationId, 80) }
      : {}),
    ...(req.query.messageId
      ? { messageId: clean(req.query.messageId, 80) }
      : {}),
  };
  const [data, total] = await Promise.all([
    prisma.communicationAuditEvent.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take: limit,
      include: { user: { select: { id: true, fullName: true } } },
    }),
    prisma.communicationAuditEvent.count({ where }),
  ]);
  res.json({
    data,
    meta: { page, limit, total, hasMore: skip + data.length < total },
  });
}
