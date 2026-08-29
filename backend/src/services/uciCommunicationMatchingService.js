import prisma from "./prisma/client.js";
import { logger } from "./logger.js";
import { notifyUsers, adminRecipientIds } from "./notificationService.js";
import { recordCommunicationAudit } from "./communicationAudit.js";
import { communicationResolutionDueAt, communicationResponseDueAt } from "./communicationSlaService.js";
import { acquireWorkerLease } from "./workerLeaseService.js";

// IRCC/RCIC portal correspondence about a client arrives addressed TO the
// agency, never FROM the client — so the normal sender-address matching in
// ingestInboundCommunication (communicationWebhookController.js) can never
// attach it to a case, and it lands in UnmatchedCommunication for a staff
// member to reconcile by hand via assignUnmatchedCommunication. This runs
// that same reconciliation automatically whenever the message's own content
// carries a UCI — Canada's Unique Client Identifier, already captured
// against a case's government forms (ImmigrationProfile.uci, entered while
// filling out IRCC forms in the case file) or the client record itself
// (Client.uci) — matching a case already on file.
//
// Hourly, not on the fast client-communication cadence: this only affects
// mail nobody is actively waiting to see arrive (it already sat unmatched
// this whole time uneventfully), and it isn't the primary discovery path
// for it, so there's no responsiveness cost to keeping this infrequent —
// only steady-state database load saved.
const POLL_MS = 60 * 60_000;
const BATCH_SIZE = 100;
let timer = null;
let running = false;

// IRCC's own notification templates consistently write the number as
// "UCI" followed by punctuation/whitespace/the word "Number", then 8 or 10
// digits (the two lengths IRCC has issued over the program's history).
const UCI_PATTERN = /UCI[^0-9]{0,20}(\d{8,10})/i;

export function extractUci(text) {
  const match = UCI_PATTERN.exec(String(text || ""));
  return match ? match[1] : null;
}

// A profile can be linked to more than one case (e.g. a family application)
// — same "most recent open case, else most recent case" tie-break already
// used by ingestInboundCommunication, so an automated match behaves like a
// human would guess if handed the same ambiguity.
async function matchCaseByUci(agencyId, uci) {
  const profile = await prisma.immigrationProfile.findFirst({
    where: { agencyId, uci },
    select: {
      caseAccesses: {
        select: { case: { select: { id: true, clientId: true, status: true, updatedAt: true, assignedUserId: true } } },
      },
    },
  });
  if (profile?.caseAccesses?.length) {
    const cases = profile.caseAccesses.map((access) => access.case);
    return cases.find((item) => item.status !== "Closed") || cases.slice().sort((a, b) => b.updatedAt - a.updatedAt)[0];
  }

  const client = await prisma.client.findFirst({ where: { agencyId, uci }, select: { id: true } });
  if (!client) return null;
  return (
    (await prisma.case.findFirst({ where: { agencyId, clientId: client.id, status: { not: "Closed" } }, orderBy: { updatedAt: "desc" } })) ||
    (await prisma.case.findFirst({ where: { agencyId, clientId: client.id }, orderBy: { updatedAt: "desc" } }))
  );
}

async function linkOne(unmatched) {
  const uci = extractUci(unmatched.subject) || extractUci(unmatched.bodyText);
  if (!uci) return false;
  const caseItem = await matchCaseByUci(unmatched.agencyId, uci);
  if (!caseItem) return false;

  const client = await prisma.client.findUnique({ where: { id: caseItem.clientId }, select: { id: true, fullName: true } });
  if (!client) return false;

  const [responseDueAt, resolutionDueAt, admins] = await Promise.all([
    communicationResponseDueAt(unmatched.agencyId, unmatched.occurredAt),
    communicationResolutionDueAt(unmatched.agencyId, unmatched.occurredAt),
    adminRecipientIds(unmatched.agencyId),
  ]);
  // No human is "doing" this — createdById is NOT NULL, so attribute it to
  // the case's own assigned staff member, falling back to an agency admin,
  // mirroring how the manual assign flow falls back to whichever staff
  // member is clicking the button when a case has nobody assigned yet.
  const attributedUserId = caseItem.assignedUserId || admins[0] || null;
  if (!attributedUserId) return false;

  const { conversation, message } = await prisma.$transaction(async (tx) => {
    const conversation = await tx.communicationConversation.create({
      data: {
        agencyId: unmatched.agencyId,
        clientId: client.id,
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
        assignedToId: caseItem.assignedUserId || attributedUserId,
        createdById: attributedUserId,
      },
    });
    const message = await tx.communicationMessage.create({
      data: {
        agencyId: unmatched.agencyId,
        clientId: client.id,
        caseId: caseItem.id,
        conversationId: conversation.id,
        channel: unmatched.channel,
        direction: "Inbound",
        status: "Received",
        senderAddress: unmatched.senderAddress,
        recipients: unmatched.recipients,
        subject: unmatched.subject,
        bodyText: unmatched.bodyText,
        provider: unmatched.provider,
        providerMessageId: unmatched.providerMessageId,
        occurredAt: unmatched.occurredAt,
        metadata: { importedFromUnmatched: unmatched.id, matchedByUci: uci },
        isRead: false,
      },
    });
    await tx.unmatchedCommunication.update({ where: { id: unmatched.id }, data: { resolvedAt: new Date() } });
    return { conversation, message };
  });

  await recordCommunicationAudit({
    agencyId: unmatched.agencyId,
    conversationId: conversation.id,
    messageId: message.id,
    action: "communication.unmatched_assigned_by_uci",
    details: `Inbound ${unmatched.channel} matched to ${client.fullName} by UCI ${uci}`,
    metadata: { unmatchedId: unmatched.id, caseId: caseItem.id, uci },
  });

  const recipientIds = [...new Set([caseItem.assignedUserId, ...admins].filter(Boolean))];
  await notifyUsers({
    agencyId: unmatched.agencyId,
    recipientIds,
    type: "communication.uci_matched",
    category: "communications",
    title: `Message from IRCC for ${client.fullName}`,
    body: unmatched.subject || "A new message referencing this client's UCI was received and linked to their case.",
    severity: "info",
    entityType: "conversation",
    entityId: conversation.id,
    // Same "client messages" destination the rest of the app already uses
    // for a conversation-scoped notification.
    actionUrl: `/app/clients/${client.id}?conversation=${conversation.id}`,
    dedupeKey: `unmatched-uci:${unmatched.id}`,
    attentionLevel: "action_required",
  }).catch(() => {});

  return true;
}

export async function autoLinkUciMatchedCommunications() {
  if (running) return 0;
  running = true;
  try {
    // This worker starts in every backend replica. Without a shared lease,
    // every deployment instance independently walked the entire unresolved
    // backlog on startup and once per hour.
    if (!await acquireWorkerLease("uci-communication-matching", { ttlMs: POLL_MS + 5 * 60_000 })) return 0;
    let linked = 0;
    // This is a shared, multi-tenant table — the unresolved-email backlog
    // is not scoped to one agency, and a fixed single-page, oldest-first
    // fetch let another agency's backlog push a brand-new row out of the
    // window entirely (caught live: a just-created row wasn't in the first
    // 100 because >100 older unresolved rows existed across other
    // agencies). Paginating through the whole backlog is safe here in a
    // way it wouldn't be on a fast poller: this only runs once an hour, and
    // a non-matching row costs nothing beyond an in-memory regex check —
    // linkOne only touches the database again once extractUci finds
    // something, which the overwhelming majority of rows (plain bounces,
    // unrelated mail) never do.
    let cursor = null;
    for (;;) {
      const page = await prisma.unmatchedCommunication.findMany({
        where: { resolvedAt: null, channel: "Email" },
        orderBy: { id: "asc" },
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        take: BATCH_SIZE,
        // UCI detection only needs these three columns. In particular, never
        // transfer the provider payload for every unresolved email just to run a regex.
        select: { id: true, subject: true, bodyText: true },
      });
      if (!page.length) break;
      for (const candidate of page) {
        const uci = extractUci(candidate.subject) || extractUci(candidate.bodyText);
        if (!uci) continue;
        const unmatched = await prisma.unmatchedCommunication.findUnique({
          where: { id: candidate.id },
          select: {
            id: true,
            agencyId: true,
            channel: true,
            provider: true,
            providerMessageId: true,
            senderAddress: true,
            recipients: true,
            subject: true,
            bodyText: true,
            occurredAt: true,
          },
        });
        if (!unmatched) continue;
        const didLink = await linkOne(unmatched).catch((error) => {
          logger.warn("uci_match.link_failed", { unmatchedId: candidate.id, reason: error.message });
          return false;
        });
        if (didLink) linked += 1;
      }
      cursor = page.at(-1).id;
      if (page.length < BATCH_SIZE) break;
    }
    return linked;
  } finally {
    running = false;
  }
}

export function startUciCommunicationMatchingWorker() {
  if (timer) return;
  timer = setInterval(() => {
    void autoLinkUciMatchedCommunications();
  }, POLL_MS);
  void autoLinkUciMatchedCommunications();
  if (timer.unref) timer.unref();
}

export function stopUciCommunicationMatchingWorker() {
  if (timer) clearInterval(timer);
  timer = null;
}
