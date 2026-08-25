import { createCanvas } from "@napi-rs/canvas";
import { PDFDocument } from "pdf-lib";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import { createHttpError } from "../utils/http.js";
import { logger } from "./logger.js";

export const PDF_UPLOAD_MAX_BYTES = 5 * 1024 * 1024;
export const PDF_COMPRESSION_TARGET_BYTES = 3 * 1024 * 1024;
export const PDF_SAVED_MAX_BYTES = 4 * 1024 * 1024;

const RASTER_PROFILES = [
  { dpi: 144, quality: 80 },
  { dpi: 120, quality: 70 },
];
const MAX_RENDER_PIXELS = 16_000_000;
const MAX_PDF_PAGES = 250;

const isPdf = (file) => file?.mimetype === "application/pdf" || /\.pdf$/i.test(file?.originalname || "");

async function rasterizePdf(source, { dpi, quality }) {
  const task = pdfjs.getDocument({
    data: new Uint8Array(source),
    useSystemFonts: true,
    isEvalSupported: false,
  });
  try {
    const input = await task.promise;
    if (input.numPages > MAX_PDF_PAGES) {
      throw new Error(`PDF has more than ${MAX_PDF_PAGES} pages`);
    }
    const output = await PDFDocument.create();
    for (let pageNumber = 1; pageNumber <= input.numPages; pageNumber += 1) {
      const page = await input.getPage(pageNumber);
      const displayViewport = page.getViewport({ scale: 1 });
      let renderScale = dpi / 72;
      const requestedViewport = page.getViewport({ scale: renderScale });
      const requestedPixels = requestedViewport.width * requestedViewport.height;
      if (requestedPixels > MAX_RENDER_PIXELS) {
        renderScale *= Math.sqrt(MAX_RENDER_PIXELS / requestedPixels);
      }
      const renderViewport = page.getViewport({ scale: renderScale });
      const canvas = createCanvas(
        Math.max(1, Math.ceil(renderViewport.width)),
        Math.max(1, Math.ceil(renderViewport.height)),
      );
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

export async function compressUploadedCasePdf(file) {
  if (!file || !isPdf(file)) return file;
  const originalSize = file.buffer?.length || file.size || 0;
  if (originalSize > PDF_UPLOAD_MAX_BYTES) {
    throw createHttpError(413, "PDF files must be 5 MB or smaller.", "PDF_TOO_LARGE");
  }
  if (originalSize <= PDF_COMPRESSION_TARGET_BYTES) return file;

  let smallest = file.buffer;
  try {
    for (const profile of RASTER_PROFILES) {
      const compressed = await rasterizePdf(file.buffer, profile);
      if (compressed.length < smallest.length) smallest = compressed;
      if (smallest.length <= PDF_COMPRESSION_TARGET_BYTES) break;
    }
  } catch (error) {
    logger.warn("document.pdf_compression_failed", {
      filename: file.originalname,
      originalSize,
      error: error?.message || String(error),
    });
    throw createHttpError(400, "This PDF could not be read safely. Export it as a new PDF and try again.", "PDF_COMPRESSION_FAILED");
  }

  if (smallest.length > PDF_SAVED_MAX_BYTES) {
    throw createHttpError(413, "This PDF could not be compressed below 4 MB while keeping it readable. Reduce the scan resolution and try again.", "PDF_COMPRESSION_LIMIT");
  }

  if (smallest === file.buffer) return file;
  logger.info("document.pdf_compressed", {
    filename: file.originalname,
    originalSize,
    compressedSize: smallest.length,
    savedBytes: originalSize - smallest.length,
  });
  return {
    ...file,
    buffer: smallest,
    size: smallest.length,
    originalSize,
    compressed: true,
  };
}
