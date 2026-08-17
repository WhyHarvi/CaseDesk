import prisma from "../services/prisma/client.js";
import { assignDefaultWorkflowToCase, canonicalCaseType, canonicalCaseTypeLabels } from "../services/workflowService.js";
import { listAgencyCaseTypeOptions } from "../services/caseTypeOptionsService.js";
import { normalizeDocumentName, uniqueDocumentNames } from "../utils/documentNames.js";
import { createHttpError } from "../utils/http.js";
import { createCrudController, fieldParsers, recordActivity } from "../utils/prismaCrud.js";
import { caseAccessWhere, clientAccessWhere } from "../middleware/authorization.js";
import { clientRecipientIds, notifyUsers, resolveNotifications } from "../services/notificationService.js";
import { evaluateStageTriggers, getCasePaymentSummary } from "../services/paymentScheduleService.js";
import { logger } from "../services/logger.js";
import { processBookingMessageDeliveries, sendBookingMessages } from "../services/bookingNotificationService.js";
import { enqueueAppointmentMeetingJob } from "../services/appointmentMeetingService.js";
import { syncLeadConsultationFromAppointment } from "../services/leadConsultationAppointmentService.js";
import { offerWaitlistOpening } from "../services/bookingWaitlistService.js";
import { invalidateDashboardCache } from "../services/dashboardCache.js";
import { formatStudyIntakeMonth, isStudyPermitCaseType, normalizeStudyIntakeMonth, stageRequiresStudyIntake, studyIntakeKey } from "../utils/studyIntake.js";

const include = {
  client: {
    select: {
      id: true,
      fullName: true,
      familyName: true,
      givenNames: true,
      phone: true,
      email: true,
      dateOfBirth: true,
      address: true,
      status: true,
    },
  },
  assignedUser: {
    select: {
      id: true,
      fullName: true,
      email: true,
      role: true,
      // Representative-on-forms fields (IMM 5476 and similar) — assignedUser
      // is the default representative for a case's forms unless a specific
      // CaseForm.representativeUserId picks someone else.
      phone: true,
      licenseNumber: true,
      representativeType: true,
      membershipBody: true,
      membershipProvince: true,
      formOfficePhone: true,
      formOfficeEmail: true,
    },
  },
};

const fields = {
  clientId: fieldParsers.relationField,
  assignedUserId: fieldParsers.relationField,
  caseType: fieldParsers.stringField,
  stage: fieldParsers.stringField,
  status: fieldParsers.stringField,
  priority: fieldParsers.stringField,
  nextAction: fieldParsers.stringField,
  submittedAt: fieldParsers.dateField,
  decisionAt: fieldParsers.dateField,
  studyIntakeMonth: fieldParsers.dateField,
};

import { CASE_STAGES, isCaseStageAllowedForType } from "../constants/caseStages.js";
export { CASE_STAGES };
export const CASE_STATUSES = ["Open", "Active", "On Hold", "Completed", "Closed", "Cancelled", "Inactive"];
export const CASE_PRIORITIES = ["Low", "Normal", "High", "Urgent"];
export const TERMINAL_CASE_STATUSES = new Set(["Completed", "Closed", "Cancelled", "Inactive"]);
const TERMINAL_CASE_STATUS_LIST = [...TERMINAL_CASE_STATUSES];

export function caseRegisterWhere(req) {
  const view = req.query.view || (req.query.trash === "1" ? "trash" : "active");
  if (view === "trash") return { deletedAt: { not: null } };
  if (view === "archived") return { deletedAt: null, archivedAt: { not: null } };
  if (view === "closed") {
    return {
      deletedAt: null,
      archivedAt: null,
      status: { in: TERMINAL_CASE_STATUS_LIST },
    };
  }
  return {
    deletedAt: null,
    archivedAt: null,
    status: { notIn: TERMINAL_CASE_STATUS_LIST },
  };
}

function validateCasePayload(payload, existing = null) {
  const resolved = { ...payload };
  if (!existing) {
    resolved.stage ||= "Lead";
    resolved.status ||= "Open";
    resolved.priority ||= "Normal";
  }
  if (Object.hasOwn(resolved, "caseType")) {
    resolved.caseType = canonicalCaseType(resolved.caseType);
    if (!resolved.caseType || resolved.caseType.length > 180) throw createHttpError(400, "Case type is required and must be 180 characters or fewer.", "VALIDATION_ERROR");
  }
  if (Object.hasOwn(resolved, "studyIntakeMonth")) {
    resolved.studyIntakeMonth = normalizeStudyIntakeMonth(resolved.studyIntakeMonth);
  }
  if (!existing && !resolved.caseType) throw createHttpError(400, "Case type is required.", "VALIDATION_ERROR");
  if (Object.hasOwn(resolved, "stage") && !CASE_STAGES.includes(resolved.stage)) throw createHttpError(400, "Case stage is invalid.", "VALIDATION_ERROR");
  if (Object.hasOwn(resolved, "status") && !CASE_STATUSES.includes(resolved.status)) throw createHttpError(400, "Case status is invalid.", "VALIDATION_ERROR");
  if (Object.hasOwn(resolved, "priority") && !CASE_PRIORITIES.includes(resolved.priority)) throw createHttpError(400, "Case priority is invalid.", "VALIDATION_ERROR");
  const finalStatus = resolved.status ?? existing?.status;
  if (TERMINAL_CASE_STATUSES.has(finalStatus)) {
    resolved.stage = "Closed";
    resolved.nextAction = null;
  }
  if (!existing && !TERMINAL_CASE_STATUSES.has(finalStatus) && !String(resolved.nextAction || "").trim()) {
    throw createHttpError(400, "An active case requires a clear next action.", "VALIDATION_ERROR");
  }
  const finalCaseType = resolved.caseType ?? existing?.caseType;
  const finalStage = resolved.stage ?? existing?.stage;
  if (!isCaseStageAllowedForType(finalCaseType, finalStage)) {
    throw createHttpError(
      400,
      "Choose a case stage that applies to this case type.",
      "VALIDATION_ERROR",
    );
  }
  if (!isStudyPermitCaseType(finalCaseType)) {
    if (Object.hasOwn(resolved, "caseType") || Object.hasOwn(resolved, "studyIntakeMonth")) resolved.studyIntakeMonth = null;
  } else {
    const finalIntake = Object.hasOwn(resolved, "studyIntakeMonth") ? resolved.studyIntakeMonth : existing?.studyIntakeMonth;
    const intakeRuleTouched = !existing || Object.hasOwn(resolved, "caseType") || Object.hasOwn(resolved, "stage") || Object.hasOwn(resolved, "studyIntakeMonth");
    if (intakeRuleTouched && stageRequiresStudyIntake(finalStage) && !finalIntake) {
      throw createHttpError(400, "Choose the academic intake before moving a Study Permit case to Documents Pending or later.", "STUDY_INTAKE_REQUIRED");
    }
  }
  return resolved;
}

function studyPermitCaseTypeWhere() {
  return {
    OR: [
      { caseType: { equals: "Study", mode: "insensitive" } },
      { caseType: { contains: "Study Permit", mode: "insensitive" } },
      { caseType: { contains: "Study-Permit", mode: "insensitive" } },
      { caseType: { contains: "Study_Permit", mode: "insensitive" } },
      { caseType: { contains: "Study/Permit", mode: "insensitive" } },
    ],
  };
}

function studyIntakeFilterWhere(value) {
  const filter = String(value || "").trim();
  if (!filter || filter === "all") return [];
  const studyPermitCase = studyPermitCaseTypeWhere();
  if (filter === "missing") return [{ AND: [studyPermitCase, { studyIntakeMonth: null }] }];
  const now = new Date();
  const currentMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  if (filter === "past") return [{ AND: [studyPermitCase, { studyIntakeMonth: { lt: currentMonth } }] }];
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(filter)) return [];
  const start = new Date(`${filter}-01T00:00:00.000Z`);
  const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1));
  return [{ AND: [studyPermitCase, { studyIntakeMonth: { gte: start, lt: end } }] }];
}

const controller = createCrudController({
  model: "case",
  label: "Case",
  createFields: fields,
  updateFields: fields,
  include,
  buildAccessWhere: caseAccessWhere,
  buildListWhere: (req) => ({
    ...(req.query.clientId ? { clientId: req.query.clientId } : {}),
    ...(req.query.assignedUserId ? { assignedUserId: req.query.assignedUserId } : {}),
    ...(req.query.caseType ? { caseType: req.query.caseType } : {}),
    AND: [
      caseRegisterWhere(req),
      ...(req.query.status ? [{ status: req.query.status }] : []),
      ...studyIntakeFilterWhere(req.query.studyIntake),
    ],
  }),
  activityEntity: "case",
});

function parsePayload(body, fieldConfig) {
  const data = {};

  for (const [fieldName, parser] of Object.entries(fieldConfig)) {
    if (Object.prototype.hasOwnProperty.call(body, fieldName)) {
      data[fieldName] = parser ? parser(body[fieldName], fieldName) : body[fieldName];
    }
  }

  return data;
}

async function syncCaseDocumentsFromTemplates(tx, { agencyId, clientId, caseId, caseType }) {
  if (!caseType) {
    return { createdCount: 0 };
  }

  const [templates, existingDocuments] = await Promise.all([
    tx.documentTemplate.findMany({
      where: {
        agencyId,
        OR: canonicalCaseTypeLabels(caseType).map((label) => ({
          caseType: { equals: label, mode: "insensitive" },
        })),
      },
      orderBy: [{ createdAt: "asc" }],
      select: {
        documentName: true,
        isRequired: true,
      },
    }),
    tx.clientDocument.findMany({
      where: {
        agencyId,
        clientId,
        caseId,
        visibility: "Client",
      },
      select: {
        documentName: true,
      },
    }),
  ]);

  if (!templates.length) {
    return { createdCount: 0 };
  }

  const existingNames = new Set(existingDocuments.map((document) => normalizeDocumentName(document.documentName)));
  const templatesByName = new Map();
  templates.forEach((template) => {
    const key = normalizeDocumentName(template.documentName);
    if (key && !existingNames.has(key) && !templatesByName.has(key)) templatesByName.set(key, template);
  });
  const documentsToCreate = [...templatesByName.values()]
    .map((template) => ({
      agencyId,
      clientId,
      caseId,
      documentName: template.documentName,
      normalizedName: normalizeDocumentName(template.documentName),
      status: template.isRequired ? "Requested" : "NotRequired",
      notes: template.isRequired ? null : "Optional for this case type",
    }));

  if (!documentsToCreate.length) {
    return { createdCount: 0 };
  }

  await tx.clientDocument.createMany({
    data: documentsToCreate,
  });

  return { createdCount: documentsToCreate.length };
}

export async function createCase(req, res) {
  const payload = validateCasePayload(parsePayload(req.body, fields));
  const idempotencyKey = String(req.body?.idempotencyKey || "").trim().replace(/[^a-zA-Z0-9:_-]/g, "").slice(0, 200) || null;

  if (!payload.clientId) {
    throw createHttpError(400, "clientId is required");
  }
  if (idempotencyKey) {
    const existing = await prisma.case.findUnique({
      where: { agencyId_creationIdempotencyKey: { agencyId: req.auth.agencyId, creationIdempotencyKey: idempotencyKey } },
      include,
    });
    if (existing) return res.json({ data: existing, reused: true });
  }
  if (req.auth.role === "consultant") payload.assignedUserId = req.auth.userId;
  await validateCaseAssignee(req, payload.assignedUserId);

  let result;
  try {
    result = await prisma.$transaction(async (tx) => {
    const client = await tx.client.findFirst({
      where: {
        id: payload.clientId,
        agencyId: req.user.agencyId,
        ...clientAccessWhere(req),
      },
      select: {
        id: true,
      },
    });

    if (!client) {
      throw createHttpError(404, "Client not found");
    }

    // Case had no guard against creating two open cases of the same type
    // for the same client — the only de-dupe was an opt-in idempotency key
    // that a retried/double-clicked create-case request may never send.
    // Block on an existing non-closed, non-deleted case of the same type,
    // same convention contactDuplicateService already uses for Client/Lead:
    // point at the existing record instead of silently creating a twin.
    const duplicateCase = await tx.case.findFirst({
      where: {
        agencyId: req.user.agencyId,
        clientId: payload.clientId,
        caseType: payload.caseType,
        deletedAt: null,
        status: { not: "Closed" },
      },
      select: { id: true, status: true, stage: true },
    });
    if (duplicateCase) {
      throw createHttpError(
        409,
        `This client already has an open ${payload.caseType} case (${duplicateCase.stage}). Open the existing case instead of creating another.`,
        "DUPLICATE_CASE",
      );
    }

    const data = await tx.case.create({
      data: {
        ...payload,
        agencyId: req.user.agencyId,
        creationIdempotencyKey: idempotencyKey,
      },
      include,
    });

    const templateSync = await syncCaseDocumentsFromTemplates(tx, {
      agencyId: req.user.agencyId,
      clientId: data.client.id,
      caseId: data.id,
      caseType: data.caseType,
    });

    const workflowSync = await assignDefaultWorkflowToCase(tx, {
      agencyId: req.user.agencyId,
      caseId: data.id,
      caseType: data.caseType,
    });

      return { data, templateSync, workflowSync, reused: false };
    });
  } catch (error) {
    if (error?.code !== "P2002" || !idempotencyKey) throw error;
    const existing = await prisma.case.findUnique({
      where: { agencyId_creationIdempotencyKey: { agencyId: req.auth.agencyId, creationIdempotencyKey: idempotencyKey } },
      include,
    });
    if (!existing) throw error;
    result = { data: existing, templateSync: { createdCount: 0 }, workflowSync: { createdCount: 0 }, reused: true };
  }

  if (result.reused) return res.json({ data: result.data, reused: true });

  const activityDetails = [
    "Case created",
    result.data.studyIntakeMonth ? `Intake: ${formatStudyIntakeMonth(result.data.studyIntakeMonth)}` : null,
    result.templateSync.createdCount
      ? `${result.templateSync.createdCount} template documents added`
      : null,
    result.workflowSync.createdCount
      ? `${result.workflowSync.createdCount} workflow steps assigned`
      : null,
  ]
    .filter(Boolean)
    .join(" and ");

  await recordActivity({
    agencyId: req.user.agencyId,
    userId: req.user.id,
    clientId: result.data.client.id,
    caseId: result.data.id,
    action: "case.created",
    details: activityDetails,
  });

  invalidateDashboardCache(req.user.agencyId);
  res.status(201).json({ data: result.data, reused: false });
}

export async function updateCase(req, res) {
  const existing = await prisma.case.findFirst({
    where: {
      id: req.params.id,
      agencyId: req.user.agencyId,
      ...caseAccessWhere(req),
    },
    include: {
      client: {
        select: {
          id: true,
        },
      },
    },
  });

  if (!existing) {
    throw createHttpError(404, "Case not found");
  }

  const payload = validateCasePayload(parsePayload(req.body, fields), existing);
  if (
    Object.hasOwn(payload, "clientId") &&
    payload.clientId !== existing.clientId
  ) {
    throw createHttpError(
      400,
      "A case cannot be moved to another client.",
      "CASE_CLIENT_IMMUTABLE",
    );
  }
  // Client selection is a creation-only field. Dropping an unchanged legacy
  // value also prevents accidental relationship writes from older clients.
  delete payload.clientId;
  if (req.auth.role === "consultant" && payload.assignedUserId !== undefined) payload.assignedUserId = req.auth.userId;
  await validateCaseAssignee(req, payload.assignedUserId);

  const result = await prisma.$transaction(async (tx) => {
    const data = await tx.case.update({
      where: { id: req.params.id },
      data: payload,
      include,
    });

    const caseTypeChanged = payload.caseType && payload.caseType !== existing.caseType;
    const templateSync = caseTypeChanged
      ? await syncCaseDocumentsFromTemplates(tx, {
          agencyId: req.user.agencyId,
          clientId: existing.client.id,
          caseId: data.id,
          caseType: data.caseType,
        })
      : { createdCount: 0 };

    const workflowSync = caseTypeChanged
      ? await assignDefaultWorkflowToCase(tx, {
          agencyId: req.user.agencyId,
          caseId: data.id,
          caseType: data.caseType,
        })
      : { createdCount: 0 };

    return { data, templateSync, workflowSync };
  });

  const activityDetails = [
    "Case updated",
    studyIntakeKey(result.data.studyIntakeMonth) !== studyIntakeKey(existing.studyIntakeMonth)
      ? `Intake changed from ${formatStudyIntakeMonth(existing.studyIntakeMonth)} to ${formatStudyIntakeMonth(result.data.studyIntakeMonth)}`
      : null,
    result.templateSync.createdCount
      ? `${result.templateSync.createdCount} template documents added`
      : null,
    result.workflowSync.createdCount
      ? `${result.workflowSync.createdCount} workflow steps assigned`
      : null,
  ]
    .filter(Boolean)
    .join(" and ");

  await recordActivity({
    agencyId: req.user.agencyId,
    userId: req.user.id,
    clientId: existing.client.id,
    caseId: result.data.id,
    action: "case.updated",
    details: activityDetails,
  });

  if (Object.hasOwn(payload, "stage") && payload.stage !== existing.stage) {
    await evaluateStageTriggers(req.auth.agencyId, result.data.id, existing.stage, payload.stage, req.auth.userId).catch((error) => {
      logger.warn("case.payment_trigger_failed", { caseId: result.data.id, reason: error.message });
    });
  }

  const clientVisibleChanges = ["stage", "status", "submittedAt", "decisionAt"]
    .filter((field) => Object.hasOwn(payload, field) && String(payload[field] || "") !== String(existing[field] || ""));
  if (clientVisibleChanges.length) {
    await notifyUsers({
      agencyId: req.user.agencyId,
      recipientIds: await clientRecipientIds(req.user.agencyId, result.data.client.id),
      actorUserId: req.user.id,
      type: "case.client_status_updated",
      category: "cases",
      title: `${result.data.caseType} application updated`,
      body: `Current stage: ${result.data.stage}. Status: ${result.data.status}.`,
      severity: result.data.stage === "Decision Received" ? "warning" : "info",
      entityType: "case",
      entityId: result.data.id,
      actionUrl: "/client-portal",
      dedupeKey: `case:${result.data.id}:client-status:${result.data.updatedAt.toISOString()}`,
    });
  }

  invalidateDashboardCache(req.user.agencyId);
  res.json({ data: result.data });
}

async function validateCaseAssignee(req, assignedUserId) {
  if (!assignedUserId) return;
  const user = await prisma.user.findFirst({ where: { id: assignedUserId, agencyId: req.auth.agencyId, status: "active", memberships: { some: { agencyId: req.auth.agencyId, role: { in: ["admin", "consultant"] }, isActive: true } } }, select: { id: true } });
  if (!user) throw createHttpError(400, "Assigned consultant was not found.", "VALIDATION_ERROR");
}

const caseAccessUserSelect = { id: true, fullName: true, email: true };

async function casePermissionsData(req) {
  const [caseItem, consultants] = await Promise.all([
    prisma.case.findFirst({
      where: { id: req.params.id, agencyId: req.auth.agencyId, deletedAt: null },
      select: {
        id: true,
        caseType: true,
        archivedAt: true,
        assignedUser: { select: caseAccessUserSelect },
        assignments: {
          where: { status: "active", assignmentType: { in: ["supporting", "reviewer"] } },
          select: { id: true, assignmentType: true, consultant: { select: caseAccessUserSelect } },
          orderBy: { assignedAt: "asc" },
        },
      },
    }),
    prisma.user.findMany({
      where: {
        agencyId: req.auth.agencyId,
        status: "active",
        memberships: { some: { agencyId: req.auth.agencyId, role: "consultant", isActive: true } },
      },
      select: caseAccessUserSelect,
      orderBy: { fullName: "asc" },
    }),
  ]);
  if (!caseItem) throw createHttpError(404, "Case not found.", "NOT_FOUND");
  return {
    caseId: caseItem.id,
    caseType: caseItem.caseType,
    archived: Boolean(caseItem.archivedAt),
    owner: caseItem.assignedUser,
    collaborators: caseItem.assignments.map((item) => ({ ...item.consultant, assignmentType: item.assignmentType })),
    consultants,
  };
}

export async function getCasePermissions(req, res) {
  res.json({ data: await casePermissionsData(req) });
}

export async function updateCasePermissions(req, res) {
  const ownerUserId = typeof req.body?.ownerUserId === "string" ? req.body.ownerUserId.trim() : "";
  const suppliedCollaborators = Array.isArray(req.body?.collaboratorUserIds) ? req.body.collaboratorUserIds : [];
  if (!ownerUserId) throw createHttpError(400, "Choose a primary consultant for this case.", "VALIDATION_ERROR");
  if (suppliedCollaborators.length > 100 || suppliedCollaborators.some((id) => typeof id !== "string" || !id.trim())) {
    throw createHttpError(400, "The collaborator list is invalid.", "VALIDATION_ERROR");
  }
  const collaboratorUserIds = [...new Set(suppliedCollaborators.map((id) => id.trim()))].filter((id) => id !== ownerUserId);
  const requestedUserIds = [ownerUserId, ...collaboratorUserIds];

  const updated = await prisma.$transaction(async (tx) => {
    const caseItem = await tx.case.findFirst({
      where: { id: req.params.id, agencyId: req.auth.agencyId, deletedAt: null },
      select: {
        id: true,
        clientId: true,
        caseType: true,
        assignedUserId: true,
        archivedAt: true,
        assignments: { where: { status: "active" }, select: { consultantUserId: true } },
      },
    });
    if (!caseItem) throw createHttpError(404, "Case not found.", "NOT_FOUND");
    if (caseItem.archivedAt) throw createHttpError(409, "Restore this case before changing team access.", "CASE_ARCHIVED");

    const eligible = await tx.user.findMany({
      where: {
        id: { in: requestedUserIds },
        agencyId: req.auth.agencyId,
        status: "active",
        memberships: { some: { agencyId: req.auth.agencyId, role: "consultant", isActive: true } },
      },
      select: caseAccessUserSelect,
    });
    if (eligible.length !== requestedUserIds.length) throw createHttpError(400, "One or more selected consultants are inactive or unavailable.", "VALIDATION_ERROR");

    const currentAccess = new Set([caseItem.assignedUserId, ...caseItem.assignments.map((item) => item.consultantUserId)].filter(Boolean));
    const nextAccess = new Set(requestedUserIds);
    const removedUserIds = [...currentAccess].filter((id) => !nextAccess.has(id));
    if (removedUserIds.length) {
      const [tasks, followUps, appointments] = await Promise.all([
        tx.caseWorkflowStep.count({ where: { agencyId: req.auth.agencyId, caseId: caseItem.id, assignedToId: { in: removedUserIds }, isActive: true, status: "Pending" } }),
        tx.followUp.count({ where: { agencyId: req.auth.agencyId, caseId: caseItem.id, assignedUserId: { in: removedUserIds }, status: "Pending" } }),
        tx.appointment.count({ where: { agencyId: req.auth.agencyId, caseId: caseItem.id, assignedToId: { in: removedUserIds }, status: "Scheduled" } }),
      ]);
      const activeWorkCount = tasks + followUps + appointments;
      if (activeWorkCount) {
        throw createHttpError(409, `Reassign ${activeWorkCount} active work item${activeWorkCount === 1 ? "" : "s"} before removing this consultant's case access.`, "ACTIVE_CASE_WORK");
      }
    }

    await tx.case.update({ where: { id: caseItem.id }, data: { assignedUserId: ownerUserId } });
    await tx.caseAssignment.updateMany({
      where: { agencyId: req.auth.agencyId, caseId: caseItem.id, status: "active" },
      data: { status: "inactive" },
    });
    for (const consultantUserId of collaboratorUserIds) {
      await tx.caseAssignment.upsert({
        where: { agencyId_caseId_consultantUserId_assignmentType: { agencyId: req.auth.agencyId, caseId: caseItem.id, consultantUserId, assignmentType: "supporting" } },
        create: { agencyId: req.auth.agencyId, caseId: caseItem.id, consultantUserId, assignmentType: "supporting", status: "active", assignedById: req.auth.userId },
        update: { status: "active", assignedById: req.auth.userId, assignedAt: new Date() },
      });
    }
    return { ...caseItem, owner: eligible.find((item) => item.id === ownerUserId), collaboratorCount: collaboratorUserIds.length };
  });

  await recordActivity({
    agencyId: req.auth.agencyId,
    userId: req.auth.userId,
    clientId: updated.clientId,
    caseId: updated.id,
    action: "case.permissions_updated",
    details: `Case access updated: ${updated.owner.fullName} is primary owner with ${updated.collaboratorCount} collaborator${updated.collaboratorCount === 1 ? "" : "s"}`,
  });
  res.json({ data: await casePermissionsData(req), message: "Case permissions updated." });
}

export async function createCaseDocumentChecklist(req, res) {
  const requestedDocuments = Array.isArray(req.body.documents) ? req.body.documents : [];
  const documents = uniqueDocumentNames(requestedDocuments);

  if (!documents.length) {
    throw createHttpError(400, "Select at least one document");
  }

  if (documents.length > 150) {
    throw createHttpError(400, "A checklist can contain no more than 150 documents");
  }

  if (documents.some((document) => document.length > 200)) {
    throw createHttpError(400, "Document names must be 200 characters or fewer");
  }

  const programName = String(req.body.programName || "Custom checklist").trim().slice(0, 160);
  const result = await prisma.$transaction(async (tx) => {
    const caseItem = await tx.case.findFirst({
      where: { id: req.params.id, agencyId: req.user.agencyId },
      select: { id: true, clientId: true },
    });

    if (!caseItem) {
      throw createHttpError(404, "Case not found");
    }

    // Serialize checklist assignments for this case so simultaneous requests cannot create duplicates.
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${caseItem.id}))::text AS lock_status`;

    const existing = await tx.clientDocument.findMany({
      where: { agencyId: req.user.agencyId, caseId: caseItem.id, visibility: "Client" },
      select: { id: true, documentName: true, status: true },
    });
    const existingByName = new Map();
    existing.forEach((document) => {
      const key = normalizeDocumentName(document.documentName);
      if (!existingByName.has(key)) existingByName.set(key, []);
      existingByName.get(key).push(document);
    });
    const newNames = [];
    const reassignIds = [];
    let skippedCount = 0;

    documents.forEach((documentName) => {
      const matches = existingByName.get(normalizeDocumentName(documentName)) || [];
      if (matches.some((document) => document.status !== "NotRequired")) {
        skippedCount += 1;
      } else if (matches.length) {
        reassignIds.push(...matches.map((document) => document.id));
      } else {
        newNames.push(documentName);
      }
    });

    if (reassignIds.length) {
      await tx.clientDocument.updateMany({
        where: { agencyId: req.user.agencyId, caseId: caseItem.id, id: { in: reassignIds } },
        data: { status: "Requested" },
      });
    }

    if (newNames.length) {
      await tx.clientDocument.createMany({
        data: newNames.map((documentName) => ({
          agencyId: req.user.agencyId,
          clientId: caseItem.clientId,
          caseId: caseItem.id,
          documentName,
          normalizedName: normalizeDocumentName(documentName),
          status: "Requested",
          notes: `Requested from ${programName} document checklist`,
        })),
      });
    }

    const assigned = newNames.length || reassignIds.length
      ? await tx.clientDocument.findMany({
          where: {
            agencyId: req.user.agencyId,
            caseId: caseItem.id,
            OR: [
              ...(newNames.length ? [{ documentName: { in: newNames } }] : []),
              ...(reassignIds.length ? [{ id: { in: reassignIds } }] : []),
            ],
          },
          include: {
            client: { select: { id: true, fullName: true } },
            case: { select: { id: true, caseType: true, stage: true } },
          },
          orderBy: { createdAt: "asc" },
        })
      : [];

    return { caseItem, assigned, createdCount: newNames.length, reassignedCount: reassignIds.length, skippedCount };
  });

  await recordActivity({
    agencyId: req.user.agencyId,
    userId: req.user.id,
    clientId: result.caseItem.clientId,
    caseId: result.caseItem.id,
    action: "case.document_checklist.created",
    details: `${result.createdCount} documents added and ${result.reassignedCount} reassigned from ${programName}`,
  });

  invalidateDashboardCache(req.user.agencyId);
  res.status(201).json({
    data: result.assigned,
    meta: {
      createdCount: result.createdCount,
      reassignedCount: result.reassignedCount,
      skippedCount: result.skippedCount,
      programId: req.body.programId || null,
      programName,
    },
  });
}

export async function updateCaseDocumentAssignment(req, res) {
  const requestedIds = Array.isArray(req.body.documentIds)
    ? req.body.documentIds
    : [req.body.documentId];
  const documentIds = [...new Set(requestedIds.map((id) => String(id || "").trim()).filter(Boolean))];
  const status = req.body.status;

  if (!documentIds.length) {
    throw createHttpError(400, "At least one documentId is required");
  }

  if (documentIds.length > 150) {
    throw createHttpError(400, "No more than 150 documents can be updated at once");
  }

  if (!["Requested", "NotRequired"].includes(status)) {
    throw createHttpError(400, "status must be Requested or NotRequired");
  }

  const result = await prisma.$transaction(async (tx) => {
    const caseItem = await tx.case.findFirst({
      where: { id: req.params.id, agencyId: req.user.agencyId },
      select: { id: true, clientId: true },
    });

    if (!caseItem) {
      throw createHttpError(404, "Case not found");
    }

    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${caseItem.id}))::text AS lock_status`;

    const caseDocuments = await tx.clientDocument.findMany({
      where: { agencyId: req.user.agencyId, caseId: caseItem.id, visibility: "Client" },
      select: { id: true, documentName: true },
    });
    const targets = caseDocuments.filter((document) => documentIds.includes(document.id));

    if (!targets.length) {
      throw createHttpError(404, "Case documents not found");
    }

    const targetKeys = new Set(targets.map((document) => normalizeDocumentName(document.documentName)));
    const matchingIds = caseDocuments
      .filter((document) => targetKeys.has(normalizeDocumentName(document.documentName)))
      .map((document) => document.id);

    await Promise.all(matchingIds.map((documentId) => tx.clientDocument.update({
      where: { id: documentId },
      data: {
        status,
        reviewedAt: null,
        reviewedBy: { disconnect: true },
      },
    })));

    const data = await tx.clientDocument.findMany({
      where: { agencyId: req.user.agencyId, caseId: caseItem.id, id: { in: matchingIds } },
      include: {
        client: { select: { id: true, fullName: true } },
        case: { select: { id: true, caseType: true, stage: true } },
      },
    });

    return { caseItem, data, documentCount: targetKeys.size };
  });

  await recordActivity({
    agencyId: req.user.agencyId,
    userId: req.user.id,
    clientId: result.caseItem.clientId,
    caseId: result.caseItem.id,
    action: status === "NotRequired" ? "case.document.unassigned" : "case.document.reassigned",
    details: `${result.documentCount} document requirement${result.documentCount === 1 ? "" : "s"} ${status === "NotRequired" ? "unassigned" : "reassigned"}`,
  });

  invalidateDashboardCache(req.user.agencyId);
  res.json({ data: result.data, meta: { updatedCount: result.documentCount, status } });
}

// Case type is free text (Case.caseType has no enum), and several other
// systems match against it by exact string equality — document checklists
// (syncCaseDocumentsFromTemplates above), workflow templates
// (workflowService.js's findWorkflowTemplateForCaseType). A case created
// with "study permit" silently won't pick up a "Study Permit" checklist.
// This endpoint surfaces every case type string already known to the
// agency — in use on a real case, or configured as a document/workflow
// template — so the case form can suggest exact matches instead of
// letting free text drift.
export async function listCaseTypes(req, res) {
  res.json({ data: await listAgencyCaseTypeOptions(req.user.agencyId) });
}

export async function listStudyIntakes(req, res) {
  const data = await prisma.case.findMany({
    where: {
      agencyId: req.auth.agencyId,
      AND: [
        caseAccessWhere(req),
        caseRegisterWhere(req),
        studyPermitCaseTypeWhere(),
        { studyIntakeMonth: { not: null } },
      ],
    },
    select: { studyIntakeMonth: true },
    distinct: ["studyIntakeMonth"],
    orderBy: { studyIntakeMonth: "asc" },
  });
  res.json({ data: data.map((item) => studyIntakeKey(item.studyIntakeMonth)).filter(Boolean) });
}

export const listCases = controller.list;

// Unlike other case reads, the profile view must also load trashed cases so
// staff can see the "in trash" state and restore from it.
export async function getCaseById(req, res) {
  const data = await prisma.case.findFirst({
    where: { id: req.params.id, agencyId: req.auth.agencyId, ...caseAccessWhere(req), deletedAt: undefined },
    include,
  });
  if (!data) throw createHttpError(404, "Case not found.", "NOT_FOUND");
  res.json({ data });
}

export async function softDeleteCase(req, res) {
  const existing = await prisma.case.findFirst({
    where: { id: req.params.id, agencyId: req.auth.agencyId, ...caseAccessWhere(req) },
    select: { id: true, clientId: true, caseType: true },
  });
  if (!existing) throw createHttpError(404, "Case not found.", "NOT_FOUND");
  const data = await prisma.case.update({
    where: { id: existing.id },
    data: { deletedAt: new Date() },
    include,
  });
  await recordActivity({
    agencyId: req.auth.agencyId,
    userId: req.auth.userId,
    clientId: existing.clientId,
    caseId: existing.id,
    action: "case.deleted",
    details: `${existing.caseType} moved to trash`,
  });
  invalidateDashboardCache(req.auth.agencyId);
  res.json({ data });
}

export async function restoreCase(req, res) {
  const existing = await prisma.case.findFirst({
    where: { id: req.params.id, agencyId: req.auth.agencyId, ...caseAccessWhere(req), deletedAt: { not: null } },
    select: { id: true, clientId: true, caseType: true },
  });
  if (!existing) throw createHttpError(404, "No trashed case was found to restore.", "NOT_FOUND");
  const data = await prisma.case.update({
    where: { id: existing.id },
    data: { deletedAt: null },
    include,
  });
  await recordActivity({
    agencyId: req.auth.agencyId,
    userId: req.auth.userId,
    clientId: existing.clientId,
    caseId: existing.id,
    action: "case.restored",
    details: `${existing.caseType} restored from trash`,
  });
  invalidateDashboardCache(req.auth.agencyId);
  res.json({ data });
}

export async function archiveCase(req, res) {
  const existing = await prisma.case.findFirst({
    where: {
      id: req.params.id,
      agencyId: req.auth.agencyId,
      ...caseAccessWhere(req),
      deletedAt: null,
    },
    select: { id: true, clientId: true, caseType: true, status: true, archivedAt: true },
  });
  if (!existing) throw createHttpError(404, "Case not found.", "NOT_FOUND");
  if (existing.archivedAt) throw createHttpError(409, "Case is already archived.", "CASE_ALREADY_ARCHIVED");
  if (!TERMINAL_CASE_STATUSES.has(existing.status)) {
    throw createHttpError(409, "Close this case before archiving it.", "CASE_MUST_BE_CLOSED");
  }
  const data = await prisma.case.update({
    where: { id: existing.id },
    data: { archivedAt: new Date() },
    include,
  });
  await recordActivity({
    agencyId: req.auth.agencyId,
    userId: req.auth.userId,
    clientId: existing.clientId,
    caseId: existing.id,
    action: "case.archived",
    details: `${existing.caseType} archived; history retained`,
  });
  invalidateDashboardCache(req.auth.agencyId);
  res.json({ data });
}

export async function unarchiveCase(req, res) {
  const existing = await prisma.case.findFirst({
    where: {
      id: req.params.id,
      agencyId: req.auth.agencyId,
      ...caseAccessWhere(req),
      deletedAt: null,
      archivedAt: { not: null },
    },
    select: { id: true, clientId: true, caseType: true },
  });
  if (!existing) throw createHttpError(404, "No archived case was found to restore.", "NOT_FOUND");
  const data = await prisma.case.update({
    where: { id: existing.id },
    data: { archivedAt: null },
    include,
  });
  await recordActivity({
    agencyId: req.auth.agencyId,
    userId: req.auth.userId,
    clientId: existing.clientId,
    caseId: existing.id,
    action: "case.unarchived",
    details: `${existing.caseType} restored from archive`,
  });
  invalidateDashboardCache(req.auth.agencyId);
  res.json({ data });
}

export async function closeCase(req, res) {
  const existing = await prisma.case.findFirst({
    where: { id: req.params.id, agencyId: req.auth.agencyId, ...caseAccessWhere(req) },
    select: { id: true, clientId: true, caseType: true, status: true },
  });
  if (!existing) throw createHttpError(404, "Case not found.", "NOT_FOUND");
  if (TERMINAL_CASE_STATUSES.has(existing.status)) throw createHttpError(409, "Case is already closed or inactive.", "CASE_ALREADY_CLOSED");
  const billingSummary = await getCasePaymentSummary(req.auth.agencyId, existing.id);
  const outstandingBalance = Number(billingSummary.balance || 0);
  if (outstandingBalance > 0.01 && req.body?.billingDisposition !== "keep_outstanding") {
    throw createHttpError(409, `Review the $${outstandingBalance.toFixed(2)} outstanding balance before closing this case.`, "OUTSTANDING_BILLING_REVIEW_REQUIRED");
  }
  const now = new Date();
  const [scheduledAppointments, openFollowUps] = await Promise.all([prisma.appointment.findMany({
    where: { agencyId: req.auth.agencyId, caseId: existing.id, status: "Scheduled" },
    include: {
      client: { select: { id: true, fullName: true, email: true, phone: true } },
      assignedTo: { select: { id: true, fullName: true } },
      sessionType: true,
      agency: { select: { name: true, legalName: true } },
    },
  }), prisma.followUp.findMany({
    where: { agencyId: req.auth.agencyId, caseId: existing.id, status: "Pending" },
    select: { id: true },
  })]);
  const result = await prisma.$transaction(async (tx) => {
    const data = await tx.case.update({ where: { id: existing.id }, data: { status: "Closed", stage: "Closed", nextAction: null }, include });
    const tasks = await tx.caseWorkflowStep.updateMany({ where: { agencyId: req.auth.agencyId, caseId: existing.id, status: "Pending" }, data: { status: "Cancelled", isActive: false, completedAt: null } });
    const followUps = await tx.followUp.updateMany({ where: { agencyId: req.auth.agencyId, caseId: existing.id, status: "Pending" }, data: { status: "Cancelled", completedAt: now, cancelledById: req.auth.userId, cancellationReason: "Case closed" } });
    const cancelledAppointments = [];
    for (const appointment of scheduledAppointments) {
      const claimed = await tx.appointment.updateMany({
        where: { id: appointment.id, agencyId: req.auth.agencyId, status: "Scheduled" },
        data: {
          status: "Cancelled",
          cancelledAt: now,
          cancelledById: req.auth.userId,
          cancellationReason: "Case closed",
        },
      });
      if (!claimed.count) continue;
      const cancelled = {
        ...appointment,
        status: "Cancelled",
        cancelledAt: now,
        cancelledById: req.auth.userId,
        cancellationReason: "Case closed",
      };
      await syncLeadConsultationFromAppointment(tx, cancelled, { consultationStatus: "CANCELLED" });
      if (appointment.meetingProvider === "Zoom" && appointment.meetingProviderId) {
        await enqueueAppointmentMeetingJob(tx, {
          appointment: cancelled,
          action: "DELETE",
          providerMeetingId: appointment.meetingProviderId,
          dedupeSuffix: "case-closed",
        });
      }
      await sendBookingMessages({
        agencyId: req.auth.agencyId,
        appointment: cancelled,
        kind: "cancelled",
        actorUserId: req.auth.userId,
        dedupeSuffix: "case-closed",
        db: tx,
      });
      cancelledAppointments.push(cancelled);
    }
    return { data, tasks: tasks.count, followUps: followUps.count, cancelledAppointments };
  });
  await Promise.all(openFollowUps.map((item) => resolveNotifications({
    agencyId: req.auth.agencyId,
    entityType: "follow_up",
    entityId: item.id,
  })));
  if (result.cancelledAppointments.length) void processBookingMessageDeliveries();
  await Promise.all(result.cancelledAppointments.map((appointment) => offerWaitlistOpening(appointment).catch(() => {})));
  await recordActivity({
    agencyId: req.auth.agencyId,
    userId: req.auth.userId,
    clientId: existing.clientId,
    caseId: existing.id,
    action: "case.closed",
    details: `${existing.caseType} closed; ${result.tasks} tasks, ${result.followUps} follow-ups, and ${result.cancelledAppointments.length} appointments cancelled${outstandingBalance > 0.01 ? `; $${outstandingBalance.toFixed(2)} retained for collection` : ""}`,
    metadata: { outstandingBalance, billingDisposition: outstandingBalance > 0.01 ? "keep_outstanding" : "none" },
  });
  invalidateDashboardCache(req.auth.agencyId);
  res.json({ data: result.data });
}

export default controller;
