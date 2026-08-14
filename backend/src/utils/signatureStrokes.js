import { createHttpError } from "./http.js";

// A signature is stored as normalized [x, y] points. Keeping the vector
// strokes alongside the PNG lets CaseDesk place the actual drawing into an
// IRCC PDF without trusting a client-uploaded replacement PDF.
export function validatedSignatureStrokes(value) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 100) {
    throw createHttpError(400, "Draw your signature inside the signature box.", "INVALID_SIGNATURE");
  }
  let pointCount = 0;
  const strokes = value.map((stroke) => {
    if (!Array.isArray(stroke) || stroke.length < 1 || stroke.length > 1000) {
      throw createHttpError(400, "The drawn signature is invalid.", "INVALID_SIGNATURE");
    }
    return stroke.map((point) => {
      pointCount += 1;
      if (!Array.isArray(point) || point.length !== 2) {
        throw createHttpError(400, "The drawn signature is invalid.", "INVALID_SIGNATURE");
      }
      const x = Number(point[0]);
      const y = Number(point[1]);
      if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || x > 1 || y < 0 || y > 1) {
        throw createHttpError(400, "The drawn signature is invalid.", "INVALID_SIGNATURE");
      }
      return [Math.round(x * 10000) / 10000, Math.round(y * 10000) / 10000];
    });
  });
  if (pointCount > 10_000) throw createHttpError(400, "The drawn signature is too complex.", "INVALID_SIGNATURE");
  return strokes;
}
