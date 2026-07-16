import multer from "multer";

const allowedMimeTypes = new Set(["image/jpeg", "image/png", "image/webp"]);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, callback) => {
    if (!allowedMimeTypes.has(file.mimetype)) {
      const error = new Error("Upload a JPG, PNG, or WebP image.");
      error.statusCode = 400;
      callback(error);
      return;
    }
    callback(null, true);
  },
});

export const receiveProfileAvatar = upload.single("avatar");

export default receiveProfileAvatar;
