import { createHttpError } from "../utils/http.js";

export const DOCUMENT_BUCKET = process.env.SUPABASE_DOCUMENT_BUCKET || "case-files";
export const AVATAR_BUCKET = process.env.SUPABASE_AVATAR_BUCKET || "profile-avatars";
export const VOICE_TUNE_BUCKET = process.env.SUPABASE_VOICE_TUNE_BUCKET || "agency-voice-tunes";

function config() {
  const url = String(process.env.SUPABASE_URL || "").replace(/\/$/, "");
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) {
    throw createHttpError(503, "Supabase Storage is not configured.", "STORAGE_NOT_CONFIGURED");
  }
  return { url, serviceRoleKey };
}

export function normalizeStorageKey(value) {
  const key = String(value || "").replaceAll("\\", "/").replace(/^\/+/, "");
  const parts = key.split("/");
  if (!key || parts.some((part) => !part || part === "." || part === "..")) {
    throw createHttpError(400, "Invalid storage path.", "INVALID_STORAGE_PATH");
  }
  return parts.join("/");
}

function objectPath(bucket, key) {
  return [bucket, ...normalizeStorageKey(key).split("/")].map(encodeURIComponent).join("/");
}

async function storageRequest(path, { method = "GET", body, headers = {}, allowMissing = false } = {}) {
  const { url, serviceRoleKey } = config();
  const response = await fetch(`${url}/storage/v1${path}`, {
    method,
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      ...headers,
    },
    ...(body === undefined ? {} : { body }),
    signal: AbortSignal.timeout(60_000),
  });
  if (response.ok) return response;
  const payload = await response.json().catch(() => ({}));
  const missing = response.status === 404 || (response.status === 400 && /not found/i.test(String(payload.message || payload.error || "")));
  if (allowMissing && missing) return null;
  const error = createHttpError(
    missing ? 404 : 502,
    payload.message || payload.error || `Supabase Storage request failed with status ${response.status}.`,
    missing ? "STORED_FILE_NOT_FOUND" : "STORAGE_REQUEST_FAILED",
  );
  error.storageStatus = response.status;
  throw error;
}

export async function uploadStorageFile(bucket, key, buffer, contentType, { upsert = false } = {}) {
  await storageRequest(`/object/${objectPath(bucket, key)}`, {
    method: "POST",
    body: buffer,
    headers: {
      "Content-Type": contentType || "application/octet-stream",
      "Cache-Control": "no-store",
      "x-upsert": String(upsert),
    },
  });
  return normalizeStorageKey(key);
}

export async function downloadStorageFile(bucket, key, { allowMissing = false } = {}) {
  const response = await storageRequest(`/object/${objectPath(bucket, key)}`, { allowMissing });
  if (!response) return null;
  return Buffer.from(await response.arrayBuffer());
}

export async function storageFileExists(bucket, key) {
  const response = await storageRequest(`/object/info/${objectPath(bucket, key)}`, { allowMissing: true });
  return Boolean(response);
}

export async function removeStorageFiles(bucket, keys) {
  const prefixes = [...new Set(keys.filter(Boolean).map(normalizeStorageKey))];
  if (!prefixes.length) return;
  await storageRequest(`/object/${encodeURIComponent(bucket)}`, {
    method: "DELETE",
    body: JSON.stringify({ prefixes }),
    headers: { "Content-Type": "application/json" },
  });
}

export async function removeStorageFile(bucket, key) {
  if (!key) return;
  await removeStorageFiles(bucket, [key]);
}

export async function copyStorageFile(bucket, sourceKey, destinationKey) {
  await storageRequest("/object/copy", {
    method: "POST",
    body: JSON.stringify({
      bucketId: bucket,
      sourceKey: normalizeStorageKey(sourceKey),
      destinationKey: normalizeStorageKey(destinationKey),
    }),
    headers: { "Content-Type": "application/json" },
  });
  return normalizeStorageKey(destinationKey);
}

export async function getBucket(bucket) {
  const response = await storageRequest(`/bucket/${encodeURIComponent(bucket)}`, { allowMissing: true });
  if (!response) return null;
  return response.json();
}

export async function createBucket(bucket, { public: isPublic = false, fileSizeLimit, allowedMimeTypes } = {}) {
  await storageRequest("/bucket", {
    method: "POST",
    body: JSON.stringify({
      id: bucket,
      name: bucket,
      public: isPublic,
      file_size_limit: fileSizeLimit,
      allowed_mime_types: allowedMimeTypes,
    }),
    headers: { "Content-Type": "application/json" },
  });
}

// Creates the bucket with the given policy on first use, and leaves it
// alone if it already exists — callers that need every upload's mime type
// covered should keep their own allow-list in sync with what they pass
// here the first time.
export async function ensureBucket(bucket, options) {
  const existing = await getBucket(bucket);
  if (existing) return existing;
  await createBucket(bucket, options);
  return getBucket(bucket);
}

export async function updateBucket(bucket, { public: isPublic, fileSizeLimit, allowedMimeTypes }) {
  const response = await storageRequest(`/bucket/${encodeURIComponent(bucket)}`, {
    method: "PUT",
    body: JSON.stringify({
      id: bucket,
      name: bucket,
      public: isPublic,
      file_size_limit: fileSizeLimit,
      allowed_mime_types: allowedMimeTypes,
    }),
    headers: { "Content-Type": "application/json" },
  });
  return response.json();
}
