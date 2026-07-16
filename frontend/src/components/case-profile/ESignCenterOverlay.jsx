import { FileSignature, X } from "lucide-react";
import { motion } from "framer-motion";
import { useEffect } from "react";
import { createPortal } from "react-dom";
import AgreementsLettersWorkspace from "./AgreementsLettersWorkspace";

export default function ESignCenterOverlay({ caseItem, onClose }) {
  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKeyDown = (event) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [onClose]);

  if (typeof document === "undefined") return null;

  return createPortal(
    <div className="fixed inset-0 z-[350] flex flex-col bg-slate-100/95 backdrop-blur-xl">
      <header className="shrink-0 border-b border-white/80 bg-white/92 px-4 py-3 shadow-sm sm:px-6 sm:py-4">
        <div className="mx-auto flex w-full max-w-7xl items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-indigo-50 text-indigo-600">
              <FileSignature className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-indigo-600">Case e-signatures</p>
              <h2 className="truncate text-lg font-semibold text-slate-950">{caseItem.client?.fullName || "Client"} · {caseItem.caseType}</h2>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-500 transition hover:bg-slate-200 hover:text-slate-950"
            aria-label="Close E-Sign Centre"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
      </header>

      <motion.main
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        className="min-h-0 flex-1 overflow-y-auto px-3 py-4 sm:px-6 sm:py-6"
      >
        <div className="mx-auto w-full max-w-7xl">
          {caseItem.deletedAt || caseItem.archivedAt ? (
            <p className="mb-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-800">
              Restore this case before sending or changing signature requests. Existing signed records remain available for review.
            </p>
          ) : null}
          <AgreementsLettersWorkspace caseItem={caseItem} eSignMode />
        </div>
      </motion.main>
    </div>,
    document.body,
  );
}
