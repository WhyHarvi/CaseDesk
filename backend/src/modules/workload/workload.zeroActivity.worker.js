import prisma from "../../services/prisma/client.js";
import { logger } from "../../services/logger.js";
import { runZeroActivityAlertPass } from "./workload.zeroActivity.service.js";

// Daily sweep is plenty — this checks whole working days, not minutes, so
// there's nothing to gain from polling more often than that. Floor still
// protects against a misconfigured env value hammering the DB.
const POLL_MS = Math.max(Number(process.env.WORKLOAD_ZERO_ACTIVITY_POLL_MS) || 24 * 60 * 60_000, 60_000);
let timer = null;
let running = false;

async function run() {
  if (running) return;
  running = true;
  try {
    const result = await runZeroActivityAlertPass(prisma);
    if (result.flagged) logger.info("workload.zero_activity_sweep_completed", result);
  } catch (error) {
    logger.warn("workload.zero_activity_worker_failed", { reason: error.message });
  } finally {
    running = false;
  }
}

export function startWorkloadZeroActivityWorker() {
  if (timer) return;
  timer = setInterval(run, POLL_MS);
  void run();
  if (timer.unref) timer.unref();
}

export function stopWorkloadZeroActivityWorker() {
  if (timer) clearInterval(timer);
  timer = null;
}
