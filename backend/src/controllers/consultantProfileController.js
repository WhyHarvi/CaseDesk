import path from "node:path";
import { randomUUID } from "node:crypto";
import prisma from "../services/prisma/client.js";
import { AVATAR_BUCKET, downloadStorageFile, removeStorageFile, uploadStorageFile } from "../services/supabaseStorage.js";
import { createHttpError } from "../utils/http.js";
import { recordActivity } from "../utils/prismaCrud.js";
import { caseAccessWhere, clientAccessWhere } from "../middleware/authorization.js";

const profileSelect = {
  id: true,
  fullName: true,
  email: true,
  phone: true,
  jobTitle: true,
  avatarStorageKey: true,
  consultantProfiles: {
    select: { specializations: true },
  },
};

function publicProfile(user, stats = undefined) {
  return {
    id: user.id,
    fullName: user.fullName,
    email: user.email,
    phone: user.phone,
    jobTitle: user.jobTitle,
    specializations: user.consultantProfiles?.[0]?.specializations || [],
    hasAvatar: Boolean(user.avatarStorageKey),
    ...(stats ? { stats } : {}),
  };
}

function profileDeploymentError(error) {
  if (error?.code === "P2022" && /avatar_(storage_key|mime_type)/i.test(String(error?.meta?.column || error.message))) {
    return createHttpError(503, "Profile customization is waiting for the latest database migration. Run `npx prisma migrate deploy` on the backend and try again.", "PROFILE_MIGRATION_REQUIRED");
  }
  return error;
}

function optionalText(value, field, max) {
  const result = String(value ?? "").trim();
  if (result.length > max) {
    throw createHttpError(400, `${field} must be ${max} characters or fewer.`, "VALIDATION_ERROR");
  }
  return result || null;
}

function parseSpecializations(value) {
  let items = value;
  if (typeof value === "string") {
    try {
      items = JSON.parse(value);
    } catch {
      items = value.split(",");
    }
  }
  if (!Array.isArray(items)) {
    throw createHttpError(400, "Specialties must be a list.", "VALIDATION_ERROR");
  }
  const normalized = [...new Set(items.map((item) => String(item).trim()).filter(Boolean))];
  if (normalized.length > 20 || normalized.some((item) => item.length > 80)) {
    throw createHttpError(400, "Add no more than 20 specialties, with 80 characters or fewer each.", "VALIDATION_ERROR");
  }
  return normalized;
}

function detectedImage(buffer) {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return { extension: ".jpg", mimeType: "image/jpeg" };
  }
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return { extension: ".png", mimeType: "image/png" };
  }
  if (buffer.length >= 12 && buffer.subarray(0, 4).toString("ascii") === "RIFF" && buffer.subarray(8, 12).toString("ascii") === "WEBP") {
    return { extension: ".webp", mimeType: "image/webp" };
  }
  throw createHttpError(400, "The uploaded file is not a valid JPG, PNG, or WebP image.", "INVALID_AVATAR");
}

async function currentUser(req) {
  let user;
  try {
    user = await prisma.user.findFirst({
      where: { id: req.auth.userId, agencyId: req.auth.agencyId, role: "consultant" },
      select: profileSelect,
    });
  } catch (error) {
    throw profileDeploymentError(error);
  }
  if (!user) throw createHttpError(404, "Consultant profile not found.", "NOT_FOUND");
  return user;
}

async function profileStats(req) {
  const agencyId = req.auth.agencyId;
  const [clients, activeCases, openFollowUps] = await Promise.all([
    prisma.client.count({ where: { agencyId, ...clientAccessWhere(req) } }),
    prisma.case.count({ where: { agencyId, ...caseAccessWhere(req), status: { not: "Closed" } } }),
    prisma.followUp.count({
      where: {
        agencyId,
        status: "Pending",
        OR: [{ assignedUserId: req.auth.userId }, { case: caseAccessWhere(req) }],
      },
    }),
  ]);
  return { clients, activeCases, openFollowUps };
}

async function removeStoredAvatar(storageKey) {
  if (!storageKey) return;
  await removeStorageFile(AVATAR_BUCKET, storageKey);
}

export async function getMyProfile(req, res) {
  const [user, stats] = await Promise.all([currentUser(req), profileStats(req)]);
  res.json({ success: true, data: publicProfile(user, stats) });
}

export async function updateMyProfile(req, res) {
  const existing = await currentUser(req);
  const fullName = String(req.body.fullName || "").trim().replace(/\s+/g, " ");
  if (!fullName) throw createHttpError(400, "Full name is required.", "VALIDATION_ERROR");
  if (fullName.length > 200) throw createHttpError(400, "Full name must be 200 characters or fewer.", "VALIDATION_ERROR");
  const phone = optionalText(req.body.phone, "Phone", 40);
  const jobTitle = optionalText(req.body.jobTitle, "Job title", 100);
  const specializations = parseSpecializations(req.body.specializations ?? []);
  let nextAvatar = null;

  if (req.file) {
    const image = detectedImage(req.file.buffer);
    const storageKey = path.posix.join(req.auth.agencyId, "profiles", req.auth.userId, `${randomUUID()}${image.extension}`);
    await uploadStorageFile(AVATAR_BUCKET, storageKey, req.file.buffer, image.mimeType);
    nextAvatar = { storageKey, mimeType: image.mimeType };
  }

  try {
    const user = await prisma.$transaction(async (tx) => {
      await tx.consultantProfile.update({
        where: { agencyId_userId: { agencyId: req.auth.agencyId, userId: req.auth.userId } },
        data: { specializations },
      });
      return tx.user.update({
        where: { id: req.auth.userId },
        data: {
          fullName,
          phone,
          jobTitle,
          ...(nextAvatar ? { avatarStorageKey: nextAvatar.storageKey, avatarMimeType: nextAvatar.mimeType } : {}),
        },
        select: profileSelect,
      });
    });
    if (nextAvatar && existing.avatarStorageKey !== nextAvatar.storageKey) {
      await removeStoredAvatar(existing.avatarStorageKey);
    }
    await recordActivity({
      agencyId: req.auth.agencyId,
      userId: req.auth.userId,
      action: "CONSULTANT_PROFILE_UPDATED",
      details: existing.fullName === fullName ? "Consultant updated their personal profile" : `Consultant changed their name from ${existing.fullName} to ${fullName}`,
      entityType: "user",
      entityId: req.auth.userId,
    });
    res.json({ success: true, data: publicProfile(user, await profileStats(req)), message: "Profile updated." });
  } catch (error) {
    if (nextAvatar) await removeStoredAvatar(nextAvatar.storageKey);
    throw error;
  }
}

export async function getMyAvatar(req, res) {
  let user;
  try {
    user = await prisma.user.findFirst({
      where: { id: req.auth.userId, agencyId: req.auth.agencyId, role: "consultant" },
      select: { avatarStorageKey: true, avatarMimeType: true },
    });
  } catch (error) {
    throw profileDeploymentError(error);
  }
  if (!user?.avatarStorageKey) throw createHttpError(404, "No profile image is available.", "NOT_FOUND");
  const buffer = await downloadStorageFile(AVATAR_BUCKET, user.avatarStorageKey, { allowMissing: true });
  if (!buffer) throw createHttpError(404, "The profile image could not be found.", "NOT_FOUND");
  res.set("Cache-Control", "private, max-age=300");
  res.type(user.avatarMimeType || "application/octet-stream");
  res.send(buffer);
}

export async function deleteMyAvatar(req, res) {
  const existing = await currentUser(req);
  await prisma.user.update({
    where: { id: req.auth.userId },
    data: { avatarStorageKey: null, avatarMimeType: null },
  });
  await removeStoredAvatar(existing.avatarStorageKey);
  res.status(204).send();
}
