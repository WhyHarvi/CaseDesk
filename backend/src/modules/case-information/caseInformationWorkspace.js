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
 *
 * `enabledSectionKeys` (Phase 6, manual section assignment) is the set of
 * sectionKeys a consultant has explicitly added to this case via
 * CaseInformationSectionState.enabled — the caller loads that from the DB
 * since this layer stays database-free. A section is worth showing in the
 * UI (`isVisible`) when it's required (case type structurally needs it,
 * regardless of assignment), explicitly enabled, or already has real data
 * — matching the "existing data never disappears" rule the rest of this
 * domain layer already follows for not_applicable sections.
 */
export function buildCaseInformationSummary({ caseType, formData, enabledSectionKeys = new Set() }) {
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
    const enabled = enabledSectionKeys.has(sectionMeta.key);
    // "complete" or "in_progress" specifically, not filledCount > 0 or
    // "status !== not_started": a collection/paired section can be
    // "complete" via an explicit flag with zero filled entries (the
    // real-world "reviewed, nothing to report" pattern — see
    // sectionCompletionService.js) and must still show. A not_applicable
    // status specifically means zero data (see its short-circuit rule)
    // and must stay hidden, not be mistaken for "has content".
    const isVisible = requirementLevel === "required" || enabled || result.status === "complete" || result.status === "in_progress";
    return {
      sectionKey: sectionMeta.key,
      label: sectionMeta.label,
      group: sectionMeta.group,
      requirementLevel,
      status: result.status,
      filledCount: result.filledCount,
      totalCount: result.totalCount,
      enabled,
      isVisible,
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
