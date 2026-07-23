import prisma from "../services/prisma/client.js";
import {
  EXPIRING_DOCUMENT_DEFINITIONS,
  EXPIRY_DEFAULT_TEMPLATES,
  ensureExpiringDocumentPolicies,
  expiringDocumentSettings,
  renderExpiryReminderPreview,
} from "../services/expiringDocumentReminderService.js";
import { createHttpError } from "../utils/http.js";

const validKeys = new Set(EXPIRING_DOCUMENT_DEFINITIONS.map((item) => item.key));

function documentKey(value) {
  const key = String(value || "").toLowerCase();
  if (!validKeys.has(key)) throw createHttpError(400, "Choose a valid expiring document type.", "VALIDATION_ERROR");
  return key;
}

function integer(value, label, min, max) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < min || number > max) throw createHttpError(400, `${label} must be between ${min} and ${max}.`, "VALIDATION_ERROR");
  return number;
}

function template(value, label, max) {
  const text = String(value || "").trim();
  if (!text || text.length > max) throw createHttpError(400, `${label} is required and must be ${max} characters or fewer.`, "VALIDATION_ERROR");
  return text;
}

export async function getExpiringDocumentReminderSettings(req, res) {
  res.json({ data: await expiringDocumentSettings(req.auth.agencyId) });
}

export async function updateExpiringDocumentReminderPolicy(req, res) {
  const key = documentKey(req.params.documentKey);
  await ensureExpiringDocumentPolicies(req.auth.agencyId);
  const current = await prisma.expiringDocumentReminderPolicy.findUnique({
    where: { agencyId_documentKey: { agencyId: req.auth.agencyId, documentKey: key } },
  });
  const input = req.body || {};
  const data = {
    ...(input.enabled !== undefined ? { enabled: Boolean(input.enabled) } : {}),
    ...(input.notifyClient !== undefined ? { notifyClient: Boolean(input.notifyClient) } : {}),
    ...(input.leadDays !== undefined ? { leadDays: integer(input.leadDays, "Reminder window", 1, 730) } : {}),
    ...(input.cadenceDays !== undefined ? { cadenceDays: integer(input.cadenceDays, "Reminder interval", 1, 365) } : {}),
    ...(input.maxReminders !== undefined ? { maxReminders: integer(input.maxReminders, "Maximum reminders", 1, 12) } : {}),
    ...(input.emailEnabled !== undefined ? { emailEnabled: Boolean(input.emailEnabled) } : {}),
    ...(input.smsEnabled !== undefined ? { smsEnabled: Boolean(input.smsEnabled) } : {}),
    ...(input.subjectTemplate !== undefined ? { subjectTemplate: template(input.subjectTemplate, "Email subject", 240) } : {}),
    ...(input.messageTemplate !== undefined ? { messageTemplate: template(input.messageTemplate, "Email message", 6000) } : {}),
    ...(input.smsTemplate !== undefined ? { smsTemplate: template(input.smsTemplate, "SMS message", 800) } : {}),
  };
  const merged = { ...current, ...data };
  if (merged.notifyClient && !merged.emailEnabled && !merged.smsEnabled) throw createHttpError(400, "Keep email or SMS enabled when client notifications are on.", "VALIDATION_ERROR");
  await prisma.expiringDocumentReminderPolicy.update({ where: { id: current.id }, data });
  res.json({ data: await expiringDocumentSettings(req.auth.agencyId) });
}

export async function previewExpiringDocumentReminder(req, res) {
  const key = documentKey(req.params.documentKey);
  const input = req.body || {};
  const policy = {
    documentKey: key,
    leadDays: integer(input.leadDays ?? 183, "Reminder window", 1, 730),
    subjectTemplate: template(input.subjectTemplate ?? EXPIRY_DEFAULT_TEMPLATES.subjectTemplate, "Email subject", 240),
    messageTemplate: template(input.messageTemplate ?? EXPIRY_DEFAULT_TEMPLATES.messageTemplate, "Email message", 6000),
    smsTemplate: template(input.smsTemplate ?? EXPIRY_DEFAULT_TEMPLATES.smsTemplate, "SMS message", 800),
  };
  const agency = await prisma.agency.findUnique({ where: { id: req.auth.agencyId }, select: { name: true, legalName: true } });
  res.json({ data: renderExpiryReminderPreview(policy, agency?.legalName || agency?.name) });
}
