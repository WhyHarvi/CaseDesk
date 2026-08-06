import { Link2, Loader2, UserPlus, X } from "lucide-react";
import { useEffect, useState } from "react";
import api from "../../../services/api";
import { humanize } from "../leadPresentation";

function Value({ label, value }) {
  return <div><p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-400">{label}</p><p className="mt-1 break-words text-sm font-medium text-slate-800">{value || "Not provided"}</p></div>;
}

export default function DuplicateReviewSheet({ eventId, onClose, onResolved }) {
  const [event, setEvent] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const load = () => api.getFresh(`/leads/intake/events/${eventId}/duplicates`).then((response) => setEvent(response.data.data)).catch((requestError) => setError(requestError.response?.data?.message || "Duplicate details could not be loaded.")).finally(() => setLoading(false));
  useEffect(() => { load(); }, [eventId]);
  async function resolve(candidateId, action) {
    try {
      setBusy(candidateId);
      setError("");
      const response = await api.post(`/leads/intake/events/${eventId}/duplicates/${candidateId}/resolve`, { action });
      if (response.data.data.eventStatus === "PROCESSED" || response.data.data.eventStatus === "PENDING") onResolved();
      else await load();
    } catch (requestError) { setError(requestError.response?.data?.message || "The match could not be resolved."); }
    finally { setBusy(""); }
  }
  async function createAnyway() {
    try {
      setBusy("create"); setError("");
      await api.post(`/leads/intake/events/${eventId}/create-anyway`);
      onResolved();
    } catch (requestError) { setError(requestError.response?.data?.message || "A new lead could not be created."); }
    finally { setBusy(""); }
  }
  const incoming = event?.normalizedPayload || event?.rawPayload || {};
  return <div className="fixed inset-0 z-[180] flex justify-end bg-slate-950/30 backdrop-blur-md" role="dialog" aria-modal="true" aria-label="Duplicate review"><button className="absolute inset-0" type="button" onClick={onClose} aria-label="Close duplicate review" /><aside className="relative flex h-full w-full max-w-5xl flex-col overflow-hidden border-l border-white/80 bg-[#f5f7fa] shadow-[-30px_0_100px_rgba(15,23,42,0.25)]"><header className="flex items-start justify-between border-b border-slate-200 bg-white px-6 py-5"><div><p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-violet-600">Duplicate resolution</p><h2 className="mt-1 text-xl font-semibold text-slate-950">Compare the incoming inquiry</h2><p className="mt-1 text-sm text-slate-500">Link it to the correct lead, dismiss false matches, or create a separate lead.</p></div><button type="button" onClick={onClose} className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-100 text-slate-500"><X className="h-4 w-4" /></button></header><main className="min-h-0 flex-1 overflow-y-auto p-6">{error ? <p className="mb-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</p> : null}{loading ? <div className="flex items-center justify-center gap-2 py-24 text-sm text-slate-400"><Loader2 className="h-4 w-4 animate-spin" />Loading matches…</div> : event ? <div className="grid gap-5 lg:grid-cols-[0.8fr_1.2fr]"><section className="h-fit rounded-3xl border border-violet-200 bg-violet-50/60 p-5"><p className="text-xs font-semibold uppercase tracking-[0.12em] text-violet-700">Incoming submission</p><div className="mt-5 grid gap-4 sm:grid-cols-2"><Value label="Name" value={[incoming.firstName, incoming.lastName].filter(Boolean).join(" ") || incoming.fullName} /><Value label="Phone" value={incoming.phone} /><Value label="Email" value={incoming.email} /><Value label="Interest" value={incoming.immigrationInterest} /><Value label="Message" value={incoming.initialMessage} /></div></section><section className="space-y-3">{event.duplicateCandidates.map((candidate) => { const lead = candidate.candidateLead; return <article key={candidate.id} className={`rounded-3xl border bg-white p-5 shadow-sm ${candidate.status === "PENDING" ? "border-slate-200" : "border-slate-100 opacity-65"}`}><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="font-semibold text-slate-950">{[lead.firstName, lead.lastName].filter(Boolean).join(" ") || "Unnamed lead"}</p><p className="mt-1 text-xs text-slate-500">{lead.leadNumber} · {humanize(lead.stage)} · {lead.owner?.fullName || "Unassigned"}</p></div><span className="rounded-full bg-violet-50 px-2.5 py-1 text-[10px] font-semibold text-violet-700">{candidate.score}% match</span></div><div className="mt-4 grid gap-3 sm:grid-cols-2"><Value label="Phone" value={lead.phone} /><Value label="Email" value={lead.email} /></div><p className="mt-4 text-xs text-slate-500">{Array.isArray(candidate.reasons) ? candidate.reasons.join(" · ") : "Potential duplicate"}</p>{candidate.status === "PENDING" ? <div className="mt-4 flex flex-wrap gap-2"><button type="button" disabled={Boolean(busy)} onClick={() => resolve(candidate.id, "LINK")} className="inline-flex h-9 items-center gap-1.5 rounded-full bg-slate-950 px-4 text-xs font-semibold text-white"><Link2 className="h-3.5 w-3.5" />Link to this lead</button><button type="button" disabled={Boolean(busy)} onClick={() => resolve(candidate.id, "DISMISS")} className="h-9 rounded-full border border-slate-200 px-4 text-xs font-semibold text-slate-600">Dismiss match</button></div> : <p className="mt-4 text-xs font-semibold text-slate-500">{humanize(candidate.status)}</p>}</article>; })}<button type="button" disabled={Boolean(busy)} onClick={createAnyway} className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-2xl border border-dashed border-violet-300 bg-white text-sm font-semibold text-violet-700 hover:bg-violet-50"><UserPlus className="h-4 w-4" />Create as a new lead anyway</button></section></div> : null}</main></aside></div>;
}
