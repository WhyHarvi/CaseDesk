import { PDFDocument } from "pdf-lib";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import { randomUUID } from "node:crypto";
import { APPLICANT_SIGNATURE, readFieldValue, REPRESENTATIVE_SIGNATURE, signatureAnnotation } from "./imm5476SignatureFields.js";

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
      const page = await document.getPage(REPRESENTATIVE_SIGNATURE.pageIndex + 1);
      const annotations = await page.getAnnotations({ intent: "display" });
      const [left, bottom, right, top] = REPRESENTATIVE_SIGNATURE.rect;
      const alreadySigned = annotations.some((annotation) => {
        if (String(annotation?.subtype || "").toLowerCase() !== "ink" || !Array.isArray(annotation.rect)) return false;
        const [annotationLeft, annotationBottom, annotationRight, annotationTop] = annotation.rect;
        return annotationLeft < right && annotationRight > left && annotationBottom < top && annotationTop > bottom;
      });
      const existingDate = String((await readFieldValue(document, REPRESENTATIVE_SIGNATURE.dateFieldId)) || "").trim();
      const signedDate = existingDate || new Date().toISOString().slice(0, 10);
      document.annotationStorage.setValue(REPRESENTATIVE_SIGNATURE.dateFieldId, { value: signedDate });
      document.annotationStorage.setValue(APPLICANT_SIGNATURE.dateFieldId, { value: signedDate });
      if (!alreadySigned) {
        document.annotationStorage.setValue(
          `pdfjs_internal_editor_casedesk-representative-${randomUUID()}`,
          signatureAnnotation(representativeSignature.strokes, REPRESENTATIVE_SIGNATURE, representativeSignature.name),
        );
      }
    }
    return Buffer.from(await document.saveDocument());
  } finally {
    await task.destroy().catch(() => {});
  }
}

export async function imm5476RepresentativeSignatureName(sourceBuffer) {
  const task = pdfjs.getDocument({ data: new Uint8Array(sourceBuffer), enableXfa: true });
  try {
    const document = await task.promise;
    const page = await document.getPage(REPRESENTATIVE_SIGNATURE.pageIndex + 1);
    const annotations = await page.getAnnotations({ intent: "display" });
    const [left, bottom, right, top] = REPRESENTATIVE_SIGNATURE.rect;
    const signature = annotations.find((annotation) => {
      if (String(annotation?.subtype || "").toLowerCase() !== "ink" || !Array.isArray(annotation.rect)) return false;
      const [annotationLeft, annotationBottom, annotationRight, annotationTop] = annotation.rect;
      return annotationLeft < right && annotationRight > left && annotationBottom < top && annotationTop > bottom;
    });
    return String(signature?.titleObj?.str || signature?.title || "").trim() || null;
  } finally {
    await task.destroy().catch(() => {});
  }
}

export async function rebuildImm5476FromOriginal(sourceBuffer, originalBuffer) {
  const [sourceTask, originalTask] = [sourceBuffer, originalBuffer].map((buffer) => pdfjs.getDocument({ data: new Uint8Array(buffer), enableXfa: true }));
  try {
    const [sourceDocument, originalDocument] = await Promise.all([sourceTask.promise, originalTask.promise]);
    const fields = await sourceDocument.getFieldObjects();
    for (const entries of Object.values(fields || {})) {
      for (const field of entries) {
        if (!field?.id || field.id === REPRESENTATIVE_SIGNATURE.dateFieldId || field.id === APPLICANT_SIGNATURE.dateFieldId) continue;
        const value = field.value;
        if (value === null || value === undefined || value === "") continue;
        originalDocument.annotationStorage.setValue(field.id, { value });
      }
    }
    return Buffer.from(await originalDocument.saveDocument());
  } finally {
    await Promise.all([sourceTask.destroy().catch(() => {}), originalTask.destroy().catch(() => {})]);
  }
}
