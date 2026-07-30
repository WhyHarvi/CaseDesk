import prisma from "./prisma/client.js";

// Shared by the public booking page and the internal staff booking form so
// both enforce the same per-contact free-consultation cutoff instead of
// drifting — the public page blocks booking once the limit is reached, the
// staff form just stops flagging the appointment as free (see callers).
export async function resolveFreeConsultationEligibility(agencyId, settings, { clientId = null, guestEmailNormalized = null }) {
  if (!settings.freeConsultationsEnabled) {
    return { enabled: false, eligible: false, priorFreeCount: 0, limit: settings.freeConsultationsPerContact };
  }
  if (!clientId && !guestEmailNormalized) {
    return { enabled: true, eligible: false, priorFreeCount: 0, limit: settings.freeConsultationsPerContact };
  }
  const priorFreeCount = await prisma.appointment.count({
    where: {
      agencyId,
      isFreeConsultation: true,
      status: { not: "Cancelled" },
      OR: [
        ...(clientId ? [{ clientId }] : []),
        ...(guestEmailNormalized ? [{ guestEmailNormalized }] : []),
      ],
    },
  });
  return {
    enabled: true,
    eligible: priorFreeCount < settings.freeConsultationsPerContact,
    priorFreeCount,
    limit: settings.freeConsultationsPerContact,
  };
}
