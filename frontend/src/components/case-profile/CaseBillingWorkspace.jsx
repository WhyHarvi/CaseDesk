import { AnimatePresence, motion } from "framer-motion";
import {
  AlertTriangle,
  Banknote,
  Check,
  Copy,
  Download,
  Landmark,
  Loader2,
  Plus,
  Receipt,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useAuth } from "../../auth/AuthContext";
import { createCaseInvoice, downloadCaseInvoicePdf, getCaseInvoices, recordCaseInvoiceManualPayment } from "../../api/caseInvoiceApi";
import { getFeeCategories } from "../../api/feeCategoryApi";
import ManualLedgerPanel from "../ledger/ManualLedgerPanel";
import { fadingHighlightClass, useFadingHighlight } from "../../hooks/useFadingHighlight";

const PAYMENT_TYPE_META = {
  fees: { label: "Professional fees", icon: Banknote, tint: "bg-emerald-50 text-emerald-700" },
  disbursement: { label: "Govt. fee disbursement", icon: Landmark, tint: "bg-indigo-50 text-indigo-700" },
};

const STATUS_TONE = {
  Open: "bg-slate-100 text-slate-600",
  PartiallyPaid: "bg-amber-50 text-amber-700",
  Paid: "bg-emerald-50 text-emerald-700",
  Overdue: "bg-rose-50 text-rose-700",
  Void: "bg-slate-100 text-slate-400",
};

function formatMoney(value) {
  return Number(value).toLocaleString("en-CA", { style: "currency", currency: "CAD" });
}

function formatDate(value) {
  if (!value) return null;
  return new Date(value).toLocaleDateString("en-CA", { month: "short", day: "numeric", year: "numeric" });
}

const ERROR_HINTS = {
  QBO_NOT_CONNECTED: "Connect QuickBooks in Settings → Payments & Fees before creating invoices.",
  QBO_MAPPING_REQUIRED: null, // server message is already specific and actionable
  QBO_CLIENT_NOT_LINKED: null,
};

function CashPaymentRow({ invoice, onPaid }) {
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState(String(Number(invoice.balance)));
  const [note, setNote] = useState("");
  const [method, setMethod] = useState("Cash");
  const [transactionReference, setTransactionReference] = useState("");
  const [paymentDate, setPaymentDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [idempotencyKey, setIdempotencyKey] = useState(() => globalThis.crypto?.randomUUID?.() || String(Date.now()));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event) {
    event.preventDefault();
    if (method === "ETransfer" && !transactionReference.trim()) {
      setError("Enter the e-transfer transaction number.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const updated = await recordCaseInvoiceManualPayment(invoice.caseId, invoice.id, { amount: Number(amount), method, transactionReference: transactionReference.trim() || undefined, paymentDate, note: note.trim() || undefined, idempotencyKey });
      onPaid(updated);
      setOpen(false);
      setNote("");
      setTransactionReference("");
      setPaymentDate(new Date().toISOString().slice(0, 10));
      setIdempotencyKey(globalThis.crypto?.randomUUID?.() || String(Date.now()));
    } catch (reason) {
      setError(reason.response?.data?.message || "That payment could not be recorded.");
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => { setOpen(true); setAmount(String(Number(invoice.balance))); setIdempotencyKey(globalThis.crypto?.randomUUID?.() || String(Date.now())); }}
        className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3.5 py-1.5 text-xs font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-slate-50"
      >
        <Banknote className="h-3.5 w-3.5" /> Record payment
      </button>
    );
  }

  return (
    <motion.form
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: "auto" }}
      exit={{ opacity: 0, height: 0 }}
      onSubmit={submit}
      className="mt-3 overflow-hidden rounded-2xl border border-slate-200/80 bg-slate-50/70 p-3.5"
    >
      <div className="mb-3 grid grid-cols-2 gap-2 rounded-xl bg-white p-1 ring-1 ring-slate-200/80">
        {[["Cash", "Cash"], ["ETransfer", "E-transfer"]].map(([value, label]) => (
          <button key={value} type="button" onClick={() => { setMethod(value); setError(""); }} className={`h-8 rounded-lg text-xs font-semibold transition ${method === value ? "bg-slate-950 text-white shadow-sm" : "text-slate-500 hover:bg-slate-50"}`}>{label}</button>
        ))}
      </div>
      {method === "ETransfer" ? (
        <label className="mb-2.5 block text-xs font-medium text-slate-600">Transaction number
          <input required maxLength={100} value={transactionReference} onChange={(event) => setTransactionReference(event.target.value)} className="mt-1.5 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-sky-400" placeholder="Enter the bank transaction number" />
        </label>
      ) : (
        <label className="mb-2.5 block text-xs font-medium text-slate-600">Receipt / reference (optional)
          <input maxLength={100} value={transactionReference} onChange={(event) => setTransactionReference(event.target.value)} className="mt-1.5 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-sky-400" placeholder="Receipt or internal reference" />
        </label>
      )}
      <label className="mb-2.5 block text-xs font-medium text-slate-600">Payment date
        <input required type="date" max={new Date().toISOString().slice(0, 10)} value={paymentDate} onChange={(event) => setPaymentDate(event.target.value)} className="mt-1.5 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-sky-400" />
      </label>
      <div className="grid grid-cols-2 gap-2.5">
        <label className="block text-xs font-medium text-slate-600">Amount received
          <input
            type="number"
            min="0.01"
            step="0.01"
            max={Number(invoice.balance)}
            required
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            className="mt-1.5 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-sky-400"
          />
        </label>
        <label className="block text-xs font-medium text-slate-600">Note (optional)
          <input value={note} onChange={(event) => setNote(event.target.value)} className="mt-1.5 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-sky-400" placeholder="Received at office" />
        </label>
      </div>
      {error ? <p className="mt-2 text-xs text-rose-600">{error}</p> : null}
      <div className="mt-2.5 flex items-center gap-2">
        <button type="submit" disabled={busy} className="flex h-9 items-center gap-1.5 rounded-full bg-slate-950 px-4 text-xs font-semibold text-white disabled:opacity-50">
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />} Confirm payment
        </button>
        <button type="button" onClick={() => setOpen(false)} disabled={busy} className="h-9 rounded-full px-3 text-xs font-semibold text-slate-500 hover:bg-slate-100">Cancel</button>
      </div>
    </motion.form>
  );
}

function InvoiceCard({ invoice, onPaid, canRecordPayment, categories, highlighted }) {
  const category = categories.find((item) => item.code === invoice.paymentType);
  const baseMeta = PAYMENT_TYPE_META[invoice.paymentType] || PAYMENT_TYPE_META.fees;
  const meta = { ...baseMeta, label: invoice.paymentTypeLabel || category?.name || baseMeta.label };
  const Icon = meta.icon;
  const payable = canRecordPayment && Number(invoice.balance) > 0;
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState("");
  const [linkCopied, setLinkCopied] = useState(false);

  async function download() {
    setDownloading(true);
    setDownloadError("");
    try {
      await downloadCaseInvoicePdf(invoice.caseId, invoice.id, `Invoice-${invoice.qbInvoiceNumber || invoice.id.slice(0, 8)}.pdf`);
    } catch (reason) {
      setDownloadError(reason.response?.data?.message || "The PDF could not be downloaded.");
    } finally {
      setDownloading(false);
    }
  }

  async function copyPayLink() {
    try {
      await navigator.clipboard.writeText(invoice.qbInvoiceLink);
      setLinkCopied(true);
      window.setTimeout(() => setLinkCopied(false), 2000);
    } catch {
      setDownloadError("Could not copy the pay link.");
    }
  }

  return (
    <motion.article
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      id={`case-invoice-${invoice.id}`}
      className={`rounded-[1.4rem] border border-white/70 bg-white/85 p-4 shadow-[0_10px_30px_rgba(15,23,42,0.06)] backdrop-blur-xl ${fadingHighlightClass(highlighted)}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${meta.tint}`}>
            <Icon className="h-[18px] w-[18px]" />
          </span>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-slate-900">{invoice.description}</p>
            <p className="mt-0.5 text-xs text-slate-400">
              {meta.label}
              {invoice.qbInvoiceNumber ? ` · Invoice #${invoice.qbInvoiceNumber}` : ""}
              {invoice.dueDate ? ` · Due ${formatDate(invoice.dueDate)}` : ""}
            </p>
            {invoice.lastPaymentReference ? <p className="mt-1 text-[11px] font-medium text-emerald-700">Latest payment · Transaction #{invoice.lastPaymentReference}</p> : null}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${STATUS_TONE[invoice.status] || STATUS_TONE.Open}`}>
            {invoice.status === "PartiallyPaid" ? "Partially paid" : invoice.status}
          </span>
          {invoice.qbInvoiceLink && Number(invoice.balance) > 0 ? (
            <button
              type="button"
              onClick={copyPayLink}
              aria-label="Copy pay-now link"
              title={linkCopied ? "Copied" : "Copy pay-now link"}
              className="flex h-7 w-7 items-center justify-center rounded-full text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
            >
              {linkCopied ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
            </button>
          ) : null}
          <button
            type="button"
            onClick={download}
            disabled={downloading}
            aria-label="Download invoice PDF"
            title="Download PDF"
            className="flex h-7 w-7 items-center justify-center rounded-full text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 disabled:opacity-50"
          >
            {downloading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
          </button>
        </div>
      </div>

      <div className="mt-3 flex items-center justify-between gap-3 rounded-2xl bg-slate-50/80 px-3.5 py-2.5">
        <div className="flex items-center gap-4 text-sm">
          <span className="text-slate-500">Amount <span className="font-semibold text-slate-900">{formatMoney(invoice.amount)}</span></span>
          <span className="text-slate-500">Balance <span className={`font-semibold ${Number(invoice.balance) > 0 ? "text-slate-900" : "text-emerald-700"}`}>{formatMoney(invoice.balance)}</span></span>
        </div>
      </div>

      {downloadError ? <p className="mt-2 text-xs text-rose-600">{downloadError}</p> : null}

      {payable ? <div className="mt-3"><CashPaymentRow invoice={invoice} onPaid={onPaid} /></div> : null}
    </motion.article>
  );
}

function NewInvoiceSheet({ open, caseId, onClose, onCreated, categories }) {
  const [paymentType, setPaymentType] = useState(categories[0]?.code || "fees");
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [errorHint, setErrorHint] = useState("");

  useEffect(() => {
    if (open) {
      setPaymentType(categories[0]?.code || "fees");
      setDescription("");
      setAmount("");
      setDueDate("");
      setError("");
      setErrorHint("");
    }
  }, [open]);

  async function submit(event) {
    event.preventDefault();
    setSaving(true);
    setError("");
    setErrorHint("");
    try {
      const created = await createCaseInvoice(caseId, { paymentType, description: description.trim(), amount: Number(amount), dueDate: dueDate || undefined });
      onCreated(created);
      onClose();
    } catch (reason) {
      const code = reason.response?.data?.code;
      setError(reason.response?.data?.message || "The invoice could not be created.");
      setErrorHint(ERROR_HINTS[code] || "");
    } finally {
      setSaving(false);
    }
  }

  if (typeof document === "undefined") return null;
  const input = "w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm shadow-sm outline-none transition focus:border-sky-400 focus:ring-2 focus:ring-sky-100";

  return createPortal(
    <AnimatePresence>
      {open ? (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[400] flex justify-end bg-slate-950/25 backdrop-blur-[2px]" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
          <motion.aside initial={{ x: 60, opacity: 0 }} animate={{ x: 0, opacity: 1 }} exit={{ x: 60, opacity: 0 }} transition={{ type: "spring", stiffness: 380, damping: 34 }} className="flex h-full w-full max-w-[420px] flex-col overflow-hidden border-l border-white/70 bg-white/95 shadow-[-30px_0_90px_rgba(15,23,42,0.2)] backdrop-blur-2xl">
            <header className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
              <h2 className="text-lg font-semibold text-slate-950">New invoice</h2>
              <button type="button" onClick={onClose} aria-label="Close" className="flex h-9 w-9 items-center justify-center rounded-full text-slate-500 transition hover:bg-slate-100"><X className="h-5 w-5" /></button>
            </header>
            <form onSubmit={submit} className="flex-1 space-y-4 overflow-y-auto px-6 py-5">
              <div>
                <p className="text-xs font-medium text-slate-600">Payment type</p>
                <div className="mt-1.5 grid grid-cols-2 gap-2">
                  {categories.map((category) => {
                    const key = category.code;
                    const meta = PAYMENT_TYPE_META[key] || PAYMENT_TYPE_META.fees;
                    const Icon = meta.icon;
                    return (
                      <button key={key} type="button" onClick={() => setPaymentType(key)} className={`flex items-center justify-center gap-2 rounded-2xl border px-3 py-2.5 text-xs font-semibold transition ${paymentType === key ? "border-slate-950 bg-slate-950 text-white" : "border-slate-200 text-slate-600 hover:border-slate-300"}`}>
                        <Icon className="h-3.5 w-3.5" /> {category.name}
                      </button>
                    );
                  })}
                </div>
              </div>

              <label className="block text-xs font-medium text-slate-600">Description
                <input required value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Retainer — signing installment" className={`mt-1.5 ${input}`} />
              </label>
              <div className="grid grid-cols-2 gap-3">
                <label className="block text-xs font-medium text-slate-600">Amount (CAD)
                  <input type="number" min="0.01" step="0.01" required value={amount} onChange={(event) => setAmount(event.target.value)} className={`mt-1.5 ${input}`} placeholder="1500.00" />
                </label>
                <label className="block text-xs font-medium text-slate-600">Due date (optional)
                  <input type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} className={`mt-1.5 ${input}`} />
                </label>
              </div>

              <p className="rounded-2xl bg-slate-50 px-3.5 py-2.5 text-xs leading-5 text-slate-500">
                QuickBooks calculates any applicable tax and becomes the record of this invoice. CaseDesk only mirrors its status.
              </p>

              {error ? (
                <div className="rounded-2xl bg-rose-50 px-3.5 py-2.5 text-sm text-rose-700">
                  <p className="flex items-start gap-2"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {error}</p>
                  {errorHint ? <p className="mt-1.5 text-xs text-rose-600/90">{errorHint}</p> : null}
                </div>
              ) : null}
            </form>
            <footer className="border-t border-slate-100 p-4">
              <button type="button" onClick={submit} disabled={saving || !description.trim() || !amount} className="flex h-12 w-full items-center justify-center gap-2 rounded-full bg-slate-950 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:opacity-50">
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null} {saving ? "Creating…" : "Create invoice"}
              </button>
            </footer>
          </motion.aside>
        </motion.div>
      ) : null}
    </AnimatePresence>,
    document.body,
  );
}

export default function CaseBillingWorkspace({ caseItem, highlightId }) {
  const { role } = useAuth();
  const [invoices, setInvoices] = useState(null);
  const [categories, setCategories] = useState([]);
  const [error, setError] = useState("");
  const [sheetOpen, setSheetOpen] = useState(false);
  const canManage = ["admin", "consultant"].includes(role);

  async function load() {
    setError("");
    try {
      const [invoiceRows, categoryRows] = await Promise.all([getCaseInvoices(caseItem.id), getFeeCategories()]);
      setInvoices(invoiceRows);
      setCategories(categoryRows);
    } catch (reason) {
      setError(reason.response?.data?.message || "Invoices could not be loaded.");
    }
  }

  useEffect(() => { load(); }, [caseItem.id]);

  const activeHighlightId = useFadingHighlight(highlightId, { domIdPrefix: "case-invoice-", ready: Boolean(invoices) });
  // A voided invoice (e.g. a duplicate charge caught after the fact) is
  // real history, but not something staff need to see mixed into the case's
  // active invoice list — matches how the agency-wide Payments page already
  // excludes Void by default.
  const visibleInvoices = invoices?.filter((invoice) => invoice.status !== "Void") ?? invoices;

  function patchInvoice(updated) {
    setInvoices((current) => {
      const exists = current?.some((item) => item.id === updated.id);
      if (!exists) return [updated, ...(current || [])];
      return current.map((item) => (item.id === updated.id ? { ...item, ...updated } : item));
    });
  }

  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-slate-900">Invoices</h3>
          <p className="text-xs text-slate-400">One billing trail across CaseDesk and QuickBooks, including cash and e-transfer receipts.</p>
        </div>
        {canManage ? (
          <button type="button" onClick={() => setSheetOpen(true)} className="inline-flex items-center gap-1.5 rounded-full bg-slate-950 px-4 py-2 text-xs font-semibold text-white transition hover:bg-slate-800">
            <Plus className="h-3.5 w-3.5" /> New invoice
          </button>
        ) : null}
      </div>

      {error ? (
        <div className="mt-4 flex items-center justify-between gap-3 rounded-2xl bg-rose-50 px-4 py-3">
          <p className="text-sm text-rose-700">{error}</p>
          <button type="button" onClick={load} className="text-sm font-semibold text-rose-700 underline">Try again</button>
        </div>
      ) : invoices === null ? (
        <div className="mt-4 space-y-2.5">
          {[0, 1].map((key) => <div key={key} className="h-20 animate-pulse rounded-[1.4rem] bg-slate-100" />)}
        </div>
      ) : visibleInvoices.length === 0 ? (
        <div className="mt-6 flex flex-col items-center rounded-[1.4rem] bg-slate-50/80 px-5 py-10 text-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-full bg-white text-slate-400 shadow-sm"><Receipt className="h-5 w-5" /></span>
          <p className="mt-3 text-sm font-semibold text-slate-700">No invoices yet</p>
          <p className="mt-1 max-w-sm text-sm text-slate-500">{canManage ? "Create the first invoice using any active agency fee category." : "Nothing has been invoiced on this case yet."}</p>
        </div>
      ) : (
        <div className="mt-4 space-y-3">
          <AnimatePresence initial={false}>
            {visibleInvoices.map((invoice) => (
              <InvoiceCard key={invoice.id} invoice={{ ...invoice, caseId: caseItem.id }} onPaid={patchInvoice} canRecordPayment={canManage} categories={categories} highlighted={invoice.id === activeHighlightId} />
            ))}
          </AnimatePresence>
        </div>
      )}

      {canManage ? <NewInvoiceSheet open={sheetOpen} caseId={caseItem.id} onClose={() => setSheetOpen(false)} onCreated={patchInvoice} categories={categories} /> : null}

      <div className="mt-8 border-t border-slate-100 pt-6">
        <ManualLedgerPanel caseId={caseItem.id} />
      </div>
    </div>
  );
}
