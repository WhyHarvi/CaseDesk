import { motion } from "framer-motion";
import { X } from "lucide-react";

const spring = { type: "spring", stiffness: 320, damping: 30 };

/** Generic right-anchored slide-over shell, shared across detail drawers (Payments, Incentives, ...). */
export default function InfoDrawer({ eyebrow, title, onClose, children }) {
  return (
    <div
      className="fixed inset-0 z-[420] flex justify-end bg-slate-950/25 backdrop-blur-[2px]"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <motion.aside
        initial={{ x: 70, opacity: 0 }}
        animate={{ x: 0, opacity: 1 }}
        exit={{ x: 70, opacity: 0 }}
        transition={spring}
        className="flex h-full w-full max-w-[470px] flex-col border-l border-white/70 bg-white/95 shadow-[-30px_0_90px_rgba(15,23,42,0.2)] backdrop-blur-2xl"
      >
        <header className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-violet-500">{eyebrow}</p>
            <h2 className="mt-1 text-lg font-semibold text-slate-950">{title}</h2>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="flex h-9 w-9 items-center justify-center rounded-full text-slate-500 transition hover:bg-slate-100">
            <X className="h-5 w-5" />
          </button>
        </header>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-6 py-5">{children}</div>
      </motion.aside>
    </div>
  );
}
