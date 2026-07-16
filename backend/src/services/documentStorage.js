import { access, mkdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHttpError } from "../utils/http.js";

const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
const storageRoot = path.resolve(process.env.DOCUMENT_STORAGE_PATH || path.join(moduleDirectory, "../../storage/documents"));

export function documentStoragePath(storageKey) {
  const resolved = path.resolve(storageRoot, storageKey);
  if (!resolved.startsWith(`${storageRoot}${path.sep}`)) {
    throw createHttpError(400, "Invalid document storage path");
  }
  return resolved;
}

export async function writeDocumentFile(storageKey, buffer) {
  const fullPath = documentStoragePath(storageKey);
  await mkdir(path.dirname(fullPath), { recursive: true });
  await writeFile(fullPath, buffer, { flag: "wx" });
  return fullPath;
}

export async function removeDocumentFile(storageKey) {
  if (!storageKey) return;
  try {
    await unlink(documentStoragePath(storageKey));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}

export async function requireDocumentFile(storageKey) {
  const fullPath = documentStoragePath(storageKey);
  try {
    await access(fullPath);
  } catch {
    throw createHttpError(404, "Stored document file was not found");
  }
  return fullPath;
}
