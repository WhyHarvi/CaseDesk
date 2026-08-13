import {
  listOpenCasesForConsultant,
  listMyCollaborationRequests,
  submitCollaborationRequest,
  withdrawCollaborationRequest,
} from "../services/caseCollaborationService.js";
import { createHttpError } from "../utils/http.js";

export async function listOpenCases(req, res) {
  const caseType = typeof req.query.caseType === "string" ? req.query.caseType.trim() : "";
  const limit = Number.parseInt(req.query.limit, 10) || 50;
  const data = await listOpenCasesForConsultant(req.auth.agencyId, req.auth.userId, { caseType: caseType || undefined, limit });
  res.json({ data });
}

export async function listMyRequests(req, res) {
  const data = await listMyCollaborationRequests(req.auth.agencyId, req.auth.userId);
  res.json({ data });
}

export async function createCollaborationRequest(req, res) {
  const caseId = typeof req.body?.caseId === "string" ? req.body.caseId.trim() : "";
  if (!caseId) throw createHttpError(400, "Choose a case to request.", "VALIDATION_ERROR");
  const requestedRole = typeof req.body?.requestedRole === "string" ? req.body.requestedRole.trim() : "supporting";
  const note = typeof req.body?.note === "string" ? req.body.note : "";
  const data = await submitCollaborationRequest(req.auth.agencyId, req.auth.userId, { caseId, requestedRole, note });
  res.status(201).json({ data, message: "Request sent to your admin team." });
}

export async function withdrawMyRequest(req, res) {
  const data = await withdrawCollaborationRequest(req.auth.agencyId, req.auth.userId, req.params.id);
  res.json({ data, message: "Request withdrawn." });
}
