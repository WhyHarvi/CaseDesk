import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  Clock3,
  FileText,
  Loader2,
  Mail,
  MessageSquareText,
  Pencil,
  Send,
  ShieldAlert,
} from "lucide-react";
import { useEffect, useState } from "react";
import {
  getStaffPreConsultationIntake,
  sendStaffPreConsultationIntake,
} from "../../api/preConsultationApi";
import PreConsultationManualEntryModal from "./PreConsultationManualEntryModal";

const statusTone = {
  Submitted: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  Opened: "bg-sky-50 text-sky-700 ring-sky-200",
  Sent: "bg-violet-50 text-violet-700 ring-violet-200",
  PartiallySent: "bg-amber-50 text-amber-700 ring-amber-200",
  DeliveryFailed: "bg-rose-50 text-rose-700 ring-rose-200",
  NotSent: "bg-slate-100 text-slate-600 ring-slate-200",
};

const statusLabel = {
  Submitted: "Submitted",
  Opened: "Opened",
  Sent: "Sent",
  PartiallySent: "Partially sent",
  DeliveryFailed: "Delivery issue",
  NotSent: "Not sent yet",
};

export const flagLabel = {
  STATUS_EXPIRY: "Status expiring",
  PREVIOUS_REFUSAL: "Previous refusal",
  ACTIVE_IMMIGRATION_ISSUE: "Active immigration issue",
  UPCOMING_DEADLINE: "Upcoming deadline",
  NO_CURRENT_STATUS: "No current status",
};

export function dateOnly(value) {
  if (!value) return null;
  const date = new Date(`${String(value).slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" }).format(date);
}

function dateTime(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat("en-CA", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function yesNo(value) {
  if (value === true) return "Yes";
  if (value === false) return "No";
  return value || null;
}

function compact(parts) {
  return parts.filter((item) => item !== null && item !== undefined && item !== "").join(" · ") || null;
}

function Value({ label, value }) {
  if (value === null || value === undefined || value === "") return null;
  return <div><p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-400">{label}</p><p className="mt-1 whitespace-pre-wrap text-sm leading-5 text-slate-700">{String(value)}</p></div>;
}

function AnswerSection({ title, children }) {
  return <section className="rounded-2xl border border-slate-100 bg-slate-50/70 p-4"><h5 className="text-xs font-semibold text-slate-800">{title}</h5><div className="mt-3 grid gap-4 sm:grid-cols-2">{children}</div></section>;
}

function DeliveryChip({ icon: Icon, label, status }) {
  if (!status) return null;
  const success = String(status).toLowerCase() === "sent";
  const skipped = String(status).toLowerCase() === "skipped";
  return <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-semibold ${success ? "bg-emerald-50 text-emerald-700" : skipped ? "bg-slate-100 text-slate-500" : "bg-amber-50 text-amber-700"}`}><Icon className="h-3 w-3" />{label}: {status}</span>;
}

function SummaryMetric({ label, value, attention = false }) {
  if (!value) return null;
  return <div className={`rounded-2xl border p-3.5 ${attention ? "border-amber-200 bg-amber-50/70" : "border-slate-100 bg-slate-50/70"}`}><p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-400">{label}</p><p className={`mt-1 text-sm font-semibold ${attention ? "text-amber-900" : "text-slate-800"}`}>{value}</p></div>;
}

export default function PreConsultationSummaryCard({ intake }) {
  const [current, setCurrent] = useState(intake);
  const [sending, setSending] = useState(false);
  const [showManual, setShowManual] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => setCurrent(intake), [intake]);
  if (!current) return null;

  const appointmentId = current.appointmentId;
  const answers = current.answers;
  const flags = Array.isArray(current.flags) ? current.flags : [];
  const status = current.status || "NotSent";
  const urgent = flags.some((flag) => flag.severity === "urgent");
  const submitted = status === "Submitted";
  const canSend = Boolean(appointmentId) && !submitted;

  const currentStatus = answers?.canadaStatus?.currentStatus === "Other"
    ? answers?.canadaStatus?.currentStatusOther || "Other"
    : answers?.canadaStatus?.currentStatus;
  const expiry = answers?.canadaStatus?.statusExpiryDate || answers?.work?.workPermitExpiryDate || answers?.study?.permitExpiryDate;
  const study = answers?.study?.studiedInCanada
    ? compact([answers.study.institution, answers.study.program, answers.study.completed ? "Completed" : answers.study.currentStudyStatus])
    : answers ? "No Canadian study reported" : null;
  const work = answers?.work?.currentlyWorkingInCanada
    ? compact([answers.work.jobTitle, answers.work.employer, answers.work.canadianExperience])
    : answers ? "Not currently working in Canada" : null;
  const deadline = answers?.urgency?.hasDeadline
    ? compact([answers.urgency.deadlineType, dateOnly(answers.urgency.deadlineDate)])
    : null;

  async function refresh() {
    if (!appointmentId) return;
    const fresh = await getStaffPreConsultationIntake(appointmentId);
    setCurrent(fresh);
  }

  async function sendQuestionnaire() {
    if (!canSend || sending) return;
    try {
      setSending(true);
      setError("");
      setNotice("");
      const result = await sendStaffPreConsultationIntake(appointmentId);
      await refresh();
      const channels = [result.emailStatus === "sent" && "email", result.smsStatus === "sent" && "SMS"].filter(Boolean).join(" + ");
      setNotice(channels ? `Questionnaire sent by ${channels}.` : "Questionnaire sent.");
    } catch (requestError) {
      setError(requestError.response?.data?.message || "The questionnaire could not be sent.");
    } finally {
      setSending(false);
    }
  }

  return <>
    <section className={`rounded-[1.5rem] border bg-white p-5 shadow-sm ${urgent ? "border-rose-200 ring-2 ring-rose-50" : "border-white"}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2"><FileText className="h-4 w-4 text-violet-600" /><h3 className="text-sm font-semibold text-slate-900">Pre-consultation</h3></div>
          <p className="mt-1 max-w-xl text-xs leading-5 text-slate-400">Information collected before the consultation so the consultant can review the file in advance.</p>
        </div>
        <span className={`rounded-full px-2.5 py-1 text-[10px] font-bold ring-1 ${statusTone[status] || statusTone.NotSent}`}>{statusLabel[status] || status}</span>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        {canSend ? <button type="button" disabled={sending} onClick={sendQuestionnaire} className="inline-flex items-center gap-1.5 rounded-full bg-violet-600 px-4 py-2.5 text-xs font-semibold text-white shadow-sm transition hover:bg-violet-700 disabled:opacity-50">{sending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}{sending ? "Sending…" : status === "NotSent" ? "Send questionnaire" : "Resend questionnaire"}</button> : null}
        {appointmentId ? <button type="button" onClick={() => { setError(""); setNotice(""); setShowManual(true); }} className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-4 py-2.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-50"><Pencil className="h-3.5 w-3.5" />{answers ? "Edit manually" : "Add manually"}</button> : null}
      </div>

      {error ? <p className="mt-3 rounded-2xl bg-rose-50 px-4 py-3 text-xs text-rose-700">{error}</p> : null}
      {notice ? <p className="mt-3 rounded-2xl bg-emerald-50 px-4 py-3 text-xs text-emerald-700">{notice}</p> : null}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <DeliveryChip icon={Mail} label="Email" status={current.emailStatus} />
        <DeliveryChip icon={MessageSquareText} label="SMS" status={current.smsStatus} />
        {current.sentAt ? <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-semibold text-slate-500"><Clock3 className="h-3 w-3" />Sent {dateTime(current.sentAt)}</span> : null}
        {current.submittedAt ? <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-semibold text-slate-500"><CheckCircle2 className="h-3 w-3" />Submitted {dateTime(current.submittedAt)}</span> : null}
      </div>

      {flags.length ? <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50/70 p-3.5">
        <div className="flex items-center gap-2"><ShieldAlert className={`h-4 w-4 ${urgent ? "text-rose-600" : "text-amber-600"}`} /><p className="text-xs font-semibold text-slate-800">Review before consultation</p></div>
        <div className="mt-2 flex flex-wrap gap-2">{flags.map((flag, index) => <span key={`${flag.type}-${index}`} className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[10px] font-semibold ${flag.severity === "urgent" ? "bg-rose-100 text-rose-700" : "bg-amber-100 text-amber-700"}`}><AlertTriangle className="h-3 w-3" />{flagLabel[flag.type] || flag.type}{flag.date ? ` · ${dateOnly(flag.date)}` : ""}{Number.isFinite(Number(flag.days)) ? ` · ${flag.days} days` : ""}</span>)}</div>
      </div> : null}

      {!answers ? <div className="mt-4 rounded-2xl border border-dashed border-slate-200 bg-slate-50/70 px-4 py-5 text-sm text-slate-500">
        {status === "Opened" ? "The client opened the questionnaire but has not submitted it yet." : status === "Sent" || status === "PartiallySent" ? "The questionnaire has been sent. Waiting for the client to submit their information." : status === "DeliveryFailed" ? "The questionnaire could not be fully delivered. You can resend it or add the information manually." : "The questionnaire has not been submitted yet. Send it to the client or add the information manually."}
      </div> : <>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <SummaryMetric label="Current status" value={currentStatus || (answers.canadaStatus?.inCanada ? "Not provided" : "Outside Canada")} attention={currentStatus === "No Current Status"} />
          <SummaryMetric label="Status / permit expiry" value={expiry ? dateOnly(expiry) : "No expiry provided"} attention={flags.some((flag) => flag.type === "STATUS_EXPIRY")} />
          <SummaryMetric label="Citizenship" value={answers.identity?.citizenship} />
          <SummaryMetric label="Current country" value={answers.identity?.currentCountry} />
          <SummaryMetric label="Canadian study" value={study} />
          <SummaryMetric label="Current work" value={work} />
          <SummaryMetric label="Previous refusal" value={answers.immigrationHistory?.hasPreviousRefusal ? "Yes" : "No"} attention={answers.immigrationHistory?.hasPreviousRefusal} />
          <SummaryMetric label="Deadline" value={deadline || "None reported"} attention={Boolean(deadline)} />
          <SummaryMetric label="Active issue" value={answers.urgency?.hasActiveIssue ? "Yes — review details" : "None reported"} attention={answers.urgency?.hasActiveIssue} />
        </div>

        <details className="group mt-4 rounded-2xl border border-slate-100 bg-white">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-xs font-semibold text-slate-700">Full questionnaire<ChevronDown className="h-4 w-4 text-slate-400 transition group-open:rotate-180" /></summary>
          <div className="space-y-3 border-t border-slate-100 p-4">
            <AnswerSection title="Identity"><Value label="Legal name" value={answers.identity?.legalName} /><Value label="Date of birth" value={dateOnly(answers.identity?.dateOfBirth)} /><Value label="Citizenship" value={answers.identity?.citizenship} /><Value label="Current country" value={answers.identity?.currentCountry} /></AnswerSection>
            <AnswerSection title="Canada status"><Value label="Currently in Canada" value={yesNo(answers.canadaStatus?.inCanada)} /><Value label="Current status" value={currentStatus} /><Value label="First entry" value={dateOnly(answers.canadaStatus?.firstEntryDate)} /><Value label="Most recent entry" value={dateOnly(answers.canadaStatus?.mostRecentEntryDate)} /><Value label="Status approved" value={dateOnly(answers.canadaStatus?.statusApprovalDate)} /><Value label="Status expires" value={dateOnly(answers.canadaStatus?.statusExpiryDate)} /><Value label="Pending IRCC application" value={yesNo(answers.canadaStatus?.hasPendingIrccApplication)} /><Value label="Pending application" value={compact([answers.canadaStatus?.pendingApplicationType, dateOnly(answers.canadaStatus?.pendingApplicationSubmittedDate), answers.canadaStatus?.pendingApplicationStatus])} /></AnswerSection>
            <AnswerSection title="Study in Canada"><Value label="Studied in Canada" value={yesNo(answers.study?.studiedInCanada)} /><Value label="Institution" value={answers.study?.institution} /><Value label="Program" value={answers.study?.program} /><Value label="Province" value={answers.study?.province} /><Value label="Study period" value={compact([dateOnly(answers.study?.startDate), dateOnly(answers.study?.completionDate)])} /><Value label="Completed" value={yesNo(answers.study?.completed)} /><Value label="Study permit" value={compact([dateOnly(answers.study?.permitApprovalDate), dateOnly(answers.study?.permitExpiryDate)])} /><Value label="Current study status" value={answers.study?.currentStudyStatus} /></AnswerSection>
            <AnswerSection title="Work history"><Value label="Working in Canada" value={yesNo(answers.work?.currentlyWorkingInCanada)} /><Value label="Canadian job" value={compact([answers.work?.jobTitle, answers.work?.employer])} /><Value label="Employment details" value={compact([answers.work?.employmentType, answers.work?.hoursPerWeek && `${answers.work.hoursPerWeek} hrs/week`, answers.work?.nocCode && `NOC ${answers.work.nocCode}`])} /><Value label="Work started" value={dateOnly(answers.work?.startDate)} /><Value label="Work permit" value={compact([answers.work?.workPermitType, dateOnly(answers.work?.workPermitApprovalDate), dateOnly(answers.work?.workPermitExpiryDate)])} /><Value label="Canadian experience" value={answers.work?.canadianExperience} /><Value label="Foreign work" value={yesNo(answers.work?.foreignWorkExperience)} /><Value label="Foreign position" value={compact([answers.work?.foreignJobTitle, answers.work?.foreignEmployer, answers.work?.foreignCountry])} /><Value label="Foreign work dates" value={compact([dateOnly(answers.work?.foreignFrom), dateOnly(answers.work?.foreignTo)])} /></AnswerSection>
            <AnswerSection title="Immigration history"><Value label="Previous applications" value={yesNo(answers.immigrationHistory?.hasPreviousApplications)} /><Value label="Previous application" value={compact([answers.immigrationHistory?.previousApplicationType, dateOnly(answers.immigrationHistory?.previousApplicationDate), answers.immigrationHistory?.previousApplicationOutcome])} /><Value label="Previous refusal" value={yesNo(answers.immigrationHistory?.hasPreviousRefusal)} /><Value label="Refusal date" value={dateOnly(answers.immigrationHistory?.refusalDate)} /><Value label="Refusal reason" value={answers.immigrationHistory?.refusalReason} /></AnswerSection>
            <AnswerSection title="Family"><Value label="Marital status" value={answers.family?.maritalStatus} /><Value label="Spouse in Canada" value={yesNo(answers.family?.spouseInCanada)} /><Value label="Spouse status" value={answers.family?.spouseStatus} /><Value label="Dependants" value={answers.family?.dependantsCount} /><Value label="Family part of consultation" value={yesNo(answers.family?.familyPartOfConsultation)} /></AnswerSection>
            <AnswerSection title="Language and ECA"><Value label="Language test" value={yesNo(answers.language?.hasLanguageTest)} /><Value label="Test" value={compact([answers.language?.testType, dateOnly(answers.language?.testDate)])} /><Value label="Scores" value={compact([answers.language?.listening && `L ${answers.language.listening}`, answers.language?.reading && `R ${answers.language.reading}`, answers.language?.writing && `W ${answers.language.writing}`, answers.language?.speaking && `S ${answers.language.speaking}`])} /><Value label="ECA" value={yesNo(answers.language?.hasEca)} /><Value label="ECA details" value={compact([answers.language?.ecaOrganization, dateOnly(answers.language?.ecaDate)])} /></AnswerSection>
            <AnswerSection title="Deadlines and urgent issues"><Value label="Upcoming deadline" value={yesNo(answers.urgency?.hasDeadline)} /><Value label="Deadline" value={compact([answers.urgency?.deadlineType, dateOnly(answers.urgency?.deadlineDate)])} /><Value label="Deadline details" value={answers.urgency?.deadlineDetails} /><Value label="Active immigration issue" value={yesNo(answers.urgency?.hasActiveIssue)} /><Value label="Issue details" value={answers.urgency?.activeIssueDetails} /><Value label="Additional information" value={answers.urgency?.additionalInformation} /></AnswerSection>
          </div>
        </details>

        {current.source === "staff_manual"
          ? <p className="mt-3 flex items-center gap-1.5 text-[10px] text-violet-600"><Pencil className="h-3 w-3" />Entered manually by staff. Client online consent was not recorded for this entry.</p>
          : <p className="mt-3 flex items-center gap-1.5 text-[10px] text-slate-400"><CheckCircle2 className="h-3 w-3 text-emerald-500" />Client confirmed the information was accurate to the best of their knowledge.</p>}
      </>}
    </section>

    {showManual ? <PreConsultationManualEntryModal appointmentId={appointmentId} initialAnswers={answers} onClose={() => setShowManual(false)} onSaved={async () => { await refresh(); setNotice(answers ? "Pre-consultation information updated." : "Pre-consultation information added manually."); }} /> : null}
  </>;
}
