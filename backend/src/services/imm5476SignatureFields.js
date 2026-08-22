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

// How much of the signature line a drawn signature fills by default —
// agencies can override this (see resolveSignatureFillFraction below) since
// no single fraction reads right for every signature; this is just the
// starting point before anyone has set a preference.
export const DEFAULT_SIGNATURE_FILL_FRACTION = 0.8;
export const MIN_SIGNATURE_FILL_FRACTION = 0.3;
export const MAX_SIGNATURE_FILL_FRACTION = 1.0;

// Agencies set their own government-form signature size (Settings ->
// Government forms) rather than CaseDesk guessing one fraction that has to
// read right for every agency's actual signatures — clamped defensively in
// case a bad value ever reaches the database some other way.
export function resolveSignatureFillFraction(rawValue) {
  const value = Number(rawValue);
  if (!Number.isFinite(value)) return DEFAULT_SIGNATURE_FILL_FRACTION;
  return Math.min(MAX_SIGNATURE_FILL_FRACTION, Math.max(MIN_SIGNATURE_FILL_FRACTION, value));
}

// Converts normalized [0,1] drawn-signature strokes into a pdf.js ink
// AnnotationEditor payload that document.annotationStorage.setValue() /
// saveDocument() will bake into the PDF as a real Ink annotation with a
// visible appearance stream. Shape is dictated by pdf.js's own InkAnnotation
// worker code (createNewDict / createNewAppearanceStream), not ours to
// invent — see paths.points (used for /InkList) and paths.lines (used for
// the drawn appearance).
export function signatureAnnotation(strokes, { pageIndex, rect }, user, fillFraction = DEFAULT_SIGNATURE_FILL_FRACTION) {
  const [left, bottom, right, top] = rect;
  const paddingX = 8;
  const paddingY = 4;
  const boxWidth = Math.max(1, right - left - paddingX * 2);
  const boxHeight = Math.max(1, top - bottom - paddingY * 2);

  // Crop to what was actually drawn, then stretch that to fill most (not
  // all, by default) of the available line, on both axes independently.
  // The signature pad captures at a roughly 3:1 proportion, but this line
  // is much flatter than that (~17:1) — preserving the pad's proportions
  // left the signature constrained by the line's short height, squeezed
  // down well below the line's actual width; filling both axes edge to
  // edge instead made every signature blow up to the same box-filling size
  // regardless of what was drawn. fillFraction is agency-configurable
  // (Settings -> Government forms) for exactly this reason — what reads as
  // "right-sized" varies by the actual signature.
  const targetWidth = boxWidth * fillFraction;
  const targetHeight = boxHeight * fillFraction;
  const containedLeft = left + paddingX + (boxWidth - targetWidth) / 2;
  const containedTop = top - paddingY - (boxHeight - targetHeight) / 2;

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const stroke of strokes) {
    for (const [x, y] of stroke) {
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  const drawnWidth = Math.max(maxX - minX, 0.02);
  const drawnHeight = Math.max(maxY - minY, 0.02);
  const scaleX = targetWidth / drawnWidth;
  const scaleY = targetHeight / drawnHeight;
  const points = strokes.map((stroke) => stroke.flatMap(([x, y]) => [containedLeft + (x - minX) * scaleX, containedTop - (y - minY) * scaleY]));
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

// Whether an ink annotation (a drawn/stamped signature) already overlaps
// the given rect on the given page. Every place that stamps a signature
// onto this form must check this first and skip stamping if it's already
// true — a representative's signature is baked into the "Filled" copy the
// moment it's generated/sent, so by the time the applicant signs on top of
// that same source, the representative's mark is already there; stamping
// it again unconditionally draws two overlapping signatures in the same
// box. This one shared check is what stampXfaPdfFormValues and
// createSignedImm5476Copy both use, specifically so this can't drift
// between the two the way it once did.
export async function hasInkAnnotationInRect(document, { pageIndex, rect }) {
  const page = await document.getPage(pageIndex + 1);
  const annotations = await page.getAnnotations({ intent: "display" });
  const [left, bottom, right, top] = rect;
  return annotations.some((annotation) => {
    if (String(annotation?.subtype || "").toLowerCase() !== "ink" || !Array.isArray(annotation.rect)) return false;
    const [annotationLeft, annotationBottom, annotationRight, annotationTop] = annotation.rect;
    return annotationLeft < right && annotationRight > left && annotationBottom < top && annotationTop > bottom;
  });
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

// Maps every widget id that's part of a multi-member radio group to the
// full list of ids (including itself) sharing that group's XFA field name —
// e.g. IMM 5476's "I am:" question is 5 separate widget ids (547R/549R/
// 550R/551R/552R) all named "RadioButtonList[0]". A standalone id (not part
// of any such group) is simply absent from the returned map.
//
// getFieldObjects() groups by name, but a shared-name group's entries
// aren't purely its button widgets — there's also one group-level entry for
// the field itself (type: "", no real widget) alongside the actual
// type:"radiobutton" members. Filter to just the real members before
// counting; requiring the WHOLE entries array to be uniformly
// "radiobutton" (as this used to) silently treats every such group as
// "not a group" and skips it entirely.
export async function buildRadioGroupSiblingMap(document) {
  const map = new Map();
  const fieldObjects = await document.getFieldObjects();
  for (const entries of Object.values(fieldObjects || {})) {
    const ids = entries.filter((entry) => entry.type === "radiobutton" && entry.id).map((entry) => entry.id);
    if (ids.length < 2) continue;
    for (const id of ids) map.set(id, ids);
  }
  return map;
}

// Applies a batch of [fieldKey, value] entries to a pdf.js document's
// annotationStorage, treating members of a shared-name radio group as
// mutually exclusive.
//
// This is NOT optional polish: pdf.js's saveDocument() bakes a "checked"
// appearance onto ANY widget that ever receives a truthy annotationStorage
// entry — even if a later call on a sibling is meant to supersede it, and
// even if that widget is then explicitly told {value:false} afterward.
// Verified empirically (rendered through both pdf.js and macOS's
// independent PDFKit engine): a clean single-touch pass — the true winner
// set once, every sibling set to false exactly once, never revisited — is
// the ONLY pattern that renders correctly. Naively applying every input
// entry as it's encountered, so that more than one sibling in the same
// group each receives its own {value:true} call at some point (exactly
// what happens if stale/duplicate CaseFormFieldValue rows exist for more
// than one option in the same group), corrupts the group irrecoverably —
// once baked in, no later re-stamp can clean it back up, only a full
// rebuild from the blank original can.
//
// So: resolve exactly one winner per group across the WHOLE batch first
// (last truthy entry for that group wins, matching normal object-key
// override order), and only then touch annotationStorage — once per
// winner, once per loser.
export async function applyFieldValues(document, entries) {
  const radioGroupSiblings = await buildRadioGroupSiblingMap(document);
  const radioWinner = new Map(); // siblings array (shared by reference across a group) -> winning fieldKey
  const plainEntries = [];
  for (const [fieldKey, value] of entries) {
    const siblings = radioGroupSiblings.get(fieldKey);
    if (siblings) {
      if (value) radioWinner.set(siblings, fieldKey);
      continue;
    }
    plainEntries.push([fieldKey, value]);
  }
  for (const [fieldKey, value] of plainEntries) document.annotationStorage.setValue(fieldKey, { value });
  for (const [siblings, winnerFieldKey] of radioWinner) {
    document.annotationStorage.setValue(winnerFieldKey, { value: true });
    for (const siblingId of siblings) {
      if (siblingId !== winnerFieldKey) document.annotationStorage.setValue(siblingId, { value: false });
    }
  }
  return radioGroupSiblings;
}
