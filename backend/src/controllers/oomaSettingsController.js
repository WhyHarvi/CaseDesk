import prisma from "../services/prisma/client.js";
import { createHash, randomBytes } from "node:crypto";
import { sendAgencyOomaSms } from "../services/agencyOomaService.js";
import {
  decryptSecret,
  encryptSecret,
  secretEncryptionReady,
} from "../services/secretEncryption.js";
import { createHttpError } from "../utils/http.js";
import { recordActivity } from "../utils/prismaCrud.js";

const clean = (value, max = 300) =>
  String(value ?? "")
    .trim()
    .slice(0, max);
const normalizePhone = (value) => {
  const source = clean(value, 40).replace(/[\s().-]/g, "");
  return source.startsWith("+") ? source : source ? `+${source}` : "";
};

function requireAdmin(req) {
  if (req.user.role !== "admin")
    throw createHttpError(
      403,
      "Only workspace administrators can manage the Ooma connection",
    );
}

function webhookValues(settings, req, canManage) {
  if (!settings?.webhookTokenEncrypted || !canManage)
    return { webhookUrl: "", hasWebhook: Boolean(settings?.webhookTokenHash) };
  const base = String(
    process.env.API_PUBLIC_URL || `${req.protocol}://${req.get("host")}`,
  ).replace(/\/+$/, "");
  return {
    webhookUrl: `${base}/api/communications/webhooks/ooma/${decryptSecret(settings.webhookTokenEncrypted)}`,
    hasWebhook: true,
  };
}

function newWebhookToken() {
  const token = randomBytes(32).toString("hex");
  return {
    webhookTokenEncrypted: encryptSecret(token),
    webhookTokenHash: createHash("sha256").update(token).digest("hex"),
  };
}

function publicSettings(settings, canManage, req) {
  const directConfigured = Boolean(
    settings?.apiBaseUrl && settings?.apiKeyEncrypted && settings?.fromNumber,
  );
  return {
    configured: directConfigured,
    canManage,
    secureStorageReady: secretEncryptionReady(),
    apiBaseUrl: settings?.apiBaseUrl || "",
    fromNumber: settings?.fromNumber || "",
    smsSendPath: settings?.smsSendPath || "",
    callStartPath: settings?.callStartPath || "",
    authHeader: settings?.authHeader || "authorization",
    authPrefix: settings?.authPrefix ?? "Bearer",
    hasApiKey: Boolean(settings?.apiKeyEncrypted),
    enabled: settings?.enabled ?? true,
    smsEnabled: settings?.smsEnabled ?? true,
    callsEnabled: settings?.callsEnabled ?? true,
    lastSmsTestedAt: settings?.lastSmsTestedAt || null,
    lastSmsTestStatus: settings?.lastSmsTestStatus || null,
    lastSmsTestMessage: settings?.lastSmsTestMessage || null,
    updatedAt: settings?.updatedAt || null,
    lastWebhookAt: settings?.lastWebhookAt || null,
    ...webhookValues(settings, req, canManage),
  };
}

function endpointPath(value, label) {
  const path = clean(value, 500);
  if (path && !path.startsWith("/"))
    throw createHttpError(400, `${label} must begin with /`);
  return path || null;
}

function validate(body) {
  const apiBaseUrl = clean(body.apiBaseUrl, 500).replace(/\/+$/, "");
  let parsed;
  try {
    parsed = new URL(apiBaseUrl);
  } catch {
    throw createHttpError(
      400,
      "Enter the complete HTTPS API address supplied by Ooma",
    );
  }
  if (parsed.protocol !== "https:")
    throw createHttpError(400, "The Ooma API address must use HTTPS");
  if (
    !parsed.hostname.includes(".") ||
    parsed.hostname === "localhost" ||
    parsed.hostname.endsWith(".local") ||
    /^\[?[a-f\d:]+\]?$/i.test(parsed.hostname) ||
    /^\d+(\.\d+){3}$/.test(parsed.hostname)
  ) {
    throw createHttpError(
      400,
      "Use the public Ooma API hostname from its official documentation, not a local or numeric address",
    );
  }
  const fromNumber = normalizePhone(body.fromNumber);
  if (!/^\+\d{8,15}$/.test(fromNumber))
    throw createHttpError(
      400,
      "Enter the Ooma business number including country code, such as +14165550100",
    );
  const authHeader = clean(body.authHeader, 80).toLowerCase();
  if (!/^[a-z][a-z\d-]*$/.test(authHeader))
    throw createHttpError(400, "Enter a valid authentication header name");
  const smsEnabled = body.smsEnabled !== false;
  const callsEnabled = body.callsEnabled !== false;
  const smsSendPath = endpointPath(body.smsSendPath, "SMS endpoint path");
  const callStartPath = endpointPath(body.callStartPath, "Call endpoint path");
  if (smsEnabled && !smsSendPath)
    throw createHttpError(
      400,
      "Add the SMS endpoint path supplied by Ooma, or turn off SMS",
    );
  if (callsEnabled && !callStartPath)
    throw createHttpError(
      400,
      "Add the call endpoint path supplied by Ooma, or turn off calls",
    );
  return {
    apiBaseUrl,
    fromNumber,
    smsSendPath,
    callStartPath,
    authHeader,
    authPrefix: clean(body.authPrefix, 40),
    enabled: body.enabled !== false,
    smsEnabled,
    callsEnabled,
  };
}

export async function getOomaSettings(req, res) {
  const settings = await prisma.agencyOomaSettings.findUnique({
    where: { agencyId: req.user.agencyId },
  });
  res.json({ data: publicSettings(settings, req.user.role === "admin", req) });
}

export async function saveOomaSettings(req, res) {
  requireAdmin(req);
  if (!secretEncryptionReady())
    throw createHttpError(
      503,
      "Secure integration storage is not configured on this CaseDesk server",
    );
  const existing = await prisma.agencyOomaSettings.findUnique({
    where: { agencyId: req.user.agencyId },
  });
  const values = validate(req.body);
  const suppliedKey = clean(req.body.apiKey, 3000);
  if (!existing?.apiKeyEncrypted && !suppliedKey)
    throw createHttpError(400, "Enter the API key supplied by Ooma");
  const apiKeyEncrypted = suppliedKey
    ? encryptSecret(suppliedKey)
    : existing.apiKeyEncrypted;
  const webhook = existing?.webhookTokenHash ? {} : newWebhookToken();
  const data = await prisma.agencyOomaSettings.upsert({
    where: { agencyId: req.user.agencyId },
    create: {
      agencyId: req.user.agencyId,
      ...values,
      ...webhook,
      apiKeyEncrypted,
      lastSmsTestStatus: values.smsEnabled ? "Not tested" : null,
      lastSmsTestMessage: values.smsEnabled
        ? "Send a test text before messaging clients."
        : null,
    },
    update: {
      ...values,
      ...webhook,
      apiKeyEncrypted,
      lastSmsTestedAt: null,
      lastSmsTestStatus: values.smsEnabled ? "Not tested" : null,
      lastSmsTestMessage: values.smsEnabled
        ? "Settings changed. Send another test text."
        : null,
    },
  });
  await recordActivity({
    agencyId: req.user.agencyId,
    userId: req.user.id,
    action: "settings.ooma_saved",
    details: `Ooma settings saved for ${data.fromNumber}`,
  });
  res.json({ data: publicSettings(data, true, req) });
}

export async function rotateOomaWebhookToken(req, res) {
  requireAdmin(req);
  if (!secretEncryptionReady())
    throw createHttpError(
      503,
      "Secure integration storage is not configured on this CaseDesk server",
    );
  const data = await prisma.agencyOomaSettings.upsert({
    where: { agencyId: req.user.agencyId },
    create: {
      agencyId: req.user.agencyId,
      ...newWebhookToken(),
      // Empty compatibility values let webhook-only setup work while an
      // already-running deployment still has the pre-migration Prisma Client,
      // where these three columns were required. They are deliberately not
      // considered a configured outbound Ooma connection.
      apiBaseUrl: "",
      apiKeyEncrypted: "",
      fromNumber: "",
      enabled: true,
      smsEnabled: false,
      callsEnabled: false,
    },
    update: newWebhookToken(),
  });
  await recordActivity({
    agencyId: req.user.agencyId,
    userId: req.user.id,
    action: "settings.ooma_webhook_rotated",
    details: "Ooma/Zapier inbound webhook URL generated",
  });
  res.json({ data: publicSettings(data, true, req) });
}

export async function testOomaSms(req, res) {
  requireAdmin(req);
  const settings = await prisma.agencyOomaSettings.findUnique({
    where: { agencyId: req.user.agencyId },
  });
  if (!settings)
    throw createHttpError(
      409,
      "Save the Ooma details before sending a test text",
    );
  const to = normalizePhone(req.body.to);
  if (!/^\+\d{8,15}$/.test(to))
    throw createHttpError(
      400,
      "Enter the test phone number including country code",
    );
  const testedAt = new Date();
  try {
    await sendAgencyOomaSms({
      agencyId: req.user.agencyId,
      to,
      body: "CaseDesk connection test. Your Ooma SMS setup is working. Reply STOP to opt out.",
      requireVerified: false,
    });
    const data = await prisma.agencyOomaSettings.update({
      where: { agencyId: req.user.agencyId },
      data: {
        lastSmsTestedAt: testedAt,
        lastSmsTestStatus: "Connected",
        lastSmsTestMessage: `Test message accepted for ${to}.`,
      },
    });
    await recordActivity({
      agencyId: req.user.agencyId,
      userId: req.user.id,
      action: "settings.ooma_sms_tested",
      details: `Ooma SMS connection verified for ${data.fromNumber}`,
    });
    res.json({ data: publicSettings(data, true, req) });
  } catch (error) {
    const message = error.statusCode
      ? error.message
      : "The Ooma test message failed. Confirm the API values with Ooma Enterprise Support.";
    const data = await prisma.agencyOomaSettings.update({
      where: { agencyId: req.user.agencyId },
      data: {
        lastSmsTestedAt: testedAt,
        lastSmsTestStatus: "Failed",
        lastSmsTestMessage: message,
      },
    });
    await recordActivity({
      agencyId: req.user.agencyId,
      userId: req.user.id,
      action: "settings.ooma_sms_test_failed",
      details: message,
    });
    res
      .status(error.statusCode || 502)
      .json({
        status: "error",
        message,
        data: publicSettings(data, true, req),
      });
  }
}

export async function deleteOomaSettings(req, res) {
  requireAdmin(req);
  const existing = await prisma.agencyOomaSettings.findUnique({
    where: { agencyId: req.user.agencyId },
  });
  if (existing)
    await prisma.agencyOomaSettings.delete({ where: { id: existing.id } });
  await recordActivity({
    agencyId: req.user.agencyId,
    userId: req.user.id,
    action: "settings.ooma_disconnected",
    details: "Ooma connection removed",
  });
  res.status(204).send();
}
