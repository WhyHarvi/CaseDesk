import { getTeamWorkloadReport, getWorkloadDailyTrend } from "./workload.report.service.js";
import { recordPortalActivityPing } from "./workload.heartbeat.service.js";

export async function getTeamWorkload(req, res) {
  res.json({ data: await getTeamWorkloadReport(req) });
}

export async function getDailyTrend(req, res) {
  res.json({ data: await getWorkloadDailyTrend(req) });
}

export async function pingPortalActivity(req, res) {
  await recordPortalActivityPing({ agencyId: req.auth.agencyId, userId: req.auth.userId });
  res.status(204).end();
}
