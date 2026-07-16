import crypto from "node:crypto";
import { createHttpError } from "../utils/http.js";

function encryptionKey() {
  const value = String(process.env.MAIL_SETTINGS_ENCRYPTION_KEY || "").trim();
  let key;
  if (/^[a-f\d]{64}$/i.test(value)) key = Buffer.from(value, "hex");
  else {
    try {
      key = Buffer.from(value, "base64");
    } catch {
      key = null;
    }
  }
  if (!key || key.length !== 32) {
    throw createHttpError(503, "Secure mailbox storage is not configured. Ask your system administrator to add the mail encryption key.");
  }
  return key;
}

export function secretEncryptionReady() {
  const value = String(process.env.MAIL_SETTINGS_ENCRYPTION_KEY || "").trim();
  if (/^[a-f\d]{64}$/i.test(value)) return true;
  try {
    return Buffer.from(value, "base64").length === 32;
  } catch {
    return false;
  }
}

export function encryptSecret(value) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(String(value), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString("base64")}:${tag.toString("base64")}:${encrypted.toString("base64")}`;
}

export function decryptSecret(value) {
  const [version, ivValue, tagValue, encryptedValue] = String(value || "").split(":");
  if (version !== "v1" || !ivValue || !tagValue || !encryptedValue) {
    throw createHttpError(500, "The saved mailbox password could not be read. Please reconnect the mailbox.");
  }
  try {
    const decipher = crypto.createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(ivValue, "base64"));
    decipher.setAuthTag(Buffer.from(tagValue, "base64"));
    return Buffer.concat([decipher.update(Buffer.from(encryptedValue, "base64")), decipher.final()]).toString("utf8");
  } catch {
    throw createHttpError(500, "The saved mailbox password could not be read. Please reconnect the mailbox.");
  }
}
