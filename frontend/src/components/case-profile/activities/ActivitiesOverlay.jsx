import { ChevronLeft, ChevronRight, History, LoaderCircle, X } from "lucide-react";
import { motion } from "framer-motion";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import api from "../../../services/api";
import ActivityItem from "./ActivityItem";

const PAGE_SIZE = 10;

export default function ActivitiesOverlay({ caseItem, initialActivities = [], onClose }) {
  const [activities, setActivities] = useState(initialActivities.slice(0, PAGE_SIZE));
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(initialActivities.length);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  useEffect(() => {
    let active = true;
    async function loadActivities() {
      try {
        setLoading(true);
        const response = await api.get(`/activity-logs?caseId=${encodeURIComponent(caseItem.id)}&page=${page}&limit=${PAGE_SIZE}`);
        if (!active) return;
        setActivities(response.data.data || []);
        setTotal(Number(response.data.meta?.total || 0));
        setError("");
      } catch (requestError) {
        if (active) setError(requestError.response?.data?.message || "Activity could not load.");
      } finally {
        if (active) setLoading(false);
      }
    }
    loadActivities();
    return () => { active = false; };
  }, [caseItem.id, page]);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    function handleKeyDown(event) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose]);

  return createPortal(
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[180] flex justify-end bg-slate-950/25 backdrop-blur-sm" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <motion.section initial={{ x: 70, opacity: 0.85 }} animate={{ x: 0, opacity: 1 }} exit={{ x: 70, opacity: 0 }} transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }} className="flex h-full w-full max-w-xl flex-col border-l border-white/80 bg-[linear-gradient(180deg,rgba(248,250,252,0.98),rgba(241,245,249,0.98))] shadow-[-24px_0_80px_rgba(15,23,42,0.16)]">
        <header className="flex shrink-0 items-center justify-between gap-4 border-b border-slate-200/70 bg-white/80 px-5 py-4 backdrop-blur-xl sm:px-7">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-slate-950 text-white shadow-[0_10px_25px_rgba(15,23,42,0.18)]"><History className="h-5 w-5" /></div>
            <div className="min-w-0"><p className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400">{caseItem.caseType || "Case profile"}</p><h2 className="truncate text-xl font-semibold tracking-tight text-slate-950">Activity</h2></div>
          </div>
          <button type="button" onClick={onClose} className="flex h-10 w-10 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 transition hover:border-slate-300 hover:text-slate-950" aria-label="Close activity"><X className="h-4 w-4" /></button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-6 sm:px-7">
          {error ? <p className="rounded-2xl bg-rose-50 px-4 py-3 text-sm font-medium text-rose-700">{error}</p> : null}
          {loading && !activities.length ? (
            <div className="flex min-h-64 items-center justify-center"><LoaderCircle className="h-6 w-6 animate-spin text-slate-400" /></div>
          ) : activities.length ? (
            <div className={`transition ${loading ? "opacity-45" : "opacity-100"}`}>{activities.map((activity, index) => <ActivityItem key={activity.id} activity={activity} isLast={index === activities.length - 1} />)}</div>
          ) : !error ? (
            <div className="rounded-[1.75rem] border border-dashed border-slate-200 bg-white/55 px-6 py-12 text-center"><div className="mx-auto flex h-11 w-11 items-center justify-center rounded-2xl bg-white text-slate-400 shadow-sm"><History className="h-5 w-5" /></div><h3 className="mt-4 text-sm font-semibold text-slate-900">No activity yet</h3><p className="mt-1 text-sm text-slate-400">Actions on this case will appear here.</p></div>
          ) : null}
        </div>

        {total > PAGE_SIZE ? (
          <footer className="flex shrink-0 items-center justify-between border-t border-slate-200/70 bg-white/75 px-5 py-4 backdrop-blur-xl sm:px-7">
            <button type="button" onClick={() => setPage((current) => Math.max(1, current - 1))} disabled={page === 1 || loading} className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 transition hover:border-slate-300 disabled:cursor-not-allowed disabled:opacity-40"><ChevronLeft className="h-3.5 w-3.5" /> Previous</button>
            <span className="text-xs font-medium text-slate-400">Page {page} of {totalPages}</span>
            <button type="button" onClick={() => setPage((current) => Math.min(totalPages, current + 1))} disabled={page >= totalPages || loading} className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 transition hover:border-slate-300 disabled:cursor-not-allowed disabled:opacity-40">Next <ChevronRight className="h-3.5 w-3.5" /></button>
          </footer>
        ) : null}
      </motion.section>
    </motion.div>,
    document.body,
  );
}
