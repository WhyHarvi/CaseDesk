import assert from "node:assert/strict";
import { randomFillSync } from "node:crypto";
import test from "node:test";
import { createCanvas } from "@napi-rs/canvas";
import { PDFDocument, StandardFonts } from "pdf-lib";
import {
  PDF_COMPRESSION_TARGET_BYTES,
  PDF_SAVED_MAX_BYTES,
  PDF_UPLOAD_MAX_BYTES,
  compressUploadedCasePdf,
} from "../src/services/pdfCompressionService.js";

test("case PDF upload policy uses 3 MB target, 4 MB saved maximum, and 5 MB input maximum", () => {
  assert.equal(PDF_COMPRESSION_TARGET_BYTES, 3 * 1024 * 1024);
  assert.equal(PDF_SAVED_MAX_BYTES, 4 * 1024 * 1024);
  assert.equal(PDF_UPLOAD_MAX_BYTES, 5 * 1024 * 1024);
});

test("small readable PDFs pass through byte-for-byte", async () => {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([612, 792]);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  page.drawText("Readable immigration document", { x: 72, y: 720, size: 18, font });
  const buffer = Buffer.from(await pdf.save());
  const file = { originalname: "document.pdf", mimetype: "application/pdf", size: buffer.length, buffer };
  const result = await compressUploadedCasePdf(file);
  assert.equal(result, file);
  assert.deepEqual(result.buffer, buffer);
});

test("PDFs over 5 MB are rejected before compression", async () => {
  const buffer = Buffer.alloc(PDF_UPLOAD_MAX_BYTES + 1);
  await assert.rejects(
    compressUploadedCasePdf({ originalname: "large.pdf", mimetype: "application/pdf", size: buffer.length, buffer }),
    (error) => error.statusCode === 413 && error.code === "PDF_TOO_LARGE",
  );
});

test("non-PDF uploads retain the existing upload behavior", async () => {
  const file = { originalname: "photo.jpg", mimetype: "image/jpeg", size: 64, buffer: Buffer.alloc(64) };
  assert.equal(await compressUploadedCasePdf(file), file);
});

test("a scan-sized PDF is raster-compressed to a readable PDF below the target", async () => {
  const canvas = createCanvas(1600, 2200);
  const context = canvas.getContext("2d");
  const pixels = context.createImageData(canvas.width, canvas.height);
  randomFillSync(pixels.data);
  for (let index = 3; index < pixels.data.length; index += 4) pixels.data[index] = 255;
  context.putImageData(pixels, 0, 0);

  const source = await PDFDocument.create();
  const scan = await source.embedJpg(canvas.toBuffer("image/jpeg", 96));
  const page = source.addPage([612, 792]);
  page.drawImage(scan, { x: 0, y: 0, width: 612, height: 792 });
  const buffer = Buffer.from(await source.save({ useObjectStreams: true }));
  assert.ok(buffer.length > PDF_COMPRESSION_TARGET_BYTES && buffer.length < PDF_UPLOAD_MAX_BYTES);

  const result = await compressUploadedCasePdf({ originalname: "scan.pdf", mimetype: "application/pdf", size: buffer.length, buffer });
  assert.equal(result.compressed, true);
  assert.ok(result.buffer.length < PDF_COMPRESSION_TARGET_BYTES);
  const readable = await PDFDocument.load(result.buffer);
  assert.equal(readable.getPageCount(), 1);
});
