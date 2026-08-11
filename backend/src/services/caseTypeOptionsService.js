import prisma from "./prisma/client.js";
import {
  DEFAULT_WORKFLOW_TEMPLATES,
  canonicalCaseType,
  normalizeCaseType,
} from "./workflowService.js";

export async function listAgencyCaseTypeOptions(agencyId, db = prisma) {
  const [cases, documentTemplates, workflowTemplates] = await Promise.all([
    db.case.findMany({ where: { agencyId }, select: { caseType: true } }),
    db.documentTemplate.findMany({
      where: { agencyId },
      select: { caseType: true },
      distinct: ["caseType"],
    }),
    db.workflowTemplate.findMany({
      where: { agencyId },
      select: { caseType: true },
      distinct: ["caseType"],
    }),
  ]);

  const countsByNormalized = new Map();
  const bump = (caseType, weight) => {
    if (!caseType) return;
    const canonical = canonicalCaseType(caseType);
    const normalized = normalizeCaseType(canonical);
    if (!normalized) return;
    const counts = countsByNormalized.get(normalized) || new Map();
    counts.set(canonical, (counts.get(canonical) || 0) + weight);
    countsByNormalized.set(normalized, counts);
  };

  for (const template of DEFAULT_WORKFLOW_TEMPLATES)
    bump(template.caseType, 2_000);
  for (const { caseType } of cases) bump(caseType, 1);
  for (const { caseType } of [...documentTemplates, ...workflowTemplates])
    bump(caseType, 1_000);

  return [...countsByNormalized.values()]
    .map(
      (counts) =>
        [...counts.entries()].sort((left, right) => right[1] - left[1])[0][0],
    )
    .sort((left, right) => left.localeCompare(right));
}
