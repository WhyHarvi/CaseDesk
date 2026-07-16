import multer from "multer";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, callback) => {
    const csv = file.originalname.toLowerCase().endsWith(".csv") && ["text/csv", "application/vnd.ms-excel", "text/plain", "application/octet-stream"].includes(file.mimetype);
    if (csv) return callback(null, true);
    const error = new Error("Upload a CSV file up to 5 MB.");
    error.statusCode = 400;
    return callback(error);
  },
});

export const receiveLeadCsv = upload.single("file");

