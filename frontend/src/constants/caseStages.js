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

export function caseStagesForType(caseType) {
  const normalized = String(caseType || "")
    .trim()
    .toLowerCase()
    .replace(/[-_/]+/g, " ")
    .replace(/\s+/g, " ");
  const isStudyPermit =
    normalized === "study" || /\bstudy permit\b/.test(normalized);
  return isStudyPermit
    ? CASE_STAGES
    : CASE_STAGES.filter(
        (stage) => !STUDY_PERMIT_CASE_STAGES.includes(stage),
      );
}
