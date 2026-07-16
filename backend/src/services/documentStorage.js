import { createHttpError } from "../utils/http.js";
import {
  DOCUMENT_BUCKET,
  downloadStorageFile,
  normalizeStorageKey,
  removeStorageFile,
  storageFileExists,
  uploadStorageFile,
} from "./supabaseStorage.js";

export function documentStoragePath(storageKey) {
  return normalizeStorageKey(storageKey);
}

export async function writeDocumentFile(storageKey, buffer, mimeType) {
  return uploadStorageFile(DOCUMENT_BUCKET, documentStoragePath(storageKey), buffer, mimeType);
}

export async function removeDocumentFile(storageKey) {
  if (!storageKey) return;
  await removeStorageFile(DOCUMENT_BUCKET, documentStoragePath(storageKey));
}

export async function requireDocumentFile(storageKey) {
  const key = documentStoragePath(storageKey);
  const buffer = await downloadStorageFile(DOCUMENT_BUCKET, key, { allowMissing: true });
  if (!buffer) throw createHttpError(404, "Stored document file was not found");
  return buffer;
}

export async function documentFileExists(storageKey) {
  return storageFileExists(DOCUMENT_BUCKET, documentStoragePath(storageKey));
}
