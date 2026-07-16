import { AnimatePresence, motion } from "framer-motion";
import { FolderCheck } from "lucide-react";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import api from "../../services/api";

const TERMINAL_CASE_STATUSES = new Set(["Completed", "Closed", "Cancelled", "Inactive"]);

function SuccessCheck() {
  return (
    <motion.svg
      viewBox="0 0 52 52"
      className="h-14 w-14"
      initial="hidden"
      animate="visible"
    >
      <motion.circle
        cx="26"
        cy="26"
        r="24"
        fill="none"
        stroke="#10b981"
        strokeWidth="3"
        variants={{ hidden: { pathLength: 0 }, visible: { pathLength: 1 } }}
        transition={{ duration: 0.45, ease: "easeOut" }}
      />
      <motion.path
        d="M15 27l7.5 7.5L37 20"
        fill="none"
        stroke="#10b981"
        strokeWidth="3.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        variants={{ hidden: { pathLength: 0 }, visible: { pathLength: 1 } }}
        transition={{ duration: 0.3, delay: 0.35, ease: "easeOut" }}
      />
    </motion.svg>
  );
}

export default function CaseCloseDialog({ open, caseItem, onClose, onClosed }) {
  const [phase, setPhase] = useState("confirm");
  const [error, setError] = useState("");
  const alreadyClosed = TERMINAL_CASE_STATUSES.has(caseItem?.status);

  useEffect(() => {
    if (open) {
      setPhase("confirm");
      setError("");
    }
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    function onKeyDown(event) {
      if (event.key === "Escape" && phase !== "working") onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, phase, onClose]);

  async function confirmClose() {
    setPhase("working");
    setError("");
    try {
      const response = await api.patch(`/cases/${caseItem.id}/close`);
      setPhase("done");
      window.setTimeout(() => {
        onClosed(response.data.data);
        onClose();
      }, 1100);
    } catch (requestError) {
      setPhase("confirm");
      setError(requestError.response?.data?.message || "Unable to close this case. Please try again.");
    }
  }

  if (typeof document === "undefined") return null;

  return createPortal(
    <AnimatePresence>
      {open ? (
        <motion.div
          key="case-close-dialog"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
          className="fixed inset-0 z-[9999] flex items-end justify-center bg-slate-950/35 px-4 pb-6 backdrop-blur-sm sm:items-center sm:pb-4"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && phase !== "working") onClose();
          }}
        >
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label="Close case"
            initial={{ opacity: 0, scale: 0.92, y: 18 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 12 }}
            transition={{ type: "spring", stiffness: 380, damping: 30 }}
            className="w-full max-w-[380px] rounded-[2rem] border border-white/70 bg-white/95 p-7 text-center shadow-[0_30px_90px_rgba(15,23,42,0.28)] backdrop-blur-2xl"
          >
            {phase === "done" ? (
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex flex-col items-center py-4">
                <SuccessCheck />
                <h3 className="mt-4 text-lg font-semibold text-slate-950">Case closed</h3>
                <p className="mt-1 text-sm text-slate-500">Everything stays on record.</p>
              </motion.div>
            ) : alreadyClosed ? (
              <>
                <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-slate-100">
                  <FolderCheck className="h-6 w-6 text-slate-500" />
                </div>
                <h3 className="mt-4 text-lg font-semibold text-slate-950">Already closed</h3>
                <p className="mt-2 text-sm leading-6 text-slate-500">
                  This case is {caseItem?.status?.toLowerCase() || "closed"}, so there is nothing left to close.
                </p>
                <button
                  type="button"
                  onClick={onClose}
                  className="mt-6 w-full rounded-2xl bg-slate-950 px-4 py-3 text-sm font-semibold text-white transition hover:bg-slate-800"
                >
                  OK
                </button>
              </>
            ) : (
              <>
                <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-amber-50">
                  <FolderCheck className="h-6 w-6 text-amber-600" />
                </div>
                <h3 className="mt-4 text-lg font-semibold text-slate-950">Close this case?</h3>
                <p className="mt-2 text-sm leading-6 text-slate-500">
                  Pending tasks, follow-ups, and appointments will be cancelled. Documents, payments, and history stay
                  on record.
                </p>
                {error ? (
                  <p className="mt-3 rounded-2xl bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>
                ) : null}
                <div className="mt-6 space-y-2">
                  <button
                    type="button"
                    disabled={phase === "working"}
                    onClick={confirmClose}
                    className="flex w-full items-center justify-center gap-2 rounded-2xl bg-slate-950 px-4 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:opacity-70"
                  >
                    {phase === "working" ? (
                      <>
                        <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
                        Closing…
                      </>
                    ) : (
                      "Close case"
                    )}
                  </button>
                  <button
                    type="button"
                    disabled={phase === "working"}
                    onClick={onClose}
                    className="w-full rounded-2xl px-4 py-3 text-sm font-semibold text-slate-600 transition hover:bg-slate-100 disabled:opacity-60"
                  >
                    Cancel
                  </button>
                </div>
              </>
            )}
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>,
    document.body,
  );
}
