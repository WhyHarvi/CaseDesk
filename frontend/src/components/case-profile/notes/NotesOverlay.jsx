import { LoaderCircle, MessageSquareText, Plus, StickyNote, X } from "lucide-react";
import { motion } from "framer-motion";
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import api from "../../../services/api";
import NoteCard from "./NoteCard";
import NoteComposer from "./NoteComposer";
import { useAuth } from "../../../auth/AuthContext";
import NoteDeleteOverlay from "./NoteDeleteOverlay";

export default function NotesOverlay({ caseItem, initialNotes = [], highlightNoteId = "", onNotesChange, onClose }) {
  const { role, appUser } = useAuth();
  const [notes, setNotes] = useState(initialNotes);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [composerOpen, setComposerOpen] = useState(false);
  const [editingNote, setEditingNote] = useState(null);
  const [content, setContent] = useState("");
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");
  const [deletingId, setDeletingId] = useState("");
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleteError, setDeleteError] = useState("");

  const sortedNotes = useMemo(
    () => [...notes].sort((left, right) => new Date(right.createdAt) - new Date(left.createdAt)),
    [notes],
  );

  function updateNotes(nextNotes) {
    setNotes(nextNotes);
    onNotesChange?.(nextNotes);
  }

  useEffect(() => {
    let active = true;
    async function loadNotes() {
      try {
        setLoading(true);
        const response = await api.get(`/notes?caseId=${encodeURIComponent(caseItem.id)}&limit=100`);
        if (!active) return;
        let nextNotes = response.data.data || [];
        if (
          highlightNoteId &&
          !nextNotes.some((note) => note.id === highlightNoteId)
        ) {
          const highlighted = await api
            .get(`/notes/${encodeURIComponent(highlightNoteId)}`)
            .then((result) => result.data.data)
            .catch(() => null);
          if (
            highlighted?.id &&
            highlighted.caseId === caseItem.id &&
            !nextNotes.some((note) => note.id === highlighted.id)
          ) {
            nextNotes = [highlighted, ...nextNotes];
          }
        }
        if (!active) return;
        updateNotes(nextNotes);
        setLoadError("");
      } catch (error) {
        if (active) setLoadError(error.response?.data?.message || "Notes could not load.");
      } finally {
        if (active) setLoading(false);
      }
    }
    loadNotes();
    return () => { active = false; };
  }, [caseItem.id, highlightNoteId]);

  useEffect(() => {
    if (loading || !highlightNoteId) return;
    const frame = window.requestAnimationFrame(() => {
      document
        .getElementById(`case-note-${highlightNoteId}`)
        ?.scrollIntoView({ block: "center", behavior: "smooth" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [highlightNoteId, loading, notes]);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    function handleKeyDown(event) {
      if (event.key !== "Escape") return;
      if (composerOpen) closeComposer();
      else onClose();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [composerOpen, onClose]);

  function openCreate() {
    setEditingNote(null);
    setContent("");
    setFormError("");
    setComposerOpen(true);
  }

  function openEdit(note) {
    setEditingNote(note);
    setContent(note.content || "");
    setFormError("");
    setComposerOpen(true);
  }

  function closeComposer() {
    setComposerOpen(false);
    setEditingNote(null);
    setContent("");
    setFormError("");
  }

  async function submitNote(event) {
    event.preventDefault();
    const trimmedContent = content.trim();
    if (!trimmedContent) return;

    try {
      setSaving(true);
      setFormError("");
      if (editingNote) {
        const response = await api.patch(`/notes/${editingNote.id}`, { content: trimmedContent });
        updateNotes(notes.map((note) => note.id === editingNote.id ? response.data.data : note));
      } else {
        const response = await api.post("/notes", {
          caseId: caseItem.id,
          clientId: caseItem.client?.id,
          content: trimmedContent,
        });
        updateNotes([response.data.data, ...notes]);
      }
      closeComposer();
    } catch (error) {
      setFormError(error.response?.data?.message || "Note could not be saved.");
    } finally {
      setSaving(false);
    }
  }

  async function deleteNote(note) {
    try {
      setDeletingId(note.id);
      setDeleteError("");
      await api.delete(`/notes/${note.id}`);
      updateNotes(notes.filter((item) => item.id !== note.id));
      setDeleteTarget(null);
      if (editingNote?.id === note.id) closeComposer();
    } catch (error) {
      setDeleteError(error.response?.data?.message || "Note could not be archived.");
    } finally {
      setDeletingId("");
    }
  }

  return createPortal(
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[180] flex justify-end bg-slate-950/25 backdrop-blur-sm" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <motion.section initial={{ x: 70, opacity: 0.85 }} animate={{ x: 0, opacity: 1 }} exit={{ x: 70, opacity: 0 }} transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }} className="flex h-full w-full max-w-2xl flex-col border-l border-white/80 bg-[linear-gradient(180deg,rgba(248,250,252,0.98),rgba(241,245,249,0.98))] shadow-[-24px_0_80px_rgba(15,23,42,0.16)]">
        <header className="flex shrink-0 items-center justify-between gap-4 border-b border-slate-200/70 bg-white/80 px-5 py-4 backdrop-blur-xl sm:px-7">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-slate-950 text-white shadow-[0_10px_25px_rgba(15,23,42,0.18)]"><StickyNote className="h-5 w-5" /></div>
            <div className="min-w-0"><p className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400">{caseItem.caseType || "Case profile"}</p><h2 className="truncate text-xl font-semibold tracking-tight text-slate-950">Notes</h2></div>
          </div>
          <div className="flex items-center gap-2">
            <button type="button" onClick={openCreate} className="inline-flex items-center gap-2 rounded-full bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white shadow-[0_10px_25px_rgba(15,23,42,0.18)] transition hover:bg-slate-800"><Plus className="h-4 w-4" /> Add note</button>
            <button type="button" onClick={onClose} className="flex h-10 w-10 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 transition hover:border-slate-300 hover:text-slate-950" aria-label="Close notes"><X className="h-4 w-4" /></button>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto px-5 py-6 sm:px-7">
          <div className="mx-auto max-w-xl space-y-4">
            {composerOpen ? <NoteComposer content={content} setContent={setContent} editing={Boolean(editingNote)} saving={saving} error={formError} onCancel={closeComposer} onSubmit={submitNote} /> : null}

            {loadError ? <p className="rounded-2xl bg-rose-50 px-4 py-3 text-sm font-medium text-rose-700">{loadError}</p> : null}
            {loading && !notes.length ? (
              <div className="flex min-h-56 items-center justify-center"><LoaderCircle className="h-6 w-6 animate-spin text-slate-400" /></div>
            ) : sortedNotes.length ? (
              <div className="space-y-3">{sortedNotes.map((note) => <div id={`case-note-${note.id}`} key={note.id} className={note.id === highlightNoteId ? "rounded-[1.4rem] ring-4 ring-sky-200/80" : ""}><NoteCard note={note} canManage={role === "admin" || note.user?.id === appUser?.id} deleting={deletingId === note.id} onEdit={openEdit} onDelete={(item) => { setDeleteError(""); setDeleteTarget(item); }} /></div>)}</div>
            ) : !loadError ? (
              <div className="rounded-[1.75rem] border border-dashed border-slate-200 bg-white/55 px-6 py-12 text-center"><div className="mx-auto flex h-11 w-11 items-center justify-center rounded-2xl bg-white text-slate-400 shadow-sm"><MessageSquareText className="h-5 w-5" /></div><h3 className="mt-4 text-sm font-semibold text-slate-900">No case notes yet</h3><p className="mt-1 text-sm text-slate-400">Add a private note for the consulting team.</p><button type="button" onClick={openCreate} className="mt-5 rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:border-slate-300 hover:text-slate-950">Add first note</button></div>
            ) : null}
          </div>
        </div>
      </motion.section>
      <NoteDeleteOverlay note={deleteTarget} busy={Boolean(deletingId)} error={deleteError} onClose={() => !deletingId && setDeleteTarget(null)} onConfirm={() => deleteNote(deleteTarget)} />
    </motion.div>,
    document.body,
  );
}
