import "dotenv/config";
import { AVATAR_BUCKET, DOCUMENT_BUCKET, getBucket, updateBucket } from "../src/services/supabaseStorage.js";

export const documentMimeTypes = [
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/json",
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "image/heic",
  "image/heif",
  "text/plain",
  "text/html",
  "text/rtf",
  "application/rtf",
  "text/csv",
];

export const avatarMimeTypes = ["image/jpeg", "image/png", "image/webp"];

async function configure(bucket, settings) {
  await getBucket(bucket);
  await updateBucket(bucket, settings);
  const updated = await getBucket(bucket);
  if (updated.public !== false) throw new Error(`${bucket} must be private.`);
  console.log(`Configured private bucket ${bucket} with a ${settings.fileSizeLimit / 1024 / 1024} MB limit.`);
}

await configure(DOCUMENT_BUCKET, {
  public: false,
  fileSizeLimit: 25 * 1024 * 1024,
  allowedMimeTypes: documentMimeTypes,
});
await configure(AVATAR_BUCKET, {
  public: false,
  fileSizeLimit: 5 * 1024 * 1024,
  allowedMimeTypes: avatarMimeTypes,
});
