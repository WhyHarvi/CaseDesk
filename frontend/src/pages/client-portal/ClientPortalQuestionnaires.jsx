import { CheckCircle2, ChevronRight, ClipboardList, Loader2, Lock, Plus, Send, Trash2, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import {
  getPortalQuestionnaires,
  savePortalQuestionnaireAnswers,
  submitPortalQuestionnaire,
  portalErrorMessage,
} from "../../api/clientPortalApi";
import ClientPortalHeader from "../../components/client-portal/ClientPortalHeader";
import ClientPortalSkeleton, { GlassCard } from "../../components/client-portal/ClientPortalSkeleton";
import ClientPortalEmptyState from "../../components/client-portal/ClientPortalEmptyState";
import { usePortalData } from "../../components/client-portal/ClientPortalLayout";
import { usePortalToast } from "../../components/client-portal/ClientPortalToast";
import { formatPortalDate } from "../../components/client-portal/ClientStatusCard";
import { profileQuestionnaireSections } from "../../components/case-profile/ProfileQuestionnaireSection";
import { collectionConfigs, parentFields } from "../../components/case-profile/ProfileCollectionQuestionnaire";

const inputClass = "mt-1.5 h-12 w-full rounded-2xl border border-slate-200 bg-white px-4 text-base text-slate-900 outline-none transition focus:border-sky-300 focus:ring-4 focus:ring-sky-100";
const textareaClass = "mt-1.5 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-base text-slate-900 outline-none transition focus:border-sky-300 focus:ring-4 focus:ring-sky-100";

const COLLECTION_META = {
  identityPermits: { config: collectionConfigs.identity },
  addressHistory: { config: collectionConfigs.address },
  travelHistory: { config: collectionConfigs.travel, noComplete: true },
  activityHistory: { config: collectionConfigs.activity },
  dependantsAndChildren: { config: collectionConfigs.dependants, extras: (entries) => ({ hasMoreDependants: entries.length > 1 ? "Yes" : "No" }) },
  siblings: { config: collectionConfigs.siblings, extras: (entries) => ({ hasMoreSiblings: entries.length > 1 ? "Yes" : "No" }) },
};

const blankFrom = (fields) => Object.fromEntries(fields.map(([key]) => [key, ""]));
const meaningful = (record) => Object.values(record || {}).some((value) => String(value || "").trim());

function SheetShell({ title, subtitle, onClose, children, footer }) {
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (event) => event.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  return createPortal(
    <div className="fixed inset-0 z-[240] flex flex-col bg-slate-950/30 backdrop-blur-sm" role="dialog" aria-modal="true">
      <button type="button" className="h-10 shrink-0 sm:flex-1" onClick={onClose} aria-label="Close" />
      <div className="mx-auto flex min-h-0 w-full max-w-[560px] flex-1 flex-col overflow-hidden rounded-t-[1.75rem] bg-[#f4f7fb] shadow-[0_-20px_60px_rgba(15,23,42,0.25)] sm:max-h-[92vh] sm:flex-none sm:rounded-[1.75rem]">
        <header className="flex items-start justify-between gap-3 border-b border-slate-200/70 bg-white/90 px-5 py-4 backdrop-blur">
          <div className="min-w-0">
            <h2 className="truncate text-[17px] font-semibold tracking-tight text-slate-950">{title}</h2>
            {subtitle ? <p className="mt-0.5 text-[13px] leading-5 text-slate-500">{subtitle}</p> : null}
          </div>
          <button type="button" onClick={onClose} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-500 transition hover:bg-slate-200 active:scale-95" aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4">{children}</div>
        {footer ? <footer className="border-t border-slate-200/70 bg-white/95 px-4 py-3 pb-[max(env(safe-area-inset-bottom),0.75rem)] backdrop-blur">{footer}</footer> : null}
      </div>
    </div>,
    document.body,
  );
}

function FieldInput({ spec, values, onChange, variant }) {
  if (variant === "flat") {
    const [key, label, type = "text", options, showWhen] = spec;
    if (showWhen && values[showWhen] !== "Yes") return null;
    return (
      <label className="block text-sm font-semibold text-slate-800">
        {label}
        {type === "select" ? (
          <select value={values[key] || ""} onChange={(event) => onChange(key, event.target.value)} className={inputClass}>
            {options.map((option) => <option key={option || "empty"} value={option}>{option || "Select"}</option>)}
          </select>
        ) : type === "textarea" ? (
          <textarea rows={3} value={values[key] || ""} onChange={(event) => onChange(key, event.target.value)} className={textareaClass} />
        ) : (
          <input type={type} value={values[key] || ""} onChange={(event) => onChange(key, event.target.value)} className={inputClass} />
        )}
      </label>
    );
  }
  const [key, label, type = "text", detail, options, condition, maxLength] = spec;
  if (condition && values[condition[0]] !== condition[1]) return null;
  return (
    <label className="block text-sm font-semibold text-slate-800">
      {label}
      {detail ? <span className="mt-0.5 block text-xs font-normal leading-5 text-slate-500">{detail}</span> : null}
      {type === "select" ? (
        <select value={values[key] || ""} onChange={(event) => onChange(key, event.target.value)} className={inputClass}>
          {options.map((option) => <option key={option || "empty"} value={option}>{option || "Select"}</option>)}
        </select>
      ) : type === "textarea" ? (
        <textarea rows={3} maxLength={maxLength} value={values[key] || ""} onChange={(event) => onChange(key, event.target.value)} className={textareaClass} />
      ) : (
        <input type={type} value={values[key] || ""} onChange={(event) => onChange(key, event.target.value)} className={inputClass} />
      )}
    </label>
  );
}

function SaveFooter({ saving, label = "Save answers" }) {
  return (
    <button
      type="submit"
      disabled={saving}
      className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-slate-950 text-sm font-semibold text-white shadow-[0_10px_24px_rgba(15,23,42,0.2)] transition-all duration-200 hover:bg-slate-800 active:scale-[0.98] disabled:opacity-50"
    >
      {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
      {saving ? "Saving…" : label}
    </button>
  );
}

function FlatStepSheet({ step, initialValues, onClose, onSaved }) {
  const config = profileQuestionnaireSections[step.id];
  const [values, setValues] = useState(initialValues || {});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function save(event) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      await savePortalQuestionnaireAnswers({ type: "flat", sectionId: step.id, values });
      onSaved();
    } catch (reason) {
      setError(portalErrorMessage(reason, "Your answers could not be saved."));
    } finally {
      setSaving(false);
    }
  }

  if (!config) return null;
  return (
    <SheetShell title={config.title} subtitle={config.description} onClose={onClose} footer={null}>
      <form onSubmit={save} className="space-y-4 pb-2">
        {error ? <p className="rounded-2xl bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</p> : null}
        <div className="space-y-4 rounded-3xl border border-white/80 bg-white p-4">
          {config.fields.map((spec) => (
            <FieldInput key={spec[0]} spec={spec} values={values} onChange={(key, value) => setValues((current) => ({ ...current, [key]: value }))} variant="flat" />
          ))}
        </div>
        <p className="px-1 text-xs leading-5 text-slate-400">You can save partial answers and come back any time.</p>
        <SaveFooter saving={saving} />
      </form>
    </SheetShell>
  );
}

function CollectionStepSheet({ step, initialValues, onClose, onSaved }) {
  const isParents = step.id === "parents";
  const meta = COLLECTION_META[step.id];
  const config = isParents ? null : meta.config;
  const listKey = config?.listKey;

  const [entries, setEntries] = useState([]);
  const [gate, setGate] = useState("");
  const [complete, setComplete] = useState(false);
  const [mother, setMother] = useState({});
  const [father, setFather] = useState({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const data = initialValues || {};
    if (isParents) {
      setMother({ ...blankFrom(parentFields("mother")), ...(data.mother || {}) });
      setFather({ ...blankFrom(parentFields("father")), ...(data.father || {}) });
    } else {
      setEntries((data[listKey] || []).map((entry) => ({ ...blankFrom(config.fields), ...entry })));
      if (config.gateKey) setGate(data[config.gateKey] || "");
    }
    setComplete(data.complete === "Yes");
  }, [initialValues, isParents, config, listKey]);

  async function save(event) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      let values;
      if (isParents) {
        values = { ...(initialValues || {}), mother, father, complete: complete ? "Yes" : "No" };
      } else {
        const kept = config.gateKey && gate === "No" ? [] : entries.filter(meaningful);
        values = {
          ...(initialValues || {}),
          [listKey]: kept,
          ...(config.gateKey ? { [config.gateKey]: gate } : {}),
          ...(meta.noComplete ? {} : { complete: complete ? "Yes" : "No" }),
          ...(meta.extras ? meta.extras(kept) : {}),
        };
      }
      await savePortalQuestionnaireAnswers({ type: "collection", sectionId: step.id, values });
      onSaved();
    } catch (reason) {
      setError(portalErrorMessage(reason, "Your answers could not be saved."));
    } finally {
      setSaving(false);
    }
  }

  const title = isParents ? "Parent Details" : config.title;
  const description = isParents ? "Add your mother's and father's details for the application." : config.description;

  const renderEntryFields = (record, onChange) => (
    <div className="space-y-4">
      {(isParents ? [] : config.fields).map((spec) => (
        <FieldInput key={spec[0]} spec={spec} values={record} onChange={onChange} variant="collection" />
      ))}
    </div>
  );

  return (
    <SheetShell title={title} subtitle={description} onClose={onClose} footer={null}>
      <form onSubmit={save} className="space-y-4 pb-2">
        {error ? <p className="rounded-2xl bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</p> : null}

        {isParents ? (
          <>
            {[["Mother", mother, setMother], ["Father", father, setFather]].map(([label, record, setter]) => (
              <section key={label} className="rounded-3xl border border-white/80 bg-white p-4">
                <p className="mb-4 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">{label}'s details</p>
                <div className="space-y-4">
                  {parentFields(label.toLowerCase()).map((spec) => (
                    <FieldInput key={spec[0]} spec={spec} values={record} onChange={(key, value) => setter((current) => ({ ...current, [key]: value }))} variant="collection" />
                  ))}
                </div>
              </section>
            ))}
          </>
        ) : (
          <>
            {config.gateKey ? (
              <section className="rounded-3xl border border-white/80 bg-white p-4">
                <label className="block text-sm font-semibold text-slate-800">
                  {config.gateLabel}
                  <select
                    value={gate}
                    onChange={(event) => { setGate(event.target.value); if (event.target.value === "No") setEntries([]); }}
                    className={inputClass}
                  >
                    <option value="">Select</option>
                    <option>Yes</option>
                    <option>No</option>
                  </select>
                </label>
              </section>
            ) : null}

            {!config.gateKey || gate === "Yes" ? (
              <>
                {entries.map((entry, index) => (
                  <section key={index} className="rounded-3xl border border-white/80 bg-white p-4">
                    <div className="mb-4 flex items-center justify-between">
                      <h3 className="text-sm font-semibold capitalize text-slate-950">{index === 0 ? `Most recent ${config.singular}` : `${config.singular} ${index + 1}`}</h3>
                      <button type="button" onClick={() => setEntries((items) => items.filter((_, itemIndex) => itemIndex !== index))} className="flex h-8 w-8 items-center justify-center rounded-full bg-rose-50 text-rose-500 transition active:scale-95" aria-label={`Remove ${config.singular}`}>
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                    {renderEntryFields(entry, (key, value) => setEntries((items) => items.map((item, itemIndex) => (itemIndex === index ? { ...item, [key]: value } : item))))}
                  </section>
                ))}
                <button
                  type="button"
                  onClick={() => { setEntries((items) => [...items, blankFrom(config.fields)]); if (config.gateKey) setGate("Yes"); }}
                  className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-2xl border border-dashed border-slate-300 bg-white/70 text-sm font-semibold text-slate-700 transition active:scale-[0.98]"
                >
                  <Plus className="h-4 w-4" />
                  Add {config.singular}
                </button>
              </>
            ) : null}
          </>
        )}

        {!meta?.noComplete || isParents ? (
          <label className="flex items-center gap-3 rounded-2xl border border-white/80 bg-white px-4 py-3.5 text-sm font-semibold text-slate-800">
            <input type="checkbox" checked={complete} onChange={(event) => setComplete(event.target.checked)} className="h-5 w-5 rounded border-slate-300 text-sky-600 focus:ring-sky-200" />
            I've added everything for this section
          </label>
        ) : null}

        <SaveFooter saving={saving} />
      </form>
    </SheetShell>
  );
}

function AssignmentSheet({ assignment, answers, onClose, onOpenStep, onSubmit, submitting }) {
  const steps = useMemo(() => {
    const unique = new Map();
    assignment.modules.forEach((module) => (module.steps || []).forEach((step) => unique.set(step.id, step)));
    return [...unique.values()];
  }, [assignment]);
  const consultantModules = assignment.modules.filter((module) => !module.steps);
  const allDone = steps.length > 0 && steps.every((step) => step.completed);

  return (
    <SheetShell
      title={assignment.name}
      subtitle={assignment.categoryTitle}
      onClose={onClose}
      footer={
        assignment.submitted ? (
          <p className="flex items-center justify-center gap-2 py-1 text-sm font-semibold text-emerald-700"><CheckCircle2 className="h-4 w-4" />Submitted — your consultant is reviewing your answers</p>
        ) : assignment.locked ? (
          <p className="flex items-center justify-center gap-2 py-1 text-sm font-semibold text-slate-500"><Lock className="h-4 w-4" />Locked by your consultant</p>
        ) : (
          <button
            type="button"
            disabled={!allDone || submitting}
            onClick={onSubmit}
            className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-sky-600 text-sm font-semibold text-white shadow-[0_10px_24px_rgba(2,132,199,0.3)] transition-all duration-200 hover:bg-sky-700 active:scale-[0.98] disabled:opacity-40"
          >
            {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            {allDone ? "Submit questionnaire" : "Complete all sections to submit"}
          </button>
        )
      }
    >
      <div className="space-y-3 pb-2">
        {assignment.dueDate ? <p className="px-1 text-[13px] font-medium text-slate-500">Due {formatPortalDate(assignment.dueDate)}</p> : null}
        {steps.map((step) => {
          const disabled = assignment.locked || assignment.submitted;
          return (
            <button
              key={step.id}
              type="button"
              disabled={disabled}
              onClick={() => onOpenStep(step)}
              className="flex w-full items-center gap-3 rounded-3xl border border-white/80 bg-white p-4 text-left shadow-[0_10px_30px_rgba(28,45,74,0.06)] transition-all duration-200 hover:-translate-y-0.5 active:scale-[0.99] disabled:opacity-70 disabled:hover:translate-y-0"
            >
              <span className={["flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl", step.completed ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"].join(" ")}>
                {step.completed ? <CheckCircle2 className="h-[18px] w-[18px]" /> : <ClipboardList className="h-[18px] w-[18px]" />}
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2">
                  <span className="truncate text-sm font-semibold text-slate-900">{step.label}</span>
                  {step.requirementLevel === "required" ? (
                    <span className="shrink-0 rounded-full bg-rose-50 px-2 py-0.5 text-[10px] font-semibold text-rose-600">Required</span>
                  ) : null}
                </span>
                <span className={["mt-0.5 block text-xs font-medium", step.completed ? "text-emerald-600" : "text-amber-600"].join(" ")}>{step.completed ? "Completed" : "To do"}</span>
              </span>
              {!disabled ? <ChevronRight className="h-4 w-4 shrink-0 text-slate-300" /> : null}
            </button>
          );
        })}
        {consultantModules.length ? (
          <div className="rounded-3xl border border-white/70 bg-white/60 p-4">
            <p className="text-[13px] font-semibold text-slate-700">Handled with your consultant</p>
            <p className="mt-1 text-xs leading-5 text-slate-500">{consultantModules.map((module) => module.name).join(" · ")}</p>
          </div>
        ) : null}
      </div>
    </SheetShell>
  );
}

export default function ClientPortalQuestionnaires() {
  const { overview, refresh } = usePortalData();
  const { showToast } = usePortalToast();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [openAssignmentId, setOpenAssignmentId] = useState(null);
  const [activeStep, setActiveStep] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(({ silent = false } = {}) => {
    if (!silent) setLoading(true);
    return getPortalQuestionnaires()
      .then((result) => { setData(result); setError(""); })
      .catch((reason) => setError(portalErrorMessage(reason, "Your questionnaires could not be loaded.")))
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => { load(); }, [load]);

  const openAssignment = data?.assignments.find((item) => item.id === openAssignmentId) || null;

  function stepInitialValues(step) {
    if (!data) return {};
    return step.type === "flat" ? data.answers.flat[step.id] || {} : data.answers.collections[step.id] || {};
  }

  async function submitAssignment() {
    setSubmitting(true);
    try {
      const result = await submitPortalQuestionnaire(openAssignment.id);
      showToast(result.message || "Questionnaire submitted.");
      await load({ silent: true });
      refresh({ silent: true });
    } catch (reason) {
      showToast(portalErrorMessage(reason, "The questionnaire could not be submitted."), "error");
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) return <ClientPortalSkeleton rows={3} />;

  return (
    <div className="space-y-4">
      <ClientPortalHeader
        title="Forms"
        subtitle={data?.caseType ? `Questionnaires for your ${data.caseType}` : "Your assigned questionnaires"}
        client={overview?.client}
        agency={overview?.agency}
      />

      {error ? (
        <ClientPortalEmptyState
          icon={ClipboardList}
          title="We couldn't load your questionnaires"
          copy={error}
          action={<button type="button" onClick={() => load()} className="mt-5 h-11 rounded-2xl bg-slate-950 px-6 text-sm font-semibold text-white transition active:scale-[0.98]">Try again</button>}
        />
      ) : data?.assignments.length ? (
        <div className="space-y-3">
          {data.assignments.map((assignment) => {
            const percent = assignment.progress.total ? Math.round((assignment.progress.completed / assignment.progress.total) * 100) : 0;
            return (
              <GlassCard key={assignment.id} onClick={() => setOpenAssignmentId(assignment.id)} className="p-5">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">{assignment.categoryTitle || "Questionnaire"}</p>
                    <h2 className="mt-1 truncate text-[16px] font-semibold tracking-tight text-slate-950">{assignment.name}</h2>
                  </div>
                  <span className={[
                    "shrink-0 rounded-full px-2.5 py-1 text-[10px] font-semibold",
                    assignment.submitted ? "bg-emerald-100/90 text-emerald-800" : assignment.locked ? "bg-slate-100 text-slate-500" : "bg-amber-100/90 text-amber-800",
                  ].join(" ")}>
                    {assignment.submitted ? "Submitted" : assignment.locked ? "Locked" : "Action needed"}
                  </span>
                </div>
                <div className="mt-4">
                  <div className="flex items-center justify-between text-xs font-medium text-slate-500">
                    <span>{assignment.progress.completed} of {assignment.progress.total} sections</span>
                    <span className="font-semibold text-slate-800">{percent}%</span>
                  </div>
                  <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-200/70">
                    <div className="h-full rounded-full bg-gradient-to-r from-sky-500 to-indigo-500 transition-[width] duration-500 ease-out" style={{ width: `${percent}%` }} />
                  </div>
                </div>
                {assignment.dueDate ? <p className="mt-3 text-xs text-slate-400">Due {formatPortalDate(assignment.dueDate)}</p> : null}
              </GlassCard>
            );
          })}
        </div>
      ) : (
        <ClientPortalEmptyState
          icon={ClipboardList}
          title="No questionnaires yet"
          copy="When your consultant assigns a questionnaire, it will appear here with everything you need to fill in."
        />
      )}

      {openAssignment && !activeStep ? (
        <AssignmentSheet
          assignment={openAssignment}
          answers={data.answers}
          onClose={() => setOpenAssignmentId(null)}
          onOpenStep={(step) => setActiveStep(step)}
          onSubmit={submitAssignment}
          submitting={submitting}
        />
      ) : null}

      {activeStep && activeStep.type === "flat" ? (
        <FlatStepSheet
          step={activeStep}
          initialValues={stepInitialValues(activeStep)}
          onClose={() => setActiveStep(null)}
          onSaved={async () => {
            setActiveStep(null);
            showToast("Answers saved.");
            await load({ silent: true });
            refresh({ silent: true });
          }}
        />
      ) : null}

      {activeStep && activeStep.type === "collection" ? (
        <CollectionStepSheet
          step={activeStep}
          initialValues={stepInitialValues(activeStep)}
          onClose={() => setActiveStep(null)}
          onSaved={async () => {
            setActiveStep(null);
            showToast("Answers saved.");
            await load({ silent: true });
            refresh({ silent: true });
          }}
        />
      ) : null}
    </div>
  );
}
