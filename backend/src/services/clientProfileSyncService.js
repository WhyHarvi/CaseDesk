export const MARITAL_STATUS_VALUES = [
  "Annulled Marriage",
  "Common-Law",
  "Divorced / Separated",
  "Legally Separated",
  "Married",
  "Never Married / Single",
  "Widowed",
];

const MARITAL_STATUS_ALIASES = new Map([
  ["annulled", "Annulled Marriage"],
  ["annulled marriage", "Annulled Marriage"],
  ["common law", "Common-Law"],
  ["common-law", "Common-Law"],
  ["divorced", "Divorced / Separated"],
  ["divorced / separated", "Divorced / Separated"],
  ["separated", "Divorced / Separated"],
  ["legally separated", "Legally Separated"],
  ["married", "Married"],
  ["never married", "Never Married / Single"],
  ["never married / single", "Never Married / Single"],
  ["single", "Never Married / Single"],
  ["widowed", "Widowed"],
]);

export function normalizeMaritalStatus(value) {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (!normalized) return null;
  return MARITAL_STATUS_ALIASES.get(normalized);
}

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

export function formDataWithMaritalStatus(formData, maritalStatus) {
  const source = asObject(formData);
  return {
    ...source,
    profile: {
      ...asObject(source.profile),
      maritalStatus: maritalStatus || "",
    },
  };
}

export async function syncClientMaritalStatus(tx, {
  agencyId,
  clientId,
  maritalStatus,
  excludeAssessmentId = null,
  updateClient = true,
  assessmentPatch = null,
}) {
  if (updateClient) {
    await tx.client.updateMany({
      where: { id: clientId, agencyId },
      data: { maritalStatus },
    });
  }

  const assessments = await tx.caseAssessment.findMany({
    where: {
      agencyId,
      clientId,
      ...(excludeAssessmentId ? { id: { not: excludeAssessmentId } } : {}),
    },
    select: { id: true, formData: true },
  });

  for (const assessment of assessments) {
    const nextFormData = formDataWithMaritalStatus(
      assessment.formData,
      maritalStatus,
    );
    await tx.caseAssessment.update({
      where: { id: assessment.id },
      data: {
        formData: nextFormData,
        ...(assessmentPatch ? assessmentPatch(nextFormData) : {}),
      },
    });
  }
}
