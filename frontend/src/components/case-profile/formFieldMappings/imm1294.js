import { firstPassport, isoParts, maritalCode, splitApplicantName } from "../applicantFactCatalog";

// Ported verbatim from the original hard-coded buildCaseFormAutofill — same
// 19 facts, same order, same conditional facts, same PDF values. This file
// exists to prove the generic dispatcher in formAutofillMappings.js is
// behavior-preserving before any other form is added.
export default {
  formNumber: "IMM1294",
  mappingVersion: "IMM1294.ENU.10-2024.v1",
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
    "fundsAvailable",
    "educationalInstitution",
    "backgroundDeclarations",
    "spouseDetails",
    "travelHistory",
  ],
  buildPdfValues(ctx) {
    const formData = ctx.formData;
    const client = ctx.client;
    const applicantIdentity = formData.profileQuestionnaires?.applicantIdentity || {};
    const canadianStatus = formData.profileQuestionnaires?.canadianStatus || {};
    const passport = firstPassport(formData);
    const birth = isoParts(client.dateOfBirth);
    const inferredName = splitApplicantName(client.fullName);
    const familyName = applicantIdentity.familyName || inferredName.familyName;
    const givenNames = applicantIdentity.givenNames || inferredName.givenNames;
    return {
      ServiceIn31778: "English",
      UCIClientID31781: canadianStatus.uci || "",
      FamilyName31784: familyName,
      GivenName31785: givenNames,
      DOBYear31793: birth.year || "",
      DOBMonth31794: birth.month || "",
      DOBDay31795: birth.day || "",
      MaritalStatus31863: maritalCode(formData.profile?.maritalStatus),
      PassportNum31911: passport.documentNumber || "",
      CountryofIssue31913: passport.issuingCountry || "",
      IssueDate31915: String(passport.issueDate || "").slice(0, 10),
      ExpiryDate31916: String(passport.expiryDate || "").slice(0, 10),
      Email32025: client.email || "",
    };
  },
};
