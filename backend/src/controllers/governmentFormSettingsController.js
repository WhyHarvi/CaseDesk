import prisma from "../services/prisma/client.js";
import { DEFAULT_SIGNATURE_FILL_FRACTION, MAX_SIGNATURE_FILL_FRACTION, MIN_SIGNATURE_FILL_FRACTION } from "../services/imm5476SignatureFields.js";
import { createHttpError } from "../utils/http.js";
import { recordActivity } from "../utils/prismaCrud.js";

// Deliberately open to any authenticated staff member, not admin-only —
// mounted under /api/account (requireAuth only) rather than /api/settings
// (requireRole("admin")), alongside the other self-service government-form
// endpoints in formSignatureProfileController.js. The value itself is still
// agency-wide and shared by everyone, unlike the rest of that router.
export async function getGovernmentFormSettings(req, res) {
  const agency = await prisma.agency.findUnique({ where: { id: req.auth.agencyId }, select: { governmentFormSignatureScale: true } });
  res.json({
    data: {
      signatureScale: agency?.governmentFormSignatureScale ?? DEFAULT_SIGNATURE_FILL_FRACTION,
      defaultSignatureScale: DEFAULT_SIGNATURE_FILL_FRACTION,
      minSignatureScale: MIN_SIGNATURE_FILL_FRACTION,
      maxSignatureScale: MAX_SIGNATURE_FILL_FRACTION,
    },
  });
}

export async function updateGovernmentFormSettings(req, res) {
  const signatureScale = Number(req.body?.signatureScale);
  if (!Number.isFinite(signatureScale) || signatureScale < MIN_SIGNATURE_FILL_FRACTION || signatureScale > MAX_SIGNATURE_FILL_FRACTION) {
    throw createHttpError(400, `Signature size must be between ${Math.round(MIN_SIGNATURE_FILL_FRACTION * 100)}% and ${Math.round(MAX_SIGNATURE_FILL_FRACTION * 100)}%.`, "VALIDATION_ERROR");
  }
  await prisma.agency.update({ where: { id: req.auth.agencyId }, data: { governmentFormSignatureScale: signatureScale } });
  await recordActivity({
    agencyId: req.auth.agencyId,
    userId: req.auth.userId,
    action: "settings.government_form_signature_scale_updated",
    details: `Government-form signature size set to ${Math.round(signatureScale * 100)}%`,
  });
  res.json({ data: { signatureScale, defaultSignatureScale: DEFAULT_SIGNATURE_FILL_FRACTION, minSignatureScale: MIN_SIGNATURE_FILL_FRACTION, maxSignatureScale: MAX_SIGNATURE_FILL_FRACTION } });
}
