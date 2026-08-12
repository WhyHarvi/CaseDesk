import prisma from "../../services/prisma/client.js";
import { logger } from "../../services/logger.js";
import { runStaleLeadOutreachPass } from "./lead.staleOutreach.service.js";

const POLL_MS = Math.max(Number(process.env.LEAD_STALE_OUTREACH_POLL_MS) || 3_600_000, 60_000);
let timer = null;
let running = false;

async function run() {
  if (running) return;
  running = true;
  try {
    const result = await runStaleLeadOutreachPass(prisma);
    if (result.leads) logger.info("lead.stale_outreach_pass_completed", result);
  } catch (error) {
    logger.warn("lead.stale_outreach_worker_failed", { reason: error.message });
  } finally {
    running = false;
  }
}

export function startLeadStaleOutreachWorker() {
  if (timer) return;
  timer = setInterval(run, POLL_MS);
  void run();
  if (timer.unref) timer.unref();
}

export function stopLeadStaleOutreachWorker() {
  if (timer) clearInterval(timer);
  timer = null;
}
