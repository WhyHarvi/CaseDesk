import { isoParts, splitApplicantName } from "../applicantFactCatalog";

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
// Deliberately NOT auto-filled: the "I am:" purpose checkboxes, the
// paid/unpaid representative-type radio buttons + membership ID fields
// (question 6/7's radio groups), and every signature/date-signed field.
// Those are legal elections and signatures — a human should make them
// explicitly, not have them silently pre-selected.
export default {
  formNumber: "IMM5476",
  mappingVersion: "IMM5476.ENU.11-2025.v1",
  factKeys: ["familyName", "givenNames", "dateOfBirth", "email", "uci"],
  buildPdfValues(ctx) {
    const client = ctx.client || {};
    const applicantIdentity = ctx.formData.profileQuestionnaires?.applicantIdentity || {};
    const canadianStatus = ctx.formData.profileQuestionnaires?.canadianStatus || {};
    const inferredApplicant = splitApplicantName(client.fullName);
    const applicantFamilyName = applicantIdentity.familyName || inferredApplicant.familyName;
    const applicantGivenNames = applicantIdentity.givenNames || inferredApplicant.givenNames;

    const representative = ctx.representative || {};
    const inferredRep = splitApplicantName(representative.fullName);

    const agency = ctx.agency || {};
    const street = splitStreetAddress(agency.address);
    const defaultCountryCode = !agency.country || /canada|united states/i.test(agency.country) ? "1" : "";
    const phone = splitPhone(representative.phone || agency.phone, defaultCountryCode);
    const fax = splitPhone(agency.faxNumber, defaultCountryCode);

    return {
      // Section A — applicant (the client)
      "553R": applicantFamilyName,
      "554R": applicantGivenNames,
      "555R": String(client.dateOfBirth || "").slice(0, 10),
      "556R": client.email || "",
      "557R": client.email ? "" : client.phone || "",
      "558R": ctx.case?.caseType || "",
      "559R": ctx.case?.applicationNumber || "",
      "560R": canadianStatus.uci || "",

      // Section B — representative's name
      "561R": inferredRep.familyName,
      "562R": inferredRep.givenNames,

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
};

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
