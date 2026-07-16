import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

function SuccessCheck() {
  return (
    <motion.svg viewBox="0 0 52 52" className="h-14 w-14" initial="hidden" animate="visible">
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

/**
 * Apple-style confirm dialog for case lifecycle actions.
 *
 * - `action` runs on confirm and its resolved value is passed to `onSuccess`
 *   after the success animation finishes.
 * - `blocked` ({ title, message }) replaces the confirm UI with an informative
 *   state when the action no longer applies.
 */
export default function CaseActionDialog({
  open,
  onClose,
  onSuccess,
  action,
  icon: Icon,
  iconWrapClassName = "bg-slate-100 text-slate-600",
  title,
  message,
  confirmLabel,
  workingLabel,
  confirmClassName = "bg-slate-950 hover:bg-slate-800",
  successTitle,
  successMessage,
  blocked = null,
}) {
  const [phase, setPhase] = useState("confirm");
  const [error, setError] = useState("");

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

  async function confirm() {
    setPhase("working");
    setError("");
    try {
      const result = await action();
      setPhase("done");
      window.setTimeout(() => {
        onClose();
        onSuccess?.(result);
      }, 1100);
    } catch (requestError) {
      setPhase("confirm");
      setError(requestError.response?.data?.message || "Something went wrong. Please try again.");
    }
  }

  if (typeof document === "undefined") return null;

  return createPortal(
    <AnimatePresence>
      {open ? (
        <motion.div
          key="case-action-dialog"
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
            aria-label={title}
            initial={{ opacity: 0, scale: 0.92, y: 18 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 12 }}
            transition={{ type: "spring", stiffness: 380, damping: 30 }}
            className="w-full max-w-[380px] rounded-[2rem] border border-white/70 bg-white/95 p-7 text-center shadow-[0_30px_90px_rgba(15,23,42,0.28)] backdrop-blur-2xl"
          >
            {phase === "done" ? (
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex flex-col items-center py-4">
                <SuccessCheck />
                <h3 className="mt-4 text-lg font-semibold text-slate-950">{successTitle}</h3>
                {successMessage ? <p className="mt-1 text-sm text-slate-500">{successMessage}</p> : null}
              </motion.div>
            ) : blocked ? (
              <>
                <div className={`mx-auto flex h-14 w-14 items-center justify-center rounded-full ${iconWrapClassName}`}>
                  <Icon className="h-6 w-6" />
                </div>
                <h3 className="mt-4 text-lg font-semibold text-slate-950">{blocked.title}</h3>
                <p className="mt-2 text-sm leading-6 text-slate-500">{blocked.message}</p>
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
                <div className={`mx-auto flex h-14 w-14 items-center justify-center rounded-full ${iconWrapClassName}`}>
                  <Icon className="h-6 w-6" />
                </div>
                <h3 className="mt-4 text-lg font-semibold text-slate-950">{title}</h3>
                <p className="mt-2 text-sm leading-6 text-slate-500">{message}</p>
                {error ? <p className="mt-3 rounded-2xl bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p> : null}
                <div className="mt-6 space-y-2">
                  <button
                    type="button"
                    disabled={phase === "working"}
                    onClick={confirm}
                    className={`flex w-full items-center justify-center gap-2 rounded-2xl px-4 py-3 text-sm font-semibold text-white transition disabled:opacity-70 ${confirmClassName}`}
                  >
                    {phase === "working" ? (
                      <>
                        <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
                        {workingLabel}
                      </>
                    ) : (
                      confirmLabel
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
