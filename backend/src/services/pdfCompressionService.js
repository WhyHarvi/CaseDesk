import { createCanvas, loadImage } from "@napi-rs/canvas";
import { PDFDocument } from "pdf-lib";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import { createHttpError } from "../utils/http.js";
import { logger } from "./logger.js";

export const PDF_UPLOAD_MAX_BYTES = 25 * 1024 * 1024;
export const PDF_COMPRESSION_TARGET_BYTES = Math.floor(3.25 * 1024 * 1024);
export const PDF_SAVED_MAX_BYTES = Math.floor(3.5 * 1024 * 1024);

const RASTER_PROFILES = [
  { dpi: 180, quality: 88 },
  { dpi: 160, quality: 84 },
  { dpi: 144, quality: 80 },
  { dpi: 120, quality: 76 },
];
const IMAGE_PROFILES = [
  { maxDimension: 3200, quality: 90 },
  { maxDimension: 2600, quality: 86 },
  { maxDimension: 2200, quality: 82 },
  { maxDimension: 1800, quality: 78 },
];
const IMAGE_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAX_RENDER_PIXELS = 16_000_000;
const MAX_PDF_PAGES = 250;

const isPdf = (file) => file?.mimetype === "application/pdf" || /\.pdf$/i.test(file?.originalname || "");
const megabytes = (bytes) => `${(bytes / (1024 * 1024)).toFixed(1)} MB`;

function resultFile(file, buffer, overrides = {}) {
  const originalSize = file.originalSize || file.buffer?.length || file.size || 0;
  const optimized = buffer.length < originalSize;
  return {
    ...file,
    ...overrides,
    buffer,
    size: buffer.length,
    originalSize,
    optimized,
    compressed: optimized,
    savedBytes: Math.max(0, originalSize - buffer.length),
  };
}

function cannotStore(file, smallestSize, detail = "") {
  const originalSize = file.originalSize || file.buffer?.length || file.size || 0;
  const message = detail ||
    `CaseDesk optimized this file from ${megabytes(originalSize)} to ${megabytes(smallestSize)}, but the safe result is still above the 3.5 MB storage limit. Try a lower-resolution scan or split it into two files.`;
  return createHttpError(413, message, "FILE_OPTIMIZATION_LIMIT");
}

async function inspectPdf(source) {
  const pdf = await PDFDocument.load(source, { updateMetadata: false });
  const form = pdf.getForm();
  return {
    hasInteractiveForm: form.getFields().length > 0 || form.hasXFA(),
    lossless: Buffer.from(await pdf.save({
      useObjectStreams: true,
      addDefaultPage: false,
      updateFieldAppearances: false,
    })),
  };
}

async function rasterizePdf(source, { dpi, quality }) {
  const task = pdfjs.getDocument({ data: new Uint8Array(source), useSystemFonts: true, isEvalSupported: false });
  try {
    const input = await task.promise;
    if (input.numPages > MAX_PDF_PAGES) throw new Error(`PDF has more than ${MAX_PDF_PAGES} pages`);
    const output = await PDFDocument.create();
    for (let pageNumber = 1; pageNumber <= input.numPages; pageNumber += 1) {
      const page = await input.getPage(pageNumber);
      const displayViewport = page.getViewport({ scale: 1 });
      let renderScale = dpi / 72;
      const requestedViewport = page.getViewport({ scale: renderScale });
      const requestedPixels = requestedViewport.width * requestedViewport.height;
      if (requestedPixels > MAX_RENDER_PIXELS) renderScale *= Math.sqrt(MAX_RENDER_PIXELS / requestedPixels);
      const renderViewport = page.getViewport({ scale: renderScale });
      const canvas = createCanvas(Math.max(1, Math.ceil(renderViewport.width)), Math.max(1, Math.ceil(renderViewport.height)));
      const context = canvas.getContext("2d");
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: context, viewport: renderViewport }).promise;
      const jpeg = canvas.toBuffer("image/jpeg", quality);
      const image = await output.embedJpg(jpeg);
      const outputPage = output.addPage([displayViewport.width, displayViewport.height]);
      outputPage.drawImage(image, { x: 0, y: 0, width: displayViewport.width, height: displayViewport.height });
      page.cleanup();
    }
    return Buffer.from(await output.save({ useObjectStreams: true, addDefaultPage: false }));
  } finally {
    await task.destroy().catch(() => {});
  }
}

async function optimizePdf(file) {
  let smallest = file.buffer;
  let hasInteractiveForm = false;
  try {
    const inspected = await inspectPdf(file.buffer);
    hasInteractiveForm = inspected.hasInteractiveForm;
    if (!hasInteractiveForm && inspected.lossless.length < smallest.length) smallest = inspected.lossless;
    if (!hasInteractiveForm && smallest.length > PDF_COMPRESSION_TARGET_BYTES) {
      for (const profile of RASTER_PROFILES) {
        const compressed = await rasterizePdf(file.buffer, profile);
        if (compressed.length < smallest.length) smallest = compressed;
        if (smallest.length <= PDF_COMPRESSION_TARGET_BYTES) break;
      }
    }
  } catch (error) {
    logger.warn("document.pdf_optimization_failed", { filename: file.originalname, originalSize: file.buffer.length, error: error?.message || String(error) });
    throw createHttpError(400, "This PDF could not be read safely. Export it as a new PDF and upload it again.", "FILE_OPTIMIZATION_FAILED");
  }

  if (smallest.length > PDF_SAVED_MAX_BYTES) {
    if (hasInteractiveForm) {
      throw cannotStore(file, smallest.length, `This fillable PDF is ${megabytes(smallest.length)}. CaseDesk did not flatten or lower its quality because that would damage its form fields. The final file must be 3.5 MB or smaller.`);
    }
    throw cannotStore(file, smallest.length);
  }
  return resultFile(file, smallest);
}

async function optimizeImage(file) {
  let image;
  try {
    image = await loadImage(file.buffer);
  } catch {
    throw createHttpError(400, "This image could not be read safely. Export it as JPEG or PNG and upload it again.", "FILE_OPTIMIZATION_FAILED");
  }

  let smallest = file.buffer;
  for (const profile of IMAGE_PROFILES) {
    const scale = Math.min(1, profile.maxDimension / Math.max(image.width, image.height));
    const width = Math.max(1, Math.round(image.width * scale));
    const height = Math.max(1, Math.round(image.height * scale));
    const canvas = createCanvas(width, height);
    const context = canvas.getContext("2d");
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, width, height);
    context.drawImage(image, 0, 0, width, height);
    const compressed = canvas.toBuffer("image/jpeg", profile.quality);
    if (compressed.length < smallest.length) smallest = compressed;
    if (smallest.length <= PDF_COMPRESSION_TARGET_BYTES) break;
  }

  if (smallest.length > PDF_SAVED_MAX_BYTES) throw cannotStore(file, smallest.length);
  const converted = smallest !== file.buffer && file.mimetype !== "image/jpeg";
  return resultFile(file, smallest, converted ? {
    mimetype: "image/jpeg",
    originalname: String(file.originalname || "document").replace(/\.[^.]+$/, "") + ".jpg",
  } : {});
}

export async function optimizeUploadedCaseFile(file) {
  if (!file) return file;
  const originalSize = file.buffer?.length || file.size || 0;
  if (originalSize > PDF_UPLOAD_MAX_BYTES) {
    throw createHttpError(413, `The selected file is ${megabytes(originalSize)}. CaseDesk can optimize source files up to 25 MB.`, "FILE_INPUT_TOO_LARGE");
  }
  if (originalSize <= PDF_COMPRESSION_TARGET_BYTES) return file;
  if (isPdf(file)) return optimizePdf(file);
  if (IMAGE_MIME_TYPES.has(file.mimetype)) return optimizeImage(file);
  if (originalSize <= PDF_SAVED_MAX_BYTES) return file;
  throw cannotStore(file, originalSize, `This ${megabytes(originalSize)} ${/word/i.test(file.mimetype) ? "Word" : "document"} file is already internally compressed and cannot be safely reduced by CaseDesk. Upload a file no larger than 3.5 MB.`);
}

// Kept for callers and tests using the original service name.
export const compressUploadedCasePdf = optimizeUploadedCaseFile;
