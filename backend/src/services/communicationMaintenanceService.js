import { unlink } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import prisma from "./prisma/client.js";
import { applyCommunicationAutomations } from "./communicationAutomationService.js";
import { recordCommunicationAudit } from "./communicationAudit.js";

const INTERVAL_MS = Math.max(
  Number(process.env.COMMUNICATION_MAINTENANCE_MS) || 60_000,
  15_000,
);
const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
const storageRoot = path.resolve(
  process.env.DOCUMENT_STORAGE_PATH ||
    path.join(moduleDirectory, "../../storage/documents"),
);
let timer = null;
let running = false;

function filePath(storageKey) {
  const resolved = path.resolve(
    storageRoot,
    ...String(storageKey).split("/").filter(Boolean),
  );
  return resolved.startsWith(`${storageRoot}${path.sep}`) ? resolved : null;
}

async function wakeSnoozedConversations(now) {
  const items = await prisma.communicationConversation.findMany({
    where: { state: "Snoozed", snoozedUntil: { lte: now }, deletedAt: null },
    take: 100,
  });
  for (const item of items) {
    const state =
      item.lastInboundAt &&
      (!item.lastOutboundAt || item.lastInboundAt > item.lastOutboundAt)
        ? "WaitingOnAgency"
        : "WaitingOnClient";
    await prisma.communicationConversation.update({
      where: { id: item.id },
      data: { state, snoozedUntil: null },
    });
    await recordCommunicationAudit({
      agencyId: item.agencyId,
      conversationId: item.id,
      action: "communication.snooze_ended",
      details: "Conversation returned to the active inbox",
    });
  }
}

async function processOverdueConversations(now) {
  const items = await prisma.communicationConversation.findMany({
    where: {
      responseDueAt: { lt: now },
      firstRespondedAt: null,
      state: "WaitingOnAgency",
      deletedAt: null,
    },
    include: {
      case: true,
      client: true,
      messages: {
        where: { direction: "Inbound", deletedAt: null },
        orderBy: { occurredAt: "desc" },
        take: 1,
      },
    },
    take: 100,
  });
  for (const item of items) {
    const tags = Array.isArray(item.tags) ? item.tags : [];
    if (tags.includes("sla-breached") || !item.messages[0]) continue;
    await applyCommunicationAutomations({
      agencyId: item.agencyId,
      trigger: "ConversationOverdue",
      message: item.messages[0],
      conversation: item,
      caseItem: item.case,
      client: item.client,
    });
    await prisma.communicationConversation.update({
      where: { id: item.id },
      data: { tags: [...new Set([...tags, "sla-breached"])] },
    });
    await recordCommunicationAudit({
      agencyId: item.agencyId,
      conversationId: item.id,
      messageId: item.messages[0].id,
      action: "communication.sla_breached",
      details: "First-response target was missed",
      metadata: { responseDueAt: item.responseDueAt },
    });
  }
}

async function processOverdueResolutions(now) {
  const items = await prisma.communicationConversation.findMany({
    where: {
      resolutionDueAt: { lt: now },
      state: { not: "Closed" },
      deletedAt: null,
    },
    include: {
      case: true,
      client: true,
      messages: {
        where: { deletedAt: null },
        orderBy: { occurredAt: "desc" },
        take: 1,
      },
    },
    take: 100,
  });
  for (const item of items) {
    const tags = Array.isArray(item.tags) ? item.tags : [];
    if (tags.includes("resolution-overdue") || !item.messages[0]) continue;
    await applyCommunicationAutomations({
      agencyId: item.agencyId,
      trigger: "ResolutionOverdue",
      message: item.messages[0],
      conversation: item,
      caseItem: item.case,
      client: item.client,
    });
    await prisma.communicationConversation.update({
      where: { id: item.id },
      data: { tags: [...new Set([...tags, "resolution-overdue"])] },
    });
    await recordCommunicationAudit({
      agencyId: item.agencyId,
      conversationId: item.id,
      messageId: item.messages[0].id,
      action: "communication.resolution_target_missed",
      details: "Conversation resolution target was missed",
      metadata: { resolutionDueAt: item.resolutionDueAt },
    });
  }
}

async function purgeExpiredTrash(now) {
  const policies = await prisma.communicationRetentionPolicy.findMany();
  for (const policy of policies) {
    const cutoff = new Date(now.getTime() - policy.trashDays * 86_400_000);
    const messages = await prisma.communicationMessage.findMany({
      where: {
        agencyId: policy.agencyId,
        deletedAt: { lte: cutoff },
        conversation: { legalHold: false },
      },
      select: { id: true, attachmentRecords: { select: { storageKey: true } } },
      take: 250,
    });
    if (!messages.length) continue;
    await prisma.communicationMessage.deleteMany({
      where: { id: { in: messages.map((item) => item.id) } },
    });
    await Promise.all(
      messages
        .flatMap((item) => item.attachmentRecords)
        .map((attachment) => {
          const target = filePath(attachment.storageKey);
          return target ? unlink(target).catch(() => {}) : Promise.resolve();
        }),
    );
    await prisma.communicationConversation.deleteMany({
      where: {
        agencyId: policy.agencyId,
        deletedAt: { lte: cutoff },
        legalHold: false,
        messages: { none: {} },
      },
    });
    await recordCommunicationAudit({
      agencyId: policy.agencyId,
      action: "communication.trash_purged",
      details: `${messages.length} expired communication records were permanently removed`,
      metadata: { cutoff, trashDays: policy.trashDays },
    });
  }
}

export async function runCommunicationMaintenance() {
  if (running) return;
  running = true;
  try {
    const now = new Date();
    await wakeSnoozedConversations(now);
    await processOverdueConversations(now);
    await processOverdueResolutions(now);
    await purgeExpiredTrash(now);
  } catch (error) {
    if (process.env.NODE_ENV !== "test")
      console.error("Communication maintenance failed", error);
  } finally {
    running = false;
  }
}

export function startCommunicationMaintenance() {
  if (timer || process.env.NODE_ENV === "test") return;
  void runCommunicationMaintenance();
  timer = setInterval(() => void runCommunicationMaintenance(), INTERVAL_MS);
  timer.unref?.();
}

export function stopCommunicationMaintenance() {
  if (timer) clearInterval(timer);
  timer = null;
}
