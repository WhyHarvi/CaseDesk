import prisma from "./prisma/client.js";

function validDate(value) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function assignmentsFrom(formData) {
  return Array.isArray(formData?.questionnaireAssignments)
    ? formData.questionnaireAssignments.filter((item) => item && typeof item === "object" && String(item.id || "").trim())
    : [];
}

export async function syncQuestionnaireAssignments({
  assessmentId,
  agencyId,
  caseId,
  clientId,
  formData,
  db = prisma,
}) {
  const assignments = assignmentsFrom(formData);
  const existing = await db.questionnaireAssignment.findMany({
    where: { assessmentId },
    select: { id: true, sourceId: true, sharing: true, status: true, dueAt: true, locked: true },
  });
  const existingBySource = new Map(existing.map((item) => [item.sourceId, item]));
  const sourceIds = [];
  const changes = [];

  for (const assignment of assignments) {
    const sourceId = String(assignment.id).trim().slice(0, 240);
    sourceIds.push(sourceId);
    const previous = existingBySource.get(sourceId);
    const data = {
      agencyId,
      assessmentId,
      caseId,
      clientId,
      name: String(assignment.name || assignment.applicationType || "Questionnaire").trim().slice(0, 240) || "Questionnaire",
      sharing: String(assignment.sharing || "Internal").trim().slice(0, 40),
      status: String(assignment.status || "Assigned").trim().slice(0, 60),
      dueAt: validDate(assignment.dueDate),
      locked: Boolean(assignment.locked),
      assignedAt: validDate(assignment.assignedAt) || new Date(),
      submittedAt: validDate(assignment.submittedAt),
      sourceData: assignment,
    };
    const saved = await db.questionnaireAssignment.upsert({
      where: { assessmentId_sourceId: { assessmentId, sourceId } },
      create: { sourceId, ...data },
      update: data,
    });
    const changed = !previous || previous.sharing !== saved.sharing || previous.status !== saved.status
      || previous.locked !== saved.locked || String(previous.dueAt || "") !== String(saved.dueAt || "");
    if (changed) changes.push({ previous, current: saved });
  }

  await db.questionnaireAssignment.deleteMany({
    where: { assessmentId, ...(sourceIds.length ? { sourceId: { notIn: sourceIds } } : {}) },
  });
  return { assignments, changes };
}

export async function updateNormalizedQuestionnaireAssignment({ assessmentId, sourceId, data }) {
  return prisma.questionnaireAssignment.updateMany({
    where: { assessmentId, sourceId },
    data,
  });
}
