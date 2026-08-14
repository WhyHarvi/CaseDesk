import prisma from "../services/prisma/client.js";
import { drawnSignatureImage } from "./clientPortalController.js";
import { createHttpError } from "../utils/http.js";
import { recordActivity } from "../utils/prismaCrud.js";
import { validatedSignatureStrokes } from "../utils/signatureStrokes.js";

async function representativeUser(req) {
  const user = await prisma.user.findFirst({
    where: {
      id: req.auth.userId,
      agencyId: req.auth.agencyId,
      status: "active",
      role: { in: ["admin", "consultant"] },
    },
    select: {
      id: true,
      fullName: true,
      licenseNumber: true,
      representativeType: true,
      membershipBody: true,
      membershipProvince: true,
      formSignatureImage: true,
      formSignatureStrokes: true,
      formSignatureUpdatedAt: true,
    },
  });
  if (!user) throw createHttpError(404, "Representative profile not found", "NOT_FOUND");
  return user;
}

function publicSignature(user) {
  return {
    fullName: user.fullName,
    licenseNumber: user.licenseNumber,
    representativeType: user.representativeType || "Paid",
    membershipBody: user.membershipBody || "College of Immigration and Citizenship Consultants (CICC)",
    membershipProvince: user.membershipProvince || "",
    hasSignature: Boolean(user.formSignatureImage && user.formSignatureStrokes),
    signatureImage: user.formSignatureImage || null,
    updatedAt: user.formSignatureUpdatedAt || null,
  };
}

export async function getMyFormSignature(req, res) {
  res.json({ data: publicSignature(await representativeUser(req)) });
}

function clean(value, max) {
  return String(value || "").trim().slice(0, max) || null;
}

export async function updateMyRepresentativeProfile(req, res) {
  const existing = await representativeUser(req);
  const licenseNumber = clean(req.body?.licenseNumber, 80);
  if (!licenseNumber) throw createHttpError(400, "Licence / membership ID is required", "REPRESENTATIVE_LICENCE_REQUIRED");
  const representativeType = clean(req.body?.representativeType, 80) || "Paid";
  if (!["Paid", "Unpaid"].includes(representativeType)) throw createHttpError(400, "Representative type must be Paid or Unpaid", "VALIDATION_ERROR");
  const user = await prisma.user.update({
    where: { id: existing.id },
    data: {
      licenseNumber,
      representativeType,
      membershipBody: clean(req.body?.membershipBody, 160),
      membershipProvince: clean(req.body?.membershipProvince, 80),
    },
    select: { fullName: true, licenseNumber: true, representativeType: true, membershipBody: true, membershipProvince: true, formSignatureImage: true, formSignatureStrokes: true, formSignatureUpdatedAt: true },
  });
  await recordActivity({ agencyId: req.auth.agencyId, userId: req.auth.userId, action: "government_form.representative_profile_updated", details: "Representative credentials updated", entityType: "user", entityId: req.auth.userId });
  res.json({ data: publicSignature(user) });
}

export async function updateMyFormSignature(req, res) {
  const existing = await representativeUser(req);
  if (!existing.licenseNumber?.trim()) throw createHttpError(409, "Save your licence number before saving a government-form signature", "REPRESENTATIVE_LICENCE_REQUIRED");
  const signatureImage = drawnSignatureImage(req.body?.signatureImage);
  const signatureStrokes = validatedSignatureStrokes(req.body?.signatureStrokes);
  const user = await prisma.user.update({
    where: { id: existing.id },
    data: { formSignatureImage: signatureImage, formSignatureStrokes: signatureStrokes, formSignatureUpdatedAt: new Date() },
    select: { fullName: true, licenseNumber: true, representativeType: true, membershipBody: true, membershipProvince: true, formSignatureImage: true, formSignatureStrokes: true, formSignatureUpdatedAt: true },
  });
  await recordActivity({
    agencyId: req.auth.agencyId,
    userId: req.auth.userId,
    action: "government_form.signature_updated",
    details: "Representative updated their personal government-form signature",
    entityType: "user",
    entityId: req.auth.userId,
  });
  res.json({ data: publicSignature(user) });
}

export async function deleteMyFormSignature(req, res) {
  const existing = await representativeUser(req);
  await prisma.user.update({
    where: { id: existing.id },
    data: { formSignatureImage: null, formSignatureStrokes: null, formSignatureUpdatedAt: new Date() },
  });
  await recordActivity({
    agencyId: req.auth.agencyId,
    userId: req.auth.userId,
    action: "government_form.signature_removed",
    details: "Representative removed their personal government-form signature",
    entityType: "user",
    entityId: req.auth.userId,
  });
  res.status(204).send();
}
