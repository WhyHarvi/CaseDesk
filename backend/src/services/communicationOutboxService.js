import prisma from "./prisma/client.js";
import {
  sendEmailMessage,
  sendOomaSms,
  startOomaCall,
} from "./communicationProviderService.js";
import { recordCommunicationAudit } from "./communicationAudit.js";
import path from "node:path";
import { fileURLToPath } from "node:url";

const POLL_INTERVAL_MS = Math.max(Number(process.env.COMMUNICATION_OUTBOX_POLL_MS) || 2500, 500);
const BATCH_SIZE = Math.min(Math.max(Number(process.env.COMMUNICATION_OUTBOX_BATCH_SIZE) || 10, 1), 50);
let timer = null;
let running = false;
const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
const storageRoot = path.resolve(process.env.DOCUMENT_STORAGE_PATH || path.join(moduleDirectory, "../../storage/documents"));

const text = (value, max = 1000) => String(value || "").slice(0, max);

async function deliver(job) {
  const payload = job.payload && typeof job.payload === "object" ? job.payload : {};
  const attachments = job.message.attachmentRecords.map((item) => ({
    filename: item.originalFilename,
    path: path.resolve(storageRoot, ...String(item.storageKey).split("/").filter(Boolean)),
    contentType: item.mimeType,
  }));
  if (job.message.channel === "Email") {
    return sendEmailMessage({
      agencyId: job.agencyId,
      to: Array.isArray(payload.recipients) ? payload.recipients : [],
      cc: Array.isArray(payload.cc) ? payload.cc : [],
      bcc: Array.isArray(payload.bcc) ? payload.bcc : [],
      replyTo: payload.replyTo || undefined,
      subject: payload.subject || undefined,
      text: payload.bodyText || undefined,
      html: payload.bodyHtml || undefined,
      headers: payload.headers || undefined,
      attachments,
      messageId: payload.messageId || undefined,
    });
  }
  if (job.message.channel === "Sms") {
    return sendOomaSms({
      agencyId: job.agencyId,
      to: Array.isArray(payload.recipients) ? payload.recipients[0] : null,
      body: payload.bodyText || "",
      idempotencyKey: job.message.idempotencyKey || job.message.id,
    });
  }
  if (job.message.channel === "Call") {
    return startOomaCall({
      agencyId: job.agencyId,
      to: Array.isArray(payload.recipients) ? payload.recipients[0] : null,
      idempotencyKey: job.message.idempotencyKey || job.message.id,
    });
  }
  throw new Error(`Unsupported outbox channel: ${job.message.channel}`);
}

async function claim(job) {
  const result = await prisma.communicationOutbox.updateMany({
    where: { id: job.id, status: "Pending", availableAt: { lte: new Date() } },
    data: { status: "Processing", lockedAt: new Date(), attempts: { increment: 1 } },
  });
  if (result.count === 1) {
    await prisma.communicationMessage.update({ where: { id: job.messageId }, data: { status: "Sending" } });
    return true;
  }
  return false;
}

async function complete(job, result) {
  const at = new Date();
  await prisma.$transaction([
    prisma.communicationMessage.update({
      where: { id: job.messageId },
      data: {
        status: job.message.channel === "Call" ? "Sent" : "Sent",
        provider: result?.provider || job.message.provider,
        providerMessageId: result?.id ? String(result.id) : job.message.providerMessageId,
        emailMessageId: job.message.channel === "Email" && result?.id ? String(result.id) : job.message.emailMessageId,
        sentAt: at,
        occurredAt: at,
        failedAt: null,
        failureReason: null,
      },
    }),
    prisma.communicationOutbox.update({
      where: { id: job.id },
      data: { status: "Completed", completedAt: at, lockedAt: null, lastError: null },
    }),
    prisma.communicationDeliveryEvent.create({
      data: {
        agencyId: job.agencyId,
        messageId: job.messageId,
        type: job.message.channel === "Call" ? "CallInitiated" : "ProviderAccepted",
        details: `${job.message.channel} accepted by ${result?.provider || job.message.provider || "provider"}`,
        metadata: result?.response || {},
      },
    }),
  ]);
  await recordCommunicationAudit({
    agencyId: job.agencyId,
    conversationId: job.message.conversationId,
    messageId: job.messageId,
    action: "communication.provider_accepted",
    details: `${job.message.channel} accepted for delivery`,
  });
}

async function fail(job, error) {
  const attempts = job.attempts + 1;
  const terminal = attempts >= job.maxAttempts;
  const delaySeconds = Math.min(15 * 2 ** Math.max(attempts - 1, 0), 3600);
  const at = new Date();
  const reason = text(error?.message || "Provider delivery failed", 1000);
  await prisma.$transaction([
    prisma.communicationOutbox.update({
      where: { id: job.id },
      data: {
        status: terminal ? "Failed" : "Pending",
        lockedAt: null,
        availableAt: new Date(at.getTime() + delaySeconds * 1000),
        lastError: reason,
      },
    }),
    prisma.communicationMessage.update({
      where: { id: job.messageId },
      data: terminal
        ? { status: "Failed", failedAt: at, failureReason: reason }
        : { status: "Queued", failureReason: reason },
    }),
    prisma.communicationDeliveryEvent.create({
      data: {
        agencyId: job.agencyId,
        messageId: job.messageId,
        type: terminal ? "DeliveryFailed" : "DeliveryRetryScheduled",
        details: reason,
        metadata: { attempt: attempts, maxAttempts: job.maxAttempts, retryInSeconds: terminal ? null : delaySeconds },
      },
    }),
  ]);
}

async function processJob(job) {
  if (!(await claim(job))) return;
  try {
    const result = await deliver(job);
    await complete(job, result);
  } catch (error) {
    await fail(job, error);
  }
}

export async function processCommunicationOutbox() {
  if (running) return;
  running = true;
  try {
    const staleBefore = new Date(Date.now() - 5 * 60 * 1000);
    await prisma.communicationOutbox.updateMany({
      where: { status: "Processing", lockedAt: { lt: staleBefore } },
      data: { status: "Pending", lockedAt: null, availableAt: new Date(), lastError: "Recovered after an interrupted delivery worker" },
    });
    const jobs = await prisma.communicationOutbox.findMany({
      where: { status: "Pending", availableAt: { lte: new Date() } },
      orderBy: [{ availableAt: "asc" }, { createdAt: "asc" }],
      take: BATCH_SIZE,
      include: { message: { include: { attachmentRecords: { where: { scanStatus: "Clean" } } } } },
    });
    await Promise.all(jobs.map(processJob));
  } catch (error) {
    if (process.env.NODE_ENV !== "test") console.error("Communication outbox worker failed", error);
  } finally {
    running = false;
  }
}

export function startCommunicationOutboxWorker() {
  if (timer || process.env.NODE_ENV === "test") return;
  void processCommunicationOutbox();
  timer = setInterval(() => void processCommunicationOutbox(), POLL_INTERVAL_MS);
  timer.unref?.();
}

export function stopCommunicationOutboxWorker() {
  if (timer) clearInterval(timer);
  timer = null;
}
