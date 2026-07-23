import multer from "multer";

const EXCEL_MIME_TYPES = new Set([
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel",
]);
const REPORT_MIME_TYPES = new Set([
  ...EXCEL_MIME_TYPES,
  "text/csv",
  "application/csv",
  "text/plain",
  "application/octet-stream",
]);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024, files: 2 },
  fileFilter: (req, file, callback) => {
    if (!EXCEL_MIME_TYPES.has(file.mimetype)) {
      const error = new Error(`${file.fieldname} must be an Excel (.xlsx) file.`);
      error.statusCode = 400;
      callback(error);
      return;
    }
    callback(null, true);
  },
});

// Unlabeled — the caller doesn't have to know which file is which (see
// classifyWorkbookHeaders in caseEasyImportService.js), just drop up to 2
// files under the same field name.
export const receiveCaseEasyImportFiles = upload.array("files", 2);

const reportUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, callback) => {
    const extension = file.originalname.toLowerCase().split(".").pop();
    if (
      !REPORT_MIME_TYPES.has(file.mimetype) ||
      !["xlsx", "csv"].includes(extension)
    ) {
      const error = new Error("Report must be an Excel (.xlsx) or CSV file.");
      error.statusCode = 400;
      callback(error);
      return;
    }
    callback(null, true);
  },
});

export const receiveCaseEasyReportFile = reportUpload.single("file");
