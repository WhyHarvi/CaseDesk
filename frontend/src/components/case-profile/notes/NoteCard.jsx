import { LoaderCircle, Pencil, Trash2 } from "lucide-react";
import { formatDateTime, getInitials } from "../caseProfileUtils";

export default function NoteCard({ note, canManage, deleting, onEdit, onDelete }) {
  const author = note.user?.fullName || "CaseDesk team";

  return (
    <article className="rounded-[1.5rem] border border-white/90 bg-white/85 p-4 shadow-[0_12px_40px_rgba(15,23,42,0.06)] backdrop-blur-xl sm:p-5">
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[linear-gradient(145deg,#334155,#94a3b8)] text-[11px] font-bold text-white">{getInitials(author)}</div>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-slate-900">{author}</p>
            <p className="mt-0.5 text-xs text-slate-400">{formatDateTime(note.updatedAt || note.createdAt)}{note.updatedAt && note.createdAt && note.updatedAt !== note.createdAt ? " · Edited" : ""}</p>
          </div>
        </div>

        {canManage ? <div className="flex shrink-0 gap-1">
          <button type="button" onClick={() => onEdit(note)} className="flex h-8 w-8 items-center justify-center rounded-full text-slate-400 transition hover:bg-slate-100 hover:text-slate-800" aria-label="Edit note"><Pencil className="h-3.5 w-3.5" /></button>
          <button type="button" onClick={() => onDelete(note)} disabled={deleting} className="flex h-8 w-8 items-center justify-center rounded-full text-slate-400 transition hover:bg-rose-50 hover:text-rose-600 disabled:opacity-50" aria-label="Delete note">{deleting ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}</button>
        </div> : null}
      </div>

      <p className="mt-4 whitespace-pre-wrap break-words text-sm leading-6 text-slate-600">{note.content}</p>
    </article>
  );
}
