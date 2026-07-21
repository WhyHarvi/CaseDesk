import { resolveCaseTypeKey } from "./caseTypeCatalog.js";
import { listSectionKeys } from "./informationSectionCatalog.js";
import { CASE_TYPE_REQUIREMENTS, REQUIREMENT_LEVELS } from "./caseTypeRequirements.js";

/**
 * Resolves the requirement level for every canonical section given a
 * (free-text) case type. Unrecognized case types — and any section a
 * recognized case type's requirement map forgot to mention — default to
 * "optional", never "not_applicable": an unclassified case type must
 * never cause a section to silently disappear from a consultant's view.
 */
export function resolveSectionRequirements(caseType) {
  const caseTypeKey = resolveCaseTypeKey(caseType);
  const requirementsForType = caseTypeKey ? CASE_TYPE_REQUIREMENTS[caseTypeKey] : null;

  return listSectionKeys().map((sectionKey) => ({
    sectionKey,
    level: requirementsForType?.[sectionKey] || REQUIREMENT_LEVELS.OPTIONAL,
  }));
}

export function resolveSectionRequirement(caseType, sectionKey) {
  return resolveSectionRequirements(caseType).find((entry) => entry.sectionKey === sectionKey) || null;
}
