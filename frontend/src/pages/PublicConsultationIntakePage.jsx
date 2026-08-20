import { ArrowLeft, ArrowRight, CheckCircle2, LoaderCircle, LockKeyhole } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import api from "../services/api";

const inputClass = "mt-1.5 h-11 w-full rounded-xl border border-slate-200 bg-white px-3.5 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-sky-400 focus:ring-4 focus:ring-sky-100";
const textareaClass = "mt-1.5 w-full resize-y rounded-xl border border-slate-200 bg-white p-3.5 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-sky-400 focus:ring-4 focus:ring-sky-100";
const labelClass = "text-xs font-medium text-slate-600";
const sectionClass = "rounded-2xl border border-slate-200/80 bg-slate-50/70 p-4 sm:p-5";

function YesNo({ name, value, onChange, label }) {
  return <fieldset className="sm:col-span-2"><legend className={labelClass}>{label}</legend><div className="mt-2 flex gap-2">{[["true", "Yes"], ["false", "No"]].map(([option, text]) => <label key={option} className={`cursor-pointer rounded-full border px-4 py-2 text-xs font-semibold transition ${String(value) === option ? "border-slate-950 bg-slate-950 text-white" : "border-slate-200 bg-white text-slate-600 hover:border-slate-300"}`}><input className="sr-only" type="radio" name={name} value={option} checked={String(value) === option} onChange={(event) => onChange(event.target.value)} />{text}</label>)}</div></fieldset>;
}

function Field({ label, name, type = "text", value, onChange, required = false, placeholder = "", children }) {
  return <label className={labelClass}>{label}{children || <input className={inputClass} name={name} type={type} value={value || ""} onChange={(event) => onChange(event.target.value)} required={required} placeholder={placeholder} />}</label>;
}

function SelectField({ label, name, value, onChange, options, required = false }) {
  return <label className={labelClass}>{label}<select className={inputClass} name={name} value={value || ""} onChange={(event) => onChange(event.target.value)} required={required}><option value="">Select</option>{options.map((option) => <option key={option} value={option}>{option}</option>)}</select></label>;
}

const initial = {
  legalName: "", dateOfBirth: "", citizenship: "", currentCountry: "", inCanada: "true",
  firstEntryDate: "", mostRecentEntryDate: "", currentStatus: "", currentStatusOther: "", statusApprovalDate: "", statusExpiryDate: "",
  hasPendingIrccApplication: "false", pendingApplicationType: "", pendingApplicationSubmittedDate: "", pendingApplicationStatus: "",
  studiedInCanada: "false", institution: "", program: "", studyProvince: "", studyStartDate: "", studyCompletionDate: "", studyCompleted: "false", studyPermitApprovalDate: "", studyPermitExpiryDate: "", currentStudyStatus: "",
  currentlyWorkingInCanada: "false", employer: "", jobTitle: "", workStartDate: "", employmentType: "", hoursPerWeek: "", nocCode: "", workPermitType: "", workPermitApprovalDate: "", workPermitExpiryDate: "", canadianExperience: "",
  foreignWorkExperience: "false", foreignCountry: "", foreignEmployer: "", foreignJobTitle: "", foreignFrom: "", foreignTo: "",
  hasPreviousApplications: "false", previousApplicationType: "", previousApplicationDate: "", previousApplicationOutcome: "", hasPreviousRefusal: "false", refusalDate: "", refusalReason: "",
  maritalStatus: "", spouseInCanada: "false", spouseStatus: "", dependantsCount: "0", familyPartOfConsultation: "false",
  hasLanguageTest: "false", languageTestType: "", languageTestDate: "", listeningScore: "", readingScore: "", writingScore: "", speakingScore: "", hasEca: "false", ecaOrganization: "", ecaDate: "",
  hasDeadline: "false", deadlineType: "", deadlineDate: "", deadlineDetails: "", hasActiveIssue: "false", activeIssueDetails: "", additionalInformation: "", accuracyConfirmed: false, consent: false,
};

export default function PublicConsultationIntakePage() {
  const params = useParams();
  const manageToken = params.publicToken || params.manageToken;
  const [info, setInfo] = useState(null);
  const [values, setValues] = useState(initial);
  const [step, setStep] = useState(0);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);
  const steps = ["About you", "Study & work", "History", "Review"];

  useEffect(() => {
    api.get(`/public/booking/consultation-intake/${manageToken}`)
      .then((response) => {
        const data = response.data.data;
        setInfo(data);
        setSent(data.status === "Submitted");
        setValues((current) => ({ ...current, legalName: data.contact?.name || current.legalName }));
      })
      .catch((requestError) => setError(requestError.response?.data?.message || "This questionnaire is not available."))
      .finally(() => setLoading(false));
  }, [manageToken]);

  const appointmentText = useMemo(() => {
    if (!info?.appointment?.startsAt) return "";
    return new Date(info.appointment.startsAt).toLocaleString("en-CA", { timeZone: info.appointment.timezone, weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  }, [info]);

  const set = (name) => (value) => setValues((current) => ({ ...current, [name]: value }));
  const yes = (name) => String(values[name]) === "true";

  function next(event) {
    event?.preventDefault();
    const form = event?.currentTarget;
    if (form && !form.reportValidity()) return;
    setError("");
    setStep((current) => Math.min(current + 1, steps.length - 1));
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function submit(event) {
    event.preventDefault();
    if (!event.currentTarget.reportValidity()) return;
    setSending(true); setError("");
    try {
      await api.post(`/public/booking/consultation-intake/${manageToken}`, values);
      setSent(true);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (requestError) {
      setError(requestError.response?.data?.message || "Your information could not be submitted. Please try again.");
    } finally { setSending(false); }
  }

  if (loading) return <main className="flex min-h-screen items-center justify-center bg-slate-50"><LoaderCircle className="h-6 w-6 animate-spin text-slate-400" /></main>;
  if (!info) return <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4"><div className="max-w-md rounded-3xl border border-slate-200 bg-white p-8 text-center shadow-sm"><h1 className="text-xl font-semibold text-slate-950">Questionnaire unavailable</h1><p className="mt-2 text-sm leading-6 text-slate-500">{error}</p></div></main>;
  if (sent) return <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4"><div className="w-full max-w-lg rounded-3xl border border-slate-200 bg-white p-8 text-center shadow-sm sm:p-10"><div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-emerald-50 text-emerald-600"><CheckCircle2 className="h-7 w-7" /></div><h1 className="mt-5 text-2xl font-semibold tracking-tight text-slate-950">Information received</h1><p className="mt-3 text-sm leading-6 text-slate-500">Thank you. Your consultation team can now review this information before your appointment.</p><div className="mt-5 rounded-2xl bg-slate-50 px-4 py-3 text-sm font-medium text-slate-700">{appointmentText}</div></div></main>;

  return <main className="min-h-screen bg-slate-50 px-4 py-7 sm:py-10"><div className="mx-auto max-w-3xl">
    <header className="mb-6"><div className="flex items-center gap-3">{info.agency.logoUrl ? <img src={info.agency.logoUrl} alt="" className="h-11 w-11 rounded-xl object-cover" /> : <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-slate-950 text-sm font-bold text-white">{info.agency.name?.charAt(0)}</div>}<div><p className="text-sm font-semibold text-slate-950">{info.agency.name}</p><p className="text-xs text-slate-500">{appointmentText}</p></div></div><h1 className="mt-6 text-3xl font-semibold tracking-[-0.035em] text-slate-950">Help us prepare for your consultation</h1><p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500">Tell us about your immigration status, study and work history, and important deadlines. You do not need to upload documents here.</p></header>

    <div className="mb-5 grid grid-cols-4 gap-2">{steps.map((item, index) => <div key={item}><div className={`h-1.5 rounded-full ${index <= step ? "bg-slate-950" : "bg-slate-200"}`} /><p className={`mt-2 hidden text-[11px] font-medium sm:block ${index === step ? "text-slate-950" : "text-slate-400"}`}>{index + 1}. {item}</p></div>)}</div>

    <form onSubmit={step === steps.length - 1 ? submit : next} className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7">
      {step === 0 ? <div className="space-y-5"><div><h2 className="text-lg font-semibold text-slate-950">About you</h2><p className="mt-1 text-xs leading-5 text-slate-500">Use your legal information where possible.</p></div><div className="grid gap-4 sm:grid-cols-2"><Field label="Full legal name" value={values.legalName} onChange={set("legalName")} required /><Field label="Date of birth" type="date" value={values.dateOfBirth} onChange={set("dateOfBirth")} required /><Field label="Citizenship" value={values.citizenship} onChange={set("citizenship")} required /><Field label="Current country of residence" value={values.currentCountry} onChange={set("currentCountry")} required /><YesNo name="inCanada" value={values.inCanada} onChange={set("inCanada")} label="Are you currently in Canada?" />
        {yes("inCanada") ? <><Field label="First entry into Canada" type="date" value={values.firstEntryDate} onChange={set("firstEntryDate")} /><Field label="Most recent entry into Canada" type="date" value={values.mostRecentEntryDate} onChange={set("mostRecentEntryDate")} /><SelectField label="Current immigration status" value={values.currentStatus} onChange={set("currentStatus")} required options={["Visitor", "Study Permit", "Work Permit", "Permanent Resident", "Refugee Claimant", "No Current Status", "Other"]} />{values.currentStatus === "Other" ? <Field label="Other status" value={values.currentStatusOther} onChange={set("currentStatusOther")} /> : <div />}<Field label="Permit/status approval or issue date" type="date" value={values.statusApprovalDate} onChange={set("statusApprovalDate")} /><Field label="Permit/status expiry date" type="date" value={values.statusExpiryDate} onChange={set("statusExpiryDate")} /></> : null}
      </div><div className={sectionClass}><div className="grid gap-4 sm:grid-cols-2"><YesNo name="hasPendingIrccApplication" value={values.hasPendingIrccApplication} onChange={set("hasPendingIrccApplication")} label="Do you currently have an application pending with IRCC?" />{yes("hasPendingIrccApplication") ? <><Field label="Application type" value={values.pendingApplicationType} onChange={set("pendingApplicationType")} /><Field label="Submitted date" type="date" value={values.pendingApplicationSubmittedDate} onChange={set("pendingApplicationSubmittedDate")} /><Field label="Current application status" value={values.pendingApplicationStatus} onChange={set("pendingApplicationStatus")} /></> : null}</div></div></div> : null}

      {step === 1 ? <div className="space-y-5"><div><h2 className="text-lg font-semibold text-slate-950">Study & work</h2><p className="mt-1 text-xs leading-5 text-slate-500">Only relevant questions appear based on your answers.</p></div><div className={sectionClass}><div className="grid gap-4 sm:grid-cols-2"><YesNo name="studiedInCanada" value={values.studiedInCanada} onChange={set("studiedInCanada")} label="Have you studied in Canada?" />{yes("studiedInCanada") ? <><Field label="Institution" value={values.institution} onChange={set("institution")} /><Field label="Program" value={values.program} onChange={set("program")} /><Field label="Province" value={values.studyProvince} onChange={set("studyProvince")} /><Field label="Program start date" type="date" value={values.studyStartDate} onChange={set("studyStartDate")} /><Field label="Completion / expected completion" type="date" value={values.studyCompletionDate} onChange={set("studyCompletionDate")} /><YesNo name="studyCompleted" value={values.studyCompleted} onChange={set("studyCompleted")} label="Did you complete the program?" /><Field label="Study permit approval date" type="date" value={values.studyPermitApprovalDate} onChange={set("studyPermitApprovalDate")} /><Field label="Study permit expiry date" type="date" value={values.studyPermitExpiryDate} onChange={set("studyPermitExpiryDate")} /><Field label="Current study status" value={values.currentStudyStatus} onChange={set("currentStudyStatus")} /></> : null}</div></div>
      <div className={sectionClass}><div className="grid gap-4 sm:grid-cols-2"><YesNo name="currentlyWorkingInCanada" value={values.currentlyWorkingInCanada} onChange={set("currentlyWorkingInCanada")} label="Are you currently working in Canada?" />{yes("currentlyWorkingInCanada") ? <><Field label="Employer" value={values.employer} onChange={set("employer")} /><Field label="Job title" value={values.jobTitle} onChange={set("jobTitle")} /><Field label="Employment start date" type="date" value={values.workStartDate} onChange={set("workStartDate")} /><SelectField label="Employment type" value={values.employmentType} onChange={set("employmentType")} options={["Full-time", "Part-time", "Self-employed", "Other"]} /><Field label="Hours per week" type="number" value={values.hoursPerWeek} onChange={set("hoursPerWeek")} /><Field label="NOC code, if known" value={values.nocCode} onChange={set("nocCode")} /><SelectField label="Work permit type" value={values.workPermitType} onChange={set("workPermitType")} options={["PGWP", "Open Work Permit", "Spousal Open Work Permit", "LMIA / Employer-specific", "Other"]} /><Field label="Work permit approval date" type="date" value={values.workPermitApprovalDate} onChange={set("workPermitApprovalDate")} /><Field label="Work permit expiry date" type="date" value={values.workPermitExpiryDate} onChange={set("workPermitExpiryDate")} /></> : null}<SelectField label="Total Canadian work experience" value={values.canadianExperience} onChange={set("canadianExperience")} options={["None", "Less than 6 months", "6–11 months", "1 year", "2 years", "3+ years"]} /></div></div>
      <div className={sectionClass}><div className="grid gap-4 sm:grid-cols-2"><YesNo name="foreignWorkExperience" value={values.foreignWorkExperience} onChange={set("foreignWorkExperience")} label="Do you have work experience outside Canada?" />{yes("foreignWorkExperience") ? <><Field label="Country" value={values.foreignCountry} onChange={set("foreignCountry")} /><Field label="Employer" value={values.foreignEmployer} onChange={set("foreignEmployer")} /><Field label="Job title" value={values.foreignJobTitle} onChange={set("foreignJobTitle")} /><Field label="From" type="date" value={values.foreignFrom} onChange={set("foreignFrom")} /><Field label="To" type="date" value={values.foreignTo} onChange={set("foreignTo")} /></> : null}</div></div></div> : null}

      {step === 2 ? <div className="space-y-5"><div><h2 className="text-lg font-semibold text-slate-950">Immigration history</h2><p className="mt-1 text-xs leading-5 text-slate-500">These details help the consultant spot issues before the meeting.</p></div><div className={sectionClass}><div className="grid gap-4 sm:grid-cols-2"><YesNo name="hasPreviousApplications" value={values.hasPreviousApplications} onChange={set("hasPreviousApplications")} label="Have you previously applied to IRCC?" />{yes("hasPreviousApplications") ? <><Field label="Application type" value={values.previousApplicationType} onChange={set("previousApplicationType")} /><Field label="Application date" type="date" value={values.previousApplicationDate} onChange={set("previousApplicationDate")} /><SelectField label="Outcome" value={values.previousApplicationOutcome} onChange={set("previousApplicationOutcome")} options={["Approved", "Refused", "Withdrawn", "Pending", "Other"]} /></> : null}<YesNo name="hasPreviousRefusal" value={values.hasPreviousRefusal} onChange={set("hasPreviousRefusal")} label="Have you ever had a visa, permit, or immigration application refused?" />{yes("hasPreviousRefusal") ? <><Field label="Refusal date" type="date" value={values.refusalDate} onChange={set("refusalDate")} /><label className={`${labelClass} sm:col-span-2`}>Reason for refusal, if known<textarea className={textareaClass} rows="3" value={values.refusalReason} onChange={(event) => set("refusalReason")(event.target.value)} /></label></> : null}</div></div>
      <div className={sectionClass}><div className="grid gap-4 sm:grid-cols-2"><SelectField label="Marital status" value={values.maritalStatus} onChange={set("maritalStatus")} options={["Single", "Married", "Common-law", "Separated", "Divorced", "Widowed"]} /><Field label="Number of dependant children" type="number" value={values.dependantsCount} onChange={set("dependantsCount")} /><YesNo name="spouseInCanada" value={values.spouseInCanada} onChange={set("spouseInCanada")} label="Is your spouse or partner in Canada?" />{yes("spouseInCanada") ? <Field label="Spouse/partner immigration status" value={values.spouseStatus} onChange={set("spouseStatus")} /> : null}<YesNo name="familyPartOfConsultation" value={values.familyPartOfConsultation} onChange={set("familyPartOfConsultation")} label="Is your spouse or family part of what you want help with?" /></div></div>
      <div className={sectionClass}><div className="grid gap-4 sm:grid-cols-2"><YesNo name="hasLanguageTest" value={values.hasLanguageTest} onChange={set("hasLanguageTest")} label="Have you completed a language test?" />{yes("hasLanguageTest") ? <><SelectField label="Test" value={values.languageTestType} onChange={set("languageTestType")} options={["IELTS General", "CELPIP", "TEF", "TCF", "Other"]} /><Field label="Test date" type="date" value={values.languageTestDate} onChange={set("languageTestDate")} /><Field label="Listening" value={values.listeningScore} onChange={set("listeningScore")} /><Field label="Reading" value={values.readingScore} onChange={set("readingScore")} /><Field label="Writing" value={values.writingScore} onChange={set("writingScore")} /><Field label="Speaking" value={values.speakingScore} onChange={set("speakingScore")} /></> : null}<YesNo name="hasEca" value={values.hasEca} onChange={set("hasEca")} label="Have you completed an ECA for education outside Canada?" />{yes("hasEca") ? <><Field label="ECA organization" value={values.ecaOrganization} onChange={set("ecaOrganization")} placeholder="WES, IQAS, ICAS…" /><Field label="ECA completion date" type="date" value={values.ecaDate} onChange={set("ecaDate")} /></> : null}</div></div></div> : null}

      {step === 3 ? <div className="space-y-5"><div><h2 className="text-lg font-semibold text-slate-950">Deadlines & final details</h2><p className="mt-1 text-xs leading-5 text-slate-500">Flag anything that the consultant should review before your appointment.</p></div><div className={sectionClass}><div className="grid gap-4 sm:grid-cols-2"><YesNo name="hasDeadline" value={values.hasDeadline} onChange={set("hasDeadline")} label="Do you have an immigration deadline we should know about?" />{yes("hasDeadline") ? <><Field label="Deadline type" value={values.deadlineType} onChange={set("deadlineType")} /><Field label="Deadline date" type="date" value={values.deadlineDate} onChange={set("deadlineDate")} /><label className={`${labelClass} sm:col-span-2`}>Deadline details<textarea className={textareaClass} rows="3" value={values.deadlineDetails} onChange={(event) => set("deadlineDetails")(event.target.value)} /></label></> : null}<YesNo name="hasActiveIssue" value={values.hasActiveIssue} onChange={set("hasActiveIssue")} label="Do you have a refusal, removal order, loss of status, or another urgent immigration issue?" />{yes("hasActiveIssue") ? <label className={`${labelClass} sm:col-span-2`}>Tell us what is happening<textarea className={textareaClass} rows="4" value={values.activeIssueDetails} onChange={(event) => set("activeIssueDetails")(event.target.value)} /></label> : null}<label className={`${labelClass} sm:col-span-2`}>Anything else the consultant should know?<textarea className={textareaClass} rows="5" value={values.additionalInformation} onChange={(event) => set("additionalInformation")(event.target.value)} /></label></div></div>
      <div className="space-y-3"><label className="flex items-start gap-3 rounded-2xl border border-slate-200 p-4 text-xs leading-5 text-slate-600"><input type="checkbox" checked={values.accuracyConfirmed} onChange={(event) => set("accuracyConfirmed")(event.target.checked)} required className="mt-0.5 h-4 w-4 rounded border-slate-300" /><span>I confirm that the information I provided is accurate to the best of my knowledge.</span></label><label className="flex items-start gap-3 rounded-2xl border border-slate-200 p-4 text-xs leading-5 text-slate-600"><input type="checkbox" checked={values.consent} onChange={(event) => set("consent")(event.target.checked)} required className="mt-0.5 h-4 w-4 rounded border-slate-300" /><span>I consent to {info.agency.name} storing and using this information to prepare for my consultation and provide immigration services.</span></label></div></div> : null}

      {error ? <p className="mt-5 rounded-2xl bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</p> : null}
      <div className="mt-7 flex items-center justify-between gap-3">{step > 0 ? <button type="button" onClick={() => { setError(""); setStep((current) => current - 1); }} className="inline-flex h-11 items-center gap-2 rounded-full border border-slate-200 px-5 text-sm font-semibold text-slate-700 hover:bg-slate-50"><ArrowLeft className="h-4 w-4" />Back</button> : <span />}<button type="submit" disabled={sending} className="inline-flex h-11 items-center gap-2 rounded-full bg-slate-950 px-6 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:bg-slate-400">{sending ? <><LoaderCircle className="h-4 w-4 animate-spin" />Submitting…</> : step === steps.length - 1 ? <>Submit securely<CheckCircle2 className="h-4 w-4" /></> : <>Continue<ArrowRight className="h-4 w-4" /></>}</button></div>
      <p className="mt-5 flex items-center justify-center gap-1.5 text-[11px] text-slate-400"><LockKeyhole className="h-3 w-3" />Secure pre-consultation intake · No document uploads</p>
    </form>
  </div></main>;
}
