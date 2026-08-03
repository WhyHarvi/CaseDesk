import { ArrowDownLeft, ArrowUpRight, Banknote, CalendarClock, CircleAlert, CreditCard, Download, FileText, Landmark, Loader2, ReceiptText, RotateCcw, Wallet } from "lucide-react";
import { useEffect, useState } from "react";
import { downloadPortalInvoicePdf, getPortalPayments, portalErrorMessage } from "../../api/clientPortalApi";
import ClientPortalHeader from "../../components/client-portal/ClientPortalHeader";
import ClientPortalSkeleton, { GlassCard } from "../../components/client-portal/ClientPortalSkeleton";
import ClientPortalEmptyState from "../../components/client-portal/ClientPortalEmptyState";
import ClientPaymentCard, { formatMoney } from "../../components/client-portal/ClientPaymentCard";
import { usePortalData } from "../../components/client-portal/ClientPortalLayout";
import { formatPortalDate } from "../../components/client-portal/ClientStatusCard";

const INVOICE_STATUS_LABEL = { Open: "Awaiting payment", PartiallyPaid: "Partially paid", Paid: "Paid", Overdue: "Overdue" };
const INVOICE_STATUS_TONE = {
  Open: "bg-slate-100 text-slate-600",
  PartiallyPaid: "bg-amber-50 text-amber-700",
  Paid: "bg-emerald-50 text-emerald-700",
  Overdue: "bg-rose-50 text-rose-700",
};
const INVOICE_TYPE_LABEL = { fees: "Professional fees", disbursement: "Government fee" };

function formatPortalMoney(value) {
  return Number(value).toLocaleString("en-CA", { style: "currency", currency: "CAD" });
}

function InvoiceDownloadButton({ invoice }) {
  const [downloading, setDownloading] = useState(false);

  async function download() {
    setDownloading(true);
    try {
      await downloadPortalInvoicePdf(invoice.id, `Invoice-${invoice.invoiceNumber || invoice.id.slice(0, 8)}.pdf`);
    } catch {
      // silent — the invoice itself is still visible and payable, a failed download is non-blocking
    } finally {
      setDownloading(false);
    }
  }

  return (
    <button
      type="button"
      onClick={download}
      disabled={downloading}
      aria-label="Download invoice PDF"
      title="Download PDF"
      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 disabled:opacity-50"
    >
      {downloading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
    </button>
  );
}

function scheduleDueLabel(installment) {
  if (installment.triggerType === "Stage") return `Due when your case reaches: ${installment.triggerStage}`;
  if (installment.triggerDaysAfterSigning === 0) return "Due on signing";
  return `Due ${installment.triggerDaysAfterSigning} day${installment.triggerDaysAfterSigning === 1 ? "" : "s"} after signing`;
}

const TRANSACTION_STYLE = {
  Invoice: { icon: ArrowUpRight, tone: "bg-amber-100 text-amber-700", amountTone: "text-slate-900" },
  Payment: { icon: ArrowDownLeft, tone: "bg-emerald-100 text-emerald-700", amountTone: "text-emerald-700" },
  Refund: { icon: RotateCcw, tone: "bg-rose-100 text-rose-700", amountTone: "text-rose-700" },
  Credit: { icon: ArrowDownLeft, tone: "bg-sky-100 text-sky-700", amountTone: "text-sky-700" },
  Adjustment: { icon: ReceiptText, tone: "bg-slate-100 text-slate-600", amountTone: "text-slate-700" },
};

function transactionAmount(item) {
  if (item.type === "Invoice") return { value: item.charge, prefix: "+" };
  if (item.type === "Refund") return { value: item.refund, prefix: "−" };
  return { value: item.paymentOrCredit || item.charge, prefix: "−" };
}

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

          {data.syncWarning ? (
            <div className="flex items-start gap-2 rounded-2xl border border-amber-200/70 bg-amber-50 px-4 py-3 text-[12px] leading-5 text-amber-800">
              <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />{data.syncWarning}
            </div>
          ) : null}

          {data.schedule?.installments?.some((item) => item.status === "Scheduled") ? (
            <GlassCard className="p-5">
              <div className="flex items-center gap-2.5">
                <div className="flex h-9 w-9 items-center justify-center rounded-2xl bg-fuchsia-100 text-fuchsia-700"><CalendarClock className="h-4 w-4" /></div>
                <h2 className="text-[15px] font-semibold text-slate-900">Upcoming payments</h2>
              </div>
              <p className="mt-2 text-[12px] leading-5 text-slate-500">Your agency's full payment plan for this case. Each item becomes an invoice once it's due.</p>
              <ul className="mt-3 divide-y divide-slate-100">
                {data.schedule.installments
                  .filter((item) => item.status === "Scheduled")
                  .map((item) => (
                    <li key={item.id} className="flex items-start justify-between gap-3 py-3.5 first:pt-1 last:pb-1">
                      <div className="flex min-w-0 items-start gap-2.5">
                        <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-500">
                          {item.paymentType === "disbursement" ? <Landmark className="h-3.5 w-3.5" /> : <Banknote className="h-3.5 w-3.5" />}
                        </div>
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold text-slate-900">{item.label}</p>
                          <p className="mt-0.5 text-[12px] text-slate-500">{INVOICE_TYPE_LABEL[item.paymentType] || item.paymentType} · {formatPortalMoney(item.amount)}</p>
                          <p className="mt-1 text-[11px] text-slate-400">{scheduleDueLabel(item)}</p>
                        </div>
                      </div>
                      <span className="shrink-0 rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-semibold text-slate-500">Not yet invoiced</span>
                    </li>
                  ))}
              </ul>
            </GlassCard>
          ) : null}

          {data.invoices?.length ? (
            <GlassCard className="p-5">
              <div className="flex items-center gap-2.5">
                <div className="flex h-9 w-9 items-center justify-center rounded-2xl bg-emerald-100 text-emerald-700"><FileText className="h-4 w-4" /></div>
                <h2 className="text-[15px] font-semibold text-slate-900">Invoices</h2>
              </div>
              <ul className="mt-4 divide-y divide-slate-100">
                {data.invoices.map((invoice) => (
                  <li key={invoice.id} className="flex items-start justify-between gap-3 py-3.5 first:pt-1 last:pb-1">
                    <div className="flex min-w-0 items-start gap-2.5">
                      <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-500">
                        {invoice.paymentType === "disbursement" ? <Landmark className="h-3.5 w-3.5" /> : <Banknote className="h-3.5 w-3.5" />}
                      </div>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-slate-900">{invoice.description}</p>
                        <p className="mt-0.5 text-[12px] text-slate-500">
                          {INVOICE_TYPE_LABEL[invoice.paymentType] || invoice.paymentType}
                          {invoice.invoiceNumber ? ` · #${invoice.invoiceNumber}` : ""}
                        </p>
                        <p className="mt-1 text-[12px] text-slate-500">
                          {formatPortalMoney(invoice.amount)} total
                          {Number(invoice.balance) > 0 ? ` · ${formatPortalMoney(invoice.balance)} due` : ""}
                        </p>
                        {invoice.dueDate ? <p className="mt-1 text-[11px] text-slate-400">Due {formatPortalDate(invoice.dueDate)}</p> : null}
                        {invoice.payNowUrl ? (
                          <a
                            href={invoice.payNowUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-slate-950 px-3 py-1.5 text-[11px] font-semibold text-white transition hover:bg-slate-800"
                          >
                            <Wallet className="h-3 w-3" /> Pay now
                          </a>
                        ) : null}
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-1.5">
                      <span className={["rounded-full px-2.5 py-1 text-[10px] font-semibold", INVOICE_STATUS_TONE[invoice.status] || "bg-slate-100 text-slate-500"].join(" ")}>
                        {INVOICE_STATUS_LABEL[invoice.status] || invoice.status}
                      </span>
                      <InvoiceDownloadButton invoice={invoice} />
                    </div>
                  </li>
                ))}
              </ul>
            </GlassCard>
          ) : null}

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
            {data.transactions?.length ? (
              <ul className="mt-4 divide-y divide-slate-100">
                {data.transactions.map((item) => {
                  const style = TRANSACTION_STYLE[item.type] || TRANSACTION_STYLE.Adjustment;
                  const Icon = style.icon;
                  const amount = transactionAmount(item);
                  return (
                  <li key={item.id} className="flex items-start justify-between gap-3 py-3.5 first:pt-1 last:pb-1">
                    <div className="flex min-w-0 items-start gap-2.5">
                      <div className={["mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl", style.tone].join(" ")}><Icon className="h-3.5 w-3.5" /></div>
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <p className="text-sm font-semibold text-slate-900">{item.type}</p>
                          <span className="text-[10px] font-medium text-slate-400">{item.reference}</span>
                        </div>
                        <p className="mt-0.5 text-[12px] leading-5 text-slate-500">{item.description}</p>
                        <p className="mt-1 text-[11px] text-slate-400">
                          {formatPortalDate(item.date)}{item.caseReference ? ` · ${item.caseReference}` : ""}
                        </p>
                      </div>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className={["text-sm font-semibold tabular-nums", style.amountTone].join(" ")}>{amount.prefix}{formatMoney(amount.value, data.summary.currency)}</p>
                      <p className="mt-1 text-[10px] text-slate-400">Balance {formatMoney(item.runningBalance, data.summary.currency)}</p>
                    </div>
                  </li>
                  );
                })}
              </ul>
            ) : (
              <p className="mt-3 text-sm leading-6 text-slate-500">No payments have been recorded yet. Your history will appear here.</p>
            )}
          </GlassCard>

          <p className="flex items-start gap-2 px-2 text-[12px] leading-5 text-slate-400">
            <CreditCard className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            This account history includes case fees, consultation payments, credits, and refunds. If something looks wrong, contact your agency in Chat.
          </p>
        </>
      )}
    </div>
  );
}
