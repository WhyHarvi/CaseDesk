import { CircleAlert, CreditCard, Landmark, ReceiptText } from "lucide-react";
import { useEffect, useState } from "react";
import { getPortalPayments, portalErrorMessage } from "../../api/clientPortalApi";
import ClientPortalHeader from "../../components/client-portal/ClientPortalHeader";
import ClientPortalSkeleton, { GlassCard } from "../../components/client-portal/ClientPortalSkeleton";
import ClientPortalEmptyState from "../../components/client-portal/ClientPortalEmptyState";
import ClientPaymentCard, { PAYMENT_STATUS_TONE, formatMoney } from "../../components/client-portal/ClientPaymentCard";
import { usePortalData } from "../../components/client-portal/ClientPortalLayout";
import { formatPortalDate } from "../../components/client-portal/ClientStatusCard";

const HISTORY_STATUS_LABEL = { Unpaid: "Not Paid", Partial: "Partially Paid", Paid: "Paid", Refunded: "Refunded" };

export default function ClientPortalPayments() {
  const { overview } = usePortalData();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    getPortalPayments()
      .then((result) => active && setData(result))
      .catch((reason) => active && setError(portalErrorMessage(reason, "Your payment details could not be loaded.")))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, []);

  if (loading) return <ClientPortalSkeleton rows={3} />;

  return (
    <div className="space-y-4">
      <ClientPortalHeader
        title="Payments"
        subtitle="Your fees, balance, and payment history"
        client={overview?.client}
        agency={overview?.agency}
      />

      {error ? (
        <ClientPortalEmptyState icon={CircleAlert} title="We couldn't load your payments" copy={error} />
      ) : (
        <>
          <ClientPaymentCard payment={data.summary} />

          {data.instructions ? (
            <GlassCard className="p-5">
              <div className="flex items-center gap-2.5">
                <div className="flex h-9 w-9 items-center justify-center rounded-2xl bg-sky-100 text-sky-700"><Landmark className="h-4 w-4" /></div>
                <h2 className="text-[15px] font-semibold text-slate-900">How to pay</h2>
              </div>
              <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-slate-600">{data.instructions}</p>
            </GlassCard>
          ) : null}

          <GlassCard className="p-5">
            <div className="flex items-center gap-2.5">
              <div className="flex h-9 w-9 items-center justify-center rounded-2xl bg-indigo-100 text-indigo-700"><ReceiptText className="h-4 w-4" /></div>
              <h2 className="text-[15px] font-semibold text-slate-900">Payment history</h2>
            </div>
            {data.history.length ? (
              <ul className="mt-4 divide-y divide-slate-100">
                {data.history.map((item) => (
                  <li key={item.id} className="flex items-start justify-between gap-3 py-3.5 first:pt-1 last:pb-1">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-slate-900">{formatMoney(item.totalFee, item.currency)} fee</p>
                      <p className="mt-0.5 text-[12px] text-slate-500">
                        {formatMoney(item.paidAmount, item.currency)} paid · {formatMoney(item.balance, item.currency)} remaining
                      </p>
                      {item.note ? <p className="mt-1 text-[12px] leading-5 text-slate-500">{item.note}</p> : null}
                      <p className="mt-1 text-[11px] text-slate-400">Recorded {formatPortalDate(item.recordedAt)}</p>
                    </div>
                    <span className={["shrink-0 rounded-full px-2.5 py-1 text-[10px] font-semibold", PAYMENT_STATUS_TONE[HISTORY_STATUS_LABEL[item.status]] || "bg-slate-100 text-slate-500"].join(" ")}>
                      {HISTORY_STATUS_LABEL[item.status] || item.status}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-3 text-sm leading-6 text-slate-500">No payments have been recorded yet. Your history will appear here.</p>
            )}
          </GlassCard>

          <p className="flex items-start gap-2 px-2 text-[12px] leading-5 text-slate-400">
            <CreditCard className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            Payments are recorded by your agency. If something looks wrong, contact them from the Help tab.
          </p>
        </>
      )}
    </div>
  );
}
