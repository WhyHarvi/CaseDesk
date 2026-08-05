import { AnimatePresence, motion, useMotionValue, useSpring, useTransform } from "framer-motion";
import {
  Banknote,
  CalendarClock,
  Check,
  ChevronDown,
  ExternalLink,
  HandCoins,
  Landmark,
  Loader2,
  Mail,
  MessageSquare,
  Copy,
  RefreshCw,
  Search,
  ShieldAlert,
  TrendingUp,
  Wallet,
  X,
  Trash2,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { cancelBookingPaymentHoldRequest, getBookingPaymentHoldStatus, resendBookingPaymentHoldRequest } from "../api/bookingApi";
import {
  getConsultationRefundReview,
  getPaymentsOverview,
  getPaymentsOverviewSummary,
} from "../api/paymentsOverviewApi";

const money = new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD", minimumFractionDigits: 2 });
const moneyWhole = new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD", maximumFractionDigits: 0 });

function compactMoney(value) {
  if (Math.abs(value) >= 1000) return `$${(value / 1000).toFixed(value % 1000 === 0 ? 0 : 1)}K`;
  return `$${Math.round(value)}`;
}

const glass = "rounded-[1.6rem] border border-white/70 bg-white/70 shadow-[0_18px_50px_rgba(15,23,42,0.08)] backdrop-blur-2xl";
const spring = { type: "spring", stiffness: 320, damping: 30 };

function cx(...classes) {
  return classes.filter(Boolean).join(" ");
}

const STATUS_LABEL = { Open: "Open", PartiallyPaid: "Partially paid", Paid: "Paid", Refunded: "Refunded", Overdue: "Overdue", Voided: "Voided" };
const STATUS_TONE = {
  Open: "bg-slate-100 text-slate-600 ring-slate-200",
  PartiallyPaid: "bg-amber-50 text-amber-600 ring-amber-100",
  Paid: "bg-emerald-50 text-emerald-600 ring-emerald-100",
  Refunded: "bg-violet-50 text-violet-600 ring-violet-100",
  Overdue: "bg-rose-50 text-rose-600 ring-rose-100",
  Voided: "bg-slate-100 text-slate-400 ring-slate-200",
};
const STATUS_COLOR = { Paid: "#10B981", Refunded: "#8B5CF6", PartiallyPaid: "#F59E0B", Open: "#94A3B8", Overdue: "#F43F5E", Voided: "#CBD5E1" };
const SOURCE_LABEL = { case_invoice: "Case invoices", booking_payment: "Consultation bookings", legacy_payment: "Legacy retainers" };
const SOURCE_ROW_LABEL = { case_invoice: "Case invoice", booking_payment: "Consultation booking", legacy_payment: "Legacy retainer" };
const SOURCE_ICON = { case_invoice: Banknote, booking_payment: CalendarClock, legacy_payment: Landmark };
const SOURCE_COLOR = { case_invoice: "#0EA5E9", booking_payment: "#8B5CF6", legacy_payment: "#64748B" };
const ORPHANED_PAYMENT_RUNBOOK = [
  "Acknowledge the critical alert within 10 minutes.",
  "Confirm the payment in QuickBooks.",
  "If the original slot is available, create the appointment manually.",
  "If it is unavailable, contact the client and offer alternative times.",
  "If no suitable time is accepted, refund the payment in QuickBooks.",
  "Record the resolution in CaseDesk and close the critical notification.",
];

function formatDate(value) {
  if (!value) return "—";
  return new Date(value).toLocaleDateString("en-CA", { month: "short", day: "numeric", year: "numeric" });
}

// "What this payment is about" — a consultation-booking hold points at the
// appointment it paid for (once one exists; an AwaitingPayment hold has
// none yet), a case invoice/legacy retainer points at the case's billing
// tab, and anything without a case falls back to the client. Same
// resolution regardless of source, per the "click a payment, land on the
// exact thing it's for" ask.
function paymentLink(row) {
  if (row.source === "booking_payment") {
    if (["AwaitingPayment", "Confirming", "Expired", "Voided", "Failed"].includes(row.bookingStatus)) {
      return `/app/payments?source=booking_payment&hold=${encodeURIComponent(row.recordId)}`;
    }
    if (row.appointmentId) {
      const date = row.appointmentStartsAt ? new Date(row.appointmentStartsAt).toISOString().slice(0, 10) : "";
      return `/app/calendar?appointment=${row.appointmentId}${date ? `&date=${date}` : ""}`;
    }
    return row.clientId ? `/app/clients/${row.clientId}` : null;
  }
  if (row.source === "case_invoice" && row.caseId) {
    return `/app/cases/${row.caseId}?tab=billing&highlight=${row.recordId}`;
  }
  if (row.caseId) return `/app/cases/${row.caseId}?tab=billing`;
  return row.clientId ? `/app/clients/${row.clientId}` : null;
}

function PaymentHoldDrawer({ holdId, onClose, onChanged }) {
  const navigate = useNavigate();
  const [hold, setHold] = useState(null);
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let active = true;
    let timer;
    async function refresh() {
      try {
        const latest = await getBookingPaymentHoldStatus(holdId);
        if (!active) return;
        setHold(latest);
        setEmail((current) => current || latest.guestEmail || "");
        if (["AwaitingPayment", "Confirming"].includes(latest.status)) timer = window.setTimeout(refresh, 4000);
      } catch (reason) {
        if (active) setError(reason.response?.data?.message || "This payment reservation could not be loaded.");
      }
    }
    refresh();
    return () => { active = false; if (timer) window.clearTimeout(timer); };
  }, [holdId]);

  const emailDelivery = hold?.delivery?.find((item) => item.channel === "email") || null;
  const smsDelivery = hold?.delivery?.find((item) => item.channel === "sms") || null;
  const active = hold?.status === "AwaitingPayment";

  async function resend() {
    setBusy("resend"); setError("");
    try {
      const latest = await resendBookingPaymentHoldRequest(holdId, { email });
      setHold((current) => ({ ...current, ...latest }));
      setEmail(latest.guestEmail || email);
      onChanged?.();
    } catch (reason) { setError(reason.response?.data?.message || "The payment request could not be resent."); }
    finally { setBusy(""); }
  }

  async function cancel() {
    setBusy("cancel"); setError("");
    try {
      const latest = await cancelBookingPaymentHoldRequest(holdId);
      setHold((current) => ({ ...current, ...latest, payNowUrl: null }));
      setConfirmCancel(false);
      onChanged?.();
    } catch (reason) { setError(reason.response?.data?.message || "The payment request could not be cancelled."); }
    finally { setBusy(""); }
  }

  return (
    <div className="fixed inset-0 z-[420] flex justify-end bg-slate-950/25 backdrop-blur-[2px]" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <motion.aside initial={{ x: 70, opacity: 0 }} animate={{ x: 0, opacity: 1 }} exit={{ x: 70, opacity: 0 }} transition={spring} className="flex h-full w-full max-w-[440px] flex-col border-l border-white/70 bg-white/95 shadow-[-30px_0_90px_rgba(15,23,42,0.2)] backdrop-blur-2xl">
        <header className="flex items-center justify-between border-b border-slate-100 px-6 py-4"><div><p className="text-[10px] font-bold uppercase tracking-[0.15em] text-slate-400">Consultation payment</p><h2 className="mt-1 text-lg font-semibold text-slate-950">Payment reservation</h2></div><button type="button" onClick={onClose} aria-label="Close" className="flex h-9 w-9 items-center justify-center rounded-full text-slate-500 transition hover:bg-slate-100"><X className="h-5 w-5" /></button></header>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-6 py-5">
          {!hold && !error ? <div className="flex h-40 items-center justify-center"><Loader2 className="h-5 w-5 animate-spin text-slate-400" /></div> : null}
          {hold ? <>
            <div className={`rounded-2xl border p-4 ${hold.status === "Paid" ? "border-emerald-200 bg-emerald-50" : active || hold.status === "Confirming" ? "border-sky-200 bg-sky-50" : "border-amber-200 bg-amber-50"}`}>
              <p className="text-sm font-semibold text-slate-900">{hold.guestName}</p>
              <p className="mt-1 text-xs text-slate-500">{new Date(hold.startsAt).toLocaleString("en-CA", { dateStyle: "medium", timeStyle: "short" })}</p>
              <div className="mt-3 flex items-end justify-between"><span className="text-2xl font-semibold tracking-tight text-slate-950">{money.format(Number(hold.amount))}</span><span className="rounded-full bg-white/80 px-3 py-1 text-[11px] font-semibold text-slate-700 ring-1 ring-slate-200">{hold.status === "AwaitingPayment" ? "Awaiting payment" : hold.status}</span></div>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white p-4">
              <div className="flex items-center gap-2"><Mail className="h-4 w-4 text-slate-400" /><div className="min-w-0 flex-1"><p className="truncate text-xs font-semibold text-slate-700">{hold.guestEmail}</p><p className="text-[11px] text-slate-400">{emailDelivery?.status === "sent" ? `Sent${emailDelivery.sentAt ? ` ${new Date(emailDelivery.sentAt).toLocaleString("en-CA", { dateStyle: "medium", timeStyle: "short" })}` : ""}` : emailDelivery?.status === "failed" ? "Delivery failed" : emailDelivery?.lastError ? "Retrying after a delivery error…" : emailDelivery ? "Sending…" : "No delivery recorded"}</p></div><span className={`h-2.5 w-2.5 rounded-full ${emailDelivery?.status === "sent" ? "bg-emerald-500" : emailDelivery?.status === "failed" || !emailDelivery ? "bg-rose-500" : "animate-pulse bg-amber-400"}`} /></div>
              {emailDelivery?.lastError ? <p className="mt-3 rounded-xl bg-rose-50 px-3 py-2 text-[11px] leading-4 text-rose-600">{emailDelivery.lastError}</p> : null}
              {hold.guestPhone ? <div className="mt-3 flex items-center gap-2 border-t border-slate-100 pt-3"><MessageSquare className="h-4 w-4 text-slate-400" /><div className="min-w-0 flex-1"><p className="truncate text-xs font-semibold text-slate-700">{hold.guestPhone}</p><p className="text-[11px] text-slate-400">{smsDelivery?.status === "sent" ? "Payment SMS sent" : smsDelivery?.status === "failed" ? "SMS delivery failed" : smsDelivery?.lastError ? "Retrying SMS…" : smsDelivery ? "Sending payment SMS…" : "SMS not queued"}</p></div><span className={`h-2.5 w-2.5 rounded-full ${smsDelivery?.status === "sent" ? "bg-emerald-500" : smsDelivery?.status === "failed" || !smsDelivery ? "bg-slate-300" : "animate-pulse bg-amber-400"}`} /></div> : null}
              {active ? <><input type="email" value={email} onChange={(event) => setEmail(event.target.value.replace(/\s/g, ""))} className="mt-3 h-10 w-full rounded-xl border border-slate-200 px-3 text-sm outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-100" /><button type="button" disabled={Boolean(busy)} onClick={resend} className="mt-2 flex h-10 w-full items-center justify-center gap-1.5 rounded-full border border-slate-200 text-xs font-semibold text-slate-700 transition hover:border-sky-300 hover:bg-sky-50 disabled:opacity-50">{busy === "resend" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />} Resend payment request</button></> : null}
            </div>
            {hold.payNowUrl && active ? <button type="button" onClick={async () => { await navigator.clipboard.writeText(hold.payNowUrl); setCopied(true); window.setTimeout(() => setCopied(false), 1600); }} className="flex h-11 w-full items-center justify-center gap-2 rounded-full bg-slate-950 text-sm font-semibold text-white"><Copy className="h-4 w-4" /> {copied ? "Link copied" : "Copy payment link"}</button> : null}
            {hold.expiresAt ? <p className="text-center text-xs text-slate-400">{active ? "Slot held until" : "Reservation expired"} {new Date(hold.expiresAt).toLocaleString("en-CA", { dateStyle: "medium", timeStyle: "short" })}</p> : null}
            {hold.appointmentId ? <button type="button" onClick={() => navigate(`/app/calendar?appointment=${hold.appointmentId}&date=${new Date(hold.startsAt).toISOString().slice(0, 10)}`)} className="flex h-11 w-full items-center justify-center rounded-full border border-slate-200 text-sm font-semibold text-slate-700">Open appointment</button> : null}
            {active && !confirmCancel ? <button type="button" onClick={() => setConfirmCancel(true)} className="flex h-10 w-full items-center justify-center gap-1.5 rounded-full text-xs font-semibold text-rose-600 transition hover:bg-rose-50"><Trash2 className="h-3.5 w-3.5" /> Cancel payment request</button> : null}
            {active && confirmCancel ? <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4"><p className="text-sm font-semibold text-rose-900">Release this slot?</p><p className="mt-1 text-xs leading-5 text-rose-700">The QuickBooks invoice will be voided and the payment link will stop working.</p><div className="mt-3 flex gap-2"><button type="button" disabled={Boolean(busy)} onClick={() => setConfirmCancel(false)} className="h-9 flex-1 rounded-full bg-white text-xs font-semibold text-slate-600">Keep it</button><button type="button" disabled={Boolean(busy)} onClick={cancel} className="flex h-9 flex-1 items-center justify-center gap-1.5 rounded-full bg-rose-600 text-xs font-semibold text-white">{busy === "cancel" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null} Release slot</button></div></div> : null}
          </> : null}
          {error ? <p className="rounded-2xl bg-rose-50 px-4 py-3 text-sm leading-5 text-rose-700">{error}</p> : null}
        </div>
      </motion.aside>
    </div>
  );
}

function RefundReviewDrawer({ refundReceiptId, onClose }) {
  const navigate = useNavigate();
  const [review, setReview] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    setReview(null);
    setError("");
    getConsultationRefundReview(refundReceiptId)
      .then((data) => active && setReview(data))
      .catch((reason) => {
        if (active) {
          setError(
            reason.response?.data?.message ||
              "This refund could not be loaded from QuickBooks.",
          );
        }
      });
    return () => {
      active = false;
    };
  }, [refundReceiptId]);

  function openCandidate(candidate) {
    if (candidate.appointment?.id) {
      const date = candidate.appointment.startsAt
        ? new Date(candidate.appointment.startsAt).toISOString().slice(0, 10)
        : "";
      navigate(
        `/app/calendar?appointment=${encodeURIComponent(candidate.appointment.id)}${date ? `&date=${date}` : ""}`,
      );
      return;
    }
    navigate(
      `/app/payments?source=booking_payment&hold=${encodeURIComponent(candidate.id)}`,
      { replace: true },
    );
  }

  const stateCopy = {
    matched: {
      label: "Matched",
      className: "bg-emerald-100 text-emerald-700",
      message: "CaseDesk has linked this refund to the consultation payment shown below.",
    },
    possible_match: {
      label: "Review match",
      className: "bg-amber-100 text-amber-700",
      message: "One or more payments may relate to this refund. Compare the amount, client, and date before taking action.",
    },
    unmatched: {
      label: "Unmatched",
      className: "bg-rose-100 text-rose-700",
      message: "No CaseDesk consultation payment was found. The QuickBooks customer and payment trail are shown below so you can verify what happened.",
    },
  }[review?.state] || null;

  return (
    <div
      className="fixed inset-0 z-[420] flex justify-end bg-slate-950/25 backdrop-blur-[2px]"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <motion.aside
        initial={{ x: 70, opacity: 0 }}
        animate={{ x: 0, opacity: 1 }}
        exit={{ x: 70, opacity: 0 }}
        transition={spring}
        className="flex h-full w-full max-w-[470px] flex-col border-l border-white/70 bg-white/95 shadow-[-30px_0_90px_rgba(15,23,42,0.2)] backdrop-blur-2xl"
      >
        <header className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-violet-500">QuickBooks refund</p>
            <h2 className="mt-1 text-lg font-semibold text-slate-950">Consultation refund review</h2>
          </div>
          <button type="button" onClick={onClose} aria-label="Close refund review" className="flex h-9 w-9 items-center justify-center rounded-full text-slate-500 transition hover:bg-slate-100">
            <X className="h-5 w-5" />
          </button>
        </header>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-6 py-5">
          {!review && !error ? (
            <div className="flex h-48 items-center justify-center"><Loader2 className="h-5 w-5 animate-spin text-slate-400" /></div>
          ) : null}
          {error ? (
            <div className="rounded-2xl border border-rose-100 bg-rose-50 p-4">
              <p className="text-sm font-semibold text-rose-900">Refund details unavailable</p>
              <p className="mt-1 text-xs leading-5 text-rose-700">{error}</p>
            </div>
          ) : null}
          {review ? (
            <>
              <section className="rounded-[1.4rem] border border-violet-100 bg-gradient-to-br from-violet-50 to-white p-5">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-semibold text-violet-600">Refund receipt #{review.refund.docNumber || review.refund.id}</p>
                    <p className="mt-2 text-3xl font-semibold tracking-tight text-slate-950">{money.format(Number(review.refund.totalAmount))}</p>
                    <p className="mt-1 text-xs text-slate-500">{formatDate(review.refund.transactionDate || review.refund.createdAt)}{review.refund.paymentMethodName ? ` · ${review.refund.paymentMethodName}` : ""}</p>
                    <p className="mt-1 text-[11px] text-slate-400">QuickBooks record ID {review.refund.id}{review.refund.paymentRefNum ? ` · Reference ${review.refund.paymentRefNum}` : ""}</p>
                  </div>
                  {stateCopy ? <span className={`shrink-0 rounded-full px-3 py-1 text-[11px] font-semibold ${stateCopy.className}`}>{stateCopy.label}</span> : null}
                </div>
                {stateCopy ? <p className="mt-4 text-sm leading-6 text-slate-600">{stateCopy.message}</p> : null}
                {review.refund.quickBooksUrl ? (
                  <a href={review.refund.quickBooksUrl} target="_blank" rel="noopener noreferrer" className="mt-4 inline-flex h-10 items-center gap-2 rounded-full bg-slate-950 px-4 text-xs font-semibold text-white transition hover:bg-slate-800">
                    <ExternalLink className="h-3.5 w-3.5" /> Open refund receipt #{review.refund.docNumber || review.refund.id}
                  </a>
                ) : null}
              </section>

              {review.customer ? (
                <section className="rounded-2xl border border-slate-200 bg-white p-4">
                  <p className="text-[10px] font-bold uppercase tracking-[0.13em] text-slate-400">Whose payment is this?</p>
                  <div className="mt-2 flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-base font-semibold text-slate-950">{review.customer.displayName || review.refund.customerName || "Unknown QuickBooks customer"}</p>
                      <p className="mt-1 truncate text-xs text-slate-500">{review.customer.email || "No email saved in QuickBooks"}</p>
                      <p className="mt-1 text-[11px] text-slate-400">QuickBooks customer ID {review.customer.id}</p>
                    </div>
                    {review.customer.caseDeskClient ? (
                      <button type="button" onClick={() => navigate(`/app/clients/${review.customer.caseDeskClient.id}`)} className="shrink-0 rounded-full bg-sky-50 px-3 py-1.5 text-[11px] font-semibold text-sky-700">Open client</button>
                    ) : (
                      <span className="shrink-0 rounded-full bg-amber-50 px-3 py-1.5 text-[11px] font-semibold text-amber-700">Not in CaseDesk</span>
                    )}
                  </div>
                </section>
              ) : null}

              <section>
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-semibold text-slate-950">QuickBooks payment trail</h3>
                    <p className="mt-0.5 text-xs text-slate-400">Same customer and amount within seven days</p>
                  </div>
                  <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-semibold text-slate-500">{review.quickBooksPayments?.length || 0}</span>
                </div>
                <div className="mt-3 space-y-2">
                  {review.quickBooksPayments?.length ? review.quickBooksPayments.map((payment) => (
                    <article key={payment.id} className={`rounded-2xl border p-4 ${payment.likelyOrigin ? "border-violet-200 bg-violet-50/60" : "border-slate-200 bg-white"}`}>
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-sm font-semibold text-slate-900">{payment.likelyOrigin ? "Likely original payment" : "Possible original payment"}</p>
                          <p className="mt-1 text-xs text-slate-500">Payment #{payment.id} · {formatDate(payment.transactionDate || payment.createdAt)}</p>
                          <p className="mt-1 text-[11px] text-slate-400">{payment.cardStatus || payment.methodName || "Payment recorded"}</p>
                        </div>
                        <p className="shrink-0 text-sm font-semibold tabular-nums text-slate-950">{money.format(Number(payment.totalAmount))}</p>
                      </div>
                      {payment.linkedInvoices?.length ? (
                        <div className="mt-3 space-y-2 border-t border-slate-200/70 pt-3">
                          {payment.linkedInvoices.map((invoice) => (
                            <a key={invoice.id} href={invoice.quickBooksUrl} target="_blank" rel="noopener noreferrer" className="flex items-center justify-between rounded-xl bg-white px-3 py-2 text-xs font-semibold text-sky-700 ring-1 ring-slate-200 transition hover:ring-sky-200">
                              <span>Open invoice #{invoice.docNumber || invoice.id}</span>
                              <ExternalLink className="h-3.5 w-3.5" />
                            </a>
                          ))}
                        </div>
                      ) : (
                        <div className="mt-3 rounded-xl bg-amber-50 px-3 py-2 text-[11px] leading-5 text-amber-800">
                          No invoice is linked to this payment. QuickBooks shows {money.format(Number(payment.unappliedAmount || 0))} as unapplied, so there is no exact invoice to open.
                        </div>
                      )}
                      <a href={payment.quickBooksUrl} target="_blank" rel="noopener noreferrer" className="mt-3 inline-flex items-center gap-1.5 text-xs font-semibold text-sky-700 hover:underline">
                        <ExternalLink className="h-3.5 w-3.5" /> Open original payment in QuickBooks
                      </a>
                    </article>
                  )) : (
                    <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50/70 px-4 py-5 text-center text-xs leading-5 text-slate-500">No same-amount QuickBooks payment was found near this refund.</div>
                  )}
                </div>
              </section>

              <section>
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-semibold text-slate-950">Related consultation payments</h3>
                    <p className="mt-0.5 text-xs text-slate-400">Same QuickBooks customer, newest first</p>
                  </div>
                  <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-semibold text-slate-500">{review.candidates.length}</span>
                </div>
                <div className="mt-3 space-y-2">
                  {review.candidates.length ? review.candidates.map((candidate) => (
                    <button key={candidate.id} type="button" onClick={() => openCandidate(candidate)} className={`w-full rounded-2xl border p-4 text-left transition hover:-translate-y-0.5 hover:shadow-md ${candidate.isMatched ? "border-emerald-200 bg-emerald-50/70" : candidate.amountMatches ? "border-amber-200 bg-amber-50/60" : "border-slate-200 bg-white"}`}>
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold text-slate-900">{candidate.guestName || "Unknown client"}</p>
                          <p className="mt-1 text-xs text-slate-500">{candidate.appointment?.subject || "Consultation payment"} · {formatDate(candidate.paidAt || candidate.createdAt)}</p>
                          <p className="mt-1 text-[11px] text-slate-400">{candidate.appointment ? `${candidate.appointment.status} appointment` : "No appointment attached"}</p>
                        </div>
                        <div className="shrink-0 text-right">
                          <p className="text-sm font-semibold tabular-nums text-slate-900">{money.format(Number(candidate.amount))}</p>
                          <p className={`mt-1 text-[10px] font-semibold ${candidate.isMatched ? "text-emerald-600" : candidate.amountMatches ? "text-amber-600" : "text-slate-400"}`}>{candidate.isMatched ? "Linked refund" : candidate.amountMatches ? "Amount matches" : candidate.status}</p>
                        </div>
                      </div>
                    </button>
                  )) : (
                    <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50/70 px-4 py-6 text-center">
                      <ShieldAlert className="mx-auto h-5 w-5 text-amber-500" />
                      <p className="mt-2 text-sm font-semibold text-slate-800">No related CaseDesk payment found</p>
                      <p className="mt-1 text-xs leading-5 text-slate-500">Use the QuickBooks button above to identify the customer and confirm whether this refund belongs to an older or manually recorded consultation.</p>
                    </div>
                  )}
                </div>
              </section>
            </>
          ) : null}
        </div>
      </motion.aside>
    </div>
  );
}

function paymentBalanceLabel(row) {
  if (row.status === "Refunded") return <span className="font-medium text-violet-600">Refunded</span>;
  if (row.status === "Voided") return <span className="font-medium text-slate-400">Not collected</span>;
  if (row.balance > 0) return money.format(row.balance);
  return <span className="font-medium text-emerald-600">Paid in full</span>;
}

/** Animated number that springs from 0 (or the previous value) to `value`. */
function CountUp({ value, format = (v) => moneyWhole.format(v) }) {
  const raw = useMotionValue(0);
  const sprung = useSpring(raw, { stiffness: 90, damping: 24 });
  const text = useTransform(sprung, (latest) => format(latest));
  useEffect(() => { raw.set(value); }, [value, raw]);
  return <motion.span>{text}</motion.span>;
}

function KpiCard({ label, value, format, icon: Icon, tint, delay = 0, footnote }) {
  return (
    <motion.article
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ ...spring, delay }}
      whileHover={{ y: -3, boxShadow: "0 26px 60px rgba(15,23,42,0.12)" }}
      className={cx(glass, "min-w-0 cursor-default p-5")}
    >
      <div className="flex min-w-0 items-center gap-4">
        <motion.div whileHover={{ scale: 1.08, rotate: -4 }} transition={spring} className={cx("flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl ring-1", tint)}>
          <Icon className="h-5 w-5" />
        </motion.div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[12px] font-semibold text-slate-500">{label}</p>
          <p className="mt-1 truncate text-[22px] font-semibold tracking-[-0.03em] text-slate-950 tabular-nums">
            <CountUp value={value} format={format} />
          </p>
          {footnote ? <p className="mt-0.5 truncate text-[11px] font-medium text-slate-400">{footnote}</p> : null}
        </div>
      </div>
    </motion.article>
  );
}

/** Dual-series area chart (invoiced vs collected) with animated path draw and hover crosshair. */
function TrendChart({ data }) {
  const [hover, setHover] = useState(null);
  const width = 560;
  const height = 180;
  const pad = { top: 12, bottom: 24, left: 8, right: 8 };
  const innerW = width - pad.left - pad.right;
  const innerH = height - pad.top - pad.bottom;
  const maxValue = Math.max(1, ...data.map((d) => Math.max(d.collected, d.invoiced)));
  const niceMax = maxValue * 1.15;

  const pointsFor = (key) => data.map((item, index) => ({
    x: pad.left + (index / Math.max(1, data.length - 1)) * innerW,
    y: pad.top + innerH - (item[key] / niceMax) * innerH,
    value: item[key],
    label: item.label,
  }));
  const collected = pointsFor("collected");
  const invoiced = pointsFor("invoiced");
  const linePath = (points) => points.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(" ");
  const areaPath = (points) => `${linePath(points)} L ${(pad.left + innerW).toFixed(1)} ${pad.top + innerH} L ${pad.left} ${pad.top + innerH} Z`;

  const ticks = [0, 0.5, 1].map((f) => ({ y: pad.top + innerH - f * innerH, value: f * niceMax }));

  function onMove(event) {
    const rect = event.currentTarget.getBoundingClientRect();
    const relX = ((event.clientX - rect.left) / rect.width) * width;
    let nearest = 0;
    let best = Infinity;
    collected.forEach((p, i) => { const d = Math.abs(p.x - relX); if (d < best) { best = d; nearest = i; } });
    setHover(nearest);
  }

  const active = hover != null ? { collected: collected[hover], invoiced: invoiced[hover] } : null;

  return (
    <div className="min-w-0">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="h-[190px] w-full overflow-visible"
        onMouseMove={onMove}
        onMouseLeave={() => setHover(null)}
        role="img"
        aria-label="Monthly invoiced and collected amounts"
      >
        <defs>
          <linearGradient id="collectedFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#10B981" stopOpacity="0.28" />
            <stop offset="100%" stopColor="#10B981" stopOpacity="0" />
          </linearGradient>
          <linearGradient id="invoicedFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#0EA5E9" stopOpacity="0.16" />
            <stop offset="100%" stopColor="#0EA5E9" stopOpacity="0" />
          </linearGradient>
        </defs>

        {ticks.map((tick) => (
          <g key={tick.y}>
            <line x1={pad.left} y1={tick.y} x2={width - pad.right} y2={tick.y} stroke="#E2E8F0" strokeDasharray="4 7" />
            <text x={width - pad.right} y={tick.y - 4} textAnchor="end" className="fill-slate-400 text-[9px] font-medium">{compactMoney(tick.value)}</text>
          </g>
        ))}

        <motion.path d={areaPath(invoiced)} fill="url(#invoicedFill)" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.9, delay: 0.35 }} />
        <motion.path d={areaPath(collected)} fill="url(#collectedFill)" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.9, delay: 0.5 }} />
        <motion.path d={linePath(invoiced)} fill="none" stroke="#0EA5E9" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" strokeDasharray="1 0" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 1.1, ease: [0.32, 0.72, 0, 1] }} />
        <motion.path d={linePath(collected)} fill="none" stroke="#10B981" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 1.1, delay: 0.15, ease: [0.32, 0.72, 0, 1] }} />

        {active ? (
          <g>
            <line x1={active.collected.x} y1={pad.top} x2={active.collected.x} y2={pad.top + innerH} stroke="#94A3B8" strokeDasharray="3 4" />
            <circle cx={active.invoiced.x} cy={active.invoiced.y} r="4.5" fill="#fff" stroke="#0EA5E9" strokeWidth="2.4" />
            <circle cx={active.collected.x} cy={active.collected.y} r="4.5" fill="#fff" stroke="#10B981" strokeWidth="2.4" />
          </g>
        ) : (
          collected.map((p, i) => <circle key={p.label + i} cx={p.x} cy={p.y} r="3" fill="#fff" stroke="#10B981" strokeWidth="2" />)
        )}

        {data.map((item, index) => (
          <text key={item.label + index} x={pad.left + (index / Math.max(1, data.length - 1)) * innerW} y={height - 6} textAnchor="middle" className="fill-slate-400 text-[9.5px] font-medium">{item.label}</text>
        ))}
      </svg>

      <AnimatePresence>
        {active ? (
          <motion.div initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="mt-1 flex items-center justify-center gap-4 text-[11px] font-semibold">
            <span className="text-slate-500">{active.collected.label}</span>
            <span className="flex items-center gap-1.5 text-sky-600"><span className="h-2 w-2 rounded-full bg-sky-500" /> Invoiced {compactMoney(active.invoiced.value)}</span>
            <span className="flex items-center gap-1.5 text-emerald-600"><span className="h-2 w-2 rounded-full bg-emerald-500" /> Collected {compactMoney(active.collected.value)}</span>
          </motion.div>
        ) : (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="mt-1 flex items-center justify-center gap-4 text-[11px] font-medium text-slate-400">
            <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-sky-500" /> Invoiced</span>
            <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-emerald-500" /> Collected</span>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/** SVG donut with animated arc sweep + interactive legend highlighting. */
function StatusDonut({ breakdown }) {
  const [activeKey, setActiveKey] = useState(null);
  const entries = Object.entries(breakdown || {}).filter(([, v]) => v.count > 0).sort((a, b) => b[1].amount - a[1].amount);
  const totalAmount = entries.reduce((sum, [, v]) => sum + v.amount, 0);
  const totalCount = entries.reduce((sum, [, v]) => sum + v.count, 0);
  const radius = 62;
  const strokeWidth = 20;
  const circumference = 2 * Math.PI * radius;

  let offset = 0;
  const segments = entries.map(([key, value]) => {
    const fraction = totalAmount > 0 ? value.amount / totalAmount : 0;
    const segment = { key, value, fraction, start: offset };
    offset += fraction;
    return segment;
  });

  const active = activeKey ? entries.find(([key]) => key === activeKey) : null;

  return (
    <div className="flex min-w-0 flex-col items-center gap-5 sm:flex-row sm:items-center">
      <div className="relative h-[168px] w-[168px] shrink-0">
        <svg viewBox="0 0 168 168" className="h-full w-full -rotate-90">
          <circle cx="84" cy="84" r={radius} fill="none" stroke="#F1F5F9" strokeWidth={strokeWidth} />
          {segments.map((segment, index) => (
            <motion.circle
              key={segment.key}
              cx="84"
              cy="84"
              r={radius}
              fill="none"
              stroke={STATUS_COLOR[segment.key] || "#94A3B8"}
              strokeWidth={activeKey === segment.key ? strokeWidth + 5 : strokeWidth}
              strokeLinecap="butt"
              strokeDasharray={`${Math.max(0, segment.fraction * circumference - 2.5)} ${circumference}`}
              initial={{ strokeDashoffset: circumference }}
              animate={{ strokeDashoffset: -segment.start * circumference }}
              transition={{ duration: 0.9, delay: 0.25 + index * 0.1, ease: [0.32, 0.72, 0, 1] }}
              style={{ cursor: "pointer", transition: "stroke-width 0.2s ease" }}
              onMouseEnter={() => setActiveKey(segment.key)}
              onMouseLeave={() => setActiveKey(null)}
            />
          ))}
        </svg>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
          <AnimatePresence mode="wait">
            <motion.div key={activeKey || "total"} initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }} transition={{ duration: 0.15 }}>
              {active ? (
                <>
                  <p className="text-[11px] font-semibold" style={{ color: STATUS_COLOR[active[0]] }}>{STATUS_LABEL[active[0]]}</p>
                  <p className="text-[19px] font-semibold tracking-tight text-slate-950">{compactMoney(active[1].amount)}</p>
                  <p className="text-[10px] font-medium text-slate-400">{active[1].count} record{active[1].count === 1 ? "" : "s"}</p>
                </>
              ) : (
                <>
                  <p className="text-[11px] font-medium text-slate-400">Total invoiced</p>
                  <p className="text-[19px] font-semibold tracking-tight text-slate-950">{compactMoney(totalAmount)}</p>
                  <p className="text-[10px] font-medium text-slate-400">{totalCount} records</p>
                </>
              )}
            </motion.div>
          </AnimatePresence>
        </div>
      </div>

      <div className="w-full min-w-0 space-y-2">
        {segments.map((segment, index) => (
          <motion.button
            key={segment.key}
            type="button"
            initial={{ opacity: 0, x: 10 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.4 + index * 0.07 }}
            onMouseEnter={() => setActiveKey(segment.key)}
            onMouseLeave={() => setActiveKey(null)}
            className={cx(
              "flex w-full items-center justify-between gap-3 rounded-xl px-2.5 py-1.5 text-left transition-colors",
              activeKey === segment.key ? "bg-slate-100/80" : "hover:bg-slate-50/80",
            )}
          >
            <span className="flex min-w-0 items-center gap-2.5">
              <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: STATUS_COLOR[segment.key] }} />
              <span className="truncate text-[12px] font-medium text-slate-600">{STATUS_LABEL[segment.key] || segment.key}</span>
            </span>
            <span className="shrink-0 text-[12px] font-semibold tabular-nums text-slate-700">
              {compactMoney(segment.value.amount)} <span className="font-medium text-slate-400">({Math.round(segment.fraction * 100)}%)</span>
            </span>
          </motion.button>
        ))}
        {!segments.length ? <p className="rounded-xl border border-dashed border-slate-200 bg-slate-50/60 p-4 text-sm text-slate-400">No payment records yet.</p> : null}
      </div>
    </div>
  );
}

/** Horizontal collected-vs-outstanding bars per payment source. */
function TypeBars({ breakdown }) {
  const entries = Object.entries(breakdown || {}).sort((a, b) => (b[1].collected + b[1].outstanding) - (a[1].collected + a[1].outstanding));
  const maxTotal = Math.max(1, ...entries.map(([, v]) => v.collected + v.outstanding));

  return (
    <div className="space-y-4">
      {entries.map(([key, value], index) => {
        const Icon = SOURCE_ICON[key] || Banknote;
        const total = value.collected + value.outstanding;
        return (
          <motion.div key={key} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 + index * 0.1 }} className="group">
            <div className="flex items-center justify-between gap-3">
              <span className="flex min-w-0 items-center gap-2 text-[12px] font-medium text-slate-600">
                <Icon className="h-3.5 w-3.5 shrink-0" style={{ color: SOURCE_COLOR[key] }} />
                <span className="truncate">{SOURCE_LABEL[key] || key}</span>
              </span>
              <span className="shrink-0 text-[12px] font-semibold tabular-nums text-slate-700">{compactMoney(total)}</span>
            </div>
            <div className="mt-1.5 flex h-3 w-full gap-0.5 overflow-hidden rounded-full bg-slate-100">
              <motion.div
                initial={{ width: 0 }}
                animate={{ width: `${(value.collected / maxTotal) * 100}%` }}
                transition={{ duration: 0.8, delay: 0.45 + index * 0.1, ease: [0.32, 0.72, 0, 1] }}
                className="h-full rounded-l-full transition-[filter] group-hover:brightness-110"
                style={{ backgroundColor: SOURCE_COLOR[key] }}
              />
              <motion.div
                initial={{ width: 0 }}
                animate={{ width: `${(value.outstanding / maxTotal) * 100}%` }}
                transition={{ duration: 0.8, delay: 0.55 + index * 0.1, ease: [0.32, 0.72, 0, 1] }}
                className="h-full rounded-r-full opacity-30 transition-[filter] group-hover:brightness-110"
                style={{ backgroundColor: SOURCE_COLOR[key] }}
              />
            </div>
            <p className="mt-1 text-[10.5px] font-medium text-slate-400">
              {compactMoney(value.collected)} collected · {compactMoney(value.outstanding)} outstanding · {value.count} record{value.count === 1 ? "" : "s"}
            </p>
          </motion.div>
        );
      })}
      {!entries.length ? <p className="rounded-xl border border-dashed border-slate-200 bg-slate-50/60 p-4 text-sm text-slate-400">No payment records yet.</p> : null}
    </div>
  );
}

function ChartCard({ title, subtitle, children, className, delay = 0 }) {
  return (
    <motion.section
      initial={{ opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ ...spring, delay }}
      className={cx(glass, "min-w-0 p-5", className)}
    >
      <div className="mb-4">
        <h2 className="text-[15px] font-semibold tracking-[-0.015em] text-slate-950">{title}</h2>
        {subtitle ? <p className="mt-0.5 text-[12px] text-slate-400">{subtitle}</p> : null}
      </div>
      {children}
    </motion.section>
  );
}

const filterControl = "rounded-2xl border border-slate-200/80 bg-white/80 px-3.5 py-2.5 text-sm font-medium text-slate-700 shadow-sm outline-none backdrop-blur transition focus:border-sky-400 focus:ring-2 focus:ring-sky-100";

// A native <select>'s open dropdown is rendered by the OS, not the page —
// most browsers (Safari in particular) ignore background/text-color CSS on
// <option> entirely, so it can never actually match the glass styling
// everything else on this page uses. This renders the whole list ourselves.
function FilterDropdown({ value, onChange, options, placeholder }) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    function handleClickOutside(event) {
      if (containerRef.current && !containerRef.current.contains(event.target)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  const selected = options.find((option) => option.value === value);

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        className={cx(filterControl, "flex min-w-[150px] items-center gap-2 pr-9 text-left")}
      >
        <span className="truncate">{selected ? selected.label : placeholder}</span>
        <ChevronDown className={cx("pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400 transition-transform", open && "rotate-180")} />
      </button>
      <AnimatePresence>
        {open ? (
          <motion.div
            initial={{ opacity: 0, y: -6, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.98 }}
            transition={{ duration: 0.15 }}
            className="absolute left-0 top-[calc(100%+6px)] z-20 min-w-full overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-[0_18px_50px_rgba(15,23,42,0.14)]"
          >
            <div className="max-h-64 overflow-y-auto p-1.5">
              {options.map((option) => (
                <button
                  key={option.value || "all"}
                  type="button"
                  onClick={() => { onChange(option.value); setOpen(false); }}
                  className={cx(
                    "flex w-full items-center justify-between gap-2 rounded-xl px-3 py-2 text-left text-sm font-medium whitespace-nowrap transition-colors",
                    option.value === value ? "bg-sky-50 text-sky-700" : "text-slate-700 hover:bg-slate-50",
                  )}
                >
                  <span className="truncate">{option.label}</span>
                  {option.value === value ? <Check className="h-3.5 w-3.5 shrink-0" /> : null}
                </button>
              ))}
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

export default function Payments() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedHoldId = searchParams.get("hold") || "";
  const selectedRefundId = searchParams.get("refund") || "";
  const [summary, setSummary] = useState(null);
  const [rows, setRows] = useState(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const pageSize = 20;
  const [status, setStatus] = useState("");
  const [source, setSource] = useState(() => searchParams.get("source") || "");
  const [query, setQuery] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    getPaymentsOverviewSummary().catch(() => null).then((data) => data && setSummary(data));
  }, [refreshKey]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    getPaymentsOverview({ status, source, query, from, to, page, pageSize })
      .then((data) => {
        if (!active) return;
        setRows(data.rows);
        setTotal(data.total);
      })
      .catch((reason) => active && setError(reason.response?.data?.message || "Payments could not be loaded."))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [status, source, query, from, to, page, refreshKey]);

  useEffect(() => { setPage(1); }, [status, source, query, from, to]);

  const pageCount = Math.max(1, Math.ceil(total / pageSize));

  function closePaymentHold() {
    const next = new URLSearchParams(searchParams);
    next.delete("hold");
    setSearchParams(next, { replace: true });
  }

  function closeRefundReview() {
    const next = new URLSearchParams(searchParams);
    next.delete("refund");
    setSearchParams(next, { replace: true });
  }

  const monthDelta = useMemo(() => {
    if (!summary) return null;
    if (!summary.paidLastMonth) return summary.paidThisMonth > 0 ? "First collections this month" : null;
    const change = ((summary.paidThisMonth - summary.paidLastMonth) / summary.paidLastMonth) * 100;
    return `${change >= 0 ? "+" : ""}${Math.round(change)}% vs last month`;
  }, [summary]);

  return (
    <main className="min-w-0 bg-[radial-gradient(circle_at_12%_-4%,rgba(56,130,246,0.10),transparent_36%),radial-gradient(circle_at_92%_16%,rgba(139,92,246,0.08),transparent_38%)] px-3 py-4 sm:px-5 lg:px-6">
      <div className="mx-auto flex w-full max-w-[1680px] min-w-0 flex-col gap-5">
        <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={spring} className={cx(glass, "overflow-hidden p-5 sm:p-7 lg:p-8")}>
          <h1 className="text-3xl font-semibold tracking-tight text-slate-950 sm:text-4xl">Payments</h1>
          <p className="mt-2 max-w-2xl text-sm text-slate-500 sm:text-base">
            Every case invoice, consultation booking payment, and legacy retainer across the agency — trends first, details below.
          </p>
        </motion.div>

        {summary?.manualBookingCount > 0 ? (
          <motion.section
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ ...spring, delay: 0.04 }}
            role="alert"
            className="rounded-[1.6rem] border border-rose-200 bg-rose-50/90 p-5 shadow-[0_16px_40px_rgba(244,63,94,0.10)] sm:p-6"
          >
            <div className="flex items-start gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-rose-100 text-rose-600">
                <ShieldAlert className="h-5 w-5" />
              </span>
              <div className="min-w-0">
                <h2 className="text-base font-semibold text-rose-950">
                  Paid consultation{summary.manualBookingCount === 1 ? "" : "s"} requiring manual action
                </h2>
                <p className="mt-1 text-sm leading-6 text-rose-800">
                  {summary.manualBookingCount} payment{summary.manualBookingCount === 1 ? " has" : "s have"} no appointment. Treat this as urgent and follow every step below.
                </p>
                <ol className="mt-3 grid gap-2 text-sm leading-5 text-rose-900 sm:grid-cols-2">
                  {ORPHANED_PAYMENT_RUNBOOK.map((step, index) => (
                    <li key={step} className="flex items-start gap-2 rounded-xl bg-white/65 px-3 py-2">
                      <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-rose-600 text-[10px] font-bold text-white">{index + 1}</span>
                      <span>{step}</span>
                    </li>
                  ))}
                </ol>
              </div>
            </div>
          </motion.section>
        ) : null}

        <div className="grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <KpiCard label="Total Collected" value={summary?.totalCollected ?? 0} icon={HandCoins} tint="bg-emerald-50 text-emerald-500 ring-emerald-100" delay={0.05} />
          <KpiCard label="Outstanding Balance" value={summary?.outstandingBalance ?? 0} icon={Wallet} tint="bg-amber-50 text-amber-500 ring-amber-100" delay={0.1} />
          <KpiCard label="Paid This Month" value={summary?.paidThisMonth ?? 0} icon={TrendingUp} tint="bg-sky-50 text-sky-500 ring-sky-100" delay={0.15} footnote={monthDelta} />
          <KpiCard label="Overdue Invoices" value={summary?.overdueCount ?? 0} format={(v) => String(Math.round(v))} icon={ShieldAlert} tint="bg-rose-50 text-rose-500 ring-rose-100" delay={0.2} />
        </div>

        <div className="grid min-w-0 grid-cols-1 gap-4 xl:grid-cols-12">
          <ChartCard title="Collections Trend" subtitle="Invoiced vs collected, last 8 months" className="xl:col-span-5" delay={0.15}>
            {summary ? <TrendChart data={summary.monthlyTrend || []} /> : <div className="flex h-[190px] items-center justify-center"><Loader2 className="h-5 w-5 animate-spin text-slate-300" /></div>}
          </ChartCard>
          <ChartCard title="Payment Status" subtitle="Share of invoiced value by status" className="xl:col-span-4" delay={0.22}>
            {summary ? <StatusDonut breakdown={summary.statusBreakdown} /> : <div className="flex h-[168px] items-center justify-center"><Loader2 className="h-5 w-5 animate-spin text-slate-300" /></div>}
          </ChartCard>
          <ChartCard title="By Payment Type" subtitle="Collected vs outstanding per source" className="xl:col-span-3" delay={0.29}>
            {summary ? <TypeBars breakdown={summary.typeBreakdown} /> : <div className="flex h-[168px] items-center justify-center"><Loader2 className="h-5 w-5 animate-spin text-slate-300" /></div>}
          </ChartCard>
        </div>

        <motion.section initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ ...spring, delay: 0.3 }} className={cx(glass, "min-w-0 overflow-hidden p-4 sm:p-5")}>
          <div className="flex flex-wrap items-center gap-2.5">
            <div className="relative min-w-[200px] flex-1">
              <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search client or invoice #…"
                className={cx(filterControl, "w-full pl-10")}
              />
            </div>
            <FilterDropdown
              value={status}
              onChange={setStatus}
              placeholder="All statuses"
              options={[{ value: "", label: "All statuses" }, ...Object.entries(STATUS_LABEL).map(([value, label]) => ({ value, label }))]}
            />
            <FilterDropdown
              value={source}
              onChange={setSource}
              placeholder="All types"
              options={[{ value: "", label: "All types" }, ...Object.entries(SOURCE_ROW_LABEL).map(([value, label]) => ({ value, label }))]}
            />
            <input type="date" value={from} onChange={(event) => setFrom(event.target.value)} className={filterControl} />
            <span className="text-xs text-slate-400">to</span>
            <input type="date" value={to} onChange={(event) => setTo(event.target.value)} className={filterControl} />
          </div>

          <div className="mt-4 overflow-x-auto rounded-[18px] border border-slate-200/70 bg-white/60">
            <table className="w-full min-w-[900px] border-separate border-spacing-0 text-left">
              <thead>
                <tr className="bg-slate-50/80 text-[11px] font-semibold uppercase tracking-[0.02em] text-slate-500">
                  <th className="px-4 py-3">Client</th>
                  <th className="px-4 py-3">Type</th>
                  <th className="px-4 py-3">Case</th>
                  <th className="px-4 py-3">Amount</th>
                  <th className="px-4 py-3">Balance</th>
                  <th className="px-4 py-3">Date</th>
                  <th className="px-4 py-3">Status</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan="7" className="border-t border-slate-100 px-4 py-10 text-center text-sm text-slate-400"><Loader2 className="mx-auto h-5 w-5 animate-spin" /></td></tr>
                ) : error ? (
                  <tr><td colSpan="7" className="border-t border-slate-100 px-4 py-8 text-center text-sm text-rose-600">{error}</td></tr>
                ) : rows?.length ? (
                  rows.map((row, index) => {
                    const Icon = SOURCE_ICON[row.source] || Banknote;
                    const to = paymentLink(row);
                    return (
                      <motion.tr
                        key={row.id}
                        initial={{ opacity: 0, y: 6 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: Math.min(index * 0.03, 0.3), duration: 0.25 }}
                        onClick={to ? () => navigate(to) : undefined}
                        className={cx(
                          "border-t border-slate-100 text-[13px] text-slate-700 transition-colors hover:bg-sky-50/40",
                          to ? "cursor-pointer" : "",
                        )}
                      >
                        <td className="border-t border-slate-100 px-4 py-3.5">
                          <p className="font-semibold text-slate-900">{row.clientName}</p>
                          <p className="mt-0.5 truncate text-xs text-slate-400">{row.description}</p>
                          {row.paymentMethod ? (
                            <span className="mt-1 inline-flex rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700 ring-1 ring-emerald-100">{row.paymentMethod}</span>
                          ) : null}
                          {row.paymentReference ? (
                            <p className="mt-1 text-[11px] font-medium text-slate-500">Transaction #{row.paymentReference}</p>
                          ) : null}
                          {row.qbInvoiceNumber ? (
                            <p className="mt-1 text-[11px] font-semibold text-sky-700">Invoice #{row.qbInvoiceNumber}</p>
                          ) : null}
                        </td>
                        <td className="border-t border-slate-100 px-4 py-3.5">
                          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-600"><Icon className="h-3.5 w-3.5" style={{ color: SOURCE_COLOR[row.source] }} /> {row.type || SOURCE_ROW_LABEL[row.source]}</span>
                        </td>
                        <td className="border-t border-slate-100 px-4 py-3.5">
                          {row.caseId ? (
                            <span className="text-xs font-semibold text-slate-600">{row.caseType || "Case"}</span>
                          ) : <span className="text-xs text-slate-400">—</span>}
                        </td>
                        <td className="border-t border-slate-100 px-4 py-3.5 font-semibold tabular-nums text-slate-900">{money.format(row.amount)}</td>
                        <td className="border-t border-slate-100 px-4 py-3.5 tabular-nums text-slate-600">{paymentBalanceLabel(row)}</td>
                        <td className="border-t border-slate-100 px-4 py-3.5 text-slate-500">{formatDate(row.createdAt)}</td>
                        <td className="border-t border-slate-100 px-4 py-3.5">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className={cx("inline-flex h-7 items-center rounded-full px-3 text-[11px] font-semibold ring-1", STATUS_TONE[row.status] || STATUS_TONE.Open)}>
                              {STATUS_LABEL[row.status] || row.status}
                            </span>
                            {row.paymentFailed ? (
                              <span
                                title={row.paymentError || "The payment could not be recorded in QuickBooks. Open the appointment and retry."}
                                className="inline-flex h-7 items-center gap-1 rounded-full bg-rose-50 px-3 text-[11px] font-semibold text-rose-600 ring-1 ring-rose-100"
                              >
                                <ShieldAlert className="h-3 w-3" /> Recording failed
                              </span>
                            ) : null}
                            {row.refundOwed ? (
                              <span
                                title="The consultation was cancelled after this payment was collected — QuickBooks does not refund automatically, this needs to be actioned manually."
                                className="inline-flex h-7 items-center gap-1 rounded-full bg-rose-50 px-3 text-[11px] font-semibold text-rose-600 ring-1 ring-rose-100"
                              >
                                <ShieldAlert className="h-3 w-3" /> Refund owed
                              </span>
                            ) : null}
                            {row.needsManualBooking ? (
                              <span
                                title="Urgent: acknowledge within 10 minutes, confirm the QuickBooks payment, then arrange a new appointment or refund the client and record the resolution."
                                className="inline-flex h-7 items-center gap-1 rounded-full bg-amber-50 px-3 text-[11px] font-semibold text-amber-600 ring-1 ring-amber-100"
                              >
                                <ShieldAlert className="h-3 w-3" /> Needs manual booking
                              </span>
                            ) : null}
                            {row.appointmentNotCancelled ? (
                              <span
                                title="This payment was refunded in QuickBooks, but the appointment is still scheduled — decide whether to cancel it."
                                className="inline-flex h-7 items-center gap-1 rounded-full bg-violet-50 px-3 text-[11px] font-semibold text-violet-600 ring-1 ring-violet-100"
                              >
                                <ShieldAlert className="h-3 w-3" /> Still scheduled
                              </span>
                            ) : null}
                            {row.balanceMismatch ? (
                              <span
                                title="This shows as Paid, but the QuickBooks invoice no longer has a zero balance — usually means the payment was deleted in QuickBooks instead of refunded. Check and refund or re-collect as needed."
                                className="inline-flex h-7 items-center gap-1 rounded-full bg-rose-50 px-3 text-[11px] font-semibold text-rose-600 ring-1 ring-rose-100"
                              >
                                <ShieldAlert className="h-3 w-3" /> Payment reversed in QuickBooks
                              </span>
                            ) : null}
                            {row.status === "Paid" && row.qbRefundUrl ? (
                              <a
                                href={row.qbRefundUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                onClick={(event) => event.stopPropagation()}
                                title="Opens the transaction directly in QuickBooks — CaseDesk doesn't process the refund itself, this just skips the search."
                                className="inline-flex h-7 items-center gap-1 rounded-full border border-slate-200 bg-white px-3 text-[11px] font-semibold text-slate-600 transition hover:border-sky-200 hover:text-sky-700"
                              >
                                <ExternalLink className="h-3 w-3" /> Refund in QuickBooks
                              </a>
                            ) : null}
                          </div>
                        </td>
                      </motion.tr>
                    );
                  })
                ) : (
                  <tr><td colSpan="7" className="border-t border-slate-100 px-4 py-10 text-center text-sm text-slate-400">No payments match these filters.</td></tr>
                )}
              </tbody>
            </table>
          </div>

          {!loading && total > 0 ? (
            <div className="mt-4 flex items-center justify-between text-xs text-slate-500">
              <span>{total} record{total === 1 ? "" : "s"} · page {page} of {pageCount}</span>
              <div className="flex gap-2">
                <motion.button whileTap={{ scale: 0.95 }} type="button" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))} className="rounded-full border border-slate-200 bg-white/80 px-3.5 py-1.5 text-xs font-semibold text-slate-600 transition hover:border-slate-300 hover:bg-white disabled:opacity-40">Previous</motion.button>
                <motion.button whileTap={{ scale: 0.95 }} type="button" disabled={page >= pageCount} onClick={() => setPage((p) => Math.min(pageCount, p + 1))} className="rounded-full border border-slate-200 bg-white/80 px-3.5 py-1.5 text-xs font-semibold text-slate-600 transition hover:border-slate-300 hover:bg-white disabled:opacity-40">Next</motion.button>
              </div>
            </div>
          ) : null}
        </motion.section>
      </div>
      <AnimatePresence>{selectedHoldId ? <PaymentHoldDrawer key={selectedHoldId} holdId={selectedHoldId} onClose={closePaymentHold} onChanged={() => setRefreshKey((value) => value + 1)} /> : null}</AnimatePresence>
      <AnimatePresence>{selectedRefundId ? <RefundReviewDrawer key={selectedRefundId} refundReceiptId={selectedRefundId} onClose={closeRefundReview} /> : null}</AnimatePresence>
    </main>
  );
}
