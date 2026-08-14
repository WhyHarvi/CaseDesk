import { APPLICANT_FACTS, present } from "./applicantFactCatalog";
import { getFormFieldMapping } from "./formFieldMappings/index";

function field(key, fact, resolved) {
  const isObject = resolved && typeof resolved === "object" && !Array.isArray(resolved) && "value" in resolved;
  const value = isObject ? resolved.value : resolved;
  const status = (isObject && resolved.status) || (present(value) ? "ready" : "missing");
  const note = (isObject && resolved.note) || "";
  return {
    key,
    label: fact.label,
    value: present(value) ? String(value) : "",
    profileTab: fact.editTarget?.tab || null,
    profileView: fact.editTarget?.view || null,
    status,
    note,
    // Client-model fields (dateOfBirth, email) have no editable control on
    // any profile tab — they live on the Client record and are edited via
    // ClientEditDrawer. CRS-input facts (language/work/education history)
    // are only ever entered through the Assessment wizard, not a profile
    // tab. The readiness click-through checks these flags to route to the
    // right surface instead of a profile tab that can't set the value (see
    // MissingInformationOverlay in CaseFormsWorkspace.jsx).
    clientField: Boolean(fact.editTarget?.clientField),
    assessmentOverlay: Boolean(fact.editTarget?.assessmentOverlay),
  };
}

function summarize(fields) {
  return fields.reduce((summary, item) => ({ ...summary, [item.status]: (summary[item.status] || 0) + 1 }), { ready: 0, missing: 0, review: 0, conditional: 0 });
}

/**
 * Generic readiness/autofill engine. Looks up the form's field mapping
 * (formFieldMappings/*.js) by normalized form number, resolves its
 * factKeys against the shared fact catalog (applicantFactCatalog.js), and
 * builds the same fields[]/analysis shape the UI has always consumed. A
 * form with no mapping file returns the same empty result every form got
 * before IMM 1294 existed — no regression, just "not yet authored".
 */
export function buildCaseFormAutofill(item, caseItem, assessment, extra = {}) {
  const mapping = getFormFieldMapping(item?.formNumber);
  if (!mapping) return { mappingVersion: null, values: {}, warnings: [], fields: [], analysis: null };

  // representative/agency/applicantProfile are optional — only forms that
  // are actually about a representative (IMM 5476) read them. A form with
  // no buildPdfValues, or one that only reads ctx.client, works exactly as
  // before whether or not a caller passes `extra`.
  const ctx = {
    formData: assessment?.formData || {},
    client: caseItem?.client || {},
    case: caseItem ? { caseType: caseItem.caseType, applicationNumber: caseItem.applicationNumber } : {},
    representative: extra.representative || null,
    agency: extra.agency || null,
    applicantProfile: item?.applicantProfile || null,
  };
  const fields = [];
  for (const key of mapping.factKeys) {
    const fact = APPLICANT_FACTS[key];
    if (!fact) continue;
    if (fact.includeIf && !fact.includeIf(ctx)) continue;
    fields.push(field(key, fact, fact.read(ctx)));
  }

  const nameWasInferred = fields.some((entry) => (entry.key === "familyName" || entry.key === "givenNames") && entry.status === "review");
  const values = mapping.buildPdfValues ? mapping.buildPdfValues(ctx) : {};
  const mappingWarnings = mapping.getWarnings ? mapping.getWarnings(ctx) : [];

  return {
    mappingVersion: mapping.mappingVersion,
    values: Object.fromEntries(Object.entries(values).filter(([, value]) => value !== "")),
    warnings: [
      ...(nameWasInferred ? ["Family and given names were inferred from the client's full name. Verify them against the passport."] : []),
      ...mappingWarnings,
    ],
    fields,
    analysis: summarize(fields),
  };
}
