import { PDFDocument } from "pdf-lib";

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
