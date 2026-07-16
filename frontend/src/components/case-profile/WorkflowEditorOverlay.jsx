import {
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  Circle,
  GripVertical,
  Plus,
  Save,
  Trash2,
  X,
} from "lucide-react";
import { motion } from "framer-motion";
import { createPortal } from "react-dom";
import { getWorkflowPriorityStyles } from "./caseProfileUtils";

export function WorkflowOverlay({
  caseType,
  templates,
  selectedTemplateId,
  draftSteps,
  creatingTemplate,
  deletingTemplateId,
  onSelectTemplate,
  onOpenTemplateForm,
  onDeleteTemplate,
  onUpdateStep,
  onToggleStep,
  onMoveStep,
  onAddStep,
  onRemoveStep,
  onClose,
  onSave,
  saving,
  error,
}) {
  const activeCount = draftSteps.filter((step) => step.isActive !== false).length;

  return createPortal(
    <div className="fixed inset-0 z-[220] bg-slate-950/18 p-3 backdrop-blur-sm">
      <div className="mx-auto flex h-full max-w-6xl flex-col overflow-hidden rounded-[2rem] border border-white/80 bg-white shadow-[0_26px_70px_rgba(15,23,42,0.22)]">
        <div className="flex items-center justify-between gap-4 border-b border-slate-100 px-5 py-4">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">{caseType || "Case"} workflow</p>
            <h2 className="mt-1 text-lg font-semibold text-slate-950">{activeCount} active milestones</h2>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onOpenTemplateForm}
              disabled={saving || creatingTemplate}
              className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:border-slate-300 hover:text-slate-950 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <Plus className="h-4 w-4" />
              Create
            </button>
            <button
              type="button"
              onClick={onSave}
              disabled={saving}
              className="inline-flex items-center gap-2 rounded-full bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <Save className="h-4 w-4" />
              {saving ? "Saving" : "Save"}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 transition hover:border-slate-300 hover:text-slate-950"
              aria-label="Close workflow editor"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {error ? <div className="mx-5 mt-4 rounded-2xl bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div> : null}

        <div className="grid min-h-0 flex-1 gap-0 overflow-hidden lg:grid-cols-[320px_1fr]">
          <aside className="min-h-0 overflow-y-auto border-b border-slate-100 p-5 lg:border-b-0 lg:border-r">
            <div className="space-y-2">
              {templates.map((template) => {
                const isSelected = selectedTemplateId === template.id;
                const isRecommended = template.caseType === caseType;

                return (
                  <div
                    key={template.id}
                    className={`group flex w-full items-start gap-2 rounded-[1.25rem] border px-4 py-3 text-left transition ${
                      isSelected
                        ? "border-slate-950 bg-slate-950 text-white shadow-[0_16px_34px_rgba(15,23,42,0.16)]"
                        : "border-slate-200 bg-white text-slate-700 hover:border-slate-300"
                    }`}
                  >
                    <button type="button" onClick={() => onSelectTemplate(template)} className="min-w-0 flex-1 text-left">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-sm font-semibold">{template.name}</p>
                          <p className={`mt-1 text-xs ${isSelected ? "text-white/70" : "text-slate-500"}`}>{template.caseType}</p>
                        </div>
                        {isRecommended ? (
                          <span className={`rounded-full px-2 py-1 text-[10px] font-semibold ${isSelected ? "bg-white/15 text-white" : "bg-emerald-50 text-emerald-700"}`}>
                            Match
                          </span>
                        ) : null}
                      </div>
                    </button>
                    {!template.isDefault ? (
                      <button
                        type="button"
                        onClick={() => onDeleteTemplate(template)}
                        disabled={deletingTemplateId === template.id}
                        className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition ${
                          isSelected
                            ? "text-white/70 hover:bg-white/10 hover:text-white"
                            : "text-slate-400 hover:bg-rose-50 hover:text-rose-600"
                        } disabled:cursor-not-allowed disabled:opacity-50`}
                        aria-label={`Delete ${template.name}`}
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </aside>

          <main className="min-h-0 overflow-y-auto p-5">
            <div className="space-y-3">
              {draftSteps.map((step, index) => {
                const isActive = step.isActive !== false;

                return (
                  <div
                    key={step.localId || step.id || `${step.title}-${index}`}
                    className={`rounded-[1.35rem] border px-4 py-3 transition ${
                      isActive ? "border-slate-200 bg-white" : "border-slate-100 bg-slate-50 opacity-70"
                    }`}
                  >
                    <div className="flex flex-col gap-3 md:flex-row md:items-center">
                      <div className="flex items-center gap-3 md:w-[160px]">
                        <GripVertical className="h-4 w-4 text-slate-300" />
                        <button
                          type="button"
                          onClick={() => onToggleStep(index)}
                          className={`inline-flex h-7 w-7 items-center justify-center rounded-full border transition ${
                            isActive ? "border-slate-950 bg-slate-950 text-white" : "border-slate-300 bg-white text-slate-400"
                          }`}
                          aria-label={`${isActive ? "Remove" : "Include"} ${step.title}`}
                        >
                          {isActive ? <CheckCircle2 className="h-4 w-4" /> : <Circle className="h-4 w-4" />}
                        </button>
                        <span className="text-xs font-semibold text-slate-400">Step {index + 1}</span>
                      </div>

                      <input
                        value={step.title}
                        onChange={(event) => onUpdateStep(index, { title: event.target.value })}
                        className="min-w-0 flex-1 rounded-2xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-medium text-slate-900 outline-none transition focus:border-slate-400"
                      />

                      <select
                        value={step.priority || "Normal"}
                        onChange={(event) => onUpdateStep(index, { priority: event.target.value })}
                        className={`rounded-full border border-slate-200 px-3 py-2 text-xs font-semibold outline-none transition focus:border-slate-400 ${getWorkflowPriorityStyles(step.priority)}`}
                      >
                        <option value="Low">Low</option>
                        <option value="Normal">Normal</option>
                        <option value="High">High</option>
                        <option value="Urgent">Urgent</option>
                      </select>

                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => onMoveStep(index, -1)}
                          disabled={index === 0}
                          className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 transition hover:text-slate-950 disabled:cursor-not-allowed disabled:opacity-40"
                          aria-label="Move step up"
                        >
                          <ArrowUp className="h-4 w-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => onMoveStep(index, 1)}
                          disabled={index === draftSteps.length - 1}
                          className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 transition hover:text-slate-950 disabled:cursor-not-allowed disabled:opacity-40"
                          aria-label="Move step down"
                        >
                          <ArrowDown className="h-4 w-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => onRemoveStep(index)}
                          className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 transition hover:border-rose-200 hover:text-rose-600"
                          aria-label="Delete step"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            <button
              type="button"
              onClick={onAddStep}
              className="mt-4 inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 transition hover:border-slate-300 hover:text-slate-950"
            >
              <Plus className="h-4 w-4" />
              Add milestone
            </button>
          </main>
        </div>
      </div>
    </div>,
    document.body
  );
}

export function WorkflowTemplateCreateOverlay({
  caseType,
  templateForm,
  templateDraftSteps,
  creatingTemplate,
  error,
  onTemplateFormChange,
  onUpdateTemplateDraftStep,
  onMoveTemplateDraftStep,
  onAddTemplateDraftStep,
  onRemoveTemplateDraftStep,
  onCreateTemplate,
  onClose,
}) {
  return createPortal(
    <div className="fixed inset-0 z-[260] bg-slate-950/24 p-3 backdrop-blur-md">
      <motion.form
        initial={{ opacity: 0, y: 18, scale: 0.985 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 10, scale: 0.99 }}
        transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
        onSubmit={onCreateTemplate}
        className="mx-auto flex h-full max-w-5xl flex-col overflow-hidden rounded-[2rem] border border-white/80 bg-white shadow-[0_28px_80px_rgba(15,23,42,0.26)]"
      >
        <div className="flex items-start justify-between gap-4 border-b border-slate-100 px-5 py-4">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">{caseType || "Custom"} workflow</p>
            <h2 className="mt-1 text-lg font-semibold text-slate-950">Create workflow template</h2>
            <p className="mt-1 max-w-xl text-sm text-slate-500">Start from a blank workflow and save it as a reusable template for this agency.</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={creatingTemplate}
            className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 transition hover:border-slate-300 hover:text-slate-950 disabled:cursor-not-allowed disabled:opacity-60"
            aria-label="Close create workflow"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {error ? <div className="mb-4 rounded-2xl bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div> : null}

          <div className="grid gap-3 md:grid-cols-2">
            <label className="text-sm font-medium text-slate-700">
              Workflow name
              <input
                name="name"
                value={templateForm.name}
                onChange={onTemplateFormChange}
                className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none transition focus:border-slate-400"
                placeholder="Study permit document workflow"
                required
              />
            </label>
            <label className="text-sm font-medium text-slate-700">
              Case type
              <input
                name="caseType"
                value={templateForm.caseType}
                onChange={onTemplateFormChange}
                className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none transition focus:border-slate-400"
                placeholder="Study Permit"
                required
              />
            </label>
          </div>

          <div className="mt-5 space-y-3">
            {templateDraftSteps.map((step, index) => (
              <div
                key={step.localId || `${step.title}-${index}`}
                className="rounded-[1.35rem] border border-slate-200 bg-white px-4 py-3 shadow-[0_12px_28px_rgba(15,23,42,0.04)]"
              >
                <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
                  <div className="flex items-center gap-3 lg:w-[150px]">
                    <GripVertical className="h-4 w-4 text-slate-300" />
                    <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-slate-950 text-xs font-semibold text-white">
                      {index + 1}
                    </span>
                    <span className="text-xs font-semibold text-slate-400">Milestone</span>
                  </div>

                  <input
                    value={step.title}
                    onChange={(event) => onUpdateTemplateDraftStep(index, { title: event.target.value })}
                    className="min-w-0 flex-1 rounded-2xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-medium text-slate-900 outline-none transition focus:border-slate-400"
                    placeholder="Collect passport"
                  />

                  <select
                    value={step.priority || "Normal"}
                    onChange={(event) => onUpdateTemplateDraftStep(index, { priority: event.target.value })}
                    className={`rounded-full border border-slate-200 px-3 py-2 text-xs font-semibold outline-none transition focus:border-slate-400 ${getWorkflowPriorityStyles(step.priority)}`}
                  >
                    <option value="Low">Low</option>
                    <option value="Normal">Normal</option>
                    <option value="High">High</option>
                    <option value="Urgent">Urgent</option>
                  </select>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => onMoveTemplateDraftStep(index, -1)}
                      disabled={index === 0}
                      className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 transition hover:text-slate-950 disabled:cursor-not-allowed disabled:opacity-40"
                      aria-label="Move template step up"
                    >
                      <ArrowUp className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => onMoveTemplateDraftStep(index, 1)}
                      disabled={index === templateDraftSteps.length - 1}
                      className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 transition hover:text-slate-950 disabled:cursor-not-allowed disabled:opacity-40"
                      aria-label="Move template step down"
                    >
                      <ArrowDown className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => onRemoveTemplateDraftStep(index)}
                      disabled={templateDraftSteps.length <= 1}
                      className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 transition hover:border-rose-200 hover:text-rose-600 disabled:cursor-not-allowed disabled:opacity-40"
                      aria-label="Delete template step"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>

                <textarea
                  value={step.description || ""}
                  onChange={(event) => onUpdateTemplateDraftStep(index, { description: event.target.value })}
                  className="mt-3 min-h-[74px] w-full resize-none rounded-2xl border border-slate-200 bg-slate-50/70 px-3 py-2.5 text-sm text-slate-700 outline-none transition focus:border-slate-400 focus:bg-white"
                  placeholder="Optional consultant note for this milestone"
                />
              </div>
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-3 border-t border-slate-100 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <button
            type="button"
            onClick={onAddTemplateDraftStep}
            className="inline-flex items-center justify-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 transition hover:border-slate-300 hover:text-slate-950"
          >
            <Plus className="h-4 w-4" />
            Add milestone
          </button>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={creatingTemplate}
              className="inline-flex items-center justify-center rounded-full border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:border-slate-300 hover:text-slate-950 disabled:cursor-not-allowed disabled:opacity-60"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={creatingTemplate}
              className="inline-flex items-center justify-center gap-2 rounded-full bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <Save className="h-4 w-4" />
              {creatingTemplate ? "Creating" : "Create workflow"}
            </button>
          </div>
        </div>
      </motion.form>
    </div>,
    document.body
  );
}
