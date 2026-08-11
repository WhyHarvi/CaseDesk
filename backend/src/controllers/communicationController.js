import prisma from "../services/prisma/client.js";
import { communicationProviderStatus } from "../services/communicationProviderService.js";
import {
  communicationPermissionKeys,
  defaultCommunicationPermissionsForRole,
  getCommunicationPermissions,
  requireCommunicationAdministrator,
  requireCommunicationPermission,
} from "../services/communicationPermissions.js";
import { recordCommunicationAudit } from "../services/communicationAudit.js";
import {
  broadcastCaseCommunication,
  getRealtimeClientConfig,
} from "../services/supabaseRealtimeService.js";
import {
  communicationResolutionDueAt,
  communicationResponseDueAt,
} from "../services/communicationSlaService.js";
import { createHttpError } from "../utils/http.js";
import { recordActivity } from "../utils/prismaCrud.js";
import { clientAccessWhere } from "../middleware/authorization.js";
import { resolveNotifications } from "../services/notificationService.js";

const channels = new Set(["Email", "Sms", "Chat", "Call"]);
const directions = new Set(["Inbound", "Outbound", "Internal"]);
const statuses = new Set([
  "Draft",
  "Scheduled",
  "Queued",
  "Sending",
  "Sent",
  "Delivered",
  "Bounced",
  "Failed",
  "Blocked",
  "OptedOut",
  "Cancelled",
  "Received",
  "Completed",
  "Missed",
]);
const conversationStates = new Set([
  "Open",
  "WaitingOnClient",
  "WaitingOnAgency",
  "Snoozed",
  "Closed",
]);
const priorities = new Set(["Low", "Normal", "High", "Urgent"]);
const consentStatuses = new Set(["Unknown", "Consented", "OptedOut"]);

const userSelect = { id: true, fullName: true, email: true };
const messageInclude = {
  senderUser: { select: userSelect },
  deletedBy: { select: userSelect },
  conversation: {
    select: {
      id: true,
      channel: true,
      subject: true,
      provider: true,
      state: true,
      priority: true,
      assignedTo: { select: userSelect },
    },
  },
  deliveryEvents: { orderBy: { createdAt: "asc" }, take: 25 },
  attachmentRecords: {
    select: {
      id: true,
      originalFilename: true,
      mimeType: true,
      fileSize: true,
      scanStatus: true,
      createdAt: true,
    },
  },
};

const conversationInclude = {
  client: { select: { id: true, fullName: true, email: true, phone: true } },
  case: { select: { id: true, caseType: true, stage: true, status: true } },
  assignedTo: { select: userSelect },
  createdBy: { select: userSelect },
  messages: {
    where: { deletedAt: null },
    orderBy: { occurredAt: "desc" },
    take: 1,
    include: { senderUser: { select: userSelect } },
  },
  _count: { select: { messages: { where: { deletedAt: null } } } },
};

function clean(value, max, fallback = "") {
  return String(value ?? fallback)
    .trim()
    .slice(0, max);
}

function jsonArray(value, limit = 50) {
  return Array.isArray(value) ? value.slice(0, limit) : [];
}

function jsonObject(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};
}

function safeDate(value, fallback = new Date()) {
  const date = value ? new Date(value) : fallback;
  return Number.isNaN(date.getTime()) ? fallback : date;
}

function pagination(query, defaultLimit = 50) {
  const page = Math.max(Number(query.page) || 1, 1);
  const limit = Math.min(Math.max(Number(query.limit) || defaultLimit, 1), 100);
  return { page, limit, skip: (page - 1) * limit };
}

function normalizeAddress(channel, address) {
  const value = clean(address, 320).toLowerCase();
  return channel === "Sms" || channel === "Call"
    ? value.replace(/[^+\d]/g, "")
    : value;
}

function nextConversationState(direction) {
  if (direction === "Inbound") return "WaitingOnAgency";
  if (direction === "Outbound") return "WaitingOnClient";
  return "Open";
}

function sendPermission(channel) {
  return channel === "Email"
    ? "canSendEmail"
    : channel === "Sms"
      ? "canSendSms"
      : channel === "Call"
        ? "canInitiateCalls"
        : "canUseChat";
}

async function scopedCase(req, caseId) {
  const data = await prisma.case.findFirst({
    where: { id: caseId, agencyId: req.user.agencyId },
    include: { client: true },
  });
  if (!data) throw createHttpError(404, "Case not found");
  return data;
}

async function scopedConversation(req, id, include = conversationInclude) {
  const data = await prisma.communicationConversation.findFirst({
    where: { id, agencyId: req.user.agencyId },
    include,
  });
  if (!data) throw createHttpError(404, "Conversation not found");
  return data;
}

async function ensureRecipientAllowed(agencyId, clientId, channel, recipients) {
  const preference = await prisma.communicationPreference.findUnique({
    where: { clientId },
  });
  if (preference?.agencyId === agencyId) {
    const channelAllowed =
      channel === "Email"
        ? preference.allowEmail
        : channel === "Sms"
          ? preference.allowSms
          : channel === "Chat"
            ? preference.allowChat
            : preference.allowCalls;
    if (preference.doNotContact || !channelAllowed) {
      throw createHttpError(
        409,
        preference.doNotContact
          ? "This client is marked Do Not Contact."
          : `${channel === "Sms" ? "SMS" : channel} is disabled in the client's communication preferences.`,
      );
    }
  }
  if (!["Email", "Sms"].includes(channel)) return preference;
  const normalized = recipients
    .map((item) => normalizeAddress(channel, item))
    .filter(Boolean);
  if (!normalized.length)
    throw createHttpError(400, "Add at least one recipient before sending");
  const blocked = await prisma.communicationConsent.findFirst({
    where: {
      agencyId,
      clientId,
      channel,
      address: { in: normalized },
      status: "OptedOut",
    },
  });
  if (blocked) {
    throw createHttpError(
      409,
      `${blocked.address} has opted out of ${channel === "Sms" ? "SMS" : "email"}. Update consent only when you have valid evidence.`,
    );
  }
  return preference;
}

function nextAllowedContactAt(preference, intendedAt) {
  if (!preference?.quietHoursStart || !preference?.quietHoursEnd)
    return intendedAt;
  const [startHour, startMinute] = preference.quietHoursStart
    .split(":")
    .map(Number);
  const [endHour, endMinute] = preference.quietHoursEnd.split(":").map(Number);
  const start = startHour * 60 + startMinute;
  const end = endHour * 60 + endMinute;
  const isQuiet = (value) =>
    start === end
      ? false
      : start < end
        ? value >= start && value < end
        : value >= start || value < end;
  const localMinutes = (value) => {
    const parts = Object.fromEntries(
      new Intl.DateTimeFormat("en-CA", {
        timeZone: preference.timezone || "America/Toronto",
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
      })
        .formatToParts(value)
        .map((part) => [part.type, part.value]),
    );
    return Number(parts.hour) * 60 + Number(parts.minute);
  };
  if (!isQuiet(localMinutes(intendedAt))) return intendedAt;
  let candidate = new Date(intendedAt.getTime());
  for (let minute = 0; minute < 1500; minute += 1) {
    candidate = new Date(candidate.getTime() + 60_000);
    if (!isQuiet(localMinutes(candidate))) return candidate;
  }
  return intendedAt;
}

function buildOutboxPayload({
  messageId,
  recipients,
  cc = [],
  bcc = [],
  replyTo = null,
  subject,
  bodyText,
  bodyHtml,
  parent,
}) {
  const references = parent
    ? [...jsonArray(parent.emailReferences), parent.emailMessageId].filter(
        Boolean,
      )
    : [];
  return {
    recipients,
    cc,
    bcc,
    replyTo,
    subject,
    bodyText,
    bodyHtml,
    headers: parent
      ? {
          "In-Reply-To": parent.emailMessageId || undefined,
          References: references.join(" ") || undefined,
          "X-CaseDesk-Message-ID": messageId,
        }
      : { "X-CaseDesk-Message-ID": messageId },
    messageId: `<casedesk-${messageId}@messages.casedesk.local>`,
    attachments: [],
  };
}

async function audit(req, values) {
  await recordCommunicationAudit({
    agencyId: req.user.agencyId,
    userId: req.user.id,
    ...values,
  });
}

async function requireCommunicationDeletePolicy(req) {
  await requireCommunicationPermission(req, "canDelete");
  if (req.user.role === "admin") return;
  const policy = await prisma.communicationRetentionPolicy.findUnique({
    where: { agencyId: req.user.agencyId },
  });
  if (!policy?.allowStaffDelete)
    throw createHttpError(
      403,
      "The workspace retention policy does not allow staff to move communication records to Trash",
    );
}

export async function getCommunicationProviders(req, res) {
  await requireCommunicationPermission(req, "canView");
  const [providers, permissions] = await Promise.all([
    communicationProviderStatus(req.user.agencyId, req.user.id),
    getCommunicationPermissions(req),
  ]);
  res.json({ data: providers, meta: { permissions } });
}

export async function getPortalChatStatus(req, res) {
  await requireCommunicationPermission(req, "canView");
  const client = await prisma.client.findFirst({
    where: {
      id: req.params.clientId,
      agencyId: req.user.agencyId,
      ...clientAccessWhere(req),
    },
    select: { id: true, email: true },
  });
  if (!client) throw createHttpError(404, "Client not found");

  const link = await prisma.clientUser.findFirst({
    where: { agencyId: req.user.agencyId, clientId: client.id },
    select: {
      createdAt: true,
      user: {
        select: {
          email: true,
          status: true,
          memberships: {
            where: { agencyId: req.user.agencyId, role: "client" },
            select: { isActive: true },
            take: 1,
          },
        },
      },
    },
    orderBy: { isPrimary: "desc" },
  });
  const membershipActive = link?.user.memberships?.[0]?.isActive === true;
  res.json({
    data: {
      hasPortal: Boolean(link),
      active: Boolean(link && link.user.status === "active" && membershipActive),
      status: link?.user.status || null,
      email: link?.user.email || client.email || null,
      invitedAt: link?.createdAt || null,
    },
  });
}

export async function getCommunicationRealtimeConfig(req, res) {
  await requireCommunicationPermission(req, "canUseChat");
  const caseItem = await scopedCase(req, req.params.caseId);
  res.json({
    data: getRealtimeClientConfig({
      userId: req.user.id,
      agencyId: req.user.agencyId,
      caseId: caseItem.id,
      role: req.user.role,
    }),
  });
}

export async function getCurrentCommunicationPermissions(req, res) {
  res.json({ data: await getCommunicationPermissions(req) });
}

export async function listTeamCommunicationPermissions(req, res) {
  requireCommunicationAdministrator(req);
  const users = await prisma.user.findMany({
    where: { agencyId: req.user.agencyId },
    orderBy: [{ role: "asc" }, { fullName: "asc" }],
    include: { communicationPermission: true },
  });
  res.json({
    data: users.map(({ communicationPermission, ...user }) => ({
      ...user,
      permissions: communicationPermission
        ? Object.fromEntries(
            communicationPermissionKeys.map((key) => [
              key,
              communicationPermission[key],
            ]),
          )
        : defaultCommunicationPermissionsForRole(user.role),
      permissionSource: communicationPermission ? "user" : "default",
    })),
  });
}

export async function updateCommunicationPermissions(req, res) {
  requireCommunicationAdministrator(req);
  const user = await prisma.user.findFirst({
    where: { id: req.params.userId, agencyId: req.user.agencyId },
  });
  if (!user) throw createHttpError(404, "Workspace user not found");
  const values = Object.fromEntries(
    communicationPermissionKeys
      .filter((key) => typeof req.body[key] === "boolean")
      .map((key) => [key, req.body[key]]),
  );
  if (!Object.keys(values).length)
    throw createHttpError(400, "Provide at least one communication permission");
  const data = await prisma.communicationPermission.upsert({
    where: { userId: user.id },
    create: { agencyId: req.user.agencyId, userId: user.id, ...values },
    update: values,
  });
  await audit(req, {
    action: "communication.permissions_updated",
    details: `Communication permissions updated for ${user.fullName}`,
    metadata: values,
  });
  res.json({ data });
}

export async function listCaseCommunication(req, res) {
  const permissions = await requireCommunicationPermission(req, "canView");
  const caseItem = await scopedCase(req, req.params.caseId);
  const { page, limit, skip } = pagination(req.query);
  const channel = channels.has(req.query.channel) ? req.query.channel : null;
  const status = statuses.has(req.query.status) ? req.query.status : null;
  const search = clean(req.query.search, 120);
  const sort = clean(req.query.sort, 30, "newest");
  const orderBy =
    sort === "oldest"
      ? [{ occurredAt: "asc" }, { id: "asc" }]
      : sort === "status"
        ? [{ status: "asc" }, { occurredAt: "desc" }]
        : sort === "name"
          ? [{ subject: "asc" }, { occurredAt: "desc" }]
          : [{ occurredAt: "desc" }, { id: "desc" }];
  const trash = req.query.trash === "true";
  const where = {
    agencyId: req.user.agencyId,
    caseId: caseItem.id,
    deletedAt: trash ? { not: null } : null,
    ...(channel ? { channel } : {}),
    ...(status ? { status } : {}),
    ...(!permissions.canViewAll
      ? { conversation: { assignedToId: req.user.id } }
      : {}),
    ...(search
      ? {
          OR: [
            { subject: { contains: search, mode: "insensitive" } },
            { bodyText: { contains: search, mode: "insensitive" } },
            { senderAddress: { contains: search, mode: "insensitive" } },
          ],
        }
      : {}),
  };
  const [data, total, grouped] = await Promise.all([
    prisma.communicationMessage.findMany({
      where,
      include: messageInclude,
      orderBy,
      skip,
      take: limit,
    }),
    prisma.communicationMessage.count({ where }),
    prisma.communicationMessage.groupBy({
      by: ["channel"],
      where: {
        agencyId: req.user.agencyId,
        caseId: caseItem.id,
        deletedAt: null,
      },
      _count: { _all: true },
    }),
  ]);
  res.json({
    data,
    meta: {
      page,
      limit,
      total,
      totalPages: Math.max(Math.ceil(total / limit), 1),
      hasMore: skip + data.length < total,
      counts: Object.fromEntries(
        grouped.map((item) => [item.channel, item._count._all]),
      ),
    },
  });
}

export async function listCommunicationInbox(req, res) {
  const permissions = await requireCommunicationPermission(req, "canView");
  const { page, limit, skip } = pagination(req.query, 30);
  const state = conversationStates.has(req.query.state)
    ? req.query.state
    : null;
  const channel = channels.has(req.query.channel) ? req.query.channel : null;
  const clientId = clean(req.query.clientId, 80);
  const search = clean(req.query.search, 120);
  const sort = clean(req.query.sort, 30, "newest");
  const orderBy =
    sort === "oldest"
      ? [{ lastMessageAt: "asc" }]
      : sort === "name"
        ? [{ client: { fullName: "asc" } }, { lastMessageAt: "desc" }]
        : sort === "priority"
          ? [{ priority: "desc" }, { lastMessageAt: "desc" }]
          : [{ lastMessageAt: "desc" }];
  const scope = clean(req.query.scope, 30, "all");
  const where = {
    agencyId: req.user.agencyId,
    deletedAt: null,
    isArchived: scope === "archived",
    ...(state ? { state } : {}),
    ...(channel ? { channel } : {}),
    ...(clientId ? { clientId } : {}),
    ...(scope === "mine" || !permissions.canViewAll
      ? { assignedToId: req.user.id }
      : {}),
    ...(scope === "unassigned" ? { assignedToId: null } : {}),
    ...(scope === "unread" ? { unreadCount: { gt: 0 } } : {}),
    ...(search
      ? {
          OR: [
            { subject: { contains: search, mode: "insensitive" } },
            { client: { fullName: { contains: search, mode: "insensitive" } } },
            {
              messages: {
                some: {
                  bodyText: { contains: search, mode: "insensitive" },
                  deletedAt: null,
                },
              },
            },
          ],
        }
      : {}),
  };
  const [data, total] = await Promise.all([
    prisma.communicationConversation.findMany({
      where,
      include: conversationInclude,
      orderBy,
      skip,
      take: limit,
    }),
    prisma.communicationConversation.count({ where }),
  ]);
  res.json({
    data,
    meta: {
      page,
      limit,
      total,
      totalPages: Math.max(Math.ceil(total / limit), 1),
      hasMore: skip + data.length < total,
    },
  });
}

export async function getCommunicationConversation(req, res) {
  await requireCommunicationPermission(req, "canView");
  const conversation = await scopedConversation(req, req.params.id);
  const { page, limit, skip } = pagination(req.query, 50);
  const [messages, total] = await Promise.all([
    prisma.communicationMessage.findMany({
      where: {
        agencyId: req.user.agencyId,
        conversationId: conversation.id,
        deletedAt: null,
      },
      include: messageInclude,
      orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
      skip,
      take: limit,
    }),
    prisma.communicationMessage.count({
      where: {
        agencyId: req.user.agencyId,
        conversationId: conversation.id,
        deletedAt: null,
      },
    }),
  ]);
  res.json({
    data: { ...conversation, messages },
    meta: { page, limit, total, hasMore: skip + messages.length < total },
  });
}

export async function createCommunicationMessage(req, res) {
  const requestedConversationId = clean(req.body.conversationId, 80);
  const conversationContext = requestedConversationId
    ? await prisma.communicationConversation.findFirst({
        where: { id: requestedConversationId, agencyId: req.user.agencyId, deletedAt: null },
        select: { id: true, clientId: true, caseId: true, assignedToId: true, provider: true },
      })
    : null;
  if (requestedConversationId && !conversationContext) throw createHttpError(404, "Conversation not found");
  const requestedCaseId = clean(req.body.caseId, 80) || conversationContext?.caseId || "";
  const caseItem = requestedCaseId ? await scopedCase(req, requestedCaseId) : null;
  const requestedClientId = clean(req.body.clientId, 80);
  const clientItem = requestedClientId
    ? await prisma.client.findFirst({
        where: {
          id: requestedClientId,
          agencyId: req.user.agencyId,
          ...clientAccessWhere(req),
        },
        select: { id: true, assignedUserId: true },
      })
    : null;
  if (requestedClientId && !clientItem)
    throw createHttpError(404, "Client not found");
  if (!caseItem && !conversationContext && !clientItem)
    throw createHttpError(400, "A case, client, or existing conversation is required");
  if (caseItem && conversationContext && conversationContext.clientId !== caseItem.clientId) throw createHttpError(409, "The conversation does not belong to this case");
  if (caseItem && clientItem && caseItem.clientId !== clientItem.id)
    throw createHttpError(409, "The selected case does not belong to this client");
  if (conversationContext && clientItem && conversationContext.clientId !== clientItem.id)
    throw createHttpError(409, "The conversation does not belong to this client");
  const clientId = caseItem?.clientId || conversationContext?.clientId || clientItem.id;
  const channel = channels.has(req.body.channel) ? req.body.channel : null;
  const direction = directions.has(req.body.direction)
    ? req.body.direction
    : "Outbound";
  if (!channel) throw createHttpError(400, "Communication channel is required");
  await requireCommunicationPermission(
    req,
    direction === "Outbound" || direction === "Internal"
      ? sendPermission(channel)
      : "canView",
  );

  const authenticatedPortalChat =
    channel === "Chat" &&
    (req.body.portalAudience === true ||
      conversationContext?.provider === "AuthenticatedPortal");
  if (authenticatedPortalChat) {
    const activePortal = await prisma.clientUser.findFirst({
      where: {
        agencyId: req.user.agencyId,
        clientId,
        user: {
          status: "active",
          memberships: {
            some: {
              agencyId: req.user.agencyId,
              role: "client",
              isActive: true,
            },
          },
        },
      },
      select: { id: true },
    });
    if (!activePortal) {
      throw createHttpError(
        409,
        "Activate this client's portal access before sending a portal message.",
        "PORTAL_ACCESS_REQUIRED",
      );
    }
  }

  const bodyText = clean(req.body.bodyText, 20000);
  const bodyHtml = clean(req.body.bodyHtml, 100000) || null;
  const subject = clean(req.body.subject, 300) || null;
  // A chat message that's just an image/document (no caption) is a normal
  // WhatsApp/iMessage send — the attachment lands on this message right
  // after creation (see uploadCommunicationAttachment's Chat grace-window
  // branch), so an empty body here isn't the "forgot to write anything"
  // case the validation below exists to catch.
  const hasAttachment = channel === "Chat" && req.body.hasAttachment === true;
  if (channel !== "Call" && !bodyText && !subject && !hasAttachment)
    throw createHttpError(400, "Message content is required");
  const recipients = jsonArray(req.body.recipients)
    .map((value) => clean(value, 320))
    .filter(Boolean);
  const cc = jsonArray(req.body.cc)
    .map((value) => clean(value, 320))
    .filter(Boolean);
  const bcc = jsonArray(req.body.bcc)
    .map((value) => clean(value, 320))
    .filter(Boolean);
  const replyTo = clean(req.body.replyTo, 320) || null;
  const sendNow = req.body.sendNow === true || req.body.initiateCall === true;
  let scheduledAt = req.body.scheduledAt
    ? safeDate(req.body.scheduledAt, null)
    : null;
  const shouldQueue =
    direction === "Outbound" &&
    sendNow &&
    ["Email", "Sms", "Call"].includes(channel);
  if (shouldQueue || (direction === "Outbound" && channel === "Chat")) {
    const preference = await ensureRecipientAllowed(
      req.user.agencyId,
      clientId,
      channel,
      recipients,
    );
    if (shouldQueue) {
      const intendedAt =
        scheduledAt && scheduledAt > new Date() ? scheduledAt : new Date();
      const allowedAt = nextAllowedContactAt(preference, intendedAt);
      if (allowedAt > intendedAt) scheduledAt = allowedAt;
    }
  }

  const idempotencyKey =
    clean(req.header("idempotency-key") || req.body.idempotencyKey, 200) ||
    null;
  if (idempotencyKey) {
    const duplicate = await prisma.communicationMessage.findUnique({
      where: {
        agencyId_idempotencyKey: {
          agencyId: req.user.agencyId,
          idempotencyKey,
        },
      },
      include: messageInclude,
    });
    if (duplicate)
      return res
        .status(200)
        .json({ data: duplicate, meta: { duplicate: true } });
  }

  const occurredAt = safeDate(req.body.occurredAt);
  const responseDueAt =
    direction === "Inbound"
      ? await communicationResponseDueAt(req.user.agencyId, occurredAt)
      : null;
  const resolutionDueAt = await communicationResolutionDueAt(
    req.user.agencyId,
    occurredAt,
  );
  const provider =
    channel === "Chat"
      ? authenticatedPortalChat
        ? "AuthenticatedPortal"
        : "Supabase"
      : channel === "Email"
        ? "SMTP"
        : ["Sms", "Call"].includes(channel)
          ? "Ooma"
          : "Manual";
  let parent = null;
  if (req.body.parentMessageId) {
    parent = await prisma.communicationMessage.findFirst({
      where: {
        id: req.body.parentMessageId,
        agencyId: req.user.agencyId,
        conversationId: conversationContext?.id || undefined,
      },
    });
    if (!parent) throw createHttpError(404, "Parent message not found");
  }

  const data = await prisma.$transaction(async (tx) => {
    let conversation = req.body.conversationId
      ? await tx.communicationConversation.findFirst({
          where: {
            id: req.body.conversationId,
            agencyId: req.user.agencyId,
            clientId,
            caseId: caseItem?.id || null,
            deletedAt: null,
          },
        })
      : parent
        ? await tx.communicationConversation.findUnique({
            where: { id: parent.conversationId },
          })
        : null;
    if (!conversation && channel === "Chat") {
      conversation = await tx.communicationConversation.findFirst({
        where: {
          agencyId: req.user.agencyId,
          clientId,
          caseId: caseItem?.id || null,
          channel: "Chat",
          ...(authenticatedPortalChat
            ? { provider: "AuthenticatedPortal" }
            : {}),
          state: { not: "Closed" },
          deletedAt: null,
        },
        orderBy: { lastMessageAt: "desc" },
      });
    }
    if (!conversation) {
      conversation = await tx.communicationConversation.create({
        data: {
          agencyId: req.user.agencyId,
          clientId,
          caseId: caseItem?.id || null,
          channel,
          subject,
          provider,
          providerThreadId: clean(req.body.providerThreadId, 300) || null,
          assignedToId:
            req.body.assignedToId || caseItem?.assignedUserId || clientItem?.assignedUserId || conversationContext?.assignedToId || req.user.id,
          state: nextConversationState(direction),
          lastMessageAt: occurredAt,
          lastInboundAt: direction === "Inbound" ? occurredAt : null,
          firstInboundAt: direction === "Inbound" ? occurredAt : null,
          lastOutboundAt: direction === "Outbound" ? occurredAt : null,
          responseDueAt,
          resolutionDueAt,
          // The common update below applies the inbound increment for both new
          // and existing conversations. Start at zero here so a newly created
          // thread is not counted twice.
          unreadCount: 0,
          createdById: req.user.id,
        },
      });
    }
    const initialStatus = shouldQueue
      ? scheduledAt && scheduledAt > new Date()
        ? "Scheduled"
        : "Queued"
      : statuses.has(req.body.status)
        ? req.body.status
        : direction === "Inbound"
          ? "Received"
          : channel === "Chat"
            ? "Sent"
            : channel === "Call"
              ? req.body.callDisposition === "Missed"
                ? "Missed"
                : "Completed"
              : "Draft";
    const message = await tx.communicationMessage.create({
      data: {
        agencyId: req.user.agencyId,
        clientId,
        caseId: caseItem?.id || null,
        conversationId: conversation.id,
        channel,
        direction,
        status: initialStatus,
        senderUserId: direction === "Inbound" ? null : req.user.id,
        senderAddress:
          clean(req.body.senderAddress, 320) ||
          (direction === "Inbound" ? null : req.user.email),
        recipients,
        cc,
        bcc,
        replyTo,
        subject,
        bodyText: bodyText || null,
        bodyHtml,
        provider,
        idempotencyKey,
        parentMessageId: parent?.id || null,
        emailInReplyTo: parent?.emailMessageId || null,
        emailReferences: parent
          ? [
              ...jsonArray(parent.emailReferences),
              parent.emailMessageId,
            ].filter(Boolean)
          : [],
        occurredAt,
        scheduledAt,
        durationSeconds:
          req.body.durationSeconds === undefined ||
          req.body.durationSeconds === null ||
          req.body.durationSeconds === ""
            ? null
            : Math.max(0, Number(req.body.durationSeconds) || 0),
        callDisposition: clean(req.body.callDisposition, 80) || null,
        attachments: jsonArray(req.body.attachments),
        metadata: jsonObject(req.body.metadata),
        isRead: direction !== "Inbound" || req.body.isRead === true,
      },
    });
    if (shouldQueue) {
      await tx.communicationOutbox.create({
        data: {
          agencyId: req.user.agencyId,
          messageId: message.id,
          payload: buildOutboxPayload({
            messageId: message.id,
            recipients,
            cc,
            bcc,
            replyTo,
            subject,
            bodyText,
            bodyHtml,
            parent,
          }),
          availableAt:
            scheduledAt && scheduledAt > new Date() ? scheduledAt : new Date(),
        },
      });
      await tx.communicationDeliveryEvent.create({
        data: {
          agencyId: req.user.agencyId,
          messageId: message.id,
          type: initialStatus,
          details:
            initialStatus === "Scheduled"
              ? `Scheduled for ${scheduledAt.toISOString()}`
              : "Queued for provider delivery",
        },
      });
    }
    const currentConversation = await tx.communicationConversation.findUnique({
      where: { id: conversation.id },
      select: { firstRespondedAt: true, lastInboundAt: true },
    });
    await tx.communicationConversation.update({
      where: { id: conversation.id },
      data: {
        lastMessageAt: occurredAt,
        subject: conversation.subject || subject,
        state: nextConversationState(direction),
        isArchived: false,
        ...(direction === "Inbound"
          ? {
              firstInboundAt: conversation.firstInboundAt || occurredAt,
              lastInboundAt: occurredAt,
              responseDueAt,
              unreadCount: { increment: 1 },
            }
          : {}),
        ...(direction === "Outbound"
          ? {
              lastOutboundAt: occurredAt,
              responseDueAt: null,
              ...(!currentConversation?.firstRespondedAt &&
              currentConversation?.lastInboundAt
                ? { firstRespondedAt: occurredAt }
                : {}),
            }
          : {}),
      },
    });
    return tx.communicationMessage.findUnique({
      where: { id: message.id },
      include: messageInclude,
    });
  });
  await Promise.all([
    recordActivity({
      agencyId: req.user.agencyId,
      userId: req.user.id,
      clientId,
      caseId: caseItem?.id || null,
      action: shouldQueue ? "communication.queued" : "communication.recorded",
      details: `${channel} ${direction.toLowerCase()} communication ${shouldQueue ? "queued" : "recorded"}`,
    }),
    audit(req, {
      conversationId: data.conversationId,
      messageId: data.id,
      action: shouldQueue ? "communication.queued" : "communication.created",
      details: `${channel} ${direction.toLowerCase()} communication created`,
      metadata: { status: data.status },
    }),
  ]);
  if (direction === "Outbound" && data.conversationId) {
    await resolveNotifications({
      agencyId: req.user.agencyId,
      entityType: "conversation",
      entityId: data.conversationId,
      types: [
        "communication.inbound_received",
        "communication.client_chat_received",
        "communication.portal_message_received",
        "communication.response_due",
        "communication.response_breached",
      ],
    });
  }
  // An attachment-only message broadcasts once the file finishes
  // uploading/scanning (from uploadCommunicationAttachment), not here —
  // otherwise every recipient sees an empty bubble flash before the image
  // or file appears in it.
  if (channel === "Chat" && caseItem && !hasAttachment) {
    await broadcastCaseCommunication({
      agencyId: req.user.agencyId,
      caseId: caseItem.id,
      event: "message",
      payload: {
        messageId: data.id,
        conversationId: data.conversationId,
        occurredAt: data.occurredAt,
      },
    }).catch(async (realtimeError) => {
      await audit(req, {
        conversationId: data.conversationId,
        messageId: data.id,
        action: "communication.realtime_failed",
        details: String(realtimeError.message || realtimeError).slice(0, 500),
      });
    });
  }
  res.status(201).json({ data });
}

export async function updateCommunicationDraft(req, res) {
  const existing = await prisma.communicationMessage.findFirst({
    where: { id: req.params.id, agencyId: req.user.agencyId, deletedAt: null },
  });
  if (!existing) throw createHttpError(404, "Communication draft not found");
  await requireCommunicationPermission(req, sendPermission(existing.channel));
  if (existing.status !== "Draft")
    throw createHttpError(409, "Only drafts can be edited");
  const recipients =
    req.body.recipients === undefined
      ? existing.recipients
      : jsonArray(req.body.recipients)
          .map((item) => clean(item, 320))
          .filter(Boolean);
  const data = await prisma.communicationMessage.update({
    where: { id: existing.id },
    data: {
      recipients,
      ...(req.body.cc !== undefined
        ? {
            cc: jsonArray(req.body.cc)
              .map((item) => clean(item, 320))
              .filter(Boolean),
          }
        : {}),
      ...(req.body.bcc !== undefined
        ? {
            bcc: jsonArray(req.body.bcc)
              .map((item) => clean(item, 320))
              .filter(Boolean),
          }
        : {}),
      ...(req.body.replyTo !== undefined
        ? { replyTo: clean(req.body.replyTo, 320) || null }
        : {}),
      ...(req.body.subject !== undefined
        ? { subject: clean(req.body.subject, 300) || null }
        : {}),
      ...(req.body.bodyText !== undefined
        ? { bodyText: clean(req.body.bodyText, 20000) || null }
        : {}),
      ...(req.body.bodyHtml !== undefined
        ? { bodyHtml: clean(req.body.bodyHtml, 100000) || null }
        : {}),
    },
    include: messageInclude,
  });
  await audit(req, {
    conversationId: data.conversationId,
    messageId: data.id,
    action: "communication.draft_updated",
    details: `${data.channel} draft updated`,
  });
  res.json({ data });
}

export async function sendCommunicationDraft(req, res) {
  const existing = await prisma.communicationMessage.findFirst({
    where: { id: req.params.id, agencyId: req.user.agencyId, deletedAt: null },
  });
  if (!existing) throw createHttpError(404, "Communication draft not found");
  await requireCommunicationPermission(req, sendPermission(existing.channel));
  if (
    existing.direction !== "Outbound" ||
    !["Email", "Sms"].includes(existing.channel)
  )
    throw createHttpError(400, "Only outbound email or SMS drafts can be sent");
  if (
    ["Queued", "Scheduled", "Sending", "Sent", "Delivered"].includes(
      existing.status,
    )
  ) {
    const data = await prisma.communicationMessage.findUnique({
      where: { id: existing.id },
      include: messageInclude,
    });
    return res.json({ data, meta: { alreadyQueued: true } });
  }
  if (existing.status !== "Draft" && existing.status !== "Failed")
    throw createHttpError(
      409,
      "This communication cannot be sent from its current status",
    );
  const recipients = jsonArray(existing.recipients)
    .map((value) => clean(value, 320))
    .filter(Boolean);
  const preference = await ensureRecipientAllowed(
    req.user.agencyId,
    existing.clientId,
    existing.channel,
    recipients,
  );
  const unsafeAttachments = await prisma.communicationAttachment.findMany({
    where: { messageId: existing.id, scanStatus: { not: "Clean" } },
    select: { originalFilename: true, scanStatus: true },
  });
  if (unsafeAttachments.length) {
    throw createHttpError(
      409,
      `Resolve attachment security checks before sending: ${unsafeAttachments.map((item) => `${item.originalFilename} (${item.scanStatus})`).join(", ")}`,
    );
  }
  let scheduledAt = req.body.scheduledAt
    ? safeDate(req.body.scheduledAt, null)
    : null;
  const intendedAt =
    scheduledAt && scheduledAt > new Date() ? scheduledAt : new Date();
  const allowedAt = nextAllowedContactAt(preference, intendedAt);
  if (allowedAt > intendedAt) scheduledAt = allowedAt;
  const status =
    scheduledAt && scheduledAt > new Date() ? "Scheduled" : "Queued";
  const data = await prisma.$transaction(async (tx) => {
    const message = await tx.communicationMessage.update({
      where: { id: existing.id },
      data: { status, scheduledAt, failedAt: null, failureReason: null },
    });
    const parent = existing.parentMessageId
      ? await tx.communicationMessage.findUnique({
          where: { id: existing.parentMessageId },
        })
      : null;
    await tx.communicationOutbox.create({
      data: {
        agencyId: req.user.agencyId,
        messageId: existing.id,
        payload: buildOutboxPayload({
          messageId: existing.id,
          recipients,
          cc: jsonArray(existing.cc),
          bcc: jsonArray(existing.bcc),
          replyTo: existing.replyTo,
          subject: existing.subject,
          bodyText: existing.bodyText,
          bodyHtml: existing.bodyHtml,
          parent,
        }),
        availableAt:
          scheduledAt && scheduledAt > new Date() ? scheduledAt : new Date(),
      },
    });
    await tx.communicationDeliveryEvent.create({
      data: {
        agencyId: req.user.agencyId,
        messageId: existing.id,
        type: status,
        details:
          status === "Scheduled"
            ? `Scheduled for ${scheduledAt.toISOString()}`
            : "Queued for provider delivery",
      },
    });
    const respondedAt = new Date();
    const conversation = await tx.communicationConversation.findUnique({
      where: { id: existing.conversationId },
      select: { firstRespondedAt: true, lastInboundAt: true },
    });
    await tx.communicationConversation.update({
      where: { id: existing.conversationId },
      data: {
        state: "WaitingOnClient",
        lastOutboundAt: respondedAt,
        isArchived: false,
        responseDueAt: null,
        ...(!conversation?.firstRespondedAt && conversation?.lastInboundAt
          ? { firstRespondedAt: respondedAt }
          : {}),
      },
    });
    return tx.communicationMessage.findUnique({
      where: { id: message.id },
      include: messageInclude,
    });
  });
  await audit(req, {
    conversationId: data.conversationId,
    messageId: data.id,
    action:
      status === "Scheduled"
        ? "communication.scheduled"
        : "communication.queued",
    details: `${data.channel} draft ${status.toLowerCase()}`,
  });
  res.json({ data });
}

export async function updateCommunicationConversation(req, res) {
  await requireCommunicationPermission(req, "canView");
  const existing = await scopedConversation(req, req.params.id, undefined);
  const reopenedResolutionDueAt =
    req.body.state === "Open" && existing.state === "Closed"
      ? await communicationResolutionDueAt(req.user.agencyId, new Date())
      : undefined;
  let assignedToId = existing.assignedToId;
  if (req.body.assignedToId !== undefined) {
    if (req.body.assignedToId) {
      const user = await prisma.user.findFirst({
        where: { id: req.body.assignedToId, agencyId: req.user.agencyId },
      });
      if (!user) throw createHttpError(404, "Assigned team member not found");
    }
    assignedToId = req.body.assignedToId || null;
  }
  const data = await prisma.communicationConversation.update({
    where: { id: existing.id },
    data: {
      assignedToId,
      ...(conversationStates.has(req.body.state)
        ? {
            state: req.body.state,
            ...(req.body.state === "Closed"
              ? { resolutionDueAt: null }
              : reopenedResolutionDueAt
                ? { resolutionDueAt: reopenedResolutionDueAt }
                : {}),
          }
        : {}),
      ...(priorities.has(req.body.priority)
        ? { priority: req.body.priority }
        : {}),
      ...(req.body.tags !== undefined
        ? {
            tags: jsonArray(req.body.tags, 20)
              .map((item) => clean(item, 40))
              .filter(Boolean),
          }
        : {}),
      ...(req.body.subject !== undefined
        ? { subject: clean(req.body.subject, 300) || null }
        : {}),
      ...(req.body.snoozedUntil !== undefined
        ? {
            snoozedUntil: req.body.snoozedUntil
              ? safeDate(req.body.snoozedUntil, null)
              : null,
            state: req.body.snoozedUntil ? "Snoozed" : "Open",
          }
        : {}),
      ...(req.body.isArchived !== undefined
        ? { isArchived: Boolean(req.body.isArchived) }
        : {}),
      ...(req.body.legalHold !== undefined && req.user.role === "admin"
        ? { legalHold: Boolean(req.body.legalHold) }
        : {}),
    },
    include: conversationInclude,
  });
  await audit(req, {
    conversationId: data.id,
    action: "communication.conversation_updated",
    details: "Conversation ownership or workflow state updated",
    metadata: {
      assignedToId: data.assignedToId,
      state: data.state,
      priority: data.priority,
    },
  });
  res.json({ data });
}

export async function bulkUpdateCommunicationConversations(req, res) {
  const permissions = await requireCommunicationPermission(req, "canView");
  const ids = jsonArray(req.body.ids, 100).map(String).filter(Boolean);
  if (!ids.length)
    throw createHttpError(400, "Select at least one conversation");
  const action = clean(req.body.action, 40);
  const where = {
    id: { in: ids },
    agencyId: req.user.agencyId,
    deletedAt: null,
    ...(!permissions.canViewAll ? { assignedToId: req.user.id } : {}),
  };
  const conversations = await prisma.communicationConversation.findMany({
    where,
    select: { id: true },
  });
  if (!conversations.length)
    throw createHttpError(404, "No accessible conversations were selected");
  const scopedIds = conversations.map((item) => item.id);
  let data = {};
  if (action === "read") {
    await prisma.$transaction([
      prisma.communicationMessage.updateMany({
        where: {
          conversationId: { in: scopedIds },
          direction: "Inbound",
          deletedAt: null,
        },
        data: { isRead: true },
      }),
      prisma.communicationConversation.updateMany({
        where: { id: { in: scopedIds } },
        data: { unreadCount: 0 },
      }),
    ]);
    data = { unreadCount: 0 };
  } else if (action === "archive") {
    await prisma.communicationConversation.updateMany({
      where: { id: { in: scopedIds } },
      data: { isArchived: true },
    });
    data = { isArchived: true };
  } else if (action === "close" || action === "reopen") {
    const state = action === "close" ? "Closed" : "Open";
    const resolutionDueAt =
      action === "reopen"
        ? await communicationResolutionDueAt(req.user.agencyId, new Date())
        : null;
    await prisma.communicationConversation.updateMany({
      where: { id: { in: scopedIds } },
      data: { state, isArchived: action === "close", resolutionDueAt },
    });
    data = { state };
  } else if (action === "assign") {
    const assignedToId = clean(req.body.assignedToId, 80);
    const user = await prisma.user.findFirst({
      where: { id: assignedToId, agencyId: req.user.agencyId },
    });
    if (!user) throw createHttpError(404, "Assigned team member not found");
    await prisma.communicationConversation.updateMany({
      where: { id: { in: scopedIds } },
      data: { assignedToId: user.id },
    });
    data = { assignedToId: user.id, assignedToName: user.fullName };
  } else {
    throw createHttpError(400, "Choose a supported bulk inbox action");
  }
  await audit(req, {
    action: "communication.conversations_bulk_updated",
    details: `${scopedIds.length} conversations updated: ${action}`,
    metadata: { ids: scopedIds, action, ...data },
  });
  res.json({ data: { updated: scopedIds.length, ...data } });
}

export async function markCommunicationRead(req, res) {
  await requireCommunicationPermission(req, "canView");
  const conversation = await scopedConversation(req, req.params.id, undefined);
  const read = req.body.read !== false;
  await prisma.$transaction([
    prisma.communicationMessage.updateMany({
      where: {
        conversationId: conversation.id,
        agencyId: req.user.agencyId,
        direction: "Inbound",
        deletedAt: null,
      },
      data: { isRead: read },
    }),
    prisma.communicationConversation.update({
      where: { id: conversation.id },
      data: { unreadCount: read ? 0 : 1 },
    }),
  ]);
  res.json({ data: { id: conversation.id, unreadCount: read ? 0 : 1 } });
}

export async function retryCommunicationDelivery(req, res) {
  const existing = await prisma.communicationMessage.findFirst({
    where: { id: req.params.id, agencyId: req.user.agencyId, deletedAt: null },
  });
  if (!existing) throw createHttpError(404, "Communication not found");
  await requireCommunicationPermission(req, sendPermission(existing.channel));
  if (existing.status !== "Failed")
    throw createHttpError(409, "Only failed communication can be retried");
  req.params.id = existing.id;
  return sendCommunicationDraft(req, res);
}

export async function listCommunicationConsents(req, res) {
  await requireCommunicationPermission(req, "canView");
  const caseItem = await scopedCase(req, req.params.caseId);
  const data = await prisma.communicationConsent.findMany({
    where: { agencyId: req.user.agencyId, clientId: caseItem.clientId },
    orderBy: [{ channel: "asc" }, { updatedAt: "desc" }],
  });
  res.json({ data });
}

export async function upsertCommunicationConsent(req, res) {
  await requireCommunicationPermission(req, "canManageConsent");
  const caseItem = await scopedCase(req, clean(req.body.caseId, 80));
  const channel = channels.has(req.body.channel) ? req.body.channel : null;
  const status = consentStatuses.has(req.body.status) ? req.body.status : null;
  const address = channel ? normalizeAddress(channel, req.body.address) : "";
  if (!channel || !["Email", "Sms"].includes(channel) || !status || !address)
    throw createHttpError(
      400,
      "Valid email or SMS consent details are required",
    );
  if (status === "Consented" && !clean(req.body.source, 200))
    throw createHttpError(400, "Record how consent was obtained");
  const now = new Date();
  const data = await prisma.communicationConsent.upsert({
    where: {
      agencyId_channel_address: {
        agencyId: req.user.agencyId,
        channel,
        address,
      },
    },
    create: {
      agencyId: req.user.agencyId,
      clientId: caseItem.clientId,
      channel,
      address,
      status,
      source: clean(req.body.source, 200) || null,
      purpose: clean(req.body.purpose, 500) || null,
      proof: jsonObject(req.body.proof),
      consentedAt: status === "Consented" ? now : null,
      optedOutAt: status === "OptedOut" ? now : null,
    },
    update: {
      clientId: caseItem.clientId,
      status,
      source: clean(req.body.source, 200) || null,
      purpose: clean(req.body.purpose, 500) || null,
      proof: jsonObject(req.body.proof),
      consentedAt: status === "Consented" ? now : undefined,
      optedOutAt: status === "OptedOut" ? now : null,
    },
  });
  await audit(req, {
    action: "communication.consent_updated",
    details: `${channel} consent marked ${status} for ${address}`,
    metadata: {
      clientId: caseItem.clientId,
      channel,
      address,
      status,
      source: data.source,
    },
  });
  res.json({ data });
}

export async function listCommunicationTemplates(req, res) {
  await requireCommunicationPermission(req, "canView");
  const channel = channels.has(req.query.channel) ? req.query.channel : null;
  const data = await prisma.communicationTemplate.findMany({
    where: {
      agencyId: req.user.agencyId,
      isActive: true,
      ...(channel ? { channel } : {}),
    },
    orderBy: [{ category: "asc" }, { name: "asc" }],
  });
  res.json({ data });
}

export async function createCommunicationTemplate(req, res) {
  await requireCommunicationPermission(req, "canManageTemplates");
  const channel = channels.has(req.body.channel) ? req.body.channel : null;
  const name = clean(req.body.name, 160);
  const bodyText = clean(req.body.bodyText, 20000);
  if (!channel || !name || !bodyText)
    throw createHttpError(
      400,
      "Template channel, name, and message are required",
    );
  const data = await prisma.communicationTemplate.create({
    data: {
      agencyId: req.user.agencyId,
      channel,
      name,
      subject: clean(req.body.subject, 300) || null,
      bodyText,
      bodyHtml: clean(req.body.bodyHtml, 100000) || null,
      category: clean(req.body.category, 100) || null,
      language: clean(req.body.language, 40, "English") || "English",
      createdById: req.user.id,
      updatedById: req.user.id,
    },
  });
  await audit(req, {
    action: "communication.template_created",
    details: `${name} template created`,
  });
  res.status(201).json({ data });
}

export async function updateCommunicationTemplate(req, res) {
  await requireCommunicationPermission(req, "canManageTemplates");
  const existing = await prisma.communicationTemplate.findFirst({
    where: { id: req.params.id, agencyId: req.user.agencyId },
  });
  if (!existing) throw createHttpError(404, "Communication template not found");
  const data = await prisma.communicationTemplate.update({
    where: { id: existing.id },
    data: {
      ...(req.body.name !== undefined
        ? { name: clean(req.body.name, 160) }
        : {}),
      ...(req.body.subject !== undefined
        ? { subject: clean(req.body.subject, 300) || null }
        : {}),
      ...(req.body.bodyText !== undefined
        ? { bodyText: clean(req.body.bodyText, 20000) }
        : {}),
      ...(req.body.bodyHtml !== undefined
        ? { bodyHtml: clean(req.body.bodyHtml, 100000) || null }
        : {}),
      ...(req.body.category !== undefined
        ? { category: clean(req.body.category, 100) || null }
        : {}),
      ...(req.body.language !== undefined
        ? { language: clean(req.body.language, 40, "English") }
        : {}),
      ...(req.body.isActive !== undefined
        ? { isActive: Boolean(req.body.isActive) }
        : {}),
      updatedById: req.user.id,
    },
  });
  await audit(req, {
    action: "communication.template_updated",
    details: `${data.name} template updated`,
  });
  res.json({ data });
}

export async function deleteCommunicationTemplate(req, res) {
  await requireCommunicationPermission(req, "canManageTemplates");
  const existing = await prisma.communicationTemplate.findFirst({
    where: { id: req.params.id, agencyId: req.user.agencyId },
  });
  if (!existing) throw createHttpError(404, "Communication template not found");
  await prisma.communicationTemplate.update({
    where: { id: existing.id },
    data: { isActive: false, updatedById: req.user.id },
  });
  await audit(req, {
    action: "communication.template_archived",
    details: `${existing.name} template archived`,
  });
  res.status(204).send();
}

export async function getCommunicationRetentionPolicy(req, res) {
  await requireCommunicationPermission(req, "canView");
  const data = await prisma.communicationRetentionPolicy.upsert({
    where: { agencyId: req.user.agencyId },
    create: { agencyId: req.user.agencyId },
    update: {},
  });
  res.json({ data });
}

export async function updateCommunicationRetentionPolicy(req, res) {
  requireCommunicationAdministrator(req);
  const retentionDays = Math.min(
    Math.max(Number(req.body.retentionDays) || 2555, 30),
    36500,
  );
  const trashDays = Math.min(
    Math.max(Number(req.body.trashDays) || 30, 1),
    365,
  );
  const data = await prisma.communicationRetentionPolicy.upsert({
    where: { agencyId: req.user.agencyId },
    create: {
      agencyId: req.user.agencyId,
      retentionDays,
      trashDays,
      allowStaffDelete: Boolean(req.body.allowStaffDelete),
    },
    update: {
      retentionDays,
      trashDays,
      allowStaffDelete: Boolean(req.body.allowStaffDelete),
    },
  });
  await audit(req, {
    action: "communication.retention_updated",
    details: "Communication retention policy updated",
    metadata: {
      retentionDays,
      trashDays,
      allowStaffDelete: data.allowStaffDelete,
    },
  });
  res.json({ data });
}

export async function importCommunication(req, res) {
  await requireCommunicationPermission(req, "canView");
  const caseItem = await scopedCase(req, clean(req.body.caseId, 80));
  const records = Array.isArray(req.body.records)
    ? req.body.records.slice(0, 500)
    : [];
  if (!records.length)
    throw createHttpError(400, "No communication records were supplied");
  let imported = 0;
  let duplicates = 0;
  for (const item of records) {
    const channel = channels.has(item.channel) ? item.channel : null;
    if (!channel) continue;
    const providerMessageId = clean(item.providerMessageId, 300) || null;
    const provider = clean(item.provider, 80, "Import") || "Import";
    if (
      providerMessageId &&
      (await prisma.communicationMessage.findFirst({
        where: { agencyId: req.user.agencyId, provider, providerMessageId },
      }))
    ) {
      duplicates += 1;
      continue;
    }
    const occurredAt = safeDate(item.occurredAt);
    const direction = directions.has(item.direction)
      ? item.direction
      : "Inbound";
    const responseDueAt =
      direction === "Inbound"
        ? await communicationResponseDueAt(req.user.agencyId, occurredAt)
        : null;
    const resolutionDueAt = await communicationResolutionDueAt(
      req.user.agencyId,
      occurredAt,
    );
    await prisma.$transaction(async (tx) => {
      const conversation = await tx.communicationConversation.create({
        data: {
          agencyId: req.user.agencyId,
          clientId: caseItem.clientId,
          caseId: caseItem.id,
          channel,
          subject: clean(item.subject, 300) || null,
          provider,
          lastMessageAt: occurredAt,
          lastInboundAt: direction === "Inbound" ? occurredAt : null,
          firstInboundAt: direction === "Inbound" ? occurredAt : null,
          lastOutboundAt: direction === "Outbound" ? occurredAt : null,
          responseDueAt,
          resolutionDueAt,
          unreadCount: direction === "Inbound" && item.isRead === false ? 1 : 0,
          state: nextConversationState(direction),
          assignedToId: caseItem.assignedUserId || req.user.id,
          createdById: req.user.id,
        },
      });
      await tx.communicationMessage.create({
        data: {
          agencyId: req.user.agencyId,
          clientId: caseItem.clientId,
          caseId: caseItem.id,
          conversationId: conversation.id,
          channel,
          direction,
          status: statuses.has(item.status)
            ? item.status
            : direction === "Inbound"
              ? "Received"
              : "Sent",
          senderUserId: null,
          senderAddress: clean(item.senderAddress, 320) || null,
          recipients: jsonArray(item.recipients),
          subject: clean(item.subject, 300) || null,
          bodyText: clean(item.bodyText, 20000) || null,
          provider,
          providerMessageId,
          occurredAt,
          durationSeconds: item.durationSeconds
            ? Math.max(0, Number(item.durationSeconds) || 0)
            : null,
          callDisposition: clean(item.callDisposition, 80) || null,
          metadata: { imported: true },
          isRead: item.isRead !== false,
        },
      });
    });
    imported += 1;
  }
  await audit(req, {
    action: "communication.imported",
    details: `${imported} communication records imported; ${duplicates} duplicates skipped`,
    metadata: { imported, duplicates },
  });
  res.status(201).json({ data: { imported, duplicates } });
}

function csv(value) {
  const valueText = String(value ?? "");
  return `"${valueText.replaceAll('"', '""')}"`;
}

export async function exportCommunication(req, res) {
  await requireCommunicationPermission(req, "canExport");
  const caseItem = await scopedCase(req, clean(req.body.caseId, 80));
  const ids = jsonArray(req.body.ids).map(String);
  const data = await prisma.communicationMessage.findMany({
    where: {
      agencyId: req.user.agencyId,
      caseId: caseItem.id,
      deletedAt: null,
      ...(ids.length ? { id: { in: ids } } : {}),
    },
    include: messageInclude,
    orderBy: { occurredAt: "desc" },
  });
  const rows = [
    [
      "occurredAt",
      "channel",
      "direction",
      "status",
      "subject",
      "senderAddress",
      "recipients",
      "bodyText",
      "durationSeconds",
      "callDisposition",
      "provider",
      "providerMessageId",
    ]
      .map(csv)
      .join(","),
  ];
  for (const item of data)
    rows.push(
      [
        item.occurredAt.toISOString(),
        item.channel,
        item.direction,
        item.status,
        item.subject,
        item.senderAddress,
        Array.isArray(item.recipients) ? item.recipients.join("; ") : "",
        item.bodyText,
        item.durationSeconds,
        item.callDisposition,
        item.provider,
        item.providerMessageId,
      ]
        .map(csv)
        .join(","),
    );
  await audit(req, {
    action: "communication.exported",
    details: `${data.length} communication records exported`,
    metadata: { caseId: caseItem.id, count: data.length },
  });
  res.setHeader("content-type", "text/csv; charset=utf-8");
  res.setHeader(
    "content-disposition",
    `attachment; filename="case-communication-${caseItem.id}.csv"`,
  );
  res.send(`\uFEFF${rows.join("\n")}`);
}

export async function deleteCommunication(req, res) {
  await requireCommunicationDeletePolicy(req);
  const existing = await prisma.communicationMessage.findFirst({
    where: { id: req.params.id, agencyId: req.user.agencyId, deletedAt: null },
    include: { conversation: true },
  });
  if (!existing) throw createHttpError(404, "Communication record not found");
  if (existing.conversation.legalHold)
    throw createHttpError(
      409,
      "This conversation is under legal hold and cannot be deleted",
    );
  const now = new Date();
  await prisma.communicationMessage.update({
    where: { id: existing.id },
    data: { deletedAt: now, deletedById: req.user.id },
  });
  const remaining = await prisma.communicationMessage.count({
    where: { conversationId: existing.conversationId, deletedAt: null },
  });
  if (!remaining)
    await prisma.communicationConversation.update({
      where: { id: existing.conversationId },
      data: { deletedAt: now, deletedById: req.user.id },
    });
  await audit(req, {
    conversationId: existing.conversationId,
    messageId: existing.id,
    action: "communication.moved_to_trash",
    details: `${existing.channel} communication moved to trash`,
  });
  res.status(204).send();
}

export async function bulkDeleteCommunication(req, res) {
  await requireCommunicationDeletePolicy(req);
  const caseItem = await scopedCase(req, clean(req.body.caseId, 80));
  const ids = jsonArray(req.body.ids).map(String);
  if (!ids.length)
    throw createHttpError(400, "Select at least one communication record");
  const records = await prisma.communicationMessage.findMany({
    where: {
      id: { in: ids },
      agencyId: req.user.agencyId,
      caseId: caseItem.id,
      deletedAt: null,
      conversation: { legalHold: false },
    },
    select: { id: true, conversationId: true },
  });
  const now = new Date();
  await prisma.communicationMessage.updateMany({
    where: { id: { in: records.map((item) => item.id) } },
    data: { deletedAt: now, deletedById: req.user.id },
  });
  for (const conversationId of [
    ...new Set(records.map((item) => item.conversationId)),
  ]) {
    if (
      !(await prisma.communicationMessage.count({
        where: { conversationId, deletedAt: null },
      }))
    )
      await prisma.communicationConversation.update({
        where: { id: conversationId },
        data: { deletedAt: now, deletedById: req.user.id },
      });
  }
  await audit(req, {
    action: "communication.bulk_moved_to_trash",
    details: `${records.length} communication records moved to trash`,
    metadata: { ids: records.map((item) => item.id) },
  });
  res.json({
    data: { deleted: records.length, skipped: ids.length - records.length },
  });
}

export async function restoreCommunication(req, res) {
  await requireCommunicationDeletePolicy(req);
  const existing = await prisma.communicationMessage.findFirst({
    where: {
      id: req.params.id,
      agencyId: req.user.agencyId,
      deletedAt: { not: null },
    },
  });
  if (!existing)
    throw createHttpError(404, "Deleted communication record not found");
  const data = await prisma.$transaction(async (tx) => {
    await tx.communicationConversation.update({
      where: { id: existing.conversationId },
      data: { deletedAt: null, deletedById: null },
    });
    return tx.communicationMessage.update({
      where: { id: existing.id },
      data: { deletedAt: null, deletedById: null },
      include: messageInclude,
    });
  });
  await audit(req, {
    conversationId: data.conversationId,
    messageId: data.id,
    action: "communication.restored",
    details: `${data.channel} communication restored from trash`,
  });
  res.json({ data });
}

export async function listUnmatchedCommunication(req, res) {
  await requireCommunicationPermission(req, "canView");
  const { page, limit, skip } = pagination(req.query, 30);
  const channel = channels.has(req.query.channel) ? req.query.channel : null;
  const search = clean(req.query.search, 120);
  const where = {
    agencyId: req.user.agencyId,
    resolvedAt: null,
    ...(channel ? { channel } : {}),
    ...(search
      ? {
          OR: [
            { senderAddress: { contains: search, mode: "insensitive" } },
            { subject: { contains: search, mode: "insensitive" } },
            { bodyText: { contains: search, mode: "insensitive" } },
          ],
        }
      : {}),
  };
  const [data, total] = await Promise.all([
    prisma.unmatchedCommunication.findMany({
      where,
      orderBy: { occurredAt: "desc" },
      skip,
      take: limit,
    }),
    prisma.unmatchedCommunication.count({ where }),
  ]);
  res.json({
    data,
    meta: { page, limit, total, hasMore: skip + data.length < total },
  });
}

export async function assignUnmatchedCommunication(req, res) {
  await requireCommunicationPermission(req, "canView");
  const unmatched = await prisma.unmatchedCommunication.findFirst({
    where: { id: req.params.id, agencyId: req.user.agencyId, resolvedAt: null },
  });
  if (!unmatched)
    throw createHttpError(404, "Unmatched communication not found");
  const caseItem = await scopedCase(req, clean(req.body.caseId, 80));
  const direction = "Inbound";
  const [responseDueAt, resolutionDueAt] = await Promise.all([
    communicationResponseDueAt(req.user.agencyId, unmatched.occurredAt),
    communicationResolutionDueAt(req.user.agencyId, unmatched.occurredAt),
  ]);
  const data = await prisma.$transaction(async (tx) => {
    const conversation = await tx.communicationConversation.create({
      data: {
        agencyId: req.user.agencyId,
        clientId: caseItem.clientId,
        caseId: caseItem.id,
        channel: unmatched.channel,
        subject: unmatched.subject,
        provider: unmatched.provider,
        lastMessageAt: unmatched.occurredAt,
        lastInboundAt: unmatched.occurredAt,
        firstInboundAt: unmatched.occurredAt,
        responseDueAt,
        resolutionDueAt,
        unreadCount: 1,
        state: "WaitingOnAgency",
        assignedToId: caseItem.assignedUserId || req.user.id,
        createdById: req.user.id,
      },
    });
    const message = await tx.communicationMessage.create({
      data: {
        agencyId: req.user.agencyId,
        clientId: caseItem.clientId,
        caseId: caseItem.id,
        conversationId: conversation.id,
        channel: unmatched.channel,
        direction,
        status: "Received",
        senderAddress: unmatched.senderAddress,
        recipients: unmatched.recipients,
        subject: unmatched.subject,
        bodyText: unmatched.bodyText,
        provider: unmatched.provider,
        providerMessageId: unmatched.providerMessageId,
        occurredAt: unmatched.occurredAt,
        metadata: { importedFromUnmatched: unmatched.id },
        isRead: false,
      },
    });
    await tx.unmatchedCommunication.update({
      where: { id: unmatched.id },
      data: { resolvedAt: new Date() },
    });
    return tx.communicationMessage.findUnique({
      where: { id: message.id },
      include: messageInclude,
    });
  });
  await audit(req, {
    conversationId: data.conversationId,
    messageId: data.id,
    action: "communication.unmatched_assigned",
    details: `Inbound ${data.channel} linked to ${caseItem.client.fullName}`,
    metadata: { unmatchedId: unmatched.id, caseId: caseItem.id },
  });
  res.json({ data });
}
