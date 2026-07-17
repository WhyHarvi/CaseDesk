import prisma from "../services/prisma/client.js";
import { assignDefaultWorkflowToCase } from "../services/workflowService.js";
import { createHttpError } from "../utils/http.js";
import { recordActivity } from "../utils/prismaCrud.js";
import { notifyUsers } from "../services/notificationService.js";

const workflowStepInclude = {
  template: {
    select: {
      id: true,
      name: true,
      caseType: true,
    },
  },
  templateStep: {
    select: {
      id: true,
      title: true,
      sortOrder: true,
    },
  },
  assignedTo: {
    select: {
      id: true,
      fullName: true,
      email: true,
    },
  },
};

async function findScopedCase(req) {
  const data = await prisma.case.findFirst({
    where: {
      id: req.params.id,
      agencyId: req.user.agencyId,
    },
    select: {
      id: true,
      clientId: true,
      caseType: true,
    },
  });

  if (!data) {
    throw createHttpError(404, "Case not found");
  }

  return data;
}

function normalizeNullableString(value) {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  return String(value).trim();
}

function normalizeStatus(value) {
  if (!value) {
    return "Pending";
  }

  if (!["Pending", "Completed", "Cancelled"].includes(value)) {
    throw createHttpError(400, "Invalid workflow step status");
  }

  return value;
}

function normalizePriority(value) {
  if (!value) {
    return "Normal";
  }

  if (!["Low", "Normal", "High", "Urgent"].includes(value)) {
    throw createHttpError(400, "Invalid workflow step priority");
  }

  return value;
}

async function requireActiveInternalAssignee(agencyId, assignedToId) {
  if (!assignedToId) return;
  const assignee = await prisma.user.findFirst({
    where: {
      id: assignedToId,
      agencyId,
      status: "active",
      memberships: {
        some: {
          agencyId,
          isActive: true,
          role: { in: ["admin", "consultant"] },
        },
      },
    },
    select: { id: true },
  });
  if (!assignee) throw createHttpError(404, "Active task assignee not found");
}

function normalizeStepPayload(steps) {
  if (!Array.isArray(steps)) {
    throw createHttpError(400, "steps must be an array");
  }

  return steps.map((step, index) => {
    const title = String(step.title || "").trim();

    if (!title) {
      throw createHttpError(400, "Each workflow step needs a title");
    }

    const status = normalizeStatus(step.status);
    const completedAt = status === "Completed" ? (step.completedAt ? new Date(step.completedAt) : new Date()) : null;

    if (completedAt && Number.isNaN(completedAt.getTime())) {
      throw createHttpError(400, "Invalid completedAt date");
    }

    return {
      templateStepId: normalizeNullableString(step.templateStepId),
      title,
      description: normalizeNullableString(step.description),
      sortOrder: Number(step.sortOrder) || index + 1,
      priority: normalizePriority(step.priority),
      isActive: step.isActive !== false,
      status,
      completedAt,
    };
  });
}

async function getWorkflowSteps(agencyId, caseId) {
  return prisma.caseWorkflowStep.findMany({
    where: {
      agencyId,
      caseId,
    },
    include: workflowStepInclude,
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
  });
}

async function replaceCaseWorkflow({ req, scopedCase, templateId = null, steps }) {
  const agencyId = req.user.agencyId;
  const normalizedSteps = normalizeStepPayload(steps);

  if (templateId) {
    const template = await prisma.workflowTemplate.findFirst({
      where: {
        id: templateId,
        agencyId,
      },
      select: {
        id: true,
      },
    });

    if (!template) {
      throw createHttpError(404, "Workflow template not found");
    }
  }

  await prisma.$transaction(async (tx) => {
    await tx.caseWorkflowStep.deleteMany({
      where: {
        agencyId,
        caseId: scopedCase.id,
        isStandaloneTask: false,
      },
    });

    if (normalizedSteps.length) {
      await tx.caseWorkflowStep.createMany({
        data: normalizedSteps.map((step, index) => ({
          agencyId,
          caseId: scopedCase.id,
          templateId,
          templateStepId: step.templateStepId,
          title: step.title,
          description: step.description,
          sortOrder: index + 1,
          priority: step.priority,
          isActive: step.isActive,
          status: step.status,
          completedAt: step.completedAt,
        })),
      });
    }
  });

  await recordActivity({
    agencyId,
    userId: req.user.id,
    clientId: scopedCase.clientId,
    caseId: scopedCase.id,
    action: "workflow.updated",
    details: "Case workflow updated",
  });

  return getWorkflowSteps(agencyId, scopedCase.id);
}

export async function getCaseWorkflow(req, res) {
  const agencyId = req.user.agencyId;
  const scopedCase = await findScopedCase(req);

  await assignDefaultWorkflowToCase(prisma, {
    agencyId,
    caseId: scopedCase.id,
    caseType: scopedCase.caseType,
  });

  const steps = await getWorkflowSteps(agencyId, scopedCase.id);

  res.json({
    data: {
      caseId: scopedCase.id,
      steps,
    },
  });
}

export async function applyCaseWorkflowTemplate(req, res) {
  const agencyId = req.user.agencyId;
  const scopedCase = await findScopedCase(req);
  const templateId = normalizeNullableString(req.body.templateId);

  if (!templateId) {
    throw createHttpError(400, "templateId is required");
  }

  const template = await prisma.workflowTemplate.findFirst({
    where: {
      id: templateId,
      agencyId,
    },
    include: {
      steps: {
        orderBy: { sortOrder: "asc" },
      },
    },
  });

  if (!template) {
    throw createHttpError(404, "Workflow template not found");
  }

  const selectedStepIds = Array.isArray(req.body.selectedStepIds) ? new Set(req.body.selectedStepIds) : null;
  const steps = template.steps.map((step) => ({
    templateStepId: step.id,
    title: step.title,
    description: step.description,
    priority: step.priority,
    sortOrder: step.sortOrder,
    isActive: selectedStepIds ? selectedStepIds.has(step.id) : true,
    status: "Pending",
  }));

  const data = await replaceCaseWorkflow({ req, scopedCase, templateId, steps });
  res.json({ data });
}

export async function saveCaseWorkflow(req, res) {
  const scopedCase = await findScopedCase(req);
  const templateId = normalizeNullableString(req.body.templateId);
  const data = await replaceCaseWorkflow({
    req,
    scopedCase,
    templateId,
    steps: req.body.steps,
  });

  res.json({ data });
}

export async function updateCaseWorkflowStep(req, res) {
  const agencyId = req.user.agencyId;
  const scopedCase = await findScopedCase(req);
  const existing = await prisma.caseWorkflowStep.findFirst({
    where: {
      id: req.params.stepId,
      agencyId,
      caseId: scopedCase.id,
    },
  });

  if (!existing) {
    throw createHttpError(404, "Workflow step not found");
  }

  const payload = {};

  if (Object.prototype.hasOwnProperty.call(req.body, "title")) {
    const title = String(req.body.title || "").trim();

    if (!title) {
      throw createHttpError(400, "Workflow step title is required");
    }

    payload.title = title;
  }

  if (Object.prototype.hasOwnProperty.call(req.body, "description")) {
    payload.description = normalizeNullableString(req.body.description);
  }

  if (Object.prototype.hasOwnProperty.call(req.body, "sortOrder")) {
    payload.sortOrder = Number(req.body.sortOrder) || existing.sortOrder;
  }

  if (Object.prototype.hasOwnProperty.call(req.body, "priority")) {
    payload.priority = normalizePriority(req.body.priority);
  }

  if (Object.prototype.hasOwnProperty.call(req.body, "isActive")) {
    payload.isActive = req.body.isActive !== false;
  }

  if (Object.prototype.hasOwnProperty.call(req.body, "status")) {
    const status = normalizeStatus(req.body.status);
    payload.status = status;
    payload.completedAt = status === "Completed" ? existing.completedAt || new Date() : null;
    if (existing.isStandaloneTask) payload.isActive = status !== "Cancelled";
  }

  if (Object.prototype.hasOwnProperty.call(req.body, "dueAt")) {
    const dueAt = normalizeNullableString(req.body.dueAt);
    if (dueAt) {
      const parsedDueAt = new Date(dueAt);
      if (Number.isNaN(parsedDueAt.getTime())) throw createHttpError(400, "Invalid task due date");
      payload.dueAt = parsedDueAt;
    } else {
      payload.dueAt = null;
    }
  }

  if (Object.prototype.hasOwnProperty.call(req.body, "assignedToId")) {
    const assignedToId = normalizeNullableString(req.body.assignedToId);
    await requireActiveInternalAssignee(agencyId, assignedToId);
    payload.assignedToId = assignedToId;
  }

  const data = await prisma.caseWorkflowStep.update({
    where: {
      id: existing.id,
    },
    data: payload,
    include: workflowStepInclude,
  });

  if (existing.isStandaloneTask) {
    await recordActivity({
      agencyId,
      userId: req.user.id,
      clientId: scopedCase.clientId,
      caseId: scopedCase.id,
      action: Object.prototype.hasOwnProperty.call(payload, "status") ? "task.status_updated" : "task.updated",
      details: Object.prototype.hasOwnProperty.call(payload, "status") ? `${data.title} marked ${data.status.toLowerCase()}` : `${data.title} updated`,
    });
    if (data.assignedToId && data.assignedToId !== existing.assignedToId) {
      await notifyUsers({ agencyId, recipientIds: [data.assignedToId], actorUserId: req.user.id, type: "task.reassigned", category: "work", title: `Task assigned: ${data.title}`, body: data.dueAt ? `Due ${data.dueAt.toISOString()}` : data.description, severity: data.priority === "Urgent" ? "critical" : data.priority === "High" ? "warning" : "info", entityType: "task", entityId: data.id, actionUrl: `/app/cases/${scopedCase.id}`, dedupeKey: `task:${data.id}:assigned:${data.assignedToId}:${data.updatedAt.toISOString()}` });
    }
  } else if (Object.prototype.hasOwnProperty.call(payload, "status")) {
    await recordActivity({
      agencyId,
      userId: req.user.id,
      clientId: scopedCase.clientId,
      caseId: scopedCase.id,
      action: "workflow.step.updated",
      details: `${data.title} marked ${data.status.toLowerCase()}`,
    });
  }

  res.json({ data });
}

export async function createCaseTask(req, res) {
  const agencyId = req.user.agencyId;
  const scopedCase = await findScopedCase(req);
  const title = String(req.body.title || "").trim();
  if (!title) throw createHttpError(400, "Task title is required");
  if (title.length > 180) throw createHttpError(400, "Task title must be 180 characters or fewer");
  const description = normalizeNullableString(req.body.description);
  if (description && description.length > 4000) throw createHttpError(400, "Task description must be 4,000 characters or fewer");
  const priority = normalizePriority(req.body.priority);
  const status = normalizeStatus(req.body.status);
  const assignedToId = normalizeNullableString(req.body.assignedToId);
  await requireActiveInternalAssignee(agencyId, assignedToId);
  const rawDueAt = normalizeNullableString(req.body.dueAt);
  const dueAt = rawDueAt ? new Date(rawDueAt) : null;
  if (dueAt && Number.isNaN(dueAt.getTime())) throw createHttpError(400, "Invalid task due date");
  const latest = await prisma.caseWorkflowStep.aggregate({ where: { agencyId, caseId: scopedCase.id }, _max: { sortOrder: true } });
  const data = await prisma.caseWorkflowStep.create({ data: { agencyId, caseId: scopedCase.id, title, description, priority, status, completedAt: status === "Completed" ? new Date() : null, sortOrder: (latest._max.sortOrder || 0) + 1, isStandaloneTask: true, isActive: status !== "Cancelled", assignedToId, dueAt }, include: workflowStepInclude });
  await recordActivity({ agencyId, userId: req.user.id, clientId: scopedCase.clientId, caseId: scopedCase.id, action: "task.created", details: `${data.title} created${data.assignedTo ? ` and assigned to ${data.assignedTo.fullName}` : ""}` });
  if (data.assignedToId) {
    await notifyUsers({ agencyId, recipientIds: [data.assignedToId], actorUserId: req.user.id, type: "task.assigned", category: "work", title: `Task assigned: ${data.title}`, body: data.dueAt ? `Due ${data.dueAt.toISOString()}` : data.description, severity: data.priority === "Urgent" ? "critical" : data.priority === "High" ? "warning" : "info", entityType: "task", entityId: data.id, actionUrl: `/app/cases/${scopedCase.id}`, dedupeKey: `task:${data.id}:assigned:${data.assignedToId}` });
  }
  res.status(201).json({ data });
}

export async function cancelCaseTask(req, res) {
  const agencyId = req.user.agencyId;
  const scopedCase = await findScopedCase(req);
  const existing = await prisma.caseWorkflowStep.findFirst({ where: { id: req.params.taskId, agencyId, caseId: scopedCase.id, isStandaloneTask: true } });
  if (!existing) throw createHttpError(404, "Task not found");
  if (existing.status === "Cancelled") throw createHttpError(409, "Task is already cancelled");
  const data = await prisma.caseWorkflowStep.update({
    where: { id: existing.id },
    data: { status: "Cancelled", completedAt: null, isActive: false },
    include: workflowStepInclude,
  });
  await recordActivity({ agencyId, userId: req.user.id, clientId: scopedCase.clientId, caseId: scopedCase.id, action: "task.cancelled", details: `${existing.title} cancelled` });
  res.json({ data });
}
