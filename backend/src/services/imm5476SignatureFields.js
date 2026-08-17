import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";

// Real pdf.js-internal widget ids on IMM 5476 (11-2025) E, extracted from the
// form itself — see backend/src/services/imm5476SignatureService.js for how
// these were confirmed. Shared here so both the consultant-side "generate
// filled PDF" path and the client-portal secure-signing path draw the
// representative's signature into the exact same spot with the exact same
// shape, instead of two copies of this drifting apart.
//
// 113R = IMM_5476[0].Page1[0].SectionB[0].question8[0].dateSigned[0]
//   — Section B ends with the representative's declaration; this is its
//   date field, on page 3 (0-indexed pageIndex 2).
// 121R = IMM_5476[0].Page1[0].sectionE[0].dateApplicantSigned[0]
//   — Section E is the applicant's own declaration, on page 4 (pageIndex 3).
export const REPRESENTATIVE_SIGNATURE = { pageIndex: 2, rect: [25.2, 671.199, 397.199, 699.84], dateFieldId: "113R" };
export const APPLICANT_SIGNATURE = { pageIndex: 3, rect: [25.2, 655.199, 397.199, 685.44], dateFieldId: "121R" };

// Converts normalized [0,1] drawn-signature strokes into a pdf.js ink
// AnnotationEditor payload that document.annotationStorage.setValue() /
// saveDocument() will bake into the PDF as a real Ink annotation with a
// visible appearance stream. Shape is dictated by pdf.js's own InkAnnotation
// worker code (createNewDict / createNewAppearanceStream), not ours to
// invent — see paths.points (used for /InkList) and paths.lines (used for
// the drawn appearance).
export function signatureAnnotation(strokes, { pageIndex, rect }, user) {
  const [left, bottom, right, top] = rect;
  const paddingX = 8;
  const paddingY = 4;
  const height = Math.max(1, top - bottom - paddingY * 2);
  const width = Math.min(Math.max(1, right - left - paddingX * 2), height * 3);
  const containedLeft = left + (right - left - width) / 2;
  const points = strokes.map((stroke) => stroke.flatMap(([x, y]) => [containedLeft + x * width, top - paddingY - y * height]));
  const lines = points.map((stroke) => {
    const line = [];
    for (let index = 0; index < stroke.length; index += 2) {
      line.push(Number.NaN, Number.NaN, Number.NaN, Number.NaN, stroke[index], stroke[index + 1]);
    }
    return line;
  });
  return {
    annotationType: pdfjs.AnnotationEditorType.INK,
    pageIndex,
    rect,
    rotation: 0,
    color: [15, 23, 42],
    thickness: 1.2,
    opacity: 1,
    paths: { lines, points },
    date: new Date().toISOString(),
    user,
  };
}

// Reads a field's current value out of an already-loaded pdf.js document by
// its short pdf.js-internal id (e.g. "113R") rather than its full XFA SOM
// path. Used so the applicant's signing date can be set to match whatever
// date the representative's signature already carries (stamped when the
// filled PDF was generated), instead of always defaulting to "today".
export async function readFieldValue(document, fieldId) {
  const fields = await document.getFieldObjects();
  for (const entries of Object.values(fields || {})) {
    for (const entry of entries) {
      if (entry?.id === fieldId) return entry.value ?? null;
    }
  }
  return null;
}
