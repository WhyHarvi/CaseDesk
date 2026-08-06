import prisma from "../../services/prisma/client.js";
import { logger } from "../../services/logger.js";

const POLL_MS = Math.max(Number(process.env.LEAD_REACTIVATION_POLL_MS) || 120_000, 30_000);
let timer = null;
let running = false;

export async function reactivateDueNurtureLeads(db = prisma, now = new Date()) {
  const due = await db.lead.findMany({
    where: { status: "NURTURE", nurtureUntil: { lte: now }, deletedAt: null },
    select: { id: true, agencyId: true, leadNumber: true },
    take: 100,
  });
  let reactivated = 0;
  for (const lead of due) {
    const changed = await db.$transaction(async (tx) => {
      const updated = await tx.lead.updateMany({
        where: { id: lead.id, agencyId: lead.agencyId, status: "NURTURE", nurtureUntil: { lte: now } },
        data: { status: "OPEN", nurtureUntil: null, nextActionType: null, nextActionDescription: null, nextActionAt: null, nextActionOwnerId: null, version: { increment: 1 } },
      });
      if (!updated.count) return false;
      await tx.leadFollowUp.updateMany({
        where: { agencyId: lead.agencyId, leadId: lead.id, status: "PENDING" },
        data: { status: "COMPLETED", completedAt: now, completionOutcome: "Automatically reactivated" },
      });
      await tx.leadActivity.create({
        data: { agencyId: lead.agencyId, leadId: lead.id, activityType: "LEAD_REACTIVATED", direction: "INTERNAL", channel: "SYSTEM", title: "Lead automatically reactivated from nurture", description: "The scheduled reactivation date was reached." },
      });
      return true;
    });
    if (changed) reactivated += 1;
  }
  return { checked: due.length, reactivated };
}

async function run() {
  if (running) return;
  running = true;
  try {
    await reactivateDueNurtureLeads();
  } catch (error) {
    logger.warn("lead_reactivation.worker_failed", { reason: error.message });
  } finally {
    running = false;
  }
}

export function startLeadReactivationWorker() {
  if (timer) return;
  timer = setInterval(run, POLL_MS);
  void run();
  if (timer.unref) timer.unref();
}

export function stopLeadReactivationWorker() {
  if (timer) clearInterval(timer);
  timer = null;
}
