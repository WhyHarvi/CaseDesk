// IMM 1344 — Application to Sponsor, Sponsorship Agreement and
// Undertaking. Filled out by the sponsor, not the principal applicant —
// CaseDesk has no sponsor-identity record (no name/DOB/passport for the
// sponsor), only the relationship/sponsorship-undertaking facts collected
// in the "Relationship & Sponsorship" questionnaire section. Deliberately
// scoped to just those real, already-collected facts rather than guessing
// at sponsor identity fields nothing in the app actually gathers.
//
// No PDF field mapping yet — readiness only (see imm1294.js's header note).
export default {
  formNumber: "IMM1344",
  mappingVersion: null,
  factKeys: [
    "sponsorStatus",
    "relationshipType",
    "relationshipStartDate",
    "cohabitationStartDate",
    "marriageDate",
    "relationshipEvidence",
    "sponsorFinancialSupport",
    "sponsorIncomeYear1",
    "sponsorIncomeYear2",
    "sponsorIncomeYear3",
    "sponsorDependentsCount",
    "sponsorPriorSponsorship",
    "sponsorPriorSponsorshipDetails",
  ],
};
