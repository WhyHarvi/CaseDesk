import { AnimatePresence, motion } from "framer-motion";
import { AlertTriangle, Check, ExternalLink, Landmark, Loader2, RefreshCw } from "lucide-react";
import { useState } from "react";
import api from "../../services/api";

function formatWhen(value) {
  if (!value) return "";
  const diffMs = Date.now() - new Date(value).getTime();
  const minutes = Math.round(diffMs / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return new Date(value).toLocaleDateString("en-CA", { month: "short", day: "numeric" });
}

export default function QuickBooksSyncCard({ clientId, qbCustomerId, qbSyncStatus, qbSyncError, qbSyncedAt, quickBooksCompanyUrl, onSynced }) {
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState(qbSyncError || "");
  const [justSynced, setJustSynced] = useState(false);

  const linked = qbSyncStatus === "synced" && qbCustomerId;
  const failed = qbSyncStatus === "error";

  async function sync() {
    setSyncing(true);
    setError("");
    try {
      const response = await api.post(`/clients/${clientId}/quickbooks-sync`);
      onSynced?.(response.data.data);
      setJustSynced(true);
      window.setTimeout(() => setJustSynced(false), 1800);
    } catch (reason) {
      const message = reason.response?.data?.message || "QuickBooks sync failed.";
      setError(message);
      onSynced?.({ qbSyncStatus: "error", qbSyncError: message });
    } finally {
      setSyncing(false);
    }
  }

  return (
    <article className="rounded-[1.9rem] border border-slate-200/90 bg-white px-5 py-4 shadow-[0_14px_38px_rgba(15,23,42,0.07)]">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${linked ? "bg-emerald-50 text-emerald-600" : failed ? "bg-rose-50 text-rose-600" : "bg-slate-100 text-slate-500"}`}>
            <Landmark className="h-[18px] w-[18px]" />
          </span>
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Billing</p>
            <h3 className="mt-0.5 text-base font-semibold text-slate-950">QuickBooks</h3>
            {linked ? (
              <p className="mt-0.5 text-sm text-slate-500">
                Synced {qbSyncedAt ? formatWhen(qbSyncedAt) : ""}
                {quickBooksCompanyUrl ? (
                  <a href={`${quickBooksCompanyUrl}/app/customerdetail?nameId=${qbCustomerId}`} target="_blank" rel="noopener noreferrer" className="ml-1.5 inline-flex items-center gap-1 font-medium text-sky-700 hover:text-sky-800">
                    View <ExternalLink className="h-3 w-3" />
                  </a>
                ) : null}
              </p>
            ) : failed ? (
              <p className="mt-0.5 text-sm text-rose-600">Sync failed</p>
            ) : (
              <p className="mt-0.5 text-sm text-slate-500">Not synced yet</p>
            )}
          </div>
        </div>

        <button
          type="button"
          onClick={sync}
          disabled={syncing}
          className="flex h-9 shrink-0 items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3.5 text-xs font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-slate-50 disabled:opacity-60"
        >
          <AnimatePresence mode="wait">
            {syncing ? (
              <motion.span key="syncing" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex items-center gap-1.5">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Syncing…
              </motion.span>
            ) : justSynced ? (
              <motion.span key="synced" initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }} className="flex items-center gap-1.5 text-emerald-600">
                <Check className="h-3.5 w-3.5" /> Synced
              </motion.span>
            ) : (
              <motion.span key="idle" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex items-center gap-1.5">
                <RefreshCw className="h-3.5 w-3.5" /> {failed ? "Retry" : linked ? "Sync now" : "Sync now"}
              </motion.span>
            )}
          </AnimatePresence>
        </button>
      </div>

      {error ? (
        <p className="mt-3 flex items-start gap-2 rounded-2xl bg-rose-50 px-3.5 py-2.5 text-xs leading-5 text-rose-700">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {error}
        </p>
      ) : null}
    </article>
  );
}
