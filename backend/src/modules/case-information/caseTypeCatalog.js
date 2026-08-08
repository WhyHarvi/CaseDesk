import { canonicalCaseType, DEFAULT_WORKFLOW_TEMPLATES, getTemplateCaseTypeKeys, normalizeCaseType } from "../../services/workflowService.js";

// Case type is free text on Case.caseType (no enum) — agencies can type
// anything. This resolves that free text down to one of the known
// workflow-template buckets shared with workflowService.js, rather than
// maintaining a second, competing alias list.
export { canonicalCaseType, normalizeCaseType };

const CASE_TYPE_KEYS = DEFAULT_WORKFLOW_TEMPLATES.map((template) => normalizeCaseType(template.caseType));

/**
 * Resolves free-text case type input to a canonical case-type key.
 * Tries an exact alias match first, then a substring-contains fallback
 * (e.g. "Study Permit Extension" resolves to "study permit" — confirmed
 * against real case data that this fallback is necessary, not
 * theoretical: exact-alias-only left real dev-DB cases unclassified).
 * Returns null for genuinely unclassified free text — callers must treat
 * null as "unknown", never as "no requirements".
 */
export function resolveCaseTypeKey(caseType) {
  const normalized = normalizeCaseType(caseType);
  if (!normalized) return null;

  for (const template of DEFAULT_WORKFLOW_TEMPLATES) {
    if (getTemplateCaseTypeKeys(template).includes(normalized)) {
      return normalizeCaseType(template.caseType);
    }
  }

  for (const template of DEFAULT_WORKFLOW_TEMPLATES) {
    const key = normalizeCaseType(template.caseType);
    if (normalized.includes(key) || key.includes(normalized)) return key;
    if ((template.aliases || []).some((alias) => normalized.includes(normalizeCaseType(alias)))) return key;
  }

  return null;
}

export function isKnownCaseTypeKey(caseTypeKey) {
  return CASE_TYPE_KEYS.includes(caseTypeKey);
}

export function listCaseTypeKeys() {
  return [...CASE_TYPE_KEYS];
}
