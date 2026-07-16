import { monitorAssignedCaseFormRevisions } from "../controllers/caseFormController.js";

let monitor = null;

export function startFormRevisionMonitor() {
  if (
    monitor ||
    process.env.FORM_REVISION_MONITOR === "false" ||
    process.env.NODE_ENV === "test"
  )
    return monitor;
  const intervalMs = Math.max(
    Number(process.env.FORM_REVISION_MONITOR_INTERVAL_MS) ||
      24 * 60 * 60 * 1000,
    60 * 60 * 1000,
  );
  const initialDelayMs = Math.max(
    Number(process.env.FORM_REVISION_MONITOR_INITIAL_DELAY_MS) || 5 * 60 * 1000,
    30 * 1000,
  );
  const run = async () => {
    try {
      const summary = await monitorAssignedCaseFormRevisions();
      console.log("Case form revision monitor complete", summary);
    } catch (error) {
      console.error("Case form revision monitor failed", error);
    }
  };
  const initial = setTimeout(run, initialDelayMs);
  initial.unref?.();
  const interval = setInterval(run, intervalMs);
  interval.unref?.();
  monitor = { initial, interval };
  return monitor;
}

export function stopFormRevisionMonitor() {
  if (!monitor) return;
  clearTimeout(monitor.initial);
  clearInterval(monitor.interval);
  monitor = null;
}
