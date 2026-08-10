import path from "node:path";
import { randomUUID } from "node:crypto";
import prisma from "../services/prisma/client.js";
import { AVATAR_BUCKET, downloadStorageFile, removeStorageFile, uploadStorageFile } from "../services/supabaseStorage.js";
import { createHttpError } from "../utils/http.js";
import { recordActivity } from "../utils/prismaCrud.js";

const agencySelect = {
  id: true,
  name: true,
  legalName: true,
  email: true,
  phone: true,
  website: true,
  address: true,
  city: true,
  province: true,
  country: true,
  postalCode: true,
  timezone: true,
  defaultCurrency: true,
  businessNumber: true,
  taxNumber: true,
  ownerFullName: true,
  ownerLicenseNumber: true,
  ownerPhone: true,
  ownerEmail: true,
  avatarStorageKey: true,
  avatarMimeType: true,
  createdAt: true,
};

function requiredText(value, field, max = 160) {
  const normalized = String(value ?? "").trim().replace(/\s+/g, " ");
  if (!normalized || normalized.length > max) {
    throw createHttpError(400, `${field} is required and must be ${max} characters or fewer.`, "VALIDATION_ERROR");
  }
  return normalized;
}

function optionalText(value, field, max = 160) {
  const normalized = String(value ?? "").trim().replace(/\s+/g, " ");
  if (normalized.length > max) {
    throw createHttpError(400, `${field} must be ${max} characters or fewer.`, "VALIDATION_ERROR");
  }
  return normalized || null;
}

function requiredEmail(value) {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (normalized.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
    throw createHttpError(400, "Enter a valid public email address.", "VALIDATION_ERROR");
  }
  return normalized;
}

function optionalEmail(value) {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (!normalized) return null;
  if (normalized.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
    throw createHttpError(400, "Enter a valid owner email address.", "VALIDATION_ERROR");
  }
  return normalized;
}

function validTimezone(value) {
  const normalized = String(value ?? "").trim();
  if (!normalized) return null;
  try {
    new Intl.DateTimeFormat("en", { timeZone: normalized });
  } catch {
    throw createHttpError(400, "Enter a valid IANA timezone, for example America/Toronto.", "VALIDATION_ERROR");
  }
  return normalized;
}

function validCurrency(value) {
  const normalized = String(value ?? "").trim().toUpperCase();
  if (!normalized) return null;
  if (!/^[A-Z]{3}$/.test(normalized)) {
    throw createHttpError(400, "Currency must be a 3-letter ISO code, for example CAD.", "VALIDATION_ERROR");
  }
  return normalized;
}

async function agencyStats(agencyId) {
  const [teamMembers, clients, activeCases] = await Promise.all([
    prisma.user.count({ where: { agencyId, status: "active", role: { in: ["admin", "consultant"] } } }),
    prisma.client.count({ where: { agencyId } }),
    prisma.case.count({ where: { agencyId, status: { not: "Closed" } } }),
  ]);
  return { teamMembers, clients, activeCases };
}

function publicAgency(agency, stats = undefined) {
  return {
    id: agency.id,
    name: agency.name,
    legalName: agency.legalName,
    email: agency.email,
    phone: agency.phone,
    website: agency.website,
    address: agency.address,
    city: agency.city,
    province: agency.province,
    country: agency.country,
    postalCode: agency.postalCode,
    timezone: agency.timezone,
    defaultCurrency: agency.defaultCurrency,
    businessNumber: agency.businessNumber,
    taxNumber: agency.taxNumber,
    ownerFullName: agency.ownerFullName,
    ownerLicenseNumber: agency.ownerLicenseNumber,
    ownerPhone: agency.ownerPhone,
    ownerEmail: agency.ownerEmail,
    hasAvatar: Boolean(agency.avatarStorageKey),
    createdAt: agency.createdAt,
    ...(stats ? { stats } : {}),
  };
}

export async function getAgencyProfile(req, res) {
  const [agency, stats] = await Promise.all([
    prisma.agency.findUnique({ where: { id: req.auth.agencyId }, select: agencySelect }),
    agencyStats(req.auth.agencyId),
  ]);
  if (!agency) throw createHttpError(404, "Agency not found.", "NOT_FOUND");
  res.json({ success: true, data: publicAgency(agency, stats) });
}

export async function updateAgencyProfile(req, res) {
  const existing = await prisma.agency.findUnique({ where: { id: req.auth.agencyId }, select: { avatarStorageKey: true } });
  const name = requiredText(req.body.name, "Agency name");
  const data = {
    name,
    legalName: optionalText(req.body.legalName, "Legal name", 200) || name,
    email: requiredEmail(req.body.email),
    phone: optionalText(req.body.phone, "Phone", 40),
    website: optionalText(req.body.website, "Website", 200),
    address: optionalText(req.body.address, "Address", 200),
    city: optionalText(req.body.city, "City", 100),
    province: optionalText(req.body.province, "Province or state", 100),
    country: optionalText(req.body.country, "Country", 80),
    postalCode: optionalText(req.body.postalCode, "Postal code", 24),
    timezone: validTimezone(req.body.timezone) || "America/Toronto",
    defaultCurrency: validCurrency(req.body.defaultCurrency) || "CAD",
    businessNumber: optionalText(req.body.businessNumber, "Business number", 60),
    taxNumber: optionalText(req.body.taxNumber, "Tax number", 60),
    // The agency's designated owner/signing authority — a fixed identity used
    // on documents like the retainer agreement, independent of whichever
    // staff member happens to be assigned to a given case.
    ownerFullName: optionalText(req.body.ownerFullName, "Owner full name", 160),
    ownerLicenseNumber: optionalText(req.body.ownerLicenseNumber, "Owner license number", 60),
    ownerPhone: optionalText(req.body.ownerPhone, "Owner phone", 40),
    ownerEmail: optionalEmail(req.body.ownerEmail),
  };
  let nextAvatar = null;
  if (req.file) {
    const image = detectedImage(req.file.buffer);
    const storageKey = path.posix.join(req.auth.agencyId, "workspace", `${randomUUID()}${image.extension}`);
    await uploadStorageFile(AVATAR_BUCKET, storageKey, req.file.buffer, image.mimeType);
    nextAvatar = { storageKey, mimeType: image.mimeType };
  }

  let agency;
  try {
    agency = await prisma.agency.update({
      where: { id: req.auth.agencyId },
      data: {
        ...data,
        ...(nextAvatar ? { avatarStorageKey: nextAvatar.storageKey, avatarMimeType: nextAvatar.mimeType } : {}),
      },
      select: agencySelect,
    });
  } catch (error) {
    if (nextAvatar) await removeStorageFile(AVATAR_BUCKET, nextAvatar.storageKey);
    throw error;
  }
  if (nextAvatar && existing?.avatarStorageKey && existing.avatarStorageKey !== nextAvatar.storageKey) {
    await removeStorageFile(AVATAR_BUCKET, existing.avatarStorageKey);
  }

  await recordActivity({
    agencyId: req.auth.agencyId,
    userId: req.auth.userId,
    action: "AGENCY_PROFILE_UPDATED",
    details: "Agency profile details updated",
  });

  res.json({ success: true, data: publicAgency(agency, await agencyStats(req.auth.agencyId)), message: "Agency profile updated." });
}

function detectedImage(buffer) {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return { extension: ".jpg", mimeType: "image/jpeg" };
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { extension: ".png", mimeType: "image/png" };
  if (buffer.length >= 12 && buffer.subarray(0, 4).toString("ascii") === "RIFF" && buffer.subarray(8, 12).toString("ascii") === "WEBP") return { extension: ".webp", mimeType: "image/webp" };
  throw createHttpError(400, "The uploaded file is not a valid JPG, PNG, or WebP image.", "INVALID_AVATAR");
}

export async function getAgencyAvatar(req, res) {
  const agency = await prisma.agency.findUnique({
    where: { id: req.auth.agencyId },
    select: { avatarStorageKey: true, avatarMimeType: true },
  });
  if (!agency?.avatarStorageKey) throw createHttpError(404, "No workspace image is available.", "NOT_FOUND");
  const buffer = await downloadStorageFile(AVATAR_BUCKET, agency.avatarStorageKey, { allowMissing: true });
  if (!buffer) throw createHttpError(404, "The workspace image could not be found.", "NOT_FOUND");
  res.set("Cache-Control", "private, max-age=300");
  res.type(agency.avatarMimeType || "application/octet-stream");
  res.send(buffer);
}

export async function deleteAgencyAvatar(req, res) {
  const existing = await prisma.agency.findUnique({ where: { id: req.auth.agencyId }, select: { avatarStorageKey: true } });
  await prisma.agency.update({
    where: { id: req.auth.agencyId },
    data: { avatarStorageKey: null, avatarMimeType: null },
  });
  if (existing?.avatarStorageKey) await removeStorageFile(AVATAR_BUCKET, existing.avatarStorageKey);
  res.status(204).send();
}
