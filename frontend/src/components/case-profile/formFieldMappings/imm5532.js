// IMM 5532 — Relationship Information and Sponsorship Evaluation. Asks
// about the same sponsor/applicant relationship as IMM 1344's undertaking
// section (how the relationship started, cohabitation, marriage, evidence)
// with more narrative emphasis — CaseDesk has one relationshipEvidence
// field for that narrative, so this shares IMM 1344's core relationship
// facts rather than inventing a second, un-collected set.
//
// No PDF field mapping yet — readiness only (see imm1294.js's header note).
export default {
  formNumber: "IMM5532",
  mappingVersion: null,
  factKeys: [
    "relationshipType",
    "relationshipStartDate",
    "cohabitationStartDate",
    "marriageDate",
    "relationshipEvidence",
  ],
};
