import { ArrowRight, CheckCircle2, X } from "lucide-react";
import { useEffect, useState } from "react";
import CaseTypeCombobox from "../../../components/ui/CaseTypeCombobox";
import StudyIntakeSelect from "../../../components/cases/StudyIntakeSelect";
import api from "../../../services/api";
import { caseStagesForType } from "../../../constants/caseStages";
import { isStudyPermitCaseType, stageRequiresStudyIntake, studyIntakeApiValue } from "../../../utils/studyIntake";
import { leadName } from "../leadPresentation";

const fieldClass = "mt-1.5 h-11 w-full rounded-xl border border-slate-200 bg-white px-3.5 text-sm text-slate-900 outline-none transition focus:border-brand-400 focus:ring-4 focus:ring-brand-100";

export default function ConvertLeadSheet({ lead, onClose, onConverted }) {
  const initialCaseType = String(lead.immigrationInterest || "").trim();
  const [form, setForm] = useState({
    fullName: leadName(lead) === "Unnamed lead" ? "" : leadName(lead),
    caseType: initialCaseType,
    // A converted lead has already been through Lead/Consultation/Retainer —
    // the real next step is gathering intake documents, so that's the
    // sensible default rather than restarting the pipeline from the top.
    caseStage: "Documents Pending",
    caseNextAction: "Complete client intake and collect initial documents",
    studyIntakeMonth: "",
    actualValue: lead.estimatedValue || "",
    notes: "",
  });
  const [caseTypeOptions, setCaseTypeOptions] = useState(initialCaseType ? [initialCaseType] : []);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    api.get("/cases/case-types")
      .then((response) => {
        if (!active) return;
        const options = [...(response.data.data || []), initialCaseType].filter(Boolean);
        const unique = new Map(options.map((option) => [String(option).trim().toLowerCase(), String(option).trim()]));
        setCaseTypeOptions([...unique.values()].sort((left, right) => left.localeCompare(right)));
      })
      .catch(() => {
        // Keep the lead's existing immigration interest usable when the
        // suggestions endpoint is temporarily unavailable.
      });
    return () => { active = false; };
  }, [initialCaseType]);

  const update = (event) => setForm((current) => {
    const next = {
      ...current,
      [event.target.name]: event.target.value,
      ...(event.target.name === "caseType" && !isStudyPermitCaseType(event.target.value) ? { studyIntakeMonth: "" } : {}),
    };
    if (
      event.target.name === "caseType" &&
      !caseStagesForType(event.target.value).includes(current.caseStage)
    ) {
      next.caseStage = "Retainer Pending";
    }
    return next;
  });
  const submit = async (event) => {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      const payload = {
        ...form,
        studyIntakeMonth: isStudyPermitCaseType(form.caseType) ? studyIntakeApiValue(form.studyIntakeMonth) : null,
        actualValue: form.actualValue === "" ? null : Number(form.actualValue),
      };
      const response = await api.post(`/leads/${lead.id}/convert`, payload, { timeout: 25_000 });
      onConverted(response.data.data);
    } catch (requestError) {
      setError(requestError.response?.data?.message || "The lead could not be converted.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[180] flex items-center justify-center bg-slate-950/25 p-4 backdrop-blur-md" role="dialog" aria-modal="true" aria-labelledby="convert-lead-title">
      <button type="button" className="absolute inset-0" onClick={onClose} aria-label="Close conversion form" />
      <form onSubmit={submit} className="relative flex max-h-[calc(100vh-2rem)] w-full max-w-xl flex-col overflow-hidden rounded-[28px] border border-white/80 bg-[#f7f9fb] shadow-[0_30px_100px_rgba(15,23,42,0.28)]">
        <header className="flex items-start justify-between border-b border-slate-200/70 bg-white px-6 py-5">
          <div><div className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-600 text-white"><CheckCircle2 className="h-5 w-5" /></div><h2 id="convert-lead-title" className="text-xl font-semibold tracking-tight text-slate-950">Convert to client</h2><p className="mt-1 text-sm text-slate-500">Create one linked client and case from {lead.leadNumber}.</p></div>
          <button type="button" onClick={onClose} className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-100 text-slate-500 hover:bg-slate-200"><X className="h-4 w-4" /></button>
        </header>

        <div className="min-h-0 overflow-y-auto p-6">
          <div className="mb-5 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm leading-6 text-emerald-800">This closes the lead, cancels its open follow-ups, and creates the first case action. The operation is completed as one transaction.</div>
          {error ? <div className="mb-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div> : null}
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="sm:col-span-2 text-sm font-medium text-slate-700">Client name<input required name="fullName" value={form.fullName} onChange={update} className={fieldClass} /></label>
            <label className="text-sm font-medium text-slate-700">
              Case type
              <div className="mt-1.5">
                <CaseTypeCombobox
                  required
                  name="caseType"
                  value={form.caseType}
                  onChange={update}
                  options={caseTypeOptions}
                  placeholder="Select or search case type"
                />
              </div>
            </label>
            <label className="text-sm font-medium text-slate-700">Starting stage<select required name="caseStage" value={form.caseStage} onChange={update} className={fieldClass}>{caseStagesForType(form.caseType).filter((stage) => stage !== "Closed").map((stage) => <option key={stage} value={stage}>{stage}</option>)}</select></label>
            {isStudyPermitCaseType(form.caseType) ? (
              <label className="sm:col-span-2 text-sm font-medium text-slate-700">
                Academic intake
                <StudyIntakeSelect
                  required={stageRequiresStudyIntake(form.caseStage)}
                  value={form.studyIntakeMonth}
                  onChange={update}
                  className={fieldClass}
                />
                <span className="mt-1.5 block text-xs font-normal text-slate-500">Required because converted leads begin at Documents Pending.</span>
              </label>
            ) : null}
            <label className="sm:col-span-2 text-sm font-medium text-slate-700">First case action<input required name="caseNextAction" value={form.caseNextAction} onChange={update} className={fieldClass} /></label>
            <label className="text-sm font-medium text-slate-700">Actual value (CAD)<input name="actualValue" type="number" min="0" step="0.01" value={form.actualValue} onChange={update} className={fieldClass} /></label>
            <label className="sm:col-span-2 text-sm font-medium text-slate-700">Conversion note<textarea name="notes" value={form.notes} onChange={update} rows="3" className="mt-1.5 w-full resize-none rounded-xl border border-slate-200 bg-white px-3.5 py-3 text-sm text-slate-900 outline-none transition focus:border-brand-400 focus:ring-4 focus:ring-brand-100" /></label>
          </div>
        </div>

        <footer className="flex items-center justify-between border-t border-slate-200 bg-white px-6 py-4"><p className="text-xs text-slate-400">This action cannot be repeated.</p><div className="flex gap-3"><button type="button" onClick={onClose} className="h-10 rounded-full px-5 text-sm font-semibold text-slate-600 hover:bg-slate-100">Cancel</button><button disabled={saving} className="inline-flex h-10 items-center gap-2 rounded-full bg-emerald-600 px-5 text-sm font-semibold text-white shadow-sm hover:bg-emerald-700 disabled:opacity-50">{saving ? "Converting…" : "Convert lead"}<ArrowRight className="h-4 w-4" /></button></div></footer>
      </form>
    </div>
  );
}
