import { Check, Handshake, Loader2, Search, ShieldCheck, Sparkles, UserRound, UsersRound, X } from "lucide-react";
import { motion } from "framer-motion";
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import api from "../../services/api";
import { Avatar } from "../workload/workloadVisuals";

const glass = "rounded-[1.6rem] border border-white/70 bg-white/85 shadow-[0_18px_50px_rgba(15,23,42,0.08)] backdrop-blur-2xl";
const spring = { type: "spring", stiffness: 320, damping: 30 };

export default function CasePermissionsOverlay({ caseItem, onClose, onSaved }) {
  const [data, setData] = useState(null);
  const [ownerUserId, setOwnerUserId] = useState("");
  const [collaboratorUserIds, setCollaboratorUserIds] = useState([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKeyDown = (event) => event.key === "Escape" && !saving && onClose();
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [onClose, saving]);

  useEffect(() => {
    let active = true;
    api.get(`/cases/${caseItem.id}/permissions`)
      .then((response) => {
        if (!active) return;
        const next = response.data.data;
        setData(next);
        setOwnerUserId(next.owner?.id || "");
        setCollaboratorUserIds(next.collaborators.map((item) => item.id));
      })
      .catch((reason) => active && setError(reason.response?.data?.message || "Case permissions could not be loaded."))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [caseItem.id]);

  const visibleConsultants = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return (data?.consultants || []).filter((item) => !needle || `${item.fullName} ${item.email || ""}`.toLowerCase().includes(needle));
  }, [data, query]);

  function toggleCollaborator(userId) {
    setMessage("");
    setCollaboratorUserIds((current) => current.includes(userId) ? current.filter((id) => id !== userId) : [...current, userId]);
  }

  async function save() {
    setSaving(true);
    setError("");
    setMessage("");
    try {
      const response = await api.put(`/cases/${caseItem.id}/permissions`, { ownerUserId, collaboratorUserIds });
      const next = response.data.data;
      setData(next);
      setOwnerUserId(next.owner?.id || "");
      setCollaboratorUserIds(next.collaborators.map((item) => item.id));
      setMessage(response.data.message || "Case permissions updated.");
      onSaved?.(next);
    } catch (reason) {
      setError(reason.response?.data?.message || "Case permissions could not be updated.");
    } finally {
      setSaving(false);
    }
  }

  if (typeof document === "undefined") return null;
  const currentOwnerUnavailable = data?.owner && !data.consultants.some((item) => item.id === data.owner.id);

  return createPortal(
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[360] flex items-center justify-center bg-[radial-gradient(circle_at_15%_-6%,rgba(139,92,246,0.28),transparent_40%),radial-gradient(circle_at_88%_18%,rgba(56,130,246,0.24),transparent_42%),rgba(8,11,23,0.6)] p-3 backdrop-blur-md sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-labelledby="case-permissions-title"
      onMouseDown={(event) => event.target === event.currentTarget && !saving && onClose()}
    >
      <motion.div
        initial={{ opacity: 0, y: 22, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={spring}
        className={`flex max-h-[92vh] w-full max-w-5xl min-w-0 flex-col overflow-hidden ${glass}`}
      >
        <header className="flex shrink-0 items-center justify-between gap-3 border-b border-white/70 bg-white/70 px-4 py-3.5 sm:px-6 sm:py-4">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-violet-50 text-violet-600 ring-1 ring-violet-100"><Handshake className="h-5 w-5" /></span>
            <div className="min-w-0">
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-violet-600">Collaboration</p>
              <h2 id="case-permissions-title" className="truncate text-lg font-semibold text-slate-950">{caseItem.client?.fullName || "Client"} · {caseItem.caseType}</h2>
            </div>
          </div>
          <button type="button" disabled={saving} onClick={onClose} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-slate-100/80 text-slate-500 transition hover:bg-slate-200 disabled:opacity-50" aria-label="Close collaboration"><X className="h-4 w-4" /></button>
        </header>

        <main className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-6 sm:py-6">
          <div className="w-full space-y-4">
            {loading ? <div className="flex min-h-64 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-violet-500" /></div> : null}
            {!loading && data ? (
              <>
                <section className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
                  <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ ...spring, delay: 0.03 }} className="rounded-[1.4rem] border border-white/70 bg-white/80 p-5 shadow-sm sm:p-6">
                    <div className="flex items-start gap-3">
                      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-sky-50 text-sky-600 ring-1 ring-sky-100"><UserRound className="h-5 w-5" /></span>
                      <div><h3 className="font-semibold text-slate-950">Primary case owner</h3><p className="mt-1 text-sm leading-5 text-slate-500">Owns the case in Team Workload and receives unassigned case work.</p></div>
                    </div>
                    <label className="mt-5 block text-sm font-semibold text-slate-700">
                      Assigned consultant
                      <select
                        value={ownerUserId}
                        disabled={saving || data.archived}
                        onChange={(event) => {
                          const nextOwner = event.target.value;
                          setOwnerUserId(nextOwner);
                          setCollaboratorUserIds((current) => current.filter((id) => id !== nextOwner));
                        }}
                        className="mt-2 h-12 w-full rounded-2xl border border-slate-200 bg-white px-4 text-base font-medium text-slate-800 outline-none transition focus:border-sky-400 focus:ring-4 focus:ring-sky-100"
                      >
                        <option value="">Choose a consultant</option>
                        {currentOwnerUnavailable ? <option value={data.owner.id} disabled>{data.owner.fullName} (unavailable)</option> : null}
                        {data.consultants.map((item) => <option key={item.id} value={item.id}>{item.fullName}</option>)}
                      </select>
                    </label>
                    {ownerUserId ? (
                      <div className="mt-4 flex items-center gap-2.5 rounded-2xl bg-sky-50/70 px-3.5 py-2.5 ring-1 ring-sky-100">
                        <Avatar id={ownerUserId} fullName={data.consultants.find((item) => item.id === ownerUserId)?.fullName || data.owner?.fullName || "?"} size={30} />
                        <p className="min-w-0 truncate text-sm font-semibold text-sky-900">{data.consultants.find((item) => item.id === ownerUserId)?.fullName || data.owner?.fullName}</p>
                      </div>
                    ) : null}
                  </motion.div>

                  <motion.aside initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ ...spring, delay: 0.06 }} className="rounded-[1.4rem] border border-violet-100 bg-violet-50/70 p-5 backdrop-blur-xl">
                    <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-white text-violet-600 ring-1 ring-violet-100"><Sparkles className="h-4 w-4" /></span>
                    <h3 className="mt-3 font-semibold text-violet-950">What this controls</h3>
                    <p className="mt-2 text-sm leading-6 text-violet-800">Collaborators can open and work on this case. Their workspace-level form and communication permissions still apply.</p>
                    <p className="mt-3 text-sm leading-6 text-violet-800">Administrators always retain access. Client portal access is managed separately through the Portal Access card.</p>
                  </motion.aside>
                </section>

                <motion.section initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ ...spring, delay: 0.09 }} className="rounded-[1.4rem] border border-white/70 bg-white/80 p-5 shadow-sm sm:p-6">
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex items-start gap-3">
                      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-600 ring-1 ring-emerald-100"><UsersRound className="h-5 w-5" /></span>
                      <div><h3 className="font-semibold text-slate-950">Collaborating consultants</h3><p className="mt-1 text-sm text-slate-500">Grant additional consultants access without changing ownership.</p></div>
                    </div>
                    <label className="relative block w-full sm:w-72">
                      <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                      <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search consultants" className="h-10 w-full rounded-full border border-slate-200 bg-white pl-10 pr-4 text-sm outline-none transition focus:border-sky-400 focus:ring-4 focus:ring-sky-100" />
                    </label>
                  </div>
                  <div className="mt-5 grid gap-2 sm:grid-cols-2">
                    {visibleConsultants.map((consultant, index) => {
                      const isOwner = consultant.id === ownerUserId;
                      const selected = isOwner || collaboratorUserIds.includes(consultant.id);
                      return (
                        <motion.button
                          key={consultant.id}
                          type="button"
                          initial={{ opacity: 0, y: 6 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ duration: 0.16, delay: Math.min(index * 0.02, 0.2) }}
                          disabled={saving || data.archived || isOwner}
                          onClick={() => toggleCollaborator(consultant.id)}
                          className={`flex items-center gap-3 rounded-2xl border p-3.5 text-left transition ${selected ? "border-emerald-200 bg-emerald-50/70 ring-1 ring-emerald-100" : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50/60"} ${isOwner ? "cursor-default opacity-75" : ""}`}
                        >
                          <span className="relative shrink-0">
                            <Avatar id={consultant.id} fullName={consultant.fullName} size={36} />
                            {selected ? (
                              <span className="absolute -bottom-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-emerald-500 text-white ring-2 ring-white"><Check className="h-2.5 w-2.5" /></span>
                            ) : null}
                          </span>
                          <span className="min-w-0"><span className="block truncate text-sm font-semibold text-slate-900">{consultant.fullName}</span><span className="block truncate text-xs text-slate-500">{isOwner ? "Primary owner" : consultant.email || "Consultant"}</span></span>
                        </motion.button>
                      );
                    })}
                  </div>
                  {!visibleConsultants.length ? <p className="mt-5 rounded-2xl border border-dashed border-slate-200 bg-slate-50/70 p-8 text-center text-sm text-slate-500">No active consultants match this search.</p> : null}
                </motion.section>

                {data.archived ? <p className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-800">Restore this case before changing team access.</p> : null}
              </>
            ) : null}
            {error ? <p className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-700">{error}</p> : null}
            {message ? <p className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-700">{message}</p> : null}
          </div>
        </main>

        {!loading && data ? (
          <footer className="flex shrink-0 justify-end gap-2 border-t border-white/70 bg-white/70 px-4 py-3 pb-[max(env(safe-area-inset-bottom),0.75rem)] sm:px-6">
            <button type="button" disabled={saving} onClick={onClose} className="h-11 rounded-full px-5 text-sm font-semibold text-slate-600 transition hover:bg-slate-100 disabled:opacity-50">Cancel</button>
            <button type="button" disabled={saving || data.archived || !ownerUserId} onClick={save} className="inline-flex h-11 items-center justify-center gap-2 rounded-full bg-slate-950 px-6 text-sm font-semibold text-white shadow-[0_16px_36px_rgba(15,23,42,0.28)] transition hover:bg-slate-800 disabled:opacity-40">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
              {saving ? "Saving…" : "Save access"}
            </button>
          </footer>
        ) : null}
      </motion.div>
    </motion.div>,
    document.body,
  );
}
