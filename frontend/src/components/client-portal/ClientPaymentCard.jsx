import { ArrowRight, CreditCard } from "lucide-react";
import { Link } from "react-router-dom";
import { GlassCard } from "./ClientPortalSkeleton";

export const PAYMENT_STATUS_TONE = {
  Paid: "bg-emerald-100/90 text-emerald-800",
  "Partially Paid": "bg-amber-100/90 text-amber-800",
  "Not Paid": "bg-rose-100/90 text-rose-700",
  Refunded: "bg-slate-100 text-slate-600",
  "No Fee Recorded": "bg-slate-100 text-slate-500",
};

export function formatMoney(value, currency = "CAD") {
  return new Intl.NumberFormat("en-CA", { style: "currency", currency, maximumFractionDigits: 2 }).format(Number(value || 0));
}

export default function ClientPaymentCard({ payment, compact = false }) {
  if (!payment) return null;
  const hasFee = payment.status !== "No Fee Recorded";

  return (
    <GlassCard className="p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">Payments</p>
          <div className="mt-1.5 flex items-center gap-2">
            <h2 className="text-lg font-semibold tracking-tight text-slate-950">
              {hasFee ? formatMoney(payment.balance, payment.currency) : "No fees yet"}
            </h2>
            {hasFee ? <span className="text-xs text-slate-400">balance</span> : null}
          </div>
        </div>
        <span className={["shrink-0 rounded-full px-2.5 py-1 text-[10px] font-semibold", PAYMENT_STATUS_TONE[payment.status] || "bg-slate-100 text-slate-500"].join(" ")}>
          {payment.status}
        </span>
      </div>

      {hasFee ? (
        <div className="mt-4 grid grid-cols-2 gap-2.5">
          <div className="rounded-2xl bg-slate-50/90 px-3.5 py-2.5">
            <p className="text-[11px] font-medium text-slate-400">Total fee</p>
            <p className="mt-0.5 text-sm font-semibold text-slate-800">{formatMoney(payment.totalFee, payment.currency)}</p>
          </div>
          <div className="rounded-2xl bg-emerald-50/80 px-3.5 py-2.5">
            <p className="text-[11px] font-medium text-emerald-600/80">Paid so far</p>
            <p className="mt-0.5 text-sm font-semibold text-emerald-800">{formatMoney(payment.paidAmount, payment.currency)}</p>
          </div>
        </div>
      ) : (
        <p className="mt-3 text-sm leading-6 text-slate-500">Your agency has not recorded any fees for your file yet.</p>
      )}

      {compact ? (
        <Link
          to="/client-portal/payments"
          className="mt-4 inline-flex h-10 w-full items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white/80 text-sm font-semibold text-slate-700 transition-all duration-200 hover:border-slate-300 active:scale-[0.98]"
        >
          <CreditCard className="h-4 w-4" />
          View payment details
          <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      ) : null}
    </GlassCard>
  );
}
