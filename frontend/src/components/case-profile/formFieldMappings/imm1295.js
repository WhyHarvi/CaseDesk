// IMM 1295 — Application for a Work Permit Made Outside Canada. Same core
// biodata + passport + background shape as IMM 1294/5257, swapping the
// study/visit-purpose facts for the employer/job-offer details a work
// permit application actually asks for.
//
// No PDF field mapping yet — readiness only (see imm1294.js's header note).
export default {
  formNumber: "IMM1295",
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
    "currentStatus",
    "currentAddress",
    "canadianEmployer",
    "fundsAvailable",
    "backgroundDeclarations",
    "spouseDetails",
    "travelHistory",
  ],
};
