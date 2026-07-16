export function buildDraftStepFromWorkflowStep(step, index) {
  return {
    id: step.id,
    templateStepId: step.templateStepId || "",
    title: step.title || "",
    description: step.description || "",
    sortOrder: index + 1,
    priority: step.priority || "Normal",
    isActive: step.isActive !== false,
    status: step.status || "Pending",
    completedAt: step.completedAt || null,
  };
}

export function buildDraftStepFromTemplateStep(step, index) {
  return {
    localId: `${step.id}-${index}`,
    templateStepId: step.id,
    title: step.title || "",
    description: step.description || "",
    sortOrder: index + 1,
    priority: step.priority || "Normal",
    isActive: true,
    status: "Pending",
    completedAt: null,
  };
}

export function buildBlankTemplateStep(index = 0) {
  return {
    localId: `template-step-${Date.now()}-${index}`,
    title: "",
    description: "",
    sortOrder: index + 1,
    priority: "Normal",
    isRequired: true,
  };
}
