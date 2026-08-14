import { PDFDocument } from "pdf-lib";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";

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
export async function stampXfaPdfFormValues(sourceBuffer, fields, forcedValues = {}) {
  const task = pdfjs.getDocument({ data: new Uint8Array(sourceBuffer), enableXfa: true });
  try {
    const document = await task.promise;
    for (const { fieldKey, fieldType, value } of fields) {
      if (value === null || value === undefined || value === "") continue;
      const isBooleanField = fieldType === "Checkbox" || fieldType === "Radio";
      document.annotationStorage.setValue(fieldKey, { value: isBooleanField ? TRUE_VALUES.has(String(value).toLowerCase()) : String(value) });
    }
    for (const [fieldKey, value] of Object.entries(forcedValues)) document.annotationStorage.setValue(fieldKey, { value });
    return Buffer.from(await document.saveDocument());
  } finally {
    await task.destroy().catch(() => {});
  }
}
