import prisma from "../services/prisma/client.js";
import {
  AUTOMATED_REMINDER_DEFAULTS,
  AUTOMATED_REMINDER_KINDS,
  automatedReminderSettings,
  ensureAutomatedReminderPolicies,
  renderAutomatedReminderPreview,
} from "../services/automatedReminderService.js";
import { createHttpError } from "../utils/http.js";

function kindValue(value) {
  const kind = AUTOMATED_REMINDER_KINDS.find((item) => item.toLowerCase() === String(value || "").toLowerCase());
  if (!kind) throw createHttpError(400, "Choose a valid reminder type.", "VALIDATION_ERROR");
  return kind;
}

function intValue(value, field, min, max) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < min || number > max) {
    throw createHttpError(400, `${field} must be between ${min} and ${max}.`, "VALIDATION_ERROR");
  }
  return number;
}

function templateValue(value, field, max) {
  const text = String(value || "").trim();
  if (!text || text.length > max) throw createHttpError(400, `${field} is required and must be ${max} characters or fewer.`, "VALIDATION_ERROR");
  return text;
}

export async function getAutomatedReminderSettings(req, res) {
  res.json({ data: await automatedReminderSettings(req.auth.agencyId) });
}

export async function updateAutomatedReminderPolicy(req, res) {
  const kind = kindValue(req.params.kind);
  await ensureAutomatedReminderPolicies(req.auth.agencyId);
  const current = await prisma.automatedReminderPolicy.findUnique({
    where: { agencyId_kind: { agencyId: req.auth.agencyId, kind } },
  });
  const input = req.body || {};
  const data = {
    ...(input.enabled !== undefined ? { enabled: Boolean(input.enabled) } : {}),
    ...(input.cadenceDays !== undefined ? { cadenceDays: intValue(input.cadenceDays, "Reminder interval", 1, 90) } : {}),
    ...(input.maxReminders !== undefined ? { maxReminders: intValue(input.maxReminders, "Maximum reminders", 1, 12) } : {}),
    ...(input.defaultDueDays !== undefined ? { defaultDueDays: intValue(input.defaultDueDays, "Default due period", 1, 365) } : {}),
    ...(input.emailEnabled !== undefined ? { emailEnabled: Boolean(input.emailEnabled) } : {}),
    ...(input.smsEnabled !== undefined ? { smsEnabled: Boolean(input.smsEnabled) } : {}),
    ...(input.subjectTemplate !== undefined ? { subjectTemplate: templateValue(input.subjectTemplate, "Email subject", 240) } : {}),
    ...(input.messageTemplate !== undefined ? { messageTemplate: templateValue(input.messageTemplate, "Email message", 6000) } : {}),
    ...(input.smsTemplate !== undefined ? { smsTemplate: templateValue(input.smsTemplate, "SMS message", 800) } : {}),
  };
  const merged = { ...current, ...data };
  if (!merged.emailEnabled && !merged.smsEnabled) {
    throw createHttpError(400, "Keep email or SMS enabled so reminders have a client delivery channel.", "VALIDATION_ERROR");
  }
  await prisma.automatedReminderPolicy.update({ where: { id: current.id }, data });
  res.json({ data: await automatedReminderSettings(req.auth.agencyId) });
}

export async function previewAutomatedReminderPolicy(req, res) {
  const kind = kindValue(req.params.kind);
  const defaults = AUTOMATED_REMINDER_DEFAULTS[kind];
  const policy = {
    kind,
    maxReminders: intValue(req.body?.maxReminders ?? 3, "Maximum reminders", 1, 12),
    subjectTemplate: templateValue(req.body?.subjectTemplate ?? defaults.subjectTemplate, "Email subject", 240),
    messageTemplate: templateValue(req.body?.messageTemplate ?? defaults.messageTemplate, "Email message", 6000),
    smsTemplate: templateValue(req.body?.smsTemplate ?? defaults.smsTemplate, "SMS message", 800),
  };
  const agency = await prisma.agency.findUnique({ where: { id: req.auth.agencyId }, select: { name: true, legalName: true } });
  res.json({ data: renderAutomatedReminderPreview(policy, agency?.legalName || agency?.name) });
}
