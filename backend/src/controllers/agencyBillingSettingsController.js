import prisma from "../services/prisma/client.js";
import { createHttpError } from "../utils/http.js";
import { recordActivity } from "../utils/prismaCrud.js";
import { drawnSignatureImage } from "./clientPortalController.js";

function requireAdmin(req) {
  if (req.auth.role !== "admin") throw createHttpError(403, "Only workspace administrators can do this.", "FORBIDDEN");
}

function publicSettings(settings) {
  return {
    taxRatePercent: settings ? Number(settings.taxRatePercent) : 13,
    taxRegisteredName: settings?.taxRegisteredName || "",
    taxNumber: settings?.taxNumber || "",
    hasRetainerSignature: Boolean(settings?.retainerSignatureImage),
    retainerSignatureImage: settings?.retainerSignatureImage || null,
    retainerSignatureUpdatedAt: settings?.retainerSignatureUpdatedAt || null,
    retainerSignatureUpdatedBy: settings?.retainerSignatureUpdatedBy?.fullName || null,
  };
}

export async function getBillingSettings(req, res) {
  const settings = await prisma.agencyBillingSettings.findUnique({
    where: { agencyId: req.auth.agencyId },
    include: { retainerSignatureUpdatedBy: { select: { fullName: true } } },
  });
  res.json({ data: publicSettings(settings) });
}

// Fix 2.1 — the configurable Ontario HST rate (default 13%) applied to
// Professional/Consultation fee lines. Admin-only, same as every other
// billing configuration surface (fee categories, payment templates).
export async function updateBillingTaxSettings(req, res) {
  requireAdmin(req);
  const body = req.body || {};
  const data = {};
  if (body.taxRatePercent !== undefined) {
    const rate = Number(body.taxRatePercent);
    if (!Number.isFinite(rate) || rate < 0 || rate > 100) throw createHttpError(400, "Enter a valid tax rate between 0 and 100.", "VALIDATION_ERROR");
    data.taxRatePercent = rate;
  }
  if (body.taxRegisteredName !== undefined) data.taxRegisteredName = String(body.taxRegisteredName || "").trim().slice(0, 200) || null;
  if (body.taxNumber !== undefined) data.taxNumber = String(body.taxNumber || "").trim().slice(0, 60) || null;

  const settings = await prisma.agencyBillingSettings.upsert({
    where: { agencyId: req.auth.agencyId },
    create: { agencyId: req.auth.agencyId, ...data },
    update: data,
    include: { retainerSignatureUpdatedBy: { select: { fullName: true } } },
  });
  await recordActivity({ agencyId: req.auth.agencyId, userId: req.auth.userId, action: "billing_settings.updated", details: "Billing tax settings updated" });
  res.json({ data: publicSettings(settings) });
}

// Fix 6.1 — one single agency-wide signature (not per-admin, per the
// agency's confirmed decision), reused to auto-countersign every retainer
// once the client signs (Fix 6.2). Reuses drawnSignatureImage() from
// clientPortalController.js — the exact same base64 PNG validator already
// used for client signatures, rather than a second one.
export async function updateRetainerSignature(req, res) {
  requireAdmin(req);
  const image = drawnSignatureImage(req.body?.signatureImage);
  const settings = await prisma.agencyBillingSettings.upsert({
    where: { agencyId: req.auth.agencyId },
    create: { agencyId: req.auth.agencyId, retainerSignatureImage: image, retainerSignatureUpdatedAt: new Date(), retainerSignatureUpdatedById: req.auth.userId },
    update: { retainerSignatureImage: image, retainerSignatureUpdatedAt: new Date(), retainerSignatureUpdatedById: req.auth.userId },
    include: { retainerSignatureUpdatedBy: { select: { fullName: true } } },
  });
  await recordActivity({ agencyId: req.auth.agencyId, userId: req.auth.userId, action: "billing_settings.retainer_signature_updated", details: "Agency retainer countersignature updated" });
  res.json({ data: publicSettings(settings) });
}

export async function deleteRetainerSignature(req, res) {
  requireAdmin(req);
  const settings = await prisma.agencyBillingSettings.upsert({
    where: { agencyId: req.auth.agencyId },
    create: { agencyId: req.auth.agencyId, retainerSignatureImage: null },
    update: { retainerSignatureImage: null, retainerSignatureUpdatedAt: new Date(), retainerSignatureUpdatedById: req.auth.userId },
    include: { retainerSignatureUpdatedBy: { select: { fullName: true } } },
  });
  await recordActivity({ agencyId: req.auth.agencyId, userId: req.auth.userId, action: "billing_settings.retainer_signature_removed", details: "Agency retainer countersignature removed" });
  res.json({ data: publicSettings(settings) });
}
