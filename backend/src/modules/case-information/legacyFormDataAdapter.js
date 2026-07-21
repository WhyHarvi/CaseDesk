import { INFORMATION_SECTIONS } from "./informationSectionCatalog.js";

function getPath(source, dottedPath) {
  return dottedPath.split(".").reduce((value, key) => (value && typeof value === "object" ? value[key] : undefined), source);
}

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function adaptFlatSection(formData, section) {
  const raw = section.legacyPaths.reduce((merged, path) => ({ ...merged, ...asObject(getPath(formData, path)) }), {});
  return { kind: "flat", raw };
}

function adaptCollectionSection(formData, section) {
  const raw = asObject(getPath(formData, section.legacyPaths[0]));
  const entries = asArray(raw[section.entryListKey]);
  return {
    kind: "collection",
    raw,
    entries,
    entryCount: entries.length,
    complete: section.completeKey ? raw[section.completeKey] : undefined,
    gate: section.gateKey ? raw[section.gateKey] : undefined,
  };
}

function adaptPairedEntitiesSection(formData, section) {
  const raw = asObject(getPath(formData, section.legacyPaths[0]));
  const pairs = Object.fromEntries(section.pairKeys.map((key) => [key, asObject(raw[key])]));
  return {
    kind: "pairedEntities",
    raw,
    pairs,
    complete: section.completeKey ? raw[section.completeKey] : undefined,
  };
}

/**
 * Reads today's CaseAssessment.formData (one untyped JSON blob, fully
 * overwritten on every save — see caseAssessmentController.js) into one
 * stable shape per canonical section, so every downstream function can
 * stop caring about the legacy JSON's per-section quirks: nested
 * profileQuestionnaires paths, explicit "complete" flags that can be
 * "Yes" with zero entries (confirmed in real data as "nothing to
 * report", not "not started"), and inconsistent plural key names
 * (dependants / siblings / documents / entries).
 */
export function adaptLegacyFormData(formData) {
  const source = asObject(formData);
  const adapted = {};
  for (const section of INFORMATION_SECTIONS) {
    if (section.kind === "flat") adapted[section.key] = adaptFlatSection(source, section);
    else if (section.kind === "collection") adapted[section.key] = adaptCollectionSection(source, section);
    else if (section.kind === "pairedEntities") adapted[section.key] = adaptPairedEntitiesSection(source, section);
  }
  return adapted;
}
