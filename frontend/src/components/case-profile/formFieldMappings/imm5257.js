// IMM 5257 — Application for Temporary Resident Visa (visitor visa /
// super visa). Same core biodata + passport + background shape as IMM 1294
// (which is IRCC's study-permit-specific variant of the same generic
// temporary-resident visa application) — swaps the study-specific
// educationalInstitution fact for visitor-visa-relevant trip/ties facts.
//
// No PDF field mapping yet (see formAutofillMappings.js) — readiness only
// until someone hand-authors buildPdfValues against the real IMM 5257 PDF.
export default {
  formNumber: "IMM5257",
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
    "purposeOfTravel",
    "intendedLengthOfStay",
    "fundsAvailable",
    "homeCountryTies",
    "backgroundDeclarations",
    "spouseDetails",
    "travelHistory",
  ],
};
