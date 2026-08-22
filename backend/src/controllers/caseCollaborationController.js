import {
  listOpenCasesForConsultant,
  listMyCollaborationRequests,
  submitCollaborationRequest,
  withdrawCollaborationRequest,
  getRestrictedCaseAccessPreview,
  approveCollaborationRequest,
  declineCollaborationRequest,
  listReviewableCollaborationRequests,
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
  if (requestedRole === "primary") {
    throw createHttpError(
      409,
      "Primary case ownership is controlled by the required RCIC assignment. Use the case Collaboration panel to change the RCIC.",
      "CASE_WORKER_CONTROLS_OWNERSHIP",
    );
  }
  const note = typeof req.body?.note === "string" ? req.body.note : "";
  const data = await submitCollaborationRequest(req.auth.agencyId, req.auth.userId, { caseId, requestedRole, note });
  res.status(201).json({ data, message: "Request sent to your admin team." });
}

export async function withdrawMyRequest(req, res) {
  const data = await withdrawCollaborationRequest(req.auth.agencyId, req.auth.userId, req.params.id);
  res.json({ data, message: "Request withdrawn." });
}

export async function restrictedCasePreview(req, res) {
  const data = await getRestrictedCaseAccessPreview(req.auth.agencyId, req.auth.userId, req.params.id);
  res.json({ data });
}

export async function requestCaseAccess(req, res) {
  const note = typeof req.body?.note === "string" ? req.body.note : "";
  const data = await submitCollaborationRequest(req.auth.agencyId, req.auth.userId, {
    caseId: req.params.id,
    requestedRole: "supporting",
    note,
  });
  res.status(201).json({ data, message: "Access request sent." });
}

export async function withdrawCaseAccessRequest(req, res) {
  const data = await withdrawCollaborationRequest(req.auth.agencyId, req.auth.userId, req.params.requestId);
  res.json({ data, message: "Access request cancelled." });
}

export async function approveCaseAccessRequest(req, res) {
  const data = await approveCollaborationRequest(req.auth.agencyId, req.auth.userId, req.params.requestId, { reviewNote: req.body?.reviewNote });
  res.json({ data, message: "Collaborator access approved." });
}

export async function declineCaseAccessRequest(req, res) {
  const data = await declineCollaborationRequest(req.auth.agencyId, req.auth.userId, req.params.requestId, { reviewNote: req.body?.reviewNote });
  res.json({ data, message: "Access request declined." });
}

export async function listReviewableCaseAccessRequests(req, res) {
  const data = await listReviewableCollaborationRequests(req.auth.agencyId, req.auth.userId);
  res.json({ data });
}
