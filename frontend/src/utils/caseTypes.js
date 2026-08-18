export const STANDARD_CASE_TYPES = [
  "Canadian Citizenship",
  "General Consultation",
  "LMIA - Employer Service",
  "PR - Express Entry - PNP",
  "Spousal and Family Sponsorship",
  "Study Permit",
  "Visitor Visa - TRV",
  "Work permit / Open Work permit",
];

export function normalizeCaseType(value) {
  return String(value || "").trim().replace(/\s+/g, " ").toLowerCase();
}

export function isReusableCaseType(value) {
  const label = String(value || "").trim().replace(/\s+/g, " ");
  return Boolean(label) && !/^(?:i|we)\s+(?:am|are|have|need|want|would|wish)\b/i.test(label);
}

export function buildCaseTypeFilterOptions(cases = []) {
  const labels = new Map(STANDARD_CASE_TYPES.map((label) => [normalizeCaseType(label), label]));
  for (const item of cases) {
    const label = String(item?.caseType || "").trim().replace(/\s+/g, " ");
    const key = normalizeCaseType(label);
    if (isReusableCaseType(label) && !labels.has(key)) labels.set(key, label);
  }
  return [...labels.values()].sort((left, right) => left.localeCompare(right));
}
