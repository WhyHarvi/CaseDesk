import prisma from "../services/prisma/client.js";
import { assignDefaultWorkflowToCase } from "../services/workflowService.js";
import { normalizeDocumentName, uniqueDocumentNames } from "../utils/documentNames.js";
import { createHttpError } from "../utils/http.js";
import { createCrudController, fieldParsers, recordActivity } from "../utils/prismaCrud.js";
import { caseAccessWhere, clientAccessWhere } from "../middleware/authorization.js";

const include = {
  client: {
    select: {
      id: true,
      fullName: true,
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
};

export const CASE_STAGES = ["Lead", "Consultation", "Retainer Pending", "Documents Pending", "Reviewing Documents", "Application Preparing", "Submitted", "Decision Received", "Closed"];
export const CASE_STATUSES = ["Open", "Active", "On Hold", "Completed", "Closed", "Cancelled", "Inactive"];
export const CASE_PRIORITIES = ["Low", "Normal", "High", "Urgent"];
const TERMINAL_CASE_STATUSES = new Set(["Completed", "Closed", "Cancelled", "Inactive"]);

function validateCasePayload(payload, existing = null) {
  const resolved = { ...payload };
  if (!existing) {
    resolved.stage ||= "Lead";
    resolved.status ||= "Open";
    resolved.priority ||= "Normal";
  }
  if (Object.hasOwn(resolved, "caseType")) {
    resolved.caseType = String(resolved.caseType || "").trim();
    if (!resolved.caseType || resolved.caseType.length > 180) throw createHttpError(400, "Case type is required and must be 180 characters or fewer.", "VALIDATION_ERROR");
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
  return resolved;
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
    ...(req.query.status ? { status: req.query.status } : {}),
    ...(req.query.trash === "1" ? { deletedAt: { not: null } } : {}),
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
        caseType,
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

  if (!payload.clientId) {
    throw createHttpError(400, "clientId is required");
  }
  if (req.auth.role === "consultant") payload.assignedUserId = req.auth.userId;
  await validateCaseAssignee(req, payload.assignedUserId);

  const result = await prisma.$transaction(async (tx) => {
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

    const data = await tx.case.create({
      data: {
        ...payload,
        agencyId: req.user.agencyId,
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

    return { data, templateSync, workflowSync };
  });

  const activityDetails = [
    "Case created",
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

  res.status(201).json({ data: result.data });
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
  if (req.auth.role === "consultant" && payload.assignedUserId !== undefined) payload.assignedUserId = req.auth.userId;
  await validateCaseAssignee(req, payload.assignedUserId);
  if (payload.clientId) {
    const targetClient = await prisma.client.findFirst({ where: { id: payload.clientId, agencyId: req.auth.agencyId, ...clientAccessWhere(req) }, select: { id: true } });
    if (!targetClient) throw createHttpError(400, "Client was not found.", "VALIDATION_ERROR");
  }

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

  res.json({ data: result.data });
}

async function validateCaseAssignee(req, assignedUserId) {
  if (!assignedUserId) return;
  const user = await prisma.user.findFirst({ where: { id: assignedUserId, agencyId: req.auth.agencyId, status: "active", memberships: { some: { agencyId: req.auth.agencyId, role: { in: ["admin", "consultant"] }, isActive: true } } }, select: { id: true } });
  if (!user) throw createHttpError(400, "Assigned consultant was not found.", "VALIDATION_ERROR");
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

  res.json({ data: result.data, meta: { updatedCount: result.documentCount, status } });
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
  res.json({ data });
}

export async function closeCase(req, res) {
  const existing = await prisma.case.findFirst({
    where: { id: req.params.id, agencyId: req.auth.agencyId, ...caseAccessWhere(req) },
    select: { id: true, clientId: true, caseType: true, status: true },
  });
  if (!existing) throw createHttpError(404, "Case not found.", "NOT_FOUND");
  if (TERMINAL_CASE_STATUSES.has(existing.status)) throw createHttpError(409, "Case is already closed or inactive.", "CASE_ALREADY_CLOSED");
  const now = new Date();
  const result = await prisma.$transaction(async (tx) => {
    const [data, tasks, followUps, appointments] = await Promise.all([
      tx.case.update({ where: { id: existing.id }, data: { status: "Closed", stage: "Closed", nextAction: null }, include }),
      tx.caseWorkflowStep.updateMany({ where: { agencyId: req.auth.agencyId, caseId: existing.id, status: "Pending" }, data: { status: "Cancelled", isActive: false, completedAt: null } }),
      tx.followUp.updateMany({ where: { agencyId: req.auth.agencyId, caseId: existing.id, status: { in: ["Pending", "Overdue"] } }, data: { status: "Cancelled", completedAt: now } }),
      tx.appointment.updateMany({ where: { agencyId: req.auth.agencyId, caseId: existing.id, status: "Scheduled" }, data: { status: "Cancelled" } }),
    ]);
    return { data, tasks: tasks.count, followUps: followUps.count, appointments: appointments.count };
  });
  await recordActivity({
    agencyId: req.auth.agencyId,
    userId: req.auth.userId,
    clientId: existing.clientId,
    caseId: existing.id,
    action: "case.closed",
    details: `${existing.caseType} closed; ${result.tasks} tasks, ${result.followUps} follow-ups, and ${result.appointments} appointments cancelled`,
  });
  res.json({ data: result.data });
}

export default controller;
