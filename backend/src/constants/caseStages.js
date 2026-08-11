// Shared by caseController and paymentScheduleService — kept in its own
// module so neither has to import the other just for this constant.
export const STUDY_PERMIT_CASE_STAGES = [
  "Offer Letter Application Submitted",
  "Offer Letter Received",
];

export const CASE_STAGES = [
  "Lead",
  "Consultation",
  "Retainer Pending",
  ...STUDY_PERMIT_CASE_STAGES,
  "Documents Pending",
  "Reviewing Documents",
  "Application Preparing",
  "Submitted",
  "Decision Received",
  "Closed",
];

const normalizedCaseType = (value) =>
  String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[-_/]+/g, " ")
    .replace(/\s+/g, " ");

export function isCaseStageAllowedForType(caseType, stage) {
  if (!CASE_STAGES.includes(stage)) return false;
  if (!STUDY_PERMIT_CASE_STAGES.includes(stage)) return true;
  const normalized = normalizedCaseType(caseType);
  return normalized === "study" || /\bstudy permit\b/.test(normalized);
}
