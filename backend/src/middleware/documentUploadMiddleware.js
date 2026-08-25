import multer from "multer";
import { compressUploadedCasePdf } from "../services/pdfCompressionService.js";

const allowedMimeTypes = new Set([
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "image/heic",
  "image/heif",
  "text/plain",
  "text/rtf",
  "application/rtf",
  "text/csv",
]);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, callback) => {
    if (!allowedMimeTypes.has(file.mimetype)) {
      const error = new Error("Unsupported file type. Upload PDF, Word, Excel, CSV, PowerPoint, image, HEIC, or text files.");
      error.statusCode = 400;
      callback(error);
      return;
    }
    callback(null, true);
  },
});

export const receiveDocumentFile = upload.single("file");

// Case/client evidence has an IRCC-friendly PDF policy: accept up to 5 MB,
// then compress before any controller writes the bytes or records fileSize.
// Other uploads keep the existing 25 MB policy and, importantly, editable
// government form templates are never rasterized by this middleware.
export function receiveCompressedCaseDocument(req, res, next) {
  receiveDocumentFile(req, res, (uploadError) => {
    if (uploadError) return next(uploadError);
    Promise.resolve(compressUploadedCasePdf(req.file))
      .then((file) => {
        req.file = file;
        next();
      })
      .catch(next);
  });
}

export default receiveDocumentFile;
