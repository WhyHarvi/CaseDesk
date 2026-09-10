import multer from "multer";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1, fields: 8 },
  fileFilter: (_req, file, callback) => {
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.mimetype)) {
      const error = new Error("Payment screenshots must be JPG, PNG, or WebP images.");
      error.statusCode = 400;
      callback(error);
      return;
    }
    callback(null, true);
  },
});

export const receivePaymentProof = upload.single("screenshot");
