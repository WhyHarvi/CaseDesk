import { PDFDocument } from "pdf-lib";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import { randomUUID } from "node:crypto";
import { REPRESENTATIVE_SIGNATURE, signatureAnnotation } from "./imm5476SignatureFields.js";

const TRUE_VALUES = new Set(["true", "1", "yes", "on", "checked", "x"]);

// Stamps CaseFormFieldValue rows into the source PDF's real AcroForm
// widgets — the output opens in Acrobat as a normal filled IRCC form, not
// an image overlay. Skips (rather than fails the whole document on) any
// field whose stored value doesn't fit the widget it was mapped to; the
// checklist still shows that value even if the stamped PDF can't render it
// exactly, so nothing is silently lost.
export async function stampPdfFormValues(sourceBuffer, fields) {
  const pdfDoc = await PDFDocument.load(sourceBuffer, { ignoreEncryption: true, updateMetadata: false });
  const form = pdfDoc.getForm();

  for (const { fieldKey, fieldType, value } of fields) {
    if (value === null || value === undefined || value === "") continue;
    try {
      if (fieldType === "Checkbox") {
        const field = form.getCheckBox(fieldKey);
        if (TRUE_VALUES.has(String(value).toLowerCase())) field.check();
        else field.uncheck();
      } else if (fieldType === "Radio") {
        form.getRadioGroup(fieldKey).select(String(value));
      } else if (fieldType === "Dropdown") {
        form.getDropdown(fieldKey).select(String(value));
      } else {
        // Text, Date, and Signature (a typed/attested signature — image
        // signatures are composited separately, see stampSignatureImage)
        form.getTextField(fieldKey).setText(String(value));
      }
    } catch {
      /* field couldn't accept this value shape — skip, don't fail the document */
    }
  }

  try {
    form.updateFieldAppearances();
  } catch {
    /* some malformed AcroForms fail appearance regeneration; the raw values are still set */
  }

  return Buffer.from(await pdfDoc.save());
}

// IRCC's current IMM 5476 is a hybrid XFA PDF with malformed classic page
// references that pdf-lib cannot safely parse. PDF.js is already CaseDesk's
// browser renderer for this form and can persist the XFA widget values
// without flattening or rebuilding the official document.
//
// representativeSignature (optional): { strokes, name }. When the form's
// representative has a saved government-form signature, the checklist
// "Generate filled PDF" step stamps it (and today's date) into Section B's
// declaration block right away — the representative signs by preparing and
// sending the form, they don't need to wait for the applicant's own
// signature in Section E. This uses the exact same ink-annotation shape as
// the client-portal secure-signing flow (imm5476SignatureService.js), so a
// form generated here and later completed there doesn't end up with two
// different-looking marks.
export async function stampXfaPdfFormValues(sourceBuffer, fields, forcedValues = {}, representativeSignature = null) {
  const task = pdfjs.getDocument({ data: new Uint8Array(sourceBuffer), enableXfa: true });
  try {
    const document = await task.promise;
    for (const { fieldKey, fieldType, value } of fields) {
      if (value === null || value === undefined || value === "") continue;
      const isBooleanField = fieldType === "Checkbox" || fieldType === "Radio";
      document.annotationStorage.setValue(fieldKey, { value: isBooleanField ? TRUE_VALUES.has(String(value).toLowerCase()) : String(value) });
    }
    for (const [fieldKey, value] of Object.entries(forcedValues)) document.annotationStorage.setValue(fieldKey, { value });
    if (representativeSignature?.strokes?.length) {
      const signedDate = new Date().toISOString().slice(0, 10);
      document.annotationStorage.setValue(REPRESENTATIVE_SIGNATURE.dateFieldId, { value: signedDate });
      document.annotationStorage.setValue(
        `pdfjs_internal_editor_casedesk-representative-${randomUUID()}`,
        signatureAnnotation(representativeSignature.strokes, REPRESENTATIVE_SIGNATURE, representativeSignature.name),
      );
    }
    return Buffer.from(await document.saveDocument());
  } finally {
    await task.destroy().catch(() => {});
  }
}
