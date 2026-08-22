import { createHttpError } from "../utils/http.js";
import { recordAppointmentEvent } from "./appointmentOperationsService.js";
import { PRE_CONSULTATION_EVENT } from "./preConsultationIntakeService.js";

function text(value, max = 500) {
  return String(value ?? "").trim().slice(0, max);
}

function bool(value) {
  return value === true || value === "true" || value === "yes" || value === "on" || value === 1 || value === "1";
}

function nullableDate(value, field) {
  if (!value) return null;
  const date = new Date(`${String(value).slice(0, 10)}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) throw createHttpError(400, `${field} is invalid.`, "VALIDATION_ERROR");
  return date;
}

function dateText(value, field) {
  if (!value) return null;
  const raw = String(value).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw) || Number.isNaN(new Date(`${raw}T00:00:00.000Z`).getTime())) {
    throw createHttpError(400, `${field} is invalid.`, "VALIDATION_ERROR");
  }
  return raw;
}

function choice(value, allowed, field, { required = false } = {}) {
  const cleaned = text(value, 100);
  if (!cleaned && !required) return null;
  if (!allowed.includes(cleaned)) throw createHttpError(400, `${field} is invalid.`, "VALIDATION_ERROR");
  return cleaned;
}

export function validatePreConsultationAnswers(body = {}, { requireConsent = true } = {}) {
  const legalName = text(body.legalName, 180);
  const dateOfBirth = dateText(body.dateOfBirth, "Date of birth");
  const citizenship = text(body.citizenship, 120);
  const currentCountry = text(body.currentCountry, 120);
  const inCanada = bool(body.inCanada);
  const currentStatus = choice(body.currentStatus, [
    "Visitor",
    "Study Permit",
    "Work Permit",
    "Permanent Resident",
    "Refugee Claimant",
    "No Current Status",
    "Other",
  ], "Current immigration status", { required: inCanada });

  if (!legalName) throw createHttpError(400, "Full legal name is required.", "VALIDATION_ERROR");
  if (!dateOfBirth) throw createHttpError(400, "Date of birth is required.", "VALIDATION_ERROR");
  if (!citizenship) throw createHttpError(400, "Citizenship is required.", "VALIDATION_ERROR");
  if (!currentCountry) throw createHttpError(400, "Current country of residence is required.", "VALIDATION_ERROR");
  if (requireConsent && !bool(body.accuracyConfirmed)) throw createHttpError(400, "Confirm that the information is accurate to the best of your knowledge.", "CONSENT_REQUIRED");
  if (requireConsent && !bool(body.consent)) throw createHttpError(400, "Consent is required before submitting the questionnaire.", "CONSENT_REQUIRED");

  const studiedInCanada = bool(body.studiedInCanada);
  const currentlyWorkingInCanada = bool(body.currentlyWorkingInCanada);
  const foreignWorkExperience = bool(body.foreignWorkExperience);
  const hasPreviousApplications = bool(body.hasPreviousApplications);
  const hasPreviousRefusal = bool(body.hasPreviousRefusal);
  const hasLanguageTest = bool(body.hasLanguageTest);
  const hasEca = bool(body.hasEca);
  const hasDeadline = bool(body.hasDeadline);
  const hasActiveIssue = bool(body.hasActiveIssue);
  const hasPendingIrccApplication = bool(body.hasPendingIrccApplication);

  return {
    identity: { legalName, dateOfBirth, citizenship, currentCountry },
    canadaStatus: {
      inCanada,
      firstEntryDate: inCanada ? dateText(body.firstEntryDate, "First entry date") : null,
      mostRecentEntryDate: inCanada ? dateText(body.mostRecentEntryDate, "Most recent entry date") : null,
      currentStatus: inCanada ? currentStatus : null,
      currentStatusOther: inCanada && currentStatus === "Other" ? text(body.currentStatusOther, 160) : null,
      statusApprovalDate: inCanada ? dateText(body.statusApprovalDate, "Status approval date") : null,
      statusExpiryDate: inCanada ? dateText(body.statusExpiryDate, "Status expiry date") : null,
      hasPendingIrccApplication,
      pendingApplicationType: hasPendingIrccApplication ? text(body.pendingApplicationType, 180) : null,
      pendingApplicationSubmittedDate: hasPendingIrccApplication ? dateText(body.pendingApplicationSubmittedDate, "Pending application submission date") : null,
      pendingApplicationStatus: hasPendingIrccApplication ? text(body.pendingApplicationStatus, 160) : null,
    },
    study: {
      studiedInCanada,
      institution: studiedInCanada ? text(body.institution, 180) : null,
      program: studiedInCanada ? text(body.program, 180) : null,
      province: studiedInCanada ? text(body.studyProvince, 100) : null,
      startDate: studiedInCanada ? dateText(body.studyStartDate, "Study start date") : null,
      completionDate: studiedInCanada ? dateText(body.studyCompletionDate, "Study completion date") : null,
      completed: studiedInCanada ? bool(body.studyCompleted) : false,
      permitApprovalDate: studiedInCanada ? dateText(body.studyPermitApprovalDate, "Study permit approval date") : null,
      permitExpiryDate: studiedInCanada ? dateText(body.studyPermitExpiryDate, "Study permit expiry date") : null,
      currentStudyStatus: studiedInCanada ? text(body.currentStudyStatus, 160) : null,
    },
    work: {
      currentlyWorkingInCanada,
      employer: currentlyWorkingInCanada ? text(body.employer, 180) : null,
      jobTitle: currentlyWorkingInCanada ? text(body.jobTitle, 180) : null,
      startDate: currentlyWorkingInCanada ? dateText(body.workStartDate, "Employment start date") : null,
      employmentType: currentlyWorkingInCanada ? text(body.employmentType, 80) : null,
      hoursPerWeek: currentlyWorkingInCanada ? text(body.hoursPerWeek, 20) : null,
      nocCode: currentlyWorkingInCanada ? text(body.nocCode, 40) : null,
      workPermitType: currentlyWorkingInCanada ? text(body.workPermitType, 160) : null,
      workPermitApprovalDate: currentlyWorkingInCanada ? dateText(body.workPermitApprovalDate, "Work permit approval date") : null,
      workPermitExpiryDate: currentlyWorkingInCanada ? dateText(body.workPermitExpiryDate, "Work permit expiry date") : null,
      canadianExperience: text(body.canadianExperience, 80),
      foreignWorkExperience,
      foreignCountry: foreignWorkExperience ? text(body.foreignCountry, 120) : null,
      foreignEmployer: foreignWorkExperience ? text(body.foreignEmployer, 180) : null,
      foreignJobTitle: foreignWorkExperience ? text(body.foreignJobTitle, 180) : null,
      foreignFrom: foreignWorkExperience ? dateText(body.foreignFrom, "Foreign work start date") : null,
      foreignTo: foreignWorkExperience ? dateText(body.foreignTo, "Foreign work end date") : null,
    },
    immigrationHistory: {
      hasPreviousApplications,
      previousApplicationType: hasPreviousApplications ? text(body.previousApplicationType, 180) : null,
      previousApplicationDate: hasPreviousApplications ? dateText(body.previousApplicationDate, "Previous application date") : null,
      previousApplicationOutcome: hasPreviousApplications ? text(body.previousApplicationOutcome, 120) : null,
      hasPreviousRefusal,
      refusalDate: hasPreviousRefusal ? dateText(body.refusalDate, "Refusal date") : null,
      refusalReason: hasPreviousRefusal ? text(body.refusalReason, 1500) : null,
    },
    family: {
      maritalStatus: text(body.maritalStatus, 100),
      spouseInCanada: bool(body.spouseInCanada),
      spouseStatus: bool(body.spouseInCanada) ? text(body.spouseStatus, 140) : null,
      dependantsCount: Math.min(Math.max(Number(body.dependantsCount) || 0, 0), 20),
      familyPartOfConsultation: bool(body.familyPartOfConsultation),
    },
    language: {
      hasLanguageTest,
      testType: hasLanguageTest ? text(body.languageTestType, 80) : null,
      testDate: hasLanguageTest ? dateText(body.languageTestDate, "Language test date") : null,
      listening: hasLanguageTest ? text(body.listeningScore, 30) : null,
      reading: hasLanguageTest ? text(body.readingScore, 30) : null,
      writing: hasLanguageTest ? text(body.writingScore, 30) : null,
      speaking: hasLanguageTest ? text(body.speakingScore, 30) : null,
      hasEca,
      ecaOrganization: hasEca ? text(body.ecaOrganization, 100) : null,
      ecaDate: hasEca ? dateText(body.ecaDate, "ECA date") : null,
    },
    urgency: {
      hasDeadline,
      deadlineType: hasDeadline ? text(body.deadlineType, 180) : null,
      deadlineDate: hasDeadline ? dateText(body.deadlineDate, "Deadline date") : null,
      deadlineDetails: hasDeadline ? text(body.deadlineDetails, 1500) : null,
      hasActiveIssue,
      activeIssueDetails: hasActiveIssue ? text(body.activeIssueDetails, 2000) : null,
      additionalInformation: text(body.additionalInformation, 3000),
    },
    consent: {
      accuracyConfirmed: requireConsent ? true : null,
      consent: requireConsent ? true : null,
    },
  };
}

export function derivePreConsultationFlags(answers) {
  const flags = [];
  const expiry = answers.canadaStatus.statusExpiryDate || answers.work.workPermitExpiryDate || answers.study.permitExpiryDate;
  if (expiry) {
    const days = Math.ceil((new Date(`${expiry}T00:00:00Z`).getTime() - Date.now()) / 86_400_000);
    if (days <= 90) flags.push({ type: "STATUS_EXPIRY", severity: days <= 30 ? "urgent" : "warning", date: expiry, days });
  }
  if (answers.immigrationHistory.hasPreviousRefusal) flags.push({ type: "PREVIOUS_REFUSAL", severity: "warning" });
  if (answers.urgency.hasActiveIssue) flags.push({ type: "ACTIVE_IMMIGRATION_ISSUE", severity: "urgent" });
  if (answers.urgency.hasDeadline) flags.push({ type: "UPCOMING_DEADLINE", severity: "urgent", date: answers.urgency.deadlineDate || null });
  if (answers.canadaStatus.currentStatus === "No Current Status") flags.push({ type: "NO_CURRENT_STATUS", severity: "urgent" });
  return flags;
}

function educationSummary(answers) {
  if (!answers.study.studiedInCanada) return null;
  return [answers.study.institution, answers.study.program, answers.study.completed ? "Completed" : answers.study.currentStudyStatus].filter(Boolean).join(" · ").slice(0, 1000) || null;
}

function workSummary(answers) {
  const parts = [];
  if (answers.work.currentlyWorkingInCanada) parts.push([answers.work.jobTitle, answers.work.employer, answers.work.canadianExperience].filter(Boolean).join(" · "));
  if (answers.work.foreignWorkExperience) parts.push(["Foreign", answers.work.foreignJobTitle, answers.work.foreignCountry].filter(Boolean).join(" · "));
  return parts.filter(Boolean).join(" | ").slice(0, 1000) || null;
}

function languageSummary(answers) {
  if (!answers.language.hasLanguageTest) return null;
  const scores = [
    answers.language.listening && `L ${answers.language.listening}`,
    answers.language.reading && `R ${answers.language.reading}`,
    answers.language.writing && `W ${answers.language.writing}`,
    answers.language.speaking && `S ${answers.language.speaking}`,
  ].filter(Boolean).join(", ");
  return [answers.language.testType, scores].filter(Boolean).join(" · ").slice(0, 500) || null;
}

async function mapEmptyLeadFields(tx, appointment, answers, flags) {
  if (!appointment.lead?.id) return;
  const lead = await tx.lead.findUnique({ where: { id: appointment.lead.id } });
  if (!lead) return;

  const currentStatus = answers.canadaStatus.currentStatus === "Other"
    ? answers.canadaStatus.currentStatusOther
    : answers.canadaStatus.currentStatus;
  if (!lead.currentImmigrationStatus && currentStatus) {
    await tx.lead.update({ where: { id: lead.id }, data: { currentImmigrationStatus: currentStatus } });
  }

  const existing = await tx.leadQualification.findUnique({ where: { leadId: lead.id } });
  // Qualification is a staff-completed assessment and requires an outcome +
  // staff actor. A public questionnaire must never create one implicitly.
  if (!existing) return;

  const candidate = {
    currentCountry: answers.identity.currentCountry,
    currentImmigrationStatus: currentStatus,
    statusExpiryDate: nullableDate(answers.canadaStatus.statusExpiryDate, "Status expiry date"),
    education: educationSummary(answers),
    workExperience: workSummary(answers),
    languageTest: languageSummary(answers),
    previousRefusals: answers.immigrationHistory.hasPreviousRefusal,
    familyStatus: answers.family.maritalStatus || null,
    urgency: flags.some((flag) => flag.severity === "urgent") ? "URGENT" : flags.length ? "HIGH" : null,
  };
  const data = {};
  for (const [key, value] of Object.entries(candidate)) {
    if ((existing[key] === null || existing[key] === "") && value !== null && value !== "") data[key] = value;
  }
  if (Object.keys(data).length) await tx.leadQualification.update({ where: { leadId: lead.id }, data });
}

export async function savePreConsultationSubmission(db, {
  appointment,
  body,
  actorUserId = null,
  source = "client",
  requireConsent = true,
  allowResubmit = false,
}) {
  const answers = validatePreConsultationAnswers(body, { requireConsent });
  const flags = derivePreConsultationFlags(answers);
  const submittedAt = new Date();

  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`pre-consultation-submit:${appointment.id}`}))`;
    const existing = await tx.appointmentEvent.findFirst({
      where: { appointmentId: appointment.id, type: PRE_CONSULTATION_EVENT.SUBMITTED },
      orderBy: { createdAt: "desc" },
    });
    if (existing && !allowResubmit) return { event: existing, flags, alreadySubmitted: true };

    const event = await recordAppointmentEvent(tx, {
      agencyId: appointment.agencyId,
      appointmentId: appointment.id,
      actorUserId,
      type: PRE_CONSULTATION_EVENT.SUBMITTED,
      summary: source === "staff_manual"
        ? (flags.some((flag) => flag.severity === "urgent") ? "Pre-consultation information entered manually with urgent review flag" : "Pre-consultation information entered manually")
        : (flags.some((flag) => flag.severity === "urgent") ? "Pre-consultation questionnaire submitted with urgent review flag" : "Pre-consultation questionnaire submitted"),
      metadata: {
        questionnaireVersion: 1,
        submittedAt: submittedAt.toISOString(),
        answers,
        flags,
        source,
        consentRecordedAt: requireConsent ? submittedAt.toISOString() : null,
        enteredByUserId: actorUserId,
      },
    });
    await mapEmptyLeadFields(tx, appointment, answers, flags);
    return { event, flags, alreadySubmitted: false };
  });
}
