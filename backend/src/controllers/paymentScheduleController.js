import prisma from "../services/prisma/client.js";
import { createHttpError } from "../utils/http.js";
import { recordActivity } from "../utils/prismaCrud.js";
import { PAYMENT_TEMPLATE_PLACEHOLDERS } from "../services/paymentNotificationService.js";
import {
  createCaseSchedule,
  createScheduleTemplate,
  deleteScheduleTemplate,
  getCaseSchedule,
  listScheduleTemplates,
  updateCaseInstallments,
  updateScheduleTemplate,
  voidRemainingInstallments,
} from "../services/paymentScheduleService.js";

function requireAdmin(req) {
  if (req.auth.role !== "admin") throw createHttpError(403, "Only workspace administrators can do this.", "FORBIDDEN");
}

export async function getPaymentCommunicationSettings(req, res) {
  const [agency, settings] = await Promise.all([
    prisma.agency.findUnique({ where: { id: req.auth.agencyId }, select: { paymentInstructions: true } }),
    prisma.agencyPaymentNotificationSettings.findUnique({ where: { agencyId: req.auth.agencyId } }),
  ]);
  res.json({
    data: {
      paymentInstructions: agency?.paymentInstructions || "",
      notifyByEmail: settings?.notifyByEmail ?? true,
      notifyBySms: settings?.notifyBySms ?? false,
      emailSubjectTemplate: settings?.emailSubjectTemplate || "",
      emailBodyTemplate: settings?.emailBodyTemplate || "",
      smsTemplate: settings?.smsTemplate || "",
      placeholders: PAYMENT_TEMPLATE_PLACEHOLDERS,
    },
  });
}

export async function updatePaymentCommunicationSettings(req, res) {
  if (req.auth.role !== "admin") throw createHttpError(403, "Only workspace administrators can change this.", "FORBIDDEN");
  const body = req.body || {};

  if (body.paymentInstructions !== undefined) {
    await prisma.agency.update({
      where: { id: req.auth.agencyId },
      data: { paymentInstructions: String(body.paymentInstructions || "").trim().slice(0, 4000) || null },
    });
  }

  const templateData = {};
  if (typeof body.notifyByEmail === "boolean") templateData.notifyByEmail = body.notifyByEmail;
  if (typeof body.notifyBySms === "boolean") templateData.notifyBySms = body.notifyBySms;
  if (body.emailSubjectTemplate !== undefined) templateData.emailSubjectTemplate = String(body.emailSubjectTemplate || "").trim().slice(0, 300) || null;
  if (body.emailBodyTemplate !== undefined) templateData.emailBodyTemplate = String(body.emailBodyTemplate || "").trim().slice(0, 4000) || null;
  if (body.smsTemplate !== undefined) templateData.smsTemplate = String(body.smsTemplate || "").trim().slice(0, 320) || null;

  if (Object.keys(templateData).length) {
    await prisma.agencyPaymentNotificationSettings.upsert({
      where: { agencyId: req.auth.agencyId },
      create: { agencyId: req.auth.agencyId, ...templateData },
      update: templateData,
    });
  }

  await recordActivity({
    agencyId: req.auth.agencyId,
    userId: req.auth.userId,
    action: "payment_settings.updated",
    details: "Payment instructions or notification templates updated",
  });

  return getPaymentCommunicationSettings(req, res);
}

export async function getTemplates(req, res) {
  const data = await listScheduleTemplates(req.auth.agencyId, req.query.caseType);
  res.json({ data });
}

export async function createTemplate(req, res) {
  requireAdmin(req);
  const data = await createScheduleTemplate(req.auth.agencyId, req.body || {});
  res.status(201).json({ data });
}

export async function updateTemplate(req, res) {
  requireAdmin(req);
  const data = await updateScheduleTemplate(req.auth.agencyId, req.params.templateId, req.body || {});
  res.json({ data });
}

export async function deleteTemplate(req, res) {
  requireAdmin(req);
  await deleteScheduleTemplate(req.auth.agencyId, req.params.templateId);
  res.json({ data: { deleted: true } });
}

export async function getSchedule(req, res) {
  const data = await getCaseSchedule(req.auth.agencyId, req.params.id);
  res.json({ data });
}

export async function createSchedule(req, res) {
  const data = await createCaseSchedule(req.auth.agencyId, {
    caseId: req.params.id,
    signingDate: req.body?.signingDate,
    installments: req.body?.installments,
    actorUserId: req.auth.userId,
  });
  res.status(201).json({ data });
}

export async function updateSchedule(req, res) {
  const data = await updateCaseInstallments(req.auth.agencyId, req.params.id, {
    installments: req.body?.installments,
    actorRole: req.auth.role,
    actorUserId: req.auth.userId,
  });
  res.json({ data });
}

export async function voidSchedule(req, res) {
  requireAdmin(req);
  const data = await voidRemainingInstallments(req.auth.agencyId, req.params.id, {
    reason: req.body?.reason,
    actorUserId: req.auth.userId,
  });
  res.json({ data });
}
