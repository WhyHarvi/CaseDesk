import {
  ArrowDownLeft,
  ArrowUpRight,
  CalendarClock,
  FileText,
  LoaderCircle,
  ReceiptText,
  RefreshCw,
  RotateCcw,
  Plus,
  WalletCards,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import api from "../../services/api";
import { useAuth } from "../../auth/AuthContext";
import ClientManualBillingEntrySheet from "./ClientManualBillingEntrySheet";

function money(value, currency) {
  return new Intl.NumberFormat("en-CA", {
    style: "currency",
    currency: currency || "CAD",
  }).format(Number(value || 0));
}

function date(value) {
  if (!value) return "";
  return new Intl.DateTimeFormat("en-CA", { month: "short", day: "numeric", year: "numeric" }).format(new Date(value));
}

const TYPE_META = {
  Invoice: { Icon: ReceiptText, tone: "bg-sky-50 text-sky-700", amount: (item) => item.charge, prefix: "+" },
  Payment: { Icon: ArrowDownLeft, tone: "bg-emerald-50 text-emerald-700", amount: (item) => item.paymentOrCredit, prefix: "−" },
  Credit: { Icon: ArrowDownLeft, tone: "bg-violet-50 text-violet-700", amount: (item) => item.paymentOrCredit, prefix: "−" },
  Refund: { Icon: RotateCcw, tone: "bg-rose-50 text-rose-700", amount: (item) => item.refund, prefix: "−" },
  Adjustment: { Icon: CalendarClock, tone: "bg-amber-50 text-amber-700", amount: (item) => item.charge || item.paymentOrCredit, prefix: "" },
};

function Metric({ label, value, tone = "text-slate-950" }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-50/80 px-3.5 py-3">
      <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500">{label}</p>
      <p className={`mt-1.5 text-sm font-semibold tabular-nums ${tone}`}>{value}</p>
    </div>
  );
}

export default function ClientBillingCard({ clientId, clientName, onOpenStatement, onEntrySaved, initialEntry = null, id, highlightClassName = "" }) {
  const { role } = useAuth();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [entryOpen, setEntryOpen] = useState(Boolean(initialEntry));
  const [entryPreset, setEntryPreset] = useState(initialEntry);
  // Front desk can record a payment only when Portal Access has already
  // granted financialData and client access; the API repeats both checks.
  const canRecord = ["admin", "consultant", "frontdesk"].includes(role);

  const load = useCallback(async ({ quiet = false } = {}) => {
    try {
      quiet ? setRefreshing(true) : setLoading(true);
      const response = await api.get(`/clients/${clientId}/billing`);
      setData(response.data.data);
      setError("");
    } catch (requestError) {
      setError(requestError.response?.data?.message || "Billing history could not be loaded.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [clientId]);

  useEffect(() => { load(); }, [load]);

  const recent = useMemo(() => (data?.transactions || []).slice(0, 6), [data]);
  const summary = data?.summary || {};

  return (
    <article id={id} className={`overflow-hidden rounded-[1.9rem] border border-slate-200/90 bg-white shadow-[0_14px_38px_rgba(15,23,42,0.07)] ${highlightClassName}`}>
      <div className="flex flex-col items-start justify-between gap-4 px-6 pb-5 pt-6 sm:flex-row">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-slate-950 text-white shadow-[0_9px_22px_rgba(15,23,42,0.16)]">
            <WalletCards className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <h3 className="text-lg font-semibold text-slate-950">Billing</h3>
            <p className="mt-0.5 text-sm text-slate-500">Every case, appointment, payment and refund.</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {canRecord ? <button type="button" onClick={() => { setEntryPreset(null); setEntryOpen(true); }} className="inline-flex h-9 items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 transition hover:border-sky-300 hover:bg-sky-50"><Plus className="h-3.5 w-3.5" /> Add entry</button> : null}
          <button type="button" onClick={() => load({ quiet: true })} disabled={refreshing} className="flex h-9 w-9 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 transition hover:border-slate-300 hover:text-slate-950 disabled:opacity-50" aria-label="Refresh billing">
            <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} />
          </button>
          <button type="button" onClick={onOpenStatement} className="inline-flex items-center gap-1.5 rounded-full bg-slate-950 px-3.5 py-2 text-xs font-semibold text-white transition hover:bg-slate-800">
            Full statement <ArrowUpRight className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {loading ? (
        <div className="flex min-h-52 items-center justify-center border-t border-slate-100"><LoaderCircle className="h-5 w-5 animate-spin text-slate-400" /></div>
      ) : error && !data ? (
        <div className="border-t border-slate-100 px-6 py-8 text-center"><p className="text-sm text-rose-600">{error}</p><button type="button" onClick={() => load()} className="mt-3 rounded-full border border-slate-200 px-3.5 py-2 text-xs font-semibold text-slate-700">Try again</button></div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2 border-t border-slate-200/80 bg-slate-50/35 px-6 py-5">
            <Metric label="Total billed" value={money(summary.totalCharges, data?.currency)} />
            <Metric label="Payments received" value={money(summary.totalPayments, data?.currency)} tone="text-emerald-700" />
            <Metric label="Refunded" value={money(summary.totalRefunds, data?.currency)} tone="text-rose-700" />
            <Metric label="Outstanding" value={money(summary.closingBalance, data?.currency)} tone={Number(summary.closingBalance) > 0 ? "text-amber-700" : "text-slate-950"} />
          </div>

          {data?.syncWarning ? <p className="mx-6 mb-4 rounded-2xl bg-amber-50 px-3.5 py-3 text-xs leading-5 text-amber-800">{data.syncWarning}</p> : null}
          {error ? <p className="mx-6 mb-4 rounded-2xl bg-rose-50 px-3.5 py-3 text-xs text-rose-700">{error}</p> : null}

          <div className="border-t border-slate-200/80">
            <div className="flex items-center justify-between px-6 py-3">
              <p className="text-[11px] font-bold uppercase tracking-[0.15em] text-slate-500">Recent activity</p>
              {data?.sourceCounts ? <p className="text-[11px] text-slate-500">{data.sourceCounts.appointments} appointment · {data.sourceCounts.caseInvoices} case invoice</p> : null}
            </div>
            {recent.length ? (
              <div className="divide-y divide-slate-100">
                {recent.map((item) => {
                  const meta = TYPE_META[item.type] || TYPE_META.Adjustment;
                  const Icon = meta.Icon;
                  return (
                    <div key={item.id} className="flex items-center gap-3 px-6 py-3.5">
                      <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-xl ${meta.tone}`}><Icon className="h-3.5 w-3.5" /></div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2"><p className="truncate text-xs font-semibold text-slate-800">{item.type}</p><span className="truncate text-[11px] text-slate-500">{item.reference}</span></div>
                        <p className="mt-0.5 truncate text-[11px] text-slate-500">{item.description}</p>
                      </div>
                      <div className="shrink-0 text-right">
                        <p className={`text-xs font-semibold tabular-nums ${item.type === "Refund" ? "text-rose-700" : item.type === "Payment" || item.type === "Credit" ? "text-emerald-700" : "text-slate-800"}`}>{meta.prefix}{money(meta.amount(item), data?.currency)}</p>
                        <p className="mt-0.5 text-[11px] text-slate-500">{date(item.date)}</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="px-6 pb-7 pt-3 text-center"><FileText className="mx-auto h-5 w-5 text-slate-300" /><p className="mt-2 text-xs text-slate-400">No billing activity yet.</p></div>
            )}
          </div>
        </>
      )}
      {canRecord ? <ClientManualBillingEntrySheet open={entryOpen} clientId={clientId} clientName={clientName || data?.client?.fullName || "Client"} initialMode={entryPreset?.mode} initialPaymentType={entryPreset?.paymentType} initialCaseId={entryPreset?.caseId} onClose={() => { setEntryOpen(false); setEntryPreset(null); }} onSaved={async (result) => {
        await load({ quiet: true });
        if (!result?.paymentWarning && entryPreset?.afterSave) await onEntrySaved?.(result, entryPreset);
      }} /> : null}
    </article>
  );
}
