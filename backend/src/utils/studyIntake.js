const REQUIRED_FROM_STAGE = "Documents Pending";
const CASE_STAGE_ORDER = [
  "Lead",
  "Consultation",
  "Retainer Pending",
  "Offer Letter Application Submitted",
  "Offer Letter Received",
  REQUIRED_FROM_STAGE,
  "Reviewing Documents",
  "Application Preparing",
  "Submitted",
  "Decision Received",
  "Closed",
];

export function isStudyPermitCaseType(value) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[-_/]+/g, " ")
    .replace(/\s+/g, " ");
  return normalized === "study" || /\bstudy permit\b/.test(normalized);
}

export function normalizeStudyIntakeMonth(value) {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  const parsed = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return new Date(Date.UTC(parsed.getUTCFullYear(), parsed.getUTCMonth(), 1));
}

export function studyIntakeKey(value) {
  const normalized = normalizeStudyIntakeMonth(value);
  return normalized ? normalized.toISOString().slice(0, 7) : "";
}

export function formatStudyIntakeMonth(value) {
  const normalized = normalizeStudyIntakeMonth(value);
  if (!normalized) return "Intake not set";
  return new Intl.DateTimeFormat("en-CA", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(normalized);
}

export function stageRequiresStudyIntake(stage) {
  const index = CASE_STAGE_ORDER.indexOf(stage);
  return index >= CASE_STAGE_ORDER.indexOf(REQUIRED_FROM_STAGE);
}
