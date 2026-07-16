import { LoaderCircle, Save, X } from "lucide-react";

export default function NoteComposer({ content, setContent, editing, saving, error, onCancel, onSubmit }) {
  return (
    <form onSubmit={onSubmit} className="rounded-[1.6rem] border border-slate-200/80 bg-slate-50/80 p-4 sm:p-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">Internal case note</p>
          <h3 className="mt-0.5 text-base font-semibold text-slate-950">{editing ? "Edit note" : "Add note"}</h3>
        </div>
        <button type="button" onClick={onCancel} className="flex h-8 w-8 items-center justify-center rounded-full text-slate-400 transition hover:bg-slate-200 hover:text-slate-700" aria-label="Cancel note"><X className="h-4 w-4" /></button>
      </div>

      <textarea
        autoFocus
        required
        rows={5}
        value={content}
        onChange={(event) => setContent(event.target.value)}
        placeholder="Add an update, decision, client preference, or important case detail…"
        className="mt-4 w-full resize-y rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm leading-6 text-slate-900 shadow-sm outline-none transition placeholder:text-slate-300 focus:border-sky-300 focus:ring-4 focus:ring-sky-100"
      />

      {error ? <p className="mt-3 rounded-2xl bg-rose-50 px-4 py-3 text-sm font-medium text-rose-700">{error}</p> : null}

      <div className="mt-4 flex items-center justify-end gap-2">
        <button type="button" onClick={onCancel} disabled={saving} className="rounded-full px-4 py-2.5 text-sm font-semibold text-slate-600 transition hover:bg-slate-200/70 hover:text-slate-950">Cancel</button>
        <button type="submit" disabled={saving || !content.trim()} className="inline-flex items-center gap-2 rounded-full bg-slate-950 px-5 py-2.5 text-sm font-semibold text-white shadow-[0_10px_25px_rgba(15,23,42,0.18)] transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50">
          {saving ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          {editing ? "Save changes" : "Save note"}
        </button>
      </div>
    </form>
  );
}
