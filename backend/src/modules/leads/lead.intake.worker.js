import prisma from "../../services/prisma/client.js";
import { nextLeadNumber } from "./lead.repository.js";
import { normalizeIncomingLead } from "./lead.intake.validation.js";
import { adaptProviderPayload } from "./lead.provider.adapters.js";
import { enrichProviderPayload } from "./lead.provider.enrichment.js";
import { logger } from "../../services/logger.js";
import { adminRecipientIds, notifyUsers } from "../../services/notificationService.js";
import { invalidateDashboardCache } from "../../services/dashboardCache.js";
import { leadWelcomeEmailEligible, sendLeadWelcomeEmail } from "./lead.welcomeEmail.service.js";

const POLL_MS = Math.max(Number(process.env.LEAD_INTAKE_POLL_MS) || 2000, 500);
const BATCH_SIZE = Math.min(Math.max(Number(process.env.LEAD_INTAKE_BATCH_SIZE) || 10, 1), 50);
let timer = null;
let running = false;

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
  if (!or.length) return [];
  const leads = await tx.lead.findMany({ where: { agencyId: event.agencyId, deletedAt: null, OR: or }, select: { id: true, phoneNormalized: true, emailNormalized: true } });
  return leads.map((lead) => {
    const reasons = [];
    let score = 0;
    if (lead.phoneNormalized === normalized.phoneNormalized) { reasons.push("Exact phone match"); score = 100; }
    if (normalized.emailNormalized && lead.emailNormalized === normalized.emailNormalized) { reasons.push("Exact email match"); score = Math.max(score, 90); }
    return { leadId: lead.id, score, reasons };
  });
}

async function processClaimed(eventId) {
  const result = await prisma.$transaction(async (tx) => {
    const event = await tx.leadIncomingEvent.findUnique({ where: { id: eventId }, include: { intakeForm: true, importBatch: true, sourceConnection: true } });
    if (!event || event.status !== "PROCESSING") return;
    const settings = event.importBatch?.settings && typeof event.importBatch.settings === "object" ? event.importBatch.settings : {};
    const mapping = event.channel === "CSV_IMPORT" ? settings.mapping : null;
    const enrichedPayload = event.sourceConnection ? await enrichProviderPayload(event.sourceConnection, event.rawPayload) : event.rawPayload;
    const rawPayload = event.sourceConnection ? adaptProviderPayload(event.sourceConnection.provider, enrichedPayload) : event.rawPayload;
    // Website contact forms commonly collect only an email (or only a
    // phone) — requiring both, the way most other providers' structured
    // lead-form data allows us to, would silently reject valid leads.
    const allowEmailOnly = ["EMAIL", "WEBSITE"].includes(event.sourceConnection?.provider);
    const normalized = normalizeIncomingLead(rawPayload, mapping, { allowEmailOnly });
    if (normalized.errors.length) throw new Error(normalized.errors.join(" "));
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

    const ownerUserId = event.intakeForm?.ownerUserId || event.sourceConnection?.ownerUserId || settings.ownerUserId;
    if (!ownerUserId) throw new Error("No lead owner is configured for this intake stream.");
    const firstResponseMinutes = event.intakeForm?.firstResponseMinutes || event.sourceConnection?.firstResponseMinutes || Number(settings.firstResponseMinutes) || 15;
    const nextActionAt = new Date(Date.now() + firstResponseMinutes * 60_000);
    const leadNumber = await nextLeadNumber(tx, event.agencyId);
    const lead = await tx.lead.create({ data: {
      agencyId: event.agencyId, leadNumber, firstName: normalized.data.firstName, lastName: normalized.data.lastName,
      phone: normalized.data.phone, phoneNormalized: normalized.data.phoneNormalized,
      email: normalized.data.email, emailNormalized: normalized.data.emailNormalized,
      country: normalized.data.country, province: normalized.data.province, preferredLanguage: normalized.data.preferredLanguage,
      currentImmigrationStatus: normalized.data.currentImmigrationStatus, immigrationInterest: normalized.data.immigrationInterest,
      ownerUserId, originalSourceId: event.sourceId, campaignId: event.campaignId, initialMessage: normalized.data.initialMessage,
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
    await tx.leadAssignmentHistory.create({ data: { agencyId: event.agencyId, leadId: lead.id, newOwnerId: ownerUserId, assignmentType: "SYSTEM", reason: "Intake stream owner" } });
    await tx.leadFollowUp.create({ data: { agencyId: event.agencyId, leadId: lead.id, assignedUserId: ownerUserId, type: "CALL", description: "Contact the new lead", dueAt: nextActionAt } });
    await tx.activityLog.create({ data: { agencyId: event.agencyId, action: "lead.intake_processed", details: `Created ${leadNumber} from ${event.channel}`, entityType: "lead", entityId: lead.id, metadata: { incomingEventId: event.id, importBatchId: event.importBatchId } } });
    await tx.leadIncomingEvent.update({ where: { id: event.id }, data: { status: "PROCESSED", normalizedPayload: normalized.data, processedLeadId: lead.id, lockedAt: null, processedAt: new Date(), lastError: null } });
    if (event.importRowId) await tx.leadImportRow.update({ where: { id: event.importRowId }, data: { status: "PROCESSED", normalizedData: normalized.data, createdLeadId: lead.id } });
    await refreshBatch(tx, event.importBatchId);
    return { agencyId: event.agencyId, leadId: lead.id, leadNumber, ownerUserId, firstResponseDueAt: nextActionAt, channel: event.channel, email: lead.email, phone: lead.phone, firstName: lead.firstName };
  }, { maxWait: 10_000, timeout: 30_000 });
  if (result?.agencyId) invalidateDashboardCache(result.agencyId);
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
    await notifyUsers({ agencyId: event.agencyId, recipientIds: await adminRecipientIds(event.agencyId), type: "lead.intake_failed", category: "leads", title: "Lead intake failed", body: message, severity: "critical", entityType: "lead_incoming_event", entityId: event.id, actionUrl: "/lead-intake", channels: ["in_app"], dedupeKey: `lead-intake:${event.id}:failed:${event.attempts + 1}` });
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
