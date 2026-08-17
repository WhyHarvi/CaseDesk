import { createCanvas, loadImage } from "@napi-rs/canvas";
import { createHttpError } from "../utils/http.js";

// Converts an uploaded signature PICTURE into the same normalized [0,1] ink
// strokes format a hand-drawn signature produces (see SignaturePad.jsx),
// so an uploaded photo can flow through the exact same, already-proven
// PDF-stamping pipeline (imm5476SignatureFields.js's signatureAnnotation())
// used everywhere else in CaseDesk — rather than a separate raster/bitmap
// embedding path.
//
// A separate raster path was tried and rejected: pdf.js's own bitmap
// annotation support requires a real OffscreenCanvas (not present in Node,
// and @napi-rs/canvas doesn't provide one) and passes the bitmap through a
// structuredClone-based message channel that plain image objects can't
// survive — both confirmed to hard-fail here, not just theoretical. Tracing
// the picture into vector ink strokes sidesteps both problems entirely and
// reuses infrastructure that's already verified end-to-end.
//
// The trade-off: this reproduces the signature's shape, not a pixel-perfect
// photo. It reads clearly on a printed/exported form, which is what the
// government form actually needs.
export async function traceSignatureImageToStrokes(buffer) {
  let image;
  try {
    image = await loadImage(buffer);
  } catch {
    throw createHttpError(400, "That file couldn't be read as an image.", "INVALID_SIGNATURE");
  }
  const { width, height } = image;
  if (!width || !height || width > 4000 || height > 4000) {
    throw createHttpError(400, "That image is an unsupported size.", "INVALID_SIGNATURE");
  }

  let data;
  try {
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext("2d");
    ctx.drawImage(image, 0, 0);
    ({ data } = ctx.getImageData(0, 0, width, height));
  } catch (error) {
    throw createHttpError(500, "The uploaded signature image could not be processed. Try a different photo, or draw your signature instead.", "SIGNATURE_IMAGE_PROCESSING_FAILED");
  }

  // Ink = a pixel that's both opaque enough and dark enough. Handles a
  // transparent-background PNG (alpha marks the ink) or a white/light
  // background PNG (luminance marks the ink) the same way.
  const isInk = (x, y) => {
    const i = (y * width + x) * 4;
    if (data[i + 3] < 32) return false;
    const luminance = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    return luminance < 165;
  };

  const targetRows = 300;
  const rowStride = Math.max(1, Math.round(height / targetRows));
  const rawStrokes = [];
  for (let y = 0; y < height; y += rowStride) {
    let runStart = -1;
    for (let x = 0; x < width; x++) {
      const ink = isInk(x, y);
      if (ink && runStart === -1) runStart = x;
      if ((!ink || x === width - 1) && runStart !== -1) {
        const runEnd = ink ? x : x - 1;
        const endX = Math.min(width - 1, Math.max(runEnd, runStart + 1));
        rawStrokes.push([[runStart / width, y / height], [endX / width, y / height]]);
        runStart = -1;
      }
    }
  }

  if (!rawStrokes.length) {
    throw createHttpError(400, "No visible signature was found in that image. Use a clearer photo on a plain white or transparent background.", "INVALID_SIGNATURE");
  }

  // A wider cap than hand-drawn strokes get (validatedSignatureStrokes caps
  // at 100) — this is server-generated from an already-validated image, not
  // arbitrary client JSON, so the tighter abuse-guard cap doesn't apply.
  const maxStrokes = 220;
  if (rawStrokes.length <= maxStrokes) return rawStrokes;
  const step = rawStrokes.length / maxStrokes;
  const strokes = [];
  for (let i = 0; i < maxStrokes; i++) strokes.push(rawStrokes[Math.floor(i * step)]);
  return strokes;
}
