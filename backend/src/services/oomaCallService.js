import { createHash } from "node:crypto";
import prisma from "./prisma/client.js";
import { normalizeCommunicationPhone } from "./communicationAddressService.js";
import { createHttpError } from "../utils/http.js";
import { adminRecipientIds, notifyUsers } from "./notificationService.js";

const clean = (value, max = 500) => String(value ?? "").trim().slice(0, max);
const object = (value) => value && typeof value === "object" && !Array.isArray(value) ? value : {};
const first = (...values) => values.find((value) => clean(value)) ?? null;
const number = (value) => {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.round(parsed)) : null;
};
const date = (value, fallback = null) => {
  const parsed = value ? new Date(value) : null;
  return parsed && !Number.isNaN(parsed.getTime()) ? parsed : fallback;
};
const httpsUrl = (value) => {
  try {
    const parsed = new URL(clean(value, 2000));
    return parsed.protocol === "https:" ? parsed.toString() : null;
  } catch {
    return null;
  }
};

function normalizedEventName(payload) {
  return clean(first(payload.event, payload.type, payload.status, payload.eventType), 100)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
}

export function isOomaCallPayload(payload = {}) {
  const nested = object(payload.data);
  const channel = clean(first(payload.channel, nested.channel), 30).toLowerCase();
  const eventName = normalizedEventName(payload);
  if (channel === "sms" || eventName.includes("sms") || eventName.includes("message")) return false;
  if (channel === "call" || eventName.includes("call")) return true;
  const callId = first(payload.callId, payload.call_id, payload.providerCallId, nested.callId, nested.call_id);
  return Boolean(callId && ["ringing", "answered", "connected", "ended", "completed", "disconnected", "missed", "failed", "recording"].some((part) => eventName.includes(part)));
}

function eventType(eventName, disposition) {
  const outcome = clean(disposition).toLowerCase();
  if (eventName.includes("recording")) return "RECORDING_AVAILABLE";
  if (eventName.includes("ended") || eventName.includes("completed") || eventName.includes("disconnect")) {
    if (["missed", "no_answer", "no answer"].some((part) => outcome.includes(part))) return "MISSED";
    return "ENDED";
  }
  if (eventName.includes("missed") || outcome.includes("missed") || outcome.includes("no_answer") || outcome.includes("no answer")) return "MISSED";
  if (eventName.includes("answer") || eventName.includes("connected")) return "ANSWERED";
  if (eventName.includes("failed") || outcome.includes("busy") || outcome.includes("declined")) return "FAILED";
  return "STARTED";
}

function callStatus(type, disposition) {
  const value = clean(disposition).toLowerCase().replace(/[^a-z0-9]+/g, "_");
  if (type === "RECORDING_AVAILABLE") return null;
  if (type === "MISSED") return "MISSED";
  if (type === "FAILED") return "FAILED";
  if (type === "ANSWERED") return "ANSWERED";
  if (type === "ENDED") {
    if (["missed", "no_answer", "busy", "declined", "abandoned", "failed"].some((part) => value.includes(part))) return value === "missed" ? "MISSED" : "FAILED";
    return "COMPLETED";
  }
  return "RINGING";
}

function callDirection(payload, eventName) {
  const nested = object(payload.data);
  const supplied = clean(first(payload.direction, payload.callDirection, payload.call_direction, nested.direction), 30).toLowerCase();
  if (supplied.includes("out")) return "OUTBOUND";
  if (supplied.includes("in")) return "INBOUND";
  return eventName.includes("outgoing") || eventName.includes("outbound") ? "OUTBOUND" : "INBOUND";
}

export function normalizeOomaCallPayload(payload = {}, settings = {}) {
  const nested = object(payload.data);
  const eventName = normalizedEventName(payload);
  const direction = callDirection(payload, eventName);
  const disposition = first(payload.disposition, payload.callDisposition, payload.result, nested.disposition, nested.result);
  const type = eventType(eventName, disposition);
  const providerCallId = clean(first(
    payload.callId,
    payload.call_id,
    payload.providerCallId,
    payload.providerMessageId,
    nested.callId,
    nested.call_id,
    nested.id,
  ), 300);
  const explicitRemote = first(
    payload.remoteNumber,
    payload.remote_number,
    payload.contactNumber,
    payload.contact_number,
    payload.callerNumber,
    payload.caller_number,
    nested.remoteNumber,
    nested.remote_number,
    nested.contactNumber,
    nested.callerNumber,
  );
  const from = first(payload.from, payload.fromNumber, payload.from_number, nested.from, nested.fromNumber);
  const to = first(payload.to, payload.toNumber, payload.to_number, nested.to, nested.toNumber);
  const remoteNumber = clean(explicitRemote || (direction === "OUTBOUND" ? to : from), 80) || null;
  const businessNumber = clean(first(
    payload.businessNumber,
    payload.business_number,
    payload.companyNumber,
    nested.businessNumber,
    direction === "OUTBOUND" ? from : to,
    settings.fromNumber,
  ), 80) || null;
  const timestampSource = first(
    payload.occurredAt,
    payload.timestamp,
    payload.eventTimestamp,
    payload.event_timestamp,
    nested.occurredAt,
    nested.timestamp,
  );
  const occurredAt = date(timestampSource, new Date());
  const startedAt = date(first(payload.startedAt, payload.startTime, payload.start_time, nested.startedAt, nested.startTime), occurredAt);
  const answeredAt = type === "ANSWERED"
    ? date(first(payload.answeredAt, payload.answerTime, nested.answeredAt), occurredAt)
    : date(first(payload.answeredAt, payload.answerTime, nested.answeredAt));
  const endedAt = ["ENDED", "MISSED", "FAILED"].includes(type)
    ? date(first(payload.endedAt, payload.endTime, payload.end_time, nested.endedAt, nested.endTime), occurredAt)
    : date(first(payload.endedAt, payload.endTime, payload.end_time, nested.endedAt, nested.endTime));
  const durationSeconds = number(first(payload.durationSeconds, payload.duration_seconds, payload.duration, nested.durationSeconds, nested.duration));
  const recordingUrl = httpsUrl(first(payload.recordingUrl, payload.recording_url, payload.callRecordingUrl, nested.recordingUrl));
  const transcript = clean(first(payload.transcript, payload.callTranscript, payload.voicemailTranscript, nested.transcript), 50000) || null;
  const staffEmail = clean(first(payload.staffEmail, payload.userEmail, payload.extensionEmail, payload.agentEmail, nested.staffEmail, nested.userEmail, nested.agentEmail), 320).toLowerCase() || null;
  const extensionLabel = clean(first(payload.extensionLabel, payload.extension, payload.extensionName, payload.userName, payload.agentName, nested.extension, nested.extensionName, nested.userName), 200) || null;
  const explicitEventId = clean(first(payload.providerEventId, payload.eventId, payload.event_id, nested.eventId, nested.event_id), 300);
  const signature = [providerCallId, type, timestampSource || "", direction, remoteNumber || "", durationSeconds ?? "", disposition || "", recordingUrl || ""].join("|");
  const providerEventId = explicitEventId || createHash("sha256").update(signature).digest("hex");
  return {
    providerCallId,
    providerEventId,
    eventType: type,
    eventName,
    direction,
    status: callStatus(type, disposition),
    remoteNumber,
    remoteNumberNormalized: normalizeCommunicationPhone(remoteNumber),
    businessNumber,
    disposition: clean(disposition, 120) || null,
    occurredAt,
    startedAt,
    answeredAt,
    endedAt,
    durationSeconds,
    recordingUrl,
    transcript,
    staffEmail,
    extensionLabel,
  };
}

async function findHandledBy(tx, agencyId, normalized) {
  if (!normalized.staffEmail) return null;
  return tx.user.findFirst({
    where: { agencyId, email: { equals: normalized.staffEmail, mode: "insensitive" }, status: "active" },
    select: { id: true },
  });
}

export async function phoneMatches(tx, agencyId, normalizedPhone, rawPhone = null) {
  if (!normalizedPhone) return { clients: [], leads: [] };
  const phoneWhere = [
    { phoneNormalized: normalizedPhone },
    ...(rawPhone ? [{ phone: { equals: rawPhone, mode: "insensitive" } }] : []),
  ];
  const [clients, leads] = await Promise.all([
    tx.client.findMany({
      where: { agencyId, OR: phoneWhere },
      select: { id: true, assignedUserId: true },
      take: 3,
    }),
    tx.lead.findMany({
      where: { agencyId, OR: phoneWhere, deletedAt: null },
      select: { id: true, ownerUserId: true, status: true, pipelineSegment: true },
      take: 3,
    }),
  ]);
  return { clients, leads };
}

export async function autoMatch(tx, session) {
  if (session.resolution !== "UNRESOLVED" || !session.remoteNumberNormalized) return session;
  const matches = await phoneMatches(tx, session.agencyId, session.remoteNumberNormalized, session.remoteNumber);
  if (matches.clients.length === 1) {
    const client = matches.clients[0];
    const caseItem = await tx.case.findFirst({
      where: { agencyId: session.agencyId, clientId: client.id, deletedAt: null },
      orderBy: [{ status: "asc" }, { updatedAt: "desc" }],
      select: { id: true, assignedUserId: true },
    });
    return tx.oomaCallSession.update({
      where: { id: session.id },
      data: {
        clientId: client.id,
        caseId: caseItem?.id || null,
        resolution: "LINKED_CLIENT",
        resolvedAt: new Date(),
        handledByUserId: session.handledByUserId || caseItem?.assignedUserId || client.assignedUserId || null,
      },
    });
  }
  if (!matches.clients.length && matches.leads.length === 1) {
    const lead = matches.leads[0];
    return tx.oomaCallSession.update({
      where: { id: session.id },
      data: {
        leadId: lead.id,
        resolution: "LINKED_LEAD",
        resolvedAt: new Date(),
        handledByUserId: session.handledByUserId || lead.ownerUserId,
      },
    });
  }
  return session;
}

function activityPresentation(session) {
  if (session.direction === "OUTBOUND") {
    return { activityType: "OUTGOING_CALL", direction: "OUTBOUND", title: "Outgoing Ooma call" };
  }
  if (["MISSED", "FAILED"].includes(session.status)) {
    return { activityType: "MISSED_CALL", direction: "INBOUND", title: "Missed Ooma call" };
  }
  return { activityType: "INCOMING_CALL", direction: "INBOUND", title: "Incoming Ooma call" };
}

export async function syncOomaLeadActivity(callSessionId, db = prisma) {
  return db.$transaction(async (tx) => {
    const session = await tx.oomaCallSession.findUnique({ where: { id: callSessionId }, include: { lead: true } });
    if (!session?.lead) return null;
    const presentation = activityPresentation(session);
    const externalId = `ooma-call:${session.providerCallId}`;
    const metadata = {
      callSessionId: session.id,
      providerCallId: session.providerCallId,
      status: session.status,
      remoteNumber: session.remoteNumber,
      recordingUrl: session.recordingUrl,
      extensionLabel: session.extensionLabel,
    };
    const existing = await tx.leadActivity.findFirst({ where: { agencyId: session.agencyId, leadId: session.leadId, externalId } });
    const activityData = {
      ...presentation,
      channel: "OOMA",
      outcome: session.disposition || session.status,
      description: session.outcomeNotes || (session.durationSeconds != null ? `${session.durationSeconds} seconds` : null),
      durationSeconds: session.durationSeconds,
      performedById: session.handledByUserId,
      externalId,
      metadata,
      occurredAt: session.startedAt,
    };
    const activity = existing
      ? await tx.leadActivity.update({ where: { id: existing.id }, data: activityData })
      : await tx.leadActivity.create({ data: { agencyId: session.agencyId, leadId: session.leadId, ...activityData } });
    if (!existing) {
      await tx.activityLog.create({
        data: {
          agencyId: session.agencyId,
          userId: session.handledByUserId,
          action: "lead.contact_recorded",
          details: `${session.lead.leadNumber}: ${presentation.title}`,
          entityType: "lead",
          entityId: session.leadId,
          metadata: { activityId: activity.id, activityType: presentation.activityType, oomaCallSessionId: session.id },
        },
      });
    }
    const connected = Boolean(session.answeredAt || (session.status === "COMPLETED" && (session.durationSeconds || 0) > 0));
    const stageOrder = ["NEW", "ASSIGNED", "CONTACTING", "CONNECTED", "QUALIFIED", "CONSULTATION_BOOKED", "CONSULTATION_COMPLETED", "RETAINER_PENDING", "PAYMENT_PENDING", "READY_TO_CONVERT"];
    const nextStage = connected && stageOrder.indexOf(session.lead.stage) < stageOrder.indexOf("CONNECTED")
      ? "CONNECTED"
      : ["RINGING", "MISSED", "FAILED", "COMPLETED"].includes(session.status) && ["NEW", "ASSIGNED"].includes(session.lead.stage)
        ? "CONTACTING"
        : session.lead.stage;
    await tx.lead.update({
      where: { id: session.lead.id },
      data: {
        firstContactAt: session.lead.firstContactAt || session.startedAt,
        lastContactAt: session.endedAt || session.lastEventAt,
        ...(connected ? { firstConnectedAt: session.lead.firstConnectedAt || session.answeredAt || session.lastEventAt } : {}),
        ...(nextStage !== session.lead.stage ? { stage: nextStage } : {}),
        version: { increment: 1 },
      },
    });
    if (nextStage !== session.lead.stage) {
      await tx.leadStageHistory.create({
        data: { agencyId: session.agencyId, leadId: session.lead.id, previousStage: session.lead.stage, newStage: nextStage, changedById: session.handledByUserId, reason: "Ooma call activity" },
      });
    }
    return activity;
  });
}

function communicationStatus(session) {
  if (session.status === "MISSED") return "Missed";
  if (session.status === "FAILED") return "Failed";
  if (session.status === "COMPLETED") return "Completed";
  return session.direction === "INBOUND" ? "Received" : "Sent";
}

export async function syncOomaClientCommunication(callSessionId, db = prisma) {
  return db.$transaction(async (tx) => {
    const session = await tx.oomaCallSession.findUnique({ where: { id: callSessionId }, include: { client: true, case: true } });
    if (!session?.client) return null;
    let message = await tx.communicationMessage.findFirst({
      where: { agencyId: session.agencyId, provider: "Ooma", providerMessageId: session.providerCallId },
    });
    if (message) {
      return tx.communicationMessage.update({
        where: { id: message.id },
        data: {
          status: communicationStatus(session),
          durationSeconds: session.durationSeconds,
          callDisposition: session.disposition || session.status,
          callRecordingUrl: session.recordingUrl,
          callTranscript: session.transcript,
          bodyText: session.outcomeNotes || message.bodyText,
          metadata: { oomaCallSessionId: session.id, extensionLabel: session.extensionLabel },
        },
      });
    }
    const fallbackUser = await tx.user.findFirst({
      where: { agencyId: session.agencyId, status: "active" },
      orderBy: [{ role: "asc" }, { createdAt: "asc" }],
      select: { id: true },
    });
    const ownerId = session.handledByUserId || session.case?.assignedUserId || session.client.assignedUserId || fallbackUser?.id;
    if (!ownerId) return null;
    let conversation = await tx.communicationConversation.findFirst({
      where: { agencyId: session.agencyId, clientId: session.clientId, caseId: session.caseId, channel: "Call", state: { not: "Closed" }, deletedAt: null },
      orderBy: { lastMessageAt: "desc" },
    });
    let conversationWasCreated = false;
    if (!conversation) {
      conversationWasCreated = true;
      conversation = await tx.communicationConversation.create({
        data: {
          agencyId: session.agencyId,
          clientId: session.clientId,
          caseId: session.caseId,
          channel: "Call",
          subject: "Ooma phone calls",
          provider: "Ooma",
          assignedToId: ownerId,
          state: session.direction === "INBOUND" ? "WaitingOnAgency" : "WaitingOnClient",
          unreadCount: session.direction === "INBOUND" ? 1 : 0,
          lastMessageAt: session.startedAt,
          firstInboundAt: session.direction === "INBOUND" ? session.startedAt : null,
          lastInboundAt: session.direction === "INBOUND" ? session.startedAt : null,
          lastOutboundAt: session.direction === "OUTBOUND" ? session.startedAt : null,
          createdById: ownerId,
        },
      });
    }
    message = await tx.communicationMessage.create({
      data: {
        agencyId: session.agencyId,
        clientId: session.clientId,
        caseId: session.caseId,
        conversationId: conversation.id,
        channel: "Call",
        direction: session.direction === "INBOUND" ? "Inbound" : "Outbound",
        status: communicationStatus(session),
        senderUserId: session.direction === "OUTBOUND" ? session.handledByUserId : null,
        senderAddress: session.direction === "INBOUND" ? session.remoteNumber : session.businessNumber,
        recipients: [session.direction === "INBOUND" ? session.businessNumber : session.remoteNumber].filter(Boolean),
        subject: session.direction === "INBOUND" ? "Incoming Ooma call" : "Outgoing Ooma call",
        bodyText: session.outcomeNotes,
        provider: "Ooma",
        providerMessageId: session.providerCallId,
        occurredAt: session.startedAt,
        durationSeconds: session.durationSeconds,
        callDisposition: session.disposition || session.status,
        callRecordingUrl: session.recordingUrl,
        callTranscript: session.transcript,
        metadata: { oomaCallSessionId: session.id, extensionLabel: session.extensionLabel },
        isRead: session.direction === "OUTBOUND",
      },
    });
    await tx.activityLog.create({
      data: {
        agencyId: session.agencyId,
        userId: session.handledByUserId,
        clientId: session.clientId,
        caseId: session.caseId,
        action: "communication.call_recorded",
        details: `${session.direction === "INBOUND" ? "Incoming" : "Outgoing"} Ooma call ${session.remoteNumber ? `with ${session.remoteNumber}` : "with an unidentified number"}`,
        entityType: "communication_message",
        entityId: message.id,
        metadata: { oomaCallSessionId: session.id, providerCallId: session.providerCallId },
      },
    });
    if (!conversationWasCreated) {
      await tx.communicationConversation.update({
        where: { id: conversation.id },
        data: {
          lastMessageAt: conversation.lastMessageAt < session.startedAt ? session.startedAt : conversation.lastMessageAt,
          ...(session.direction === "INBOUND"
            ? { lastInboundAt: session.startedAt, firstInboundAt: conversation.firstInboundAt || session.startedAt, state: "WaitingOnAgency", unreadCount: { increment: 1 } }
            : { lastOutboundAt: session.startedAt, state: "WaitingOnClient" }),
        },
      });
    }
    return message;
  });
}

export async function ensureOomaCallbackFollowUp(callSessionId, db = prisma) {
  const result = await db.$transaction(async (tx) => {
    const session = await tx.oomaCallSession.findUnique({ where: { id: callSessionId }, include: { lead: true } });
    if (!session?.lead || session.followUpId || !["MISSED", "FAILED"].includes(session.status)) return null;
    if (session.lead.status !== "OPEN" || session.lead.pipelineSegment !== "STANDARD") return null;
    const existing = await tx.leadFollowUp.findFirst({
      where: { agencyId: session.agencyId, leadId: session.leadId, status: "PENDING", type: { in: ["PHONE_CALL", "CALL"] } },
      orderBy: { dueAt: "asc" },
    });
    const dueAt = new Date((session.endedAt || session.lastEventAt).getTime() + (session.direction === "INBOUND" ? 15 : 30) * 60_000);
    const followUp = existing || await tx.leadFollowUp.create({
      data: {
        agencyId: session.agencyId,
        leadId: session.leadId,
        assignedUserId: session.lead.ownerUserId,
        type: "PHONE_CALL",
        description: session.direction === "INBOUND" ? `Return missed Ooma call from ${session.remoteNumber || "unknown caller"}` : `Retry Ooma call to ${session.remoteNumber || "lead"}`,
        dueAt,
      },
    });
    await tx.oomaCallSession.update({ where: { id: session.id }, data: { followUpId: followUp.id } });
    if (!existing) {
      await tx.leadActivity.create({
        data: {
          agencyId: session.agencyId,
          leadId: session.leadId,
          activityType: "FOLLOW_UP_CREATED",
          direction: "INTERNAL",
          channel: "SYSTEM",
          title: followUp.description,
          description: `Due ${dueAt.toISOString()}`,
          metadata: { followUpId: followUp.id, oomaCallSessionId: session.id, automated: true },
        },
      });
      if (!session.lead.nextActionAt || dueAt < session.lead.nextActionAt) {
        await tx.lead.update({
          where: { id: session.leadId },
          data: { nextActionType: followUp.type, nextActionDescription: followUp.description, nextActionAt: dueAt, nextActionOwnerId: followUp.assignedUserId, version: { increment: 1 } },
        });
      }
    }
    return { followUp, ownerUserId: session.lead.ownerUserId, leadId: session.leadId, created: !existing };
  });
  if (result?.created && db === prisma) {
    await notifyUsers({
      agencyId: (await prisma.oomaCallSession.findUnique({ where: { id: callSessionId }, select: { agencyId: true } }))?.agencyId,
      recipientIds: [result.ownerUserId],
      type: "ooma.call.callback_required",
      category: "leads",
      title: "Ooma callback required",
      body: result.followUp.description,
      severity: "warning",
      entityType: "lead",
      entityId: result.leadId,
      actionUrl: `/calls?call=${encodeURIComponent(callSessionId)}`,
      dedupeKey: `ooma-call:${callSessionId}:callback`,
      attentionLevel: "action_required",
    });
  }
  return result;
}

const CALL_OUTCOMES = new Set(["COMPLETED", "FOLLOW_UP_REQUIRED", "NO_ANSWER", "BUSY", "VOICEMAIL", "WRONG_NUMBER", "NOT_INTERESTED", "OTHER"]);

// Records a disposition + note on a shared call-history session and, when the
// caller asks and the session is linked to an OPEN standard-pipeline lead,
// creates the follow-up (plus the FOLLOW_UP_CREATED activity and the lead's
// next-action pointer). Shared by the history drawer (Ooma routes) and the
// browser-softphone "call ended" popup (Twilio routes) so both write the same
// outcome through the same code path.
export async function applyCallOutcome(call, { outcome, notes, nextFollowUp = null } = {}, { agencyId, userId }) {
  const value = clean(outcome, 80).toUpperCase();
  if (!CALL_OUTCOMES.has(value)) throw createHttpError(400, "Select a valid call outcome.", "INVALID_CALL_OUTCOME");
  const noteText = clean(notes, 3000) || null;
  await prisma.$transaction(async (tx) => {
    await tx.oomaCallSession.update({ where: { id: call.id }, data: { disposition: value, outcomeNotes: noteText } });
    if (nextFollowUp && call.leadId) {
      const lead = await tx.lead.findFirst({ where: { id: call.leadId, agencyId, status: "OPEN", pipelineSegment: "STANDARD", deletedAt: null } });
      if (lead) {
        const dueAt = new Date(nextFollowUp.dueAt);
        if (Number.isNaN(dueAt.getTime())) throw createHttpError(400, "Choose a valid follow-up date and time.", "INVALID_FOLLOW_UP_DATE");
        const assignedUserId = clean(nextFollowUp.assignedUserId, 100) || lead.ownerUserId;
        const staff = await tx.user.findFirst({ where: { id: assignedUserId, agencyId, status: "active" }, select: { id: true } });
        if (!staff) throw createHttpError(400, "Select an active team member for the follow-up.", "INVALID_FOLLOW_UP_OWNER");
        const followUp = await tx.leadFollowUp.create({
          data: { agencyId, leadId: lead.id, assignedUserId, type: "PHONE_CALL", description: clean(nextFollowUp.description, 500) || "Follow up after call", dueAt },
        });
        await tx.leadActivity.create({
          data: {
            agencyId,
            leadId: lead.id,
            activityType: "FOLLOW_UP_CREATED",
            direction: "INTERNAL",
            channel: "SYSTEM",
            title: followUp.description,
            description: `Due ${dueAt.toISOString()}`,
            performedById: userId,
            metadata: { followUpId: followUp.id, oomaCallSessionId: call.id },
          },
        });
        if (!lead.nextActionAt || dueAt < lead.nextActionAt) {
          await tx.lead.update({
            where: { id: lead.id },
            data: { nextActionType: followUp.type, nextActionDescription: followUp.description, nextActionAt: dueAt, nextActionOwnerId: assignedUserId, version: { increment: 1 } },
          });
        }
      }
    }
  });
  if (call.leadId) await syncOomaLeadActivity(call.id);
  if (call.clientId) await syncOomaClientCommunication(call.id);
  return value;
}

async function notifyCall(session, isNew) {
  if (!isNew || session.direction !== "INBOUND" || !["RINGING", "ANSWERED", "COMPLETED", "MISSED", "FAILED"].includes(session.status)) return;
  const recipientIds = [session.handledByUserId].filter(Boolean);
  if (!recipientIds.length) {
    const triageUsers = await prisma.user.findMany({
      where: {
        agencyId: session.agencyId,
        status: "active",
        memberships: { some: { agencyId: session.agencyId, isActive: true, role: { in: ["admin", "frontdesk"] } } },
      },
      select: { id: true },
    });
    recipientIds.push(...triageUsers.map((user) => user.id));
  }
  if (!recipientIds.length) recipientIds.push(...await adminRecipientIds(session.agencyId));
  await notifyUsers({
    agencyId: session.agencyId,
    recipientIds,
    type: session.status === "MISSED" ? "ooma.call.missed" : "ooma.call.incoming",
    category: "communications",
    title: session.status === "MISSED" ? "Missed Ooma call" : "Incoming Ooma call",
    body: session.remoteNumber || "Private or unidentified number",
    severity: session.status === "MISSED" ? "warning" : "info",
    entityType: "ooma_call",
    entityId: session.id,
    actionUrl: `/calls?call=${encodeURIComponent(session.id)}`,
    dedupeKey: `ooma-call:${session.id}:incoming`,
    attentionLevel: session.resolution === "UNRESOLVED" || session.status === "MISSED" ? "action_required" : "informational",
  });
}

async function reconcileCallSession(session, db, notify = false) {
  if (session.leadId) {
    await syncOomaLeadActivity(session.id, db);
    await ensureOomaCallbackFollowUp(session.id, db);
  }
  if (session.clientId) await syncOomaClientCommunication(session.id, db);
  if (notify && db === prisma) await notifyCall(session, true);
}

export async function ingestOomaCallEvent({ agencyId, settings, payload }, db = prisma, retriedAfterRace = false) {
  const normalized = normalizeOomaCallPayload(payload, settings);
  if (!normalized.providerCallId) {
    const error = new Error("Ooma callId is required. Map the Ooma Call ID into the Zapier POST payload.");
    error.statusCode = 400;
    throw error;
  }
  const existingEvent = await db.oomaCallEvent.findUnique({
    where: { agencyId_providerEventId: { agencyId, providerEventId: normalized.providerEventId } },
    include: { callSession: true },
  });
  if (existingEvent) {
    // The event ledger is written before CRM side effects. Re-run those
    // idempotent projections on a Zapier retry so a temporary database or
    // notification failure cannot leave a persisted call half-processed.
    await reconcileCallSession(existingEvent.callSession, db, db === prisma && normalized.eventType !== "RECORDING_AVAILABLE");
    return { data: existingEvent.callSession, duplicate: true, eventType: normalized.eventType };
  }

  let createdSession = false;
  let previousStatus = null;
  let result;
  try {
    result = await db.$transaction(async (tx) => {
    const duplicate = await tx.oomaCallEvent.findUnique({ where: { agencyId_providerEventId: { agencyId, providerEventId: normalized.providerEventId } } });
    if (duplicate) return { session: await tx.oomaCallSession.findUnique({ where: { id: duplicate.callSessionId } }), duplicate: true };
    let session = await tx.oomaCallSession.findUnique({ where: { agencyId_providerCallId: { agencyId, providerCallId: normalized.providerCallId } } });
    previousStatus = session?.status || null;
    const handledBy = await findHandledBy(tx, agencyId, normalized);
    if (!session) {
      createdSession = true;
      session = await tx.oomaCallSession.create({
        data: {
          agencyId,
          providerCallId: normalized.providerCallId,
          direction: normalized.direction,
          status: normalized.status || (normalized.eventType === "RECORDING_AVAILABLE" ? "COMPLETED" : "RINGING"),
          remoteNumber: normalized.remoteNumber,
          remoteNumberNormalized: normalized.remoteNumberNormalized,
          businessNumber: normalized.businessNumber,
          extensionLabel: normalized.extensionLabel,
          handledByUserId: handledBy?.id || null,
          disposition: normalized.disposition,
          startedAt: normalized.startedAt,
          answeredAt: normalized.answeredAt,
          endedAt: normalized.endedAt,
          durationSeconds: normalized.durationSeconds,
          recordingUrl: normalized.recordingUrl,
          transcript: normalized.transcript,
          lastEventAt: normalized.occurredAt,
          rawPayload: payload,
        },
      });
    } else {
      session = await tx.oomaCallSession.update({
        where: { id: session.id },
        data: {
          direction: normalized.direction || session.direction,
          ...(normalized.status ? { status: normalized.status } : {}),
          remoteNumber: normalized.remoteNumber || session.remoteNumber,
          remoteNumberNormalized: normalized.remoteNumberNormalized || session.remoteNumberNormalized,
          businessNumber: normalized.businessNumber || session.businessNumber,
          extensionLabel: normalized.extensionLabel || session.extensionLabel,
          handledByUserId: handledBy?.id || session.handledByUserId,
          disposition: normalized.disposition || session.disposition,
          startedAt: normalized.startedAt < session.startedAt ? normalized.startedAt : session.startedAt,
          answeredAt: normalized.answeredAt || session.answeredAt,
          endedAt: normalized.endedAt || session.endedAt,
          durationSeconds: normalized.durationSeconds ?? session.durationSeconds,
          recordingUrl: normalized.recordingUrl || session.recordingUrl,
          transcript: normalized.transcript || session.transcript,
          lastEventAt: normalized.occurredAt > session.lastEventAt ? normalized.occurredAt : session.lastEventAt,
          rawPayload: payload,
        },
      });
    }
    session = await autoMatch(tx, session);
    await tx.oomaCallEvent.create({
      data: { agencyId, callSessionId: session.id, providerEventId: normalized.providerEventId, eventType: normalized.eventType, occurredAt: normalized.occurredAt, payload },
    });
      return { session, duplicate: false };
    });
  } catch (error) {
    // Zapier can deliver "new call" and "call ended" almost together. If
    // both workers race to create the same session/event, the database's
    // unique keys choose the winner and the loser retries as an update.
    if (error?.code === "P2002" && !retriedAfterRace) {
      return ingestOomaCallEvent({ agencyId, settings, payload }, db, true);
    }
    throw error;
  }
  if (result.duplicate) {
    await reconcileCallSession(result.session, db, db === prisma && normalized.eventType !== "RECORDING_AVAILABLE");
    return { data: result.session, duplicate: true, eventType: normalized.eventType };
  }
  const becameMissed = ["MISSED", "FAILED"].includes(result.session.status) && !["MISSED", "FAILED"].includes(previousStatus);
  await reconcileCallSession(result.session, db, (createdSession && normalized.eventType !== "RECORDING_AVAILABLE") || becameMissed);
  return { data: result.session, duplicate: false, eventType: normalized.eventType };
}
