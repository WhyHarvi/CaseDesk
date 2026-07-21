import prisma from "../services/prisma/client.js";
import { createHttpError } from "../utils/http.js";
import { recordActivity } from "../utils/prismaCrud.js";
import { updateNormalizedQuestionnaireAssignment } from "../services/questionnaireAssignmentService.js";
import { clientRecipientIds, notifyUsers } from "../services/notificationService.js";

async function findScopedCase(req) {
  const data = await prisma.case.findFirst({
    where: { id: req.params.id, agencyId: req.user.agencyId },
    select: { id: true, clientId: true },
  });
  if (!data) throw createHttpError(404, "Case not found");
  return data;
}

/**
 * Consultant review action on a client's submitted questionnaire —
 * approve, or request a correction. Mirrors the exact dual-write pattern
 * submitPortalQuestionnaire (clientPortalController.js) already uses: the
 * client portal's own "is this locked / pending" checks read
 * formData.questionnaireAssignments directly, not the normalized
 * QuestionnaireAssignment table, so a correction request that only touched
 * the table would silently fail to reopen the questionnaire for the
 * client. reviewedAt/reviewedById/correctionRequestedAt/correctionNote are
 * new in Phase 2 and nothing else reads them from formData, so those stay
 * table-only.
 */
export async function reviewQuestionnaireAssignment(req, res) {
  const scopedCase = await findScopedCase(req);
  const decision = req.body.decision;
  if (decision !== "approve" && decision !== "request_correction") {
    throw createHttpError(400, "decision must be \"approve\" or \"request_correction\"");
  }

  const assignment = await prisma.questionnaireAssignment.findFirst({
    where: { id: req.params.assignmentId, agencyId: req.user.agencyId, caseId: scopedCase.id },
  });
  if (!assignment) throw createHttpError(404, "Questionnaire assignment not found");

  if (decision === "approve") {
    const updated = await updateNormalizedQuestionnaireAssignment({
      assessmentId: assignment.assessmentId,
      sourceId: assignment.sourceId,
      data: { reviewedAt: new Date(), reviewedById: req.user.id, correctionRequestedAt: null, correctionNote: null },
    });
    if (updated.count !== 1) throw createHttpError(404, "Questionnaire assignment not found");
    await recordActivity({
      agencyId: req.user.agencyId,
      userId: req.user.id,
      clientId: scopedCase.clientId,
      caseId: scopedCase.id,
      action: "questionnaire.reviewed",
      details: `${assignment.name} approved`,
      entityType: "questionnaire_assignment",
      entityId: assignment.id,
    });
    const result = await prisma.questionnaireAssignment.findUnique({ where: { id: assignment.id } });
    return res.json({ data: result });
  }

  const note = String(req.body.note || "").trim().slice(0, 1000);
  if (!note) throw createHttpError(400, "note is required when requesting a correction");

  const now = new Date();
  const assessment = await prisma.caseAssessment.findUnique({ where: { id: assignment.assessmentId } });
  const formData = assessment?.formData || {};
  const assignments = Array.isArray(formData.questionnaireAssignments) ? formData.questionnaireAssignments : [];
  const nextFormData = {
    ...formData,
    questionnaireAssignments: assignments.map((item) =>
      item.id === assignment.sourceId ? { ...item, status: "Correction Requested", locked: false, updatedAt: now.toISOString() } : item,
    ),
  };
  const nextSourceData = nextFormData.questionnaireAssignments.find((item) => item.id === assignment.sourceId) || assignment.sourceData;

  await prisma.$transaction([
    prisma.caseAssessment.update({ where: { id: assessment.id }, data: { formData: nextFormData } }),
    prisma.questionnaireAssignment.update({
      where: { id: assignment.id },
      data: {
        status: "Correction Requested",
        locked: false,
        correctionRequestedAt: now,
        correctionNote: note,
        reviewedAt: null,
        reviewedById: null,
        sourceData: nextSourceData,
      },
    }),
  ]);

  const clientUsers = await clientRecipientIds(req.user.agencyId, scopedCase.clientId);
  await notifyUsers({
    agencyId: req.user.agencyId,
    recipientIds: clientUsers,
    actorUserId: req.user.id,
    type: "questionnaire.correction_requested",
    category: "questionnaires",
    title: `Correction requested: ${assignment.name}`,
    body: note,
    severity: "warning",
    entityType: "questionnaire_assignment",
    entityId: assignment.id,
    actionUrl: "/client-portal/questionnaires",
    dedupeKey: `questionnaire:${assignment.id}:correction_requested:${now.toISOString()}`,
  });

  await recordActivity({
    agencyId: req.user.agencyId,
    userId: req.user.id,
    clientId: scopedCase.clientId,
    caseId: scopedCase.id,
    action: "questionnaire.correction_requested",
    details: `${assignment.name}: ${note}`,
    entityType: "questionnaire_assignment",
    entityId: assignment.id,
  });

  const result = await prisma.questionnaireAssignment.findUnique({ where: { id: assignment.id } });
  res.json({ data: result });
}
