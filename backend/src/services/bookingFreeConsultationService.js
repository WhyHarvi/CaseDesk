import prisma from "./prisma/client.js";

// Shared by every booking surface. A complimentary follow-up is earned only
// after an earlier paid consultation has actually taken place. UI labels are
// advisory; this service is the server-side authority that prevents staff,
// portal, public, and direct API bookings from bypassing the rule.
export async function resolveFreeConsultationEligibility(agencyId, settings, {
  clientId = null,
  guestEmailNormalized = null,
  durationMinutes = null,
}) {
  const limit = Number(settings.freeConsultationsPerContact || 1);
  if (!settings.freeConsultationsEnabled) {
    return { enabled: false, eligible: false, contactEligible: false, hasPriorPaidBooking: false, priorPaidCount: 0, priorFreeCount: 0, limit, reason: "FREE_DISABLED" };
  }
  if (!clientId && !guestEmailNormalized) {
    return { enabled: true, eligible: false, contactEligible: false, hasPriorPaidBooking: false, priorPaidCount: 0, priorFreeCount: 0, limit, reason: "VERIFIED_CONTACT_REQUIRED" };
  }

  const email = String(guestEmailNormalized || "").trim().toLowerCase() || null;
  const identity = [
    ...(clientId ? [{ clientId }, { appointment: { is: { clientId } } }] : []),
    ...(email ? [{ guestEmailNormalized: email }, { appointment: { is: { guestEmailNormalized: email } } }] : []),
  ];
  const now = new Date();
  const [priorPaidCount, priorFreeCount] = await Promise.all([
    prisma.bookingPaymentHold.count({
      where: {
        agencyId,
        status: "Paid",
        paidAt: { not: null },
        voidedAt: null,
        balanceMismatchAt: null,
        AND: [
          { OR: identity },
          {
            appointment: {
              is: {
                isFreeConsultation: false,
                status: { not: "Cancelled" },
                endsAt: { lt: now },
              },
            },
          },
        ],
      },
    }),
    prisma.appointment.count({
      where: {
        agencyId,
        isFreeConsultation: true,
        status: { not: "Cancelled" },
        OR: [
          ...(clientId ? [{ clientId }] : []),
          ...(email ? [{ guestEmailNormalized: email }] : []),
        ],
      },
    }),
  ]);
  const hasPriorPaidBooking = priorPaidCount > 0;
  const withinLimit = priorFreeCount < limit;
  const isFifteenMinutes = Number(durationMinutes) === 15;
  const contactEligible = hasPriorPaidBooking && withinLimit;
  const eligible = contactEligible && isFifteenMinutes;
  const reason = !hasPriorPaidBooking
    ? "PAID_BOOKING_REQUIRED"
    : !withinLimit
      ? "FREE_LIMIT_REACHED"
      : !isFifteenMinutes
        ? "FIFTEEN_MINUTE_SESSION_REQUIRED"
        : "ELIGIBLE";

  return {
    enabled: true,
    eligible,
    contactEligible,
    hasPriorPaidBooking,
    priorPaidCount,
    priorFreeCount,
    limit,
    reason,
  };
}
