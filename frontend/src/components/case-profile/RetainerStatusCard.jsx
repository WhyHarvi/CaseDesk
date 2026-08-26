import { motion } from "framer-motion";
import { Calendar, Check, CheckCircle2, Eye, FileSignature, Loader2, Mail, PenTool, Plus, RefreshCw, Sparkles, X } from "lucide-react";
import DOMPurify from "dompurify";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useAuth } from "../../auth/AuthContext";
import { approveCaseBillingRetainer, createCaseBillingRetainerDraft, getCaseBillingRetainer, previewCaseBillingRetainer, resetCaseBillingRetainer, syncCaseBillingRetainerWithSchedule } from "../../api/caseBillingRetainerApi";
import { getCaseSchedule } from "../../api/paymentScheduleApi";
import InstallmentListEditor, { blankInstallment } from "../payments/InstallmentListEditor";
import { DiscountField, TemplatePicker, useScheduleTaxContext } from "./CasePaymentScheduleWorkspace";

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

function RetainerPreviewOverlay({ preview, onClose }) {
  if (!preview || typeof globalThis.document === "undefined") return null;
  return createPortal(
    <div className="fixed inset-0 z-[430] flex items-center justify-center bg-slate-950/35 p-3 backdrop-blur-md sm:p-5">
      <button
        type="button"
        onClick={onClose}
        className="absolute inset-0 cursor-default"
        aria-label="Close retainer preview"
      />
      <motion.section
        initial={{ opacity: 0, y: 14, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        className="relative flex max-h-[94dvh] w-full max-w-5xl flex-col overflow-hidden rounded-[2rem] border border-white/80 bg-white shadow-[0_34px_100px_rgba(15,23,42,0.3)]"
      >
        <header className="flex shrink-0 items-start justify-between gap-4 border-b border-slate-100 px-5 py-4 sm:px-6">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-fuchsia-600">
              Read-only review
            </p>
            <h3 className="mt-1.5 text-lg font-semibold text-slate-950">
              {preview.title}
            </h3>
            <p className="mt-1 text-xs text-slate-500">
              Nothing is created until you return and approve it.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-500 transition hover:bg-slate-200 hover:text-slate-800"
            aria-label="Close retainer preview"
          >
            <X className="h-4 w-4" />
          </button>
        </header>
        <main className="scrollbar-hidden min-h-0 flex-1 overflow-y-auto bg-[#eaebee] p-3 sm:p-6">
          <article className="mx-auto min-h-[54rem] max-w-[48rem] bg-white px-6 py-8 shadow-[0_12px_35px_rgba(15,23,42,0.12)] sm:px-10 sm:py-12">
            {preview.headerText ? (
              <p className="mb-7 border-b border-slate-200 pb-3 text-center text-sm font-semibold text-slate-700">
                {preview.headerText}
              </p>
            ) : null}
            <div
              className="prose prose-slate max-w-none text-sm leading-6 [&_h1]:text-2xl [&_h2]:mt-6 [&_h2]:text-base [&_mark]:rounded [&_mark]:bg-amber-100 [&_mark]:px-1 [&_mark]:text-amber-900 [&_table]:w-full [&_table]:border-collapse [&_td]:border [&_td]:border-slate-200 [&_td]:p-2 [&_th]:border [&_th]:border-slate-200 [&_th]:p-2"
              dangerouslySetInnerHTML={{
                __html: DOMPurify.sanitize(preview.contentHtml || ""),
              }}
            />
            {preview.footerText ? (
              <p className="mt-9 border-t border-slate-200 pt-3 text-center text-xs text-slate-400">
                {preview.footerText}
              </p>
            ) : null}
          </article>
        </main>
        <footer className="flex shrink-0 items-center justify-end border-t border-slate-100 bg-white px-5 py-3.5 sm:px-6">
          <button
            type="button"
            onClick={onClose}
            className="h-10 rounded-full bg-slate-950 px-5 text-xs font-semibold text-white"
          >
            Done reviewing
          </button>
        </footer>
      </motion.section>
    </div>,
    globalThis.document.body,
  );
}

// The schedule review step shown inline when starting a retainer on a case
// that has no payment schedule yet — the same template-pick-then-edit
// builder as the Payment Schedule tab, just triggered a step earlier so its
// numbers can go straight into the retainer instead of being typed in
// twice. Deliberately reuses InstallmentListEditor/TemplatePicker rather
// than a simplified one-off, so what a consultant sees here behaves
// exactly like the schedule they'd build later on the Billing tab.
function ScheduleReviewStep({ caseItem, busy, error, onApprove, onPreview }) {
  const [signingDate, setSigningDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [installments, setInstallments] = useState([blankInstallment()]);
  const [discountAmount, setDiscountAmount] = useState("");
  const { feeKindByType, taxRatePercent } = useScheduleTaxContext();
  const [preview, setPreview] = useState(null);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [previewError, setPreviewError] = useState("");
  const [reviewedMode, setReviewedMode] = useState(null);
  const [reviewToken, setReviewToken] = useState("");

  function invalidateReview() {
    setPreview(null);
    setPreviewError("");
    setReviewedMode(null);
    setReviewToken("");
  }

  function applyTemplate(template) {
    invalidateReview();
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

  async function viewRetainer(withSchedule = true) {
    setPreviewBusy(true);
    setPreviewError("");
    try {
      const scheduleValues = withSchedule
        ? { installments, signingDate, discountAmount }
        : undefined;
      const data = await onPreview(scheduleValues);
      setPreview(data);
      setReviewedMode(withSchedule ? "schedule" : "without-schedule");
      setReviewToken(data.reviewToken);
    } catch (reason) {
      setReviewedMode(null);
      setReviewToken("");
      setPreviewError(
        reason.response?.data?.message || "Could not prepare the retainer preview.",
      );
    } finally {
      setPreviewBusy(false);
    }
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
            <input type="date" required value={signingDate} onChange={(event) => { invalidateReview(); setSigningDate(event.target.value); }} className="w-full bg-transparent text-sm outline-none" />
          </span>
        </label>
        <div className="mt-3.5"><DiscountField value={discountAmount} onChange={(value) => { invalidateReview(); setDiscountAmount(value); }} installments={installments} feeKindByType={feeKindByType} taxRatePercent={taxRatePercent} /></div>
        <div className="mt-3.5">
          <InstallmentListEditor installments={installments} onChange={(value) => { invalidateReview(); setInstallments(value); }} />
        </div>
      </div>
      {error ? <p className="mt-2.5 text-xs text-rose-600">{error}</p> : null}
      {previewError ? <p className="mt-2.5 text-xs text-rose-600">{previewError}</p> : null}
      <div className="mt-3.5 flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => viewRetainer(true)} disabled={busy || previewBusy} className={`flex h-10 items-center gap-1.5 rounded-full px-4 text-xs font-semibold disabled:opacity-50 ${reviewedMode === "schedule" ? "border border-slate-200 bg-white text-slate-700" : "bg-slate-950 text-white"}`}>
          {previewBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Eye className="h-3.5 w-3.5" />} {reviewedMode === "schedule" ? "View retainer again" : "View retainer"}
        </button>
        {reviewedMode ? (
          <button type="button" onClick={() => reviewedMode === "schedule" ? onApprove(installments, signingDate, discountAmount, reviewToken) : onApprove(undefined, undefined, undefined, reviewToken)} disabled={busy || previewBusy} className="flex h-10 items-center gap-1.5 rounded-full bg-slate-950 px-4 text-xs font-semibold text-white disabled:opacity-50">
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileSignature className="h-3.5 w-3.5" />} {reviewedMode === "schedule" ? "Approve schedule & create retainer" : "Approve & create retainer"}
          </button>
        ) : null}
        <button type="button" onClick={() => viewRetainer(false)} disabled={busy || previewBusy} className="h-10 rounded-full px-3 text-xs font-semibold text-slate-500 hover:bg-slate-100 disabled:opacity-50">{reviewedMode === "without-schedule" ? "View without a schedule again" : "View without a schedule"}</button>
      </div>
      <RetainerPreviewOverlay preview={preview} onClose={() => setPreview(null)} />
    </div>
  );
}

function ExistingScheduleReview({ busy, error, onApprove, onPreview }) {
  const [preview, setPreview] = useState(null);
  const [reviewed, setReviewed] = useState(false);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [previewError, setPreviewError] = useState("");
  const [reviewToken, setReviewToken] = useState("");

  async function viewRetainer() {
    setPreviewBusy(true);
    setPreviewError("");
    try {
      const data = await onPreview();
      setPreview(data);
      setReviewed(true);
      setReviewToken(data.reviewToken);
    } catch (reason) {
      setReviewed(false);
      setReviewToken("");
      setPreviewError(
        reason.response?.data?.message || "Could not prepare the retainer preview.",
      );
    } finally {
      setPreviewBusy(false);
    }
  }

  return (
    <div className="mt-4 rounded-2xl bg-white p-4 ring-1 ring-slate-100">
      <p className="text-sm font-semibold text-slate-800">
        Payment schedule ready
      </p>
      <p className="mt-1 text-xs leading-5 text-slate-500">
        The case&apos;s existing payment schedule will be used to fill the
        retainer fee and installment sections.
      </p>
      {error ? <p className="mt-2 text-xs text-rose-600">{error}</p> : null}
      {previewError ? (
        <p className="mt-2 text-xs text-rose-600">{previewError}</p>
      ) : null}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={viewRetainer}
          disabled={busy || previewBusy}
          className={`flex h-10 items-center gap-1.5 rounded-full px-4 text-xs font-semibold disabled:opacity-50 ${reviewed ? "border border-slate-200 bg-white text-slate-700" : "bg-slate-950 text-white"}`}
        >
          {previewBusy ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Eye className="h-3.5 w-3.5" />
          )}
          {reviewed ? "View retainer again" : "View retainer"}
        </button>
        {reviewed ? (
          <button
            type="button"
            onClick={() => onApprove(reviewToken)}
            disabled={busy || previewBusy}
            className="flex h-10 items-center gap-1.5 rounded-full bg-slate-950 px-4 text-xs font-semibold text-white disabled:opacity-50"
          >
            {busy ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <FileSignature className="h-3.5 w-3.5" />
            )}
            Approve &amp; create retainer
          </button>
        ) : null}
      </div>
      <RetainerPreviewOverlay preview={preview} onClose={() => setPreview(null)} />
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
  const [templateOpen, setTemplateOpen] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const [resetBusy, setResetBusy] = useState(false);
  const [resetError, setResetError] = useState("");
  const canApprove = ["admin", "consultant"].includes(role);

  async function load() {
    setError("");
    try {
      const [data, scheduleData] = await Promise.all([getCaseBillingRetainer(caseItem.id), getCaseSchedule(caseItem.id)]);
      setState(data);
      setSchedule(scheduleData);
      setTemplateOpen(false);
      onStatusChange?.(data);
    } catch (reason) {
      setError(reason.response?.data?.message || "Could not load the retainer status.");
    }
  }

  useEffect(() => { load(); }, [caseItem.id]);

  async function startDraft(installments, signingDate, discountAmount, reviewToken) {
    setBusy(true);
    setError("");
    try {
      const data = await createCaseBillingRetainerDraft(
        caseItem.id,
        installments
          ? { installments, signingDate, discountAmount, reviewToken }
          : { reviewToken },
      );
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

  async function resetRetainer() {
    setResetBusy(true);
    setResetError("");
    try {
      const data = await resetCaseBillingRetainer(caseItem.id, state.document.id);
      setState(data);
      onStatusChange?.(data);
      setResetOpen(false);
      setTemplateOpen(true);
    } catch (reason) {
      setResetError(
        reason.response?.data?.message || "Could not reset the retainer draft.",
      );
    } finally {
      setResetBusy(false);
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
    const templateOverlay =
      templateOpen && typeof globalThis.document !== "undefined"
        ? createPortal(
            <div className="fixed inset-0 z-[390] flex items-center justify-center bg-slate-950/25 p-3 backdrop-blur-md sm:p-5">
              <button
                type="button"
                onClick={() => setTemplateOpen(false)}
                className="absolute inset-0 cursor-default"
                aria-label="Close template"
              />
              <motion.section
                initial={{ opacity: 0, y: 14, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                className="relative flex max-h-[92dvh] w-full max-w-4xl flex-col overflow-hidden rounded-[2rem] border border-white/80 bg-white shadow-[0_34px_100px_rgba(15,23,42,0.28)]"
              >
                <header className="flex shrink-0 items-start justify-between gap-4 border-b border-slate-100 px-5 py-4 sm:px-6">
                  <div>
                    <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.16em] text-fuchsia-600">
                      <Sparkles className="h-3.5 w-3.5" />
                      {state.isGeneralFallback
                        ? "General template"
                        : "Case-matched template"}
                    </p>
                    <h3 className="mt-1.5 text-lg font-semibold text-slate-950">
                      Add retainer template
                    </h3>
                    <p className="mt-1 text-sm text-slate-500">
                      Review the template and payment schedule before adding it
                      to {caseItem.client?.fullName}&apos;s case.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setTemplateOpen(false)}
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-500 transition hover:bg-slate-200 hover:text-slate-800"
                    aria-label="Close template"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </header>
                <main className="min-h-0 flex-1 overflow-y-auto bg-slate-50/55 px-5 py-5 sm:px-6">
                  <div className="rounded-2xl border border-fuchsia-200/70 bg-fuchsia-50/60 px-4 py-3.5">
                    <p className="text-sm font-semibold text-slate-900">
                      {state.template?.title}
                    </p>
                    <p className="mt-1 text-xs leading-5 text-slate-500">
                      {state.isGeneralFallback
                        ? "No case-specific match exists yet, so this general template will be used."
                        : "This template matches the current case type."}
                    </p>
                  </div>
                  {schedule === undefined ? (
                    <div className="mt-4 space-y-3">
                      <div className="h-12 animate-pulse rounded-2xl bg-slate-200/70" />
                      <div className="h-28 animate-pulse rounded-2xl bg-slate-200/70" />
                    </div>
                  ) : offerScheduleReview ? (
                    <ScheduleReviewStep
                      caseItem={caseItem}
                      busy={busy}
                      error={error}
                      onApprove={startDraft}
                      onPreview={(scheduleValues) =>
                        previewCaseBillingRetainer(caseItem.id, scheduleValues)
                      }
                    />
                  ) : (
                    <ExistingScheduleReview
                      busy={busy}
                      error={error}
                      onApprove={(reviewToken) =>
                        startDraft(undefined, undefined, undefined, reviewToken)
                      }
                      onPreview={() => previewCaseBillingRetainer(caseItem.id)}
                    />
                  )}
                </main>
              </motion.section>
            </div>,
            globalThis.document.body,
          )
        : null;
    return (
      <>
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-[1.4rem] border border-dashed border-slate-200 bg-slate-50/70 px-4 py-3">
          <div>
            <p className="text-sm font-semibold text-slate-800">
              Retainer agreement
            </p>
            <p className="mt-0.5 text-xs text-slate-500">
              No retainer has been added to this case yet.
            </p>
          </div>
          {canApprove ? (
            <button
              type="button"
              onClick={() => setTemplateOpen(true)}
              className="inline-flex h-9 items-center gap-1.5 rounded-full bg-slate-950 px-4 text-xs font-semibold text-white transition hover:bg-slate-800"
            >
              <Plus className="h-3.5 w-3.5" /> Add template
            </button>
          ) : (
            <p className="text-xs text-slate-400">
              A consultant or administrator can add a template.
            </p>
          )}
        </div>
        {templateOverlay}
      </>
    );
  }

  const document = state.document;
  const meta = STATUS_META[document.correspondenceStatus] || STATUS_META.Draft;
  const canOpenWriter = ["admin", "consultant", "frontdesk"].includes(role);
  const canReset = canApprove && EDITABLE_STATUSES.has(document.correspondenceStatus);
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
        {canReset ? (
          <button
            type="button"
            onClick={() => {
              setResetError("");
              setResetOpen(true);
            }}
            className="inline-flex h-9 items-center gap-1.5 rounded-full border border-rose-200 bg-white px-4 text-xs font-semibold text-rose-700 transition hover:bg-rose-50"
          >
            <RefreshCw className="h-3.5 w-3.5" /> Reset retainer
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
      {resetOpen && typeof globalThis.document !== "undefined"
        ? createPortal(
            <div className="fixed inset-0 z-[410] flex items-center justify-center bg-slate-950/25 p-4 backdrop-blur-md">
              <button
                type="button"
                onClick={() => !resetBusy && setResetOpen(false)}
                className="absolute inset-0 cursor-default"
                aria-label="Cancel reset retainer"
              />
              <motion.section
                initial={{ opacity: 0, y: 12, scale: 0.97 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                className="relative w-full max-w-md overflow-hidden rounded-[1.8rem] border border-white/80 bg-white shadow-[0_30px_90px_rgba(15,23,42,0.26)]"
              >
                <div className="px-6 pb-5 pt-6 text-center">
                  <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-rose-50 text-rose-600 ring-8 ring-rose-50/60">
                    <RefreshCw className="h-5 w-5" />
                  </span>
                  <p className="mt-5 text-[11px] font-semibold uppercase tracking-[0.17em] text-rose-500">
                    Reset retainer
                  </p>
                  <h3 className="mt-2 text-lg font-semibold text-slate-950">
                    Start again from a template?
                  </h3>
                  <p className="mt-2 text-sm leading-6 text-slate-500">
                    This removes “{document.title}”, its Writer history, and
                    its saved working file. The payment schedule, invoices,
                    and payments on this case will stay unchanged.
                  </p>
                  {resetError ? (
                    <p className="mt-3 rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-700">
                      {resetError}
                    </p>
                  ) : null}
                </div>
                <div className="grid grid-cols-2 gap-3 border-t border-slate-100 bg-slate-50/70 p-4">
                  <button
                    type="button"
                    onClick={() => setResetOpen(false)}
                    disabled={resetBusy}
                    className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-700 disabled:opacity-50"
                  >
                    Keep draft
                  </button>
                  <button
                    type="button"
                    onClick={resetRetainer}
                    disabled={resetBusy}
                    className="inline-flex items-center justify-center gap-2 rounded-2xl bg-rose-600 px-4 py-3 text-sm font-semibold text-white disabled:opacity-50"
                  >
                    {resetBusy ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : null}
                    {resetBusy ? "Resetting…" : "Reset & choose again"}
                  </button>
                </div>
              </motion.section>
            </div>,
            globalThis.document.body,
          )
        : null}
    </motion.div>
  );
}
