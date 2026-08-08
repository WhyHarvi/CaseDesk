const CASE_STAGE_ORDER = [
  "Lead",
  "Consultation",
  "Retainer Pending",
  "Documents Pending",
  "Reviewing Documents",
  "Application Preparing",
  "Submitted",
  "Decision Received",
  "Closed",
];

export function isStudyPermitCaseType(value) {
  const normalized = String(value || "").trim().toLowerCase().replace(/\s+/g, " ");
  return normalized === "study" || normalized === "study permit";
}

export function studyIntakeValue(value) {
  if (!value) return "";
  const direct = String(value).match(/^(\d{4})-(0[1-9]|1[0-2])/);
  if (direct) return `${direct[1]}-${direct[2]}`;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString().slice(0, 7);
}

export function formatStudyIntake(value, { short = false } = {}) {
  const key = studyIntakeValue(value);
  if (!key) return "Intake not set";
  const date = new Date(`${key}-01T00:00:00.000Z`);
  return new Intl.DateTimeFormat("en-CA", {
    month: short ? "short" : "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}

export function studyIntakeIsPast(value) {
  const key = studyIntakeValue(value);
  if (!key) return false;
  const now = new Date();
  const current = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  return key < current;
}

export function stageRequiresStudyIntake(stage) {
  const index = CASE_STAGE_ORDER.indexOf(stage);
  return index >= CASE_STAGE_ORDER.indexOf("Documents Pending");
}

export function studyIntakeApiValue(value) {
  const key = studyIntakeValue(value);
  return key ? `${key}-01` : null;
}
