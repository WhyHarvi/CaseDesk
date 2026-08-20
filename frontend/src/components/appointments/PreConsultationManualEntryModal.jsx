import { CheckCircle2, Loader2, X } from "lucide-react";
import { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { saveStaffPreConsultationIntake } from "../../api/preConsultationApi";

const inputClass = "mt-1.5 h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none focus:border-sky-400 focus:ring-4 focus:ring-sky-100";
const textareaClass = "mt-1.5 w-full resize-y rounded-xl border border-slate-200 bg-white p-3 text-sm text-slate-900 outline-none focus:border-sky-400 focus:ring-4 focus:ring-sky-100";
const labelClass = "text-xs font-medium text-slate-600";

function boolText(value, fallback = "false") {
  if (value === true) return "true";
  if (value === false) return "false";
  return fallback;
}

function flattenAnswers(answers = {}) {
  return {
    legalName: answers.identity?.legalName || "",
    dateOfBirth: answers.identity?.dateOfBirth || "",
    citizenship: answers.identity?.citizenship || "",
    currentCountry: answers.identity?.currentCountry || "",
    inCanada: boolText(answers.canadaStatus?.inCanada, "true"),
    firstEntryDate: answers.canadaStatus?.firstEntryDate || "",
    mostRecentEntryDate: answers.canadaStatus?.mostRecentEntryDate || "",
    currentStatus: answers.canadaStatus?.currentStatus || "",
    currentStatusOther: answers.canadaStatus?.currentStatusOther || "",
    statusApprovalDate: answers.canadaStatus?.statusApprovalDate || "",
    statusExpiryDate: answers.canadaStatus?.statusExpiryDate || "",
    hasPendingIrccApplication: boolText(answers.canadaStatus?.hasPendingIrccApplication),
    pendingApplicationType: answers.canadaStatus?.pendingApplicationType || "",
    pendingApplicationSubmittedDate: answers.canadaStatus?.pendingApplicationSubmittedDate || "",
    pendingApplicationStatus: answers.canadaStatus?.pendingApplicationStatus || "",
    studiedInCanada: boolText(answers.study?.studiedInCanada),
    institution: answers.study?.institution || "",
    program: answers.study?.program || "",
    studyProvince: answers.study?.province || "",
    studyStartDate: answers.study?.startDate || "",
    studyCompletionDate: answers.study?.completionDate || "",
    studyCompleted: boolText(answers.study?.completed),
    studyPermitApprovalDate: answers.study?.permitApprovalDate || "",
    studyPermitExpiryDate: answers.study?.permitExpiryDate || "",
    currentStudyStatus: answers.study?.currentStudyStatus || "",
    currentlyWorkingInCanada: boolText(answers.work?.currentlyWorkingInCanada),
    employer: answers.work?.employer || "",
    jobTitle: answers.work?.jobTitle || "",
    workStartDate: answers.work?.startDate || "",
    employmentType: answers.work?.employmentType || "",
    hoursPerWeek: answers.work?.hoursPerWeek || "",
    nocCode: answers.work?.nocCode || "",
    workPermitType: answers.work?.workPermitType || "",
    workPermitApprovalDate: answers.work?.workPermitApprovalDate || "",
    workPermitExpiryDate: answers.work?.workPermitExpiryDate || "",
    canadianExperience: answers.work?.canadianExperience || "",
    foreignWorkExperience: boolText(answers.work?.foreignWorkExperience),
    foreignCountry: answers.work?.foreignCountry || "",
    foreignEmployer: answers.work?.foreignEmployer || "",
    foreignJobTitle: answers.work?.foreignJobTitle || "",
    foreignFrom: answers.work?.foreignFrom || "",
    foreignTo: answers.work?.foreignTo || "",
    hasPreviousApplications: boolText(answers.immigrationHistory?.hasPreviousApplications),
    previousApplicationType: answers.immigrationHistory?.previousApplicationType || "",
    previousApplicationDate: answers.immigrationHistory?.previousApplicationDate || "",
    previousApplicationOutcome: answers.immigrationHistory?.previousApplicationOutcome || "",
    hasPreviousRefusal: boolText(answers.immigrationHistory?.hasPreviousRefusal),
    refusalDate: answers.immigrationHistory?.refusalDate || "",
    refusalReason: answers.immigrationHistory?.refusalReason || "",
    maritalStatus: answers.family?.maritalStatus || "",
    spouseInCanada: boolText(answers.family?.spouseInCanada),
    spouseStatus: answers.family?.spouseStatus || "",
    dependantsCount: String(answers.family?.dependantsCount ?? 0),
    familyPartOfConsultation: boolText(answers.family?.familyPartOfConsultation),
    hasLanguageTest: boolText(answers.language?.hasLanguageTest),
    languageTestType: answers.language?.testType || "",
    languageTestDate: answers.language?.testDate || "",
    listeningScore: answers.language?.listening || "",
    readingScore: answers.language?.reading || "",
    writingScore: answers.language?.writing || "",
    speakingScore: answers.language?.speaking || "",
    hasEca: boolText(answers.language?.hasEca),
    ecaOrganization: answers.language?.ecaOrganization || "",
    ecaDate: answers.language?.ecaDate || "",
    hasDeadline: boolText(answers.urgency?.hasDeadline),
    deadlineType: answers.urgency?.deadlineType || "",
    deadlineDate: answers.urgency?.deadlineDate || "",
    deadlineDetails: answers.urgency?.deadlineDetails || "",
    hasActiveIssue: boolText(answers.urgency?.hasActiveIssue),
    activeIssueDetails: answers.urgency?.activeIssueDetails || "",
    additionalInformation: answers.urgency?.additionalInformation || "",
  };
}

function Field({ label, value, onChange, type = "text", required = false, placeholder = "" }) {
  return <label className={labelClass}>{label}<input className={inputClass} type={type} value={value || ""} required={required} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} /></label>;
}

function Select({ label, value, onChange, options, required = false }) {
  return <label className={labelClass}>{label}<select className={inputClass} value={value || ""} required={required} onChange={(event) => onChange(event.target.value)}><option value="">Select</option>{options.map((item) => <option key={item} value={item}>{item}</option>)}</select></label>;
}

function YesNo({ label, value, onChange }) {
  return <fieldset className="sm:col-span-2"><legend className={labelClass}>{label}</legend><div className="mt-2 flex gap-2">{[["true", "Yes"], ["false", "No"]].map(([item, text]) => <label key={item} className={`cursor-pointer rounded-full border px-3.5 py-2 text-xs font-semibold ${String(value) === item ? "border-slate-950 bg-slate-950 text-white" : "border-slate-200 bg-white text-slate-600"}`}><input className="sr-only" type="radio" checked={String(value) === item} onChange={() => onChange(item)} />{text}</label>)}</div></fieldset>;
}

function TextArea({ label, value, onChange, rows = 3 }) {
  return <label className={`${labelClass} sm:col-span-2`}>{label}<textarea className={textareaClass} rows={rows} value={value || ""} onChange={(event) => onChange(event.target.value)} /></label>;
}

function Section({ title, description, children }) {
  return <section className="rounded-2xl border border-slate-200 bg-slate-50/65 p-4"><div><h3 className="text-sm font-semibold text-slate-900">{title}</h3>{description ? <p className="mt-1 text-xs text-slate-400">{description}</p> : null}</div><div className="mt-4 grid gap-4 sm:grid-cols-2">{children}</div></section>;
}

export default function PreConsultationManualEntryModal({ appointmentId, initialAnswers, onClose, onSaved }) {
  const initialValues = useMemo(() => flattenAnswers(initialAnswers), [initialAnswers]);
  const [values, setValues] = useState(initialValues);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const set = (name) => (value) => setValues((current) => ({ ...current, [name]: value }));
  const yes = (name) => String(values[name]) === "true";

  async function submit(event) {
    event.preventDefault();
    if (!event.currentTarget.reportValidity()) return;
    try {
      setSaving(true);
      setError("");
      await saveStaffPreConsultationIntake(appointmentId, values);
      await onSaved?.();
      onClose();
    } catch (requestError) {
      setError(requestError.response?.data?.message || "The pre-consultation information could not be saved.");
    } finally {
      setSaving(false);
    }
  }

  return createPortal(<div className="fixed inset-0 z-[900] flex items-center justify-center bg-slate-950/35 p-3 backdrop-blur-sm">
    <button type="button" className="absolute inset-0" onClick={() => !saving && onClose()} aria-label="Close manual entry" />
    <div className="relative flex max-h-[94vh] w-full max-w-4xl flex-col overflow-hidden rounded-[1.75rem] border border-white bg-white shadow-2xl">
      <header className="flex items-start justify-between gap-4 border-b border-slate-100 px-5 py-4 sm:px-6">
        <div><p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-violet-600">Staff entry</p><h2 className="mt-1 text-xl font-semibold tracking-tight text-slate-950">Add pre-consultation information manually</h2><p className="mt-1 text-xs leading-5 text-slate-500">Use this when staff receives the information by phone, in person, or another channel.</p></div>
        <button type="button" disabled={saving} onClick={onClose} className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-100 text-slate-500"><X className="h-4 w-4" /></button>
      </header>

      <form onSubmit={submit} className="min-h-0 flex-1 overflow-y-auto p-5 sm:p-6">
        <div className="mb-5 rounded-2xl border border-violet-100 bg-violet-50/70 px-4 py-3 text-xs leading-5 text-violet-800">This is recorded as <strong>staff-entered information</strong>. It does not record or imply that the client completed the online consent checkboxes.</div>
        <div className="space-y-4">
          <Section title="About the client">
            <Field label="Full legal name" value={values.legalName} onChange={set("legalName")} required />
            <Field label="Date of birth" type="date" value={values.dateOfBirth} onChange={set("dateOfBirth")} required />
            <Field label="Citizenship" value={values.citizenship} onChange={set("citizenship")} required />
            <Field label="Current country of residence" value={values.currentCountry} onChange={set("currentCountry")} required />
            <YesNo label="Currently in Canada?" value={values.inCanada} onChange={set("inCanada")} />
            {yes("inCanada") ? <>
              <Field label="First entry into Canada" type="date" value={values.firstEntryDate} onChange={set("firstEntryDate")} />
              <Field label="Most recent entry into Canada" type="date" value={values.mostRecentEntryDate} onChange={set("mostRecentEntryDate")} />
              <Select label="Current immigration status" value={values.currentStatus} onChange={set("currentStatus")} required options={["Visitor", "Study Permit", "Work Permit", "Permanent Resident", "Refugee Claimant", "No Current Status", "Other"]} />
              {values.currentStatus === "Other" ? <Field label="Other status" value={values.currentStatusOther} onChange={set("currentStatusOther")} /> : <div />}
              <Field label="Status approval / issue date" type="date" value={values.statusApprovalDate} onChange={set("statusApprovalDate")} />
              <Field label="Status expiry date" type="date" value={values.statusExpiryDate} onChange={set("statusExpiryDate")} />
            </> : null}
            <YesNo label="Pending IRCC application?" value={values.hasPendingIrccApplication} onChange={set("hasPendingIrccApplication")} />
            {yes("hasPendingIrccApplication") ? <>
              <Field label="Application type" value={values.pendingApplicationType} onChange={set("pendingApplicationType")} />
              <Field label="Submitted date" type="date" value={values.pendingApplicationSubmittedDate} onChange={set("pendingApplicationSubmittedDate")} />
              <Field label="Current application status" value={values.pendingApplicationStatus} onChange={set("pendingApplicationStatus")} />
            </> : null}
          </Section>

          <Section title="Study in Canada">
            <YesNo label="Studied in Canada?" value={values.studiedInCanada} onChange={set("studiedInCanada")} />
            {yes("studiedInCanada") ? <>
              <Field label="Institution" value={values.institution} onChange={set("institution")} />
              <Field label="Program" value={values.program} onChange={set("program")} />
              <Field label="Province" value={values.studyProvince} onChange={set("studyProvince")} />
              <Field label="Program start date" type="date" value={values.studyStartDate} onChange={set("studyStartDate")} />
              <Field label="Completion / expected completion" type="date" value={values.studyCompletionDate} onChange={set("studyCompletionDate")} />
              <YesNo label="Program completed?" value={values.studyCompleted} onChange={set("studyCompleted")} />
              <Field label="Study permit approval date" type="date" value={values.studyPermitApprovalDate} onChange={set("studyPermitApprovalDate")} />
              <Field label="Study permit expiry date" type="date" value={values.studyPermitExpiryDate} onChange={set("studyPermitExpiryDate")} />
              <Field label="Current study status" value={values.currentStudyStatus} onChange={set("currentStudyStatus")} />
            </> : null}
          </Section>

          <Section title="Work history">
            <YesNo label="Currently working in Canada?" value={values.currentlyWorkingInCanada} onChange={set("currentlyWorkingInCanada")} />
            {yes("currentlyWorkingInCanada") ? <>
              <Field label="Employer" value={values.employer} onChange={set("employer")} />
              <Field label="Job title" value={values.jobTitle} onChange={set("jobTitle")} />
              <Field label="Employment start date" type="date" value={values.workStartDate} onChange={set("workStartDate")} />
              <Select label="Employment type" value={values.employmentType} onChange={set("employmentType")} options={["Full-time", "Part-time", "Self-employed", "Other"]} />
              <Field label="Hours per week" type="number" value={values.hoursPerWeek} onChange={set("hoursPerWeek")} />
              <Field label="NOC code" value={values.nocCode} onChange={set("nocCode")} />
              <Select label="Work permit type" value={values.workPermitType} onChange={set("workPermitType")} options={["PGWP", "Open Work Permit", "Spousal Open Work Permit", "LMIA / Employer-specific", "Other"]} />
              <Field label="Work permit approval date" type="date" value={values.workPermitApprovalDate} onChange={set("workPermitApprovalDate")} />
              <Field label="Work permit expiry date" type="date" value={values.workPermitExpiryDate} onChange={set("workPermitExpiryDate")} />
            </> : null}
            <Select label="Total Canadian work experience" value={values.canadianExperience} onChange={set("canadianExperience")} options={["None", "Less than 6 months", "6–11 months", "1 year", "2 years", "3+ years"]} />
            <YesNo label="Work experience outside Canada?" value={values.foreignWorkExperience} onChange={set("foreignWorkExperience")} />
            {yes("foreignWorkExperience") ? <>
              <Field label="Foreign country" value={values.foreignCountry} onChange={set("foreignCountry")} />
              <Field label="Foreign employer" value={values.foreignEmployer} onChange={set("foreignEmployer")} />
              <Field label="Foreign job title" value={values.foreignJobTitle} onChange={set("foreignJobTitle")} />
              <Field label="From" type="date" value={values.foreignFrom} onChange={set("foreignFrom")} />
              <Field label="To" type="date" value={values.foreignTo} onChange={set("foreignTo")} />
            </> : null}
          </Section>

          <Section title="Immigration history">
            <YesNo label="Previously applied to IRCC?" value={values.hasPreviousApplications} onChange={set("hasPreviousApplications")} />
            {yes("hasPreviousApplications") ? <>
              <Field label="Application type" value={values.previousApplicationType} onChange={set("previousApplicationType")} />
              <Field label="Application date" type="date" value={values.previousApplicationDate} onChange={set("previousApplicationDate")} />
              <Select label="Outcome" value={values.previousApplicationOutcome} onChange={set("previousApplicationOutcome")} options={["Approved", "Refused", "Withdrawn", "Pending", "Other"]} />
            </> : null}
            <YesNo label="Any visa, permit, or immigration refusal?" value={values.hasPreviousRefusal} onChange={set("hasPreviousRefusal")} />
            {yes("hasPreviousRefusal") ? <>
              <Field label="Refusal date" type="date" value={values.refusalDate} onChange={set("refusalDate")} />
              <TextArea label="Reason for refusal" value={values.refusalReason} onChange={set("refusalReason")} />
            </> : null}
          </Section>

          <Section title="Family">
            <Select label="Marital status" value={values.maritalStatus} onChange={set("maritalStatus")} options={["Single", "Married", "Common-law", "Separated", "Divorced", "Widowed"]} />
            <Field label="Number of dependant children" type="number" value={values.dependantsCount} onChange={set("dependantsCount")} />
            <YesNo label="Spouse / partner in Canada?" value={values.spouseInCanada} onChange={set("spouseInCanada")} />
            {yes("spouseInCanada") ? <Field label="Spouse / partner status" value={values.spouseStatus} onChange={set("spouseStatus")} /> : null}
            <YesNo label="Family part of this consultation?" value={values.familyPartOfConsultation} onChange={set("familyPartOfConsultation")} />
          </Section>

          <Section title="Language and ECA">
            <YesNo label="Completed a language test?" value={values.hasLanguageTest} onChange={set("hasLanguageTest")} />
            {yes("hasLanguageTest") ? <>
              <Select label="Language test" value={values.languageTestType} onChange={set("languageTestType")} options={["IELTS General", "CELPIP", "TEF", "TCF", "Other"]} />
              <Field label="Test date" type="date" value={values.languageTestDate} onChange={set("languageTestDate")} />
              <Field label="Listening" value={values.listeningScore} onChange={set("listeningScore")} />
              <Field label="Reading" value={values.readingScore} onChange={set("readingScore")} />
              <Field label="Writing" value={values.writingScore} onChange={set("writingScore")} />
              <Field label="Speaking" value={values.speakingScore} onChange={set("speakingScore")} />
            </> : null}
            <YesNo label="Completed an ECA?" value={values.hasEca} onChange={set("hasEca")} />
            {yes("hasEca") ? <>
              <Field label="ECA organization" value={values.ecaOrganization} onChange={set("ecaOrganization")} placeholder="WES, IQAS, ICAS…" />
              <Field label="ECA completion date" type="date" value={values.ecaDate} onChange={set("ecaDate")} />
            </> : null}
          </Section>

          <Section title="Deadlines and urgent issues">
            <YesNo label="Immigration deadline?" value={values.hasDeadline} onChange={set("hasDeadline")} />
            {yes("hasDeadline") ? <>
              <Field label="Deadline type" value={values.deadlineType} onChange={set("deadlineType")} />
              <Field label="Deadline date" type="date" value={values.deadlineDate} onChange={set("deadlineDate")} />
              <TextArea label="Deadline details" value={values.deadlineDetails} onChange={set("deadlineDetails")} />
            </> : null}
            <YesNo label="Active refusal, removal, loss of status, or another urgent issue?" value={values.hasActiveIssue} onChange={set("hasActiveIssue")} />
            {yes("hasActiveIssue") ? <TextArea label="Urgent issue details" value={values.activeIssueDetails} onChange={set("activeIssueDetails")} rows={4} /> : null}
            <TextArea label="Anything else the consultant should know?" value={values.additionalInformation} onChange={set("additionalInformation")} rows={4} />
          </Section>
        </div>

        {error ? <p className="mt-4 rounded-2xl bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</p> : null}
        <div className="sticky bottom-0 mt-5 flex justify-end gap-2 border-t border-slate-100 bg-white/95 py-4 backdrop-blur">
          <button type="button" disabled={saving} onClick={onClose} className="rounded-full border border-slate-200 bg-white px-4 py-2.5 text-xs font-semibold text-slate-600">Cancel</button>
          <button type="submit" disabled={saving} className="inline-flex items-center gap-2 rounded-full bg-slate-950 px-5 py-2.5 text-xs font-semibold text-white disabled:opacity-50">{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}{saving ? "Saving…" : "Save information"}</button>
        </div>
      </form>
    </div>
  </div>, document.body);
}
