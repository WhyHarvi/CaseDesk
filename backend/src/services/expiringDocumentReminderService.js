import { createHash } from "node:crypto";
import prisma from "./prisma/client.js";
import { createMailTransport, resolveAgencyMailConfig } from "./agencyMailService.js";
import { sendAgencyOomaSms } from "./agencyOomaService.js";
import { adminRecipientIds, clientRecipientIds, internalCaseRecipientIds, notifyUsers } from "./notificationService.js";
import { logger } from "./logger.js";

const DAY_MS = 86_400_000;
let expiryRunning = false;

export const EXPIRING_DOCUMENT_DEFINITIONS = [
  ["biometrics", "Biometrics", ["biometrics", "biometric"]],
  ["copr", "Confirmation of Permanent Residence (COPR)", ["confirmation of permanent residence", "copr"]],
  ["eta", "Electronic travel authorization (eTA)", ["electronic travel authorization", "eta"]],
  ["lmia", "Labour Market Impact Assessment (LMIA)", ["labour market impact assessment", "labor market impact assessment", "lmia"]],
  ["national-id", "National ID", ["national identity document", "national identity card", "national id"]],
  ["nomination-endorsement", "Nomination/Endorsement", ["nomination endorsement", "nomination", "endorsement"]],
  ["passport", "Passport", ["passport"]],
  ["pr-card", "Permanent Resident Card", ["permanent resident card", "canadian pr card", "pr card"]],
  ["prtd", "Permanent Resident Travel Document (PRTD)", ["permanent resident travel document", "prtd"]],
  ["pgwp", "Post Grad Work Permit (PGWP)", ["post graduation work permit", "post grad work permit", "pgwp"]],
  ["rpcd", "Refugee Protection Claimant Document (RPCD)", ["refugee protection claimant document", "rpcd"]],
  ["rpid", "Refugee Protection Identity Document (RPID)", ["refugee protection identity document", "rpid"]],
  ["study-permit", "Study Permit", ["study permit"]],
  ["study-visa", "Study Visa", ["study visa", "student visa"]],
  ["trp", "Temporary Resident Permit (TRP)", ["temporary resident permit", "trp"]],
  ["us-pr-card", "US PR Card", ["us permanent resident card", "united states permanent resident card", "us pr card", "green card"]],
  ["vos", "Verification of Status (VOS)", ["verification of status", "vos"]],
  ["visitor-record", "Visitor Record", ["visitor record"]],
  ["visitor-visa", "Visitor Visa", ["visitor visa", "temporary resident visa", "trv"]],
  ["work-permit", "Work Permit", ["work permit", "open work permit", "closed work permit"]],
  ["worker-visa", "Worker Visa", ["worker visa", "work visa"]],
].map(([key, name, aliases]) => ({ key, name, aliases }));

export const EXPIRY_TEMPLATE_PLACEHOLDERS = ["clientName", "agencyName", "documentName", "expirationDate", "daysRemaining", "portalLink", "reminderNumber"];
export const EXPIRY_DEFAULT_TEMPLATES = {
  subjectTemplate: "Upcoming expiration — {{documentName}}",
  messageTemplate: "Hello {{clientName}},\n\nYour {{documentName}} is scheduled to expire on {{expirationDate}} ({{daysRemaining}} days from now).\n\nPlease contact your case team if you need help renewing or replacing it: {{portalLink}}\n\n{{agencyName}}",
  smsTemplate: "{{agencyName}}: Your {{documentName}} expires {{expirationDate}}. Contact your case team: {{portalLink}}",
};

const definitionByKey = new Map(EXPIRING_DOCUMENT_DEFINITIONS.map((item) => [item.key, item]));

function fillTemplate(template, values) {
  return String(template || "").replace(/\{\{\s*(\w+)\s*\}\}/g, (match, key) => (
    Object.hasOwn(values, key) ? String(values[key] ?? "") : match
  ));
}

function normalize(value) {
  return String(value || "").toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").trim();
}

export function classifyExpiringDocumentType(value) {
  const candidate = normalize(value);
  if (!candidate) return null;
  for (const definition of EXPIRING_DOCUMENT_DEFINITIONS) {
    if (definition.aliases.some((alias) => candidate === normalize(alias))) return definition.key;
  }
  for (const definition of EXPIRING_DOCUMENT_DEFINITIONS) {
    if (definition.aliases.some((alias) => normalize(alias).length >= 4 && candidate.includes(normalize(alias)))) return definition.key;
  }
  return null;
}

function validDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function documentRows(data) {
  if (!data || typeof data !== "object") return [];
  if (Array.isArray(data.documents)) return data.documents;
  if (Array.isArray(data.identityPermits?.documents)) return data.identityPermits.documents;
  return [];
}

function addRecord(map, { client, caseId = null, documentType, documentNumber = null, expiryDate, source }) {
  const documentKey = classifyExpiringDocumentType(documentType);
  const expiresAt = validDate(expiryDate);
  if (!client?.id || !documentKey || !expiresAt) return;
  const signature = [client.id, documentKey, expiresAt.toISOString().slice(0, 10)].join("|");
  const targetKey = createHash("sha256").update(signature).digest("hex");
  if (!map.has(targetKey)) {
    map.set(targetKey, {
      targetKey,
      clientId: client.id,
      caseId,
      documentKey,
      documentName: definitionByKey.get(documentKey).name,
      documentNumber: documentNumber || null,
      expiresAt,
      source,
      client,
    });
  } else if (!map.get(targetKey).caseId && caseId) {
    map.get(targetKey).caseId = caseId;
  }
}

export function extractExpiringDocumentRecords({ clients = [], clientProfiles = [], caseProfiles = [], assessments = [] }) {
  const records = new Map();
  for (const client of clients) {
    addRecord(records, {
      client,
      documentType: client.identificationType,
      documentNumber: client.identificationNumber,
      expiryDate: client.identificationExpiryDate,
      source: "client",
    });
  }
  for (const profile of clientProfiles) {
    for (const document of documentRows(profile.data)) {
      addRecord(records, {
        client: profile.client,
        documentType: document.documentType,
        documentNumber: document.documentNumber,
        expiryDate: document.expiryDate,
        source: "client_profile",
      });
    }
  }
  for (const profile of caseProfiles) {
    const data = profile.data || {};
    addRecord(records, {
      client: profile.client,
      caseId: profile.caseId,
      documentType: data.currentStatus,
      expiryDate: data.statusExpiry,
      source: "case_profile",
    });
  }
  for (const assessment of assessments) {
    for (const document of documentRows(assessment.formData)) {
      addRecord(records, {
        client: assessment.client,
        caseId: assessment.caseId,
        documentType: document.documentType,
        documentNumber: document.documentNumber,
        expiryDate: document.expiryDate,
        source: "legacy_assessment",
      });
    }
    const status = assessment.formData?.profileQuestionnaires?.canadianStatus;
    addRecord(records, {
      client: assessment.client,
      caseId: assessment.caseId,
      documentType: status?.currentStatus,
      expiryDate: status?.statusExpiry,
      source: "legacy_assessment",
    });
  }
  return [...records.values()];
}

async function sourceRecords(agencyId) {
  const clientSelect = { id: true, fullName: true, email: true, phone: true, assignedUserId: true };
  const [clients, clientProfiles, caseProfiles, assessments] = await Promise.all([
    prisma.client.findMany({
      where: { agencyId, archivedAt: null, identificationExpiryDate: { not: null } },
      take: 5000,
      select: { ...clientSelect, identificationType: true, identificationNumber: true, identificationExpiryDate: true },
    }),
    prisma.clientInformationProfile.findMany({
      where: { agencyId, sectionKey: "identityPermits" },
      take: 5000,
      select: { data: true, client: { select: clientSelect } },
    }),
    prisma.caseInformationProfile.findMany({
      where: { agencyId, sectionKey: "canadianStatus", case: { deletedAt: null } },
      take: 5000,
      select: { caseId: true, data: true, client: { select: clientSelect } },
    }),
    prisma.caseAssessment.findMany({
      where: { agencyId, case: { deletedAt: null } },
      take: 5000,
      select: { caseId: true, formData: true, client: { select: clientSelect } },
    }),
  ]);
  return extractExpiringDocumentRecords({ clients, clientProfiles, caseProfiles, assessments });
}

export async function ensureExpiringDocumentPolicies(agencyId) {
  await prisma.expiringDocumentReminderPolicy.createMany({
    data: EXPIRING_DOCUMENT_DEFINITIONS.map((definition) => ({
      agencyId,
      documentKey: definition.key,
      enabled: false,
      notifyClient: true,
      leadDays: 183,
      cadenceDays: 30,
      maxReminders: 1,
      emailEnabled: true,
      smsEnabled: false,
      ...EXPIRY_DEFAULT_TEMPLATES,
    })),
    skipDuplicates: true,
  });
  return prisma.expiringDocumentReminderPolicy.findMany({ where: { agencyId } });
}

function frontendBase() {
  return String(process.env.FRONTEND_URL || "http://localhost:5173").split(",")[0].trim().replace(/\/$/, "");
}

function previewValues(policy, agencyName) {
  const expiresAt = new Date(Date.now() + policy.leadDays * DAY_MS);
  return {
    clientName: "Alex Morgan",
    agencyName: agencyName || "Your immigration practice",
    documentName: definitionByKey.get(policy.documentKey)?.name || "Immigration document",
    expirationDate: expiresAt.toLocaleDateString("en-CA", { month: "long", day: "numeric", year: "numeric" }),
    daysRemaining: policy.leadDays,
    portalLink: `${frontendBase()}/client-portal`,
    reminderNumber: 1,
  };
}

export function renderExpiryReminderPreview(policy, agencyName) {
  const values = previewValues(policy, agencyName);
  return {
    subject: fillTemplate(policy.subjectTemplate, values),
    message: fillTemplate(policy.messageTemplate, values),
    sms: fillTemplate(policy.smsTemplate, values),
    sample: values,
  };
}

export async function expiringDocumentSettings(agencyId) {
  const [policies, agency, stats] = await Promise.all([
    ensureExpiringDocumentPolicies(agencyId),
    prisma.agency.findUnique({ where: { id: agencyId }, select: { name: true, legalName: true } }),
    prisma.expiringDocumentReminderDelivery.groupBy({
      by: ["policyId"],
      where: { agencyId, status: "sent" },
      _count: { _all: true },
      _max: { sentAt: true },
    }),
  ]);
  const statsByPolicy = new Map(stats.map((item) => [item.policyId, item]));
  const policiesByKey = new Map(policies.map((item) => [item.documentKey, item]));
  return {
    policies: EXPIRING_DOCUMENT_DEFINITIONS.map((definition) => {
      const policy = policiesByKey.get(definition.key);
      const policyStats = statsByPolicy.get(policy.id);
      return {
        ...policy,
        documentName: definition.name,
        sentCount: policyStats?._count?._all || 0,
        lastSentAt: policyStats?._max?.sentAt || null,
        preview: renderExpiryReminderPreview(policy, agency?.legalName || agency?.name),
      };
    }),
    placeholders: EXPIRY_TEMPLATE_PLACEHOLDERS,
  };
}

function valuesFor(record, policy, agencyName, sequence, now) {
  return {
    clientName: record.client.fullName || "there",
    agencyName,
    documentName: record.documentName,
    expirationDate: record.expiresAt.toLocaleDateString("en-CA", { month: "long", day: "numeric", year: "numeric" }),
    daysRemaining: Math.max(0, Math.ceil((record.expiresAt.getTime() - now.getTime()) / DAY_MS)),
    portalLink: `${frontendBase()}/client-portal`,
    reminderNumber: sequence,
  };
}

function escapeHtml(value) {
  return String(value || "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character]);
}

async function deliverExpiryReminder({ policy, delivery, record, agencyName, now }) {
  const values = valuesFor(record, policy, agencyName, delivery.sequence, now);
  const clientSuccesses = [];
  const failures = [];
  const update = {};

  if (policy.notifyClient && policy.emailEnabled && record.client.email) {
    try {
      const config = await resolveAgencyMailConfig(policy.agencyId);
      const message = fillTemplate(policy.messageTemplate, values);
      await createMailTransport(config).sendMail({
        from: config.from,
        to: record.client.email,
        subject: fillTemplate(policy.subjectTemplate, values),
        text: message,
        html: `<div style="max-width:560px;margin:0 auto;padding:32px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#0f172a;line-height:1.65"><div style="font-size:12px;color:#64748b;margin-bottom:18px">${escapeHtml(agencyName)}</div><div style="white-space:pre-wrap">${escapeHtml(message)}</div></div>`,
      });
      update.emailSentAt = new Date();
      clientSuccesses.push("email");
    } catch (error) {
      failures.push(`Email: ${error.message}`);
    }
  }
  if (policy.notifyClient && policy.smsEnabled && record.client.phone) {
    try {
      await sendAgencyOomaSms({
        agencyId: policy.agencyId,
        to: record.client.phone,
        body: fillTemplate(policy.smsTemplate, values).slice(0, 500),
        idempotencyKey: `expiry-reminder:${delivery.id}:sms`,
      });
      update.smsSentAt = new Date();
      clientSuccesses.push("sms");
    } catch (error) {
      failures.push(`SMS: ${error.message}`);
    }
  }
  if (policy.notifyClient) {
    try {
      const recipients = await clientRecipientIds(policy.agencyId, record.clientId);
      if (recipients.length) {
        await notifyUsers({
          agencyId: policy.agencyId,
          recipientIds: recipients,
          type: "document.expiring",
          category: "documents",
          title: `${record.documentName} expires soon`,
          body: `Expires ${values.expirationDate}`,
          severity: "warning",
          entityType: "client",
          entityId: record.clientId,
          actionUrl: "/client-portal",
          channels: ["in_app"],
          dedupeKey: `expiry-reminder:${policy.id}:${record.targetKey}:${delivery.sequence}:client`,
        });
        update.portalSentAt = new Date();
        clientSuccesses.push("portal");
      }
    } catch (error) {
      failures.push(`Portal: ${error.message}`);
    }
  }

  try {
    const staff = new Set(record.caseId ? await internalCaseRecipientIds(policy.agencyId, record.caseId) : []);
    if (record.client.assignedUserId) staff.add(record.client.assignedUserId);
    if (!staff.size) (await adminRecipientIds(policy.agencyId)).forEach((id) => staff.add(id));
    if (staff.size) {
      await notifyUsers({
        agencyId: policy.agencyId,
        recipientIds: [...staff],
        type: "document.expiring",
        category: "documents",
        title: `${record.documentName} expires in ${values.daysRemaining} days`,
        body: `${record.client.fullName} · ${values.expirationDate}`,
        severity: values.daysRemaining <= 30 ? "critical" : "warning",
        entityType: "client",
        entityId: record.clientId,
        actionUrl: `/app/clients/${record.clientId}`,
        channels: ["in_app"],
        dedupeKey: `expiry-reminder:${policy.id}:${record.targetKey}:${delivery.sequence}:staff`,
      });
      update.staffSentAt = new Date();
    }
  } catch (error) {
    failures.push(`Staff: ${error.message}`);
  }

  const delivered = policy.notifyClient ? clientSuccesses.length > 0 : Boolean(update.staffSentAt);
  await prisma.expiringDocumentReminderDelivery.update({
    where: { id: delivery.id },
    data: {
      ...update,
      attempts: { increment: 1 },
      status: delivered ? "sent" : "failed",
      sentAt: delivered ? new Date() : null,
      nextAttemptAt: delivered ? null : new Date(Date.now() + 60 * 60_000),
      lastError: failures.join(" · ").slice(0, 2000) || (delivered ? null : "No enabled recipient destination is available."),
    },
  });
}

async function processExpiryPolicy(policy, records, agencyName, now) {
  const matching = records.filter((record) => record.documentKey === policy.documentKey && record.expiresAt > now);
  for (const record of matching) {
    const windowStartsAt = new Date(record.expiresAt.getTime() - policy.leadDays * DAY_MS);
    if (windowStartsAt > now) continue;
    const latest = await prisma.expiringDocumentReminderDelivery.findFirst({
      where: { policyId: policy.id, targetKey: record.targetKey, status: "sent" },
      select: { sequence: true },
      orderBy: { sequence: "desc" },
    });
    const sequence = (latest?.sequence || 0) + 1;
    if (sequence > policy.maxReminders) continue;
    const scheduledAt = new Date(windowStartsAt.getTime() + (sequence - 1) * policy.cadenceDays * DAY_MS);
    if (scheduledAt > now || scheduledAt >= record.expiresAt) continue;
    let delivery = await prisma.expiringDocumentReminderDelivery.findUnique({
      where: { policyId_targetKey_sequence: { policyId: policy.id, targetKey: record.targetKey, sequence } },
    });
    if (delivery?.status === "sent" || (delivery?.nextAttemptAt && delivery.nextAttemptAt > now)) continue;
    if (!delivery) {
      try {
        delivery = await prisma.expiringDocumentReminderDelivery.create({
          data: {
            agencyId: policy.agencyId,
            policyId: policy.id,
            targetKey: record.targetKey,
            clientId: record.clientId,
            caseId: record.caseId,
            sequence,
            expiresAt: record.expiresAt,
          },
        });
      } catch (error) {
        if (error?.code === "P2002") continue;
        throw error;
      }
    }
    await deliverExpiryReminder({ policy, delivery, record, agencyName, now });
  }
}

export async function runExpiringDocumentReminderPass(now = new Date()) {
  if (expiryRunning) return { skipped: true };
  expiryRunning = true;
  try {
  const policies = await prisma.expiringDocumentReminderPolicy.findMany({
    where: { enabled: true },
    include: { agency: { select: { name: true, legalName: true } } },
  });
  const byAgency = new Map();
  for (const policy of policies) {
    if (!byAgency.has(policy.agencyId)) byAgency.set(policy.agencyId, []);
    byAgency.get(policy.agencyId).push(policy);
  }
  for (const [agencyId, agencyPolicies] of byAgency) {
    try {
      const records = await sourceRecords(agencyId);
      const agencyName = agencyPolicies[0].agency.legalName || agencyPolicies[0].agency.name || "CaseDesk";
      for (const policy of agencyPolicies) await processExpiryPolicy(policy, records, agencyName, now);
    } catch (error) {
      logger.warn("expiring_document_reminder.agency_failed", { agencyId, reason: error.message });
    }
  }
    return { skipped: false, policies: policies.length, agencies: byAgency.size };
  } finally {
    expiryRunning = false;
  }
}
