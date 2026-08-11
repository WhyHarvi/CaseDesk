import { motion } from "framer-motion";
import { Calendar, Check, CheckCircle2, FileSignature, Loader2, Mail, PenTool, RefreshCw, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";
import { useAuth } from "../../auth/AuthContext";
import { approveCaseBillingRetainer, createCaseBillingRetainerDraft, getCaseBillingRetainer, syncCaseBillingRetainerWithSchedule } from "../../api/caseBillingRetainerApi";
import { getCaseSchedule } from "../../api/paymentScheduleApi";
import InstallmentListEditor, { blankInstallment } from "../payments/InstallmentListEditor";
import { DiscountField, TemplatePicker } from "./CasePaymentScheduleWorkspace";

const STATUS_META = {
  Draft: { label: "Draft — not yet sent", tone: "bg-slate-100 text-slate-600" },
  Saved: { label: "Draft — not yet sent", tone: "bg-slate-100 text-slate-600" },
  ReadyToIssue: { label: "Ready to send", tone: "bg-sky-50 text-sky-700" },
  Issued: { label: "Sent — awaiting client signature", tone: "bg-amber-50 text-amber-700" },
  Signed: { label: "Signed by client", tone: "bg-emerald-50 text-emerald-700" },
  Finalized: { label: "Countersigned — complete", tone: "bg-emerald-100 text-emerald-800" },
};

const EDITABLE_STATUSES = new Set(["Draft", "Saved", "ReadyToIssue"]);

function formatDateTime(value) {
  if (!value) return null;
  return new Date(value).toLocaleString("en-CA", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
}

// The schedule review step shown inline when starting a retainer on a case
// that has no payment schedule yet — the same template-pick-then-edit
// builder as the Payment Schedule tab, just triggered a step earlier so its
// numbers can go straight into the retainer instead of being typed in
// twice. Deliberately reuses InstallmentListEditor/TemplatePicker rather
// than a simplified one-off, so what a consultant sees here behaves
// exactly like the schedule they'd build later on the Billing tab.
function ScheduleReviewStep({ caseItem, busy, error, onApprove, onSkip }) {
  const [signingDate, setSigningDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [installments, setInstallments] = useState([blankInstallment()]);
  const [discountAmount, setDiscountAmount] = useState("");

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

  return (
    <div className="mt-3.5 rounded-2xl border border-dashed border-fuchsia-300 bg-white/70 p-4">
      <p className="text-xs font-semibold text-slate-700">Review the payment schedule before creating the retainer</p>
      <p className="mt-1 text-xs text-slate-500">Pick a starting point, then adjust amounts or add/remove installments for what this client actually agreed to. This becomes the case's real payment schedule and fills the retainer's fee sections.</p>
      <div className="mt-3">
        <TemplatePicker caseType={caseItem.caseType} onPick={applyTemplate} />
        <label className="block text-xs font-medium text-slate-600">Signing date
          <span className="mt-1.5 flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3.5 py-2.5">
            <Calendar className="h-4 w-4 text-slate-400" />
            <input type="date" required value={signingDate} onChange={(event) => setSigningDate(event.target.value)} className="w-full bg-transparent text-sm outline-none" />
          </span>
        </label>
        <div className="mt-3.5"><DiscountField value={discountAmount} onChange={setDiscountAmount} /></div>
        <div className="mt-3.5">
          <InstallmentListEditor installments={installments} onChange={setInstallments} />
        </div>
      </div>
      {error ? <p className="mt-2.5 text-xs text-rose-600">{error}</p> : null}
      <div className="mt-3.5 flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => onApprove(installments, signingDate, discountAmount)} disabled={busy} className="flex h-10 items-center gap-1.5 rounded-full bg-slate-950 px-4 text-xs font-semibold text-white disabled:opacity-50">
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileSignature className="h-3.5 w-3.5" />} Approve schedule &amp; create retainer
        </button>
        <button type="button" onClick={onSkip} disabled={busy} className="h-10 rounded-full px-3 text-xs font-semibold text-slate-500 hover:bg-slate-100">Skip for now — start without a schedule</button>
      </div>
    </div>
  );
}

// Fix 3.1 / 4.1 / 6.2 — sits at the top of the Billing tab. Resolves and
// shows the case's retainer (existing document, or the matching
// system-assigned template if none exists yet), gates the rest of the
// Billing tab (see CaseWorkspaceTabs' BILLING block) until it reaches
// Finalized, and exposes the one action a consultant/admin needs from here:
// approve and send. Everything else (drafting/editing the actual content)
// still happens in the existing Agreements & Letters Writer — this card
// deep-links there rather than re-implementing document editing.
export default function RetainerStatusCard({ caseItem, onOpenAgreementsTab, onStatusChange }) {
  const { role } = useAuth();
  const [state, setState] = useState(undefined);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [schedule, setSchedule] = useState(undefined);
  const [syncBusy, setSyncBusy] = useState(false);
  const [syncError, setSyncError] = useState("");
  const [justSynced, setJustSynced] = useState(false);
  const canApprove = ["admin", "consultant"].includes(role);

  async function load() {
    setError("");
    try {
      const [data, scheduleData] = await Promise.all([getCaseBillingRetainer(caseItem.id), getCaseSchedule(caseItem.id)]);
      setState(data);
      setSchedule(scheduleData);
      onStatusChange?.(data);
    } catch (reason) {
      setError(reason.response?.data?.message || "Could not load the retainer status.");
    }
  }

  useEffect(() => { load(); }, [caseItem.id]);

  async function startDraft(installments, signingDate, discountAmount) {
    setBusy(true);
    setError("");
    try {
      const data = await createCaseBillingRetainerDraft(caseItem.id, installments ? { installments, signingDate, discountAmount } : undefined);
      setState(data);
      onStatusChange?.(data);
      const scheduleData = await getCaseSchedule(caseItem.id).catch(() => schedule);
      setSchedule(scheduleData);
    } catch (reason) {
      setError(reason.response?.data?.message || "Could not start the retainer draft.");
    } finally {
      setBusy(false);
    }
  }

  async function syncWithSchedule() {
    setSyncBusy(true);
    setSyncError("");
    setJustSynced(false);
    try {
      const data = await syncCaseBillingRetainerWithSchedule(caseItem.id);
      setState(data);
      onStatusChange?.(data);
      setJustSynced(true);
      window.setTimeout(() => setJustSynced(false), 3000);
    } catch (reason) {
      setSyncError(reason.response?.data?.message || "Could not sync the retainer from the payment schedule.");
    } finally {
      setSyncBusy(false);
    }
  }

  async function approveAndSend() {
    setBusy(true);
    setError("");
    try {
      const data = await approveCaseBillingRetainer(caseItem.id);
      setState(data);
      onStatusChange?.(data);
    } catch (reason) {
      setError(reason.response?.data?.message || "Could not approve and send the retainer.");
    } finally {
      setBusy(false);
    }
  }

  if (state === undefined) {
    return <div className="h-24 animate-pulse rounded-[1.4rem] bg-slate-100" />;
  }

  if (error) {
    return (
      <div className="flex items-center justify-between gap-3 rounded-[1.4rem] bg-rose-50 px-5 py-4">
        <p className="text-sm text-rose-700">{error}</p>
        <button type="button" onClick={load} className="text-sm font-semibold text-rose-700 underline">Try again</button>
      </div>
    );
  }

  if (state.source === "none") {
    return (
      <div className="rounded-[1.4rem] border border-dashed border-slate-300 bg-slate-50/70 px-5 py-6 text-center">
        <p className="text-sm font-semibold text-slate-700">No retainer template is set up yet</p>
        <p className="mt-1 text-xs text-slate-500">Ask an administrator to add an agreement template in Settings.</p>
      </div>
    );
  }

  if (state.source === "template") {
    const offerScheduleReview = schedule === null;
    return (
      <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="rounded-[1.4rem] border border-fuchsia-200/70 bg-fuchsia-50/40 px-5 py-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.14em] text-fuchsia-600">
              <Sparkles className="h-3.5 w-3.5" /> {state.isGeneralFallback ? "General template (no case-specific match yet)" : "System-assigned template"}
            </p>
            <p className="mt-1.5 text-sm font-semibold text-slate-900">{state.template?.title}</p>
            <p className="mt-0.5 text-xs text-slate-500">Opens a retainer for {caseItem.client?.fullName} based on this template.</p>
          </div>
        </div>
        {!canApprove ? (
          <p className="mt-3 text-xs text-slate-400">A consultant or administrator needs to start this retainer.</p>
        ) : schedule === undefined ? (
          <div className="mt-3 h-9 w-48 animate-pulse rounded-full bg-fuchsia-100/70" />
        ) : offerScheduleReview ? (
          <ScheduleReviewStep caseItem={caseItem} busy={busy} error={error} onApprove={startDraft} onSkip={() => startDraft()} />
        ) : (
          <>
            {error ? <p className="mt-2 text-xs text-rose-600">{error}</p> : null}
            <button type="button" onClick={() => startDraft()} disabled={busy} className="mt-3 flex h-9 items-center gap-1.5 rounded-full bg-slate-950 px-4 text-xs font-semibold text-white disabled:opacity-50">
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileSignature className="h-3.5 w-3.5" />} Start retainer from this template
            </button>
          </>
        )}
      </motion.div>
    );
  }

  const document = state.document;
  const meta = STATUS_META[document.correspondenceStatus] || STATUS_META.Draft;
  const canOpenWriter = ["admin", "consultant", "frontdesk"].includes(role);
  const canSendNow = canApprove && ["Draft", "Saved", "ReadyToIssue"].includes(document.correspondenceStatus) && document.clientDocumentId;
  const needsSaveFirst = ["Draft", "Saved"].includes(document.correspondenceStatus) && !document.clientDocumentId;
  const isEditable = EDITABLE_STATUSES.has(document.correspondenceStatus);
  const canSync = canApprove && isEditable && Boolean(schedule);

  return (
    <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="rounded-[1.4rem] border border-slate-200/80 bg-white/90 px-5 py-4 shadow-[0_8px_24px_rgba(15,23,42,0.05)]">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-slate-900">{document.title}</p>
          <p className="mt-0.5 text-xs text-slate-400">Retainer agreement</p>
        </div>
        <span className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold ${meta.tone}`}>{meta.label}</span>
      </div>

      {document.correspondenceStatus === "Issued" && document.issuedBy ? (
        <p className="mt-2.5 flex items-center gap-1.5 text-xs text-slate-500"><Mail className="h-3.5 w-3.5" /> Approved and sent by {document.issuedBy.fullName} on {formatDateTime(document.issuedAt)}</p>
      ) : null}
      {document.correspondenceStatus === "Signed" ? (
        <p className="mt-2.5 flex items-center gap-1.5 text-xs text-amber-600"><PenTool className="h-3.5 w-3.5" /> Client has signed — the agency's signature will be applied automatically once it's configured in Settings.</p>
      ) : null}
      {document.correspondenceStatus === "Finalized" ? (
        <p className="mt-2.5 flex items-center gap-1.5 text-xs text-emerald-700"><CheckCircle2 className="h-3.5 w-3.5" /> Signed by the client and countersigned by the agency.</p>
      ) : null}
      {needsSaveFirst ? (
        <p className="mt-2.5 text-xs text-slate-500">Open this retainer in the Writer and save it before it can be sent for signature.</p>
      ) : null}
      {!schedule && isEditable ? (
        <p className="mt-2.5 text-xs text-slate-400">No payment schedule on this case yet — set one up on the Billing tab below, then sync it in here.</p>
      ) : null}

      {error ? <p className="mt-2 text-xs text-rose-600">{error}</p> : null}
      {syncError ? <p className="mt-2 text-xs text-rose-600">{syncError}</p> : null}

      <div className="mt-3.5 flex flex-wrap items-center gap-2">
        {canOpenWriter && ["Draft", "Saved", "ReadyToIssue"].includes(document.correspondenceStatus) ? (
          <button type="button" onClick={() => window.open(`/cases/${caseItem.id}/documents/${document.id}/edit`, "_blank", "noopener,noreferrer")} className="inline-flex h-9 items-center gap-1.5 rounded-full border border-slate-200 bg-white px-4 text-xs font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-slate-50">
            Open in Writer
          </button>
        ) : null}
        {canSync ? (
          <button type="button" onClick={syncWithSchedule} disabled={syncBusy} title="Fills in still-blank fee fields and rebuilds the Payment Schedule table from the case's current payment schedule" className="inline-flex h-9 items-center gap-1.5 rounded-full border border-slate-200 bg-white px-4 text-xs font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-slate-50 disabled:opacity-50">
            {syncBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : justSynced ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <RefreshCw className="h-3.5 w-3.5" />} {justSynced ? "Synced" : "Sync from payment schedule"}
          </button>
        ) : null}
        {canSendNow ? (
          <button type="button" onClick={approveAndSend} disabled={busy} className="flex h-9 items-center gap-1.5 rounded-full bg-slate-950 px-4 text-xs font-semibold text-white disabled:opacity-50">
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileSignature className="h-3.5 w-3.5" />} Approve and send
          </button>
        ) : null}
      </div>
    </motion.div>
  );
}
