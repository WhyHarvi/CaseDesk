import { ShieldAlert } from "lucide-react";

// Shown before a paid appointment is actually cancelled — QuickBooks never
// refunds its original processing fee, and charges a new fee on the refund
// itself, so staff and clients both need to see the real number before
// committing, not find out after the fact. `estimate` is the
// {paid, estimatedFees, estimatedRefund} shape from
// backend/src/services/refundFeeEstimateService.js.
export default function RefundFeeNotice({ estimate, audience = "staff" }) {
  if (!estimate) return null;
  const { paid, estimatedFees, estimatedRefund } = estimate;
  const money = (value) => `$${Number(value).toFixed(2)}`;

  return (
    <div className="flex items-start gap-2.5 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
      <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
      <div>
        <p className="font-semibold">
          {audience === "client" ? `You paid ${money(paid)} for this appointment.` : `This appointment was paid ${money(paid)}.`}
        </p>
        <p className="mt-1 text-amber-800">
          {audience === "client"
            ? `If you cancel, QuickBooks processing fees mean you'd receive approximately ${money(estimatedRefund)} back if refunded — not the full amount.`
            : `After QuickBooks processing fees (~${money(estimatedFees)}), the client would receive approximately ${money(estimatedRefund)} back if refunded.`}
        </p>
      </div>
    </div>
  );
}
