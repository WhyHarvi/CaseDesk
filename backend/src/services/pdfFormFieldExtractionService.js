import { PDFDocument } from "pdf-lib";

// Reads a PDF's real AcroForm fields (name, widget type, page). This is the
// only place pdf-lib's field-shape API is touched — everything downstream
// (formFieldMappingService, caseFormFillService, pdfFormRenderService) works
// against the plain objects this returns, not pdf-lib's classes directly.

const FIELD_TYPE_BY_CLASS = {
  PDFTextField: "Text",
  PDFCheckBox: "Checkbox",
  PDFRadioGroup: "Radio",
  PDFDropdown: "Dropdown",
  PDFOptionList: "Dropdown",
  PDFSignature: "Signature",
};

// Not every PDF has a real AcroForm (plenty of CaseDesk's CaseForm uploads
// are scanned/flat documents) — that's expected, not an error condition.
export async function extractPdfFormFields(buffer) {
  let pdfDoc;
  try {
    pdfDoc = await PDFDocument.load(buffer, { ignoreEncryption: true, updateMetadata: false });
  } catch {
    return [];
  }

  let form;
  try {
    form = pdfDoc.getForm();
  } catch {
    return [];
  }

  const fields = form.getFields();
  if (!fields.length) return [];

  const pages = pdfDoc.getPages();
  const pageIndexByRef = new Map(pages.map((page, index) => [page.ref.toString(), index + 1]));

  return fields.map((field, index) => {
    let page = null;
    try {
      const widgets = field.acroField.getWidgets();
      for (const widget of widgets) {
        const pageRef = typeof widget.P === "function" ? widget.P() : null;
        if (pageRef && pageIndexByRef.has(pageRef.toString())) {
          page = pageIndexByRef.get(pageRef.toString());
          break;
        }
      }
    } catch {
      page = null;
    }

    return {
      fieldKey: field.getName(),
      fieldType: FIELD_TYPE_BY_CLASS[field.constructor.name] || "Text",
      page,
      sortIndex: index,
    };
  });
}

export function isPdfMimeType(mimeType) {
  return String(mimeType || "").toLowerCase() === "application/pdf";
}
