export const STANDARD_CASE_TYPES = [
  "Canadian Citizenship",
  "General Consultation",
  "LMIA - Employer Service",
  "PR - Express Entry - PNP",
  "Spousal and Family Sponsorship",
  "Spousal Open Work Permit",
  "Study Permit",
  "Visitor Visa - TRV",
  "Work permit / Open Work permit",
];

const CASE_TYPE_ALIASES = new Map([
  ["sowp", "Spousal Open Work Permit"],
  ["spousal owp", "Spousal Open Work Permit"],
  ["spousal open wp", "Spousal Open Work Permit"],
  ["spouse open work permit", "Spousal Open Work Permit"],
  ["spousal open wok permit", "Spousal Open Work Permit"],
]);

export function normalizeCaseType(value) {
  return String(value || "").trim().replace(/\s+/g, " ").toLowerCase();
}

function capitalizeFirstLetter(value) {
  return value ? `${value.charAt(0).toUpperCase()}${value.slice(1)}` : "";
}

export function canonicalCaseType(value) {
  const label = String(value || "").trim().replace(/\s+/g, " ");
  const key = normalizeCaseType(label);
  return CASE_TYPE_ALIASES.get(key)
    || STANDARD_CASE_TYPES.find((type) => normalizeCaseType(type) === key)
    || capitalizeFirstLetter(label);
}

export function caseTypeMatchesQuery(value, query) {
  const needle = normalizeCaseType(query);
  if (!needle) return true;
  const canonical = canonicalCaseType(value);
  if (normalizeCaseType(canonical).includes(needle)) return true;
  return [...CASE_TYPE_ALIASES].some(([alias, label]) => label === canonical && alias.includes(needle));
}

export function isReusableCaseType(value) {
  const label = String(value || "").trim().replace(/\s+/g, " ");
  return Boolean(label) && !/^(?:i|we)\s+(?:am|are|have|need|want|would|wish)\b/i.test(label);
}

export function buildCaseTypeFilterOptions(cases = [], configuredOptions = []) {
  const labels = new Map([...STANDARD_CASE_TYPES, ...configuredOptions].map((label) => [normalizeCaseType(label), label]));
  for (const item of cases) {
    const label = canonicalCaseType(item?.caseType);
    const key = normalizeCaseType(label);
    if (isReusableCaseType(label) && !labels.has(key)) labels.set(key, label);
  }
  return [...labels.values()].sort((left, right) => left.localeCompare(right));
}
