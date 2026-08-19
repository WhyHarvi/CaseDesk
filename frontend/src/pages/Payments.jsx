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
  ClipboardCheck,
  Scale,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { cancelBookingPaymentHoldRequest, getBookingPaymentHoldStatus, resendBookingPaymentHoldRequest } from "../api/bookingApi";
import {
  getConsultationRefundReview,
  getPaymentsOverview,
  getPaymentsOverviewSummary,
  getPaymentApprovals,
  approvePaymentApproval,
  rejectPaymentApproval,
  getCashClosing,
  closeCashLedger,
  withdrawCashLedger,
  getStuckInvoiceRefunds,
  failInvoiceRefund,
  getCashLedgerActivity,
  getQuickBooksSyncFailures,
} from "../api/paymentsOverviewApi";
import api from "../services/api";
import { leadName } from "../modules/leads/leadPresentation";
import { useAuth } from "../auth/AuthContext";

const money = new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD", minimumFractionDigits: 2 });
const moneyWhole = new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD", maximumFractionDigits: 0 });

function compactMoney(value) {
  if (Math.abs(value) >= 1000) return `$${(value / 1000).toFixed(value % 1000 === 0 ? 0 : 1)}K`;
  return `$${Math.round(value)}`;
}

const TREND_RANGE_LABEL = {
  day: "last 30 days",
  month: "last 8 months",
  year: "last 5 years",
};

const BUCKET_LABELS = {
  collected: "Collected",
  cash_collected: "Cash collected",
  noncash_collected: "Non-cash collected",
  outstanding: "Outstanding balance",
  overdue: "Overdue invoices",
  refunded: "Refunded",
};

const glass = "rounded-[1.6rem] border border-white/70 bg-white/70 shadow-[0_18px_50px_rgba(15,23,42,0.08)] backdrop-blur-2xl";
const spring = { type: "spring", stiffness: 320, damping: 30 };

function cx(...classes) {
  return classes.filter(Boolean).join(" ");
}

const STATUS_LABEL = { Open: "Open", PartiallyPaid: "Partially paid", Paid: "Paid", Refunded: "Refunded", PartiallyRefunded: "Partially refunded", Withdrawn: "Withdrawn", Overdue: "Overdue", Voided: "Voided", NeedsClassification: "Needs classification" };
const STATUS_TONE = {
  Open: "bg-slate-100 text-slate-600 ring-slate-200",
  PartiallyPaid: "bg-amber-50 text-amber-600 ring-amber-100",
  Paid: "bg-emerald-50 text-emerald-600 ring-emerald-100",
  Refunded: "bg-violet-50 text-violet-600 ring-violet-100",
  PartiallyRefunded: "bg-fuchsia-50 text-fuchsia-600 ring-fuchsia-100",
  NeedsClassification: "bg-orange-50 text-orange-700 ring-orange-200",
  Withdrawn: "bg-amber-50 text-amber-700 ring-amber-200",
  Overdue: "bg-rose-50 text-rose-600 ring-rose-100",
  Voided: "bg-slate-100 text-slate-400 ring-slate-200",
};
const STATUS_COLOR = { Paid: "#10B981", Refunded: "#8B5CF6", PartiallyPaid: "#F59E0B", Open: "#94A3B8", Overdue: "#F43F5E", Voided: "#CBD5E1" };
// Exception flags a row can carry alongside its primary status — these are
// call-to-action detail, not a second status, so they render as a smaller,
// quieter line stacked under the status pill rather than a second pill
// competing with it for attention.
const STATUS_FLAGS = [
  { key: "paymentFailed", label: "Recording failed", Icon: ShieldAlert, tone: "text-rose-600", title: (row) => row.paymentError || "The payment could not be recorded in QuickBooks. Open the appointment and retry." },
  { key: "missingAppointmentPayment", label: "Payment not recorded", Icon: Wallet, tone: "text-amber-700", title: () => "The consultation is scheduled, but no payment or payment method has been recorded. Open the appointment to record it." },
  { key: "eTransferPaymentPending", label: "E-transfer pending", Icon: Wallet, tone: "text-amber-700", title: () => "The appointment is booked, but this e-transfer has not been recorded. Open the appointment and add its transaction number after payment is received." },
  { key: "transactionReferenceMissing", label: "Transaction # missing", Icon: Wallet, tone: "text-amber-700", title: () => "QuickBooks shows this consultation as paid, but the e-transfer transaction number is missing. Open the appointment to add it." },
  { key: "refundOwed", label: "Refund owed", Icon: ShieldAlert, tone: "text-rose-600", title: () => "The consultation was cancelled after this payment was collected — QuickBooks does not refund automatically, this needs to be actioned manually." },
  { key: "needsManualBooking", label: "Needs manual booking", Icon: ShieldAlert, tone: "text-amber-600", title: () => "Urgent: acknowledge within 10 minutes, confirm the QuickBooks payment, then arrange a new appointment or refund the client and record the resolution." },
  { key: "appointmentNotCancelled", label: "Still scheduled", Icon: ShieldAlert, tone: "text-violet-600", title: () => "This payment was refunded in QuickBooks, but the appointment is still scheduled — decide whether to cancel it." },
  { key: "balanceMismatch", label: "Payment reversed in QuickBooks", Icon: ShieldAlert, tone: "text-rose-600", title: () => "This shows as Paid, but the QuickBooks invoice no longer has a zero balance — usually means the payment was deleted in QuickBooks instead of refunded. Check and refund or re-collect as needed." },
];
const SOURCE_LABEL = { quickbooks: "QuickBooks", casedesk_cash: "CaseDesk Cash", case_invoice: "Invoices", booking_payment: "Consultation bookings", cash_transaction: "Cash ledger", legacy_payment: "Legacy retainers", manual_ledger_review: "Needs classification" };
const SOURCE_ROW_LABEL = { case_invoice: "Invoice", booking_payment: "Consultation booking", cash_transaction: "Cash transaction", legacy_payment: "Legacy retainer", manual_ledger_review: "Legacy entry review" };
const SOURCE_ICON = { case_invoice: Banknote, booking_payment: CalendarClock, cash_transaction: HandCoins, legacy_payment: Landmark, manual_ledger_review: ShieldAlert };
const SOURCE_COLOR = { quickbooks: "#0EA5E9", casedesk_cash: "#10B981", case_invoice: "#0EA5E9", booking_payment: "#8B5CF6", cash_transaction: "#10B981", legacy_payment: "#64748B", manual_ledger_review: "#F97316" };
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
  return new Date(value).toLocaleDateString("en-CA", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

function localInputDate(value = new Date()) {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function newCashWithdrawalKey() {
  if (globalThis.crypto?.randomUUID) return `cash-withdrawal:${globalThis.crypto.randomUUID()}`;
  return `cash-withdrawal:${Date.now()}:${Math.random().toString(36).slice(2)}`;
}

// "What this payment is about" — a consultation-booking hold points at the
// appointment it paid for (once one exists; an AwaitingPayment hold has
// none yet), a case invoice/legacy retainer points at the case's billing
// tab, and anything without a case falls back to the client. Same
// resolution regardless of source, per the "click a payment, land on the
// exact thing it's for" ask.
function paymentLink(row) {
  if (row.source === "booking_payment") {
    if ((row.missingAppointmentPayment || row.eTransferPaymentPending || row.transactionReferenceMissing) && row.appointmentId) {
      const date = row.appointmentStartsAt ? new Date(row.appointmentStartsAt).toISOString().slice(0, 10) : "";
      return `/app/calendar?appointment=${row.appointmentId}${date ? `&date=${date}` : ""}`;
    }
    if (["AwaitingPayment", "Confirming", "RecordingPayment", "PaymentFailed", "Expired", "Voided", "Failed"].includes(row.bookingStatus)) {
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

/** Generic slide-over shell shared by the Cash On Hand and Sync Failures detail drawers. */
function InfoDrawer({ eyebrow, title, onClose, children }) {
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
            <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-violet-500">{eyebrow}</p>
            <h2 className="mt-1 text-lg font-semibold text-slate-950">{title}</h2>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="flex h-9 w-9 items-center justify-center rounded-full text-slate-500 transition hover:bg-slate-100">
            <X className="h-5 w-5" />
          </button>
        </header>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-6 py-5">{children}</div>
      </motion.aside>
    </div>
  );
}

/** Detail behind the Cash On Hand KPI: last-closing baseline plus every posted cash movement since. */
function CashLedgerDrawer({ onClose }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    getCashLedgerActivity()
      .then((result) => active && setData(result))
      .catch((reason) => active && setError(reason.response?.data?.message || "Cash ledger activity could not be loaded."));
    return () => { active = false; };
  }, []);

  return (
    <InfoDrawer eyebrow="CaseDesk Cash" title="Cash On Hand" onClose={onClose}>
      {!data && !error ? <div className="flex h-48 items-center justify-center"><Loader2 className="h-5 w-5 animate-spin text-slate-400" /></div> : null}
      {error ? <div className="rounded-2xl border border-rose-100 bg-rose-50 p-4 text-sm text-rose-700">{error}</div> : null}
      {data ? (
        <>
          <section className="rounded-[1.4rem] border border-violet-100 bg-gradient-to-br from-violet-50 to-white p-5">
            <p className="text-3xl font-semibold tracking-tight text-slate-950">{money.format(data.currentBalance)}</p>
            <p className="mt-1 text-xs text-slate-500">
              {data.baselineAsOf
                ? `Baseline ${money.format(data.baseline)} from the closing on ${formatDate(data.baselineClosedAt || data.baselineAsOf)}, plus ${data.activity.length} movement${data.activity.length === 1 ? "" : "s"} since.`
                : `No cash closing on record yet — this is the all-time net of ${data.activity.length} posted cash transaction${data.activity.length === 1 ? "" : "s"}.`}
            </p>
          </section>
          <section>
            <h3 className="text-sm font-semibold text-slate-950">Activity since baseline</h3>
            <div className="mt-3 space-y-2">
              {data.activity.length ? data.activity.map((row) => (
                <div key={row.id} className="rounded-2xl border border-slate-200 bg-white p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-slate-900">{row.clientName || (row.type === "Withdrawal" ? "Cash drawer" : "No client linked")}</p>
                      <p className="mt-1 text-xs text-slate-500">{row.type === "Withdrawal" ? "Cash withdrawal" : row.type === "Refund" ? "Cash refund" : "Cash receipt"} · {formatDate(row.occurredAt)}</p>
                      {row.note ? <p className="mt-1 text-[11px] text-slate-400">{row.note}</p> : null}
                      {row.reference ? <p className="mt-1 text-[11px] text-slate-400">Ref #{row.reference}</p> : null}
                      {row.createdByName ? <p className="mt-1 text-[11px] text-slate-400">Recorded by {row.createdByName}</p> : null}
                    </div>
                    <p className={cx("shrink-0 text-sm font-semibold tabular-nums", Number(row.amount) < 0 ? "text-rose-600" : "text-emerald-600")}>
                      {Number(row.amount) < 0 ? "-" : "+"}{money.format(Math.abs(row.amount))}
                    </p>
                  </div>
                </div>
              )) : (
                <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50/70 px-4 py-6 text-center text-sm text-slate-500">No cash activity since the last closing.</div>
              )}
            </div>
          </section>
        </>
      ) : null}
    </InfoDrawer>
  );
}

/** Detail behind the QuickBooks Sync Failures KPI: webhook events stuck in status FAILED. */
function SyncFailuresDrawer({ onClose }) {
  const [rows, setRows] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    getQuickBooksSyncFailures()
      .then((result) => active && setRows(result))
      .catch((reason) => active && setError(reason.response?.data?.message || "Sync failures could not be loaded."));
    return () => { active = false; };
  }, []);

  return (
    <InfoDrawer eyebrow="QuickBooks" title="Sync Failures" onClose={onClose}>
      {!rows && !error ? <div className="flex h-48 items-center justify-center"><Loader2 className="h-5 w-5 animate-spin text-slate-400" /></div> : null}
      {error ? <div className="rounded-2xl border border-rose-100 bg-rose-50 p-4 text-sm text-rose-700">{error}</div> : null}
      {rows ? (
        rows.length ? (
          <div className="space-y-2">
            {rows.map((row) => (
              <div key={row.id} className="rounded-2xl border border-rose-100 bg-rose-50/60 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-slate-900">{row.entityName} · {row.operation}</p>
                    <p className="mt-1 text-xs text-slate-500">First seen {formatDate(row.createdAt)} · {row.attempts}/{row.maxAttempts} attempts</p>
                    <p className="mt-1 text-[11px] text-slate-400">Entity ID {row.entityId}</p>
                  </div>
                  <ShieldAlert className="h-4 w-4 shrink-0 text-rose-500" />
                </div>
                {row.lastError ? <p className="mt-2 rounded-lg bg-white/70 px-3 py-2 text-[11px] leading-5 text-rose-700">{row.lastError}</p> : null}
              </div>
            ))}
          </div>
        ) : (
          <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50/70 px-4 py-6 text-center text-sm text-slate-500">No failed QuickBooks syncs right now.</div>
        )
      ) : null}
    </InfoDrawer>
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

// `pending`/`failed` are distinct from a real value of 0 — a KPI that
// hasn't loaded yet, or failed to, must never render as if the API
// affirmatively returned zero (CD-032/CD-036: a loading or failed summary
// silently rendering "$0" is what made these numbers look non-deterministic
// and untrustworthy).
function KpiCard({ label, value, format, icon: Icon, tint, delay = 0, footnote, onClick, pending = false, failed = false }) {
  return (
    <motion.article
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ ...spring, delay }}
      whileHover={{ y: -3, boxShadow: "0 26px 60px rgba(15,23,42,0.12)" }}
      onClick={pending ? undefined : onClick}
      role={onClick && !pending ? "button" : undefined}
      tabIndex={onClick && !pending ? 0 : undefined}
      onKeyDown={onClick && !pending ? (event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onClick(); } } : undefined}
      className={cx(glass, "min-w-0 p-5", onClick && !pending ? "cursor-pointer" : "cursor-default")}
    >
      <div className="flex min-w-0 items-center gap-4">
        <motion.div whileHover={{ scale: 1.08, rotate: -4 }} transition={spring} className={cx("flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl ring-1", tint)}>
          <Icon className="h-5 w-5" />
        </motion.div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[12px] font-semibold text-slate-500">{label}</p>
          {pending ? (
            <span className="mt-1.5 block h-[22px] w-20 animate-pulse rounded-md bg-slate-100" />
          ) : failed ? (
            <p className="mt-1 truncate text-[22px] font-semibold tracking-[-0.03em] text-slate-300">—</p>
          ) : (
            <p className="mt-1 truncate text-[22px] font-semibold tracking-[-0.03em] text-slate-950 tabular-nums">
              <CountUp value={value} format={format} />
            </p>
          )}
          {failed ? (
            <p className="mt-0.5 truncate text-[11px] font-medium text-rose-500">Couldn't load — retry</p>
          ) : footnote ? (
            <p className="mt-0.5 truncate text-[11px] font-medium text-slate-400">{footnote}</p>
          ) : null}
        </div>
      </div>
    </motion.article>
  );
}

/**
 * Side-by-side "this month vs last month" strip for the flow figures that
 * genuinely reset every month (Collected/Cash/Non-Cash/Refunded) — unlike
 * balances such as Cash On Hand, which intentionally keep running.
 */
function MonthComparisonPanel({ summary, delay = 0.3, onSelectBucket }) {
  if (!summary?.selectedMonth || !summary?.previousMonth) return null;
  const rows = [
    { label: "Collected", bucket: "collected", curr: summary.selectedMonth.collected, prev: summary.previousMonth.collected },
    { label: "Cash Collected", bucket: "cash_collected", curr: summary.selectedMonth.cashCollected, prev: summary.previousMonth.cashCollected },
    { label: "Non-Cash Collected", bucket: "noncash_collected", curr: summary.selectedMonth.nonCashCollected, prev: summary.previousMonth.nonCashCollected },
    { label: "Refunded", bucket: "refunded", curr: summary.selectedMonth.refunded, prev: summary.previousMonth.refunded },
  ];
  return (
    <motion.section initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ ...spring, delay }} className={cx(glass, "min-w-0 overflow-hidden p-4 sm:p-5")}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-slate-900">Month comparison</h3>
        <p className="text-xs text-slate-400">{summary.selectedMonth.label} vs {summary.previousMonth.label}</p>
      </div>
      <div className="mt-3 grid grid-cols-1 gap-2.5 sm:grid-cols-2 xl:grid-cols-4">
        {rows.map((row) => {
          const delta = row.prev ? Math.round(((row.curr - row.prev) / row.prev) * 100) : null;
          return (
            <button
              type="button"
              key={row.label}
              onClick={() => onSelectBucket?.(row.bucket)}
              className="rounded-xl border border-slate-200/70 bg-white/60 px-3.5 py-3 text-left transition hover:border-sky-200 hover:bg-sky-50/40"
            >
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{row.label}</p>
              <p className="mt-1 text-lg font-semibold tabular-nums text-slate-900">{money.format(row.curr)}</p>
              <p className="mt-0.5 text-[11px] text-slate-400">
                {row.prev ? `${money.format(row.prev)} prior month` : row.curr > 0 ? "No activity prior month" : "No activity either month"}
                {delta !== null ? <span className={cx("ml-1.5 font-semibold", delta >= 0 ? "text-emerald-600" : "text-rose-600")}>{delta >= 0 ? "+" : ""}{delta}%</span> : null}
              </p>
            </button>
          );
        })}
      </div>
    </motion.section>
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
        aria-label="Invoiced and collected amounts over time"
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

        {data.map((item, index) => {
          // Daily view has 30 points — showing every label would overlap
          // into an unreadable smear, so thin them to roughly 8 evenly
          // spaced labels (always keeping the last one) once there are more
          // than 10 points; month/year views (8 and 5 points) are untouched.
          const step = Math.max(1, Math.ceil(data.length / 8));
          if (data.length > 10 && index % step !== 0 && index !== data.length - 1) return null;
          return (
            <text key={item.label + index} x={pad.left + (index / Math.max(1, data.length - 1)) * innerW} y={height - 6} textAnchor="middle" className="fill-slate-400 text-[9.5px] font-medium">{item.label}</text>
          );
        })}
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

function ChartCard({ title, subtitle, children, className, delay = 0, headerRight }) {
  return (
    <motion.section
      initial={{ opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ ...spring, delay }}
      className={cx(glass, "min-w-0 p-5", className)}
    >
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-[15px] font-semibold tracking-[-0.015em] text-slate-950">{title}</h2>
          {subtitle ? <p className="mt-0.5 text-[12px] text-slate-400">{subtitle}</p> : null}
        </div>
        {headerRight ? <div className="shrink-0">{headerRight}</div> : null}
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
function FilterDropdown({ value, onChange, options, placeholder, buttonClassName }) {
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
        className={cx(filterControl, "flex items-center gap-2 pr-9 text-left", buttonClassName || "min-w-[150px]")}
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

const LEDGER_STATUS_TONE = {
  Unpaid: "bg-slate-100 text-slate-600 ring-slate-200",
  "Partially Paid": "bg-amber-50 text-amber-600 ring-amber-100",
  Paid: "bg-emerald-50 text-emerald-600 ring-emerald-100",
};

// Historical notepad entries are read-only and excluded from financial
// totals until an administrator classifies them into a real invoice/payment.
function ImportReviewLedgerSection() {
  const [entries, setEntries] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    api.get("/leads/ledger/import-review")
      .then((response) => { if (active) setEntries(response.data.data); })
      .catch((requestError) => active && setError(requestError.response?.data?.message || "Import review ledger could not be loaded."));
    return () => { active = false; };
  }, []);

  const totals = useMemo(() => {
    if (!entries) return { owed: 0, paid: 0 };
    return entries.reduce((sum, entry) => ({ owed: sum.owed + Number(entry.amountOwed), paid: sum.paid + Number(entry.amountPaid) }), { owed: 0, paid: 0 });
  }, [entries]);

  return (
    <motion.section initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={spring} className={cx(glass, "overflow-hidden p-5 sm:p-7")}>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold text-slate-950">Historical ledger review</h2>
          <p className="mt-1 text-sm text-slate-500">Historical entries awaiting classification. They are not included in totals and can no longer be edited as financial records.</p>
        </div>
        {entries?.length ? (
          <div className="flex gap-4 text-sm">
            <div><p className="text-xs text-slate-400">Owed</p><p className="font-semibold text-slate-900">{money.format(totals.owed)}</p></div>
            <div><p className="text-xs text-slate-400">Paid</p><p className="font-semibold text-emerald-600">{money.format(totals.paid)}</p></div>
          </div>
        ) : null}
      </div>

      {error ? <p className="mt-4 text-sm text-rose-600">{error}</p> : null}
      {!error && !entries ? <p className="mt-4 text-sm text-slate-500">Loading…</p> : null}
      {entries && !entries.length ? <p className="mt-4 text-sm text-slate-500">No ledger entries recorded for Import Review leads yet.</p> : null}

      {entries?.length ? (
        <div className="mt-5 overflow-x-auto rounded-2xl border border-slate-200/70">
          <table className="w-full min-w-[640px] border-collapse text-left text-sm">
            <thead><tr className="border-b border-slate-200 bg-slate-50/70 text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500"><th className="px-4 py-3">Lead</th><th className="px-4 py-3">Label</th><th className="px-4 py-3">Owed</th><th className="px-4 py-3">Paid</th><th className="px-4 py-3">Status</th></tr></thead>
            <tbody>{entries.map((entry, index) => (
              <tr key={entry.id} className={cx("text-slate-700", index ? "border-t border-slate-100" : "")}>
                <td className="px-4 py-3"><p className="font-medium text-slate-900">{entry.client?.fullName || leadName(entry.lead || {}) || "Unlinked record"}</p><p className="text-xs text-slate-400">{entry.client?.clientNumber || entry.lead?.leadNumber || entry.case?.caseType || "Historical import"}</p></td>
                <td className="px-4 py-3">{entry.label}</td>
                <td className="px-4 py-3 font-medium">{money.format(Number(entry.amountOwed))}</td>
                <td className="px-4 py-3 font-medium text-emerald-600">{money.format(Number(entry.amountPaid))}</td>
                <td className="px-4 py-3"><span className={cx("inline-flex rounded-full px-2.5 py-1 text-[11px] font-semibold ring-1 ring-inset", LEDGER_STATUS_TONE[entry.status] || LEDGER_STATUS_TONE.Unpaid)}>{entry.status}</span></td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      ) : null}
    </motion.section>
  );
}

function CashClosingSection({ onChanged }) {
  const today = localInputDate();
  const [day, setDay] = useState(today);
  const [data, setData] = useState(null);
  const [countedAmount, setCountedAmount] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [withdrawalBusy, setWithdrawalBusy] = useState(false);
  const [withdrawalKey, setWithdrawalKey] = useState(newCashWithdrawalKey);
  const [withdrawal, setWithdrawal] = useState({ amount: "", reference: "", note: "", confirmed: false });

  async function load(value = day) {
    setBusy(true); setError(""); setNotice(""); setData(null); setCountedAmount(""); setNote("");
    setWithdrawal({ amount: "", reference: "", note: "", confirmed: false });
    setWithdrawalKey(newCashWithdrawalKey());
    try {
      const next = await getCashClosing(value);
      setData(next); setCountedAmount(next.closing ? String(Number(next.closing.countedAmount)) : ""); setNote(next.closing?.note || "");
    } catch (reason) { setError(reason.response?.data?.message || "Cash closing could not be loaded."); }
    finally { setBusy(false); }
  }
  useEffect(() => { load(day); }, [day]); // eslint-disable-line react-hooks/exhaustive-deps

  async function closeDay(event) {
    event.preventDefault(); setBusy(true); setError(""); setNotice("");
    try {
      setData(await closeCashLedger({ day, countedAmount, note }));
      setNotice("Cash closing saved.");
      onChanged?.();
    }
    catch (reason) { setError(reason.response?.data?.message || "Cash closing could not be saved."); }
    finally { setBusy(false); }
  }

  async function postWithdrawal(event) {
    event.preventDefault(); setWithdrawalBusy(true); setError(""); setNotice("");
    try {
      const next = await withdrawCashLedger({
        day,
        amount: withdrawal.amount,
        reference: withdrawal.reference,
        note: withdrawal.note,
        idempotencyKey: withdrawalKey,
      });
      setData(next);
      setWithdrawal({ amount: "", reference: "", note: "", confirmed: false });
      setWithdrawalKey(newCashWithdrawalKey());
      setNotice(next.reused ? "This withdrawal was already recorded; no duplicate was created." : "Withdrawal recorded and cash on hand updated.");
      onChanged?.();
    }
    catch (reason) { setError(reason.response?.data?.message || "Cash withdrawal could not be recorded."); }
    finally { setWithdrawalBusy(false); }
  }

  const hasCountedAmount = countedAmount !== "";
  const variance = hasCountedAmount ? Number(countedAmount) - Number(data?.expectedAmount || 0) : null;
  const withdrawalAmount = Number(withdrawal.amount);
  const availableCash = Number(data?.expectedAmount || 0);
  const withdrawalDisabled = withdrawalBusy
    || !data
    || Boolean(data.closing)
    || !withdrawal.confirmed
    || !withdrawal.note.trim()
    || !Number.isFinite(withdrawalAmount)
    || withdrawalAmount <= 0
    || withdrawalAmount > availableCash;

  return <motion.section initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className={cx(glass, "overflow-hidden p-5 sm:p-7")}>
    <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between"><div><div className="flex items-center gap-2"><Scale className="h-5 w-5 text-emerald-600" /><h2 className="text-lg font-semibold text-slate-950">CaseDesk Cash closing</h2></div><p className="mt-1 text-sm text-slate-500">Track receipts, refunds, withdrawals, and the physical cash balance.</p></div><input type="date" max={today} value={day} onChange={(event) => setDay(event.target.value)} className={filterControl} /></div>
    {error ? <p className="mt-4 rounded-2xl bg-rose-50 p-3 text-sm text-rose-700">{error}</p> : null}
    {notice ? <p className="mt-4 rounded-2xl bg-emerald-50 p-3 text-sm text-emerald-700">{notice}</p> : null}
    <p className="mt-4 text-xs text-slate-400">Opening balance carries forward from your last closing (or $0 if you've never closed cash before) — "System cash" is what should be in the drawer right now, not just what moved today.</p>
    <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-5"><div className="rounded-2xl bg-slate-50 p-4"><p className="text-xs font-semibold text-slate-400">Opening balance</p><p className="mt-1 text-xl font-semibold text-slate-950">{money.format(Number(data?.openingBalance || 0))}</p></div><div className="rounded-2xl bg-slate-50 p-4"><p className="text-xs font-semibold text-slate-400">System cash (running total)</p><p className="mt-1 text-xl font-semibold text-slate-950">{money.format(availableCash)}</p></div><div className="rounded-2xl bg-slate-50 p-4"><p className="text-xs font-semibold text-slate-400">Receipts</p><p className="mt-1 text-xl font-semibold text-slate-950">{data?.receiptCount || 0}</p></div><div className="rounded-2xl bg-slate-50 p-4"><p className="text-xs font-semibold text-slate-400">Cash refunds</p><p className="mt-1 text-xl font-semibold text-slate-950">{data?.refundCount || 0}</p></div><div className="rounded-2xl bg-slate-50 p-4"><p className="text-xs font-semibold text-slate-400">Withdrawals</p><p className="mt-1 text-xl font-semibold text-slate-950">{data?.withdrawalCount || 0}</p></div></div>

    <form onSubmit={postWithdrawal} className="mt-5 rounded-[1.4rem] border border-amber-100 bg-amber-50/60 p-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between"><div><div className="flex items-center gap-2"><Landmark className="h-4 w-4 text-amber-700" /><h3 className="text-sm font-semibold text-slate-900">Withdraw cash</h3></div><p className="mt-1 text-xs text-slate-500">For a bank deposit or other physical cash removal. This immediately reduces cash on hand and remains in history.</p></div><p className="shrink-0 text-xs font-semibold text-amber-800">Available: {money.format(availableCash)}</p></div>
      {data?.closing ? <p className="mt-3 rounded-xl bg-white/80 px-3 py-2 text-xs text-amber-800">This date is closed. Choose the next open cash date to record a withdrawal.</p> : null}
      <div className="mt-4 grid gap-3 lg:grid-cols-[0.65fr_1fr_1.5fr]">
        <label className="text-xs font-semibold text-slate-600">Amount<input required type="number" min="0.01" max={Math.max(0, availableCash)} step="0.01" value={withdrawal.amount} onChange={(event) => setWithdrawal((value) => ({ ...value, amount: event.target.value }))} placeholder="0.00" className="mt-2 h-11 w-full rounded-2xl border border-white bg-white px-3.5 text-sm outline-none focus:ring-4 focus:ring-amber-100" /></label>
        <label className="text-xs font-semibold text-slate-600">Deposit / receipt reference <span className="font-normal text-slate-400">(optional)</span><input value={withdrawal.reference} onChange={(event) => setWithdrawal((value) => ({ ...value, reference: event.target.value }))} maxLength="100" placeholder="Bank deposit slip or receipt #" className="mt-2 h-11 w-full rounded-2xl border border-white bg-white px-3.5 text-sm outline-none focus:ring-4 focus:ring-amber-100" /></label>
        <label className="text-xs font-semibold text-slate-600">Reason<input required value={withdrawal.note} onChange={(event) => setWithdrawal((value) => ({ ...value, note: event.target.value }))} maxLength="500" placeholder="Example: Deposited cash into business bank account" className="mt-2 h-11 w-full rounded-2xl border border-white bg-white px-3.5 text-sm outline-none focus:ring-4 focus:ring-amber-100" /></label>
      </div>
      <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><label className="flex items-start gap-2 text-xs leading-5 text-slate-600"><input type="checkbox" checked={withdrawal.confirmed} onChange={(event) => setWithdrawal((value) => ({ ...value, confirmed: event.target.checked }))} className="mt-0.5 h-4 w-4 rounded border-slate-300 text-amber-600 focus:ring-amber-200" /><span>I confirm this cash has physically left the drawer.</span></label><button type="submit" disabled={withdrawalDisabled} className="flex h-11 items-center justify-center gap-2 rounded-full bg-amber-600 px-5 text-sm font-semibold text-white transition hover:bg-amber-700 disabled:cursor-not-allowed disabled:opacity-40">{withdrawalBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Landmark className="h-4 w-4" />}Post withdrawal</button></div>
      {withdrawal.amount && withdrawalAmount > availableCash ? <p className="mt-2 text-xs font-semibold text-rose-600">Withdrawal cannot exceed the available cash balance.</p> : null}
    </form>

    {data?.withdrawals?.length ? <div className="mt-5"><h3 className="text-sm font-semibold text-slate-900">Withdrawals on {formatDate(`${day}T12:00:00`)}</h3><div className="mt-2 space-y-2">{data.withdrawals.map((row) => <div key={row.id} className="flex flex-col gap-2 rounded-2xl border border-slate-200 bg-white/80 p-4 sm:flex-row sm:items-start sm:justify-between"><div><p className="text-sm font-semibold text-slate-900">{row.note}</p><p className="mt-1 text-xs text-slate-500">{row.reference ? `Reference ${row.reference} · ` : ""}Recorded by {row.createdBy?.fullName || "Unknown user"}</p></div><p className="shrink-0 text-sm font-semibold tabular-nums text-rose-600">-{money.format(Number(row.amount))}</p></div>)}</div></div> : null}

    <form onSubmit={closeDay} className="mt-5 grid gap-4 rounded-[1.4rem] border border-emerald-100 bg-emerald-50/60 p-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end"><label className="text-xs font-semibold text-slate-600">Physical cash counted<input required type="number" min="0" step="0.01" value={countedAmount} onChange={(event) => setCountedAmount(event.target.value)} className="mt-2 h-11 w-full rounded-2xl border border-white bg-white px-3.5 text-sm outline-none focus:ring-4 focus:ring-emerald-100" /></label><label className="text-xs font-semibold text-slate-600">Closing note<input value={note} onChange={(event) => setNote(event.target.value)} maxLength="500" placeholder="Optional context for a variance" className="mt-2 h-11 w-full rounded-2xl border border-white bg-white px-3.5 text-sm outline-none focus:ring-4 focus:ring-emerald-100" /></label><button type="submit" disabled={busy || !data || countedAmount === ""} className="flex h-11 items-center justify-center gap-2 rounded-full bg-slate-950 px-5 text-sm font-semibold text-white disabled:opacity-40">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}{data?.closing ? "Update closing" : "Close cash"}</button>{variance === null ? <p className="text-xs font-medium text-slate-500 sm:col-span-3">Enter the physical cash count to calculate the variance.</p> : <p className={`text-xs font-semibold sm:col-span-3 ${Math.abs(variance) < 0.01 ? "text-emerald-700" : "text-amber-700"}`}>Current variance: {money.format(variance)}{data?.closing?.closedBy?.fullName ? ` · last closed by ${data.closing.closedBy.fullName}` : ""}</p>}</form>
  </motion.section>;
}

function approvalTarget(item) {
  if (item.entryType === "invoice_refund") return `Cash refund${item.caseInvoice?.qbInvoiceNumber ? ` · Invoice #${item.caseInvoice.qbInvoiceNumber}` : ""} · ${item.description || "No reason given"}`;
  if (item.appointment) return `${item.appointment.subject || "Consultation"} · ${new Date(item.appointment.startsAt).toLocaleString("en-CA", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}`;
  if (item.caseInvoice) return `${item.caseInvoice.qbInvoiceNumber ? `Invoice #${item.caseInvoice.qbInvoiceNumber} · ` : ""}${item.caseInvoice.description}`;
  if (item.case) return `${item.case.caseType} · ${item.description || "New charge"}`;
  return item.description || "Payment";
}

function approvalMethodLabel(method) {
  if (method === "ETransfer") return "E-transfer";
  if (["Card", "Cash"].includes(method)) return method;
  return method ? "Other non-cash" : "Unknown";
}

function PaymentApprovalDrawer({ item, busy, error, onClose, onApprove, onReject }) {
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  if (!item) return null;
  const canReview = ["Pending", "Failed"].includes(item.status);
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[500] flex justify-end bg-slate-950/25 backdrop-blur-[3px]" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}>
      <motion.aside initial={{ x: 70, opacity: 0 }} animate={{ x: 0, opacity: 1 }} exit={{ x: 70, opacity: 0 }} transition={spring} className="flex h-full w-full max-w-[520px] flex-col overflow-hidden border-l border-white/70 bg-[#f8fafc]/95 shadow-[-30px_0_90px_rgba(15,23,42,0.22)] backdrop-blur-2xl">
        <header className="flex items-center justify-between border-b border-white bg-white/80 px-6 py-4">
          <div className="flex min-w-0 items-center gap-3"><span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-slate-950 text-white"><ClipboardCheck className="h-4 w-4" /></span><div className="min-w-0"><p className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">Payment review</p><h2 className="truncate text-lg font-semibold text-slate-950">{item.client?.fullName || item.appointment?.guestName || "Unlinked client"}</h2></div></div>
          <button type="button" onClick={onClose} disabled={busy} className="flex h-9 w-9 items-center justify-center rounded-full text-slate-500 transition hover:bg-slate-100"><X className="h-5 w-5" /></button>
        </header>
        <div className="flex-1 space-y-4 overflow-y-auto px-6 py-5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <section className="rounded-[1.5rem] border border-white bg-white p-5 shadow-sm">
            <div className="flex items-start justify-between gap-4"><div><p className="text-xs font-semibold text-slate-500">Amount reported</p><p className="mt-1 text-3xl font-semibold tracking-tight text-slate-950">{money.format(Number(item.amount))}</p></div><span className={`rounded-full px-3 py-1 text-[11px] font-semibold ${item.status === "Approved" ? "bg-emerald-50 text-emerald-700" : item.status === "Rejected" ? "bg-rose-50 text-rose-700" : item.status === "Failed" ? "bg-rose-50 text-rose-700" : "bg-amber-50 text-amber-700"}`}>{item.status}</span></div>
            <div className="mt-5 grid grid-cols-2 gap-3 text-xs"><div className="rounded-2xl bg-slate-50 p-3"><p className="text-slate-400">Method</p><p className="mt-1 font-semibold text-slate-800">{approvalMethodLabel(item.method)}</p></div><div className="rounded-2xl bg-slate-50 p-3"><p className="text-slate-400">Payment date</p><p className="mt-1 font-semibold text-slate-800">{formatDate(item.paymentDate)}</p></div></div>
            <div className="mt-3 rounded-2xl bg-slate-50 p-3"><p className="text-xs text-slate-400">Apply to</p><p className="mt-1 text-sm font-semibold text-slate-800">{approvalTarget(item)}</p></div>
            {item.transactionReference ? <div className="mt-3 rounded-2xl bg-slate-50 p-3"><p className="text-xs text-slate-400">Transaction / receipt</p><p className="mt-1 text-sm font-semibold text-slate-800">{item.transactionReference}</p></div> : null}
            {item.note ? <div className="mt-3 rounded-2xl bg-slate-50 p-3"><p className="text-xs text-slate-400">Frontdesk note</p><p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-slate-700">{item.note}</p></div> : null}
          </section>
          <section className={`rounded-[1.5rem] border p-4 ${item.method === "Cash" ? "border-violet-200 bg-violet-50" : "border-sky-200 bg-sky-50"}`}>
            <p className={`text-sm font-semibold ${item.method === "Cash" ? "text-violet-900" : "text-sky-900"}`}>{item.method === "Cash" ? "CaseDesk-only cash record" : "QuickBooks posting after approval"}</p>
            <p className={`mt-1 text-xs leading-5 ${item.method === "Cash" ? "text-violet-700" : "text-sky-700"}`}>{item.method === "Cash" ? "Approving marks this payment received in CaseDesk. No cash payment is created in QuickBooks." : "Approving validates the entry, then creates the linked QuickBooks payment. A provider failure leaves it in Failed so it can be retried safely."}</p>
          </section>
          <section className="rounded-[1.5rem] border border-white bg-white p-4 shadow-sm"><p className="text-xs text-slate-400">Submitted by</p><p className="mt-1 text-sm font-semibold text-slate-800">{item.submittedBy?.fullName || "Staff member"} · {item.sourceRole}</p><p className="mt-1 text-xs text-slate-400">{new Date(item.createdAt).toLocaleString("en-CA", { dateStyle: "medium", timeStyle: "short" })}</p>{item.processingError ? <p className="mt-3 rounded-2xl bg-rose-50 p-3 text-xs leading-5 text-rose-700">{item.processingError}</p> : null}{item.rejectionReason ? <p className="mt-3 rounded-2xl bg-rose-50 p-3 text-xs leading-5 text-rose-700"><strong>Rejected:</strong> {item.rejectionReason}</p> : null}</section>
          {rejecting && canReview ? <section className="rounded-[1.5rem] border border-rose-200 bg-rose-50 p-4"><label className="text-xs font-semibold text-rose-900">Why is this being returned?<textarea autoFocus value={reason} onChange={(event) => setReason(event.target.value)} rows="4" maxLength="500" className="mt-2 w-full resize-none rounded-2xl border border-rose-200 bg-white px-3.5 py-3 text-sm text-slate-800 outline-none focus:ring-4 focus:ring-rose-100" placeholder="Explain what the frontdesk should correct" /></label><div className="mt-3 flex gap-2"><button type="button" onClick={() => setRejecting(false)} className="h-10 flex-1 rounded-full bg-white text-xs font-semibold text-slate-600">Keep reviewing</button><button type="button" disabled={busy || !reason.trim()} onClick={() => onReject(reason)} className="h-10 flex-1 rounded-full bg-rose-600 text-xs font-semibold text-white disabled:opacity-40">Reject payment</button></div></section> : null}
          {error ? <p className="rounded-2xl border border-rose-200 bg-rose-50 p-3 text-xs leading-5 text-rose-700">{error}</p> : null}
        </div>
        {canReview && !rejecting ? <footer className="grid grid-cols-2 gap-2 border-t border-white bg-white/85 p-4"><button type="button" disabled={busy} onClick={() => setRejecting(true)} className="h-12 rounded-full border border-rose-200 bg-white text-sm font-semibold text-rose-700 disabled:opacity-40">Reject</button><button type="button" disabled={busy} onClick={onApprove} className="flex h-12 items-center justify-center gap-2 rounded-full bg-slate-950 text-sm font-semibold text-white disabled:opacity-40">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}Approve</button></footer> : null}
      </motion.aside>
    </motion.div>
  );
}

// A QuickBooks refund request that never completed — staff never finished
// it in QuickBooks, or the automatic matcher found more than one
// same-amount pending refund for the client and refused to guess which one
// it was. Cash refunds never appear here — they complete synchronously.
function StuckInvoiceRefundsSection({ onChanged }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState("");
  const [error, setError] = useState("");

  const load = async () => {
    setLoading(true);
    try {
      setRows(await getStuckInvoiceRefunds());
    } catch (reason) {
      setError(reason.response?.data?.message || "Stuck refunds could not be loaded.");
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function markFailed(id) {
    const note = window.prompt("Optional note — why is this refund being marked failed?") || "";
    setBusyId(id);
    setError("");
    try {
      await failInvoiceRefund(id, note);
      await load();
      onChanged?.();
    } catch (reason) {
      setError(reason.response?.data?.message || "This refund could not be marked failed.");
    } finally {
      setBusyId("");
    }
  }

  if (loading || !rows.length) return null;
  return (
    <motion.section initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} className={cx(glass, "mb-5 overflow-hidden border-amber-200/70 bg-amber-50/40 p-5 sm:p-6")}>
      <div className="flex items-center gap-2"><ShieldAlert className="h-5 w-5 text-amber-600" /><h2 className="text-lg font-semibold text-slate-950">Refunds awaiting QuickBooks</h2><span className="rounded-full bg-amber-500 px-2 py-0.5 text-[10px] font-bold text-white">{rows.length}</span></div>
      <p className="mt-1 text-sm text-slate-600">These were requested but never confirmed as completed in QuickBooks. Finish the refund in QuickBooks, or mark it failed if it was never actually completed.</p>
      {error ? <p className="mt-2 text-xs text-rose-600">{error}</p> : null}
      <div className="mt-4 divide-y divide-amber-100 rounded-2xl border border-amber-100 bg-white/70">
        {rows.map((row) => (
          <div key={row.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-slate-900">{row.client?.fullName || "Unlinked client"} · {row.invoice?.invoiceNumber || row.invoice?.qbInvoiceNumber || "Invoice"}</p>
              <p className="mt-0.5 truncate text-xs text-slate-500">{row.reason || "No reason given"} · requested {row.ageDays === 0 ? "today" : `${row.ageDays} day${row.ageDays === 1 ? "" : "s"} ago`}{row.requestedBy ? ` by ${row.requestedBy.fullName}` : ""}</p>
            </div>
            <div className="flex shrink-0 items-center gap-3">
              <span className="text-sm font-semibold tabular-nums text-slate-950">{money.format(Number(row.amount))}</span>
              <button type="button" disabled={busyId === row.id} onClick={() => markFailed(row.id)} className="rounded-full border border-rose-200 bg-white px-3 py-1.5 text-xs font-semibold text-rose-700 transition hover:bg-rose-50 disabled:opacity-50">{busyId === row.id ? "Saving…" : "Mark failed"}</button>
            </div>
          </div>
        ))}
      </div>
    </motion.section>
  );
}

function PaymentApprovalsSection({ selectedId, onSelected, onChanged }) {
  const [status, setStatus] = useState("Pending");
  const [data, setData] = useState({ rows: [], total: 0, pendingCount: 0 });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const result = await getPaymentApprovals({ status, pageSize: 100 });
      if (selectedId && !result.rows.some((item) => item.id === selectedId)) {
        const all = await getPaymentApprovals({ status: "all", pageSize: 100 });
        const selected = all.rows.find((item) => item.id === selectedId);
        setData(selected ? { ...result, rows: [selected, ...result.rows] } : result);
      } else setData(result);
    } catch (reason) { setError(reason.response?.data?.message || "Payment approvals could not be loaded."); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, [status, selectedId]); // eslint-disable-line react-hooks/exhaustive-deps
  const selected = data.rows.find((item) => item.id === selectedId) || null;
  async function act(kind, reason) {
    setBusy(true); setError("");
    try { kind === "approve" ? await approvePaymentApproval(selected.id) : await rejectPaymentApproval(selected.id, reason); onSelected(""); await load(); onChanged?.(); }
    catch (failure) { setError(failure.response?.data?.message || `Payment could not be ${kind === "approve" ? "approved" : "rejected"}.`); }
    finally { setBusy(false); }
  }
  return <>
    <motion.section initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} className={cx(glass, "overflow-hidden p-5 sm:p-6")}>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between"><div><div className="flex items-center gap-2"><ClipboardCheck className="h-5 w-5 text-violet-600" /><h2 className="text-xl font-semibold text-slate-950">Payment approvals</h2>{data.pendingCount ? <span className="rounded-full bg-rose-500 px-2 py-0.5 text-[10px] font-bold text-white">{data.pendingCount}</span> : null}</div><p className="mt-1 text-sm text-slate-500">Review money reported by frontdesk before it changes financial records.</p></div><div className="flex rounded-2xl bg-slate-100 p-1">{["Pending", "Approved", "Rejected", "Failed"].map((value) => <button key={value} type="button" onClick={() => setStatus(value)} className={`h-9 rounded-xl px-3 text-xs font-semibold transition ${status === value ? "bg-white text-slate-950 shadow-sm" : "text-slate-500"}`}>{value}</button>)}</div></div>
      <div className="mt-5 overflow-hidden rounded-[1.3rem] border border-slate-200/70 bg-white/65">
        {loading ? <div className="flex h-40 items-center justify-center"><Loader2 className="h-5 w-5 animate-spin text-slate-400" /></div> : error && !data.rows.length ? <p className="p-8 text-center text-sm text-rose-600">{error}</p> : data.rows.length ? <div className="divide-y divide-slate-100">{data.rows.map((item) => <button key={item.id} type="button" onClick={() => onSelected(item.id)} className="grid w-full gap-3 px-4 py-4 text-left transition hover:bg-sky-50/50 sm:grid-cols-[1.1fr_1.4fr_auto_auto] sm:items-center"><div className="min-w-0"><p className="truncate text-sm font-semibold text-slate-900">{item.client?.fullName || item.appointment?.guestName || "Unlinked client"}</p><p className="mt-0.5 truncate text-xs text-slate-400">{item.submittedBy?.fullName || "Frontdesk"}</p></div><div className="min-w-0"><p className="truncate text-xs font-semibold text-slate-700">{approvalTarget(item)}</p><p className="mt-0.5 text-xs text-slate-400">{formatDate(item.paymentDate)}</p></div><div><p className="text-sm font-semibold tabular-nums text-slate-950">{money.format(Number(item.amount))}</p><p className={`mt-0.5 text-[10px] font-semibold ${item.method === "Cash" ? "text-violet-600" : "text-sky-600"}`}>{item.method === "Cash" ? "Cash · CaseDesk only" : `${approvalMethodLabel(item.method)} · QuickBooks`}</p></div><span className={`w-fit rounded-full px-2.5 py-1 text-[10px] font-bold ${item.status === "Approved" ? "bg-emerald-50 text-emerald-700" : item.status === "Rejected" || item.status === "Failed" ? "bg-rose-50 text-rose-700" : "bg-amber-50 text-amber-700"}`}>{item.status}</span></button>)}</div> : <div className="px-6 py-14 text-center"><ClipboardCheck className="mx-auto h-6 w-6 text-slate-300" /><p className="mt-3 text-sm font-semibold text-slate-700">No {status.toLowerCase()} payments</p><p className="mt-1 text-xs text-slate-400">Frontdesk submissions will appear here.</p></div>}
      </div>
    </motion.section>
    <AnimatePresence>{selected ? <PaymentApprovalDrawer item={selected} busy={busy} error={error} onClose={() => onSelected("")} onApprove={() => act("approve")} onReject={(reason) => act("reject", reason)} /> : null}</AnimatePresence>
  </>;
}

export default function Payments() {
  const { role } = useAuth();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedHoldId = searchParams.get("hold") || "";
  const selectedRefundId = searchParams.get("refund") || "";
  const selectedApprovalId = searchParams.get("approval") || "";
  const requestedView = searchParams.get("view");
  const view = requestedView === "import-review" ? "import-review" : requestedView === "cash-closing" && role === "admin" ? "cash-closing" : requestedView === "approvals" && role === "admin" ? "approvals" : "payments";
  const setView = (nextView) => {
    const next = new URLSearchParams(searchParams);
    if (["import-review", "approvals", "cash-closing"].includes(nextView)) next.set("view", nextView);
    else next.delete("view");
    if (nextView !== "approvals") next.delete("approval");
    setSearchParams(next);
  };
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
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [bucket, setBucket] = useState("");
  const [trendGranularity, setTrendGranularity] = useState("month");
  const [cashLedgerOpen, setCashLedgerOpen] = useState(false);
  const [syncFailuresOpen, setSyncFailuresOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [summaryLoading, setSummaryLoading] = useState(true);
  const [summaryError, setSummaryError] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const tableRef = useRef(null);

  // Every KPI box click resolves to one of these two actions: filter the
  // table to the transactions behind that number, or (for boxes with no
  // matching row shape — Cash On Hand, Sync Failures) open a detail drawer.
  // Clearing status/source/query keeps the resulting view unambiguous —
  // otherwise a stale manual filter could silently zero out the results.
  function applyBucket(nextBucket, { resetDates = false } = {}) {
    setView("payments");
    setStatus("");
    setSource("");
    setQuery("");
    if (resetDates) { setFrom(""); setTo(""); }
    setBucket(nextBucket);
    requestAnimationFrame(() => tableRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
  }

  // `active` guards against a stale response clobbering a newer one — two
  // overlapping requests (e.g. a quick month change, or refreshKey firing
  // mid-flight) previously had no ordering guarantee, so an older, slower
  // response landing last could silently overwrite correct, newer data
  // (CD-032). This mirrors the same guard the table-rows effect below
  // already had. A failed/empty response no longer falls back to a bare
  // `null` that renders as "$0" — it sets summaryError instead, which
  // KpiCard renders as an explicit "Couldn't load — retry" state.
  useEffect(() => {
    let active = true;
    setSummaryLoading(true);
    setSummaryError(false);
    getPaymentsOverviewSummary(month)
      .then((data) => { if (!active) return; setSummary(data); })
      .catch(() => { if (active) setSummaryError(true); })
      .finally(() => { if (active) setSummaryLoading(false); });
    return () => { active = false; };
  }, [refreshKey, month]);

  // Selecting a month scopes the transaction list to that month too, using
  // the same from/to filters the manual date pickers already drive — the
  // month picker is just a shortcut for "give me a full calendar month."
  // Editing from/to afterward is still fine; it just stops matching the
  // month picker exactly.
  useEffect(() => {
    if (!/^\d{4}-\d{2}$/.test(month)) return;
    const [year, monthNumber] = month.split("-").map(Number);
    const start = new Date(Date.UTC(year, monthNumber - 1, 1));
    const end = new Date(Date.UTC(year, monthNumber, 0)); // last day of month
    setFrom(start.toISOString().slice(0, 10));
    setTo(end.toISOString().slice(0, 10));
  }, [month]);

  function shiftMonth(delta) {
    setMonth((current) => {
      const [year, monthNumber] = (/^\d{4}-\d{2}$/.test(current) ? current : new Date().toISOString().slice(0, 7)).split("-").map(Number);
      const next = new Date(Date.UTC(year, monthNumber - 1 + delta, 1));
      return `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, "0")}`;
    });
  }

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    getPaymentsOverview({ status, source, query, from, to, bucket, page, pageSize })
      .then((data) => {
        if (!active) return;
        setRows(data.rows);
        setTotal(data.total);
      })
      .catch((reason) => active && setError(reason.response?.data?.message || "Payments could not be loaded."))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [status, source, query, from, to, bucket, page, refreshKey]);

  useEffect(() => { setPage(1); }, [status, source, query, from, to, bucket]);

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

  function selectApproval(id) {
    const next = new URLSearchParams(searchParams);
    next.set("view", "approvals");
    if (id) next.set("approval", id);
    else next.delete("approval");
    setSearchParams(next, { replace: true });
  }

  const monthDelta = useMemo(() => {
    if (!summary?.selectedMonth) return null;
    const { selectedMonth, previousMonth } = summary;
    // A growth badge next to a zero/unavailable current-period value is
    // meaningless (e.g. "+5400%" beside a card that hasn't loaded) — only
    // show it once we actually have a non-zero current figure to compare.
    if (!selectedMonth.collected) return null;
    if (!previousMonth?.collected) return "First collections this month";
    const change = ((selectedMonth.collected - previousMonth.collected) / previousMonth.collected) * 100;
    return `${change >= 0 ? "+" : ""}${Math.round(change)}% vs ${previousMonth.label}`;
  }, [summary]);

  const isCurrentMonth = month === new Date().toISOString().slice(0, 7);

  return (
    <main className="min-w-0 bg-[radial-gradient(circle_at_12%_-4%,rgba(56,130,246,0.10),transparent_36%),radial-gradient(circle_at_92%_16%,rgba(139,92,246,0.08),transparent_38%)] px-3 py-4 sm:px-5 lg:px-6">
      <div className="mx-auto flex w-full max-w-[1680px] min-w-0 flex-col gap-5">
        <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={spring} className={cx(glass, "relative z-30 overflow-visible p-5 sm:p-7 lg:p-8")}>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h1 className="text-3xl font-semibold tracking-tight text-slate-950 sm:text-4xl">Payments</h1>
              <p className="mt-2 max-w-2xl text-sm text-slate-500 sm:text-base">
                One source of truth across QuickBooks non-cash payments and CaseDesk Cash, with historical entries isolated for review.
              </p>
            </div>
            <FilterDropdown
              value={view}
              onChange={setView}
              options={[
                { value: "payments", label: "Payments" },
                ...(role === "admin" ? [{ value: "approvals", label: "Payment approvals" }] : []),
                ...(role === "admin" ? [{ value: "cash-closing", label: "Cash closing" }] : []),
                { value: "import-review", label: "Historical ledger review" },
              ]}
              placeholder="Payments"
            />
          </div>
          {view === "payments" ? (
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <div className="flex items-center gap-1 rounded-full border border-slate-200/70 bg-white/70 p-1">
                <button type="button" onClick={() => shiftMonth(-1)} aria-label="Previous month" className="flex h-7 w-7 items-center justify-center rounded-full text-slate-500 hover:bg-slate-100">‹</button>
                <input
                  type="month"
                  value={month}
                  onChange={(event) => event.target.value && setMonth(event.target.value)}
                  className="h-7 rounded-full border-none bg-transparent px-1 text-xs font-semibold text-slate-700 focus:outline-none"
                />
                <button type="button" onClick={() => shiftMonth(1)} aria-label="Next month" className="flex h-7 w-7 items-center justify-center rounded-full text-slate-500 hover:bg-slate-100">›</button>
              </div>
              {!isCurrentMonth ? (
                <button type="button" onClick={() => setMonth(new Date().toISOString().slice(0, 7))} className="text-xs font-semibold text-sky-600 hover:text-sky-700">
                  Jump to this month
                </button>
              ) : null}
              <p className="text-xs text-slate-400">"Collected", the month comparison, and the table below are scoped to this month. Total Collected, Cash On Hand, Pending Approval, and Sync Failures always reflect everything to date.</p>
            </div>
          ) : null}
        </motion.div>

        {view === "payments" ? (
        <>
        {summary?.legacyReviewCount > 0 ? (
          <motion.section initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} role="status" className="rounded-[1.5rem] border border-amber-200 bg-amber-50/90 px-5 py-4 shadow-[0_12px_34px_rgba(245,158,11,0.08)]">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div><p className="text-sm font-semibold text-amber-950">{summary.legacyReviewCount} historical ledger {summary.legacyReviewCount === 1 ? "entry needs" : "entries need"} classification</p><p className="mt-1 text-xs leading-5 text-amber-800">These records are isolated from all financial totals until they are verified and moved to QuickBooks or CaseDesk Cash.</p></div><button type="button" onClick={() => setView("import-review")} className="h-9 shrink-0 rounded-full bg-amber-900 px-4 text-xs font-semibold text-white">Review entries</button></div>
          </motion.section>
        ) : null}
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
          <KpiCard label="Total Collected (all-time)" value={summary?.totalCollected ?? 0} icon={HandCoins} tint="bg-emerald-50 text-emerald-500 ring-emerald-100" delay={0.05} onClick={() => applyBucket("collected", { resetDates: true })} pending={summaryLoading && !summary} failed={summaryError && !summary} />
          <KpiCard label="Outstanding Balance" value={summary?.outstandingBalance ?? 0} icon={Wallet} tint="bg-amber-50 text-amber-500 ring-amber-100" delay={0.1} onClick={() => applyBucket("outstanding", { resetDates: true })} pending={summaryLoading && !summary} failed={summaryError && !summary} />
          <KpiCard label={`Collected · ${summary?.selectedMonth?.label || "This month"}`} value={summary?.selectedMonth?.collected ?? 0} icon={TrendingUp} tint="bg-sky-50 text-sky-500 ring-sky-100" delay={0.15} footnote={monthDelta} onClick={() => applyBucket("collected")} pending={summaryLoading && !summary} failed={summaryError && !summary} />
          <KpiCard label="Overdue Invoices" value={summary?.overdueCount ?? 0} format={(v) => String(Math.round(v))} icon={ShieldAlert} tint="bg-rose-50 text-rose-500 ring-rose-100" delay={0.2} onClick={() => applyBucket("overdue", { resetDates: true })} pending={summaryLoading && !summary} failed={summaryError && !summary} />
        </div>

        <div className="grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-3">
          <KpiCard label="Cash On Hand" value={summary?.cashOnHand ?? 0} icon={Banknote} tint="bg-violet-50 text-violet-500 ring-violet-100" delay={0.22} footnote="Since last cash closing · click for detail" onClick={() => setCashLedgerOpen(true)} pending={summaryLoading && !summary} failed={summaryError && !summary} />
          <KpiCard label="Pending Approval" value={summary?.pendingApprovalCount ?? 0} format={(v) => String(Math.round(v))} icon={ClipboardCheck} tint="bg-amber-50 text-amber-500 ring-amber-100" delay={0.26} onClick={() => setView("approvals")} pending={summaryLoading && !summary} failed={summaryError && !summary} />
          <KpiCard label="QuickBooks Sync Failures" value={summary?.quickBooksSyncFailures ?? 0} format={(v) => String(Math.round(v))} icon={RefreshCw} tint="bg-rose-50 text-rose-500 ring-rose-100" delay={0.3} onClick={() => setSyncFailuresOpen(true)} pending={summaryLoading && !summary} failed={summaryError && !summary} />
        </div>
        {summaryError && !summary ? (
          <button
            type="button"
            onClick={() => setRefreshKey((key) => key + 1)}
            className="self-start rounded-full border border-rose-200 bg-rose-50 px-4 py-2 text-xs font-semibold text-rose-700 hover:bg-rose-100"
          >
            Payments summary failed to load — retry
          </button>
        ) : null}

        <MonthComparisonPanel summary={summary} delay={0.34} onSelectBucket={(nextBucket) => applyBucket(nextBucket)} />

        <div className="grid min-w-0 grid-cols-1 gap-4 xl:grid-cols-12">
          <ChartCard
            title="Collections Trend"
            subtitle={`Invoiced vs collected, ${TREND_RANGE_LABEL[trendGranularity]}`}
            className="xl:col-span-5"
            delay={0.15}
            headerRight={
              <FilterDropdown
                value={trendGranularity}
                onChange={setTrendGranularity}
                buttonClassName="min-w-[104px] py-1.5 text-xs"
                options={[
                  { value: "day", label: "Day" },
                  { value: "month", label: "Month" },
                  { value: "year", label: "Year" },
                ]}
              />
            }
          >
            {summary ? <TrendChart data={summary.trend?.[trendGranularity] || []} /> : <div className="flex h-[190px] items-center justify-center"><Loader2 className="h-5 w-5 animate-spin text-slate-300" /></div>}
          </ChartCard>
          <ChartCard title="Payment Status" subtitle="Share of invoiced value by status" className="xl:col-span-4" delay={0.22}>
            {summary ? <StatusDonut breakdown={summary.statusBreakdown} /> : <div className="flex h-[168px] items-center justify-center"><Loader2 className="h-5 w-5 animate-spin text-slate-300" /></div>}
          </ChartCard>
          <ChartCard title="By Ledger" subtitle="QuickBooks and CaseDesk Cash, with legacy records separated" className="xl:col-span-3" delay={0.29}>
            {summary ? <TypeBars breakdown={summary.typeBreakdown} /> : <div className="flex h-[168px] items-center justify-center"><Loader2 className="h-5 w-5 animate-spin text-slate-300" /></div>}
          </ChartCard>
        </div>

        <motion.section ref={tableRef} initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ ...spring, delay: 0.3 }} className={cx(glass, "min-w-0 overflow-hidden p-4 sm:p-5")}>
          {bucket ? (
            <div className="mb-3 flex items-center gap-2">
              <span className="inline-flex items-center gap-2 rounded-full bg-sky-50 px-3 py-1.5 text-xs font-semibold text-sky-700 ring-1 ring-sky-100">
                Showing: {BUCKET_LABELS[bucket] || bucket}
                <button type="button" onClick={() => setBucket("")} aria-label="Clear filter" className="rounded-full p-0.5 hover:bg-sky-100">
                  <X className="h-3 w-3" />
                </button>
              </span>
            </div>
          ) : null}
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
                          {row.invoiceNumber ? <p className="mt-1 text-[11px] font-semibold text-sky-700">Invoice #{row.invoiceNumber}</p> : null}
                          {row.ledger ? <span className={`mt-1 inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold ${row.ledger === "QuickBooks" ? "bg-sky-50 text-sky-700" : row.ledger === "CaseDesk Cash" ? "bg-emerald-50 text-emerald-700" : "bg-orange-50 text-orange-700"}`}>{row.ledger}</span> : null}
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
                          <div className="flex min-w-[148px] flex-col items-start gap-1">
                            <span className={cx("inline-flex h-7 items-center rounded-full px-3 text-[11px] font-semibold ring-1", STATUS_TONE[row.status] || STATUS_TONE.Open)}>
                              {STATUS_LABEL[row.status] || row.status}
                            </span>
                            {STATUS_FLAGS.filter((flag) => row[flag.key]).length || (row.status === "Paid" && row.qbRefundUrl) ? (
                              <div className="mt-0.5 flex flex-col items-start gap-1 border-l-2 border-slate-100 pl-2">
                                {STATUS_FLAGS.filter((flag) => row[flag.key]).map((flag) => (
                                  <span key={flag.key} title={flag.title(row)} className={cx("inline-flex items-center gap-1 text-[10.5px] font-semibold leading-tight", flag.tone)}>
                                    <flag.Icon className="h-3 w-3 shrink-0" /> {flag.label}
                                  </span>
                                ))}
                                {row.status === "Paid" && row.qbRefundUrl ? (
                                  <a
                                    href={row.qbRefundUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    onClick={(event) => event.stopPropagation()}
                                    title="Opens the transaction directly in QuickBooks — CaseDesk doesn't process the refund itself, this just skips the search."
                                    className="inline-flex items-center gap-1 text-[10.5px] font-semibold text-sky-700 underline decoration-sky-200 underline-offset-2 transition hover:text-sky-800 hover:decoration-sky-400"
                                  >
                                    <ExternalLink className="h-3 w-3 shrink-0" /> Refund in QuickBooks
                                  </a>
                                ) : null}
                              </div>
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
        </>
        ) : view === "approvals" ? (
          <>
            <StuckInvoiceRefundsSection onChanged={() => setRefreshKey((value) => value + 1)} />
            <PaymentApprovalsSection selectedId={selectedApprovalId} onSelected={selectApproval} onChanged={() => setRefreshKey((value) => value + 1)} />
          </>
        ) : view === "cash-closing" ? (
          <CashClosingSection onChanged={() => setRefreshKey((value) => value + 1)} />
        ) : (
          <ImportReviewLedgerSection />
        )}
      </div>
      <AnimatePresence>{selectedHoldId ? <PaymentHoldDrawer key={selectedHoldId} holdId={selectedHoldId} onClose={closePaymentHold} onChanged={() => setRefreshKey((value) => value + 1)} /> : null}</AnimatePresence>
      <AnimatePresence>{selectedRefundId ? <RefundReviewDrawer key={selectedRefundId} refundReceiptId={selectedRefundId} onClose={closeRefundReview} /> : null}</AnimatePresence>
      <AnimatePresence>{cashLedgerOpen ? <CashLedgerDrawer onClose={() => setCashLedgerOpen(false)} /> : null}</AnimatePresence>
      <AnimatePresence>{syncFailuresOpen ? <SyncFailuresDrawer onClose={() => setSyncFailuresOpen(false)} /> : null}</AnimatePresence>
    </main>
  );
}
