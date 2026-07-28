// Canonical information sections. This formalizes the taxonomy that
// already exists as CaseWorkspaceTabs.jsx's 16 static profileDetailTabs —
// it does not invent a new one — so the same real formData this app has
// always written stays readable, and golden-master tests are checking
// stability against real data, not a new shape.
//
// `kind` distinguishes two legacy storage shapes found in real
// CaseAssessment.formData:
//   - "flat": a single key -> string dict (e.g. formData.profileQuestionnaires.background)
//   - "collection": a list under `entryListKey`, sometimes behind a Yes/No
//     `gateKey` (e.g. formData.travelHistory = { entries: [...], hasTravelled }),
//     with an explicit `completeKey` flag that can be "Yes" even with zero
//     entries — confirmed in real data as "nothing to report", not "not started"
//   - "pairedEntities": exactly two fixed sub-records (parents.father / parents.mother)
//
// `knownFields` are the real field keys pulled from
// frontend/src/components/case-profile/ProfileQuestionnaireSection.jsx and
// ProfileCollectionQuestionnaire.jsx — used by sectionCompletionService for
// a filled/total ratio instead of a vague "has any value" check. Sections
// without a dedicated field catalog today (applicantDetails' CRS inputs,
// spouseDetails) list `knownFields: null` and fall back to a generic
// non-empty-top-level-key heuristic — deliberately not guessing an
// exhaustive field list that doesn't exist anywhere in the app yet.
//
// `scope` (Phase 2) — FIRST-DRAFT CLASSIFICATION, needs the same domain
// review as caseTypeRequirements.js, not authoritative:
//   - "client": biographical/historical facts about the person, reusable
//     across every case that client has (address history, family members,
//     identity documents, etc.) — stored in ClientInformationProfile.
//   - "case": program-specific declarations that legitimately differ per
//     application (a client's second case may answer these differently
//     than their first) — stored in CaseInformationProfile.

const CANADIAN_STATUS_FIELDS = ["currentlyInCanada", "currentStatus", "statusExpiry", "uci", "priorCanadaApplication", "refusedCanadaApplication", "refusalDetails"];
const BACKGROUND_FIELDS = ["medicalCondition", "medicalDetails", "criminalHistory", "criminalDetails", "immigrationViolation", "violationDetails", "visaRefusal", "visaRefusalDetails", "militaryService", "militaryDetails", "governmentPosition", "governmentDetails", "securityConcern", "securityDetails"];
const SPONSORSHIP_FIELDS = ["sponsorStatus", "relationshipType", "relationshipStartDate", "cohabitationStartDate", "marriageDate", "relationshipEvidence", "sponsorFinancialSupport", "sponsorIncomeYear1", "sponsorIncomeYear2", "sponsorIncomeYear3", "sponsorDependentsCount", "sponsorPriorSponsorship", "sponsorPriorSponsorshipDetails"];
const PROGRAM_DETAILS_FIELDS = ["purposeOfTravel", "plannedArrivalDate", "plannedDepartureDate", "intendedLengthOfStay", "destination", "accommodation", "invitingPerson", "fundsAvailable", "fundsCurrency", "fundingSource", "tripPayer", "financialEvidence", "homeCountryTies", "returnPlan", "canadianEmployer", "educationalInstitution", "provincialNomination", "nominationDetails", "businessProposal"];
const HUMANITARIAN_CITIZENSHIP_FIELDS = ["canadianEstablishment", "hardshipDetails", "childrenBestInterest", "physicalPresenceDays", "taxFiledYears", "citizenshipProhibition", "prohibitionDetails"];
const REHABILITATION_FIELDS = ["offenceDate", "offenceCountry", "offenceDescription", "courtOutcome", "sentenceCompletedDate", "policeCertificates", "rehabilitationEvidence"];
const REFUGEE_PROTECTION_FIELDS = ["claimBasis", "fearedPersons", "riskEvents", "policeProtection", "policeProtectionDetails", "internalRelocation", "internalRelocationDetails", "priorClaims", "priorClaimDetails", "supportingEvidence"];

const DEPENDANT_FIELDS = ["uci", "familyName", "givenNames", "gender", "dateOfBirth", "maritalStatus", "relationship", "countryOfBirth", "citizenships", "countryOfResidence", "presentAddress", "presentOccupation", "financiallyReliant", "statusInCanada", "accompanyingCanada", "nonAccompanyingReason", "communicationEmail"];
const IDENTITY_DOCUMENT_FIELDS = ["documentType", "documentNumber", "issuingCountry", "issueDate", "expiryDate"];
const SIBLING_FIELDS = ["familyName", "givenNames", "gender", "dateOfBirth", "maritalStatus", "presentOccupation", "presentAddress", "countryOfBirth", "countryOfResidence", "citizenships", "statusInCanada", "canadianCityProvince", "relationship", "accompanyingCanada", "communicationEmail"];
const ACTIVITY_FIELDS = ["startDate", "endDate", "activityType", "city", "country", "provinceState", "status"];
const ADDRESS_FIELDS = ["startDate", "endDate", "unit", "streetNumber", "streetName", "city", "province", "postalCode", "country", "residenceType"];
const TRAVEL_FIELDS = ["entryDate", "exitDate", "country", "entryCity", "visaRequired", "purpose", "reasonDetails", "overstayed", "overstayDetails"];
const PARENT_FIELDS = ["familyName", "givenNames", "dateOfBirth", "maritalStatus", "presentOccupation", "presentAddress", "cityOfBirth", "countryOfBirth", "countryOfResidence", "citizenships", "accompanyingCanada", "deceased", "communicationEmail", "dateOfDeath", "relationshipCategory"];

export const INFORMATION_SECTIONS = [
  {
    key: "applicantDetails",
    label: "Applicant Details",
    group: "Applicant",
    kind: "flat",
    scope: "case",
    // Merges two structurally different legacy sources: identity-form
    // fields (profileQuestionnaires.applicantIdentity — familyName, gender,
    // etc.) and CRS-input fields (profile/language/work/additional/jobOffer
    // — age, education, test scores, etc.). Confirmed via golden-master
    // testing against real data that a single fixed field list is wrong
    // here: a real case with only CRS-input data and no identity-form data
    // (or vice versa) was scored not_started despite having 20 real filled
    // values. No single canonical field list exists for this merged shape
    // today, so this deliberately uses the generic "any key present"
    // fallback (knownFields: null) rather than an incomplete fixed list.
    legacyPaths: ["profile", "language", "languageExams", "work", "education", "additional", "jobOffer", "profileQuestionnaires.applicantIdentity"],
    knownFields: null,
  },
  {
    key: "spouseDetails",
    label: "Spouse Details",
    group: "Family",
    kind: "flat",
    scope: "client",
    legacyPaths: ["spouse"],
    knownFields: null,
  },
  {
    key: "children",
    label: "Children",
    group: "Family",
    kind: "collection",
    scope: "client",
    legacyPaths: ["dependantsAndChildren"],
    entryListKey: "dependants",
    completeKey: "complete",
    gateKey: "hasMoreDependants",
    knownFields: DEPENDANT_FIELDS,
  },
  {
    key: "siblingDetails",
    label: "Sibling Details",
    group: "Family",
    kind: "collection",
    scope: "client",
    legacyPaths: ["siblings"],
    entryListKey: "siblings",
    completeKey: "complete",
    gateKey: "hasMoreSiblings",
    knownFields: SIBLING_FIELDS,
  },
  {
    key: "parentDetails",
    label: "Parent Details",
    group: "Family",
    kind: "pairedEntities",
    scope: "client",
    legacyPaths: ["parents"],
    pairKeys: ["father", "mother"],
    completeKey: "complete",
    knownFields: PARENT_FIELDS,
  },
  {
    key: "activityHistory",
    label: "Activity History",
    group: "History",
    kind: "collection",
    scope: "client",
    legacyPaths: ["activityHistory"],
    entryListKey: "entries",
    completeKey: "complete",
    knownFields: ACTIVITY_FIELDS,
  },
  {
    key: "addressHistory",
    label: "Address History",
    group: "History",
    kind: "collection",
    scope: "client",
    legacyPaths: ["addressHistory"],
    entryListKey: "entries",
    completeKey: "complete",
    knownFields: ADDRESS_FIELDS,
  },
  {
    key: "travelHistory",
    label: "Travel History",
    group: "History",
    kind: "collection",
    scope: "client",
    legacyPaths: ["travelHistory"],
    entryListKey: "entries",
    completeKey: "complete",
    gateKey: "hasTravelled",
    knownFields: TRAVEL_FIELDS,
  },
  {
    key: "identityPermits",
    label: "Identity & Permits",
    group: "History",
    kind: "collection",
    scope: "client",
    legacyPaths: ["identityPermits"],
    entryListKey: "documents",
    completeKey: "complete",
    gateKey: "provideDetails",
    knownFields: IDENTITY_DOCUMENT_FIELDS,
  },
  {
    key: "canadianStatus",
    label: "Canadian Status",
    group: "Program-specific",
    kind: "flat",
    scope: "case",
    legacyPaths: ["profileQuestionnaires.canadianStatus"],
    knownFields: CANADIAN_STATUS_FIELDS,
  },
  {
    key: "backgroundAdmissibility",
    label: "Background & Admissibility",
    group: "Program-specific",
    kind: "flat",
    scope: "client",
    legacyPaths: ["profileQuestionnaires.background"],
    knownFields: BACKGROUND_FIELDS,
  },
  {
    key: "relationshipSponsorship",
    label: "Relationship & Sponsorship",
    group: "Program-specific",
    kind: "flat",
    scope: "case",
    legacyPaths: ["profileQuestionnaires.sponsorship"],
    knownFields: SPONSORSHIP_FIELDS,
  },
  {
    key: "programDetails",
    label: "Program Details",
    group: "Program-specific",
    kind: "flat",
    scope: "case",
    legacyPaths: ["profileQuestionnaires.programDetails"],
    knownFields: PROGRAM_DETAILS_FIELDS,
  },
  {
    key: "humanitarianCitizenship",
    label: "Humanitarian & Citizenship",
    group: "Program-specific",
    kind: "flat",
    scope: "case",
    legacyPaths: ["profileQuestionnaires.humanitarianCitizenship"],
    knownFields: HUMANITARIAN_CITIZENSHIP_FIELDS,
  },
  {
    key: "rehabilitation",
    label: "Rehabilitation",
    group: "Program-specific",
    kind: "flat",
    scope: "case",
    legacyPaths: ["profileQuestionnaires.rehabilitation"],
    knownFields: REHABILITATION_FIELDS,
  },
  {
    key: "refugeeProtection",
    label: "Refugee & Protection",
    group: "Program-specific",
    kind: "flat",
    scope: "case",
    legacyPaths: ["profileQuestionnaires.refugeeProtection"],
    knownFields: REFUGEE_PROTECTION_FIELDS,
  },
];

const SECTION_BY_KEY = new Map(INFORMATION_SECTIONS.map((section) => [section.key, section]));

export function getSection(sectionKey) {
  return SECTION_BY_KEY.get(sectionKey) || null;
}

export function listSectionKeys() {
  return INFORMATION_SECTIONS.map((section) => section.key);
}

export function listSectionKeysByScope(scope) {
  return INFORMATION_SECTIONS.filter((section) => section.scope === scope).map((section) => section.key);
}
