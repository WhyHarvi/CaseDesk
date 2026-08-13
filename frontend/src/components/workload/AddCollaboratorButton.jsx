import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Loader2, Plus, UserPlus } from "lucide-react";
import api from "../../services/api";

function cx(...classes) { return classes.filter(Boolean).join(" "); }

// Quick add-collaborator popover on a case row — reuses the existing
// GET/PUT /cases/:id/permissions contract (read current owner +
// collaborators, append one, save) instead of a new backend endpoint. That
// endpoint does full-replace, so this always re-reads the live list right
// before writing rather than trusting anything cached on the row.
export default function AddCollaboratorButton({ caseId, onChanged }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(null);
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    function handleClick(event) {
      if (ref.current && !ref.current.contains(event.target)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  async function toggle(event) {
    event.preventDefault();
    event.stopPropagation();
    if (open) { setOpen(false); return; }
    setOpen(true);
    setLoading(true);
    setError("");
    try {
      const response = await api.get(`/cases/${caseId}/permissions`);
      setData(response.data.data);
    } catch (requestError) {
      setError(requestError.response?.data?.message || "Couldn't load this case's team.");
    } finally {
      setLoading(false);
    }
  }

  async function addCollaborator(consultantId) {
    if (!data) return;
    setSaving(consultantId);
    setError("");
    try {
      const collaboratorUserIds = [...data.collaborators.map((item) => item.id), consultantId];
      await api.put(`/cases/${data.caseId}/permissions`, { ownerUserId: data.owner.id, collaboratorUserIds });
      setOpen(false);
      onChanged?.();
    } catch (requestError) {
      setError(requestError.response?.data?.message || "Couldn't add that collaborator.");
    } finally {
      setSaving(null);
    }
  }

  const currentAccessIds = data ? new Set([data.owner?.id, ...data.collaborators.map((item) => item.id)].filter(Boolean)) : new Set();
  const eligible = data ? data.consultants.filter((item) => !currentAccessIds.has(item.id)) : [];

  return (
    <span ref={ref} className="relative inline-flex" onClick={(event) => event.stopPropagation()}>
      <button
        type="button"
        onClick={toggle}
        title="Add collaborator"
        className="flex h-[18px] w-[18px] items-center justify-center rounded-full bg-slate-100 text-slate-500 ring-2 ring-white transition hover:bg-sky-100 hover:text-sky-700"
      >
        <Plus className="h-2.5 w-2.5" />
      </button>
      <AnimatePresence>
        {open ? (
          <motion.div
            initial={{ opacity: 0, y: -6, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.97 }}
            transition={{ duration: 0.14 }}
            className="absolute left-0 top-6 z-30 w-64 rounded-2xl border border-slate-200 bg-white p-2.5 shadow-[0_18px_50px_rgba(15,23,42,0.18)]"
          >
            <p className="px-1.5 pb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Add a collaborator</p>
            {loading ? (
              <div className="flex items-center justify-center py-4 text-xs text-slate-400"><Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> Loading…</div>
            ) : error ? (
              <p className="px-1.5 py-2 text-xs text-rose-600">{error}</p>
            ) : !eligible.length ? (
              <p className="px-1.5 py-2 text-xs text-slate-500">Every active consultant already has access.</p>
            ) : (
              <div className="max-h-48 space-y-0.5 overflow-y-auto">
                {eligible.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    disabled={saving === item.id}
                    onClick={() => addCollaborator(item.id)}
                    className="flex w-full items-center justify-between gap-2 rounded-xl px-2 py-1.5 text-left text-xs font-medium text-slate-700 transition hover:bg-sky-50 disabled:opacity-50"
                  >
                    <span className="truncate">{item.fullName}</span>
                    {saving === item.id ? <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" /> : <UserPlus className="h-3.5 w-3.5 shrink-0 text-slate-400" />}
                  </button>
                ))}
              </div>
            )}
          </motion.div>
        ) : null}
      </AnimatePresence>
    </span>
  );
}
