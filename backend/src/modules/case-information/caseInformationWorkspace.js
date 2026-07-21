import { adaptLegacyFormData } from "./legacyFormDataAdapter.js";
import { getSection, INFORMATION_SECTIONS } from "./informationSectionCatalog.js";
import { resolveSectionRequirements } from "./caseRequirementResolver.js";
import { calculateSectionStatus } from "./sectionCompletionService.js";

const ATTENTION_STATUSES = new Set(["not_started", "in_progress"]);

/**
 * The single pure orchestrator this whole domain layer builds toward —
 * this is the function Phase 3's aggregated `/cases/:id/information-workspace`
 * endpoint will call directly once the schema/API work lands. No database
 * access here; the caller is responsible for loading `caseType` and
 * `formData` (today: Case.caseType + CaseAssessment.formData).
 */
export function buildCaseInformationSummary({ caseType, formData }) {
  const adapted = adaptLegacyFormData(formData);
  const requirements = resolveSectionRequirements(caseType);
  const requirementByKey = new Map(requirements.map((entry) => [entry.sectionKey, entry.level]));

  const sections = INFORMATION_SECTIONS.map((sectionMeta) => {
    const requirementLevel = requirementByKey.get(sectionMeta.key) || "optional";
    const result = calculateSectionStatus({
      sectionKey: sectionMeta.key,
      adaptedSection: adapted[sectionMeta.key],
      knownFields: sectionMeta.knownFields,
      requirementLevel,
    });
    return {
      sectionKey: sectionMeta.key,
      label: sectionMeta.label,
      group: sectionMeta.group,
      requirementLevel,
      status: result.status,
      filledCount: result.filledCount,
      totalCount: result.totalCount,
    };
  });

  const needsAttention = sections.filter((section) => section.requirementLevel === "required" && ATTENTION_STATUSES.has(section.status));

  const requiredSections = sections.filter((section) => section.requirementLevel === "required");
  const completeRequiredSections = requiredSections.filter((section) => section.status === "complete");

  return {
    sections,
    needsAttention,
    summary: {
      totalSections: sections.length,
      requiredSections: requiredSections.length,
      completeRequiredSections: completeRequiredSections.length,
    },
  };
}

export function getSectionSummary({ caseType, formData, sectionKey }) {
  const sectionMeta = getSection(sectionKey);
  if (!sectionMeta) return null;
  const { sections } = buildCaseInformationSummary({ caseType, formData });
  return sections.find((section) => section.sectionKey === sectionKey) || null;
}
