import { CheckCircle2, LoaderCircle, Save } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import api from "../services/api";

const inputClass = "mt-1.5 h-11 w-full rounded-xl border border-slate-200 bg-white px-3.5 text-sm text-slate-900 outline-none transition focus:border-sky-400 focus:ring-4 focus:ring-sky-100";
const textareaClass = "mt-1.5 w-full resize-y rounded-xl border border-slate-200 bg-white p-3.5 text-sm text-slate-900 outline-none transition focus:border-sky-400 focus:ring-4 focus:ring-sky-100";
const labelClass = "text-xs font-medium text-slate-600";
const sectionClass = "rounded-2xl border border-slate-200 bg-white p-5 shadow-sm";

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
  hasDeadline: "false", deadlineType: "", deadlineDate: "", deadlineDetails: "", hasActiveIssue: "false", activeIssueDetails: "", additionalInformation: "",
};

const tf = (value) => value ? "true" : "false";
const date = (value) => value ? String(value).slice(0, 10) : "";

function flattenAnswers(answers, contact) {
  if (!answers) return { ...initial, legalName: contact?.name || "" };
  return {
    ...initial,
    legalName: answers.identity?.legalName || contact?.name || "",
    dateOfBirth: date(answers.identity?.dateOfBirth),
    citizenship: answers.identity?.citizenship || "",
    currentCountry: answers.identity?.currentCountry || "",
    inCanada: tf(answers.canadaStatus?.inCanada),
    firstEntryDate: date(answers.canadaStatus?.firstEntryDate),
    mostRecentEntryDate: date(answers.canadaStatus?.mostRecentEntryDate),
    currentStatus: answers.canadaStatus?.currentStatus || "",
    currentStatusOther: answers.canadaStatus?.currentStatusOther || "",
    statusApprovalDate: date(answers.canadaStatus?.statusApprovalDate),
    statusExpiryDate: date(answers.canadaStatus?.statusExpiryDate),
    hasPendingIrccApplication: tf(answers.canadaStatus?.hasPendingIrccApplication),
    pendingApplicationType: answers.canadaStatus?.pendingApplicationType || "",
    pendingApplicationSubmittedDate: date(answers.canadaStatus?.pendingApplicationSubmittedDate),
    pendingApplicationStatus: answers.canadaStatus?.pendingApplicationStatus || "",
    studiedInCanada: tf(answers.study?.studiedInCanada),
    institution: answers.study?.institution || "",
    program: answers.study?.program || "",
    studyProvince: answers.study?.province || "",
    studyStartDate: date(answers.study?.startDate),
    studyCompletionDate: date(answers.study?.completionDate),
    studyCompleted: tf(answers.study?.completed),
    studyPermitApprovalDate: date(answers.study?.permitApprovalDate),
    studyPermitExpiryDate: date(answers.study?.permitExpiryDate),
    currentStudyStatus: answers.study?.currentStudyStatus || "",
    currentlyWorkingInCanada: tf(answers.work?.currentlyWorkingInCanada),
    employer: answers.work?.employer || "",
    jobTitle: answers.work?.jobTitle || "",
    workStartDate: date(answers.work?.startDate),
    employmentType: answers.work?.employmentType || "",
    hoursPerWeek: answers.work?.hoursPerWeek || "",
    nocCode: answers.work?.nocCode || "",
    workPermitType: answers.work?.workPermitType || "",
    workPermitApprovalDate: date(answers.work?.workPermitApprovalDate),
    workPermitExpiryDate: date(answers.work?.workPermitExpiryDate),
    canadianExperience: answers.work?.canadianExperience || "",
    foreignWorkExperience: tf(answers.work?.foreignWorkExperience),
    foreignCountry: answers.work?.foreignCountry || "",
    foreignEmployer: answers.work?.foreignEmployer || "",
    foreignJobTitle: answers.work?.foreignJobTitle || "",
    foreignFrom: date(answers.work?.foreignFrom),
    foreignTo: date(answers.work?.foreignTo),
    hasPreviousApplications: tf(answers.immigrationHistory?.hasPreviousApplications),
    previousApplicationType: answers.immigrationHistory?.previousApplicationType || "",
    previousApplicationDate: date(answers.immigrationHistory?.previousApplicationDate),
    previousApplicationOutcome: answers.immigrationHistory?.previousApplicationOutcome || "",
    hasPreviousRefusal: tf(answers.immigrationHistory?.hasPreviousRefusal),
    refusalDate: date(answers.immigrationHistory?.refusalDate),
    refusalReason: answers.immigrationHistory?.refusalReason || "",
    maritalStatus: answers.family?.maritalStatus || "",
    spouseInCanada: tf(answers.family?.spouseInCanada),
    spouseStatus: answers.family?.spouseStatus || "",
    dependantsCount: String(answers.family?.dependantsCount ?? 0),
    familyPartOfConsultation: tf(answers.family?.familyPartOfConsultation),
    hasLanguageTest: tf(answers.language?.hasLanguageTest),
    languageTestType: answers.language?.testType || "",
    languageTestDate: date(answers.language?.testDate),
    listeningScore: answers.language?.listening || "",
    readingScore: answers.language?.reading || "",
    writingScore: answers.language?.writing || "",
    speakingScore: answers.language?.speaking || "",
    hasEca: tf(answers.language?.hasEca),
    ecaOrganization: answers.language?.ecaOrganization || "",
    ecaDate: date(answers.language?.ecaDate),
    hasDeadline: tf(answers.urgency?.hasDeadline),
    deadlineType: answers.urgency?.deadlineType || "",
    deadlineDate: date(answers.urgency?.deadlineDate),
    deadlineDetails: answers.urgency?.deadlineDetails || "",
    hasActiveIssue: tf(answers.urgency?.hasActiveIssue),
    activeIssueDetails: answers.urgency?.activeIssueDetails || "",
    additionalInformation: answers.urgency?.additionalInformation || "",
  };
}

function Field({ label, type = "text", value, onChange, required = false }) {
  return <label className={labelClass}>{label}<input type={type} value={value || ""} onChange={(event) => onChange(event.target.value)} required={required} className={inputClass} /></label>;
}

function Select({ label, value, onChange, options, required = false }) {
  return <label className={labelClass}>{label}<select value={value || ""} onChange={(event) => onChange(event.target.value)} required={required} className={inputClass}><option value="">Select</option>{options.map((option) => <option key={option} value={option}>{option}</option>)}</select></label>;
}

function YesNo({ label, value, onChange }) {
  return <label className={labelClass}>{label}<select value={String(value)} onChange={(event) => onChange(event.target.value)} className={inputClass}><option value="true">Yes</option><option value="false">No</option></select></label>;
}

export default function StaffConsultationIntakePage() {
  const { publicToken: appointmentId } = useParams();
  const [info, setInfo] = useState(null);
  const [values, setValues] = useState(initial);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    api.get(`/booking/appointments/${appointmentId}/pre-consultation`, { cache: false })
      .then((response) => {
        const data = response.data.data;
        setInfo(data);
        setValues(flattenAnswers(data.answers, data.contact));
      })
      .catch((requestError) => setError(requestError.response?.data?.message || "Pre-consultation information could not be loaded."))
      .finally(() => setLoading(false));
  }, [appointmentId]);

  const appointmentText = useMemo(() => {
    if (!info?.appointment?.startsAt) return "";
    return new Date(info.appointment.startsAt).toLocaleString("en-CA", { timeZone: info.appointment.timezone, dateStyle: "medium", timeStyle: "short" });
  }, [info]);

  const set = (name) => (value) => setValues((current) => ({ ...current, [name]: value }));
  const yes = (name) => String(values[name]) === "true";

  async function submit(event) {
    event.preventDefault();
    if (!event.currentTarget.reportValidity()) return;
    setSaving(true); setError(""); setSaved(false);
    try {
      await api.post(`/booking/appointments/${appointmentId}/pre-consultation/manual`, values);
      setSaved(true);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (requestError) {
      setError(requestError.response?.data?.message || "The information could not be saved.");
    } finally { setSaving(false); }
  }

  if (loading) return <main className="flex min-h-screen items-center justify-center bg-slate-50"><LoaderCircle className="h-6 w-6 animate-spin text-slate-400" /></main>;
  if (!info) return <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4"><div className="max-w-md rounded-3xl border border-slate-200 bg-white p-8 text-center"><h1 className="text-xl font-semibold">Manual intake unavailable</h1><p className="mt-2 text-sm text-slate-500">{error}</p></div></main>;

  return <main className="min-h-screen bg-slate-50 px-4 py-8"><form onSubmit={submit} className="mx-auto max-w-5xl space-y-5">
    <header className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm"><p className="text-xs font-semibold uppercase tracking-[0.16em] text-violet-600">Staff manual entry</p><h1 className="mt-2 text-2xl font-semibold tracking-tight text-slate-950">Pre-consultation information</h1><p className="mt-2 text-sm text-slate-500">{info.contact?.name || "Client"} · {appointmentText}</p><p className="mt-3 text-xs leading-5 text-slate-400">Enter information provided by the client. This records the entry as staff-entered information and does not record client consent.</p>{saved ? <p className="mt-4 flex items-center gap-2 rounded-2xl bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-700"><CheckCircle2 className="h-4 w-4" />Saved to the appointment profile.</p> : null}{error ? <p className="mt-4 rounded-2xl bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</p> : null}</header>

    <section className={sectionClass}><h2 className="text-sm font-semibold text-slate-900">Identity & Canada status</h2><div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3"><Field label="Full legal name" value={values.legalName} onChange={set("legalName")} required /><Field label="Date of birth" type="date" value={values.dateOfBirth} onChange={set("dateOfBirth")} required /><Field label="Citizenship" value={values.citizenship} onChange={set("citizenship")} required /><Field label="Current country" value={values.currentCountry} onChange={set("currentCountry")} required /><YesNo label="Currently in Canada" value={values.inCanada} onChange={set("inCanada")} />{yes("inCanada") ? <><Field label="First entry to Canada" type="date" value={values.firstEntryDate} onChange={set("firstEntryDate")} /><Field label="Most recent entry" type="date" value={values.mostRecentEntryDate} onChange={set("mostRecentEntryDate")} /><Select label="Current status" value={values.currentStatus} onChange={set("currentStatus")} required options={["Visitor","Study Permit","Work Permit","Permanent Resident","Refugee Claimant","No Current Status","Other"]} />{values.currentStatus === "Other" ? <Field label="Other status" value={values.currentStatusOther} onChange={set("currentStatusOther")} /> : null}<Field label="Status approval / issue date" type="date" value={values.statusApprovalDate} onChange={set("statusApprovalDate")} /><Field label="Status expiry date" type="date" value={values.statusExpiryDate} onChange={set("statusExpiryDate")} /></> : null}<YesNo label="Pending IRCC application" value={values.hasPendingIrccApplication} onChange={set("hasPendingIrccApplication")} />{yes("hasPendingIrccApplication") ? <><Field label="Application type" value={values.pendingApplicationType} onChange={set("pendingApplicationType")} /><Field label="Submitted date" type="date" value={values.pendingApplicationSubmittedDate} onChange={set("pendingApplicationSubmittedDate")} /><Field label="Application status" value={values.pendingApplicationStatus} onChange={set("pendingApplicationStatus")} /></> : null}</div></section>

    <section className={sectionClass}><h2 className="text-sm font-semibold text-slate-900">Study in Canada</h2><div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3"><YesNo label="Studied in Canada" value={values.studiedInCanada} onChange={set("studiedInCanada")} />{yes("studiedInCanada") ? <><Field label="Institution" value={values.institution} onChange={set("institution")} /><Field label="Program" value={values.program} onChange={set("program")} /><Field label="Province" value={values.studyProvince} onChange={set("studyProvince")} /><Field label="Program start" type="date" value={values.studyStartDate} onChange={set("studyStartDate")} /><Field label="Completion / expected completion" type="date" value={values.studyCompletionDate} onChange={set("studyCompletionDate")} /><YesNo label="Program completed" value={values.studyCompleted} onChange={set("studyCompleted")} /><Field label="Study permit approval" type="date" value={values.studyPermitApprovalDate} onChange={set("studyPermitApprovalDate")} /><Field label="Study permit expiry" type="date" value={values.studyPermitExpiryDate} onChange={set("studyPermitExpiryDate")} /><Field label="Current study status" value={values.currentStudyStatus} onChange={set("currentStudyStatus")} /></> : null}</div></section>

    <section className={sectionClass}><h2 className="text-sm font-semibold text-slate-900">Work history</h2><div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3"><YesNo label="Currently working in Canada" value={values.currentlyWorkingInCanada} onChange={set("currentlyWorkingInCanada")} />{yes("currentlyWorkingInCanada") ? <><Field label="Employer" value={values.employer} onChange={set("employer")} /><Field label="Job title" value={values.jobTitle} onChange={set("jobTitle")} /><Field label="Employment start" type="date" value={values.workStartDate} onChange={set("workStartDate")} /><Select label="Employment type" value={values.employmentType} onChange={set("employmentType")} options={["Full-time","Part-time","Self-employed","Other"]} /><Field label="Hours per week" type="number" value={values.hoursPerWeek} onChange={set("hoursPerWeek")} /><Field label="NOC code" value={values.nocCode} onChange={set("nocCode")} /><Select label="Work permit type" value={values.workPermitType} onChange={set("workPermitType")} options={["PGWP","Open Work Permit","Spousal Open Work Permit","LMIA / Employer-specific","Other"]} /><Field label="Work permit approval" type="date" value={values.workPermitApprovalDate} onChange={set("workPermitApprovalDate")} /><Field label="Work permit expiry" type="date" value={values.workPermitExpiryDate} onChange={set("workPermitExpiryDate")} /></> : null}<Select label="Canadian work experience" value={values.canadianExperience} onChange={set("canadianExperience")} options={["None","Less than 6 months","6–11 months","1 year","2 years","3+ years"]} /><YesNo label="Foreign work experience" value={values.foreignWorkExperience} onChange={set("foreignWorkExperience")} />{yes("foreignWorkExperience") ? <><Field label="Foreign country" value={values.foreignCountry} onChange={set("foreignCountry")} /><Field label="Foreign employer" value={values.foreignEmployer} onChange={set("foreignEmployer")} /><Field label="Foreign job title" value={values.foreignJobTitle} onChange={set("foreignJobTitle")} /><Field label="Foreign work from" type="date" value={values.foreignFrom} onChange={set("foreignFrom")} /><Field label="Foreign work to" type="date" value={values.foreignTo} onChange={set("foreignTo")} /></> : null}</div></section>

    <section className={sectionClass}><h2 className="text-sm font-semibold text-slate-900">Immigration history & family</h2><div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3"><YesNo label="Previous IRCC applications" value={values.hasPreviousApplications} onChange={set("hasPreviousApplications")} />{yes("hasPreviousApplications") ? <><Field label="Application type" value={values.previousApplicationType} onChange={set("previousApplicationType")} /><Field label="Application date" type="date" value={values.previousApplicationDate} onChange={set("previousApplicationDate")} /><Select label="Outcome" value={values.previousApplicationOutcome} onChange={set("previousApplicationOutcome")} options={["Approved","Refused","Withdrawn","Pending","Other"]} /></> : null}<YesNo label="Previous refusal" value={values.hasPreviousRefusal} onChange={set("hasPreviousRefusal")} />{yes("hasPreviousRefusal") ? <><Field label="Refusal date" type="date" value={values.refusalDate} onChange={set("refusalDate")} /><label className={`${labelClass} sm:col-span-2`}>Refusal reason<textarea rows="3" value={values.refusalReason} onChange={(event) => set("refusalReason")(event.target.value)} className={textareaClass} /></label></> : null}<Select label="Marital status" value={values.maritalStatus} onChange={set("maritalStatus")} options={["Single","Married","Common-law","Separated","Divorced","Widowed"]} /><YesNo label="Spouse/partner in Canada" value={values.spouseInCanada} onChange={set("spouseInCanada")} />{yes("spouseInCanada") ? <Field label="Spouse status" value={values.spouseStatus} onChange={set("spouseStatus")} /> : null}<Field label="Dependants" type="number" value={values.dependantsCount} onChange={set("dependantsCount")} /><YesNo label="Family part of consultation" value={values.familyPartOfConsultation} onChange={set("familyPartOfConsultation")} /></div></section>

    <section className={sectionClass}><h2 className="text-sm font-semibold text-slate-900">Language, ECA & urgency</h2><div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3"><YesNo label="Language test completed" value={values.hasLanguageTest} onChange={set("hasLanguageTest")} />{yes("hasLanguageTest") ? <><Select label="Language test" value={values.languageTestType} onChange={set("languageTestType")} options={["IELTS General","CELPIP","TEF","TCF","Other"]} /><Field label="Test date" type="date" value={values.languageTestDate} onChange={set("languageTestDate")} /><Field label="Listening" value={values.listeningScore} onChange={set("listeningScore")} /><Field label="Reading" value={values.readingScore} onChange={set("readingScore")} /><Field label="Writing" value={values.writingScore} onChange={set("writingScore")} /><Field label="Speaking" value={values.speakingScore} onChange={set("speakingScore")} /></> : null}<YesNo label="ECA completed" value={values.hasEca} onChange={set("hasEca")} />{yes("hasEca") ? <><Field label="ECA organization" value={values.ecaOrganization} onChange={set("ecaOrganization")} /><Field label="ECA date" type="date" value={values.ecaDate} onChange={set("ecaDate")} /></> : null}<YesNo label="Upcoming immigration deadline" value={values.hasDeadline} onChange={set("hasDeadline")} />{yes("hasDeadline") ? <><Field label="Deadline type" value={values.deadlineType} onChange={set("deadlineType")} /><Field label="Deadline date" type="date" value={values.deadlineDate} onChange={set("deadlineDate")} /><label className={`${labelClass} sm:col-span-2`}>Deadline details<textarea rows="3" value={values.deadlineDetails} onChange={(event) => set("deadlineDetails")(event.target.value)} className={textareaClass} /></label></> : null}<YesNo label="Active urgent immigration issue" value={values.hasActiveIssue} onChange={set("hasActiveIssue")} />{yes("hasActiveIssue") ? <label className={`${labelClass} sm:col-span-2`}>Issue details<textarea rows="4" value={values.activeIssueDetails} onChange={(event) => set("activeIssueDetails")(event.target.value)} className={textareaClass} /></label> : null}<label className={`${labelClass} sm:col-span-3`}>Anything else the consultant should know?<textarea rows="5" value={values.additionalInformation} onChange={(event) => set("additionalInformation")(event.target.value)} className={textareaClass} /></label></div></section>

    <div className="sticky bottom-4 flex justify-end"><button type="submit" disabled={saving} className="inline-flex h-12 items-center gap-2 rounded-full bg-slate-950 px-6 text-sm font-semibold text-white shadow-xl disabled:opacity-50">{saving ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}{saving ? "Saving…" : "Save pre-consultation"}</button></div>
  </form></main>;
}
