import { estimateCaseTimelineProgress } from "../services/incentiveTimelineService.js";

export async function getCaseTimelineProgress(req, res) {
  const data = await estimateCaseTimelineProgress(req.auth.agencyId, req.params.id);
  res.json({ data });
}
