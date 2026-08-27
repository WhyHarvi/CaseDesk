import prisma from "./prisma/client.js";
import { createHttpError } from "../utils/http.js";
import { notifyUsers } from "./notificationService.js";

const clean = (value, max = 500) => String(value ?? "").trim().slice(0, max);
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
    return tx.callSession.update({
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
    return tx.callSession.update({
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
  const providerName = "Twilio";
  if (session.direction === "OUTBOUND") {
    return { activityType: "OUTGOING_CALL", direction: "OUTBOUND", title: `Outgoing ${providerName} call` };
  }
  if (["MISSED", "FAILED"].includes(session.status)) {
    return { activityType: "MISSED_CALL", direction: "INBOUND", title: `Missed ${providerName} call` };
  }
  return { activityType: "INCOMING_CALL", direction: "INBOUND", title: `Incoming ${providerName} call` };
}

export async function syncCallLeadActivity(callSessionId, db = prisma) {
  return db.$transaction(async (tx) => {
    const session = await tx.callSession.findUnique({ where: { id: callSessionId }, include: { lead: true } });
    if (!session?.lead) return null;
    const presentation = activityPresentation(session);
    const providerKey = "twilio";
    const externalId = `${providerKey}-call:${session.providerCallId}`;
    const metadata = {
      callSessionId: session.id,
      providerCallId: session.providerCallId,
      status: session.status,
      remoteNumber: session.remoteNumber,
      recordingUrl: session.recordingUrl,
      extensionLabel: session.extensionLabel,
    };
    const legacyExternalId = `ooma-call:${session.providerCallId}`;
    const existing = await tx.leadActivity.findFirst({ where: { agencyId: session.agencyId, leadId: session.leadId, externalId: { in: [externalId, legacyExternalId] } } });
    const activityData = {
      ...presentation,
      channel: "PHONE",
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
          metadata: { activityId: activity.id, activityType: presentation.activityType, callSessionId: session.id },
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
        data: { agencyId: session.agencyId, leadId: session.lead.id, previousStage: session.lead.stage, newStage: nextStage, changedById: session.handledByUserId, reason: "Twilio call activity" },
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

export async function syncCallClientCommunication(callSessionId, db = prisma) {
  return db.$transaction(async (tx) => {
    const session = await tx.callSession.findUnique({ where: { id: callSessionId }, include: { client: true, case: true } });
    if (!session?.client) return null;
    let message = await tx.communicationMessage.findFirst({
      where: { agencyId: session.agencyId, provider: "Twilio", providerMessageId: session.providerCallId },
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
          metadata: { callSessionId: session.id, extensionLabel: session.extensionLabel },
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
          subject: "Phone calls",
          provider: "Twilio",
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
        subject: session.direction === "INBOUND" ? "Incoming Twilio call" : "Outgoing Twilio call",
        bodyText: session.outcomeNotes,
        provider: "Twilio",
        providerMessageId: session.providerCallId,
        occurredAt: session.startedAt,
        durationSeconds: session.durationSeconds,
        callDisposition: session.disposition || session.status,
        callRecordingUrl: session.recordingUrl,
        callTranscript: session.transcript,
        metadata: { callSessionId: session.id, extensionLabel: session.extensionLabel },
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
        details: `${session.direction === "INBOUND" ? "Incoming" : "Outgoing"} Twilio call ${session.remoteNumber ? `with ${session.remoteNumber}` : "with an unidentified number"}`,
        entityType: "communication_message",
        entityId: message.id,
        metadata: { callSessionId: session.id, providerCallId: session.providerCallId },
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

export async function ensureCallCallbackFollowUp(callSessionId, db = prisma) {
  const result = await db.$transaction(async (tx) => {
    const session = await tx.callSession.findUnique({ where: { id: callSessionId }, include: { lead: true } });
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
        description: session.direction === "INBOUND" ? `Return missed call from ${session.remoteNumber || "unknown caller"}` : `Retry call to ${session.remoteNumber || "lead"}`,
        dueAt,
      },
    });
    await tx.callSession.update({ where: { id: session.id }, data: { followUpId: followUp.id } });
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
          metadata: { followUpId: followUp.id, callSessionId: session.id, automated: true },
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
      agencyId: (await prisma.callSession.findUnique({ where: { id: callSessionId }, select: { agencyId: true } }))?.agencyId,
      recipientIds: [result.ownerUserId],
      type: "twilio.call.callback_required",
      category: "leads",
      title: "Callback required",
      body: result.followUp.description,
      severity: "warning",
      entityType: "lead",
      entityId: result.leadId,
      actionUrl: `/calls?call=${encodeURIComponent(callSessionId)}`,
      dedupeKey: `twilio-call:${callSessionId}:callback`,
      attentionLevel: "action_required",
    });
  }
  return result;
}

const CALL_OUTCOMES = new Set(["COMPLETED", "FOLLOW_UP_REQUIRED", "NO_ANSWER", "BUSY", "VOICEMAIL", "WRONG_NUMBER", "NOT_INTERESTED", "OTHER"]);

// Records a disposition + note on a shared call-history session and, when the
// caller asks and the session is linked to an OPEN standard-pipeline lead,
// creates the follow-up (plus the FOLLOW_UP_CREATED activity and the lead's
// next-action pointer). Shared by the history drawer and the browser-softphone
// "call ended" popup so both write the same outcome through one code path.
export async function applyCallOutcome(call, { outcome, notes, nextFollowUp = null } = {}, { agencyId, userId }) {
  const value = clean(outcome, 80).toUpperCase();
  if (!CALL_OUTCOMES.has(value)) throw createHttpError(400, "Select a valid call outcome.", "INVALID_CALL_OUTCOME");
  const noteText = clean(notes, 3000) || null;
  await prisma.$transaction(async (tx) => {
    await tx.callSession.update({ where: { id: call.id }, data: { disposition: value, outcomeNotes: noteText } });
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
            metadata: { followUpId: followUp.id, callSessionId: call.id },
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
  if (call.leadId) await syncCallLeadActivity(call.id);
  if (call.clientId) await syncCallClientCommunication(call.id);
  return value;
}
