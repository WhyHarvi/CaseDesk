import { ArrowDownLeft, ArrowRight, ArrowUpRight, Banknote, CalendarClock, Check, CheckCircle2, ChevronRight, CircleAlert, CreditCard, Download, FileText, Landmark, Loader2, ReceiptText, RotateCcw, Smartphone, Upload, Wallet } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { choosePortalInvoicePaymentMethod, downloadPortalInvoicePdf, getPortalPayments, portalErrorMessage } from "../../api/clientPortalApi";
import ClientPortalHeader from "../../components/client-portal/ClientPortalHeader";
import ClientPortalSkeleton from "../../components/client-portal/ClientPortalSkeleton";
import ClientPortalEmptyState from "../../components/client-portal/ClientPortalEmptyState";
import { formatMoney } from "../../components/client-portal/ClientPaymentCard";
import { usePortalData } from "../../components/client-portal/ClientPortalLayout";
import { formatPortalDate } from "../../components/client-portal/ClientStatusCard";

const INVOICE_STATUS_LABEL = { Open: "Awaiting payment", PartiallyPaid: "Partially paid", Paid: "Paid", Refunded: "Refunded", PartiallyRefunded: "Partially refunded", Overdue: "Overdue", AwaitingPaymentMethod: "Choose payment method" };
const INVOICE_STATUS_TONE = {
  Paid: "border-slate-950 bg-slate-950 text-white",
  Overdue: "border-[#002FA7] bg-[#002FA7] text-white",
  AwaitingPaymentMethod: "border-[#002FA7] text-[#002FA7]",
};
const INVOICE_TYPE_LABEL = { fees: "Professional fees", disbursement: "Government fee" };

const PAYMENT_METHOD_ROWS = [
  { value: "bankTransfer", label: "Bank transfer", copy: "Continue to secure QuickBooks checkout", icon: Wallet, online: true },
  { value: "card", label: "Credit card", copy: "A credit card surcharge is included before QuickBooks opens", icon: CreditCard, online: true },
  { value: "interac", label: "Interac e-Transfer", copy: "Send to your agency, then share confirmation", icon: Smartphone },
  { value: "debit", label: "Debit card", copy: "Share your receipt or transaction number", icon: CreditCard },
  { value: "other", label: "Other payment method", copy: "Cheque, wire, bank draft, or an arrangement", icon: Landmark },
];

function Frame({ children, className = "" }) {
  return <section className={`border border-slate-200 bg-white shadow-none ${className}`}>{children}</section>;
}

function PaymentSummary({ payment }) {
  if (!payment) return null;
  const hasFee = payment.status !== "No Fee Recorded";
  return (
    <Frame>
      <div className="grid grid-cols-[2.75rem_1fr] border-b border-slate-200">
        <div className="flex items-center justify-center border-r border-slate-200 text-xs font-bold tabular-nums text-[#002FA7]">01</div>
        <div className="px-4 py-4 sm:px-5">
          <p className="text-xs font-semibold text-slate-500">Current balance</p>
          <div className="mt-1 flex flex-wrap items-end justify-between gap-2">
            <p className="text-[2rem] font-semibold leading-none tracking-[-0.05em] tabular-nums text-slate-950 sm:text-4xl">{hasFee ? formatMoney(payment.balance, payment.currency) : "No fees yet"}</p>
            <span className="border border-slate-300 px-2 py-1 text-[10px] font-semibold text-slate-600">{payment.status}</span>
          </div>
        </div>
      </div>
      {hasFee ? (
        <div className="grid grid-cols-2 divide-x divide-slate-200">
          <div className="px-4 py-3 sm:px-5"><p className="text-[11px] text-slate-500">Total fees</p><p className="mt-0.5 text-sm font-semibold tabular-nums text-slate-950">{formatMoney(payment.totalFee, payment.currency)}</p></div>
          <div className="px-4 py-3 sm:px-5"><p className="text-[11px] text-slate-500">Paid so far</p><p className="mt-0.5 text-sm font-semibold tabular-nums text-[#002FA7]">{formatMoney(payment.paidAmount, payment.currency)}</p></div>
        </div>
      ) : <p className="px-4 py-4 text-sm leading-6 text-slate-600 sm:px-5">Your agency has not recorded any fees for your file yet.</p>}
    </Frame>
  );
}

function ChoosePaymentMethod({ invoice, surchargeRates, instructions, currency, onChosen, onCancel = null }) {
  const [method, setMethod] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [reference, setReference] = useState("");
  const [screenshot, setScreenshot] = useState(null);
  const [error, setError] = useState("");
  // The current balance may already contain the previously selected method's
  // processing fee. Every choice must instead preview from the invoice's
  // immutable subtotal + tax - discount base so switching never compounds it.
  const base = Number(invoice.baseAmount ?? invoice.balance);
  const cardTotal = base * (1 + Number(surchargeRates?.cardSurchargeRatePercent || 0) / 100);
  const bankTotal = base * (1 + Number(surchargeRates?.bankTransferFeeRatePercent || 0) / 100);

  function toggleManual(value) {
    setMethod((current) => current === value ? null : value);
    setReference("");
    setScreenshot(null);
    setError("");
  }

  async function chooseOnline(value) {
    setMethod(value);
    setSubmitting(true);
    setError("");
    try {
      await choosePortalInvoicePaymentMethod(invoice.id, value);
      await onChosen();
    } catch (reason) {
      setError(portalErrorMessage(reason, "That payment method could not be saved. Please try again."));
      setMethod(null);
    } finally {
      setSubmitting(false);
    }
  }

  async function submitManual(event) {
    event.preventDefault();
    if (!reference.trim() && !screenshot) {
      setError("Enter a payment reference or attach a payment screenshot.");
      return;
    }
    setSubmitting(true);
    setError("");
    try {
      await choosePortalInvoicePaymentMethod(invoice.id, method, { reference: reference.trim(), screenshot });
      await onChosen();
    } catch (reason) {
      setError(portalErrorMessage(reason, "Your payment details could not be submitted. Please try again."));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mt-5 border border-slate-300 bg-white">
      <div className="border-b border-slate-300 px-4 py-4">
        <div className="flex items-center justify-between gap-3">
          <p className="text-base font-semibold tracking-tight text-slate-950">{onCancel ? "Choose another payment method" : "Choose payment method"}</p>
          {onCancel ? <button type="button" onClick={onCancel} disabled={submitting} className="min-h-11 shrink-0 border border-slate-300 px-3 text-xs font-semibold text-slate-700 transition hover:border-[#002FA7] hover:text-[#002FA7] disabled:opacity-50">Keep current method</button> : null}
        </div>
        <p className="mt-1 text-xs leading-5 text-slate-600">Online options open checkout. Interac, debit, and other methods are confirmed after you submit proof.</p>
        <div className="mt-3 flex min-h-11 items-center justify-between gap-3 border border-slate-200 bg-[#F7F7F8] px-3">
          <span className="text-[11px] font-medium text-slate-600">Fixed invoice amount</span>
          <span className="text-sm font-semibold tabular-nums text-slate-950">{formatMoney(base, currency)}</span>
        </div>
        {onCancel ? <p className="mt-2 text-[11px] leading-4 text-slate-500">Choosing another method replaces the current processing fee. It is never added on top of the current total.</p> : null}
      </div>
      <div className="divide-y divide-slate-300">
        {PAYMENT_METHOD_ROWS.map((item, index) => {
          const Icon = item.icon;
          const total = item.value === "card" ? cardTotal : item.value === "bankTransfer" ? bankTotal : base;
          const selected = method === item.value;
          return (
            <div key={item.value} className={selected ? "bg-[#F7F7F8]" : "bg-white"}>
              <button
                type="button"
                disabled={submitting}
                aria-pressed={selected}
                onClick={() => item.value === "card" ? toggleManual(item.value) : item.online ? chooseOnline(item.value) : toggleManual(item.value)}
                className="grid min-h-[76px] w-full grid-cols-[2rem_1fr_auto] items-center gap-3 px-3 py-3 text-left transition-colors hover:bg-[#F7F7F8] disabled:cursor-wait disabled:opacity-60 sm:grid-cols-[2.5rem_2.5rem_1fr_auto] sm:px-4"
              >
                <span className="hidden text-[10px] font-bold tabular-nums text-slate-400 sm:block">{String(index + 1).padStart(2, "0")}</span>
                <span className={`flex h-8 w-8 items-center justify-center border ${selected ? "border-[#002FA7] bg-[#002FA7] text-white" : "border-slate-300 text-[#002FA7]"}`}>{submitting && selected ? <Loader2 className="h-4 w-4 animate-spin" /> : <Icon className="h-4 w-4" />}</span>
                <span className="min-w-0"><span className="block text-sm font-semibold text-slate-950">{item.label}</span><span className="mt-0.5 block text-[11px] leading-4 text-slate-500">{item.copy}</span></span>
                <span className="flex items-center gap-2 text-right">
                  <span><span className="block text-sm font-semibold tabular-nums text-slate-950">{formatMoney(total, currency)}</span><span className="mt-0.5 block text-[10px] text-slate-500">{item.online && total > base ? "Fee included" : "No added fee"}</span></span>
                  {item.online ? <ArrowRight className="hidden h-4 w-4 text-[#002FA7] sm:block" /> : selected ? <Check className="hidden h-4 w-4 text-[#002FA7] sm:block" /> : <ChevronRight className="hidden h-4 w-4 text-slate-400 sm:block" />}
                </span>
              </button>
              {selected && item.value === "card" ? (
                <div className="border-t border-slate-300 bg-[#F7F7F8] p-4 sm:ml-[4.5rem] sm:border-l sm:px-5">
                  <div className="flex items-start gap-3 border-l-2 border-[#002FA7] pl-3">
                    <CircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-[#002FA7]" />
                    <div>
                      <p className="text-xs font-semibold text-slate-950">Confirm you will pay by credit card</p>
                      <p className="mt-1 text-[11px] leading-5 text-slate-600">QuickBooks may also display Debit or Apple Pay. The {formatMoney(total, currency)} total already includes a {formatMoney(total - base, currency)} credit card surcharge, and choosing another method inside QuickBooks will not remove it.</p>
                      <p className="mt-1 text-[11px] font-medium leading-5 text-slate-700">To pay by debit without this surcharge, choose Debit card below instead.</p>
                    </div>
                  </div>
                  <div className="mt-4 grid gap-2 sm:grid-cols-[auto_auto] sm:justify-start">
                    <button type="button" onClick={() => chooseOnline("card")} disabled={submitting} className="inline-flex min-h-12 items-center justify-center gap-2 bg-[#002FA7] px-5 text-sm font-semibold text-white transition hover:opacity-90 disabled:cursor-wait disabled:opacity-50">{submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <CreditCard className="h-4 w-4" />} Continue with credit card · {formatMoney(total, currency)}</button>
                    <button type="button" onClick={() => toggleManual("debit")} disabled={submitting} className="min-h-12 border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-800 transition hover:border-[#002FA7] hover:text-[#002FA7] disabled:opacity-50">Choose debit instead</button>
                  </div>
                </div>
              ) : null}
              {selected && !item.online ? (
                <form onSubmit={submitManual} className="border-t border-slate-300 bg-[#F7F7F8] p-4 sm:ml-[4.5rem] sm:border-l sm:px-5">
                  {item.value === "interac" && instructions ? <div className="mb-4 border-l-2 border-[#002FA7] pl-3"><p className="whitespace-pre-wrap text-xs leading-5 text-slate-700">{instructions}</p></div> : null}
                  <label className="block text-xs font-semibold text-slate-800">
                    {item.value === "interac" ? "Interac confirmation number" : item.value === "other" ? "Payment method or reference" : "Transaction or receipt number"}
                    <input value={reference} maxLength={160} onChange={(event) => setReference(event.target.value)} placeholder="Enter the number shown on your receipt" className="mt-2 h-12 w-full border border-slate-400 bg-white px-3.5 text-sm text-slate-950 outline-none transition focus:border-[#002FA7] focus:ring-2 focus:ring-[#002FA7]/15" />
                  </label>
                  <div className="my-3 flex items-center gap-3 text-[10px] font-semibold text-slate-400"><span className="h-px flex-1 bg-slate-300" />OR<span className="h-px flex-1 bg-slate-300" /></div>
                  <label className="flex min-h-12 cursor-pointer items-center gap-3 border border-dashed border-slate-400 bg-white px-3.5 py-3 text-xs font-medium text-slate-700 transition hover:border-[#002FA7]">
                    <Upload className="h-4 w-4 shrink-0 text-[#002FA7]" /><span className="min-w-0 truncate">{screenshot?.name || "Attach payment screenshot"}</span>
                    <input type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" onChange={(event) => setScreenshot(event.target.files?.[0] || null)} />
                  </label>
                  <p className="mt-1.5 text-[10px] text-slate-500">JPG, PNG, or WebP · Maximum 5 MB</p>
                  <button type="submit" disabled={submitting || (!reference.trim() && !screenshot)} className="mt-4 inline-flex h-12 w-full items-center justify-center gap-2 bg-[#002FA7] px-5 text-sm font-semibold text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40 sm:w-auto">{submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />} Submit for confirmation</button>
                </form>
              ) : null}
            </div>
          );
        })}
      </div>
      {error ? <p role="alert" className="border-t border-rose-300 bg-rose-50 px-4 py-3 text-xs font-medium leading-5 text-rose-700">{error}</p> : null}
    </div>
  );
}

function InvoiceDownloadButton({ invoice }) {
  const [downloading, setDownloading] = useState(false);
  async function download() {
    setDownloading(true);
    try { await downloadPortalInvoicePdf(invoice.id, `Invoice-${invoice.invoiceNumber || invoice.id.slice(0, 8)}.pdf`); } catch { /* non-blocking */ } finally { setDownloading(false); }
  }
  return <button type="button" onClick={download} disabled={downloading} aria-label="Download invoice PDF" className="flex h-11 w-11 items-center justify-center border border-slate-300 text-slate-600 transition hover:border-[#002FA7] hover:text-[#002FA7] disabled:opacity-50">{downloading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}</button>;
}

function scheduleDueLabel(installment) {
  if (installment.triggerType === "Stage") return `Due when your case reaches ${installment.triggerStage}`;
  if (installment.triggerDaysAfterSigning === 0) return "Due on signing";
  return `Due ${installment.triggerDaysAfterSigning} day${installment.triggerDaysAfterSigning === 1 ? "" : "s"} after signing`;
}

const TRANSACTION_ICON = { Invoice: ArrowUpRight, Payment: ArrowDownLeft, Refund: RotateCcw, Credit: ArrowDownLeft, Adjustment: ReceiptText };
function transactionAmount(item) {
  if (item.type === "Invoice") return { value: item.charge, prefix: "+" };
  if (item.type === "Refund") return { value: item.refund, prefix: "−" };
  return { value: item.paymentOrCredit || item.charge, prefix: "−" };
}

function SectionHeading({ number, icon: Icon, title, copy }) {
  return <div className="grid grid-cols-[2.75rem_1fr] border-b border-slate-200"><div className="flex items-center justify-center border-r border-slate-200 text-xs font-bold tabular-nums text-[#002FA7]">{number}</div><div className="flex items-start gap-3 px-4 py-4 sm:px-5"><Icon className="mt-0.5 h-4 w-4 shrink-0 text-[#002FA7]" /><div><h2 className="text-sm font-semibold text-slate-950">{title}</h2>{copy ? <p className="mt-1 text-xs leading-5 text-slate-500">{copy}</p> : null}</div></div></div>;
}

export default function ClientPortalPayments() {
  const { overview } = usePortalData();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [changingInvoiceId, setChangingInvoiceId] = useState(null);
  const load = useCallback(() => getPortalPayments().then((result) => { setData(result); setError(""); }).catch((reason) => setError(portalErrorMessage(reason, "Your payment details could not be loaded."))).finally(() => setLoading(false)), []);
  useEffect(() => { load(); }, [load]);
  if (loading) return <ClientPortalSkeleton rows={3} />;

  const currency = data?.summary?.currency || "CAD";
  const invoices = [...(data?.invoices || [])].sort((left, right) => Number(right.status === "AwaitingPaymentMethod") - Number(left.status === "AwaitingPaymentMethod"));
  const scheduled = data?.schedule?.installments?.filter((item) => item.status === "Scheduled") || [];

  return (
    <div className="space-y-4 font-sans">
      <ClientPortalHeader title="Payments" subtitle="Fees, invoices, and payment history" client={overview?.client} agency={overview?.agency} />
      {error ? <ClientPortalEmptyState icon={CircleAlert} title="We couldn't load your payments" copy={error} /> : (
        <>
          <PaymentSummary payment={data.summary} />
          {data.syncWarning ? <div className="flex items-start gap-3 border border-amber-300 bg-white px-4 py-3 text-xs leading-5 text-slate-700"><CircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" />{data.syncWarning}</div> : null}

          {invoices.length ? <Frame><SectionHeading number="02" icon={FileText} title="Invoices" copy="Choose a payment method or review completed invoices." /><div className="divide-y divide-slate-300">{invoices.map((invoice) => (
            <article key={invoice.id} className="p-4 sm:p-5">
              <div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">{INVOICE_TYPE_LABEL[invoice.paymentType] || invoice.paymentType}{invoice.invoiceNumber ? ` · ${invoice.invoiceNumber}` : ""}</p><h3 className="mt-1.5 text-base font-semibold leading-6 text-slate-950">{invoice.description}</h3></div><span className={`shrink-0 border px-2 py-1 text-[10px] font-semibold ${INVOICE_STATUS_TONE[invoice.status] || "border-slate-300 text-slate-600"}`}>{INVOICE_STATUS_LABEL[invoice.status] || invoice.status}</span></div>
              <div className="mt-4 grid grid-cols-2 border-y border-slate-200 sm:grid-cols-3"><div className="py-3 pr-3"><p className="text-[10px] text-slate-500">Amount</p><p className="mt-0.5 text-sm font-semibold tabular-nums text-slate-950">{formatMoney(invoice.amount, currency)}</p></div><div className="border-l border-slate-200 px-3 py-3"><p className="text-[10px] text-slate-500">Balance due</p><p className="mt-0.5 text-sm font-semibold tabular-nums text-[#002FA7]">{formatMoney(invoice.balance, currency)}</p></div><div className="col-span-2 border-t border-slate-200 py-3 sm:col-span-1 sm:border-l sm:border-t-0 sm:pl-3"><p className="text-[10px] text-slate-500">Due date</p><p className="mt-0.5 text-sm font-semibold text-slate-950">{invoice.dueDate ? formatPortalDate(invoice.dueDate) : "Not specified"}</p></div></div>
              {Number(invoice.refundedAmount) > 0 ? <p className="mt-3 text-xs font-medium text-slate-700">{formatMoney(invoice.refundedAmount, currency)} refunded</p> : null}
              {invoice.status === "AwaitingPaymentMethod" || changingInvoiceId === invoice.id ? <ChoosePaymentMethod invoice={invoice} surchargeRates={data.surchargeRates} instructions={data.instructions} currency={currency} onChosen={async () => { setChangingInvoiceId(null); await load(); }} onCancel={invoice.status === "AwaitingPaymentMethod" ? null : () => setChangingInvoiceId(null)} /> : null}
              {invoice.paymentSubmission ? <div className="mt-4 border-l-2 border-[#002FA7] bg-[#F7F7F8] px-3 py-3"><p className="flex items-center gap-2 text-xs font-semibold text-slate-950"><CheckCircle2 className="h-4 w-4 text-[#002FA7]" />Payment submitted for confirmation</p><p className="mt-1 text-[11px] leading-5 text-slate-600">Your balance updates after your agency confirms the payment.{invoice.paymentSubmission.reference ? ` Reference: ${invoice.paymentSubmission.reference}` : ""}</p></div> : null}
              {invoice.payNowUrl && Number(invoice.cardSurchargeAmount) > 0 && changingInvoiceId !== invoice.id ? <div className="mt-4 border border-[#002FA7] bg-[#F7F7F8] px-3 py-3"><p className="flex items-center gap-2 text-xs font-semibold text-slate-950"><CircleAlert className="h-4 w-4 shrink-0 text-[#002FA7]" />Credit card surcharge included</p><p className="mt-1 text-[11px] leading-5 text-slate-600">This balance includes a {formatMoney(invoice.cardSurchargeAmount, currency)} credit card surcharge. QuickBooks may also show Debit or Apple Pay, but selecting them there will not remove this fee. To pay by debit without the surcharge, choose Change payment method before paying.</p></div> : null}
              {invoice.status !== "AwaitingPaymentMethod" && changingInvoiceId !== invoice.id ? <div className="mt-4 grid grid-cols-[1fr_auto] gap-2 sm:flex">{invoice.payNowUrl ? <a href={invoice.payNowUrl} target="_blank" rel="noopener noreferrer" className="inline-flex h-11 items-center justify-center gap-2 bg-[#002FA7] px-4 text-sm font-semibold text-white"><Wallet className="h-4 w-4" />Pay now</a> : null}<InvoiceDownloadButton invoice={invoice} />{invoice.canChangePaymentMethod ? <button type="button" onClick={() => setChangingInvoiceId(invoice.id)} className="col-span-2 inline-flex min-h-12 w-full items-center justify-between border border-slate-300 bg-white px-4 text-left text-sm font-semibold text-slate-800 transition hover:border-[#002FA7] hover:text-[#002FA7] sm:ml-auto sm:min-h-11 sm:w-auto sm:gap-3"><span>Change payment method</span><ArrowRight className="h-4 w-4" /></button> : null}</div> : null}
            </article>
          ))}</div></Frame> : null}

          {scheduled.length ? <Frame><SectionHeading number="03" icon={CalendarClock} title="Upcoming payments" copy="These become invoices when they are due." /><ul className="divide-y divide-slate-200">{scheduled.map((item) => <li key={item.id} className="grid grid-cols-[2rem_1fr_auto] gap-3 px-4 py-4 sm:px-5"><span className="flex h-8 w-8 items-center justify-center border border-slate-300 text-[#002FA7]">{item.paymentType === "disbursement" ? <Landmark className="h-4 w-4" /> : <Banknote className="h-4 w-4" />}</span><div className="min-w-0"><p className="text-sm font-semibold text-slate-950">{item.label}</p><p className="mt-1 text-[11px] leading-4 text-slate-500">{scheduleDueLabel(item)}</p></div><p className="text-sm font-semibold tabular-nums text-slate-950">{formatMoney(item.amount, currency)}</p></li>)}</ul></Frame> : null}

          {data.instructions ? <Frame><SectionHeading number="04" icon={Landmark} title="Payment instructions" /><p className="whitespace-pre-wrap px-4 py-4 text-sm leading-6 text-slate-700 sm:px-5">{data.instructions}</p></Frame> : null}

          <Frame><SectionHeading number="05" icon={ReceiptText} title="Payment history" copy="Invoices, payments, credits, and refunds." />{data.transactions?.length ? <ul className="divide-y divide-slate-200">{data.transactions.map((item) => {
            const Icon = TRANSACTION_ICON[item.type] || ReceiptText;
            const amount = transactionAmount(item);
            return <li key={item.id} className="grid grid-cols-[2rem_1fr_auto] gap-3 px-4 py-4 sm:px-5"><span className="flex h-8 w-8 items-center justify-center border border-slate-300 text-[#002FA7]"><Icon className="h-4 w-4" /></span><div className="min-w-0"><div className="flex flex-wrap items-center gap-x-2"><p className="text-sm font-semibold text-slate-950">{item.type}</p><span className="text-[10px] font-medium text-slate-500">{item.reference}</span></div><p className="mt-0.5 text-xs leading-5 text-slate-600">{item.description}</p><p className="mt-1 text-[10px] text-slate-500">{formatPortalDate(item.date)}{item.caseReference ? ` · ${item.caseReference}` : ""}</p></div><div className="text-right"><p className="text-sm font-semibold tabular-nums text-slate-950">{amount.prefix}{formatMoney(amount.value, currency)}</p><p className="mt-1 text-[10px] tabular-nums text-slate-500">Balance {formatMoney(item.runningBalance, currency)}</p></div></li>;
          })}</ul> : <p className="px-4 py-5 text-sm leading-6 text-slate-600 sm:px-5">No payments have been recorded yet.</p>}</Frame>

          <p className="flex items-start gap-2 px-1 pb-2 text-xs leading-5 text-slate-500"><CreditCard className="mt-0.5 h-4 w-4 shrink-0 text-[#002FA7]" />If something looks wrong, contact your agency in Chat.</p>
        </>
      )}
    </div>
  );
}
