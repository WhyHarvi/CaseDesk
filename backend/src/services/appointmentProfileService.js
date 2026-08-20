import prisma from "./prisma/client.js";
import {
  caseAccessWhere,
  clientAccessWhere,
} from "../middleware/authorization.js";
import { createHttpError } from "../utils/http.js";
import { hasPortalCapability, portalDataScope } from "./portalAccessService.js";
import { PRE_CONSULTATION_EVENT, preConsultationStatus } from "./preConsultationIntakeService.js";

export function appointmentProfileAccessWhere(req) {
  if (["admin", "frontdesk"].includes(req.auth.role)) return {};
  if (req.auth.role === "consultant") {
    const branches = [{ assignedToId: req.auth.userId }];
    const clientScope = portalDataScope(req, "clients");
    const caseScope = portalDataScope(req, "cases");
    if (clientScope === "all") branches.push({ clientId: { not: null } });
    else if (clientScope === "assigned") branches.push({ client: clientAccessWhere(req) });
    if (caseScope === "all") branches.push({ caseId: { not: null } });
    else if (caseScope === "assigned") branches.push({ case: caseAccessWhere(req) });
    return { OR: branches };
  }
  return { id: "__appointment_access_denied__" };
}

export const appointmentProfileInclude = {
  client: {
    select: {
      id: true,
      clientNumber: true,
      fullName: true,
      email: true,
      phone: true,
    },
  },
  lead: {
    select: {
      id: true,
      leadNumber: true,
      firstName: true,
      lastName: true,
      email: true,
      phone: true,
    },
  },
  case: { select: { id: true, caseType: true, stage: true, status: true } },
  assignedTo: { select: { id: true, fullName: true, email: true } },
  createdBy: { select: { id: true, fullName: true } },
  cancelledBy: { select: { id: true, fullName: true } },
  sessionType: true,
  leadConsultation: true,
  events: {
    orderBy: { createdAt: "desc" },
    take: 100,
    include: { actor: { select: { id: true, fullName: true } } },
  },
  messageDeliveries: {
    select: {
      id: true,
      channel: true,
      kind: true,
      status: true,
      sentAt: true,
      failedAt: true,
      lastError: true,
      createdAt: true,
    },
    orderBy: { createdAt: "desc" },
    take: 50,
  },
  paymentHold: {
    select: {
      id: true,
      status: true,
      amount: true,
      paidAt: true,
      qbInvoiceNumber: true,
    },
  },
  notes: {
    where: { deletedAt: null },
    orderBy: { createdAt: "desc" },
    include: { user: { select: { id: true, fullName: true, email: true } } },
  },
  followUps: {
    orderBy: [{ status: "asc" }, { dueDate: "asc" }, { createdAt: "desc" }],
    include: {
      assignedUser: { select: { id: true, fullName: true, email: true } },
    },
  },
};

function intakeSummary(appointmentId, events = []) {
  const intakeEvents = events.filter((event) => String(event.type || "").startsWith("PRE_CONSULTATION_INTAKE_"));
  const submitted = intakeEvents.find((event) => event.type === PRE_CONSULTATION_EVENT.SUBMITTED);
  const opened = intakeEvents.find((event) => event.type === PRE_CONSULTATION_EVENT.OPENED);
  const sent = intakeEvents.find((event) => event.type === PRE_CONSULTATION_EVENT.DELIVERY_SENT)
    || intakeEvents.find((event) => event.type === PRE_CONSULTATION_EVENT.DELIVERY_PARTIAL);
  const delivery = sent?.metadata && typeof sent.metadata === "object" ? sent.metadata : {};
  const submission = submitted?.metadata && typeof submitted.metadata === "object" ? submitted.metadata : {};
  return {
    appointmentId,
    status: preConsultationStatus(intakeEvents),
    sentAt: sent?.createdAt || null,
    openedAt: opened?.createdAt || null,
    submittedAt: submitted?.createdAt || null,
    emailStatus: delivery.emailStatus || null,
    smsStatus: delivery.smsStatus || null,
    questionnaireVersion: submission.questionnaireVersion || delivery.questionnaireVersion || 1,
    answers: submission.answers || null,
    flags: Array.isArray(submission.flags) ? submission.flags : [],
    source: submission.source || null,
    consentRecordedAt: submission.consentRecordedAt || null,
    enteredByUserId: submission.enteredByUserId || null,
  };
}

export async function requireAppointmentProfile(
  req,
  appointmentId,
  db = prisma,
) {
  const data = await db.appointment.findFirst({
    where: {
      id: appointmentId,
      agencyId: req.auth.agencyId,
      ...appointmentProfileAccessWhere(req),
    },
    include: appointmentProfileInclude,
  });
  if (!data) throw createHttpError(404, "Appointment not found.", "NOT_FOUND");
  const canAccessInternalNotes = hasPortalCapability(req, "internalNotes");
  const clientNotes = !canAccessInternalNotes
    ? []
    : data.clientId
      ? await db.note.findMany({
          where: {
            clientId: data.clientId,
            deletedAt: null,
            OR: [
              {
                appointmentId: { not: null },
                appointment: appointmentProfileAccessWhere(req),
              },
              {
                appointmentId: null,
                caseId: null,
                ...(req.auth.role === "admin"
                  ? {}
                  : { client: clientAccessWhere(req) }),
              },
            ],
          },
          orderBy: { createdAt: "desc" },
          include: {
            user: { select: { id: true, fullName: true, email: true } },
            appointment: {
              select: { id: true, subject: true, startsAt: true, status: true },
            },
          },
        })
      : data.notes;
  return {
    ...data,
    purpose: data.purpose || data.description || null,
    internalNotes: canAccessInternalNotes ? data.internalNotes : null,
    notes: canAccessInternalNotes ? data.notes : [],
    events: !canAccessInternalNotes
      ? (data.events || []).filter(
          (event) => !String(event.type || "").startsWith("NOTE_"),
        )
      : data.events,
    followUps: req.auth.role === "frontdesk" ? [] : data.followUps,
    clientNotes,
    preConsultationIntake: intakeSummary(data.id, data.events || []),
  };
}

export async function ensureAppointmentCompletionFollowUp(db, appointment) {
  if (
    !appointment?.id ||
    (!appointment.clientId && !appointment.caseId) ||
    !appointment.assignedToId
  )
    return null;
  const existing = await db.followUp.findFirst({
    where: {
      appointmentId: appointment.id,
      status: "Pending",
    },
  });
  if (existing) return existing;
  const dueDate = new Date(Date.now() + 24 * 60 * 60_000);
  return db.followUp.create({
    data: {
      agencyId: appointment.agencyId,
      appointmentId: appointment.id,
      clientId: appointment.clientId,
      caseId: appointment.caseId,
      assignedUserId: appointment.assignedToId,
      title: `Follow up after ${appointment.subject || "appointment"}`,
      description:
        "Review the appointment outcome, next steps, and any information the client still needs to provide.",
      dueDate,
      reminderAt: dueDate,
      notificationChannels: ["in_app"],
      status: "Pending",
    },
  });
}
