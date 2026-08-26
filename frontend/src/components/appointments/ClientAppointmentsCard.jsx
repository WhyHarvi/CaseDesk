import { CalendarDays, ChevronLeft, ChevronRight, Clock3, Loader2, NotebookPen, Plus, Search, UserRound, Video } from "lucide-react";
import { motion } from "framer-motion";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import api from "../../services/api";

const statusTone = {
  Scheduled: "bg-sky-50 text-sky-700",
  Completed: "bg-emerald-50 text-emerald-700",
  Cancelled: "bg-rose-50 text-rose-700",
  NoShow: "bg-amber-50 text-amber-700",
};

function when(value) {
  return new Intl.DateTimeFormat("en-CA", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

export default function ClientAppointmentsCard({ clientId, onOpenAppointment }) {
  const [scope, setScope] = useState("all");
  const [status, setStatus] = useState("");
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [page, setPage] = useState(1);
  const [appointments, setAppointments] = useState([]);
  const [meta, setMeta] = useState({ page: 1, pages: 1, total: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(search.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [search]);

  useEffect(() => { setPage(1); }, [scope, status, debouncedSearch]);

  async function load() {
    try {
      setLoading(true);
      const query = new URLSearchParams({ scope, page: String(page), limit: "12" });
      if (status) query.set("status", status);
      if (debouncedSearch) query.set("search", debouncedSearch);
      const response = await api.get(`/clients/${clientId}/appointments?${query.toString()}`);
      setAppointments(response.data.data || []);
      setMeta(response.data.meta || { page: 1, pages: 1, total: 0 });
      setError("");
    } catch (requestError) {
      setError(requestError.response?.data?.message || "Appointments could not be loaded.");
    } finally { setLoading(false); }
  }

  useEffect(() => { load(); }, [clientId, scope, status, debouncedSearch, page]);
  const next = useMemo(() => appointments.find((item) => item.status === "Scheduled" && new Date(item.endsAt) >= new Date()), [appointments]);

  return <>
    <section className="overflow-hidden rounded-[2rem] border border-slate-200/90 bg-white shadow-[0_14px_38px_rgba(15,23,42,0.07)]">
      <header className="flex flex-col gap-4 border-b border-slate-200/80 px-5 py-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3"><span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-sky-50 text-sky-600"><CalendarDays className="h-5 w-5" /></span><div><h3 className="text-lg font-semibold text-slate-950">Appointments</h3><p className="mt-0.5 text-sm text-slate-500">Every consultation and meeting across this client’s matters.</p></div></div>
        <div className="flex items-center gap-2"><span className="rounded-full bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-600">{meta.total} {scope === "upcoming" ? "upcoming" : scope === "history" ? "past" : "total"}</span><Link to={`/app/calendar?bookForClient=${clientId}`} className="inline-flex h-10 items-center gap-2 rounded-full bg-slate-950 px-4 text-xs font-semibold text-white"><Plus className="h-3.5 w-3.5" />Book</Link></div>
      </header>
      {scope !== "history" && next ? <button type="button" onClick={() => onOpenAppointment(next.id)} className="grid w-full gap-3 border-b border-sky-100 bg-[linear-gradient(135deg,#f0f9ff,#ffffff)] px-5 py-4 text-left sm:grid-cols-[auto_1fr_auto] sm:items-center"><span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-white text-sky-600 shadow-sm"><Clock3 className="h-4 w-4" /></span><span><span className="block text-[10px] font-semibold uppercase tracking-[0.16em] text-sky-600">Next appointment</span><span className="mt-1 block text-sm font-semibold text-slate-900">{next.subject} · {when(next.startsAt)}</span></span><span className="text-xs font-semibold text-sky-700">Open profile →</span></button> : null}
      <div className="flex flex-col gap-3 border-b border-slate-200/80 bg-slate-50/55 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative grid grid-cols-3 rounded-full bg-slate-100 p-1">{[["all", "All"], ["upcoming", "Upcoming"], ["history", "History"]].map(([id, label]) => <button key={id} type="button" onClick={() => setScope(id)} className={`relative z-10 rounded-full px-4 py-1.5 text-xs font-semibold ${scope === id ? "text-slate-950" : "text-slate-500"}`}>{scope === id ? <motion.span layoutId="client-appointment-scope" className="absolute inset-0 -z-10 rounded-full bg-white shadow-sm" /> : null}{label}</button>)}</div>
        <div className="flex min-w-0 flex-1 gap-2 sm:max-w-lg"><label className="relative min-w-0 flex-1"><Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search appointments" className="h-9 w-full rounded-full border border-slate-200 bg-white pl-9 pr-3 text-xs outline-none focus:border-sky-400" /></label><select value={status} onChange={(event) => setStatus(event.target.value)} className="h-9 rounded-full border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-600 outline-none"><option value="">All statuses</option><option value="Scheduled">Scheduled</option><option value="Completed">Completed</option><option value="Cancelled">Cancelled</option><option value="NoShow">No-show</option></select></div>
      </div>
      {error ? <p className="m-4 rounded-2xl bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</p> : null}
      {loading ? <div className="flex items-center justify-center gap-2 py-12 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" />Loading appointments…</div> : <div className="divide-y divide-slate-200/80">{appointments.length ? appointments.map((item) => <button key={item.id} type="button" onClick={() => onOpenAppointment(item.id)} className="grid w-full gap-3 px-5 py-4 text-left transition hover:bg-slate-50/90 sm:grid-cols-[auto_1.2fr_0.8fr_auto] sm:items-center"><span className="flex h-11 w-11 flex-col items-center justify-center rounded-2xl bg-slate-100"><span className="text-[10px] font-bold uppercase text-slate-500">{new Date(item.startsAt).toLocaleDateString("en-CA", { month: "short" })}</span><span className="text-base font-semibold leading-4 text-slate-800">{new Date(item.startsAt).getDate()}</span></span><span className="min-w-0"><span className="block truncate text-sm font-semibold text-slate-900">{item.subject}</span><span className="mt-1 block truncate text-xs text-slate-500">{item.purpose || item.description || item.sessionType?.name || "No purpose recorded"}</span></span><span className="min-w-0"><span className="block truncate text-xs font-semibold text-slate-700"><UserRound className="mr-1 inline h-3.5 w-3.5" />{item.assignedTo?.fullName || "Unassigned"}</span><span className="mt-1 block truncate text-xs text-slate-500"><Video className="mr-1 inline h-3.5 w-3.5" />{when(item.startsAt)}{item.case?.caseType ? ` · ${item.case.caseType}` : ""}</span></span><span className="flex items-center gap-2"><span className={`rounded-full px-2.5 py-1 text-[10px] font-semibold ${statusTone[item.status] || "bg-slate-100 text-slate-600"}`}>{item.status === "NoShow" ? "No-show" : item.status}</span>{item._count?.notes ? <span title={`${item._count.notes} notes`} className="inline-flex items-center gap-1 text-[10px] font-semibold text-violet-600"><NotebookPen className="h-3.5 w-3.5" />{item._count.notes}</span> : null}</span></button>) : <div className="px-6 py-14 text-center"><CalendarDays className="mx-auto h-6 w-6 text-slate-400" /><p className="mt-3 text-sm font-semibold text-slate-700">No {scope === "all" ? "" : `${scope} `}appointments</p><p className="mt-1 text-sm text-slate-500">Appointments linked to this client will appear here.</p></div>}</div>}
      {meta.pages > 1 ? <footer className="flex items-center justify-between border-t border-slate-200/80 px-4 py-3"><span className="text-xs text-slate-500">Page {meta.page} of {meta.pages}</span><div className="flex gap-2"><button type="button" disabled={page <= 1} onClick={() => setPage((value) => value - 1)} className="flex h-8 w-8 items-center justify-center rounded-full border border-slate-300 disabled:opacity-30"><ChevronLeft className="h-4 w-4" /></button><button type="button" disabled={page >= meta.pages} onClick={() => setPage((value) => value + 1)} className="flex h-8 w-8 items-center justify-center rounded-full border border-slate-300 disabled:opacity-30"><ChevronRight className="h-4 w-4" /></button></div></footer> : null}
    </section>
  </>;
}
