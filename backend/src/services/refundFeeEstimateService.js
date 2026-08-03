import prisma from "./prisma/client.js";

// Fallback only — used when an agency has no QuickBooks connection yet (so
// no AgencyQuickBooksSettings row exists to read a configured rate from).
// Once connected, the real rate lives on AgencyQuickBooksSettings.refundFeeRatePercent,
// editable in Settings -> Payments & Fees, since QuickBooks Payments rates
// vary per merchant/plan.
export const QUICKBOOKS_PROCESSING_FEE_RATE = 0.0299;

export async function refundFeeRateForAgency(agencyId) {
  const settings = await prisma.agencyQuickBooksSettings.findUnique({
    where: { agencyId },
    select: { refundFeeRatePercent: true },
  });
  if (!settings) return QUICKBOOKS_PROCESSING_FEE_RATE;
  return Number(settings.refundFeeRatePercent) / 100;
}

// Applied twice: the original charge's processing fee is never refunded,
// and QuickBooks charges a new fee on the refund transaction itself (per
// Intuit's own refund/void policy documentation) — so a refunded client
// loses roughly double a single transaction's fee, not one.
export function estimateRefundAfterFees(amount, feeRate = QUICKBOOKS_PROCESSING_FEE_RATE) {
  const paid = Number(amount) || 0;
  const rate = Number(feeRate) || QUICKBOOKS_PROCESSING_FEE_RATE;
  const estimatedFees = Math.round(paid * rate * 2 * 100) / 100;
  const estimatedRefund = Math.max(0, Math.round((paid - estimatedFees) * 100) / 100);
  return { paid, estimatedFees, estimatedRefund, feeRate: rate };
}
