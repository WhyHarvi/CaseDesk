import prisma from "./prisma/client.js";
import { caseAccessWhere, clientAccessWhere } from "../middleware/authorization.js";
import { createHttpError } from "../utils/http.js";

export function appointmentProfileAccessWhere(req) {
  if (["admin", "frontdesk"].includes(req.auth.role)) return {};
  if (req.auth.role === "consultant") {
    return {
      OR: [
        { assignedToId: req.auth.userId },
        { client: clientAccessWhere(req) },
        { case: caseAccessWhere(req) },
      ],
    };
  }
  return { id: "__appointment_access_denied__" };
}

export const appointmentProfileInclude = {
  client: { select: { id: true, clientNumber: true, fullName: true, email: true, phone: true } },
  lead: { select: { id: true, leadNumber: true, firstName: true, lastName: true, email: true, phone: true } },
  case: { select: { id: true, caseType: true, stage: true, status: true } },
  assignedTo: { select: { id: true, fullName: true, email: true } },
  createdBy: { select: { id: true, fullName: true } },
  cancelledBy: { select: { id: true, fullName: true } },
  sessionType: true,
  events: {
    orderBy: { createdAt: "desc" },
    take: 100,
    include: { actor: { select: { id: true, fullName: true } } },
  },
  messageDeliveries: {
    select: { id: true, channel: true, kind: true, status: true, sentAt: true, failedAt: true, lastError: true, createdAt: true },
    orderBy: { createdAt: "desc" },
    take: 50,
  },
  paymentHold: {
    select: { id: true, status: true, amount: true, paidAt: true, qbInvoiceNumber: true },
  },
  notes: {
    orderBy: { createdAt: "desc" },
    include: { user: { select: { id: true, fullName: true, email: true } } },
  },
  followUps: {
    orderBy: [{ status: "asc" }, { dueDate: "asc" }, { createdAt: "desc" }],
    include: { assignedUser: { select: { id: true, fullName: true, email: true } } },
  },
};

export async function requireAppointmentProfile(req, appointmentId, db = prisma) {
  const data = await db.appointment.findFirst({
    where: {
      id: appointmentId,
      agencyId: req.auth.agencyId,
      ...appointmentProfileAccessWhere(req),
    },
    include: appointmentProfileInclude,
  });
  if (!data) throw createHttpError(404, "Appointment not found.", "NOT_FOUND");
  const clientAppointmentNotes = data.clientId && req.auth.role !== "frontdesk"
    ? await db.note.findMany({
        where: {
          clientId: data.clientId,
          appointmentId: { not: null },
          appointment: appointmentProfileAccessWhere(req),
        },
        orderBy: { createdAt: "desc" },
        include: {
          user: { select: { id: true, fullName: true, email: true } },
          appointment: { select: { id: true, subject: true, startsAt: true, status: true } },
        },
      })
    : [];
  return {
    ...data,
    purpose: data.purpose || data.description || null,
    internalNotes: req.auth.role === "frontdesk" ? null : data.internalNotes,
    notes: req.auth.role === "frontdesk" ? [] : data.notes,
    followUps: req.auth.role === "frontdesk" ? [] : data.followUps,
    clientAppointmentNotes,
  };
}

export async function ensureAppointmentCompletionFollowUp(db, appointment) {
  if (!appointment?.id || (!appointment.clientId && !appointment.caseId) || !appointment.assignedToId) return null;
  const existing = await db.followUp.findFirst({
    where: { appointmentId: appointment.id, status: { in: ["Pending", "Overdue"] } },
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
      description: "Review the appointment outcome, next steps, and any information the client still needs to provide.",
      dueDate,
      reminderAt: dueDate,
      notificationChannels: ["in_app"],
      status: "Pending",
    },
  });
}
