import { AnimatePresence, motion } from "framer-motion";
import { ArchiveRestore, Trash2, X } from "lucide-react";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";
import api from "../../services/api";

function formatDeletedDate(value) {
  if (!value) return "";
  return new Date(value).toLocaleDateString("en-CA", { month: "short", day: "numeric", year: "numeric" });
}

export default function CaseTrashOverlay({ open, onClose, onRestored }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [restoringId, setRestoringId] = useState("");

  useEffect(() => {
    if (!open) return undefined;
    let active = true;
    setLoading(true);
    setError("");
    api
      .get("/cases?trash=1")
      .then((response) => {
        if (active) setItems(response.data.data || []);
      })
      .catch((requestError) => {
        if (active) setError(requestError.response?.data?.message || "Unable to load the trash.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    function onKeyDown(event) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  async function restore(item) {
    setRestoringId(item.id);
    setError("");
    try {
      const response = await api.patch(`/cases/${item.id}/restore`);
      setItems((current) => current.filter((entry) => entry.id !== item.id));
      onRestored?.(response.data.data);
    } catch (requestError) {
      setError(requestError.response?.data?.message || "Unable to restore this case.");
    } finally {
      setRestoringId("");
    }
  }

  if (typeof document === "undefined") return null;

  return createPortal(
    <AnimatePresence>
      {open ? (
        <motion.div
          key="case-trash-overlay"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
          className="fixed inset-0 z-[9999] flex justify-end bg-slate-950/35 backdrop-blur-sm"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) onClose();
          }}
        >
          <motion.aside
            role="dialog"
            aria-modal="true"
            aria-label="Trash"
            initial={{ x: 60, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: 60, opacity: 0 }}
            transition={{ type: "spring", stiffness: 380, damping: 34 }}
            className="flex h-full w-full max-w-[440px] flex-col border-l border-white/70 bg-white/95 shadow-[-30px_0_90px_rgba(15,23,42,0.22)] backdrop-blur-2xl"
          >
            <header className="flex items-center justify-between border-b border-slate-100 px-6 py-5">
              <div className="flex items-center gap-3">
                <span className="flex h-10 w-10 items-center justify-center rounded-full bg-rose-50 text-rose-600">
                  <Trash2 className="h-5 w-5" />
                </span>
                <div>
                  <h2 className="text-lg font-semibold text-slate-950">Trash</h2>
                  <p className="text-sm text-slate-500">Deleted cases stay here until you restore them.</p>
                </div>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="flex h-10 w-10 items-center justify-center rounded-full text-slate-500 transition hover:bg-slate-100 hover:text-slate-900"
                aria-label="Close trash"
              >
                <X className="h-5 w-5" />
              </button>
            </header>

            <div className="flex-1 overflow-y-auto px-6 py-5">
              {error ? <p className="mb-4 rounded-2xl bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</p> : null}
              {loading ? (
                <div className="space-y-3">
                  {[0, 1, 2].map((key) => (
                    <div key={key} className="h-20 animate-pulse rounded-[1.4rem] bg-slate-100" />
                  ))}
                </div>
              ) : items.length === 0 ? (
                <div className="flex h-full flex-col items-center justify-center py-16 text-center">
                  <span className="flex h-14 w-14 items-center justify-center rounded-full bg-slate-100 text-slate-400">
                    <Trash2 className="h-6 w-6" />
                  </span>
                  <p className="mt-4 text-sm font-semibold text-slate-700">Trash is empty</p>
                  <p className="mt-1 max-w-[260px] text-sm text-slate-500">
                    Cases you delete will appear here and can be restored anytime.
                  </p>
                </div>
              ) : (
                <ul className="space-y-3">
                  <AnimatePresence initial={false}>
                    {items.map((item) => (
                      <motion.li
                        key={item.id}
                        layout
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, x: 24 }}
                        transition={{ duration: 0.2 }}
                        className="rounded-[1.4rem] border border-slate-200/80 bg-white px-4 py-3.5"
                      >
                        <div className="flex items-center justify-between gap-3">
                          <div className="min-w-0">
                            <Link
                              to={`/app/cases/${item.id}`}
                              onClick={onClose}
                              className="block truncate text-sm font-semibold text-slate-950 hover:text-sky-700"
                            >
                              {item.caseType}
                            </Link>
                            <p className="mt-0.5 truncate text-sm text-slate-500">
                              {item.client?.fullName || "No client"} · deleted {formatDeletedDate(item.deletedAt)}
                            </p>
                          </div>
                          <button
                            type="button"
                            disabled={restoringId === item.id}
                            onClick={() => restore(item)}
                            className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3.5 py-2 text-sm font-medium text-slate-700 transition hover:border-emerald-300 hover:bg-emerald-50 hover:text-emerald-700 disabled:opacity-60"
                          >
                            {restoringId === item.id ? (
                              <span className="h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-slate-600" />
                            ) : (
                              <ArchiveRestore className="h-4 w-4" />
                            )}
                            Restore
                          </button>
                        </div>
                      </motion.li>
                    ))}
                  </AnimatePresence>
                </ul>
              )}
            </div>
          </motion.aside>
        </motion.div>
      ) : null}
    </AnimatePresence>,
    document.body,
  );
}
