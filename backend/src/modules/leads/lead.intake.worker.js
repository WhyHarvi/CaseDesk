import prisma from "../../services/prisma/client.js";
import { nextLeadNumber } from "./lead.repository.js";
import { normalizeIncomingLead } from "./lead.intake.validation.js";
import { adaptProviderPayload } from "./lead.provider.adapters.js";
import { enrichProviderPayload } from "./lead.provider.enrichment.js";
import { logger } from "../../services/logger.js";
import { adminRecipientIds, notifyUsers, resolveNotifications } from "../../services/notificationService.js";
import { invalidateDashboardCache } from "../../services/dashboardCache.js";
import { leadWelcomeEmailEligible, sendLeadWelcomeEmail } from "./lead.welcomeEmail.service.js";
import { resolveRoutedOwner } from "./lead.routing.service.js";
import { lockAgencyContactIntake } from "../../services/contactDuplicateService.js";

const POLL_MS = Math.max(Number(process.env.LEAD_INTAKE_POLL_MS) || 2000, 500);
const BATCH_SIZE = Math.min(Math.max(Number(process.env.LEAD_INTAKE_BATCH_SIZE) || 10, 1), 50);
let timer = null;
let running = false;
const WEBSITE_CORRECTION_WINDOW_MS = 15 * 60_000;

function plainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function identityText(...values) {
  return values.filter(Boolean).join(" ").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function editDistance(leftValue, rightValue) {
  const left = String(leftValue || ""), right = String(rightValue || "");
  const rows = Array.from({ length: left.length + 1 }, (_, index) => {
    const row = Array(right.length + 1).fill(0);
    row[0] = index;
    return row;
  });
  for (let column = 0; column <= right.length; column += 1) rows[0][column] = column;
  for (let row = 1; row <= left.length; row += 1) {
    for (let column = 1; column <= right.length; column += 1) {
      const substitution = left[row - 1] === right[column - 1] ? 0 : 1;
      rows[row][column] = Math.min(
        rows[row - 1][column] + 1,
        rows[row][column - 1] + 1,
        rows[row - 1][column - 1] + substitution,
      );
      if (row > 1 && column > 1 && left[row - 1] === right[column - 2] && left[row - 2] === right[column - 1]) {
        rows[row][column] = Math.min(rows[row][column], rows[row - 2][column - 2] + 1);
      }
    }
  }
  return rows[left.length][right.length];
}

function correctedEmail(previousValue, currentValue) {
  const previous = String(previousValue || "").toLowerCase().split("@");
  const current = String(currentValue || "").toLowerCase().split("@");
  if (previous.length !== 2 || current.length !== 2 || previous.join("@") === current.join("@")) return false;
  const [previousLocal, previousDomain] = previous;
  const [currentLocal, currentDomain] = current;
  return (previousLocal === currentLocal && editDistance(previousDomain, currentDomain) <= 2)
    || (previousDomain === currentDomain && editDistance(previousLocal, currentLocal) <= 1);
}

export function isLikelyCorrectedWebsiteSubmission(current, previous) {
  const elapsed = new Date(current?.createdAt).getTime() - new Date(previous?.createdAt).getTime();
  if (!Number.isFinite(elapsed) || elapsed < 0 || elapsed > WEBSITE_CORRECTION_WINDOW_MS) return false;
  if (!current?.ip || current.ip !== previous?.ip) return false;
  const currentName = identityText(current.firstName, current.lastName);
  const previousName = identityText(previous?.firstName, previous?.lastName);
  if (!currentName || currentName !== previousName) return false;
  return correctedEmail(previous?.emailNormalized, current.emailNormalized);
}

async function refreshBatch(tx, batchId) {
  if (!batchId) return;
  const processedRows = await tx.leadImportRow.count({ where: { batchId, status: "PROCESSED" } });
  const duplicateRows = await tx.leadImportRow.count({ where: { batchId, status: "DUPLICATE" } });
  const failedRows = await tx.leadImportRow.count({ where: { batchId, status: "FAILED" } });
  const remaining = await tx.leadImportRow.count({ where: { batchId, status: "QUEUED" } });
  await tx.leadImportBatch.update({ where: { id: batchId }, data: {
    processedRows, duplicateRows, failedRows,
    status: remaining ? "PROCESSING" : (failedRows && !processedRows && !duplicateRows ? "FAILED" : "COMPLETED"),
    completedAt: remaining ? null : new Date(),
  } });
}

async function findDuplicates(tx, event, normalized) {
  const or = [];
  if (normalized.phoneNormalized) or.push({ phoneNormalized: normalized.phoneNormalized });
  if (normalized.emailNormalized) or.push({ emailNormalized: normalized.emailNormalized });
  const dismissed = await tx.leadDuplicateCandidate.findMany({
    where: { incomingEventId: event.id, status: "DISMISSED" },
    select: { candidateLeadId: true },
  });
  const dismissedIds = dismissed.map((item) => item.candidateLeadId);
  const leads = or.length ? await tx.lead.findMany({ where: { agencyId: event.agencyId, deletedAt: null, OR: or, ...(dismissedIds.length ? { id: { notIn: dismissedIds } } : {}) }, select: { id: true, phoneNormalized: true, emailNormalized: true } }) : [];
  const candidates = leads.map((lead) => {
    const reasons = [];
    let score = 0;
    if (normalized.phoneNormalized && lead.phoneNormalized === normalized.phoneNormalized) { reasons.push("Exact phone match"); score = 100; }
    if (normalized.emailNormalized && lead.emailNormalized === normalized.emailNormalized) { reasons.push("Exact email match"); score = Math.max(score, 90); }
    return { leadId: lead.id, score, reasons };
  });

  const rawPayload = plainObject(event.rawPayload);
  if (event.sourceConnection?.provider === "WEBSITE" && event.sourceConnectionId && rawPayload.ip && normalized.emailNormalized) {
    const recentEvents = await tx.leadIncomingEvent.findMany({
      where: {
        agencyId: event.agencyId,
        sourceConnectionId: event.sourceConnectionId,
        id: { not: event.id },
        status: "PROCESSED",
        processedLeadId: { not: null },
        createdAt: { gte: new Date(event.createdAt.getTime() - WEBSITE_CORRECTION_WINDOW_MS), lte: event.createdAt },
      },
      select: {
        createdAt: true,
        rawPayload: true,
        processedLead: { select: { id: true, firstName: true, lastName: true, emailNormalized: true, deletedAt: true, status: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 20,
    });
    for (const priorEvent of recentEvents) {
      const lead = priorEvent.processedLead;
      if (!lead || lead.deletedAt || ["DUPLICATE", "ARCHIVED"].includes(lead.status) || dismissedIds.includes(lead.id)) continue;
      if (isLikelyCorrectedWebsiteSubmission(
        { createdAt: event.createdAt, ip: rawPayload.ip, firstName: normalized.firstName, lastName: normalized.lastName, emailNormalized: normalized.emailNormalized },
        { createdAt: priorEvent.createdAt, ip: plainObject(priorEvent.rawPayload).ip, firstName: lead.firstName, lastName: lead.lastName, emailNormalized: lead.emailNormalized },
      )) {
        candidates.push({ leadId: lead.id, score: 85, reasons: ["Same website visitor and name within 15 minutes", "Possible corrected email address"] });
      }
    }
  }

  return [...candidates.reduce((byLead, candidate) => {
    const existing = byLead.get(candidate.leadId);
    if (!existing) byLead.set(candidate.leadId, candidate);
    else byLead.set(candidate.leadId, { leadId: candidate.leadId, score: Math.max(existing.score, candidate.score), reasons: [...new Set([...existing.reasons, ...candidate.reasons])] });
    return byLead;
  }, new Map()).values()];
}

export async function processClaimed(eventId) {
  const result = await prisma.$transaction(async (tx) => {
    const event = await tx.leadIncomingEvent.findUnique({ where: { id: eventId }, include: { intakeForm: true, importBatch: true, sourceConnection: true, source: { select: { type: true } } } });
    if (!event || event.status !== "PROCESSING") return;
    const settings = event.importBatch?.settings && typeof event.importBatch.settings === "object" ? event.importBatch.settings : {};
    const mapping = event.channel === "CSV_IMPORT" ? settings.mapping : null;
    // Public form submissions stash utm_source/medium/campaign/term/content
    // (captured from the query string in lead.intake.service.js) under
    // rawPayload.tracking. Read it off the event's original payload, before
    // any provider adapter has a chance to reshape or drop it, so it lands
    // on the Lead record instead of being buried in the JSON blob forever.
    const tracking = event.rawPayload && typeof event.rawPayload.tracking === "object" && event.rawPayload.tracking ? event.rawPayload.tracking : {};
    const enrichedPayload = event.sourceConnection ? await enrichProviderPayload(event.sourceConnection, event.rawPayload) : event.rawPayload;
    const rawPayload = event.sourceConnection ? adaptProviderPayload(event.sourceConnection.provider, enrichedPayload) : event.rawPayload;
    // Website contact forms commonly collect only an email (or only a
    // phone) — requiring both, the way most other providers' structured
    // lead-form data allows us to, would silently reject valid leads.
    const allowEmailOnly = ["EMAIL", "WEBSITE"].includes(event.sourceConnection?.provider);
    const normalized = normalizeIncomingLead(rawPayload, mapping, { allowEmailOnly });
    if (normalized.errors.length) throw new Error(normalized.errors.join(" "));
    // Manual intake and every automated intake worker share this lock. It
    // prevents two simultaneous events with the same contact from both
    // passing the duplicate scan before either transaction creates a lead.
    await lockAgencyContactIntake(tx, event.agencyId);
    const duplicates = await findDuplicates(tx, event, normalized.data);
    if (duplicates.length) {
      for (const candidate of duplicates) {
        await tx.leadDuplicateCandidate.upsert({
          where: { incomingEventId_candidateLeadId: { incomingEventId: event.id, candidateLeadId: candidate.leadId } },
          create: { agencyId: event.agencyId, incomingEventId: event.id, candidateLeadId: candidate.leadId, score: candidate.score, reasons: candidate.reasons },
          update: { score: candidate.score, reasons: candidate.reasons },
        });
      }
      await tx.leadIncomingEvent.update({ where: { id: event.id }, data: { status: "DUPLICATE_REVIEW", normalizedPayload: normalized.data, lockedAt: null, processedAt: new Date(), lastError: null } });
      if (event.importRowId) await tx.leadImportRow.update({ where: { id: event.importRowId }, data: { status: "DUPLICATE", normalizedData: normalized.data } });
      await refreshBatch(tx, event.importBatchId);
      return { duplicate: true, agencyId: event.agencyId, eventId: event.id };
    }

    // A routing rule match outranks the intake stream's static owner — that
    // static owner is just today's fallback for when nothing more specific
    // matches, not an intentional per-lead choice the way a rule is.
    const routed = await resolveRoutedOwner(tx, event.agencyId, {
      initialMessage: normalized.data.initialMessage,
      immigrationInterest: normalized.data.immigrationInterest,
      province: normalized.data.province,
      preferredLanguage: normalized.data.preferredLanguage,
    }, event.source?.type);
    const ownerUserId = routed?.ownerUserId || event.intakeForm?.ownerUserId || event.sourceConnection?.ownerUserId || settings.ownerUserId;
    if (!ownerUserId) throw new Error("No lead owner is configured for this intake stream.");
    const firstResponseMinutes = event.intakeForm?.firstResponseMinutes || event.sourceConnection?.firstResponseMinutes || Number(settings.firstResponseMinutes) || 15;
    const nextActionAt = new Date(Date.now() + firstResponseMinutes * 60_000);
    const leadNumber = await nextLeadNumber(tx, event.agencyId);
    const lead = await tx.lead.create({ data: {
      agencyId: event.agencyId, leadNumber, firstName: normalized.data.firstName, lastName: normalized.data.lastName,
      phone: normalized.data.phone, phoneNormalized: normalized.data.phoneNormalized,
      email: normalized.data.email, emailNormalized: normalized.data.emailNormalized,
      country: normalized.data.country, province: normalized.data.province, preferredLanguage: normalized.data.preferredLanguage,
      preferredContactTime: normalized.data.preferredContactTime,
      consentGiven: rawPayload.consent === true ? true : null,
      consentGivenAt: rawPayload.consent === true ? new Date() : null,
      currentImmigrationStatus: normalized.data.currentImmigrationStatus, immigrationInterest: normalized.data.immigrationInterest,
      ownerUserId, originalSourceId: event.sourceId, campaignId: event.campaignId, initialMessage: normalized.data.initialMessage,
      utmSource: tracking.utm_source || null, utmMedium: tracking.utm_medium || null, utmCampaign: tracking.utm_campaign || null,
      utmTerm: tracking.utm_term || null, utmContent: tracking.utm_content || null,
      // Every adapter output flows through normalizeIncomingLead, which has
      // no concept of temperature — a provider adapter (currently only
      // WEBSITE) can still set it by attaching a `temperature` field to its
      // output; every other provider's adapted payload never has that key,
      // so this stays "COLD" for them exactly as before.
      status: "OPEN", stage: "NEW", priority: "NORMAL", temperature: rawPayload.temperature || "COLD",
      nextActionType: "CALL", nextActionDescription: "Contact the new lead", nextActionAt, nextActionOwnerId: ownerUserId, firstContactDueAt: nextActionAt,
    } });
    const activityChannel = event.channel === "WHATSAPP_BUSINESS" ? "WHATSAPP" : event.channel === "EMAIL_INTAKE" ? "EMAIL" : event.channel === "PHONE_PROVIDER" ? "PHONE" : ["PUBLIC_FORM", "WEBSITE_CONNECTOR", "META_LEAD_FORM", "GOOGLE_ADS_LEAD_FORM"].includes(event.channel) ? "WEBSITE" : "OTHER";
    await tx.leadActivity.create({ data: { agencyId: event.agencyId, leadId: lead.id, activityType: "LEAD_CREATED", direction: "INTERNAL", channel: activityChannel, title: `Lead created from ${event.sourceConnection?.provider || (event.channel === "PUBLIC_FORM" ? "public intake" : "CSV import")}`, description: normalized.data.initialMessage, metadata: { incomingEventId: event.id, sourceConnectionId: event.sourceConnectionId } } });
    await tx.leadStageHistory.create({ data: { agencyId: event.agencyId, leadId: lead.id, newStage: "NEW", reason: "Created by intake pipeline" } });
    await tx.leadAssignmentHistory.create({ data: { agencyId: event.agencyId, leadId: lead.id, newOwnerId: ownerUserId, assignmentType: routed ? "RULE_BASED" : "SYSTEM", reason: routed ? `Routed by rule "${routed.ruleName}"` : "Intake stream owner" } });
    await tx.leadFollowUp.create({ data: { agencyId: event.agencyId, leadId: lead.id, assignedUserId: ownerUserId, type: "CALL", description: "Contact the new lead", dueAt: nextActionAt } });
    await tx.activityLog.create({ data: { agencyId: event.agencyId, action: "lead.intake_processed", details: `Created ${leadNumber} from ${event.channel}`, entityType: "lead", entityId: lead.id, metadata: { incomingEventId: event.id, importBatchId: event.importBatchId } } });
    await tx.leadIncomingEvent.update({ where: { id: event.id }, data: { status: "PROCESSED", normalizedPayload: normalized.data, processedLeadId: lead.id, lockedAt: null, processedAt: new Date(), lastError: null } });
    if (event.importRowId) await tx.leadImportRow.update({ where: { id: event.importRowId }, data: { status: "PROCESSED", normalizedData: normalized.data, createdLeadId: lead.id } });
    await refreshBatch(tx, event.importBatchId);
    return { agencyId: event.agencyId, eventId: event.id, leadId: lead.id, leadNumber, ownerUserId, firstResponseDueAt: nextActionAt, channel: event.channel, email: lead.email, phone: lead.phone, firstName: lead.firstName };
  }, { maxWait: 10_000, timeout: 30_000 });
  if (result?.agencyId) invalidateDashboardCache(result.agencyId);
  if (result?.agencyId && result?.eventId) {
    await resolveNotifications({
      agencyId: result.agencyId,
      entityType: "lead_incoming_event",
      entityId: result.eventId,
      types: ["lead.intake_failed"],
    });
  }
  if (result?.ownerUserId) {
    await notifyUsers({ agencyId: result.agencyId, recipientIds: [result.ownerUserId], type: "lead.intake_assigned", category: "leads", title: `New lead assigned: ${result.leadNumber}`, body: `First response due ${result.firstResponseDueAt.toISOString()}`, severity: "warning", entityType: "lead", entityId: result.leadId, actionUrl: "/leads", dedupeKey: `lead:${result.leadId}:intake-assigned:${result.ownerUserId}` });
  }
  if (result?.leadId && leadWelcomeEmailEligible(result.channel)) {
    void sendLeadWelcomeEmail(result.agencyId, {
      id: result.leadId,
      email: result.email,
      phone: result.phone,
      firstName: result.firstName,
      sourceChannel: result.channel,
    });
  }
}

async function failEvent(event, error) {
  const terminal = event.attempts + 1 >= event.maxAttempts;
  const retryMs = Math.min(15_000 * 2 ** event.attempts, 60 * 60_000);
  const message = String(error?.message || "Lead intake processing failed").slice(0, 1000);
  await prisma.$transaction(async (tx) => {
    await tx.leadIncomingEvent.update({ where: { id: event.id }, data: { status: terminal ? "FAILED" : "PENDING", lockedAt: null, lastError: message, availableAt: new Date(Date.now() + retryMs) } });
    if (terminal && event.importRowId) await tx.leadImportRow.update({ where: { id: event.importRowId }, data: { status: "FAILED", validationErrors: [message] } });
    if (terminal) await refreshBatch(tx, event.importBatchId);
  });
  if (terminal) {
    await notifyUsers({ agencyId: event.agencyId, recipientIds: await adminRecipientIds(event.agencyId), type: "lead.intake_failed", category: "leads", title: "Lead intake failed", body: message, severity: "critical", entityType: "lead_incoming_event", entityId: event.id, actionUrl: `/app/settings?section=lead-intake&tab=events&event=${encodeURIComponent(event.id)}`, channels: ["in_app"], dedupeKey: `lead-intake:${event.id}:failed:${event.attempts + 1}` });
  }
}

async function processEvent(event) {
  const claimed = await prisma.leadIncomingEvent.updateMany({ where: { id: event.id, status: "PENDING", availableAt: { lte: new Date() } }, data: { status: "PROCESSING", lockedAt: new Date(), attempts: { increment: 1 } } });
  if (!claimed.count) return;
  try { await processClaimed(event.id); }
  catch (error) { await failEvent(event, error); }
}

export async function processLeadIntakeEvents() {
  if (running) return;
  running = true;
  try {
    const stale = new Date(Date.now() - 5 * 60_000);
    await prisma.leadIncomingEvent.updateMany({ where: { status: "PROCESSING", lockedAt: { lt: stale } }, data: { status: "PENDING", lockedAt: null, availableAt: new Date(), lastError: "Recovered after an interrupted intake worker" } });
    const events = await prisma.leadIncomingEvent.findMany({ where: { status: "PENDING", availableAt: { lte: new Date() } }, orderBy: [{ availableAt: "asc" }, { createdAt: "asc" }], take: BATCH_SIZE });
    await Promise.all(events.map(processEvent));
  } catch (error) {
    if (process.env.NODE_ENV !== "test") logger.error("lead_intake.worker_failed", { error: error.message, stack: error.stack });
  } finally { running = false; }
}

export function startLeadIntakeWorker() {
  if (timer || process.env.NODE_ENV === "test") return;
  void processLeadIntakeEvents();
  timer = setInterval(() => void processLeadIntakeEvents(), POLL_MS);
  timer.unref?.();
}

export function stopLeadIntakeWorker() { if (timer) clearInterval(timer); timer = null; }
