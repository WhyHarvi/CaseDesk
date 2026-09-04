import prisma from "../services/prisma/client.js";
import { caseAccessWhere } from "../middleware/authorization.js";
import { createHttpError } from "../utils/http.js";
import { recordActivity } from "../utils/prismaCrud.js";
import {
  assignDefaultWorkflowToCase,
  canonicalCaseType,
  evaluateWorkflowStepStageTriggers,
  normalizeCaseType,
} from "../services/workflowService.js";
import { listAgencyCaseTypeOptions } from "../services/caseTypeOptionsService.js";
import { evaluateStageTriggers } from "../services/paymentScheduleService.js";
import { evaluateCaseTimelineLegs } from "../services/incentiveTimelineService.js";
import { invalidateDashboardCache } from "../services/dashboardCache.js";
import { logger } from "../services/logger.js";
import { creditStudyPermitMilestone, recordPendingStudyPermitMilestoneEvent, STUDY_PERMIT_MILESTONES } from "../services/incentiveExpansionService.js";

const DECISION_OUTCOMES = new Set(["APPROVED", "REFUSED"]);
const REFUSAL_RESOLUTIONS = new Set(["NEW_CASE", "CLOSE_FILE"]);

function text(value, max = 500) {
  return String(value ?? "").trim().slice(0, max);
}

function dateOnly(value, field, { required = false } = {}) {
  const raw = text(value, 10);
  if (!raw) {
    if (required) throw createHttpError(400, `${field} is required.`, "VALIDATION_ERROR");
    return null;
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    throw createHttpError(400, `${field} must use YYYY-MM-DD format.`, "VALIDATION_ERROR");
  }
  const date = new Date(`${raw}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== raw) {
    throw createHttpError(400, `${field} is not a valid calendar date.`, "VALIDATION_ERROR");
  }
  return { raw, date };
}

function decisionRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    caseId: row.caseId,
    decisionOutcome: row.decisionOutcome,
    decisionDate: row.decisionDate ? String(row.decisionDate).slice(0, 10) : null,
    permitExpiryDate: row.permitExpiryDate ? String(row.permitExpiryDate).slice(0, 10) : null,
    refusalResolution: row.refusalResolution,
    successorCaseId: row.successorCaseId,
    recordedById: row.recordedById,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

async function getDecision(db, agencyId, caseId) {
  const rows = await db.$queryRaw`
    SELECT
      "id",
      "case_id" AS "caseId",
      "decision_outcome" AS "decisionOutcome",
      "decision_date" AS "decisionDate",
      "permit_expiry_date" AS "permitExpiryDate",
      "refusal_resolution" AS "refusalResolution",
      "successor_case_id" AS "successorCaseId",
      "recorded_by_id" AS "recordedById",
      "created_at" AS "createdAt",
      "updated_at" AS "updatedAt"
    FROM "case_decisions"
    WHERE "agency_id" = ${agencyId} AND "case_id" = ${caseId}
    LIMIT 1
  `;
  return decisionRow(rows[0] || null);
}

async function requireCase(req, select = null) {
  const item = await prisma.case.findFirst({
    where: {
      id: req.params.id,
      agencyId: req.auth.agencyId,
      deletedAt: null,
      ...caseAccessWhere(req),
    },
    ...(select ? { select } : {}),
  });
  if (!item) throw createHttpError(404, "Case not found.", "NOT_FOUND");
  return item;
}

async function runStageAutomations(agencyId, caseId, clientId, previousStage, nextStage, actorUserId, occurredAt = new Date()) {
  if (previousStage === nextStage) return;
  await evaluateStageTriggers(agencyId, caseId, previousStage, nextStage, actorUserId).catch((error) => {
    logger.warn("case.lifecycle_payment_trigger_failed", { caseId, reason: error.message });
  });
  await evaluateWorkflowStepStageTriggers(agencyId, caseId, previousStage, nextStage, {
    actorUserId,
    clientId,
  }).catch((error) => {
    logger.warn("case.lifecycle_workflow_trigger_failed", { caseId, reason: error.message });
  });
  await evaluateCaseTimelineLegs(agencyId, caseId).catch((error) => {
    logger.warn("case.lifecycle_timeline_evaluation_failed", { caseId, reason: error.message });
  });
  const milestoneType = STUDY_PERMIT_MILESTONES[nextStage];
  if (milestoneType) await creditStudyPermitMilestone(agencyId, {
    caseId, eventType: milestoneType, triggerSource: "CASE_STAGE_HISTORY",
    triggerRef: `${caseId}:${nextStage}`, occurredAt, actorUserId,
  }).catch((error) => logger.warn("case.lifecycle_milestone_incentive_failed", { caseId, reason: error.message }));
}

async function validateSuccessorCaseType(req, value, currentCaseType) {
  const nextType = canonicalCaseType(text(value, 180));
  if (!nextType) throw createHttpError(400, "Choose the new case type after a refusal.", "NEW_CASE_TYPE_REQUIRED");
  if (normalizeCaseType(nextType) === normalizeCaseType(currentCaseType)) {
    throw createHttpError(400, "Choose a different case type for the new file.", "NEW_CASE_TYPE_REQUIRED");
  }
  if (req.auth.role === "consultant") {
    const options = await listAgencyCaseTypeOptions(req.auth.agencyId);
    if (!options.some((option) => normalizeCaseType(option) === normalizeCaseType(nextType))) {
      throw createHttpError(400, "Choose a configured case type for the new file.", "CASE_TYPE_NOT_CONFIGURED");
    }
  }
  return nextType;
}

async function copyReusableCaseInformation(tx, { sourceCaseId, successorCaseId, agencyId, clientId, actorUserId }) {
  const [assessment, informationSections, applicantAccesses] = await Promise.all([
    tx.caseAssessment.findUnique({ where: { caseId: sourceCaseId } }),
    tx.caseInformationProfile.findMany({ where: { agencyId, caseId: sourceCaseId } }),
    tx.immigrationProfileCaseAccess.findMany({
      where: { agencyId, caseId: sourceCaseId },
      select: { profileId: true },
    }),
  ]);

  if (assessment) {
    await tx.caseAssessment.create({
      data: {
        agencyId,
        clientId,
        caseId: successorCaseId,
        userId: actorUserId,
        formData: assessment.formData,
        crsScore: assessment.crsScore,
        crsBreakdown: assessment.crsBreakdown,
        declaredComplete: false,
        declaredAt: null,
      },
    });
  }

  if (informationSections.length) {
    await tx.caseInformationProfile.createMany({
      data: informationSections.map((section) => ({
        agencyId,
        clientId,
        caseId: successorCaseId,
        sectionKey: section.sectionKey,
        data: section.data,
        version: 1,
        updatedById: actorUserId,
      })),
      skipDuplicates: true,
    });
  }

  if (applicantAccesses.length) {
    await tx.immigrationProfileCaseAccess.createMany({
      data: applicantAccesses.map((access) => ({
        agencyId,
        profileId: access.profileId,
        caseId: successorCaseId,
      })),
      skipDuplicates: true,
    });
  }

  return {
    assessmentCopied: Boolean(assessment),
    informationSectionsCopied: informationSections.length,
    applicantProfilesLinked: applicantAccesses.length,
  };
}

async function createSuccessorCase(tx, req, sourceCase, newCaseType, existingDecision) {
  if (existingDecision?.successorCaseId) {
    const existingSuccessor = await tx.case.findFirst({
      where: { id: existingDecision.successorCaseId, agencyId: req.auth.agencyId, deletedAt: null },
    });
    if (existingSuccessor) return { caseItem: existingSuccessor, reused: true, copySummary: null };
  }

  const duplicate = await tx.case.findFirst({
    where: {
      agencyId: req.auth.agencyId,
      clientId: sourceCase.clientId,
      caseType: newCaseType,
      deletedAt: null,
      status: { notIn: ["Closed", "Cancelled", "Completed", "Inactive"] },
    },
    select: { id: true, stage: true },
  });
  if (duplicate) {
    throw createHttpError(
      409,
      `This client already has an active ${newCaseType} case (${duplicate.stage}). Open that case instead.`,
      "DUPLICATE_CASE",
    );
  }

  const caseItem = await tx.case.create({
    data: {
      agencyId: req.auth.agencyId,
      clientId: sourceCase.clientId,
      assignedUserId: sourceCase.assignedUserId,
      caseType: newCaseType,
      stage: "Lead",
      status: "Open",
      priority: sourceCase.priority || "Normal",
      nextAction: `Review information transferred from refused ${sourceCase.caseType} case`,
    },
  });

  const copySummary = await copyReusableCaseInformation(tx, {
    sourceCaseId: sourceCase.id,
    successorCaseId: caseItem.id,
    agencyId: req.auth.agencyId,
    clientId: sourceCase.clientId,
    actorUserId: req.auth.userId,
  });

  await assignDefaultWorkflowToCase(tx, {
    agencyId: req.auth.agencyId,
    caseId: caseItem.id,
    caseType: caseItem.caseType,
  });

  return { caseItem, reused: false, copySummary };
}

export async function getCaseLifecycle(req, res) {
  const item = await requireCase(req, {
    id: true,
    submittedAt: true,
    decisionAt: true,
    stage: true,
    caseType: true,
  });
  const decision = await getDecision(prisma, req.auth.agencyId, item.id);
  res.json({
    data: {
      caseId: item.id,
      stage: item.stage,
      caseType: item.caseType,
      submittedAt: item.submittedAt,
      decisionAt: item.decisionAt,
      decision,
    },
  });
}

export async function updateCaseLifecycle(req, res) {
  const requestedStage = text(req.body?.stage, 80);
  if (!["Submitted", "Decision Received"].includes(requestedStage)) {
    throw createHttpError(400, "Lifecycle stage must be Submitted or Decision Received.", "VALIDATION_ERROR");
  }

  const sourceCase = await requireCase(req, {
    id: true,
    agencyId: true,
    clientId: true,
    assignedUserId: true,
    caseType: true,
    stage: true,
    status: true,
    priority: true,
    submittedAt: true,
    decisionAt: true,
    deletedAt: true,
  });
  if (["Closed", "Cancelled", "Completed", "Inactive"].includes(sourceCase.status)) {
    throw createHttpError(409, "Reopen the case before changing its application lifecycle.", "CASE_CLOSED");
  }

  const submitted = dateOnly(req.body?.submittedAt || sourceCase.submittedAt?.toISOString().slice(0, 10), "Submitted date", { required: true });
  const nextAction = text(req.body?.nextAction, 500) || (requestedStage === "Submitted" ? "Wait for decision" : "Review decision with client");

  if (requestedStage === "Submitted") {
    const milestoneOccurredAt = new Date();
    const data = await prisma.$transaction(async (tx) => {
      const updated = await tx.case.update({
        where: { id: sourceCase.id },
        data: { stage: "Submitted", submittedAt: submitted.date, nextAction },
      });
      if (sourceCase.stage !== "Submitted") {
        await tx.caseStageHistory.create({
          data: {
            agencyId: req.auth.agencyId,
            caseId: sourceCase.id,
            previousStage: sourceCase.stage,
            newStage: "Submitted",
            changedById: req.auth.userId,
            reason: `Application submitted ${submitted.raw}`,
          },
        });
        // Queued in the same transaction as the stage change — see the
        // matching comment in caseController.js's updateCase.
        const milestoneType = STUDY_PERMIT_MILESTONES["Submitted"];
        if (milestoneType) await recordPendingStudyPermitMilestoneEvent(req.auth.agencyId, {
          caseId: sourceCase.id,
          eventType: milestoneType,
          triggerSource: "CASE_STAGE_HISTORY",
          triggerRef: `${sourceCase.id}:Submitted`,
          occurredAt: milestoneOccurredAt,
          actorUserId: req.auth.userId,
        }, tx);
      }
      return updated;
    });

    await recordActivity({
      agencyId: req.auth.agencyId,
      userId: req.auth.userId,
      clientId: sourceCase.clientId,
      caseId: sourceCase.id,
      action: "case.submitted",
      details: `${sourceCase.caseType} submitted on ${submitted.raw}`,
      metadata: { submittedAt: submitted.raw },
    });
    await runStageAutomations(req.auth.agencyId, sourceCase.id, sourceCase.clientId, sourceCase.stage, "Submitted", req.auth.userId, milestoneOccurredAt);
    invalidateDashboardCache(req.auth.agencyId);
    res.json({ data, lifecycle: { submittedAt: submitted.raw } });
    return;
  }

  const outcome = text(req.body?.decisionOutcome, 20).toUpperCase();
  if (!DECISION_OUTCOMES.has(outcome)) {
    throw createHttpError(400, "Choose Approved or Refused for the immigration decision.", "DECISION_OUTCOME_REQUIRED");
  }
  const decisionDate = dateOnly(req.body?.decisionAt, "Decision date", { required: true });
  if (decisionDate.date < submitted.date) {
    throw createHttpError(400, "Decision date cannot be earlier than the submitted date.", "VALIDATION_ERROR");
  }

  let permitExpiry = null;
  let refusalResolution = null;
  let newCaseType = null;
  if (outcome === "APPROVED") {
    permitExpiry = dateOnly(req.body?.permitExpiryAt, "Permit / status expiry date", { required: true });
    if (permitExpiry.date < decisionDate.date) {
      throw createHttpError(400, "Permit / status expiry cannot be earlier than the decision date.", "VALIDATION_ERROR");
    }
  } else {
    refusalResolution = text(req.body?.refusalResolution, 30).toUpperCase();
    if (!REFUSAL_RESOLUTIONS.has(refusalResolution)) {
      throw createHttpError(400, "Choose whether to start another case or close the file after the refusal.", "REFUSAL_RESOLUTION_REQUIRED");
    }
    if (refusalResolution === "NEW_CASE") {
      newCaseType = await validateSuccessorCaseType(req, req.body?.newCaseType, sourceCase.caseType);
    }
  }

  const existingDecision = await getDecision(prisma, req.auth.agencyId, sourceCase.id);
  if (existingDecision?.successorCaseId && !(outcome === "REFUSED" && refusalResolution === "NEW_CASE")) {
    throw createHttpError(409, "This refusal already created a successor case. Keep the refusal decision linked to that new case.", "SUCCESSOR_CASE_EXISTS");
  }

  const result = await prisma.$transaction(async (tx) => {
    let successor = null;
    if (outcome === "REFUSED" && refusalResolution === "NEW_CASE") {
      successor = await createSuccessorCase(tx, req, sourceCase, newCaseType, existingDecision);
    }

    await tx.$executeRaw`
      INSERT INTO "case_decisions" (
        "agency_id", "case_id", "decision_outcome", "decision_date",
        "permit_expiry_date", "refusal_resolution", "successor_case_id", "recorded_by_id"
      ) VALUES (
        ${req.auth.agencyId}, ${sourceCase.id}, ${outcome}, ${decisionDate.raw}::date,
        ${permitExpiry?.raw || null}::date, ${refusalResolution}, ${successor?.caseItem?.id || existingDecision?.successorCaseId || null}, ${req.auth.userId}
      )
      ON CONFLICT ("case_id") DO UPDATE SET
        "decision_outcome" = EXCLUDED."decision_outcome",
        "decision_date" = EXCLUDED."decision_date",
        "permit_expiry_date" = EXCLUDED."permit_expiry_date",
        "refusal_resolution" = EXCLUDED."refusal_resolution",
        "successor_case_id" = EXCLUDED."successor_case_id",
        "recorded_by_id" = EXCLUDED."recorded_by_id"
    `;

    const data = await tx.case.update({
      where: { id: sourceCase.id },
      data: {
        stage: "Decision Received",
        submittedAt: submitted.date,
        decisionAt: decisionDate.date,
        nextAction: outcome === "APPROVED"
          ? `Review approval; permit/status expires ${permitExpiry.raw}`
          : refusalResolution === "NEW_CASE"
            ? `Continue under new ${newCaseType} case`
            : "Close refused application file",
      },
    });

    if (sourceCase.stage !== "Decision Received") {
      await tx.caseStageHistory.create({
        data: {
          agencyId: req.auth.agencyId,
          caseId: sourceCase.id,
          previousStage: sourceCase.stage,
          newStage: "Decision Received",
          changedById: req.auth.userId,
          reason: `${outcome === "APPROVED" ? "Approved" : "Refused"} on ${decisionDate.raw}`,
        },
      });
    }

    return { data, successor };
  });

  const decision = await getDecision(prisma, req.auth.agencyId, sourceCase.id);
  const details = outcome === "APPROVED"
    ? `${sourceCase.caseType} approved on ${decisionDate.raw}; permit/status expires ${permitExpiry.raw}`
    : `${sourceCase.caseType} refused on ${decisionDate.raw}; ${refusalResolution === "NEW_CASE" ? `new ${newCaseType} case started` : "file selected for permanent closure"}`;
  await recordActivity({
    agencyId: req.auth.agencyId,
    userId: req.auth.userId,
    clientId: sourceCase.clientId,
    caseId: sourceCase.id,
    action: outcome === "APPROVED" ? "case.decision_approved" : "case.decision_refused",
    details,
    metadata: {
      submittedAt: submitted.raw,
      decisionAt: decisionDate.raw,
      decisionOutcome: outcome,
      permitExpiryAt: permitExpiry?.raw || null,
      refusalResolution,
      successorCaseId: result.successor?.caseItem?.id || decision?.successorCaseId || null,
    },
  });

  if (result.successor?.caseItem) {
    await recordActivity({
      agencyId: req.auth.agencyId,
      userId: req.auth.userId,
      clientId: sourceCase.clientId,
      caseId: result.successor.caseItem.id,
      action: "case.created_from_refusal",
      details: `${result.successor.caseItem.caseType} started from refused ${sourceCase.caseType} case; reusable profile information mapped forward`,
      metadata: {
        sourceCaseId: sourceCase.id,
        copySummary: result.successor.copySummary,
      },
    });
  }

  await runStageAutomations(req.auth.agencyId, sourceCase.id, sourceCase.clientId, sourceCase.stage, "Decision Received", req.auth.userId);
  invalidateDashboardCache(req.auth.agencyId);
  res.json({
    data: result.data,
    lifecycle: {
      submittedAt: submitted.raw,
      decision,
      requiresClose: outcome === "REFUSED",
      successorCase: result.successor?.caseItem || null,
      copySummary: result.successor?.copySummary || null,
    },
  });
}
