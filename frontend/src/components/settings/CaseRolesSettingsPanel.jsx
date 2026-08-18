import { AnimatePresence, motion } from "framer-motion";
import { Check, ChevronDown, Loader2, Plus, Trash2, UserSquare2 } from "lucide-react";
import { useEffect, useState } from "react";
import { createCaseRole, deleteCaseRole, getCaseRoles, updateCaseRole } from "../../api/caseRoleApi";

const card = "rounded-[1.4rem] border border-white/70 bg-white/80 p-5 shadow-[0_14px_40px_rgba(15,23,42,0.07)] backdrop-blur-xl";
const inputClass = "w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm shadow-sm outline-none transition focus:border-sky-400 focus:ring-2 focus:ring-sky-100";

function RoleRow({ role, onSaved, onDeleted }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(role.name);
  const [description, setDescription] = useState(role.description || "");
  const [isActive, setIsActive] = useState(role.isActive);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function save() {
    setSaving(true);
    setError("");
    try {
      const updated = await updateCaseRole(role.id, { name, description, isActive });
      onSaved(updated);
      setOpen(false);
    } catch (reason) {
      setError(reason.response?.data?.message || "Could not save this role.");
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!window.confirm(`Delete "${role.name}"? This won't affect cases that already used it.`)) return;
    try {
      await deleteCaseRole(role.id);
      onDeleted(role.id);
    } catch (reason) {
      setError(reason.response?.data?.message || "Could not delete this role — it may already be assigned on a case. Hide it instead.");
    }
  }

  return (
    <div className="rounded-2xl border border-slate-200/80 bg-white/70">
      <button type="button" onClick={() => setOpen((v) => !v)} className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 truncate text-sm font-semibold text-slate-900">
            {role.name}
            {!role.isActive ? <span className="shrink-0 rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-500">Hidden</span> : null}
            {role.isSystem ? <span className="shrink-0 rounded-full bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700">System</span> : null}
          </p>
          {role.description ? <p className="truncate text-xs text-slate-400">{role.description}</p> : null}
        </div>
        <motion.span animate={{ rotate: open ? 180 : 0 }}><ChevronDown className="h-4 w-4 text-slate-400" /></motion.span>
      </button>
      <AnimatePresence>
        {open ? (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
            <div className="space-y-3 border-t border-slate-100 p-4">
              <label className="block text-[11px] font-medium text-slate-500">Role name
                <input value={name} onChange={(event) => setName(event.target.value)} className={`mt-1.5 ${inputClass}`} />
              </label>
              <label className="block text-[11px] font-medium text-slate-500">Description
                <input value={description} onChange={(event) => setDescription(event.target.value)} placeholder="What this role means on a case" className={`mt-1.5 ${inputClass}`} />
              </label>
              <label className="flex items-center gap-2 text-xs font-medium text-slate-600">
                <input type="checkbox" checked={isActive} onChange={(event) => setIsActive(event.target.checked)} className="h-4 w-4 rounded border-slate-300" />
                Visible when assigning roles on a case
              </label>
              {error ? <p className="text-xs text-rose-600">{error}</p> : null}
              <div className="flex items-center gap-2">
                <button type="button" onClick={save} disabled={saving} className="flex h-9 items-center gap-1.5 rounded-full bg-slate-950 px-4 text-xs font-semibold text-white disabled:opacity-50">
                  {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />} Save
                </button>
                {!role.isSystem ? (
                  <button type="button" onClick={remove} className="flex h-9 items-center gap-1.5 rounded-full border border-rose-200 bg-rose-50 px-4 text-xs font-semibold text-rose-700">
                    <Trash2 className="h-3.5 w-3.5" /> Delete role
                  </button>
                ) : null}
              </div>
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

export default function CaseRolesSettingsPanel() {
  const [roles, setRoles] = useState(null);
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);
  const [newRole, setNewRole] = useState({ name: "", description: "" });
  const [createBusy, setCreateBusy] = useState(false);
  const [createError, setCreateError] = useState("");

  async function load() {
    try {
      setRoles(await getCaseRoles({ includeInactive: true }));
    } catch {
      setError("Case roles could not be loaded.");
    }
  }

  useEffect(() => { load(); }, []);

  async function submitCreate(event) {
    event.preventDefault();
    setCreateBusy(true);
    setCreateError("");
    try {
      const created = await createCaseRole(newRole);
      setRoles((current) => [...(current || []), created]);
      setCreating(false);
      setNewRole({ name: "", description: "" });
    } catch (reason) {
      setCreateError(reason.response?.data?.message || "Could not create this role.");
    } finally {
      setCreateBusy(false);
    }
  }

  return (
    <section className={card}>
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600"><UserSquare2 className="h-4 w-4" /></span>
          <div>
            <h3 className="text-sm font-semibold text-slate-900">Case roles</h3>
            <p className="text-xs text-slate-500">Who can be credited on a case — e.g. RCIC, Case Worker, Reviewer. Used by incentive plans and the case profile's role picker.</p>
          </div>
        </div>
        <button type="button" onClick={() => setCreating((v) => !v)} className="inline-flex items-center gap-1.5 rounded-full bg-slate-950 px-3.5 py-2 text-xs font-semibold text-white">
          <Plus className="h-3.5 w-3.5" /> New role
        </button>
      </div>

      {error ? <p className="mt-3 text-sm text-rose-600">{error}</p> : null}

      <AnimatePresence>
        {creating ? (
          <motion.form
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            onSubmit={submitCreate}
            className="mt-4 space-y-3 overflow-hidden rounded-2xl border border-slate-200/80 bg-slate-50/60 p-4"
          >
            <label className="block text-[11px] font-medium text-slate-500">Role name
              <input required value={newRole.name} onChange={(event) => setNewRole((c) => ({ ...c, name: event.target.value }))} placeholder="e.g. RCIC" className={`mt-1.5 ${inputClass}`} />
            </label>
            <label className="block text-[11px] font-medium text-slate-500">Description
              <input value={newRole.description} onChange={(event) => setNewRole((c) => ({ ...c, description: event.target.value }))} placeholder="What this role means on a case" className={`mt-1.5 ${inputClass}`} />
            </label>
            {createError ? <p className="text-xs text-rose-600">{createError}</p> : null}
            <button type="submit" disabled={createBusy} className="flex h-9 items-center gap-1.5 rounded-full bg-slate-950 px-4 text-xs font-semibold text-white disabled:opacity-50">
              {createBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />} Create role
            </button>
          </motion.form>
        ) : null}
      </AnimatePresence>

      <div className="mt-4 space-y-2.5">
        {roles === null ? (
          <div className="h-16 animate-pulse rounded-2xl bg-slate-100" />
        ) : roles.length === 0 ? (
          <p className="text-sm text-slate-400">No case roles yet — create one above (e.g. "RCIC", "Case Worker").</p>
        ) : (
          roles.map((role) => (
            <RoleRow
              key={role.id}
              role={role}
              onSaved={(updated) => setRoles((current) => current.map((item) => (item.id === updated.id ? updated : item)))}
              onDeleted={(id) => setRoles((current) => current.filter((item) => item.id !== id))}
            />
          ))
        )}
      </div>
    </section>
  );
}
