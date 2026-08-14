import { CheckCircle2, ChevronRight, ClipboardList, FileSignature, FileText, Loader2, Lock, Plus, Send, Trash2, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import {
  getPortalQuestionnaires,
  savePortalQuestionnaireAnswers,
  submitPortalQuestionnaire,
  getPortalCaseFormRequests,
  submitPortalCaseFormRequest,
  signPortalCaseFormRequest,
  portalErrorMessage,
} from "../../api/clientPortalApi";
import ClientPortalHeader from "../../components/client-portal/ClientPortalHeader";
import ClientPortalSkeleton, { GlassCard } from "../../components/client-portal/ClientPortalSkeleton";
import ClientPortalEmptyState from "../../components/client-portal/ClientPortalEmptyState";
import SignaturePad from "../../components/client-portal/SignaturePad";
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

// A consultant only ever sends the handful of fields still missing on a
// government form — never the whole thing — so this is one short screen,
// not a replica of the source PDF. Plain-language labels come straight
// from the field mapping the consultant confirmed; the client never sees
// raw AcroForm field names or IRCC's own question numbering.
function CaseFormRequestSheet({ request, onClose, onSubmitted }) {
  const [values, setValues] = useState(() => Object.fromEntries(request.fields.map((field) => [field.fieldKey, field.value || ""])));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const answeredCount = request.fields.filter((field) => (values[field.fieldKey] || "").trim()).length;

  async function submit(event) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      await submitPortalCaseFormRequest(request.id, values);
      onSubmitted();
    } catch (reason) {
      setError(portalErrorMessage(reason, "Your answers could not be submitted."));
    } finally {
      setSaving(false);
    }
  }

  return (
    <SheetShell
      title={request.formTitle || "Form details"}
      subtitle={request.formNumber ? `${request.formNumber} · Requested by your consultant` : "Requested by your consultant"}
      onClose={onClose}
      footer={
        <button
          type="submit"
          form="case-form-request"
          disabled={saving || answeredCount < request.fields.length}
          className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-sky-600 text-sm font-semibold text-white shadow-[0_10px_24px_rgba(2,132,199,0.3)] transition-all duration-200 hover:bg-sky-700 active:scale-[0.98] disabled:opacity-40"
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          {answeredCount < request.fields.length ? `Answer all ${request.fields.length} to submit` : "Submit"}
        </button>
      }
    >
      <form id="case-form-request" onSubmit={submit} className="space-y-4 pb-2">
        {request.message ? <p className="rounded-2xl bg-sky-50 px-4 py-3 text-sm leading-5 text-sky-900">{request.message}</p> : null}
        {error ? <p className="rounded-2xl bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</p> : null}
        <div className="space-y-4 rounded-3xl border border-white/80 bg-white p-4">
          {request.fields.map((field) => (
            <label key={field.fieldKey} className="block text-sm font-semibold text-slate-800">
              {field.label}
              {field.helpText ? <span className="mt-0.5 block text-xs font-normal leading-5 text-slate-500">{field.helpText}</span> : null}
              {field.fieldType === "Checkbox" ? (
                <select
                  value={values[field.fieldKey] || ""}
                  onChange={(event) => setValues((current) => ({ ...current, [field.fieldKey]: event.target.value }))}
                  className={inputClass}
                >
                  <option value="">Select</option>
                  <option value="true">Yes</option>
                  <option value="false">No</option>
                </select>
              ) : (
                <input
                  type={field.fieldType === "Date" ? "date" : "text"}
                  value={values[field.fieldKey] || ""}
                  onChange={(event) => setValues((current) => ({ ...current, [field.fieldKey]: event.target.value }))}
                  className={inputClass}
                />
              )}
            </label>
          ))}
        </div>
      </form>
    </SheetShell>
  );
}

function CaseFormSignatureSheet({ request, onClose, onSubmitted }) {
  const [signatureImage, setSignatureImage] = useState("");
  const [signatureStrokes, setSignatureStrokes] = useState([]);
  const [consent, setConsent] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function submit(event) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      await signPortalCaseFormRequest(request.id, { consent, signatureImage, signatureStrokes });
      onSubmitted();
    } catch (reason) {
      setError(portalErrorMessage(reason, "Your signature could not be applied."));
    } finally {
      setSaving(false);
    }
  }

  return (
    <SheetShell
      title={`Sign ${request.formNumber || request.formTitle || "form"}`}
      subtitle="Secure draw-only signature request"
      onClose={onClose}
      footer={
        <button type="submit" form="case-form-signature" disabled={saving || !consent || !signatureImage || !signatureStrokes.length} className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-violet-600 text-sm font-semibold text-white shadow-[0_10px_24px_rgba(124,58,237,0.3)] transition hover:bg-violet-700 active:scale-[0.98] disabled:opacity-40">
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileSignature className="h-4 w-4" />}
          {saving ? "Applying signature…" : "Sign and submit"}
        </button>
      }
    >
      <form id="case-form-signature" onSubmit={submit} className="space-y-4 pb-2">
        {request.message ? <p className="rounded-2xl bg-violet-50 px-4 py-3 text-sm leading-5 text-violet-900">{request.message}</p> : null}
        {error ? <p className="rounded-2xl bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</p> : null}
        <section className="rounded-3xl border border-white/80 bg-white p-4">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">Form declaration</p>
          <p className="mt-2 text-sm leading-6 text-slate-700">I declare that the information in this form is truthful, complete and correct. I understand that I am appointing <strong>{request.representativeName}</strong> (licence {request.representativeLicence}) as my representative.</p>
          <p className="mt-2 text-xs leading-5 text-slate-500">The rest of the form is locked. This screen can only add your drawing to the applicant signature box.</p>
        </section>
        <section className="rounded-3xl border border-white/80 bg-white p-4">
          <p className="mb-2 text-sm font-semibold text-slate-800">Draw {request.applicantName}'s signature</p>
          <SignaturePad disabled={saving} onChange={setSignatureImage} onStrokesChange={setSignatureStrokes} />
        </section>
        <label className="flex items-start gap-3 rounded-2xl border border-white/80 bg-white px-4 py-3.5 text-sm font-medium leading-5 text-slate-800">
          <input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} className="mt-0.5 h-5 w-5 rounded border-slate-300 text-violet-600 focus:ring-violet-200" />
          I confirm this is my signature and I consent to it being applied to this IMM 5476 for submission through an IRCC portal or secure account.
        </label>
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
  const [caseFormRequests, setCaseFormRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [openAssignmentId, setOpenAssignmentId] = useState(null);
  const [activeStep, setActiveStep] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [openRequestId, setOpenRequestId] = useState(null);

  const load = useCallback(({ silent = false } = {}) => {
    if (!silent) setLoading(true);
    return Promise.all([getPortalQuestionnaires(), getPortalCaseFormRequests().catch(() => [])])
      .then(([questionnaires, requests]) => { setData(questionnaires); setCaseFormRequests(requests || []); setError(""); })
      .catch((reason) => setError(portalErrorMessage(reason, "Your questionnaires could not be loaded.")))
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => { load(); }, [load]);
  const openRequest = caseFormRequests.find((request) => request.id === openRequestId) || null;

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

      {caseFormRequests.length ? (
        <div className="space-y-3">
          <p className="px-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">Requested by your consultant</p>
          {caseFormRequests.map((request) => (
            <GlassCard key={request.id} onClick={() => setOpenRequestId(request.id)} className="p-5">
              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 items-start gap-3">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-violet-100 text-violet-700">
                    {request.requestType === "Signature" ? <FileSignature className="h-[18px] w-[18px]" /> : <FileText className="h-[18px] w-[18px]" />}
                  </span>
                  <div className="min-w-0">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">{request.formNumber || "Form"}</p>
                    <h2 className="mt-1 truncate text-[16px] font-semibold tracking-tight text-slate-950">{request.formTitle}</h2>
                    <p className="mt-1 text-xs text-slate-500">{request.requestType === "Signature" ? "Drawn signature needed" : `${request.fields.length} detail${request.fields.length === 1 ? "" : "s"} needed${request.dueAt ? ` · Due ${formatPortalDate(request.dueAt)}` : ""}`}</p>
                  </div>
                </div>
                <span className="shrink-0 rounded-full bg-amber-100/90 px-2.5 py-1 text-[10px] font-semibold text-amber-800">Action needed</span>
              </div>
            </GlassCard>
          ))}
        </div>
      ) : null}

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
      ) : !caseFormRequests.length ? (
        <ClientPortalEmptyState
          icon={ClipboardList}
          title="No questionnaires yet"
          copy="When your consultant assigns a questionnaire, it will appear here with everything you need to fill in."
        />
      ) : null}

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

      {openRequest?.requestType === "Signature" ? (
        <CaseFormSignatureSheet
          request={openRequest}
          onClose={() => setOpenRequestId(null)}
          onSubmitted={async () => {
            setOpenRequestId(null);
            showToast("Signed — your completed IMM 5476 is now with your consultant.");
            await load({ silent: true });
            refresh({ silent: true });
          }}
        />
      ) : openRequest ? (
        <CaseFormRequestSheet
          request={openRequest}
          onClose={() => setOpenRequestId(null)}
          onSubmitted={async () => {
            setOpenRequestId(null);
            showToast("Submitted — your consultant will review it.");
            await load({ silent: true });
            refresh({ silent: true });
          }}
        />
      ) : null}
    </div>
  );
}
