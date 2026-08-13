import prisma from "../../services/prisma/client.js";
import { logger } from "../../services/logger.js";
import { runOverdueLeadAlertPass } from "./lead.overdueAlert.service.js";

// The dedupe key already caps actual notifications to once per owner per
// day, so there's nothing to gain from polling more often than a few times
// a day — this just needs to run at least once during the working day.
const POLL_MS = Math.max(Number(process.env.LEAD_OVERDUE_ALERT_POLL_MS) || 4 * 60 * 60_000, 60_000);
let timer = null;
let running = false;

async function run() {
  if (running) return;
  running = true;
  try {
    const result = await runOverdueLeadAlertPass(prisma);
    if (result.ownersNotified) logger.info("lead.overdue_alert_sweep_completed", result);
  } catch (error) {
    logger.warn("lead.overdue_alert_worker_failed", { reason: error.message });
  } finally {
    running = false;
  }
}

export function startLeadOverdueAlertWorker() {
  if (timer) return;
  timer = setInterval(run, POLL_MS);
  void run();
  if (timer.unref) timer.unref();
}

export function stopLeadOverdueAlertWorker() {
  if (timer) clearInterval(timer);
  timer = null;
}
