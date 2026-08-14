import { splitApplicantName } from "../applicantFactCatalog";

// IMM 5476 — Use of a Representative. Unlike IMM 1294 (all applicant
// biodata), most of this form is about the REPRESENTATIVE: their name,
// professional credentials, firm address, phone/fax/email. Section A
// (applicant identity) is the only part that comes from the client.
//
// Field keys below are pdf-lib/AcroForm-incompatible: this specific PDF has
// no usable classic AcroForm (pdf-lib's form.getFields() returns nothing
// and even choked parsing the file's object structure). It only works
// through pdf.js's XFA-aware annotationStorage, which is what
// XfaPdfPreviewOverlay already uses. Verified empirically against the real
// IMM 5476 (11-2025) E PDF: annotationStorage.setValue() only takes effect
// when keyed by each widget's pdf.js-internal `id` (e.g. "553R"), NOT by
// its dotted XFA field name (e.g. "IMM_5476[0].Page1[0].SectionA[0]
// .familyName[0]") — the latter silently no-ops for this file. These ids
// are positional/structural to this exact PDF; if IRCC republishes IMM 5476
// with different internal object ordering (even with no visible content
// change), these may need re-extracting via pdfjs-dist's
// getFieldObjects().
//
// This workflow is specifically used to appoint a representative, so the
// first "I am" choice is intentionally selected. Paid/unpaid membership
// choices and signatures remain separate legal steps.
export default {
  formNumber: "IMM5476",
  mappingVersion: "IMM5476.ENU.11-2025.v2",
  factKeys: ["familyName", "givenNames", "dateOfBirth", "email", "uci"],
  buildPdfValues(ctx) {
    const client = ctx.client || {};
    const applicantIdentity = ctx.formData.profileQuestionnaires?.applicantIdentity || {};
    const canadianStatus = ctx.formData.profileQuestionnaires?.canadianStatus || {};
    const applicantName = normalizeIrccName({
      familyName: applicantIdentity.familyName || client.familyName,
      givenNames: applicantIdentity.givenNames || client.givenNames,
      fullName: client.fullName,
    });

    const representative = ctx.representative || {};
    const representativeName = normalizeIrccName({ fullName: representative.fullName });

    const agency = ctx.agency || {};
    const street = splitStreetAddress(agency.address);
    const defaultCountryCode = !agency.country || /canada|united states/i.test(agency.country) ? "1" : "";
    const phone = splitPhone(representative.phone || agency.phone, defaultCountryCode);
    const fax = splitPhone(agency.faxNumber, defaultCountryCode);

    return {
      // "I am appointing a representative. Complete Sections A, B and E."
      // pdf.js expects a boolean for an individual radio widget id.
      "547R": true,

      // Section A — applicant (the client)
      "553R": applicantName.familyName,
      "554R": applicantName.givenNames,
      "555R": String(client.dateOfBirth || "").slice(0, 10),
      "556R": client.email || "",
      "557R": client.email ? "" : client.phone || "",
      "558R": ctx.case?.caseType || "",
      "559R": ctx.case?.applicationNumber || "",
      "560R": canadianStatus.uci || "",

      // Section B — representative's name
      "561R": representativeName.familyName,
      "562R": representativeName.givenNames,

      // Section B, question 7 — licensed representative category. Paid
      // RCICs use the first paid option; the remaining regulator variants
      // remain profile-driven rather than guessed.
      ...(String(representative.representativeType || "").toLowerCase() === "paid" && /CICC|Immigration Consultants/i.test(representative.membershipBody || "")
        ? { "97R": true, "94R": representative.licenseNumber || "" }
        : {}),

      // Section B, question 7 — representative's firm/mailing address & contact
      "90R": agency.name || "",
      "87R": agency.addressUnit || "",
      "86R": street.streetNo,
      "85R": street.streetName,
      "84R": agency.city || "",
      "83R": agency.province || "",
      "82R": agency.country || "",
      "81R": agency.postalCode || "",
      "80R": phone.countryCode,
      "79R": phone.number,
      "78R": fax.countryCode,
      "77R": fax.number,
      "76R": representative.email || agency.email || "",
    };
  },
  getWarnings(ctx) {
    const client = ctx.client || {};
    const applicantIdentity = ctx.formData.profileQuestionnaires?.applicantIdentity || {};
    const applicantName = normalizeIrccName({
      familyName: applicantIdentity.familyName || client.familyName,
      givenNames: applicantIdentity.givenNames || client.givenNames,
      fullName: client.fullName,
    });
    return applicantName.singleName
      ? ["This applicant has no family name. Their given name was moved to the family-name field and the given-name field was left blank, following IRCC's single-name rule. Verify it against the passport before saving."]
      : [];
  },
};

// IRCC's single-name rule: when the identity document has given name(s) but
// no family name, put every given name in the family-name box and leave the
// given-name box empty. Never invent a surname from the last word.
function normalizeIrccName({ familyName, givenNames, fullName }) {
  const explicitFamily = String(familyName || "").trim();
  const explicitGiven = String(givenNames || "").trim();
  if (explicitFamily) return { familyName: explicitFamily, givenNames: explicitGiven, singleName: false };
  if (explicitGiven) return { familyName: explicitGiven, givenNames: "", singleName: true };

  const inferred = splitApplicantName(fullName);
  if (!inferred.familyName && inferred.givenNames) {
    return { familyName: inferred.givenNames, givenNames: "", singleName: true };
  }
  return { familyName: inferred.familyName, givenNames: inferred.givenNames, singleName: false };
}

// "100 King Street West" -> { streetNo: "100", streetName: "King Street West" }.
// Agency.address is one freeform string; this form wants street number and
// street name in separate boxes. Best-effort split, not a full address
// parser — verify against the printed form before submission.
function splitStreetAddress(raw) {
  const trimmed = String(raw || "").trim();
  const match = trimmed.match(/^(\d+[A-Za-z]?)\s+(.*)$/);
  if (match) return { streetNo: match[1], streetName: match[2] };
  return { streetNo: "", streetName: trimmed };
}

// "+1 (416) 555-0199" -> { countryCode: "1", number: "(416) 555-0199" }.
// Only splits a leading "+<digits>"; a plain local number is assumed to
// already be in the default country (Canada/US share "1").
function splitPhone(raw, defaultCountryCode) {
  const trimmed = String(raw || "").trim();
  if (!trimmed) return { countryCode: "", number: "" };
  const match = trimmed.match(/^\+(\d{1,3})[\s.-]*(.*)$/);
  if (match) return { countryCode: match[1], number: match[2].trim() };
  return { countryCode: defaultCountryCode, number: trimmed };
}
