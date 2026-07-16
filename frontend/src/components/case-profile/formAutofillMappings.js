function normalizeFormNumber(value) {
  return String(value || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function splitApplicantName(fullName) {
  const parts = String(fullName || "").trim().split(/\s+/).filter(Boolean);
  if (parts.length < 2) return { familyName: "", givenNames: parts[0] || "", inferred: Boolean(parts.length) };
  return { familyName: parts.at(-1), givenNames: parts.slice(0, -1).join(" "), inferred: true };
}

function isoParts(value) {
  if (!value) return {};
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return {};
  return {
    year: String(date.getUTCFullYear()),
    month: String(date.getUTCMonth() + 1).padStart(2, "0"),
    day: String(date.getUTCDate()).padStart(2, "0"),
  };
}

function maritalCode(value) {
  const codes = { married: "01", single: "02", "common-law": "03", "common law": "03", divorced: "04", separated: "05", widowed: "06", "annulled marriage": "09" };
  return codes[String(value || "").trim().toLowerCase()] || "";
}

function firstPassport(formData) {
  return (formData?.identityPermits?.documents || []).find((item) => String(item.documentType || "").toLowerCase() === "passport") || {};
}

function present(value) {
  if (Array.isArray(value)) return value.length > 0;
  return value !== null && value !== undefined && String(value).trim() !== "";
}

function field(key, label, value, profileTab, options = {}) {
  const status = options.status || (present(value) ? "ready" : "missing");
  return {
    key,
    label,
    value: present(value) ? String(value) : "",
    profileTab,
    profileView: options.profileView || null,
    status,
    note: options.note || "",
  };
}

function summarize(fields) {
  return fields.reduce((summary, item) => ({ ...summary, [item.status]: (summary[item.status] || 0) + 1 }), { ready: 0, missing: 0, review: 0, conditional: 0 });
}

export function buildCaseFormAutofill(item, caseItem, assessment) {
  if (normalizeFormNumber(item?.formNumber) !== "IMM1294") return { mappingVersion: null, values: {}, warnings: [], fields: [], analysis: null };
  const formData = assessment?.formData || {};
  const client = caseItem?.client || {};
  const profile = formData.profile || {};
  const questionnaires = formData.profileQuestionnaires || {};
  const applicantIdentity = questionnaires.applicantIdentity || {};
  const canadianStatus = questionnaires.canadianStatus || {};
  const programDetails = questionnaires.programDetails || {};
  const background = questionnaires.background || {};
  const passport = firstPassport(formData);
  const birth = isoParts(client.dateOfBirth);
  const passportIssue = String(passport.issueDate || "").slice(0, 10);
  const passportExpiry = String(passport.expiryDate || "").slice(0, 10);
  const inferredName = splitApplicantName(client.fullName);
  const familyName = applicantIdentity.familyName || inferredName.familyName;
  const givenNames = applicantIdentity.givenNames || inferredName.givenNames;
  const nameWasInferred = (!applicantIdentity.familyName && Boolean(inferredName.familyName)) || (!applicantIdentity.givenNames && Boolean(inferredName.givenNames));
  const addressEntries = formData.addressHistory?.entries || [];
  const currentAddress = addressEntries[0] || {};
  const backgroundAnswers = [background.medicalCondition, background.criminalHistory, background.immigrationViolation, background.visaRefusal];
  const readinessFields = [
    field("familyName", "Family name", familyName, "APPLICANT DETAILS", { status: nameWasInferred && familyName ? "review" : undefined, note: nameWasInferred ? "Inferred from the client full name; verify against the passport." : "" }),
    field("givenNames", "Given name(s)", givenNames, "APPLICANT DETAILS", { status: nameWasInferred && givenNames ? "review" : undefined, note: nameWasInferred ? "Inferred from the client full name; verify against the passport." : "" }),
    field("dateOfBirth", "Date of birth", client.dateOfBirth, "APPLICANT DETAILS"),
    field("gender", "Gender", applicantIdentity.gender, "APPLICANT DETAILS"),
    field("cityOfBirth", "City or town of birth", applicantIdentity.cityOfBirth, "APPLICANT DETAILS"),
    field("countryOfBirth", "Country of birth", applicantIdentity.countryOfBirth, "APPLICANT DETAILS"),
    field("citizenships", "Citizenship(s)", applicantIdentity.citizenships, "APPLICANT DETAILS"),
    field("maritalStatus", "Marital status", profile.maritalStatus, "APPLICANT DETAILS"),
    field("passportNumber", "Passport number", passport.documentNumber, "IDENTITY & PERMITS"),
    field("passportCountry", "Passport issuing country", passport.issuingCountry, "IDENTITY & PERMITS"),
    field("passportIssue", "Passport issue date", passportIssue, "IDENTITY & PERMITS"),
    field("passportExpiry", "Passport expiry date", passportExpiry, "IDENTITY & PERMITS"),
    field("email", "Email address", client.email, "APPLICANT DETAILS"),
    field("currentStatus", "Current country status", canadianStatus.currentStatus, "CANADIAN STATUS"),
    field("currentAddress", "Current residential address", currentAddress.country ? [currentAddress.unit, currentAddress.streetNumber, currentAddress.streetName, currentAddress.city, currentAddress.province, currentAddress.postalCode, currentAddress.country].filter(Boolean).join(", ") : "", "ADDRESS HISTORY"),
    field("purposeOfTravel", "Purpose of travel", programDetails.purposeOfTravel, "PROGRAM DETAILS"),
    field("fundsAvailable", "Funds available", programDetails.fundsAvailable, "PROGRAM DETAILS"),
    field("educationalInstitution", "School, program and DLI details", programDetails.educationalInstitution, "PROGRAM DETAILS"),
    field("backgroundDeclarations", "Background declarations", backgroundAnswers.every(present) ? "Completed" : "", "BACKGROUND & ADMISSIBILITY"),
  ];
  if (["married", "common-law", "common law"].includes(String(profile.maritalStatus || "").toLowerCase())) {
    readinessFields.push(field("spouseDetails", "Spouse or common-law partner details", formData.spouse && Object.values(formData.spouse).some(present) ? "Provided" : "", "SPOUSE DETAILS", { status: formData.spouse && Object.values(formData.spouse).some(present) ? "ready" : "conditional", note: "Required because the applicant is married or in a common-law relationship." }));
  }
  if (!present(formData.travelHistory?.hasTravelled)) {
    readinessFields.push(field("travelHistory", "Previous travel applicability", "", "TRAVEL HISTORY", { status: "conditional", note: "Confirm whether travel history applies." }));
  }
  const values = {
    ServiceIn31778: "English",
    UCIClientID31781: canadianStatus.uci || "",
    FamilyName31784: familyName,
    GivenName31785: givenNames,
    DOBYear31793: birth.year || "",
    DOBMonth31794: birth.month || "",
    DOBDay31795: birth.day || "",
    MaritalStatus31863: maritalCode(profile.maritalStatus),
    PassportNum31911: passport.documentNumber || "",
    CountryofIssue31913: passport.issuingCountry || "",
    IssueDate31915: passportIssue,
    ExpiryDate31916: passportExpiry,
    Email32025: client.email || "",
  };
  return {
    mappingVersion: "IMM1294.ENU.10-2024.v1",
    values: Object.fromEntries(Object.entries(values).filter(([, value]) => value !== "")),
    warnings: nameWasInferred ? ["Family and given names were inferred from the client's full name. Verify them against the passport."] : [],
    fields: readinessFields,
    analysis: summarize(readinessFields),
  };
}
