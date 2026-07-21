import { getSection } from "./informationSectionCatalog.js";
import { adaptLegacyFormData } from "./legacyFormDataAdapter.js";

// Section-scoped mutation is only offered for sections with exactly one
// legacy write target. applicantDetails merges 7 legacy paths
// (profile/language/languageExams/work/education/additional/jobOffer plus
// profileQuestionnaires.applicantIdentity) with no metadata recording which
// source field each value came from, so there is no way to write a single
// edited value back to the right one unambiguously — it stays editable only
// through the existing whole-assessment PATCH /:id/assessment.
export class UnsupportedSectionMutationError extends Error {
  constructor(sectionKey) {
    super(`Section "${sectionKey}" merges more than one legacy source and has no single write target for section-scoped mutation.`);
    this.name = "UnsupportedSectionMutationError";
    this.sectionKey = sectionKey;
  }
}

export class UnknownSectionError extends Error {
  constructor(sectionKey) {
    super(`Unknown information section "${sectionKey}"`);
    this.name = "UnknownSectionError";
    this.sectionKey = sectionKey;
  }
}

function asPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function setPath(source, dottedPath, value) {
  const segments = dottedPath.split(".");
  const root = { ...asObject(source) };
  let cursor = root;
  for (let index = 0; index < segments.length - 1; index += 1) {
    const key = segments[index];
    cursor[key] = { ...asObject(cursor[key]) };
    cursor = cursor[key];
  }
  cursor[segments[segments.length - 1]] = value;
  return root;
}

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

/**
 * Pure planning step for a section-scoped write: given the section key, the
 * case's current formData, and the new raw (legacy-shaped) value for that
 * section, returns the updated formData plus the freshly re-adapted
 * canonical value for that section. No I/O — sectionMutationService.js
 * wraps this with the actual DB transaction. Kept separate and pure so it
 * can be tested the same way as the rest of Phase 1's domain layer.
 *
 * `rawValue` must be the same shape legacyFormDataAdapter.js reads back out
 * (e.g. `{ entries: [...], complete: "Yes" }` for a collection section,
 * `{ father: {...}, mother: {...}, complete: "Yes" }` for a paired section) —
 * it is written verbatim to formData at the section's single legacy path,
 * then re-read through the same adapter everyone else uses, so the
 * canonical table can never encode something formData itself couldn't
 * produce.
 */
export function buildSectionMutationPlan({ sectionKey, formData, rawValue }) {
  const section = getSection(sectionKey);
  if (!section) throw new UnknownSectionError(sectionKey);
  if (section.legacyPaths.length !== 1) throw new UnsupportedSectionMutationError(sectionKey);
  if (!asPlainObject(rawValue)) throw new Error("Section data must be a plain object");

  const newFormData = setPath(formData, section.legacyPaths[0], rawValue);
  const adapted = adaptLegacyFormData(newFormData);

  return {
    scope: section.scope,
    legacyPath: section.legacyPaths[0],
    newFormData,
    canonicalData: adapted[sectionKey],
  };
}
