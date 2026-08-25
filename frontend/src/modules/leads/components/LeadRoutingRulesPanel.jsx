import { ArrowDown, ArrowUp, ArrowRight, Check, History, MoveRight, Pencil, Plus, Route, SkipForward, Trash2, X } from "lucide-react";
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
            <p className="mt-1 text-sm text-slate-500">Choose whether any condition or every condition must match. The first active matching rule wins.</p>
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
            <div className="mt-2 grid grid-cols-2 gap-2 rounded-2xl border border-slate-200 bg-white p-1.5" role="radiogroup" aria-label="Condition matching mode">
              {[{ value: "ANY", label: "Any condition", detail: "One match is enough" }, { value: "ALL", label: "All conditions", detail: "Every row must match" }].map((option) => <button key={option.value} type="button" role="radio" aria-checked={form.matchMode === option.value} onClick={() => onFormChange({ matchMode: option.value })} className={`rounded-xl px-3 py-2 text-left transition ${form.matchMode === option.value ? "bg-slate-900 text-white shadow-sm" : "text-slate-600 hover:bg-slate-50"}`}><span className="block text-xs font-semibold">{option.label}</span><span className={`block text-[10px] ${form.matchMode === option.value ? "text-slate-300" : "text-slate-400"}`}>{option.detail}</span></button>)}
            </div>
            <div className="mt-2 space-y-2">
              {form.conditions.map((condition, index) => {
                const meta = fieldMeta(condition.field);
                return (
                  <div key={index}>
                    {index > 0 ? <p className="mb-2 pl-1 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">{form.matchMode === "ALL" ? "and" : "or"}</p> : null}
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
              <Select value={form.targetUserId} onChange={(event) => onFormChange({ targetUserId: event.target.value })} className="mt-1.5 w-full" required={form.isActive}>
                <option value="">Unassigned draft</option>
                {staff.map((person) => <option key={person.id} value={person.id}>{person.fullName} · {humanize(person.role)}</option>)}
              </Select>
            </label>
          </div>

          <label className="mt-5 flex items-center gap-2.5 text-sm font-medium text-slate-700">
            <input type="checkbox" checked={form.isActive} onChange={(event) => onFormChange({ isActive: event.target.checked })} className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-200" />
            Active
          </label>
          {!form.isActive && !form.targetUserId ? <p className="mt-2 text-xs text-slate-500">You can save this draft now and choose a team member before activating it.</p> : null}
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

function RuleCard({ rule, position, isFirst, isLast, busy, onMove, onToggleActive, onEdit, onReviewBacklog, onRemove }) {
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
            <button type="button" onClick={onReviewBacklog} className="inline-flex h-8 items-center gap-1.5 rounded-full px-2.5 text-xs font-semibold text-slate-500 transition hover:bg-brand-50 hover:text-brand-700" aria-label={`Review previous leads for ${rule.name}`}><History className="h-3.5 w-3.5" />Review backlog</button>
            <button type="button" onClick={onEdit} className="flex h-8 w-8 items-center justify-center rounded-full text-slate-400 transition hover:bg-slate-100 hover:text-slate-700" aria-label="Edit rule"><Pencil className="h-3.5 w-3.5" /></button>
            <button type="button" disabled={busy} onClick={onRemove} className="flex h-8 w-8 items-center justify-center rounded-full text-slate-400 transition hover:bg-rose-50 hover:text-rose-600 disabled:opacity-50" aria-label="Delete rule"><Trash2 className="h-3.5 w-3.5" /></button>
          </div>
        </div>

        <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
          {rule.conditions.map((condition, index) => <ConditionChip key={index} condition={condition} />)}
        </div>

        <div className="mt-3 flex items-center gap-2.5 border-t border-slate-100 pt-3">
          <ArrowRight className="h-3.5 w-3.5 shrink-0 text-slate-300" />
          <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[9px] font-bold ${rule.targetUser ? "bg-slate-900 text-white" : "bg-amber-100 text-amber-700"}`}>{initialsOf(rule.targetUser?.fullName)}</span>
          <span className="text-sm font-medium text-slate-800">{rule.targetUser?.fullName || "Unassigned draft"}</span>
          <span className="ml-auto shrink-0 text-[11px] text-slate-400">{rule.matchCount} match{rule.matchCount === 1 ? "" : "es"}{rule.lastMatchedAt ? ` · last ${new Date(rule.lastMatchedAt).toLocaleDateString("en-CA", { month: "short", day: "numeric" })}` : ""}</span>
        </div>
      </div>
    </div>
  );
}

function BacklogReview({ rule, onClose, onNotice }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [busyLeadId, setBusyLeadId] = useState("");
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [expandedIds, setExpandedIds] = useState(() => new Set());
  const [bulkProgress, setBulkProgress] = useState(null);

  async function load() {
    setError("");
    try {
      const response = await api.get(`/leads/routing-rules/${rule.id}/backlog`);
      setData(response.data.data);
      const availableIds = new Set((response.data.data.candidates || []).map((lead) => lead.id));
      setSelectedIds((current) => new Set([...current].filter((id) => availableIds.has(id))));
    } catch (requestError) {
      setError(requestError.response?.data?.message || "The backlog scan could not finish. Check your connection and try again.");
    }
  }
  useEffect(() => { load(); }, [rule.id]);

  async function review(lead, decision) {
    setBusyLeadId(lead.id);
    setError("");
    try {
      await api.post(`/leads/routing-rules/${rule.id}/backlog/${lead.id}/review`, { decision });
      onNotice(decision === "ASSIGNED" ? `${lead.leadNumber} assigned to ${rule.targetUser?.fullName}.` : `${lead.leadNumber} skipped.`);
      await load();
    } catch (requestError) {
      setError(requestError.response?.data?.message || "This lead could not be reviewed.");
    } finally {
      setBusyLeadId("");
    }
  }

  function toggleSelected(leadId) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(leadId)) next.delete(leadId);
      else next.add(leadId);
      return next;
    });
  }

  function toggleExpanded(leadId) {
    setExpandedIds((current) => {
      const next = new Set(current);
      if (next.has(leadId)) next.delete(leadId);
      else next.add(leadId);
      return next;
    });
  }

  async function bulkAssign() {
    const leads = candidates.filter((lead) => selectedIds.has(lead.id));
    if (!leads.length) return;
    setError("");
    setBulkProgress({ completed: 0, total: leads.length });
    let failed = 0;
    for (const lead of leads) {
      try {
        await api.post(`/leads/routing-rules/${rule.id}/backlog/${lead.id}/review`, { decision: "ASSIGNED" });
      } catch {
        failed += 1;
      }
      setBulkProgress((current) => ({ ...current, completed: current.completed + 1 }));
    }
    setSelectedIds(new Set());
    await load();
    setBulkProgress(null);
    if (failed) setError(`${failed} of ${leads.length} selected leads could not be assigned. The other assignments were saved.`);
    else onNotice(`${leads.length} lead${leads.length === 1 ? "" : "s"} assigned to ${rule.targetUser?.fullName}.`);
  }

  const candidates = data?.candidates || [];
  return createPortal(
    <div className="fixed inset-0 z-[180] flex justify-end bg-slate-950/25 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="routing-backlog-title">
      <button type="button" className="absolute inset-0" onClick={onClose} aria-label="Close backlog review" />
      <section className="relative flex h-full w-full max-w-2xl flex-col border-l border-slate-200 bg-[#f7f9fc] shadow-2xl">
        <header className="border-b border-slate-200 bg-white px-5 py-5 sm:px-7">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs font-semibold text-brand-700">Review before assigning</p>
              <h2 id="routing-backlog-title" className="mt-1 text-xl font-semibold tracking-tight text-slate-950">Previous leads matching {rule.name}</h2>
              <p className="mt-1 text-sm text-slate-500">Nothing is reassigned automatically. Assign each match to {rule.targetUser?.fullName}, or skip it to keep its current owner.</p>
            </div>
            <button type="button" onClick={onClose} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-500 hover:bg-slate-200" aria-label="Close backlog review"><X className="h-4 w-4" /></button>
          </div>
          {data ? <div className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-4" aria-label="Backlog audit totals">
            {[['Needs review', data.totals.pending], ['Already assigned', data.totals.alreadyAssigned], ['Assigned here', data.totals.assigned], ['Skipped', data.totals.skipped]].map(([label, value]) => <div key={label} className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2.5"><p className="text-lg font-semibold tabular-nums text-slate-900">{value}</p><p className="text-xs text-slate-500">{label}</p></div>)}
          </div> : null}
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
          {error ? <div role="alert" className="mb-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div> : null}
          {!data && !error ? <div className="rounded-3xl border border-brand-100 bg-white px-6 py-12 text-center"><div className="mx-auto h-9 w-9 animate-spin rounded-full border-[3px] border-brand-100 border-t-brand-600" aria-hidden="true" /><p className="mt-4 font-semibold text-slate-800">Scanning leads against this rule…</p><p className="mt-1 text-sm text-slate-500">Checking inquiry text, interest, source, and other configured conditions.</p></div> : null}
          {error && !data ? <button type="button" onClick={load} className="mb-4 h-10 rounded-full bg-slate-900 px-5 text-sm font-semibold text-white">Try scan again</button> : null}
          {data && data.capped ? <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">Showing matches from the 1,000 most recent previous leads.</div> : null}
          {data && !candidates.length ? <div className="rounded-3xl border border-dashed border-slate-200 bg-white px-6 py-12 text-center"><Check className="mx-auto h-7 w-7 text-emerald-600" /><p className="mt-3 font-semibold text-slate-800">Backlog review complete</p><p className="mt-1 text-sm text-slate-500">There are no unreviewed previous leads matching this rule.</p></div> : null}
          {candidates.length ? <div className="sticky top-0 z-10 mb-3 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white/95 px-3 py-2.5 shadow-sm backdrop-blur">
            <label className="flex min-h-10 cursor-pointer items-center gap-2.5 px-1 text-sm font-semibold text-slate-700">
              <input type="checkbox" checked={selectedIds.size === candidates.length} ref={(element) => { if (element) element.indeterminate = selectedIds.size > 0 && selectedIds.size < candidates.length; }} onChange={(event) => setSelectedIds(event.target.checked ? new Set(candidates.map((lead) => lead.id)) : new Set())} className="h-5 w-5 rounded border-slate-300 text-brand-600 focus:ring-brand-200" />
              {selectedIds.size ? `${selectedIds.size} selected` : "Select all visible"}
            </label>
            <button type="button" disabled={!selectedIds.size || Boolean(bulkProgress)} onClick={bulkAssign} className="inline-flex min-h-10 items-center justify-center gap-2 rounded-full bg-brand-600 px-4 text-sm font-semibold text-white hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"><Check className="h-4 w-4" />{bulkProgress ? `Assigning ${bulkProgress.completed}/${bulkProgress.total}…` : `Assign selected to ${rule.targetUser?.fullName}`}</button>
          </div> : null}
          <div className="space-y-3">
            {candidates.map((lead) => {
              const name = [lead.firstName, lead.lastName].filter(Boolean).join(" ") || "Unnamed lead";
              const expanded = expandedIds.has(lead.id);
              const selected = selectedIds.has(lead.id);
              return <article key={lead.id} className={`rounded-3xl border bg-white p-4 shadow-[0_12px_35px_rgba(28,45,74,0.04)] transition ${selected ? "border-brand-300 ring-2 ring-brand-100" : "border-slate-200"}`}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex min-w-0 items-start gap-3"><input type="checkbox" checked={selected} onChange={() => toggleSelected(lead.id)} disabled={busyLeadId === lead.id || Boolean(bulkProgress)} aria-label={`Select ${name}`} className="mt-0.5 h-5 w-5 shrink-0 rounded border-slate-300 text-brand-600 focus:ring-brand-200" /><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><h3 className="font-semibold text-slate-950">{name}</h3><span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600">{lead.leadNumber}</span></div><p className="mt-1 text-xs text-slate-500">{lead.originalSource?.name} · received {new Date(lead.inquiryDate).toLocaleDateString("en-CA", { month: "short", day: "numeric", year: "numeric" })}</p></div></div>
                  <span className="rounded-full bg-amber-50 px-2.5 py-1 text-[11px] font-semibold text-amber-700">Current: {lead.owner?.fullName}</span>
                </div>
                {lead.immigrationInterest ? <div className="mt-3 rounded-xl border border-brand-100 bg-brand-50 px-3 py-2 text-sm"><span className="font-semibold text-brand-800">Interest: </span><span className="text-brand-700">{lead.immigrationInterest}</span></div> : null}
                {lead.initialMessage ? <div className="mt-2 rounded-2xl bg-slate-50 px-3.5 py-3"><p className="text-xs font-semibold text-slate-500">Inquiry</p><p className={`mt-1 whitespace-pre-wrap break-words text-sm leading-6 text-slate-700 ${expanded ? "" : "line-clamp-3"}`}>{lead.initialMessage}</p><button type="button" onClick={() => toggleExpanded(lead.id)} className="mt-2 min-h-8 text-xs font-semibold text-brand-700 hover:text-brand-800">{expanded ? "Show less" : "Read full inquiry"}</button></div> : null}
                <div className="mt-4 flex flex-col-reverse gap-2 border-t border-slate-100 pt-4 sm:flex-row sm:justify-end">
                  <button type="button" disabled={busyLeadId === lead.id || Boolean(bulkProgress)} onClick={() => review(lead, "SKIPPED")} className="inline-flex h-11 items-center justify-center gap-2 rounded-full px-4 text-sm font-semibold text-slate-600 hover:bg-slate-100 disabled:opacity-50"><SkipForward className="h-4 w-4" />{busyLeadId === lead.id ? "Working…" : "Skip"}</button>
                  <button type="button" disabled={busyLeadId === lead.id || Boolean(bulkProgress)} onClick={() => review(lead, "ASSIGNED")} className="inline-flex h-11 items-center justify-center gap-2 rounded-full bg-brand-600 px-5 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-50"><Check className="h-4 w-4" />{busyLeadId === lead.id ? "Assigning…" : `Assign to ${rule.targetUser?.fullName}`}</button>
                </div>
              </article>;
            })}
          </div>
        </div>
      </section>
    </div>,
    document.body
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
  const [backlogRule, setBacklogRule] = useState(null);

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
    setForm({ name: "", targetUserId: "", matchMode: "ANY", isActive: true, conditions: [emptyCondition()] });
    setEditorError("");
    setEditing("create");
  }

  function openEdit(rule) {
    setForm({ name: rule.name, targetUserId: rule.targetUserId, matchMode: rule.matchMode || "ANY", isActive: rule.isActive, conditions: rule.conditions.length ? rule.conditions.map((item) => ({ ...item })) : [emptyCondition()] });
    setEditorError("");
    setEditing(rule);
  }

  async function submit(event) {
    event.preventDefault();
    setSaving(true);
    setEditorError("");
    const payload = { name: form.name, targetUserId: form.targetUserId, matchMode: form.matchMode, isActive: form.isActive, conditions: form.conditions.filter((item) => item.value) };
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
            <p className="mt-1 max-w-2xl text-sm text-slate-500">Route new leads to a specific team member based on their inquiry — checked top to bottom, first match wins. For leads created before a rule, use <span className="font-medium text-slate-700">Review backlog</span> to assign or skip every match before changes are made.</p>
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
              onReviewBacklog={() => setBacklogRule(rule)}
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
      {backlogRule ? <BacklogReview rule={backlogRule} onClose={() => { setBacklogRule(null); load(); }} onNotice={setNotice} /> : null}
    </div>
  );
}
