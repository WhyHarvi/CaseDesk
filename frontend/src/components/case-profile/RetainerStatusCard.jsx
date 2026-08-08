import { motion } from "framer-motion";
import { CheckCircle2, FileSignature, Loader2, Mail, PenTool, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";
import { useAuth } from "../../auth/AuthContext";
import { approveCaseBillingRetainer, createCaseBillingRetainerDraft, getCaseBillingRetainer } from "../../api/caseBillingRetainerApi";

const STATUS_META = {
  Draft: { label: "Draft — not yet sent", tone: "bg-slate-100 text-slate-600" },
  Saved: { label: "Draft — not yet sent", tone: "bg-slate-100 text-slate-600" },
  ReadyToIssue: { label: "Ready to send", tone: "bg-sky-50 text-sky-700" },
  Issued: { label: "Sent — awaiting client signature", tone: "bg-amber-50 text-amber-700" },
  Signed: { label: "Signed by client", tone: "bg-emerald-50 text-emerald-700" },
  Finalized: { label: "Countersigned — complete", tone: "bg-emerald-100 text-emerald-800" },
};

function formatDateTime(value) {
  if (!value) return null;
  return new Date(value).toLocaleString("en-CA", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
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
  const canApprove = ["admin", "consultant"].includes(role);

  async function load() {
    setError("");
    try {
      const data = await getCaseBillingRetainer(caseItem.id);
      setState(data);
      onStatusChange?.(data);
    } catch (reason) {
      setError(reason.response?.data?.message || "Could not load the retainer status.");
    }
  }

  useEffect(() => { load(); }, [caseItem.id]);

  async function startDraft() {
    setBusy(true);
    setError("");
    try {
      const data = await createCaseBillingRetainerDraft(caseItem.id);
      setState(data);
      onStatusChange?.(data);
    } catch (reason) {
      setError(reason.response?.data?.message || "Could not start the retainer draft.");
    } finally {
      setBusy(false);
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
        {error ? <p className="mt-2 text-xs text-rose-600">{error}</p> : null}
        {canApprove ? (
          <button type="button" onClick={startDraft} disabled={busy} className="mt-3 flex h-9 items-center gap-1.5 rounded-full bg-slate-950 px-4 text-xs font-semibold text-white disabled:opacity-50">
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileSignature className="h-3.5 w-3.5" />} Start retainer from this template
          </button>
        ) : (
          <p className="mt-3 text-xs text-slate-400">A consultant or administrator needs to start this retainer.</p>
        )}
      </motion.div>
    );
  }

  const document = state.document;
  const meta = STATUS_META[document.correspondenceStatus] || STATUS_META.Draft;
  const canOpenWriter = ["admin", "consultant", "frontdesk"].includes(role);
  const canSendNow = canApprove && ["Draft", "Saved", "ReadyToIssue"].includes(document.correspondenceStatus) && document.clientDocumentId;
  const needsSaveFirst = ["Draft", "Saved"].includes(document.correspondenceStatus) && !document.clientDocumentId;

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

      {error ? <p className="mt-2 text-xs text-rose-600">{error}</p> : null}

      <div className="mt-3.5 flex flex-wrap items-center gap-2">
        {canOpenWriter && ["Draft", "Saved", "ReadyToIssue"].includes(document.correspondenceStatus) ? (
          <button type="button" onClick={() => window.open(`/cases/${caseItem.id}/documents/${document.id}/edit`, "_blank", "noopener,noreferrer")} className="inline-flex h-9 items-center gap-1.5 rounded-full border border-slate-200 bg-white px-4 text-xs font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-slate-50">
            Open in Writer
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
