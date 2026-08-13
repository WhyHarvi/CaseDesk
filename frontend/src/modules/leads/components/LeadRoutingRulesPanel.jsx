import { ArrowDown, ArrowUp, ArrowRight, MoveRight, Pencil, Plus, Route, Trash2, X } from "lucide-react";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import api from "../../../services/api";
import Select from "../../../components/ui/Select";
import { humanize, LEAD_PRIORITIES } from "../leadPresentation";

const SOURCE_TYPES = ["PHONE", "OOMA", "WHATSAPP", "FACEBOOK", "INSTAGRAM", "SOCIAL_FORM", "SOCIAL_MESSAGE", "WEBSITE", "GOOGLE_ADS", "EMAIL", "WALK_IN", "REFERRAL", "EVENT", "EMPLOYEE_PHONE", "CSV_IMPORT", "OTHER"];

const FIELD_OPTIONS = [
  { value: "initialMessage", label: "Inquiry message contains", noun: "Message", match: "substring", placeholder: "e.g. study, study permit, student visa", tone: "bg-sky-50 text-sky-700 ring-sky-200" },
  { value: "immigrationInterest", label: "Stated interest contains", noun: "Interest", match: "substring", placeholder: "e.g. express entry, PR", tone: "bg-sky-50 text-sky-700 ring-sky-200" },
  { value: "province", label: "Province is", noun: "Province", match: "text", placeholder: "e.g. Ontario", tone: "bg-violet-50 text-violet-700 ring-violet-200" },
  { value: "preferredLanguage", label: "Preferred language is", noun: "Language", match: "text", placeholder: "e.g. French", tone: "bg-violet-50 text-violet-700 ring-violet-200" },
  { value: "priority", label: "Priority is", noun: "Priority", match: "select", options: LEAD_PRIORITIES, tone: "bg-amber-50 text-amber-700 ring-amber-200" },
  { value: "originalSourceType", label: "Source type is", noun: "Source", match: "select", options: SOURCE_TYPES, tone: "bg-indigo-50 text-indigo-700 ring-indigo-200" },
];
const fieldMeta = (field) => FIELD_OPTIONS.find((item) => item.value === field) || FIELD_OPTIONS[0];
const emptyCondition = () => ({ field: "initialMessage", value: "" });
const inputClass = "mt-2 w-full rounded-2xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-900 outline-none transition focus:border-brand-300 focus:ring-4 focus:ring-brand-100";

function initialsOf(name) {
  return (name || "?").split(" ").map((part) => part[0]).filter(Boolean).slice(0, 2).join("").toUpperCase();
}

function ConditionChip({ condition }) {
  const meta = fieldMeta(condition.field);
  const values = meta.match === "substring" ? condition.value.split(",").map((part) => part.trim()).filter(Boolean) : [meta.match === "select" ? humanize(condition.value) : condition.value];
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium ring-1 ring-inset ${meta.tone}`}>
      <span className="font-semibold uppercase tracking-wide opacity-70">{meta.noun}</span>
      <span className="text-slate-400">{meta.match === "substring" ? "⊃" : "="}</span>
      {values.map((value, index) => (
        <span key={value}>
          {index > 0 ? <span className="mx-0.5 opacity-50">or</span> : null}
          &ldquo;{value}&rdquo;
        </span>
      ))}
    </span>
  );
}

function RuleEditor({ title, form, staff, saving, error, onFormChange, onUpdateCondition, onAddCondition, onRemoveCondition, onSubmit, onClose }) {
  // Portaled to document.body: this panel renders inside Settings.jsx's
  // Framer Motion wrapper, which keeps a `filter` style active on its
  // container during enter/exit — a non-"none" `filter` on an ancestor
  // creates a new containing block for `position: fixed` descendants, which
  // traps this modal inside the Settings content box (clipped against its
  // own header) instead of covering the real viewport. Portaling escapes
  // that ancestor entirely, matching CaseWorkflowSettingsPanel.jsx.
  return createPortal(
    <div className="fixed inset-0 z-[180] flex items-center justify-center bg-slate-950/25 p-4 backdrop-blur-md" role="dialog" aria-modal="true" aria-labelledby="routing-rule-title">
      <button type="button" className="absolute inset-0" onClick={onClose} aria-label="Close rule editor" />
      <form onSubmit={onSubmit} className="relative flex max-h-[85vh] w-full max-w-xl flex-col overflow-hidden rounded-3xl border border-white/80 bg-[#f7f9fc] shadow-[0_30px_100px_rgba(15,23,42,0.3)]">
        <header className="flex items-start justify-between border-b border-slate-200/70 bg-white/90 px-6 py-5">
          <div>
            <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-brand-600 text-white"><Route className="h-5 w-5" /></div>
            <h2 id="routing-rule-title" className="text-xl font-semibold tracking-tight text-slate-950">{title}</h2>
            <p className="mt-1 text-sm text-slate-500">All conditions must match for the rule to fire. Checked top to bottom — the first active rule that matches wins.</p>
          </div>
          <button type="button" onClick={onClose} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-500 hover:bg-slate-200"><X className="h-4 w-4" /></button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto p-6">
          {error ? <div className="mb-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div> : null}

          <label className="block text-sm font-medium text-slate-700">Rule name
            <input value={form.name} onChange={(event) => onFormChange({ name: event.target.value })} className={inputClass} placeholder="Study permit → Manpreet" required />
          </label>

          <div className="mt-5">
            <p className="text-sm font-medium text-slate-700">When a new lead matches…</p>
            <div className="mt-2 space-y-2">
              {form.conditions.map((condition, index) => {
                const meta = fieldMeta(condition.field);
                return (
                  <div key={index}>
                    {index > 0 ? <p className="mb-2 pl-1 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">and</p> : null}
                    <div className="flex items-center gap-2 rounded-2xl border border-slate-200 bg-white p-2">
                      <Select value={condition.field} onChange={(event) => onUpdateCondition(index, { field: event.target.value, value: "" })} className="h-10 shrink-0" selectClassName={`text-xs font-semibold ${meta.tone}`} ariaLabel="Condition field">
                        {FIELD_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                      </Select>
                      {meta.match === "select" ? (
                        <Select value={condition.value} onChange={(event) => onUpdateCondition(index, { value: event.target.value })} className="h-10 min-w-0 flex-1" ariaLabel="Condition value">
                          <option value="">Select…</option>
                          {meta.options.map((option) => <option key={option} value={option}>{humanize(option)}</option>)}
                        </Select>
                      ) : (
                        <input value={condition.value} onChange={(event) => onUpdateCondition(index, { value: event.target.value })} placeholder={meta.placeholder} className="h-10 min-w-0 flex-1 rounded-xl border border-slate-200 px-3 text-sm outline-none focus:border-brand-300" />
                      )}
                      <button type="button" onClick={() => onRemoveCondition(index)} disabled={form.conditions.length <= 1} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-slate-400 transition hover:bg-rose-50 hover:text-rose-600 disabled:cursor-not-allowed disabled:opacity-30" aria-label="Remove condition"><Trash2 className="h-4 w-4" /></button>
                    </div>
                    {meta.match === "substring" ? <p className="mt-1.5 pl-1 text-[11px] text-slate-400">Separate alternatives with commas — matches if any one of them appears.</p> : null}
                  </div>
                );
              })}
            </div>
            <button type="button" onClick={onAddCondition} className="mt-3 inline-flex items-center gap-1.5 rounded-full border border-dashed border-slate-300 px-3.5 py-1.5 text-xs font-semibold text-slate-500 transition hover:border-brand-300 hover:text-brand-700"><Plus className="h-3.5 w-3.5" />Add condition</button>
          </div>

          <div className="mt-5 flex items-center gap-3 rounded-2xl border border-slate-200 bg-white p-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-400"><MoveRight className="h-4 w-4" /></div>
            <label className="min-w-0 flex-1 text-sm font-medium text-slate-700">Route matching leads to
              <Select value={form.targetUserId} onChange={(event) => onFormChange({ targetUserId: event.target.value })} className="mt-1.5 w-full" required>
                <option value="">Select a team member</option>
                {staff.map((person) => <option key={person.id} value={person.id}>{person.fullName} · {humanize(person.role)}</option>)}
              </Select>
            </label>
          </div>

          <label className="mt-5 flex items-center gap-2.5 text-sm font-medium text-slate-700">
            <input type="checkbox" checked={form.isActive} onChange={(event) => onFormChange({ isActive: event.target.checked })} className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-200" />
            Active
          </label>
        </div>

        <footer className="flex justify-end gap-3 border-t border-slate-200 bg-white px-6 py-4">
          <button type="button" onClick={onClose} className="h-10 rounded-full px-5 text-sm font-semibold text-slate-600 hover:bg-slate-100">Cancel</button>
          <button disabled={saving} className="h-10 rounded-full bg-brand-600 px-5 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-700 disabled:opacity-50">{saving ? "Saving…" : "Save rule"}</button>
        </footer>
      </form>
    </div>,
    document.body
  );
}

function RuleCard({ rule, position, isFirst, isLast, busy, onMove, onToggleActive, onEdit, onRemove }) {
  return (
    <div className={`flex gap-3 rounded-3xl border bg-white p-4 shadow-[0_14px_40px_rgba(28,45,74,0.04)] transition ${rule.isActive ? "border-slate-200" : "border-slate-100 opacity-70"}`}>
      <div className="flex shrink-0 flex-col items-center gap-1 pt-0.5">
        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-slate-900 text-xs font-bold text-white">{position}</span>
        <button type="button" onClick={() => onMove(-1)} disabled={busy || isFirst} className="flex h-6 w-6 items-center justify-center rounded-full text-slate-300 transition hover:bg-slate-100 hover:text-slate-600 disabled:cursor-not-allowed disabled:opacity-0" aria-label="Move rule up"><ArrowUp className="h-3.5 w-3.5" /></button>
        <button type="button" onClick={() => onMove(1)} disabled={busy || isLast} className="flex h-6 w-6 items-center justify-center rounded-full text-slate-300 transition hover:bg-slate-100 hover:text-slate-600 disabled:cursor-not-allowed disabled:opacity-0" aria-label="Move rule down"><ArrowDown className="h-3.5 w-3.5" /></button>
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-semibold text-slate-950">{rule.name}</h3>
            <button type="button" disabled={busy} onClick={onToggleActive} className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[10px] font-semibold transition disabled:opacity-50 ${rule.isActive ? "bg-emerald-50 text-emerald-700 hover:bg-emerald-100" : "bg-slate-100 text-slate-500 hover:bg-slate-200"}`}>{rule.isActive ? "Active" : "Paused"}</button>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <button type="button" onClick={onEdit} className="flex h-8 w-8 items-center justify-center rounded-full text-slate-400 transition hover:bg-slate-100 hover:text-slate-700" aria-label="Edit rule"><Pencil className="h-3.5 w-3.5" /></button>
            <button type="button" disabled={busy} onClick={onRemove} className="flex h-8 w-8 items-center justify-center rounded-full text-slate-400 transition hover:bg-rose-50 hover:text-rose-600 disabled:opacity-50" aria-label="Delete rule"><Trash2 className="h-3.5 w-3.5" /></button>
          </div>
        </div>

        <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
          {rule.conditions.map((condition, index) => <ConditionChip key={index} condition={condition} />)}
        </div>

        <div className="mt-3 flex items-center gap-2.5 border-t border-slate-100 pt-3">
          <ArrowRight className="h-3.5 w-3.5 shrink-0 text-slate-300" />
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-900 text-[9px] font-bold text-white">{initialsOf(rule.targetUser?.fullName)}</span>
          <span className="text-sm font-medium text-slate-800">{rule.targetUser?.fullName}</span>
          <span className="ml-auto shrink-0 text-[11px] text-slate-400">{rule.matchCount} match{rule.matchCount === 1 ? "" : "es"}{rule.lastMatchedAt ? ` · last ${new Date(rule.lastMatchedAt).toLocaleDateString("en-CA", { month: "short", day: "numeric" })}` : ""}</span>
        </div>
      </div>
    </div>
  );
}

export default function LeadRoutingRulesPanel({ staff }) {
  const [rules, setRules] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);
  const [editorError, setEditorError] = useState("");
  const [busyId, setBusyId] = useState("");

  async function load() {
    setLoading(true);
    setError("");
    try {
      const { data } = await api.get("/leads/routing-rules");
      setRules(data.data);
    } catch (requestError) {
      setError(requestError.response?.data?.message || "Routing rules could not be loaded.");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, []);

  function openCreate() {
    setForm({ name: "", targetUserId: "", isActive: true, conditions: [emptyCondition()] });
    setEditorError("");
    setEditing("create");
  }

  function openEdit(rule) {
    setForm({ name: rule.name, targetUserId: rule.targetUserId, isActive: rule.isActive, conditions: rule.conditions.length ? rule.conditions.map((item) => ({ ...item })) : [emptyCondition()] });
    setEditorError("");
    setEditing(rule);
  }

  async function submit(event) {
    event.preventDefault();
    setSaving(true);
    setEditorError("");
    const payload = { name: form.name, targetUserId: form.targetUserId, isActive: form.isActive, conditions: form.conditions.filter((item) => item.value) };
    try {
      if (editing === "create") {
        await api.post("/leads/routing-rules", payload);
        setNotice("Routing rule created.");
      } else {
        await api.patch(`/leads/routing-rules/${editing.id}`, payload);
        setNotice("Routing rule updated.");
      }
      setEditing(null);
      await load();
    } catch (requestError) {
      setEditorError(requestError.response?.data?.message || "The routing rule could not be saved.");
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(rule) {
    setBusyId(rule.id);
    try {
      await api.patch(`/leads/routing-rules/${rule.id}`, { isActive: !rule.isActive });
      await load();
    } catch (requestError) {
      setError(requestError.response?.data?.message || "The rule could not be updated.");
    } finally {
      setBusyId("");
    }
  }

  async function move(rule, direction) {
    const ordered = [...rules].sort((a, b) => a.sortOrder - b.sortOrder);
    const index = ordered.findIndex((item) => item.id === rule.id);
    const targetIndex = index + direction;
    if (targetIndex < 0 || targetIndex >= ordered.length) return;
    const other = ordered[targetIndex];
    setBusyId(rule.id);
    try {
      await Promise.all([
        api.patch(`/leads/routing-rules/${rule.id}`, { sortOrder: other.sortOrder }),
        api.patch(`/leads/routing-rules/${other.id}`, { sortOrder: rule.sortOrder }),
      ]);
      await load();
    } catch (requestError) {
      setError(requestError.response?.data?.message || "The rule order could not be updated.");
    } finally {
      setBusyId("");
    }
  }

  async function remove(rule) {
    if (!window.confirm(`Delete the "${rule.name}" routing rule? This can't be undone.`)) return;
    setBusyId(rule.id);
    try {
      await api.delete(`/leads/routing-rules/${rule.id}`);
      setNotice("Routing rule deleted.");
      await load();
    } catch (requestError) {
      setError(requestError.response?.data?.message || "The rule could not be deleted.");
    } finally {
      setBusyId("");
    }
  }

  const ordered = [...rules].sort((a, b) => a.sortOrder - b.sortOrder);

  return (
    <div className="space-y-4">
      <section className="flex flex-col gap-4 rounded-3xl border border-slate-200 bg-gradient-to-br from-white to-slate-50/60 p-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-brand-50 text-brand-700"><Route className="h-5 w-5" /></div>
          <div>
            <h2 className="font-semibold text-slate-950">Auto-assignment rules</h2>
            <p className="mt-1 max-w-2xl text-sm text-slate-500">Route a new lead to a specific team member based on its inquiry — checked top to bottom, first match wins. Rules only apply to leads created <span className="font-medium text-slate-700">from now on</span>, so a fresh rule always starts at 0 matches until a new lead comes in.</p>
          </div>
        </div>
        <button type="button" disabled={!staff.length} onClick={openCreate} className="inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-full bg-slate-900 px-4 text-sm font-semibold text-white shadow-sm transition hover:-translate-y-0.5 hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-300"><Plus className="h-4 w-4" />New rule</button>
      </section>

      {notice ? <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-700">{notice}</div> : null}
      {error ? <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-700">{error}</div> : null}

      {loading ? (
        <div className="space-y-2">{[0, 1].map((key) => <div key={key} className="h-24 animate-pulse rounded-3xl bg-slate-100" />)}</div>
      ) : !ordered.length ? (
        <div className="flex flex-col items-center gap-3 rounded-3xl border border-dashed border-slate-200 bg-slate-50 px-6 py-10 text-center">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-white text-slate-400 shadow-sm"><Route className="h-5 w-5" /></div>
          <div>
            <p className="text-sm font-semibold text-slate-700">No auto-assignment rules yet</p>
            <p className="mt-1 max-w-sm text-sm text-slate-500">New leads keep landing on the intake stream's default owner until you add one.</p>
          </div>
        </div>
      ) : (
        <div className="space-y-2.5">
          {ordered.map((rule, index) => (
            <RuleCard
              key={rule.id}
              rule={rule}
              position={index + 1}
              isFirst={index === 0}
              isLast={index === ordered.length - 1}
              busy={busyId === rule.id}
              onMove={(direction) => move(rule, direction)}
              onToggleActive={() => toggleActive(rule)}
              onEdit={() => openEdit(rule)}
              onRemove={() => remove(rule)}
            />
          ))}
        </div>
      )}

      {editing ? (
        <RuleEditor
          title={editing === "create" ? "New auto-assignment rule" : `Edit ${editing.name}`}
          form={form}
          staff={staff}
          saving={saving}
          error={editorError}
          onFormChange={(patch) => setForm((current) => ({ ...current, ...patch }))}
          onUpdateCondition={(index, patch) => setForm((current) => ({ ...current, conditions: current.conditions.map((item, i) => (i === index ? { ...item, ...patch } : item)) }))}
          onAddCondition={() => setForm((current) => ({ ...current, conditions: [...current.conditions, emptyCondition()] }))}
          onRemoveCondition={(index) => setForm((current) => ({ ...current, conditions: current.conditions.length <= 1 ? current.conditions : current.conditions.filter((_, i) => i !== index) }))}
          onSubmit={submit}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </div>
  );
}
