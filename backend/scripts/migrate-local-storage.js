import "dotenv/config";
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { AVATAR_BUCKET, DOCUMENT_BUCKET, downloadStorageFile, storageFileExists, uploadStorageFile } from "../src/services/supabaseStorage.js";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(process.env.DOCUMENT_STORAGE_PATH || path.join(scriptDirectory, "../storage/documents"));
const apply = process.argv.includes("--apply");

const mimeByExtension = {
  ".csv": "text/csv",
  ".doc": "application/msword",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".gif": "image/gif",
  ".heic": "image/heic",
  ".heif": "image/heif",
  ".html": "text/html",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".json": "application/json",
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".ppt": "application/vnd.ms-powerpoint",
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ".rtf": "application/rtf",
  ".txt": "text/plain",
  ".webp": "image/webp",
  ".xls": "application/vnd.ms-excel",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

async function filesBelow(directory) {
  const entries = await readdir(directory, { withFileTypes: true }).catch((error) => {
    if (error.code === "ENOENT") return [];
    throw error;
  });
  const nested = await Promise.all(entries.map((entry) => {
    const target = path.join(directory, entry.name);
    return entry.isDirectory() ? filesBelow(target) : [target];
  }));
  return nested.flat();
}

const files = await filesBelow(root);
async function migrateFile(filename) {
  const key = path.relative(root, filename).split(path.sep).join("/");
  const bucket = key.split("/").includes("profiles") ? AVATAR_BUCKET : DOCUMENT_BUCKET;
  const mimeType = mimeByExtension[path.extname(filename).toLowerCase()];
  if (!mimeType) throw new Error(`No safe MIME type mapping for ${key}.`);
  if (!apply) {
    console.log(`[dry-run] ${bucket}/${key} (${mimeType})`);
    return "dry-run";
  }
  const localBuffer = await readFile(filename);
  if (await storageFileExists(bucket, key)) {
    const remoteBuffer = await downloadStorageFile(bucket, key);
    const digest = (buffer) => createHash("sha256").update(buffer).digest("hex");
    if (digest(localBuffer) !== digest(remoteBuffer)) {
      throw new Error(`Remote object does not match the local file: ${bucket}/${key}`);
    }
    console.log(`Skipped existing ${bucket}/${key}`);
    return "skipped";
  }
  try {
    await uploadStorageFile(bucket, key, localBuffer, mimeType);
    console.log(`Uploaded ${bucket}/${key}`);
    return "uploaded";
  } catch (error) {
    if (error.storageStatus === 400 && /already exists/i.test(error.message)) {
      const remoteBuffer = await downloadStorageFile(bucket, key);
      const digest = (buffer) => createHash("sha256").update(buffer).digest("hex");
      if (digest(localBuffer) !== digest(remoteBuffer)) {
        throw new Error(`Remote object does not match the local file: ${bucket}/${key}`);
      }
      console.log(`Skipped existing ${bucket}/${key}`);
      return "skipped";
    }
    throw error;
  }
}

const results = await Promise.all(files.map(migrateFile));
const uploaded = results.filter((result) => result === "uploaded").length;
const skipped = results.filter((result) => result === "skipped").length;

console.log(apply
  ? `Migration complete: ${uploaded} uploaded, ${skipped} already present, ${files.length} local files checked.`
  : `Dry run complete: ${files.length} local files found. Re-run with --apply to upload them.`);
