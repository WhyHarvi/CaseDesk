import { ArrowRight, Check, ClipboardCheck, Loader2, RefreshCw, UserRound, X } from "lucide-react";
import { motion } from "framer-motion";
import { useEffect } from "react";
import { createPortal } from "react-dom";
import { humanize } from "../leadPresentation";

function requestLeadName(request) {
  return [request.lead?.firstName, request.lead?.lastName].filter(Boolean).join(" ") || "Unnamed lead";
}

function roleLabel(role) {
  return role === "frontdesk" ? "Front desk" : humanize(role || "Team member");
}

function requestedAt(value) {
  if (!value) return "Recently requested";
  return new Intl.DateTimeFormat("en-CA", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

function PersonCard({ label, person, accent = false }) {
  return (
    <div className={`min-w-0 rounded-2xl border p-3.5 ${accent ? "border-brand-200 bg-brand-50/70" : "border-slate-200 bg-slate-50/80"}`}>
      <p className={`text-[10px] font-bold uppercase tracking-[0.14em] ${accent ? "text-brand-600" : "text-slate-400"}`}>{label}</p>
      <div className="mt-2 flex min-w-0 items-center gap-2.5">
        <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${accent ? "bg-brand-600 text-white" : "bg-slate-200 text-slate-600"}`}><UserRound className="h-3.5 w-3.5" /></span>
        <span className="min-w-0"><span className="block truncate text-sm font-semibold text-slate-900">{person?.fullName || "Unknown team member"}</span><span className="block text-[11px] text-slate-500">{roleLabel(person?.role)}</span></span>
      </div>
    </div>
  );
}

export default function LeadTransferApprovalDrawer({ open, requests = [], loading, error, busyId, onClose, onReview, onReload }) {
  useEffect(() => {
    if (!open) return undefined;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const closeOnEscape = (event) => event.key === "Escape" && !busyId && onClose();
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [busyId, onClose, open]);

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[180] flex justify-end bg-slate-950/25 backdrop-blur-sm" onMouseDown={(event) => event.target === event.currentTarget && !busyId && onClose()}>
      <motion.aside initial={{ x: 70, opacity: 0.85 }} animate={{ x: 0, opacity: 1 }} exit={{ x: 70, opacity: 0 }} transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }} className="flex h-full w-full max-w-xl flex-col border-l border-white/80 bg-[linear-gradient(180deg,rgba(248,250,252,0.98),rgba(241,245,249,0.98))] shadow-[-24px_0_80px_rgba(15,23,42,0.16)]" role="dialog" aria-modal="true" aria-labelledby="lead-transfer-approvals-title">
        <header className="flex shrink-0 items-center justify-between gap-4 border-b border-slate-200/70 bg-white/80 px-5 py-4 backdrop-blur-xl sm:px-7">
          <div className="flex min-w-0 items-center gap-3">
            <div className="relative flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-slate-950 text-white shadow-[0_10px_25px_rgba(15,23,42,0.18)]"><ClipboardCheck className="h-5 w-5" />{requests.length ? <span className="absolute -right-1.5 -top-1.5 min-w-5 rounded-full bg-brand-600 px-1.5 py-0.5 text-center text-[9px] font-bold text-white ring-2 ring-white">{requests.length}</span> : null}</div>
            <div className="min-w-0"><p className="text-[10px] font-bold uppercase tracking-[0.18em] text-brand-600">Lead management</p><h2 id="lead-transfer-approvals-title" className="truncate text-xl font-semibold tracking-tight text-slate-950">Transfer approvals</h2><p className="mt-0.5 text-xs text-slate-500">Review ownership changes requested by consultants.</p></div>
          </div>
          <button type="button" onClick={onClose} disabled={Boolean(busyId)} className="flex h-10 w-10 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 transition hover:border-slate-300 hover:text-slate-950 disabled:opacity-50" aria-label="Close transfer approvals"><X className="h-4 w-4" /></button>
        </header>

        <main className="min-h-0 flex-1 overflow-y-auto px-5 py-6 sm:px-7">
          {error ? <div className="mb-4 flex items-center justify-between gap-3 rounded-2xl border border-rose-100 bg-rose-50 px-4 py-3"><p className="text-sm font-medium text-rose-700">{error}</p><button type="button" onClick={onReload} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white text-rose-600 shadow-sm" aria-label="Reload transfer approvals"><RefreshCw className="h-3.5 w-3.5" /></button></div> : null}
          {loading && !requests.length ? <div className="flex min-h-64 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-slate-400" /></div> : requests.length ? <div className={`space-y-3 transition ${loading ? "opacity-55" : "opacity-100"}`}>{requests.map((request) => {
            const busy = busyId === request.id;
            return <article key={request.id} className="overflow-hidden rounded-[1.6rem] border border-white/80 bg-white/90 shadow-[0_14px_40px_rgba(15,23,42,0.07)]"><div className="p-4 sm:p-5"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><h3 className="truncate text-base font-semibold text-slate-950">{requestLeadName(request)}</h3><span className="rounded-full bg-slate-100 px-2 py-1 text-[10px] font-semibold text-slate-500">{request.lead?.leadNumber}</span></div><p className="mt-1 text-xs text-slate-500">Requested by <span className="font-semibold text-slate-700">{request.requestedBy?.fullName}</span> · {requestedAt(request.createdAt)}</p></div><span className="shrink-0 rounded-full bg-amber-50 px-2.5 py-1 text-[10px] font-bold text-amber-700 ring-1 ring-inset ring-amber-100">Pending</span></div><div className="mt-4 grid grid-cols-[1fr_auto_1fr] items-center gap-2"><PersonCard label="Current owner" person={request.fromOwner} /><ArrowRight className="h-4 w-4 text-slate-300" /><PersonCard label="Move to" person={request.toOwner} accent /></div><p className="mt-3 rounded-xl bg-slate-50 px-3 py-2.5 text-xs leading-5 text-slate-500">Approval moves this lead, its next action, and all pending lead follow-ups to the new owner.</p></div><footer className="flex items-center justify-end gap-2 border-t border-slate-100 bg-slate-50/65 px-4 py-3 sm:px-5"><button type="button" disabled={busy} onClick={() => onReview(request, "reject")} className="h-9 rounded-full px-4 text-xs font-semibold text-slate-500 transition hover:bg-white hover:text-rose-600 disabled:opacity-50">Decline</button><button type="button" disabled={busy} onClick={() => onReview(request, "approve")} className="inline-flex h-9 items-center gap-1.5 rounded-full bg-brand-600 px-4 text-xs font-semibold text-white shadow-sm transition hover:bg-brand-700 disabled:opacity-50">{busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}Approve transfer</button></footer></article>;
          })}</div> : !error ? <div className="flex min-h-72 flex-col items-center justify-center rounded-[1.75rem] border border-dashed border-slate-200 bg-white/55 px-6 text-center"><div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white text-slate-400 shadow-sm"><ClipboardCheck className="h-5 w-5" /></div><h3 className="mt-4 text-sm font-semibold text-slate-900">No transfers to review</h3><p className="mt-1 max-w-xs text-sm leading-5 text-slate-400">New consultant requests will appear here and notify administrators.</p></div> : null}
        </main>
      </motion.aside>
    </motion.div>,
    document.body,
  );
}
