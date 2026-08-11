import { AnimatePresence, motion } from "framer-motion";
import { AlertTriangle, Calendar, Check, ChevronRight, Loader2, Pencil, Receipt, ShieldAlert, Sparkles, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useAuth } from "../../auth/AuthContext";
import { createCaseSchedule, getCaseSchedule, getScheduleTemplates, updateCaseSchedule, voidCaseSchedule, voidInstallmentInvoice } from "../../api/paymentScheduleApi";
import InstallmentListEditor, { blankInstallment } from "../payments/InstallmentListEditor";

const STATUS_META = {
  Scheduled: { label: "Scheduled", tone: "bg-slate-100 text-slate-600" },
  Invoicing: { label: "Invoicing…", tone: "bg-sky-50 text-sky-700" },
  Invoiced: { label: "Invoiced", tone: "bg-emerald-50 text-emerald-700" },
  Void: { label: "Void", tone: "bg-rose-50 text-rose-600" },
};

const FIRED_STATUSES = new Set(["Invoiced", "Void"]);

function formatMoney(value) {
  return Number(value).toLocaleString("en-CA", { style: "currency", currency: "CAD" });
}

function formatDate(value) {
  if (!value) return null;
  return new Date(value).toLocaleDateString("en-CA", { month: "short", day: "numeric", year: "numeric" });
}

function triggerLabel(installment) {
  if (installment.triggerType === "Stage") return `On stage: ${installment.triggerStage}`;
  if (installment.triggerDate) return `Due ${formatDate(installment.triggerDate)}`;
  return `${installment.triggerDaysAfterSigning} day${installment.triggerDaysAfterSigning === 1 ? "" : "s"} after signing`;
}

function TaxSummaryBar({ taxSummary }) {
  if (!taxSummary) return null;
  return (
    <div className="mt-3 rounded-2xl border border-slate-200/70 bg-slate-50/70 px-4 py-3 text-xs">
      <div className="flex flex-wrap items-center justify-between gap-1.5">
        <span className="text-slate-500">Professional / consultation subtotal</span>
        <span className="font-semibold text-slate-800">{formatMoney(taxSummary.taxableSubtotal)}</span>
      </div>
      <div className="mt-1 flex flex-wrap items-center justify-between gap-1.5">
        <span className="text-slate-500">HST ({Number(taxSummary.taxRatePercent)}%)</span>
        <span className="font-semibold text-slate-800">{formatMoney(taxSummary.tax)}</span>
      </div>
      <div className="mt-1 flex flex-wrap items-center justify-between gap-1.5">
        <span className="text-slate-500">Govt. fees &amp; disbursements <span className="text-slate-400">(not taxed)</span></span>
        <span className="font-semibold text-slate-800">{formatMoney(taxSummary.nonTaxableSubtotal)}</span>
      </div>
      <div className="mt-2 flex items-center justify-between border-t border-slate-200 pt-2">
        <span className="text-sm font-semibold text-slate-900">Total</span>
        <span className="text-sm font-bold text-slate-900">{formatMoney(taxSummary.totalFee)}</span>
      </div>
    </div>
  );
}

function InstallmentRow({ installment, caseId, isAdmin, onVoided }) {
  const [confirming, setConfirming] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const meta = STATUS_META[installment.status] || STATUS_META.Scheduled;
  const invoice = installment.caseInvoice;
  const canVoidInvoice = isAdmin && installment.status === "Invoiced" && invoice && Number(invoice.balance) === Number(invoice.amount);

  async function confirmVoid() {
    setBusy(true);
    setError("");
    try {
      const updated = await voidInstallmentInvoice(caseId, installment.id, reason.trim() || undefined);
      onVoided(updated);
    } catch (reason_) {
      setError(reason_.response?.data?.message || "Could not void this invoice.");
      setBusy(false);
    }
  }

  return (
    <motion.div layout initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="rounded-[1.2rem] border border-white/70 bg-white/85 p-4 shadow-[0_8px_24px_rgba(15,23,42,0.05)] backdrop-blur-xl">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-slate-900">{installment.label}</p>
          <p className="mt-0.5 text-xs text-slate-400">
            {installment.paymentType === "disbursement" ? "Govt. fee disbursement" : "Professional fees"} · {triggerLabel(installment)}
          </p>
        </div>
        <span className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold ${meta.tone}`}>{meta.label}</span>
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-2xl bg-slate-50/80 px-3.5 py-2.5 text-sm">
        <span className="text-slate-500">Amount <span className="font-semibold text-slate-900">{formatMoney(installment.amount)}</span></span>
        {invoice ? (
          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-500">
            <Receipt className="h-3.5 w-3.5" />
            {invoice.qbInvoiceNumber ? `Invoice #${invoice.qbInvoiceNumber}` : "Invoice"} · {invoice.status === "PartiallyPaid" ? "Partially paid" : invoice.status}
            {Number(invoice.balance) > 0 ? ` · Balance ${formatMoney(invoice.balance)}` : ""}
          </span>
        ) : installment.status === "Void" ? (
          <span className="text-xs text-rose-500">{installment.voidReason || "Voided — will not be invoiced"}</span>
        ) : (
          <span className="text-xs text-slate-400">Not yet invoiced</span>
        )}
      </div>
      {canVoidInvoice ? (
        confirming ? (
          <div className="mt-3 rounded-2xl border border-rose-200 bg-rose-50/70 p-3">
            <p className="text-xs font-semibold text-rose-700">Void this invoice?</p>
            <p className="mt-1 text-[11px] leading-4 text-rose-600/90">
              This voids the QuickBooks invoice and resets the installment to Scheduled so you can fix it and re-fire it. Logged in the case activity history.
            </p>
            <input
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="Reason (optional) — e.g. wrong payment type"
              className="mt-2 w-full rounded-lg border border-rose-200 bg-white px-2.5 py-1.5 text-xs outline-none focus:border-rose-400"
            />
            {error ? <p className="mt-1.5 text-[11px] text-rose-700">{error}</p> : null}
            <div className="mt-2 flex items-center gap-2">
              <button type="button" onClick={confirmVoid} disabled={busy} className="flex h-7 items-center gap-1 rounded-full bg-rose-600 px-3 text-[11px] font-semibold text-white disabled:opacity-50">
                {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : null} Confirm void
              </button>
              <button type="button" onClick={() => setConfirming(false)} disabled={busy} className="h-7 rounded-full px-2.5 text-[11px] font-semibold text-rose-700 hover:bg-rose-100">Cancel</button>
            </div>
          </div>
        ) : (
          <button type="button" onClick={() => setConfirming(true)} className="mt-2.5 inline-flex items-center gap-1 text-[11px] font-semibold text-rose-600 transition hover:text-rose-700">
            <X className="h-3 w-3" /> Void invoice
          </button>
        )
      ) : null}
    </motion.div>
  );
}

export function TemplatePicker({ caseType, onPick }) {
  const [templates, setTemplates] = useState(null);

  useEffect(() => {
    let active = true;
    getScheduleTemplates(caseType).then((data) => active && setTemplates(data)).catch(() => active && setTemplates([]));
    return () => { active = false; };
  }, [caseType]);

  if (!templates || !templates.length) return null;

  return (
    <div className="mb-4">
      <p className="text-xs font-medium text-slate-500">Start from a template</p>
      <div className="mt-1.5 flex flex-wrap gap-2">
        {templates.map((template) => (
          <button
            key={template.id}
            type="button"
            onClick={() => onPick(template)}
            className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3.5 py-1.5 text-xs font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-slate-50"
          >
            <Sparkles className="h-3.5 w-3.5 text-fuchsia-500" /> {template.name}
            {template.isSystemDefault ? <span className="rounded-full bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700">System</span> : null}
            <ChevronRight className="h-3 w-3 text-slate-300" />
          </button>
        ))}
      </div>
    </div>
  );
}

function ScheduleBuilder({ caseItem, onCreated }) {
  const [signingDate, setSigningDate] = useState(new Date().toISOString().slice(0, 10));
  const [installments, setInstallments] = useState([blankInstallment()]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  function applyTemplate(template) {
    setInstallments(
      template.installments.map((row) => ({
        ...blankInstallment(),
        label: row.label,
        paymentType: row.paymentType,
        amount: String(row.amount),
        triggerType: row.triggerType,
        triggerStage: row.triggerStage || undefined,
        triggerDaysAfterSigning: row.triggerDaysAfterSigning ?? 0,
      })),
    );
  }

  async function submit(event) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      const created = await createCaseSchedule(caseItem.id, { signingDate, installments });
      onCreated(created);
    } catch (reason) {
      setError(reason.response?.data?.message || "The payment schedule could not be created.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="rounded-[1.4rem] border border-dashed border-slate-300 bg-slate-50/60 p-4">
      <TemplatePicker caseType={caseItem.caseType} onPick={applyTemplate} />
      <label className="block text-xs font-medium text-slate-600">Signing date
        <span className="mt-1.5 flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3.5 py-2.5">
          <Calendar className="h-4 w-4 text-slate-400" />
          <input type="date" required value={signingDate} onChange={(event) => setSigningDate(event.target.value)} className="w-full bg-transparent text-sm outline-none" />
        </span>
      </label>
      <div className="mt-3.5">
        <InstallmentListEditor installments={installments} onChange={setInstallments} />
      </div>
      {error ? <p className="mt-2.5 text-xs text-rose-600">{error}</p> : null}
      <button type="submit" disabled={saving} className="mt-3.5 flex h-10 w-full items-center justify-center gap-2 rounded-full bg-slate-950 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:opacity-50">
        {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null} {saving ? "Creating…" : "Create payment schedule"}
      </button>
    </form>
  );
}

function ScheduleEditor({ caseId, schedule, onSaved, onCancel }) {
  const [installments, setInstallments] = useState(schedule.installments.map((row) => ({ ...row, amount: String(row.amount) })));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const lockedIds = useMemo(() => new Set(schedule.installments.filter((row) => FIRED_STATUSES.has(row.status)).map((row) => row.id)), [schedule]);

  async function save() {
    setSaving(true);
    setError("");
    try {
      const updated = await updateCaseSchedule(caseId, installments);
      onSaved(updated);
    } catch (reason) {
      setError(reason.response?.data?.message || "The schedule could not be saved.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rounded-[1.4rem] border border-sky-200/80 bg-sky-50/40 p-4">
      <InstallmentListEditor installments={installments} onChange={setInstallments} lockedIds={lockedIds} />
      {error ? <p className="mt-2.5 text-xs text-rose-600">{error}</p> : null}
      <div className="mt-3.5 flex items-center gap-2">
        <button type="button" onClick={save} disabled={saving} className="flex h-10 items-center gap-1.5 rounded-full bg-slate-950 px-5 text-sm font-semibold text-white disabled:opacity-50">
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Save changes
        </button>
        <button type="button" onClick={onCancel} disabled={saving} className="h-10 rounded-full px-4 text-sm font-semibold text-slate-500 hover:bg-slate-100">Cancel</button>
      </div>
    </div>
  );
}

function VoidConfirm({ caseId, onDone, onCancel }) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function confirm() {
    setBusy(true);
    setError("");
    try {
      const updated = await voidCaseSchedule(caseId, reason.trim() || undefined);
      onDone(updated);
    } catch (reason_) {
      setError(reason_.response?.data?.message || "Could not void the remaining installments.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <motion.div initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} className="mb-4 rounded-2xl border border-rose-200 bg-rose-50/70 p-4">
      <p className="flex items-center gap-2 text-sm font-semibold text-rose-700"><ShieldAlert className="h-4 w-4" /> Void remaining installments</p>
      <p className="mt-1 text-xs leading-5 text-rose-600/90">Every installment still marked Scheduled will be permanently voided and will never become an invoice. Already-invoiced installments are untouched. This is logged in the case activity history.</p>
      <input value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Reason (optional) — e.g. case cancelled, client refunded" className="mt-2.5 w-full rounded-xl border border-rose-200 bg-white px-3.5 py-2 text-sm outline-none focus:border-rose-400" />
      {error ? <p className="mt-2 text-xs text-rose-700">{error}</p> : null}
      <div className="mt-2.5 flex items-center gap-2">
        <button type="button" onClick={confirm} disabled={busy} className="flex h-9 items-center gap-1.5 rounded-full bg-rose-600 px-4 text-xs font-semibold text-white disabled:opacity-50">
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null} Confirm void
        </button>
        <button type="button" onClick={onCancel} disabled={busy} className="h-9 rounded-full px-3 text-xs font-semibold text-rose-700 hover:bg-rose-100">Cancel</button>
      </div>
    </motion.div>
  );
}

export default function CasePaymentScheduleWorkspace({ caseItem }) {
  const { role } = useAuth();
  const [schedule, setSchedule] = useState(undefined);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState(false);
  const [voiding, setVoiding] = useState(false);
  const canManage = ["admin", "consultant"].includes(role);
  const isAdmin = role === "admin";

  async function load() {
    setError("");
    try {
      setSchedule(await getCaseSchedule(caseItem.id));
    } catch (reason) {
      setError(reason.response?.data?.message || "The payment schedule could not be loaded.");
    }
  }

  useEffect(() => { load(); }, [caseItem.id]);

  const hasFired = schedule?.installments?.some((row) => FIRED_STATUSES.has(row.status));
  const canEdit = canManage && (!hasFired || isAdmin);
  const hasScheduledRemaining = schedule?.installments?.some((row) => row.status === "Scheduled");

  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-slate-900">Payment schedule</h3>
          <p className="text-xs text-slate-400">Milestone installments — each becomes a real QuickBooks invoice only once its trigger fires.</p>
        </div>
        {schedule && canEdit && !editing ? (
          <button type="button" onClick={() => setEditing(true)} className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-slate-50">
            <Pencil className="h-3.5 w-3.5" /> Edit schedule
          </button>
        ) : null}
      </div>

      {error ? (
        <div className="mt-4 flex items-center justify-between gap-3 rounded-2xl bg-rose-50 px-4 py-3">
          <p className="text-sm text-rose-700">{error}</p>
          <button type="button" onClick={load} className="text-sm font-semibold text-rose-700 underline">Try again</button>
        </div>
      ) : schedule === undefined ? (
        <div className="mt-4 h-20 animate-pulse rounded-[1.4rem] bg-slate-100" />
      ) : schedule === null ? (
        canManage ? (
          <div className="mt-4"><ScheduleBuilder caseItem={caseItem} onCreated={setSchedule} /></div>
        ) : (
          <div className="mt-6 flex flex-col items-center rounded-[1.4rem] bg-slate-50/80 px-5 py-10 text-center">
            <span className="flex h-12 w-12 items-center justify-center rounded-full bg-white text-slate-400 shadow-sm"><Calendar className="h-5 w-5" /></span>
            <p className="mt-3 text-sm font-semibold text-slate-700">No payment schedule yet</p>
          </div>
        )
      ) : editing ? (
        <div className="mt-4"><ScheduleEditor caseId={caseItem.id} schedule={schedule} onSaved={(updated) => { setSchedule(updated); setEditing(false); }} onCancel={() => setEditing(false)} /></div>
      ) : (
        <div className="mt-4">
          <p className="mb-3 text-xs text-slate-400">Signed {formatDate(schedule.signingDate)}</p>

          {isAdmin && hasScheduledRemaining ? (
            voiding ? (
              <VoidConfirm caseId={caseItem.id} onDone={(updated) => { setSchedule(updated); setVoiding(false); }} onCancel={() => setVoiding(false)} />
            ) : (
              <button type="button" onClick={() => setVoiding(true)} className="mb-4 inline-flex items-center gap-1.5 rounded-full border border-rose-200 bg-rose-50 px-3.5 py-1.5 text-xs font-semibold text-rose-700 transition hover:bg-rose-100">
                <X className="h-3.5 w-3.5" /> Void remaining installments
              </button>
            )
          ) : null}

          <div className="space-y-2.5">
            <AnimatePresence initial={false}>
              {schedule.installments.map((installment) => (
                <InstallmentRow
                  key={installment.id}
                  installment={installment}
                  caseId={caseItem.id}
                  isAdmin={isAdmin}
                  onVoided={setSchedule}
                />
              ))}
            </AnimatePresence>
          </div>
          <TaxSummaryBar taxSummary={schedule.taxSummary} />
        </div>
      )}
    </div>
  );
}
