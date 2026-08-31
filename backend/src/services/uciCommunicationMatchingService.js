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

// The exact WHERE clause the bounded hourly pass (and nothing else) uses to
// select candidates. Exported as the single source of truth for "does this
// row need a check" — both the real query below and matchesUciRescanWhere
// (its pure, database-free mirror used only by tests) are built from this
// same shape, so a test proving the anti-starvation and retry guarantees
// can never silently drift from what production actually queries.
export function uciRescanWhere() {
  return {
    resolvedAt: null,
    channel: "Email",
    OR: [{ uciCheckedAt: null }, { uciCheckFailedAt: { not: null } }],
  };
}

// Pure evaluator for the where-clause above. Not used by the real query
// (Prisma evaluates its own where object against the database) — it exists
// so tests can prove, without a live database, exactly which rows would or
// would not be included in a given bounded pass.
export function matchesUciRescanWhere(row) {
  if (row.resolvedAt != null) return false;
  if (row.channel !== "Email") return false;
  return row.uciCheckedAt == null || row.uciCheckFailedAt != null;
}

// Splits a narrow-selected page into rows with no extractable UCI (which
// can be bulk-marked checked without ever fetching their wider fields) and
// rows worth a second, targeted fetch. Pure and exported so the split
// itself — not just the regex it's built from — is directly testable.
export function partitionByUciPresence(rows) {
  const noUciIds = [];
  const candidateIdsWithUci = [];
  for (const row of rows) {
    const uci = extractUci(row.subject) || extractUci(row.bodyText);
    if (uci) candidateIdsWithUci.push(row.id);
    else noUciIds.push(row.id);
  }
  return { noUciIds, candidateIdsWithUci };
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

// Best-effort bookkeeping write recording that a check completed cleanly
// (whether or not it found a UCI). Never throws — worst case a row simply
// gets looked at again by a later pass, which is safe and idempotent.
async function markUciChecked(unmatchedId, extractedUci) {
  await prisma.unmatchedCommunication
    .update({
      where: { id: unmatchedId },
      data: { extractedUci, uciCheckedAt: new Date(), uciCheckFailedAt: null },
    })
    .catch(() => {});
}

// Reused from three places: the ingestion-time immediate check
// (communicationWebhookController.js's storeUnmatched), the hourly bounded
// safety-net pass below, and the explicit recheck triggered when a case's
// ImmigrationProfile.uci is set/changed (see
// recheckUnmatchedCommunicationsForUci). All three want the same outcome:
// try to link the row, and whether or not that succeeds, persist enough
// check-state that nothing needs to reread this row's body again for no
// reason.
export async function linkOne(unmatched) {
  const uci = extractUci(unmatched.subject) || extractUci(unmatched.bodyText);
  if (!uci) {
    await markUciChecked(unmatched.id, null);
    return false;
  }

  try {
    const caseItem = await matchCaseByUci(unmatched.agencyId, uci);
    if (!caseItem) {
      await markUciChecked(unmatched.id, uci);
      return false;
    }

    const client = await prisma.client.findUnique({ where: { id: caseItem.clientId }, select: { id: true, fullName: true } });
    if (!client) {
      await markUciChecked(unmatched.id, uci);
      return false;
    }

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
    if (!attributedUserId) {
      await markUciChecked(unmatched.id, uci);
      return false;
    }

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
      await tx.unmatchedCommunication.update({
        where: { id: unmatched.id },
        data: { resolvedAt: new Date(), extractedUci: uci, uciCheckedAt: new Date(), uciCheckFailedAt: null },
      });
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
  } catch (error) {
    // A transient failure (DB blip, etc.) must not be recorded the same way
    // as a clean "checked, nothing to do" — uciCheckedAt stays untouched so
    // this row remains part of the bounded pass's retry set. extractedUci is
    // still worth persisting: we did successfully extract it before the
    // failure, and the explicit per-UCI recheck trigger can still find this
    // row by that value even before the retry happens.
    await prisma.unmatchedCommunication
      .update({ where: { id: unmatched.id }, data: { extractedUci: uci, uciCheckFailedAt: new Date() } })
      .catch(() => {});
    throw error;
  }
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
    // agencies). Paginating through the whole *qualifying* set every run
    // preserves that same fix while keeping the set itself small: rows that
    // were already checked (uciCheckedAt set, uciCheckFailedAt clear) never
    // enter this query at all — regardless of how large one agency's
    // already-checked history is — so a huge stale backlog in one agency
    // can no longer compete with a brand-new row in another for a place in
    // the scan window. Genuinely new messages are already checked at
    // ingestion time (storeUnmatched); this pass is the bounded safety net
    // for whatever that immediate check missed or failed on.
    let cursor = null;
    for (;;) {
      const page = await prisma.unmatchedCommunication.findMany({
        where: uciRescanWhere(),
        orderBy: { id: "asc" },
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        take: BATCH_SIZE,
        // UCI detection only needs these three columns. In particular, never
        // transfer the provider payload for every unresolved email just to run a regex.
        select: { id: true, subject: true, bodyText: true },
      });
      if (!page.length) break;

      const checkedNow = new Date();
      const { noUciIds, candidateIdsWithUci } = partitionByUciPresence(page);
      // Bulk-mark every no-UCI row in this page checked in one write instead
      // of one row at a time — these never need a second, wider fetch since
      // linkOne only needs the wider fields once a UCI is actually present.
      if (noUciIds.length) {
        await prisma.unmatchedCommunication.updateMany({
          where: { id: { in: noUciIds } },
          data: { extractedUci: null, uciCheckedAt: checkedNow, uciCheckFailedAt: null },
        });
      }
      for (const candidateId of candidateIdsWithUci) {
        const unmatched = await prisma.unmatchedCommunication.findUnique({
          where: { id: candidateId },
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
          logger.warn("uci_match.link_failed", { unmatchedId: candidateId, reason: error.message });
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

// Triggered by createCaseApplicant/updateCaseApplicant when an
// ImmigrationProfile.uci value is newly set or changed — looks up
// previously-unmatched, still-unresolved communications whose persisted
// extracted UCI already equals the new value (they arrived before the case
// had this UCI on file) and attempts to link them immediately, instead of
// waiting for the next bounded hourly pass. Uses the same real indexed
// equality lookup the schema comment describes, not a heuristic.
export async function recheckUnmatchedCommunicationsForUci(agencyId, uci) {
  if (!agencyId || !uci) return 0;
  const candidates = await prisma.unmatchedCommunication.findMany({
    where: { agencyId, extractedUci: uci, resolvedAt: null, channel: "Email" },
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
  let linked = 0;
  for (const candidate of candidates) {
    const didLink = await linkOne(candidate).catch((error) => {
      logger.warn("uci_match.recheck_failed", { unmatchedId: candidate.id, reason: error.message });
      return false;
    });
    if (didLink) linked += 1;
  }
  return linked;
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
