import { Archive, LoaderCircle, X } from "lucide-react";
import { motion } from "framer-motion";
import { createPortal } from "react-dom";

export default function NoteDeleteOverlay({ note, busy = false, error = "", onClose, onConfirm }) {
  if (!note) return null;
  return createPortal(
    <div className="fixed inset-0 z-[760] flex items-center justify-center bg-slate-950/35 p-4 backdrop-blur-md" role="dialog" aria-modal="true" aria-labelledby="archive-note-title">
      <button type="button" className="absolute inset-0" onClick={() => !busy && onClose()} aria-label="Close" />
      <motion.section initial={{ opacity: 0, scale: 0.96, y: 10 }} animate={{ opacity: 1, scale: 1, y: 0 }} className="relative w-full max-w-md overflow-hidden rounded-[2rem] border border-white/80 bg-white p-6 shadow-[0_30px_100px_rgba(15,23,42,0.28)]">
        <div className="flex items-start justify-between gap-4">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-amber-100 text-amber-700"><Archive className="h-5 w-5" /></div>
          <button type="button" disabled={busy} onClick={onClose} className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-100 text-slate-500 disabled:opacity-40" aria-label="Close"><X className="h-4 w-4" /></button>
        </div>
        <h2 id="archive-note-title" className="mt-5 text-xl font-semibold tracking-tight text-slate-950">Archive this note?</h2>
        <p className="mt-2 text-sm leading-6 text-slate-500">It will disappear from active client and appointment histories, while CaseDesk retains it for audit purposes.</p>
        <blockquote className="mt-4 line-clamp-3 rounded-2xl bg-slate-50 px-4 py-3 text-sm leading-6 text-slate-600">{note.content}</blockquote>
        {error ? <p className="mt-4 rounded-2xl bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</p> : null}
        <div className="mt-6 grid grid-cols-2 gap-3">
          <button type="button" disabled={busy} onClick={onClose} className="h-11 rounded-full border border-slate-200 bg-white text-sm font-semibold text-slate-700 disabled:opacity-40">Keep note</button>
          <button type="button" disabled={busy} onClick={onConfirm} className="inline-flex h-11 items-center justify-center gap-2 rounded-full bg-amber-600 text-sm font-semibold text-white shadow-[0_10px_24px_rgba(217,119,6,0.22)] disabled:opacity-40">{busy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Archive className="h-4 w-4" />}Archive</button>
        </div>
      </motion.section>
    </div>,
    document.body,
  );
}
