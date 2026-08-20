import prisma from "../services/prisma/client.js";
import { createHttpError } from "../utils/http.js";
import { recordAppointmentEvent } from "../services/appointmentOperationsService.js";
import {
  getManagedPreConsultationAppointment,
  PRE_CONSULTATION_EVENT,
} from "../services/preConsultationIntakeService.js";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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

function contactFor(appointment) {
  const leadName = [appointment.lead?.firstName, appointment.lead?.lastName].filter(Boolean).join(" ").trim();
  return {
    name: appointment.guestName || appointment.client?.fullName || leadName || "Client",
    email: appointment.guestEmail || appointment.client?.email || appointment.lead?.email || null,
    phone: appointment.guestPhone || appointment.client?.phone || appointment.lead?.phone || null,
  };
}

function validateAnswers(body = {}) {
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
  if (!bool(body.accuracyConfirmed)) throw createHttpError(400, "Confirm that the information is accurate to the best of your knowledge.", "CONSENT_REQUIRED");
  if (!bool(body.consent)) throw createHttpError(400, "Consent is required before submitting the questionnaire.", "CONSENT_REQUIRED");

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
    identity: {
      legalName,
      dateOfBirth,
      citizenship,
      currentCountry,
    },
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
      accuracyConfirmed: true,
      consent: true,
    },
  };
}

function deriveFlags(answers) {
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

  const leadData = {};
  const currentStatus = answers.canadaStatus.currentStatus === "Other"
    ? answers.canadaStatus.currentStatusOther
    : answers.canadaStatus.currentStatus;
  if (!lead.currentImmigrationStatus && currentStatus) leadData.currentImmigrationStatus = currentStatus;
  if (Object.keys(leadData).length) await tx.lead.update({ where: { id: lead.id }, data: leadData });

  const existing = await tx.leadQualification.findUnique({ where: { leadId: lead.id } });
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

  if (!existing) {
    await tx.leadQualification.create({
      data: {
        agencyId: appointment.agencyId,
        leadId: lead.id,
        ...Object.fromEntries(Object.entries(candidate).filter(([, value]) => value !== null && value !== "")),
      },
    });
    return;
  }
  const data = {};
  for (const [key, value] of Object.entries(candidate)) {
    if ((existing[key] === null || existing[key] === "") && value !== null && value !== "") data[key] = value;
  }
  if (Object.keys(data).length) await tx.leadQualification.update({ where: { leadId: lead.id }, data });
}

export async function getPreConsultationIntake(req, res) {
  const appointment = await getManagedPreConsultationAppointment(req.params.manageToken);
  if (!appointment || appointment.status !== "Scheduled") throw createHttpError(404, "This questionnaire is not available.", "INTAKE_NOT_FOUND");

  const events = await prisma.appointmentEvent.findMany({
    where: { appointmentId: appointment.id, type: { in: [PRE_CONSULTATION_EVENT.OPENED, PRE_CONSULTATION_EVENT.SUBMITTED] } },
    orderBy: { createdAt: "desc" },
    take: 5,
  });
  const submission = events.find((event) => event.type === PRE_CONSULTATION_EVENT.SUBMITTED);
  if (!events.some((event) => event.type === PRE_CONSULTATION_EVENT.OPENED)) {
    await recordAppointmentEvent(prisma, {
      agencyId: appointment.agencyId,
      appointmentId: appointment.id,
      type: PRE_CONSULTATION_EVENT.OPENED,
      summary: "Pre-consultation questionnaire opened",
      metadata: { questionnaireVersion: 1 },
    });
  }
  const contact = contactFor(appointment);
  res.json({
    data: {
      agency: { name: appointment.agency.legalName || appointment.agency.name, logoUrl: appointment.agency.logoUrl || null },
      appointment: {
        subject: appointment.subject,
        startsAt: appointment.startsAt,
        timezone: appointment.bookingSettings?.timezone || "America/Toronto",
        sessionType: appointment.sessionType?.name || null,
      },
      contact: { name: contact.name, email: contact.email && EMAIL_PATTERN.test(contact.email) ? contact.email : null, phone: contact.phone },
      status: submission ? "Submitted" : "Open",
      submittedAt: submission?.createdAt || null,
      questionnaireVersion: 1,
    },
  });
}

export async function submitPreConsultationIntake(req, res) {
  const appointment = await getManagedPreConsultationAppointment(req.params.manageToken);
  if (!appointment || appointment.status !== "Scheduled") throw createHttpError(404, "This questionnaire is not available.", "INTAKE_NOT_FOUND");
  if (new Date(appointment.startsAt).getTime() + 24 * 60 * 60_000 < Date.now()) {
    throw createHttpError(410, "This questionnaire has expired. Please contact the agency if you still need to provide information.", "INTAKE_EXPIRED");
  }

  const answers = validateAnswers(req.body || {});
  const flags = deriveFlags(answers);
  const existing = await prisma.appointmentEvent.findFirst({
    where: { appointmentId: appointment.id, type: PRE_CONSULTATION_EVENT.SUBMITTED },
    orderBy: { createdAt: "desc" },
  });
  if (existing) return res.json({ data: { submitted: true, submittedAt: existing.createdAt, alreadySubmitted: true } });

  const submittedAt = new Date();
  const result = await prisma.$transaction(async (tx) => {
    const concurrent = await tx.appointmentEvent.findFirst({
      where: { appointmentId: appointment.id, type: PRE_CONSULTATION_EVENT.SUBMITTED },
      orderBy: { createdAt: "desc" },
    });
    if (concurrent) return concurrent;

    const event = await recordAppointmentEvent(tx, {
      agencyId: appointment.agencyId,
      appointmentId: appointment.id,
      type: PRE_CONSULTATION_EVENT.SUBMITTED,
      summary: flags.some((flag) => flag.severity === "urgent")
        ? "Pre-consultation questionnaire submitted with urgent review flag"
        : "Pre-consultation questionnaire submitted",
      metadata: {
        questionnaireVersion: 1,
        submittedAt: submittedAt.toISOString(),
        answers,
        flags,
        consentRecordedAt: submittedAt.toISOString(),
      },
    });
    await mapEmptyLeadFields(tx, appointment, answers, flags);
    return event;
  });

  res.status(201).json({
    data: {
      submitted: true,
      submittedAt: result.createdAt,
      flagsRecorded: flags.length,
      message: "Thank you. Your information has been sent securely to your consultation team.",
    },
  });
}
