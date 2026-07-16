import { Check, Loader2, Search, ShieldCheck, UserRound, UsersRound, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import api from "../../services/api";

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
    <div className="fixed inset-0 z-[360] flex flex-col bg-slate-100/95 backdrop-blur-xl" role="dialog" aria-modal="true" aria-labelledby="case-permissions-title">
      <header className="shrink-0 border-b border-white/80 bg-white/92 px-4 py-3 shadow-sm sm:px-6 sm:py-4">
        <div className="mx-auto flex w-full max-w-5xl items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-violet-50 text-violet-600"><ShieldCheck className="h-5 w-5" /></span>
            <div className="min-w-0">
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-violet-600">Manage permissions</p>
              <h2 id="case-permissions-title" className="truncate text-lg font-semibold text-slate-950">{caseItem.client?.fullName || "Client"} · {caseItem.caseType}</h2>
            </div>
          </div>
          <button type="button" disabled={saving} onClick={onClose} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-500 transition hover:bg-slate-200 disabled:opacity-50" aria-label="Close permissions"><X className="h-5 w-5" /></button>
        </div>
      </header>

      <main className="min-h-0 flex-1 overflow-y-auto px-3 py-4 sm:px-6 sm:py-6">
        <div className="mx-auto w-full max-w-5xl space-y-4">
          {loading ? <div className="flex min-h-64 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-violet-500" /></div> : null}
          {!loading && data ? (
            <>
              <section className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
                <div className="rounded-[1.75rem] border border-white bg-white p-5 shadow-sm sm:p-6">
                  <div className="flex items-start gap-3">
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-sky-50 text-sky-600"><UserRound className="h-5 w-5" /></span>
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
                      className="mt-2 h-12 w-full rounded-2xl border border-slate-200 bg-white px-4 text-base outline-none focus:border-sky-300 focus:ring-4 focus:ring-sky-100 disabled:bg-slate-50"
                    >
                      <option value="">Choose a consultant</option>
                      {currentOwnerUnavailable ? <option value={data.owner.id} disabled>{data.owner.fullName} (unavailable)</option> : null}
                      {data.consultants.map((item) => <option key={item.id} value={item.id}>{item.fullName}</option>)}
                    </select>
                  </label>
                </div>

                <aside className="rounded-[1.75rem] border border-violet-100 bg-violet-50/80 p-5">
                  <ShieldCheck className="h-5 w-5 text-violet-600" />
                  <h3 className="mt-3 font-semibold text-violet-950">What this controls</h3>
                  <p className="mt-2 text-sm leading-6 text-violet-800">Collaborators can open and work on this case. Their agency-level form and communication permissions still apply.</p>
                  <p className="mt-3 text-sm leading-6 text-violet-800">Administrators always retain access. Client portal access is managed separately through Send Invite.</p>
                </aside>
              </section>

              <section className="rounded-[1.75rem] border border-white bg-white p-5 shadow-sm sm:p-6">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex items-start gap-3"><span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-600"><UsersRound className="h-5 w-5" /></span><div><h3 className="font-semibold text-slate-950">Collaborating consultants</h3><p className="mt-1 text-sm text-slate-500">Grant additional consultants access without changing ownership.</p></div></div>
                  <label className="relative block w-full sm:w-72"><Search className="absolute left-3.5 top-3 h-4 w-4 text-slate-400" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search consultants" className="h-10 w-full rounded-full border border-slate-200 pl-10 pr-4 text-base outline-none focus:border-sky-300 focus:ring-4 focus:ring-sky-100" /></label>
                </div>
                <div className="mt-5 grid gap-2 sm:grid-cols-2">
                  {visibleConsultants.map((consultant) => {
                    const isOwner = consultant.id === ownerUserId;
                    const selected = isOwner || collaboratorUserIds.includes(consultant.id);
                    return (
                      <button key={consultant.id} type="button" disabled={saving || data.archived || isOwner} onClick={() => toggleCollaborator(consultant.id)} className={["flex items-center gap-3 rounded-2xl border p-3.5 text-left transition", selected ? "border-emerald-200 bg-emerald-50/70" : "border-slate-200 hover:border-slate-300", isOwner ? "cursor-default opacity-75" : ""].join(" ")}>
                        <span className={["flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-bold", selected ? "bg-emerald-600 text-white" : "bg-slate-100 text-slate-500"].join(" ")}>{selected ? <Check className="h-4 w-4" /> : consultant.fullName.slice(0, 1).toUpperCase()}</span>
                        <span className="min-w-0"><span className="block truncate text-sm font-semibold text-slate-900">{consultant.fullName}</span><span className="block truncate text-xs text-slate-500">{isOwner ? "Primary owner" : consultant.email || "Consultant"}</span></span>
                      </button>
                    );
                  })}
                </div>
                {!visibleConsultants.length ? <p className="mt-5 rounded-2xl border border-dashed border-slate-200 p-8 text-center text-sm text-slate-500">No active consultants match this search.</p> : null}
              </section>

              {data.archived ? <p className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-800">Restore this case before changing team access.</p> : null}
            </>
          ) : null}
          {error ? <p className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-700">{error}</p> : null}
          {message ? <p className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-700">{message}</p> : null}
        </div>
      </main>

      {!loading && data ? (
        <footer className="shrink-0 border-t border-slate-200/80 bg-white/95 px-4 py-3 pb-[max(env(safe-area-inset-bottom),0.75rem)] backdrop-blur">
          <div className="mx-auto flex w-full max-w-5xl justify-end gap-2"><button type="button" disabled={saving} onClick={onClose} className="h-11 rounded-full px-5 text-sm font-semibold text-slate-600 hover:bg-slate-100">Cancel</button><button type="button" disabled={saving || data.archived || !ownerUserId} onClick={save} className="inline-flex h-11 items-center justify-center gap-2 rounded-full bg-slate-950 px-6 text-sm font-semibold text-white shadow-lg disabled:opacity-40">{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}{saving ? "Saving…" : "Save access"}</button></div>
        </footer>
      ) : null}
    </div>,
    document.body,
  );
}
