// One entry per underlying fact CaseDesk already collects somewhere,
// independent of any specific government form. formAutofillMappings.js's
// generic engine resolves a form's factKeys against this catalog instead of
// every form re-deriving the same values from formData by hand — this is
// IMM 1294's original 19 inline field() calls, generalized so IMM 5257,
// IMM 1295, IMM 0008, IMM 1344, and IMM 5532 can reuse them.
//
// `sectionKey` must be one of the 16 keys in
// backend/src/modules/case-information/informationSectionCatalog.js —
// enforced by backend/test/applicantFactCatalogSectionSync.test.js so the
// two lists can't silently drift apart.
//
// `editTarget` tells the readiness click-through where a consultant can
// actually go to set this fact:
//   - { tab, view? }        switches to that PROFILE tab (view defaults to
//                            "Overview" — see CaseWorkspaceTabs.jsx)
//   - { clientField: true } opens ClientEditDrawer (Client-model fields —
//                            dateOfBirth, email — have no profile-tab control)
//   - { assessmentOverlay: true } opens the CRS Assessment wizard (the only
//                            place language/work/education history is entered)
//
// `read(ctx)` receives { formData, client } and returns either a plain
// value, or `{ value, status, note }` when a fact needs a non-default
// status (an inferred name that needs review, a conditional fact that only
// applies sometimes).

export function splitApplicantName(fullName) {
  const parts = String(fullName || "").trim().split(/\s+/).filter(Boolean);
  if (parts.length < 2) return { familyName: "", givenNames: parts[0] || "", inferred: Boolean(parts.length) };
  return { familyName: parts.at(-1), givenNames: parts.slice(0, -1).join(" "), inferred: true };
}

export function isoParts(value) {
  if (!value) return {};
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return {};
  return {
    year: String(date.getUTCFullYear()),
    month: String(date.getUTCMonth() + 1).padStart(2, "0"),
    day: String(date.getUTCDate()).padStart(2, "0"),
  };
}

export function maritalCode(value) {
  const codes = { married: "01", single: "02", "common-law": "03", "common law": "03", divorced: "04", separated: "05", widowed: "06", "annulled marriage": "09" };
  return codes[String(value || "").trim().toLowerCase()] || "";
}

export function firstPassport(formData) {
  return (formData?.identityPermits?.documents || []).find((item) => String(item.documentType || "").toLowerCase() === "passport") || {};
}

export function present(value) {
  if (Array.isArray(value)) return value.length > 0;
  return value !== null && value !== undefined && String(value).trim() !== "";
}

function isMarriedOrCommonLaw(maritalStatus) {
  return ["married", "common-law", "common law"].includes(String(maritalStatus || "").toLowerCase());
}

export const APPLICANT_FACTS = {
  familyName: {
    label: "Family name",
    sectionKey: "applicantDetails",
    editTarget: { tab: "APPLICANT DETAILS" },
    read: (ctx) => {
      const applicantIdentity = ctx.formData.profileQuestionnaires?.applicantIdentity || {};
      const inferred = splitApplicantName(ctx.client.fullName);
      const value = applicantIdentity.familyName || inferred.familyName;
      const wasInferred = !applicantIdentity.familyName && Boolean(inferred.familyName);
      return { value, status: wasInferred && value ? "review" : undefined, note: wasInferred ? "Inferred from the client full name; verify against the passport." : "" };
    },
  },
  givenNames: {
    label: "Given name(s)",
    sectionKey: "applicantDetails",
    editTarget: { tab: "APPLICANT DETAILS" },
    read: (ctx) => {
      const applicantIdentity = ctx.formData.profileQuestionnaires?.applicantIdentity || {};
      const inferred = splitApplicantName(ctx.client.fullName);
      const value = applicantIdentity.givenNames || inferred.givenNames;
      const wasInferred = !applicantIdentity.givenNames && Boolean(inferred.givenNames);
      return { value, status: wasInferred && value ? "review" : undefined, note: wasInferred ? "Inferred from the client full name; verify against the passport." : "" };
    },
  },
  dateOfBirth: {
    label: "Date of birth",
    sectionKey: "applicantDetails",
    editTarget: { tab: "APPLICANT DETAILS", clientField: true },
    read: (ctx) => ctx.client.dateOfBirth,
  },
  gender: {
    label: "Gender",
    sectionKey: "applicantDetails",
    editTarget: { tab: "APPLICANT DETAILS" },
    read: (ctx) => ctx.formData.profileQuestionnaires?.applicantIdentity?.gender,
  },
  cityOfBirth: {
    label: "City or town of birth",
    sectionKey: "applicantDetails",
    editTarget: { tab: "APPLICANT DETAILS" },
    read: (ctx) => ctx.formData.profileQuestionnaires?.applicantIdentity?.cityOfBirth,
  },
  countryOfBirth: {
    label: "Country of birth",
    sectionKey: "applicantDetails",
    editTarget: { tab: "APPLICANT DETAILS" },
    read: (ctx) => ctx.formData.profileQuestionnaires?.applicantIdentity?.countryOfBirth,
  },
  citizenships: {
    label: "Citizenship(s)",
    sectionKey: "applicantDetails",
    editTarget: { tab: "APPLICANT DETAILS" },
    read: (ctx) => ctx.formData.profileQuestionnaires?.applicantIdentity?.citizenships,
  },
  nativeLanguage: {
    label: "Native language / mother tongue",
    sectionKey: "applicantDetails",
    editTarget: { tab: "APPLICANT DETAILS" },
    read: (ctx) => ctx.formData.profileQuestionnaires?.applicantIdentity?.nativeLanguage,
  },
  preferredLanguage: {
    label: "Language most at ease in",
    sectionKey: "applicantDetails",
    editTarget: { tab: "APPLICANT DETAILS" },
    read: (ctx) => ctx.formData.profileQuestionnaires?.applicantIdentity?.preferredLanguage,
  },
  maritalStatus: {
    label: "Marital status",
    sectionKey: "applicantDetails",
    editTarget: { tab: "APPLICANT DETAILS" },
    read: (ctx) => ctx.formData.profile?.maritalStatus,
  },
  email: {
    label: "Email address",
    sectionKey: "applicantDetails",
    editTarget: { tab: "APPLICANT DETAILS", clientField: true },
    read: (ctx) => ctx.client.email,
  },
  passportNumber: {
    label: "Passport number",
    sectionKey: "identityPermits",
    editTarget: { tab: "IDENTITY & PERMITS" },
    read: (ctx) => firstPassport(ctx.formData).documentNumber,
  },
  passportCountry: {
    label: "Passport issuing country",
    sectionKey: "identityPermits",
    editTarget: { tab: "IDENTITY & PERMITS" },
    read: (ctx) => firstPassport(ctx.formData).issuingCountry,
  },
  passportIssue: {
    label: "Passport issue date",
    sectionKey: "identityPermits",
    editTarget: { tab: "IDENTITY & PERMITS" },
    read: (ctx) => String(firstPassport(ctx.formData).issueDate || "").slice(0, 10),
  },
  passportExpiry: {
    label: "Passport expiry date",
    sectionKey: "identityPermits",
    editTarget: { tab: "IDENTITY & PERMITS" },
    read: (ctx) => String(firstPassport(ctx.formData).expiryDate || "").slice(0, 10),
  },
  uci: {
    label: "Unique Client Identifier (UCI)",
    sectionKey: "canadianStatus",
    editTarget: { tab: "CANADIAN STATUS" },
    read: (ctx) => ctx.formData.profileQuestionnaires?.canadianStatus?.uci,
  },
  currentStatus: {
    label: "Current country status",
    sectionKey: "canadianStatus",
    editTarget: { tab: "CANADIAN STATUS" },
    read: (ctx) => ctx.formData.profileQuestionnaires?.canadianStatus?.currentStatus,
  },
  currentlyInCanada: {
    label: "Currently in Canada",
    sectionKey: "canadianStatus",
    editTarget: { tab: "CANADIAN STATUS" },
    read: (ctx) => ctx.formData.profileQuestionnaires?.canadianStatus?.currentlyInCanada,
  },
  currentAddress: {
    label: "Current residential address",
    sectionKey: "addressHistory",
    editTarget: { tab: "ADDRESS HISTORY" },
    read: (ctx) => {
      const entry = (ctx.formData.addressHistory?.entries || [])[0] || {};
      return entry.country ? [entry.unit, entry.streetNumber, entry.streetName, entry.city, entry.province, entry.postalCode, entry.country].filter(Boolean).join(", ") : "";
    },
  },
  purposeOfTravel: {
    label: "Purpose of travel",
    sectionKey: "programDetails",
    editTarget: { tab: "PROGRAM DETAILS" },
    read: (ctx) => ctx.formData.profileQuestionnaires?.programDetails?.purposeOfTravel,
  },
  destination: {
    label: "Destination city and province",
    sectionKey: "programDetails",
    editTarget: { tab: "PROGRAM DETAILS" },
    read: (ctx) => ctx.formData.profileQuestionnaires?.programDetails?.destination,
  },
  intendedLengthOfStay: {
    label: "Intended length of stay",
    sectionKey: "programDetails",
    editTarget: { tab: "PROGRAM DETAILS" },
    read: (ctx) => ctx.formData.profileQuestionnaires?.programDetails?.intendedLengthOfStay,
  },
  fundsAvailable: {
    label: "Funds available",
    sectionKey: "programDetails",
    editTarget: { tab: "PROGRAM DETAILS" },
    read: (ctx) => ctx.formData.profileQuestionnaires?.programDetails?.fundsAvailable,
  },
  homeCountryTies: {
    label: "Ties to home country",
    sectionKey: "programDetails",
    editTarget: { tab: "PROGRAM DETAILS" },
    read: (ctx) => ctx.formData.profileQuestionnaires?.programDetails?.homeCountryTies,
  },
  returnPlan: {
    label: "Plan after authorized stay ends",
    sectionKey: "programDetails",
    editTarget: { tab: "PROGRAM DETAILS" },
    read: (ctx) => ctx.formData.profileQuestionnaires?.programDetails?.returnPlan,
  },
  canadianEmployer: {
    label: "Canadian employer or job offer details",
    sectionKey: "programDetails",
    editTarget: { tab: "PROGRAM DETAILS" },
    read: (ctx) => ctx.formData.profileQuestionnaires?.programDetails?.canadianEmployer,
  },
  educationalInstitution: {
    label: "School, program and DLI details",
    sectionKey: "programDetails",
    editTarget: { tab: "PROGRAM DETAILS" },
    read: (ctx) => ctx.formData.profileQuestionnaires?.programDetails?.educationalInstitution,
  },
  provincialNomination: {
    label: "Provincial nomination",
    sectionKey: "programDetails",
    editTarget: { tab: "PROGRAM DETAILS" },
    read: (ctx) => ctx.formData.profileQuestionnaires?.programDetails?.provincialNomination,
  },
  backgroundDeclarations: {
    label: "Background declarations",
    sectionKey: "backgroundAdmissibility",
    editTarget: { tab: "BACKGROUND & ADMISSIBILITY" },
    read: (ctx) => {
      const background = ctx.formData.profileQuestionnaires?.background || {};
      const answers = [background.medicalCondition, background.criminalHistory, background.immigrationViolation, background.visaRefusal];
      return answers.every(present) ? "Completed" : "";
    },
  },
  activityHistoryComplete: {
    label: "10-year personal history",
    sectionKey: "activityHistory",
    editTarget: { tab: "ACTIVITY HISTORY" },
    read: (ctx) => (ctx.formData.activityHistory?.entries || []).length > 0 ? "Provided" : "",
  },
  languageTestComplete: {
    label: "Language test results",
    sectionKey: "applicantDetails",
    editTarget: { tab: "APPLICANT DETAILS", assessmentOverlay: true },
    read: (ctx) => (ctx.formData.languageExams?.languageExamEntries || []).length > 0 ? "Provided" : "",
  },
  workHistoryComplete: {
    label: "Work history",
    sectionKey: "applicantDetails",
    editTarget: { tab: "APPLICANT DETAILS", assessmentOverlay: true },
    read: (ctx) => (ctx.formData.work?.workHistoryEntries || []).length > 0 || ctx.formData.work?.hasWorkExperience === "No" ? "Provided" : "",
  },
  educationComplete: {
    label: "Education history",
    sectionKey: "applicantDetails",
    editTarget: { tab: "APPLICANT DETAILS", assessmentOverlay: true },
    read: (ctx) => (ctx.formData.education?.educationHistoryEntries || []).length > 0 ? "Provided" : "",
  },
  spouseDetails: {
    label: "Spouse or common-law partner details",
    sectionKey: "spouseDetails",
    editTarget: { tab: "SPOUSE DETAILS" },
    includeIf: (ctx) => isMarriedOrCommonLaw(ctx.formData.profile?.maritalStatus),
    read: (ctx) => {
      const hasSpouse = ctx.formData.spouse && Object.values(ctx.formData.spouse).some(present);
      return { value: hasSpouse ? "Provided" : "", status: hasSpouse ? "ready" : "conditional", note: "Required because the applicant is married or in a common-law relationship." };
    },
  },
  travelHistory: {
    label: "Previous travel applicability",
    sectionKey: "travelHistory",
    editTarget: { tab: "TRAVEL HISTORY" },
    includeIf: (ctx) => !present(ctx.formData.travelHistory?.hasTravelled),
    read: () => ({ value: "", status: "conditional", note: "Confirm whether travel history applies." }),
  },
  sponsorStatus: {
    label: "Sponsor's status in Canada",
    sectionKey: "relationshipSponsorship",
    editTarget: { tab: "RELATIONSHIP & SPONSORSHIP" },
    read: (ctx) => ctx.formData.profileQuestionnaires?.sponsorship?.sponsorStatus,
  },
  relationshipType: {
    label: "Relationship to the person being sponsored",
    sectionKey: "relationshipSponsorship",
    editTarget: { tab: "RELATIONSHIP & SPONSORSHIP" },
    read: (ctx) => ctx.formData.profileQuestionnaires?.sponsorship?.relationshipType,
  },
  relationshipStartDate: {
    label: "Date the relationship began",
    sectionKey: "relationshipSponsorship",
    editTarget: { tab: "RELATIONSHIP & SPONSORSHIP" },
    read: (ctx) => ctx.formData.profileQuestionnaires?.sponsorship?.relationshipStartDate,
  },
  cohabitationStartDate: {
    label: "Date cohabitation began",
    sectionKey: "relationshipSponsorship",
    editTarget: { tab: "RELATIONSHIP & SPONSORSHIP" },
    read: (ctx) => ctx.formData.profileQuestionnaires?.sponsorship?.cohabitationStartDate,
  },
  marriageDate: {
    label: "Date of marriage",
    sectionKey: "relationshipSponsorship",
    editTarget: { tab: "RELATIONSHIP & SPONSORSHIP" },
    read: (ctx) => ctx.formData.profileQuestionnaires?.sponsorship?.marriageDate,
  },
  relationshipEvidence: {
    label: "Relationship evidence",
    sectionKey: "relationshipSponsorship",
    editTarget: { tab: "RELATIONSHIP & SPONSORSHIP" },
    read: (ctx) => ctx.formData.profileQuestionnaires?.sponsorship?.relationshipEvidence,
  },
  sponsorFinancialSupport: {
    label: "Sponsor will provide financial support",
    sectionKey: "relationshipSponsorship",
    editTarget: { tab: "RELATIONSHIP & SPONSORSHIP" },
    read: (ctx) => ctx.formData.profileQuestionnaires?.sponsorship?.sponsorFinancialSupport,
  },
  sponsorIncomeYear1: {
    label: "Sponsor income (most recent year)",
    sectionKey: "relationshipSponsorship",
    editTarget: { tab: "RELATIONSHIP & SPONSORSHIP" },
    read: (ctx) => ctx.formData.profileQuestionnaires?.sponsorship?.sponsorIncomeYear1,
  },
  sponsorIncomeYear2: {
    label: "Sponsor income (year 2)",
    sectionKey: "relationshipSponsorship",
    editTarget: { tab: "RELATIONSHIP & SPONSORSHIP" },
    read: (ctx) => ctx.formData.profileQuestionnaires?.sponsorship?.sponsorIncomeYear2,
  },
  sponsorIncomeYear3: {
    label: "Sponsor income (year 3)",
    sectionKey: "relationshipSponsorship",
    editTarget: { tab: "RELATIONSHIP & SPONSORSHIP" },
    read: (ctx) => ctx.formData.profileQuestionnaires?.sponsorship?.sponsorIncomeYear3,
  },
  sponsorDependentsCount: {
    label: "Number of dependents the sponsor supports",
    sectionKey: "relationshipSponsorship",
    editTarget: { tab: "RELATIONSHIP & SPONSORSHIP" },
    read: (ctx) => ctx.formData.profileQuestionnaires?.sponsorship?.sponsorDependentsCount,
  },
  sponsorPriorSponsorship: {
    label: "Sponsor has sponsored someone before",
    sectionKey: "relationshipSponsorship",
    editTarget: { tab: "RELATIONSHIP & SPONSORSHIP" },
    read: (ctx) => ctx.formData.profileQuestionnaires?.sponsorship?.sponsorPriorSponsorship,
  },
  sponsorPriorSponsorshipDetails: {
    label: "Prior sponsorship details",
    sectionKey: "relationshipSponsorship",
    editTarget: { tab: "RELATIONSHIP & SPONSORSHIP" },
    read: (ctx) => ctx.formData.profileQuestionnaires?.sponsorship?.sponsorPriorSponsorshipDetails,
  },
};
