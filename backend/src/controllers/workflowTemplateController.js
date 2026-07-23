import prisma from "../services/prisma/client.js";
import { ensureDefaultWorkflowTemplates } from "../services/workflowService.js";
import { createHttpError } from "../utils/http.js";

const workflowTemplateInclude = {
  steps: {
    orderBy: { sortOrder: "asc" },
  },
};

function normalizeNullableString(value) {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  return String(value).trim();
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

function normalizeTemplateSteps(steps) {
  if (!Array.isArray(steps) || !steps.length) {
    throw createHttpError(400, "Add at least one workflow milestone.");
  }

  return steps.map((step, index) => {
    const title = String(step.title || "").trim();

    if (!title) {
      throw createHttpError(400, "Each workflow milestone needs a title.");
    }

    return {
      title,
      description: normalizeNullableString(step.description),
      sortOrder: Number(step.sortOrder) || index + 1,
      priority: normalizePriority(step.priority),
      isRequired: step.isRequired !== false,
    };
  });
}

export async function listWorkflowTemplates(req, res) {
  const agencyId = req.user.agencyId;

  await ensureDefaultWorkflowTemplates(prisma, agencyId);

  const templates = await prisma.workflowTemplate.findMany({
    where: {
      agencyId,
    },
    include: workflowTemplateInclude,
    orderBy: [{ isDefault: "desc" }, { caseType: "asc" }, { name: "asc" }],
  });

  res.json({ data: templates });
}

export async function createWorkflowTemplate(req, res) {
  const agencyId = req.user.agencyId;
  const name = String(req.body.name || "").trim();
  const caseType = String(req.body.caseType || "").trim();
  const description = normalizeNullableString(req.body.description);
  const steps = normalizeTemplateSteps(req.body.steps);

  if (!name) {
    throw createHttpError(400, "Workflow name is required.");
  }

  if (!caseType) {
    throw createHttpError(400, "Case type is required.");
  }

  const data = await prisma.workflowTemplate.create({
    data: {
      agencyId,
      name,
      caseType,
      description,
      isDefault: false,
      steps: {
        create: steps.map((step, index) => ({
          agencyId,
          title: step.title,
          description: step.description,
          sortOrder: index + 1,
          priority: step.priority,
          isRequired: step.isRequired,
        })),
      },
    },
    include: workflowTemplateInclude,
  });

  res.status(201).json({ data });
}

// Editing is only offered for custom (isDefault: false) templates, matching
// deleteWorkflowTemplate's existing restriction. Default templates can't be
// safely edited in place today: ensureDefaultWorkflowTemplates()
// (workflowService.js) reconciles every default template's steps back to
// DEFAULT_WORKFLOW_TEMPLATES on every listWorkflowTemplates call whenever
// they don't match byte-for-byte — an in-place edit would just get
// silently overwritten the next time the settings page loads. Use "Create
// new template" to start a custom, freely-editable copy of a default's
// steps instead.
export async function updateWorkflowTemplate(req, res) {
  const agencyId = req.user.agencyId;
  const existing = await prisma.workflowTemplate.findFirst({
    where: { id: req.params.id, agencyId },
    select: { id: true, isDefault: true },
  });

  if (!existing) {
    throw createHttpError(404, "Workflow template not found.");
  }

  if (existing.isDefault) {
    throw createHttpError(400, "System workflow templates can't be edited directly. Create a new template to customize one.");
  }

  const name = String(req.body.name || "").trim();
  const caseType = String(req.body.caseType || "").trim();
  const description = normalizeNullableString(req.body.description);
  const steps = normalizeTemplateSteps(req.body.steps);

  if (!name) {
    throw createHttpError(400, "Workflow name is required.");
  }

  if (!caseType) {
    throw createHttpError(400, "Case type is required.");
  }

  const data = await prisma.$transaction(async (tx) => {
    await tx.workflowTemplateStep.deleteMany({ where: { agencyId, templateId: existing.id } });
    return tx.workflowTemplate.update({
      where: { id: existing.id },
      data: {
        name,
        caseType,
        description,
        steps: {
          create: steps.map((step, index) => ({
            agencyId,
            title: step.title,
            description: step.description,
            sortOrder: index + 1,
            priority: step.priority,
            isRequired: step.isRequired,
          })),
        },
      },
      include: workflowTemplateInclude,
    });
  });

  res.json({ data });
}

export async function deleteWorkflowTemplate(req, res) {
  const agencyId = req.user.agencyId;
  const existing = await prisma.workflowTemplate.findFirst({
    where: {
      id: req.params.id,
      agencyId,
    },
    select: {
      id: true,
      isDefault: true,
    },
  });

  if (!existing) {
    throw createHttpError(404, "Workflow template not found.");
  }

  if (existing.isDefault) {
    throw createHttpError(400, "System workflow templates cannot be deleted.");
  }

  await prisma.workflowTemplate.delete({
    where: {
      id: existing.id,
    },
  });

  res.status(204).send();
}
