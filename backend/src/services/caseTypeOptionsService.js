import prisma from "./prisma/client.js";
import {
  DEFAULT_WORKFLOW_TEMPLATES,
  ADDITIONAL_CASE_TYPE_ALIASES,
  canonicalCaseType,
  normalizeCaseType,
} from "./workflowService.js";
import { GLOBAL_CASE_TYPE_PROGRAMS } from "./documentProgramCatalog.js";

export function isCaseTypeOption(value) {
  const label = String(value || "").trim().replace(/\s+/g, " ");
  if (!label) return false;
  if (/^unassigned case type$/i.test(label)) return false;

  // Intake answers occasionally land in legacy caseType fields. They describe
  // what the person wants to discuss, but are not reusable case categories.
  return !/^(?:i|we)\s+(?:am|are|have|need|want|would|wish)\b/i.test(label);
}

export function globalCaseTypeAliases() {
  const aliases = {};
  const groups = [
    ...GLOBAL_CASE_TYPE_PROGRAMS.map((program) => ({ caseType: program.title, aliases: program.aliases || [] })),
    ...ADDITIONAL_CASE_TYPE_ALIASES,
  ];
  for (const group of groups) {
    for (const alias of group.aliases || []) aliases[normalizeCaseType(alias)] = group.caseType;
  }
  return aliases;
}

export function isGlobalCaseType(value) {
  const canonical = canonicalCaseType(value);
  const labels = [
    ...DEFAULT_WORKFLOW_TEMPLATES.map((template) => template.caseType),
    ...ADDITIONAL_CASE_TYPE_ALIASES.map((type) => type.caseType),
    ...GLOBAL_CASE_TYPE_PROGRAMS.map((program) => program.title),
  ];
  return labels.some((label) => normalizeCaseType(label) === normalizeCaseType(canonical));
}

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
    if (!isCaseTypeOption(caseType)) return;
    const canonical = canonicalCaseType(caseType);
    const normalized = normalizeCaseType(canonical);
    if (!normalized) return;
    const counts = countsByNormalized.get(normalized) || new Map();
    counts.set(canonical, (counts.get(canonical) || 0) + weight);
    countsByNormalized.set(normalized, counts);
  };

  for (const template of DEFAULT_WORKFLOW_TEMPLATES)
    bump(template.caseType, 2_000);
  for (const type of ADDITIONAL_CASE_TYPE_ALIASES)
    bump(type.caseType, 2_000);
  for (const program of GLOBAL_CASE_TYPE_PROGRAMS)
    bump(program.title, 2_000);
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
