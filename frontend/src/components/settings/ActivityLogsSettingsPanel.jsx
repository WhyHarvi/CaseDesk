import { Activity, CalendarDays, ChevronLeft, ChevronRight, FileText, Loader2, Search, ShieldCheck, UserRound } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../../auth/AuthContext";
import api from "../../services/api";

const categories = [["all", "All activity"], ["security", "Security"], ["clients", "Clients"], ["cases", "Cases"], ["documents", "Documents"], ["appointments", "Appointments"], ["communications", "Communication"], ["settings", "Settings"]];

function actionLabel(action) {
  const labels = { USER_LOGIN: "Signed in", USER_LOGOUT: "Signed out", PASSWORD_CHANGED: "Password changed", PASSWORD_RESET_REQUESTED: "Password reset requested" };
  return labels[action] || String(action || "Activity").replace(/[._]/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatDate(value) {
  return new Intl.DateTimeFormat("en-CA", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(value));
}

function activityLink(item, role) {
  if (role === "client") return null;
  if (item.case?.id) return `/app/cases/${item.case.id}`;
  if (item.client?.id) return `/app/clients/${item.client.id}`;
  return null;
}

export default function ActivityLogsSettingsPanel({ compact = false }) {
  const { role } = useAuth();
  const [items, setItems] = useState([]);
  const [meta, setMeta] = useState({ page: 1, totalPages: 1, total: 0, canViewWorkspace: false, scope: "mine" });
  const [scope, setScope] = useState("mine");
  const [category, setCategory] = useState("all");
  const [range, setRange] = useState("30");
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const timer = window.setTimeout(() => { setSearch(searchInput.trim()); setPage(1); }, 300);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    api.getFresh("/account/activity", { params: { page, limit: 15, scope, category, range, ...(search ? { search } : {}) } })
      .then((response) => {
        if (!active) return;
        setItems(response.data.data || []);
        setMeta(response.data.meta || {});
        if (response.data.meta?.scope && response.data.meta.scope !== scope) setScope(response.data.meta.scope);
      })
      .catch((reason) => { if (active) setError(reason.response?.data?.message || "Activity could not be loaded."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [category, page, range, scope, search]);

  const pageLabel = useMemo(() => `Page ${meta.page || page} of ${meta.totalPages || 1}`, [meta.page, meta.totalPages, page]);

  return (
    <div className={compact ? "pb-6" : "pb-10"}>
      <header className="flex items-start gap-3 border-b border-slate-100 pb-6">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-indigo-50 text-indigo-700"><Activity className="h-5 w-5" /></span>
        <div><h2 className="text-[24px] font-semibold tracking-[-0.035em] text-slate-950">Activity Logs</h2><p className="mt-1 max-w-2xl text-[14px] leading-6 text-slate-500">A searchable audit trail of account and workspace changes—not another dashboard summary.</p></div>
      </header>

      {meta.canViewWorkspace ? <div className="mt-5 inline-flex rounded-full bg-slate-100 p-1"><button type="button" onClick={() => { setScope("mine"); setPage(1); }} className={`rounded-full px-4 py-2 text-[12px] font-semibold transition ${scope === "mine" ? "bg-white text-slate-950 shadow-sm" : "text-slate-500"}`}>My activity</button><button type="button" onClick={() => { setScope("workspace"); setPage(1); }} className={`rounded-full px-4 py-2 text-[12px] font-semibold transition ${scope === "workspace" ? "bg-white text-slate-950 shadow-sm" : "text-slate-500"}`}>Workspace activity</button></div> : null}

      <div className="mt-5 flex flex-col gap-2 sm:flex-row">
        <label className="relative min-w-0 flex-1"><Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-slate-400" /><input value={searchInput} onChange={(event) => setSearchInput(event.target.value)} placeholder="Search activity" className="h-10 w-full rounded-xl border border-slate-200 bg-white pl-9 pr-3 text-[13px] outline-none transition focus:border-slate-400 focus:ring-4 focus:ring-slate-100" /></label>
        <select value={category} onChange={(event) => { setCategory(event.target.value); setPage(1); }} className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-[12px] font-semibold text-slate-600 outline-none">{categories.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
        <select value={range} onChange={(event) => { setRange(event.target.value); setPage(1); }} className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-[12px] font-semibold text-slate-600 outline-none"><option value="7">Last 7 days</option><option value="30">Last 30 days</option><option value="all">All time</option></select>
      </div>

      <div className="mt-5 border-y border-slate-100">
        {loading ? <div className="flex min-h-48 items-center justify-center gap-2 text-[13px] text-slate-400"><Loader2 className="h-4 w-4 animate-spin" /> Loading activity…</div> : error ? <p className="my-4 rounded-xl bg-rose-50 px-4 py-3 text-[13px] text-rose-700">{error}</p> : items.length ? items.map((item) => {
          const link = activityLink(item, role);
          const content = <><span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl bg-slate-50 text-slate-500">{item.action.includes("USER_") || item.action.includes("PASSWORD") ? <ShieldCheck className="h-4 w-4" /> : item.case || item.client ? <FileText className="h-4 w-4" /> : <UserRound className="h-4 w-4" />}</span><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-x-2 gap-y-1"><p className="text-[13px] font-semibold text-slate-900">{actionLabel(item.action)}</p>{scope === "workspace" && item.user?.fullName ? <span className="text-[11px] text-slate-400">by {item.user.fullName}</span> : null}</div><p className="mt-0.5 line-clamp-2 text-[12px] leading-5 text-slate-500">{item.details || item.case?.caseType || item.client?.fullName || "Activity recorded"}</p>{item.client?.fullName || item.case?.caseType ? <p className="mt-1 text-[11px] font-medium text-slate-400">{[item.client?.fullName, item.case?.caseType].filter(Boolean).join(" · ")}</p> : null}</div><time className="shrink-0 text-right text-[10px] leading-4 text-slate-400">{formatDate(item.createdAt)}</time></>;
          return link ? <Link key={item.id} to={link} className="flex gap-3 border-b border-slate-100 py-4 transition last:border-b-0 hover:bg-slate-50/60">{content}</Link> : <div key={item.id} className="flex gap-3 border-b border-slate-100 py-4 last:border-b-0">{content}</div>;
        }) : <div className="py-14 text-center"><CalendarDays className="mx-auto h-6 w-6 text-slate-300" /><p className="mt-3 text-[13px] font-semibold text-slate-700">No matching activity</p><p className="mt-1 text-[12px] text-slate-400">Try a different category, date range, or search.</p></div>}
      </div>

      <div className="mt-4 flex items-center justify-between gap-3">
        <p className="text-[11px] text-slate-400">{meta.total || 0} records · {pageLabel}</p>
        <div className="flex items-center gap-2"><button type="button" disabled={loading || page <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))} className="inline-flex h-9 items-center gap-1 rounded-full border border-slate-200 px-3 text-[12px] font-semibold text-slate-600 disabled:opacity-35"><ChevronLeft className="h-3.5 w-3.5" /> Previous</button><button type="button" disabled={loading || page >= (meta.totalPages || 1)} onClick={() => setPage((current) => current + 1)} className="inline-flex h-9 items-center gap-1 rounded-full border border-slate-200 px-3 text-[12px] font-semibold text-slate-600 disabled:opacity-35">Next <ChevronRight className="h-3.5 w-3.5" /></button></div>
      </div>
    </div>
  );
}
