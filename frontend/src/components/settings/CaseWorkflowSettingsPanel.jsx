import { ArrowDown, ArrowUp, ChevronDown, Plus, Save, ShieldCheck, Trash2, Workflow, X } from "lucide-react";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import api from "../../services/api";
import { getWorkflowPriorityStyles } from "../case-profile/caseProfileUtils";
import Select from "../ui/Select";

const emptyStep = () => ({ localId: Math.random().toString(36).slice(2), title: "", description: "", priority: "Normal" });

const emptyForm = { name: "", caseType: "", description: "" };

function formFromTemplate(template) {
  return {
    name: template.name,
    caseType: template.caseType,
    description: template.description || "",
  };
}

function stepsFromTemplate(template) {
  return template.steps.map((step) => ({
    localId: step.id,
    title: step.title,
    description: step.description || "",
    priority: step.priority || "Normal",
  }));
}

function TemplateEditor({ title, subtitle, form, steps, saving, error, onFormChange, onUpdateStep, onMoveStep, onAddStep, onRemoveStep, onSubmit, onClose }) {
  // Portaled to document.body: this settings panel renders inside
  // Settings.jsx's Framer Motion wrapper, which sets an inline `filter`
  // style during its enter/exit animation. Any non-"none" `filter` value
  // on an ancestor creates a new containing block for `position: fixed`
  // descendants, which would trap this modal inside the Settings content
  // box instead of covering the real viewport. Portaling escapes that
  // ancestor entirely, matching WorkflowEditorOverlay.jsx's convention.
  return createPortal(
    <div className="fixed inset-0 z-[260] bg-slate-950/24 p-3 backdrop-blur-md" onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) onClose(); }}>
      <form onSubmit={onSubmit} className="mx-auto flex h-full max-w-4xl flex-col overflow-hidden rounded-[2rem] border border-white/80 bg-white shadow-[0_28px_80px_rgba(15,23,42,0.26)]">
        <div className="flex items-start justify-between gap-4 border-b border-slate-100 px-5 py-4">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">{subtitle}</p>
            <h2 className="mt-1 text-lg font-semibold text-slate-950">{title}</h2>
          </div>
          <button type="button" onClick={onClose} disabled={saving} className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 transition hover:border-slate-300 hover:text-slate-950 disabled:cursor-not-allowed disabled:opacity-60" aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {error ? <div className="mb-4 rounded-2xl bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div> : null}

          <div className="grid gap-3 md:grid-cols-2">
            <label className="text-sm font-medium text-slate-700">
              Workflow name
              <input
                value={form.name}
                onChange={(event) => onFormChange({ name: event.target.value })}
                className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none transition focus:border-slate-400"
                placeholder="Study permit document workflow"
                required
              />
            </label>
            <label className="text-sm font-medium text-slate-700">
              Case type
              <input
                value={form.caseType}
                onChange={(event) => onFormChange({ caseType: event.target.value })}
                className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none transition focus:border-slate-400"
                placeholder="Study Permit"
                required
              />
            </label>
          </div>

          <label className="mt-3 block text-sm font-medium text-slate-700">
            Description (optional)
            <input
              value={form.description}
              onChange={(event) => onFormChange({ description: event.target.value })}
              className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none transition focus:border-slate-400"
              placeholder="What this workflow is for"
            />
          </label>

          <div className="mt-5 space-y-3">
            {steps.map((step, index) => (
              <div key={step.localId} className="rounded-[1.35rem] border border-slate-200 bg-white px-4 py-3 shadow-[0_12px_28px_rgba(15,23,42,0.04)]">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
                  <div className="flex items-center gap-3 lg:w-[110px]">
                    <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-slate-950 text-xs font-semibold text-white">{index + 1}</span>
                    <span className="text-xs font-semibold text-slate-400">Milestone</span>
                  </div>

                  <input
                    value={step.title}
                    onChange={(event) => onUpdateStep(index, { title: event.target.value })}
                    className="min-w-0 flex-1 rounded-2xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-medium text-slate-900 outline-none transition focus:border-slate-400"
                    placeholder="Collect passport"
                  />

                  <Select
                    value={step.priority || "Normal"}
                    onChange={(event) => onUpdateStep(index, { priority: event.target.value })}
                    className="shrink-0"
                    selectClassName={`text-xs ${getWorkflowPriorityStyles(step.priority)}`}
                  >
                    <option value="Low">Low</option>
                    <option value="Normal">Normal</option>
                    <option value="High">High</option>
                    <option value="Urgent">Urgent</option>
                  </Select>

                  <div className="flex items-center gap-2">
                    <button type="button" onClick={() => onMoveStep(index, -1)} disabled={index === 0} className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 transition hover:text-slate-950 disabled:cursor-not-allowed disabled:opacity-40" aria-label="Move step up">
                      <ArrowUp className="h-4 w-4" />
                    </button>
                    <button type="button" onClick={() => onMoveStep(index, 1)} disabled={index === steps.length - 1} className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 transition hover:text-slate-950 disabled:cursor-not-allowed disabled:opacity-40" aria-label="Move step down">
                      <ArrowDown className="h-4 w-4" />
                    </button>
                    <button type="button" onClick={() => onRemoveStep(index)} disabled={steps.length <= 1} className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 transition hover:border-rose-200 hover:text-rose-600 disabled:cursor-not-allowed disabled:opacity-40" aria-label="Delete step">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>

                <textarea
                  value={step.description || ""}
                  onChange={(event) => onUpdateStep(index, { description: event.target.value })}
                  className="mt-3 min-h-[64px] w-full resize-none rounded-2xl border border-slate-200 bg-slate-50/70 px-3 py-2.5 text-sm text-slate-700 outline-none transition focus:border-slate-400 focus:bg-white"
                  placeholder="Optional consultant note for this milestone"
                />
              </div>
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-3 border-t border-slate-100 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <button type="button" onClick={onAddStep} className="inline-flex items-center justify-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 transition hover:border-slate-300 hover:text-slate-950">
            <Plus className="h-4 w-4" />
            Add milestone
          </button>
          <div className="flex items-center gap-2">
            <button type="button" onClick={onClose} disabled={saving} className="inline-flex items-center justify-center rounded-full border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:border-slate-300 hover:text-slate-950 disabled:cursor-not-allowed disabled:opacity-60">
              Cancel
            </button>
            <button type="submit" disabled={saving} className="inline-flex items-center justify-center gap-2 rounded-full bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60">
              <Save className="h-4 w-4" />
              {saving ? "Saving" : "Save workflow"}
            </button>
          </div>
        </div>
      </form>
    </div>,
    document.body
  );
}

function TemplateCard({ template, expanded, onToggle, onEdit, onDelete }) {
  return (
    <div className="rounded-3xl border border-slate-200 bg-white shadow-sm">
      <button type="button" onClick={onToggle} className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="truncate font-semibold text-slate-950">{template.name}</h3>
            {template.isDefault ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-indigo-50 px-2.5 py-0.5 text-[11px] font-semibold text-indigo-600">
                <ShieldCheck className="h-3 w-3" /> System
              </span>
            ) : null}
          </div>
          <p className="mt-1 truncate text-sm text-slate-500">{template.caseType} · {template.steps.length} milestone{template.steps.length === 1 ? "" : "s"}</p>
        </div>
        <ChevronDown className={`h-4 w-4 shrink-0 text-slate-400 transition-transform ${expanded ? "rotate-180" : ""}`} />
      </button>

      {expanded ? (
        <div className="border-t border-slate-100 px-5 py-4">
          <ol className="space-y-2">
            {template.steps.map((step, index) => (
              <li key={step.id} className="flex items-start gap-3 text-sm">
                <span className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-slate-100 text-[11px] font-semibold text-slate-600">{index + 1}</span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-slate-800">{step.title}</span>
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${getWorkflowPriorityStyles(step.priority)}`}>{step.priority}</span>
                  </div>
                  {step.description ? <p className="mt-0.5 text-slate-500">{step.description}</p> : null}
                </div>
              </li>
            ))}
          </ol>

          {!template.isDefault ? (
            <div className="mt-4 flex items-center gap-2 border-t border-slate-100 pt-4">
              <button type="button" onClick={onEdit} className="rounded-full border border-slate-200 bg-white px-3.5 py-1.5 text-xs font-semibold text-slate-700 transition hover:border-slate-300 hover:text-slate-950">
                Edit
              </button>
              <button type="button" onClick={onDelete} className="rounded-full border border-slate-200 bg-white px-3.5 py-1.5 text-xs font-semibold text-slate-500 transition hover:border-rose-200 hover:text-rose-600">
                Delete
              </button>
            </div>
          ) : (
            <p className="mt-4 border-t border-slate-100 pt-4 text-xs text-slate-400">
              System workflows can't be edited directly — create a new template to customize a copy of this one.
            </p>
          )}
        </div>
      ) : null}
    </div>
  );
}

export default function CaseWorkflowSettingsPanel() {
  const [templates, setTemplates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [expandedId, setExpandedId] = useState(null);

  const [editing, setEditing] = useState(null); // null | "create" | template object
  const [form, setForm] = useState(emptyForm);
  const [steps, setSteps] = useState([emptyStep()]);
  const [saving, setSaving] = useState(false);
  const [editorError, setEditorError] = useState("");
  const [notice, setNotice] = useState("");

  async function load() {
    setLoading(true);
    setError("");
    try {
      const { data } = await api.get("/workflow-templates");
      setTemplates(data.data);
    } catch (reason) {
      setError(reason.response?.data?.message || "Workflow templates could not be loaded.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  function openCreate() {
    setForm(emptyForm);
    setSteps([emptyStep()]);
    setEditorError("");
    setEditing("create");
  }

  function openEdit(template) {
    setForm(formFromTemplate(template));
    setSteps(stepsFromTemplate(template));
    setEditorError("");
    setEditing(template);
  }

  function updateStep(index, patch) {
    setSteps((current) => current.map((step, i) => (i === index ? { ...step, ...patch } : step)));
  }

  function moveStep(index, direction) {
    setSteps((current) => {
      const target = index + direction;
      if (target < 0 || target >= current.length) return current;
      const next = [...current];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }

  function addStep() {
    setSteps((current) => [...current, emptyStep()]);
  }

  function removeStep(index) {
    setSteps((current) => (current.length <= 1 ? current : current.filter((_, i) => i !== index)));
  }

  async function submit(event) {
    event.preventDefault();
    setSaving(true);
    setEditorError("");
    const payload = { ...form, steps: steps.map((step, index) => ({ ...step, sortOrder: index + 1 })) };
    try {
      if (editing === "create") {
        await api.post("/workflow-templates", payload);
        setNotice("Workflow template created.");
      } else {
        await api.patch(`/workflow-templates/${editing.id}`, payload);
        setNotice("Workflow template updated.");
      }
      setEditing(null);
      await load();
    } catch (reason) {
      setEditorError(reason.response?.data?.message || "The workflow template could not be saved.");
    } finally {
      setSaving(false);
    }
  }

  async function remove(template) {
    if (!window.confirm(`Delete the "${template.name}" workflow template? This can't be undone.`)) return;
    try {
      await api.delete(`/workflow-templates/${template.id}`);
      setNotice("Workflow template deleted.");
      await load();
    } catch (reason) {
      setError(reason.response?.data?.message || "The workflow template could not be deleted.");
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-indigo-50 text-indigo-600">
            <Workflow className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-2xl font-semibold tracking-tight text-slate-950">Case Workflow</h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500">
              Configure the milestone checklists new cases start with, per case type. System workflows come built in;
              create your own to customize the steps for how your team works.
            </p>
          </div>
        </div>
        <button type="button" onClick={openCreate} className="inline-flex shrink-0 items-center gap-2 rounded-full bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800">
          <Plus className="h-4 w-4" />
          New template
        </button>
      </div>

      {notice ? <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-700">{notice}</div> : null}
      {error ? <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-700">{error}</div> : null}

      {loading ? (
        <div className="space-y-3">
          {[0, 1, 2].map((key) => <div key={key} className="h-16 animate-pulse rounded-3xl bg-slate-100" />)}
        </div>
      ) : templates.length === 0 ? (
        <div className="rounded-3xl border border-dashed border-slate-200 bg-slate-50 px-6 py-10 text-center text-sm text-slate-500">
          No workflow templates yet.
        </div>
      ) : (
        <div className="space-y-3">
          {templates.map((template) => (
            <TemplateCard
              key={template.id}
              template={template}
              expanded={expandedId === template.id}
              onToggle={() => setExpandedId((current) => (current === template.id ? null : template.id))}
              onEdit={() => openEdit(template)}
              onDelete={() => remove(template)}
            />
          ))}
        </div>
      )}

      {editing ? (
        <TemplateEditor
          title={editing === "create" ? "Create workflow template" : `Edit ${editing.name}`}
          subtitle={form.caseType || "Custom"}
          form={form}
          steps={steps}
          saving={saving}
          error={editorError}
          onFormChange={(patch) => setForm((current) => ({ ...current, ...patch }))}
          onUpdateStep={updateStep}
          onMoveStep={moveStep}
          onAddStep={addStep}
          onRemoveStep={removeStep}
          onSubmit={submit}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </div>
  );
}
