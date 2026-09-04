import prisma from "../services/prisma/client.js";
import { createHttpError } from "../utils/http.js";
import { decryptSecret } from "../services/secretEncryption.js";
import { clientAccessWhere } from "../middleware/authorization.js";
import { portalDataScope } from "../services/portalAccessService.js";
import { leadAccessWhere } from "../modules/leads/lead.permissions.js";
import { createLead as createLeadRecord } from "../modules/leads/lead.service.js";
import { DEFAULT_LEAD_SOURCES } from "../modules/leads/lead.constants.js";
import { agencyTwilioSmsSendingOptions, sendAgencyTwilioSms } from "../services/agencyTwilioService.js";
import { normalizeCommunicationPhone } from "../services/communicationAddressService.js";
import { assertClientCommunicationAllowed } from "../services/clientCommunicationPolicyService.js";
import { requireCommunicationPermission } from "../services/communicationPermissions.js";
import { listAgencyTwilioSmsHistoryForNumber } from "../services/twilioSmsSyncService.js";
import { listTwilioCallableStaff } from "../services/twilioCallService.js";
import { recordActivity } from "../utils/prismaCrud.js";
import {
  applyCallOutcome,
  ensureCallCallbackFollowUp,
  syncCallClientCommunication,
  syncCallLeadActivity,
} from "../services/callHistoryService.js";

const clean = (value, max = 500) => String(value ?? "").trim().slice(0, max);
const callStatuses = new Set(["RINGING", "ANSWERED", "COMPLETED", "MISSED", "FAILED"]);
const callDirections = new Set(["INBOUND", "OUTBOUND"]);
const callResolutions = new Set(["UNRESOLVED", "LINKED_LEAD", "LINKED_CLIENT", "LINKED_APPOINTMENT", "SPAM"]);
export const CALL_BUNDLE_WINDOW_MS = 30 * 60_000;

const callInclude = {
  lead: { select: { id: true, leadNumber: true, firstName: true, lastName: true, phone: true, status: true, stage: true, owner: { select: { id: true, fullName: true } } } },
  client: { select: { id: true, clientNumber: true, fullName: true, phone: true, status: true } },
  case: { select: { id: true, caseType: true, status: true } },
  handledBy: { select: { id: true, fullName: true, email: true } },
  resolvedBy: { select: { id: true, fullName: true } },
  followUp: { select: { id: true, type: true, description: true, dueAt: true, status: true } },
  appointment: {
    select: {
      id: true,
      referenceCode: true,
      subject: true,
      startsAt: true,
      status: true,
      guestName: true,
      assignedTo: { select: { id: true, fullName: true } },
    },
  },
};

function callAccessWhere(req) {
  const scope = portalDataScope(req, "leads");
  if (req.auth.role === "admin" || req.auth.role === "frontdesk" || scope === "all") return {};
  return {
    OR: [
      { AND: [{ handledByUserId: req.auth.userId }, { resolution: "UNRESOLVED" }] },
      { lead: { ownerUserId: req.auth.userId } },
      { lead: { followUps: { some: { assignedUserId: req.auth.userId, status: "PENDING" } } } },
      { client: { assignedUserId: req.auth.userId } },
      { case: { assignedUserId: req.auth.userId } },
      { case: { assignments: { some: { consultantUserId: req.auth.userId, status: "active" } } } },
      { appointment: { assignedToId: req.auth.userId } },
    ],
  };
}

async function requireCall(req, include = callInclude) {
  const item = await prisma.callSession.findFirst({
    where: { id: req.params.id, agencyId: req.auth.agencyId, provider: "TWILIO", ...callAccessWhere(req) },
    ...(include && Object.keys(include).length ? { include } : {}),
  });
  if (!item) throw createHttpError(404, "Call not found.", "CALL_NOT_FOUND");
  return item;
}

function leadName(lead) {
  return [lead.firstName, lead.lastName].filter(Boolean).join(" ") || lead.leadNumber;
}

function dispatchUserId(identity) {
  return clean(identity, 200).replace(/^client:/, "").replace(/^casedesk:/, "");
}

async function addEngagementSummaries(data, agencyId) {
  if (!data.length) return data;
  const parentCallSids = data.map((item) => item.providerCallId).filter(Boolean);
  const dispatches = parentCallSids.length
    ? await prisma.callRingDispatch.findMany({
        where: { agencyId, parentCallSid: { in: parentCallSids } },
        select: { parentCallSid: true, identity: true, status: true },
        orderBy: { createdAt: "asc" },
      })
    : [];
  const userIds = [...new Set(dispatches.map((item) => dispatchUserId(item.identity)).filter(Boolean))];
  const users = userIds.length
    ? await prisma.user.findMany({
        where: { agencyId, id: { in: userIds } },
        select: { id: true, fullName: true },
      })
    : [];
  const usersById = new Map(users.map((user) => [user.id, user]));
  return data.map((call) => {
    if (call.direction === "OUTBOUND") {
      return {
        ...call,
        engagement: {
          label: "Dialed by",
          people: call.handledBy ? [call.handledBy] : [],
          fallback: call.extensionLabel || "Dialer not recorded",
        },
      };
    }

    const callDispatches = dispatches.filter((item) => item.parentCallSid === call.providerCallId);
    const answered = callDispatches.filter((item) => item.status === "answered");
    const relevant = answered.length ? answered : callDispatches;
    const people = [];
    const seen = new Set();
    for (const dispatch of relevant) {
      const user = usersById.get(dispatchUserId(dispatch.identity));
      if (user && !seen.has(user.id)) {
        seen.add(user.id);
        people.push(user);
      }
    }
    if (!callDispatches.length && call.handledBy && call.answeredAt) people.push(call.handledBy);
    const answeredCall = answered.length > 0 || (!callDispatches.length && Boolean(call.handledBy && call.answeredAt));
    // Repair the presentation of older queue calls that Twilio reported as
    // generic `completed` parent legs even though every staff ring attempt
    // ended without an answer. This also makes recordings read as voicemail
    // immediately, without waiting for a destructive data migration.
    const effectiveStatus = call.status === "COMPLETED" && callDispatches.length && !answeredCall ? "MISSED" : call.status;
    return {
      ...call,
      status: effectiveStatus,
      engagement: {
        label: answeredCall ? "Answered by" : effectiveStatus === "RINGING" ? "Ringing" : "Rang",
        people,
        fallback: call.extensionLabel || (answeredCall ? "Answering person not recorded" : "No staff phones recorded"),
      },
    };
  });
}

async function addCallbackSummaries(data, req) {
  const missedCalls = data.filter((call) => call.direction === "INBOUND" && call.status === "MISSED" && call.remoteNumberNormalized);
  if (!missedCalls.length) return data;
  const numbers = [...new Set(missedCalls.map((call) => call.remoteNumberNormalized))];
  const earliestMissedAt = new Date(Math.min(...missedCalls.map((call) => new Date(call.startedAt).getTime())));
  const successfulCallbacks = await prisma.callSession.findMany({
    where: {
      agencyId: req.auth.agencyId,
      provider: "TWILIO",
      direction: "OUTBOUND",
      remoteNumberNormalized: { in: numbers },
      startedAt: { gt: earliestMissedAt },
      AND: [
        callAccessWhere(req),
        { OR: [{ answeredAt: { not: null } }, { status: "COMPLETED", durationSeconds: { gt: 0 } }] },
      ],
    },
    select: {
      id: true,
      remoteNumberNormalized: true,
      startedAt: true,
      handledBy: { select: { id: true, fullName: true } },
    },
    orderBy: { startedAt: "desc" },
  });
  const callbacksByNumber = new Map();
  for (const callback of successfulCallbacks) {
    if (!callbacksByNumber.has(callback.remoteNumberNormalized)) callbacksByNumber.set(callback.remoteNumberNormalized, callback);
  }
  return data.map((call) => {
    if (call.direction !== "INBOUND" || call.status !== "MISSED" || !call.remoteNumberNormalized) return call;
    const callback = callbacksByNumber.get(call.remoteNumberNormalized);
    if (!callback || new Date(callback.startedAt) <= new Date(call.startedAt)) return { ...call, callback: { status: "DUE" } };
    return {
      ...call,
      callback: {
        status: "CONTACTED_BACK",
        callId: callback.id,
        contactedAt: callback.startedAt,
        handledBy: callback.handledBy,
      },
    };
  });
}

async function addMatchSummaries(data, agencyId) {
  const numbers = [...new Set(data.map((item) => item.remoteNumberNormalized).filter(Boolean))];
  if (!numbers.length) return data.map((item) => ({ ...item, matchSummary: { leads: [], clients: [] } }));
  const [leads, clients] = await Promise.all([
    prisma.lead.findMany({
      where: { agencyId, phoneNormalized: { in: numbers }, deletedAt: null },
      select: { id: true, leadNumber: true, firstName: true, lastName: true, phoneNormalized: true, status: true, pipelineSegment: true },
    }),
    prisma.client.findMany({
      where: { agencyId, OR: [{ phoneNormalized: { in: numbers } }, { secondaryPhoneNormalized: { in: numbers } }] },
      select: { id: true, clientNumber: true, fullName: true, phoneNormalized: true, secondaryPhoneNormalized: true, status: true },
    }),
  ]);
  return data.map((item) => ({
    ...item,
    matchSummary: {
      leads: leads.filter((lead) => lead.phoneNormalized === item.remoteNumberNormalized).map((lead) => ({ ...lead, fullName: leadName(lead) })),
      clients: clients.filter((client) => [client.phoneNormalized, client.secondaryPhoneNormalized].includes(item.remoteNumberNormalized)),
    },
  }));
}

function bundleKey(call) {
  // Never merge unidentified/private calls merely because both lack a
  // number. Each remains its own interaction unless a real normalized phone
  // number ties the attempts together.
  return call.remoteNumberNormalized || (call.remoteNumber ? normalizeCommunicationPhone(call.remoteNumber) : "") || `call:${call.id}`;
}

// The list is newest-first. Repeated attempts to/from the same number within
// 30 minutes become one phone-style interaction row while the underlying
// CallSession records remain independent for audit, recordings, and actions.
export function bundleCallsByTime(calls, windowMs = CALL_BUNDLE_WINDOW_MS) {
  const bundles = [];
  const latestBundleByNumber = new Map();
  for (const call of calls) {
    const key = bundleKey(call);
    const startedAtMs = new Date(call.startedAt).getTime();
    const candidate = latestBundleByNumber.get(key);
    const candidateOldestMs = candidate ? new Date(candidate.bundle.firstStartedAt).getTime() : null;
    if (candidate && Number.isFinite(startedAtMs) && candidateOldestMs - startedAtMs <= windowMs) {
      candidate.bundle.attempts.push(call);
      candidate.bundle.attemptCount += 1;
      candidate.bundle.firstStartedAt = call.startedAt;
      candidate.bundle.totalDurationSeconds += Number(call.durationSeconds || 0);
      if (call.resolution === "UNRESOLVED") candidate.bundle.unresolvedCount += 1;
      if (call.followUp?.status === "PENDING") candidate.bundle.pendingFollowUpCount += 1;
      if (call.status === "MISSED" && call.recordingUrl && !call.recordingPlayedAt) candidate.bundle.newVoicemailCount += 1;
      if (call.direction === "INBOUND" && call.status === "MISSED" && call.callback?.status !== "CONTACTED_BACK") candidate.bundle.callbackDueCount += 1;
      if (call.direction === "INBOUND" && call.status === "MISSED" && call.callback?.status === "CONTACTED_BACK") candidate.bundle.contactedBackCount += 1;
      continue;
    }
    const bundle = {
      ...call,
      bundle: {
        attemptCount: 1,
        attempts: [call],
        firstStartedAt: call.startedAt,
        lastStartedAt: call.startedAt,
        totalDurationSeconds: Number(call.durationSeconds || 0),
        unresolvedCount: call.resolution === "UNRESOLVED" ? 1 : 0,
        pendingFollowUpCount: call.followUp?.status === "PENDING" ? 1 : 0,
        newVoicemailCount: call.status === "MISSED" && call.recordingUrl && !call.recordingPlayedAt ? 1 : 0,
        callbackDueCount: call.direction === "INBOUND" && call.status === "MISSED" && call.callback?.status !== "CONTACTED_BACK" ? 1 : 0,
        contactedBackCount: call.direction === "INBOUND" && call.status === "MISSED" && call.callback?.status === "CONTACTED_BACK" ? 1 : 0,
        windowMinutes: Math.round(windowMs / 60_000),
      },
    };
    bundles.push(bundle);
    latestBundleByNumber.set(key, bundle);
  }
  return bundles;
}

export async function listCalls(req, res) {
  const page = Math.max(Number(req.query.page) || 1, 1);
  const limit = Math.min(Math.max(Number(req.query.limit) || 25, 1), 100);
  const status = callStatuses.has(req.query.status) ? req.query.status : null;
  const direction = callDirections.has(req.query.direction) ? req.query.direction : null;
  const resolution = callResolutions.has(req.query.resolution) ? req.query.resolution : null;
  const handledByUserId = clean(req.query.handledByUserId, 100);
  const search = clean(req.query.search, 120);
  const where = {
    agencyId: req.auth.agencyId,
    provider: "TWILIO",
    AND: [
      callAccessWhere(req),
      ...(search ? [{
        OR: [
          { remoteNumber: { contains: search, mode: "insensitive" } },
          { providerCallId: { contains: search, mode: "insensitive" } },
          { extensionLabel: { contains: search, mode: "insensitive" } },
          { lead: { OR: [{ leadNumber: { contains: search, mode: "insensitive" } }, { firstName: { contains: search, mode: "insensitive" } }, { lastName: { contains: search, mode: "insensitive" } }] } },
          { client: { OR: [{ clientNumber: { contains: search, mode: "insensitive" } }, { fullName: { contains: search, mode: "insensitive" } }] } },
        ],
      }] : []),
    ],
    ...(status ? { status } : {}),
    ...(direction ? { direction } : {}),
    ...(resolution ? { resolution } : {}),
    ...(handledByUserId ? { handledByUserId } : {}),
  };
  const [raw, total, unresolved] = await Promise.all([
    // A phone log is chronological by when the call began. lastEventAt can
    // jump much later when a delayed recording/status callback arrives and
    // would break deterministic time bundles.
    prisma.callSession.findMany({ where, include: callInclude, orderBy: { startedAt: "desc" }, skip: (page - 1) * limit, take: limit }),
    prisma.callSession.count({ where }),
    prisma.callSession.count({ where: { agencyId: req.auth.agencyId, provider: "TWILIO", resolution: "UNRESOLVED", ...callAccessWhere(req) } }),
  ]);
  const matched = await addMatchSummaries(raw, req.auth.agencyId);
  const enriched = await addEngagementSummaries(matched, req.auth.agencyId);
  const callbackAware = await addCallbackSummaries(enriched, req);
  const data = bundleCallsByTime(callbackAware);
  res.json({ data, meta: { page, limit, total, unresolved, pageCalls: raw.length, pageInteractions: data.length, hasMore: page * limit < total } });
}

const performanceRangeSince = {
  today: () => { const start = new Date(); start.setHours(0, 0, 0, 0); return start; },
  "7d": () => new Date(Date.now() - 7 * 24 * 60 * 60_000),
  "30d": () => new Date(Date.now() - 30 * 24 * 60 * 60_000),
  all: () => null,
};

// Whoever actually bridged the call — set once from the Twilio dial/queue
// leg (see twilioCallService.js) and never overwritten — so this is a
// reliable "who called/answered" signal, unlike a case's assignedUserId
// which can be reassigned long after the call happened.
export async function listCallPerformance(req, res) {
  if (!["admin", "frontdesk"].includes(req.auth.role)) {
    throw createHttpError(403, "Only administrators and front desk staff can view team call performance.", "FORBIDDEN");
  }
  const range = Object.hasOwn(performanceRangeSince, req.query.range) ? req.query.range : "30d";
  const since = performanceRangeSince[range]();
  const baseWhere = {
    agencyId: req.auth.agencyId,
    provider: "TWILIO",
    handledByUserId: { not: null },
    ...(since ? { startedAt: { gte: since } } : {}),
  };
  const [staff, totals, missed, outbound] = await Promise.all([
    listTwilioCallableStaff(req.auth.agencyId),
    prisma.callSession.groupBy({
      by: ["handledByUserId"],
      where: baseWhere,
      _count: { _all: true },
      _sum: { durationSeconds: true },
      _avg: { durationSeconds: true },
    }),
    prisma.callSession.groupBy({
      by: ["handledByUserId"],
      where: { ...baseWhere, status: { in: ["MISSED", "FAILED"] } },
      _count: { _all: true },
    }),
    prisma.callSession.groupBy({
      by: ["handledByUserId"],
      where: { ...baseWhere, direction: "OUTBOUND" },
      _count: { _all: true },
    }),
  ]);
  const totalsByUser = new Map(totals.map((row) => [row.handledByUserId, row]));
  const missedByUser = new Map(missed.map((row) => [row.handledByUserId, row._count._all]));
  const outboundByUser = new Map(outbound.map((row) => [row.handledByUserId, row._count._all]));
  const staffById = new Map(staff.map((user) => [user.id, user]));
  // Someone who handled calls in this window but is no longer active/callable
  // staff (role changed, left the agency) must still show up — otherwise
  // their historical calls would just vanish from the leaderboard.
  const extraUserIds = [...totalsByUser.keys()].filter((id) => id && !staffById.has(id));
  const extraUsers = extraUserIds.length
    ? await prisma.user.findMany({ where: { id: { in: extraUserIds }, agencyId: req.auth.agencyId }, select: { id: true, fullName: true, role: true } })
    : [];
  const rows = [...staff, ...extraUsers].map((user) => {
    const totalsRow = totalsByUser.get(user.id);
    const totalCalls = totalsRow?._count._all || 0;
    const missedCalls = missedByUser.get(user.id) || 0;
    const outboundCalls = outboundByUser.get(user.id) || 0;
    const answeredCalls = Math.max(totalCalls - missedCalls, 0);
    return {
      user: { id: user.id, fullName: user.fullName, role: user.role },
      totalCalls,
      answeredCalls,
      missedCalls,
      inboundCalls: Math.max(totalCalls - outboundCalls, 0),
      outboundCalls,
      answerRate: totalCalls ? Math.round((answeredCalls / totalCalls) * 100) : null,
      totalTalkTimeSeconds: totalsRow?._sum?.durationSeconds || 0,
      avgCallDurationSeconds: totalsRow?._avg?.durationSeconds != null ? Math.round(totalsRow._avg.durationSeconds) : null,
    };
  }).sort((a, b) => b.totalCalls - a.totalCalls);
  res.json({ data: rows, meta: { range, since } });
}

export async function getCall(req, res) {
  const enriched = await addEngagementSummaries([await requireCall(req)], req.auth.agencyId);
  const [data] = await addCallbackSummaries(enriched, req);
  res.json({ data });
}

export async function listCallContactHistory(req, res) {
  const anchor = await requireCall(req);
  const normalized = anchor.remoteNumberNormalized || normalizeCommunicationPhone(anchor.remoteNumber);
  if (!normalized) {
    const [data] = await addEngagementSummaries([anchor], req.auth.agencyId);
    return res.json({ data: [data], meta: { total: 1, truncated: false } });
  }
  const limit = Math.min(Math.max(Number(req.query.limit) || 100, 1), 100);
  const where = {
    agencyId: req.auth.agencyId,
    provider: "TWILIO",
    remoteNumberNormalized: normalized,
    AND: [callAccessWhere(req)],
  };
  const [raw, total] = await Promise.all([
    prisma.callSession.findMany({ where, include: callInclude, orderBy: { startedAt: "desc" }, take: limit }),
    prisma.callSession.count({ where }),
  ]);
  const matched = await addMatchSummaries(raw, req.auth.agencyId);
  const enriched = await addEngagementSummaries(matched, req.auth.agencyId);
  const data = await addCallbackSummaries(enriched, req);
  return res.json({ data, meta: { total, truncated: total > data.length } });
}

// Twilio's recording media URL requires the account's own credentials to
// fetch (it 401s otherwise), so the frontend can't just point an <audio>
// tag at call.recordingUrl directly — this proxies the bytes through
// CaseDesk's own auth instead, the same access-checked path as every other
// call action, so a one-click player works without ever handing the raw
// Twilio URL (or Twilio credentials) to the browser.
export async function streamCallRecording(req, res) {
  const call = await requireCall(req, {});
  if (!call.recordingUrl) throw createHttpError(404, "No recording is available for this call.", "RECORDING_NOT_FOUND");
  const settings = await prisma.agencyTwilioSettings.findUnique({ where: { agencyId: req.auth.agencyId }, select: { accountSid: true, authTokenEncrypted: true } });
  if (!settings?.accountSid || !settings?.authTokenEncrypted) throw createHttpError(409, "Twilio is not connected for this workspace.");
  const auth = Buffer.from(`${settings.accountSid}:${decryptSecret(settings.authTokenEncrypted)}`).toString("base64");
  const response = await fetch(call.recordingUrl, { headers: { Authorization: `Basic ${auth}` } });
  if (!response.ok) throw createHttpError(502, "The recording could not be retrieved from Twilio.");
  res.set("Cache-Control", "private, max-age=3600");
  res.type(response.headers.get("content-type") || "audio/mpeg");
  res.send(Buffer.from(await response.arrayBuffer()));
}

export async function markCallRecordingPlayed(req, res) {
  const call = await requireCall(req, {});
  if (!call.recordingUrl) throw createHttpError(404, "No recording is available for this call.", "RECORDING_NOT_FOUND");
  const playedAt = call.recordingPlayedAt || new Date();
  if (!call.recordingPlayedAt) {
    await prisma.callSession.updateMany({
      where: { id: call.id, agencyId: req.auth.agencyId, recordingPlayedAt: null },
      data: { recordingPlayedAt: playedAt },
    });
  }
  res.json({ data: { id: call.id, recordingPlayedAt: playedAt } });
}

export async function getCallSmsOptions(req, res) {
  await requireCommunicationPermission(req, "canSendSms");
  const call = await requireCall(req);
  const destination = normalizeCommunicationPhone(call.remoteNumberNormalized || call.remoteNumber);
  if (!destination) throw createHttpError(400, "This call does not have a valid mobile number.", "INVALID_SMS_DESTINATION");
  const options = await agencyTwilioSmsSendingOptions(req.auth.agencyId);
  res.json({ data: { ...options, destination } });
}

export async function getCallSmsThread(req, res) {
  await requireCommunicationPermission(req, "canView");
  const call = await requireCall(req);
  if (!call.clientId) {
    const messages = await listAgencyTwilioSmsHistoryForNumber(
      req.auth.agencyId,
      call.remoteNumberNormalized || call.remoteNumber,
    );
    return res.json({
      data: {
        matched: false,
        client: null,
        conversation: null,
        messages,
      },
    });
  }

  const conversation = await prisma.communicationConversation.findFirst({
    where: {
      agencyId: req.auth.agencyId,
      clientId: call.clientId,
      channel: "Sms",
      deletedAt: null,
    },
    orderBy: [{ lastMessageAt: "desc" }, { createdAt: "desc" }],
    select: {
      id: true,
      state: true,
      lastMessageAt: true,
      client: { select: { id: true, fullName: true, clientNumber: true, phone: true } },
    },
  });
  if (!conversation) {
    return res.json({
      data: {
        matched: true,
        client: call.client,
        conversation: null,
        messages: [],
      },
    });
  }

  const recentMessages = await prisma.communicationMessage.findMany({
    where: {
      agencyId: req.auth.agencyId,
      conversationId: conversation.id,
      channel: "Sms",
      deletedAt: null,
    },
    orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
    take: 200,
    select: {
      id: true,
      direction: true,
      status: true,
      bodyText: true,
      occurredAt: true,
      sentAt: true,
      deliveredAt: true,
      failedAt: true,
      failureReason: true,
      senderUser: { select: { id: true, fullName: true } },
    },
  });
  return res.json({
    data: {
      matched: true,
      client: conversation.client,
      conversation: {
        id: conversation.id,
        state: conversation.state,
        lastMessageAt: conversation.lastMessageAt,
      },
      messages: recentMessages.reverse(),
    },
  });
}

async function recordClientSms(call, { agencyId, userId, to, from, body, idempotencyKey, providerMessageId }) {
  if (!call.clientId) return null;
  const now = new Date();
  return prisma.$transaction(async (tx) => {
    let conversation = await tx.communicationConversation.findFirst({
      where: {
        agencyId,
        clientId: call.clientId,
        channel: "Sms",
        state: { not: "Closed" },
        deletedAt: null,
      },
      orderBy: { lastMessageAt: "desc" },
    });
    if (!conversation) {
      conversation = await tx.communicationConversation.create({
        data: {
          agencyId,
          clientId: call.clientId,
          caseId: call.caseId || null,
          channel: "Sms",
          provider: "Twilio",
          assignedToId: userId,
          state: "WaitingOnClient",
          lastMessageAt: now,
          lastOutboundAt: now,
          createdById: userId,
        },
      });
    }
    const message = await tx.communicationMessage.create({
      data: {
        agencyId,
        clientId: call.clientId,
        caseId: call.caseId || null,
        conversationId: conversation.id,
        channel: "Sms",
        direction: "Outbound",
        status: "Sent",
        senderUserId: userId,
        senderAddress: from,
        recipients: [to],
        bodyText: body,
        provider: "Twilio",
        providerMessageId,
        idempotencyKey,
        occurredAt: now,
        sentAt: now,
        metadata: { callHistoryId: call.id },
      },
    });
    await Promise.all([
      tx.communicationConversation.update({
        where: { id: conversation.id },
        data: { state: "WaitingOnClient", lastMessageAt: now, lastOutboundAt: now, isArchived: false },
      }),
      tx.communicationDeliveryEvent.create({
        data: { agencyId, messageId: message.id, type: "ProviderAccepted", details: "SMS accepted by Twilio" },
      }),
    ]);
    return message;
  });
}

export async function sendCallSms(req, res) {
  await requireCommunicationPermission(req, "canSendSms");
  const call = await requireCall(req);
  const body = clean(req.body.body, 1600);
  const destination = normalizeCommunicationPhone(call.remoteNumberNormalized || call.remoteNumber);
  if (!destination) throw createHttpError(400, "This call does not have a valid mobile number.", "INVALID_SMS_DESTINATION");
  if (!body) throw createHttpError(400, "Enter a message before sending.", "SMS_BODY_REQUIRED");

  if (call.clientId) {
    const policy = await assertClientCommunicationAllowed({ agencyId: req.auth.agencyId, clientId: call.clientId, channel: "Sms" });
    if (!policy.allowed) throw createHttpError(409, "SMS is disabled by the workspace policy or this client's communication preferences.", "SMS_NOT_ALLOWED");
  }

  const options = await agencyTwilioSmsSendingOptions(req.auth.agencyId);
  const requestedFrom = normalizeCommunicationPhone(req.body.fromNumber);
  const fromNumber = requestedFrom || options.defaultNumber;
  if (!fromNumber) throw createHttpError(400, "Choose which calling number should send this SMS.", "SMS_SENDER_REQUIRED");
  if (!options.numbers.some((number) => number.phoneNumber === fromNumber)) {
    throw createHttpError(400, "Choose one of this workspace's active calling numbers.", "INVALID_SMS_SENDER");
  }
  const idempotencyKey = clean(req.body.idempotencyKey, 200) || null;
  if (idempotencyKey && call.clientId) {
    const duplicate = await prisma.communicationMessage.findFirst({
      where: { agencyId: req.auth.agencyId, idempotencyKey },
      select: { id: true, providerMessageId: true, senderAddress: true, recipients: true, sentAt: true },
    });
    if (duplicate) return res.json({ data: { ...duplicate, duplicate: true } });
  }

  const result = await sendAgencyTwilioSms({
    agencyId: req.auth.agencyId,
    to: destination,
    body,
    fromNumber,
    idempotencyKey,
  });
  const recorded = await recordClientSms(call, {
    agencyId: req.auth.agencyId,
    userId: req.auth.userId,
    to: destination,
    from: fromNumber,
    body,
    idempotencyKey,
    providerMessageId: result.id,
  });
  await recordActivity({
    agencyId: req.auth.agencyId,
    userId: req.auth.userId,
    clientId: call.clientId || null,
    caseId: call.caseId || null,
    action: "call_history.sms_sent",
    details: `SMS sent from ${fromNumber} to ${destination}`,
  });
  res.status(201).json({ data: { id: recorded?.id || result.id, providerMessageId: result.id, fromNumber, to: destination, status: result.response?.status || "accepted" } });
}

export async function listCallCandidates(req, res) {
  await requireCall(req, {});
  const search = clean(req.query.search, 120);
  const digits = search.replace(/\D/g, "");
  const leadScope = req.auth.role === "admin" || req.auth.role === "frontdesk" ? {} : leadAccessWhere(req);
  const clientScope = req.auth.role === "admin" || req.auth.role === "frontdesk" ? {} : clientAccessWhere(req);
  const [leads, clients] = await Promise.all([
    prisma.lead.findMany({
      where: {
        agencyId: req.auth.agencyId,
        deletedAt: null,
        AND: [leadScope, ...(search ? [{ OR: [{ leadNumber: { contains: search, mode: "insensitive" } }, { firstName: { contains: search, mode: "insensitive" } }, { lastName: { contains: search, mode: "insensitive" } }, { phone: { contains: digits || search, mode: "insensitive" } }, { email: { contains: search, mode: "insensitive" } }] }] : [])],
      },
      select: { id: true, leadNumber: true, firstName: true, lastName: true, phone: true, email: true, status: true, stage: true },
      orderBy: { updatedAt: "desc" },
      take: 12,
    }),
    prisma.client.findMany({
      where: {
        agencyId: req.auth.agencyId,
        AND: [clientScope, ...(search ? [{ OR: [{ clientNumber: { contains: search, mode: "insensitive" } }, { fullName: { contains: search, mode: "insensitive" } }, { phone: { contains: digits || search, mode: "insensitive" } }, { secondaryPhone: { contains: digits || search, mode: "insensitive" } }, { phoneNormalized: { contains: digits || search } }, { secondaryPhoneNormalized: { contains: digits || search } }, { email: { contains: search, mode: "insensitive" } }] }] : [])],
      },
      select: { id: true, clientNumber: true, fullName: true, phone: true, secondaryPhone: true, email: true, status: true },
      orderBy: { updatedAt: "desc" },
      take: 12,
    }),
  ]);
  res.json({ data: { leads: leads.map((lead) => ({ ...lead, fullName: leadName(lead) })), clients } });
}

export async function linkCallToLead(req, res) {
  const call = await requireCall(req, {});
  const lead = await prisma.lead.findFirst({
    where: { id: clean(req.body.leadId, 100), agencyId: req.auth.agencyId, deletedAt: null, ...(req.auth.role === "admin" || req.auth.role === "frontdesk" ? {} : leadAccessWhere(req)) },
    select: { id: true },
  });
  if (!lead) throw createHttpError(404, "Lead not found or not available to you.", "LEAD_NOT_FOUND");
  const data = await prisma.callSession.update({
    where: { id: call.id },
    data: { leadId: lead.id, clientId: null, caseId: null, resolution: "LINKED_LEAD", resolvedAt: new Date(), resolvedById: req.auth.userId },
    include: callInclude,
  });
  await syncCallLeadActivity(call.id);
  await ensureCallCallbackFollowUp(call.id);
  res.json({ data });
}

export async function linkCallToClient(req, res) {
  const call = await requireCall(req, {});
  const scope = req.auth.role === "admin" || req.auth.role === "frontdesk" ? {} : clientAccessWhere(req);
  const client = await prisma.client.findFirst({
    where: { id: clean(req.body.clientId, 100), agencyId: req.auth.agencyId, ...scope },
    select: { id: true, assignedUserId: true },
  });
  if (!client) throw createHttpError(404, "Client not found or not available to you.", "CLIENT_NOT_FOUND");
  const caseItem = await prisma.case.findFirst({
    where: { agencyId: req.auth.agencyId, clientId: client.id, deletedAt: null },
    orderBy: { updatedAt: "desc" },
    select: { id: true, assignedUserId: true },
  });
  const data = await prisma.callSession.update({
    where: { id: call.id },
    data: { clientId: client.id, caseId: caseItem?.id || null, leadId: null, followUpId: null, resolution: "LINKED_CLIENT", resolvedAt: new Date(), resolvedById: req.auth.userId, handledByUserId: call.handledByUserId || caseItem?.assignedUserId || client.assignedUserId || null },
    include: callInclude,
  });
  await syncCallClientCommunication(call.id);
  res.json({ data });
}

export async function linkCallToAppointment(req, res) {
  const call = await requireCall(req, {});
  const appointment = await prisma.appointment.findFirst({
    where: {
      id: clean(req.body.appointmentId, 100),
      agencyId: req.auth.agencyId,
    },
    select: {
      id: true,
      clientId: true,
      caseId: true,
      leadId: true,
      assignedToId: true,
    },
  });
  if (!appointment) throw createHttpError(404, "Booking not found.", "APPOINTMENT_NOT_FOUND");

  const resolution = appointment.clientId
    ? "LINKED_CLIENT"
    : appointment.leadId
      ? "LINKED_LEAD"
      : call.resolution === "UNRESOLVED"
        ? "LINKED_APPOINTMENT"
        : call.resolution;
  const data = await prisma.callSession.update({
    where: { id: call.id },
    data: {
      appointmentId: appointment.id,
      ...(appointment.clientId
        ? { clientId: appointment.clientId, leadId: null, caseId: appointment.caseId || null }
        : appointment.leadId
          ? { leadId: appointment.leadId, clientId: null, caseId: null }
          : {}),
      resolution,
      resolvedAt: new Date(),
      resolvedById: req.auth.userId,
      handledByUserId: call.handledByUserId || appointment.assignedToId || null,
    },
    include: callInclude,
  });
  if (appointment.clientId) await syncCallClientCommunication(call.id);
  if (appointment.leadId) await syncCallLeadActivity(call.id);
  res.json({ data });
}

export async function createLeadFromCall(req, res) {
  const call = await requireCall(req, {});
  if (!call.remoteNumberNormalized) throw createHttpError(400, "A valid caller phone number is required before creating a lead.", "INVALID_CALLER_PHONE");
  const sourceDefinition = DEFAULT_LEAD_SOURCES.find(([, type]) => type === "PHONE") || ["Phone", "PHONE"];
  await prisma.leadSource.createMany({ data: [{ agencyId: req.auth.agencyId, name: sourceDefinition[0], type: sourceDefinition[1] }], skipDuplicates: true });
  const source = await prisma.leadSource.findFirst({ where: { agencyId: req.auth.agencyId, type: "PHONE", isActive: true }, orderBy: { createdAt: "asc" } });
  if (!source) throw createHttpError(409, "The phone lead source is unavailable.", "PHONE_SOURCE_UNAVAILABLE");
  const ownerUserId = clean(req.body.ownerUserId, 100) || call.handledByUserId || req.auth.userId;
  const nextActionAt = new Date(Date.now() + 15 * 60_000);
  const lead = await createLeadRecord({
    auth: req.auth,
    body: {
      firstName: clean(req.body.firstName, 100) || null,
      lastName: clean(req.body.lastName, 100) || null,
      phone: call.remoteNumberNormalized,
      email: clean(req.body.email, 320) || null,
      ownerUserId,
      originalSourceId: source.id,
      immigrationInterest: clean(req.body.immigrationInterest, 150) || null,
      initialMessage: clean(req.body.initialMessage, 5000) || `Inbound phone call received ${call.startedAt.toISOString()}`,
      priority: clean(req.body.priority, 20) || (call.status === "MISSED" ? "HIGH" : "NORMAL"),
      temperature: "WARM",
      nextActionType: "PHONE_CALL",
      nextActionDescription: `Return phone call to ${call.remoteNumberNormalized}`,
      nextActionAt: nextActionAt.toISOString(),
      nextActionOwnerId: ownerUserId,
      firstContactDueAt: nextActionAt.toISOString(),
    },
  });
  await prisma.callSession.update({
    where: { id: call.id },
    data: { leadId: lead.id, clientId: null, caseId: null, resolution: "LINKED_LEAD", resolvedAt: new Date(), resolvedById: req.auth.userId, handledByUserId: call.handledByUserId || ownerUserId },
  });
  await syncCallLeadActivity(call.id);
  await ensureCallCallbackFollowUp(call.id);
  res.status(201).json({ data: { lead, call: await prisma.callSession.findUnique({ where: { id: call.id }, include: callInclude }) } });
}

export async function markCallSpam(req, res) {
  if (!["admin", "frontdesk"].includes(req.auth.role)) throw createHttpError(403, "Only administrators and front desk staff can mark calls as spam.", "FORBIDDEN");
  const call = await requireCall(req, {});
  const data = await prisma.callSession.update({
    where: { id: call.id },
    data: { resolution: "SPAM", resolvedAt: new Date(), resolvedById: req.auth.userId, leadId: null, clientId: null, caseId: null, appointmentId: null, followUpId: null, outcomeNotes: clean(req.body.notes, 1000) || "Marked as spam" },
    include: callInclude,
  });
  res.json({ data });
}

export async function recordCallOutcome(req, res) {
  const call = await requireCall(req, {});
  await applyCallOutcome(call, req.body, { agencyId: req.auth.agencyId, userId: req.auth.userId });
  res.json({ data: await prisma.callSession.findUnique({ where: { id: call.id }, include: callInclude }) });
}
