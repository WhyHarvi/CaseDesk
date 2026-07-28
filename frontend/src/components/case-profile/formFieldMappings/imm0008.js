// IMM 0008 — Generic Application Form for Canada (the core permanent
// residence form shared by Express Entry/CEC/FSW/FST, PNP, and other PR
// pathways). Broader than the temporary-resident forms: adds address
// history, language test, work history, and education-history
// completeness facts on top of the same core biodata/passport/background
// shape — the PR-specific facts route to the CRS Assessment wizard
// (assessmentOverlay editTarget) since that's the only place CaseDesk
// collects language/work/education history today.
//
// No PDF field mapping yet — readiness only (see imm1294.js's header note).
export default {
  formNumber: "IMM0008",
  mappingVersion: null,
  factKeys: [
    "familyName",
    "givenNames",
    "dateOfBirth",
    "gender",
    "cityOfBirth",
    "countryOfBirth",
    "citizenships",
    "maritalStatus",
    "passportNumber",
    "passportCountry",
    "passportIssue",
    "passportExpiry",
    "email",
    "currentAddress",
    "activityHistoryComplete",
    "languageTestComplete",
    "workHistoryComplete",
    "educationComplete",
    "backgroundDeclarations",
    "spouseDetails",
  ],
};
