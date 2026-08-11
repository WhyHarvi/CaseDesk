import prisma from "./prisma/client.js";
import { decryptSecret, secretEncryptionReady } from "./secretEncryption.js";
import { createHttpError } from "../utils/http.js";

const present = (value) => Boolean(String(value || "").trim());

function environmentConfig() {
  if (!["OOMA_API_BASE_URL", "OOMA_API_KEY", "OOMA_FROM_NUMBER"].every((key) => present(process.env[key]))) return null;
  return {
    source: "System",
    apiBaseUrl: process.env.OOMA_API_BASE_URL,
    apiKey: process.env.OOMA_API_KEY,
    fromNumber: process.env.OOMA_FROM_NUMBER,
    smsSendPath: process.env.OOMA_SMS_SEND_PATH || null,
    callStartPath: process.env.OOMA_CALL_START_PATH || null,
    authHeader: process.env.OOMA_AUTH_HEADER || "authorization",
    authPrefix: process.env.OOMA_AUTH_PREFIX ?? "Bearer",
    enabled: true,
    smsEnabled: true,
    callsEnabled: true,
    lastSmsTestStatus: "Connected",
  };
}

function storedConfig(settings) {
  if (![settings?.apiBaseUrl, settings?.apiKeyEncrypted, settings?.fromNumber].every(present)) return null;
  return {
    source: "Agency",
    apiBaseUrl: settings.apiBaseUrl,
    apiKey: decryptSecret(settings.apiKeyEncrypted),
    fromNumber: settings.fromNumber,
    smsSendPath: settings.smsSendPath,
    callStartPath: settings.callStartPath,
    authHeader: settings.authHeader,
    authPrefix: settings.authPrefix,
    enabled: settings.enabled,
    smsEnabled: settings.smsEnabled,
    callsEnabled: settings.callsEnabled,
    lastSmsTestStatus: settings.lastSmsTestStatus,
  };
}

function storedZapierConfig(settings) {
  if (!present(settings?.zapierOutboundWebhookEncrypted)) return null;
  return {
    webhookUrl: decryptSecret(settings.zapierOutboundWebhookEncrypted),
    fromNumber: settings.fromNumber || null,
    enabled: settings.enabled,
    lastTestStatus: settings.lastZapierOutboundTestStatus,
  };
}

async function sendZapierSms({ agencyId, config, to, body, idempotencyKey }) {
  let response;
  try {
    response = await fetch(config.webhookUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(idempotencyKey ? { "idempotency-key": idempotencyKey } : {}),
      },
      body: JSON.stringify({
        event: "sms.send",
        channel: "Sms",
        source: "CaseDesk",
        agencyId,
        from: config.fromNumber,
        to,
        body,
        idempotencyKey: idempotencyKey || null,
        requestedAt: new Date().toISOString(),
      }),
      signal: AbortSignal.timeout(25000),
    });
  } catch (error) {
    const wrapped = createHttpError(502, "CaseDesk could not reach the outbound Zapier webhook. Check the Zapier connection and try again.");
    wrapped.cause = error;
    throw wrapped;
  }
  const responseBody = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw createHttpError(502, `Zapier rejected the outbound SMS request (${response.status}). Check that the Zap is published and the Catch Hook URL is current.`);
  }
  return {
    id: responseBody.id || responseBody.request_id || responseBody.attempt || idempotencyKey || null,
    provider: "Zapier / Ooma",
    response: { accepted: true, acceptedBy: "Zapier" },
  };
}

export async function resolveAgencyOomaConfig(agencyId, { channel, requireVerified = true } = {}) {
  const settings = agencyId ? await prisma.agencyOomaSettings.findUnique({ where: { agencyId } }) : null;
  const config = storedConfig(settings) || environmentConfig();
  if (!config) throw createHttpError(409, "Ooma is not connected. Add the Ooma Enterprise details in Settings.");
  if (!config.enabled) throw createHttpError(409, "Ooma communication is turned off in Settings.");
  if (channel === "Sms") {
    if (!config.smsEnabled || !config.smsSendPath) throw createHttpError(409, "Ooma SMS is not enabled or its send path is missing in Settings.");
    if (requireVerified && settings && config.lastSmsTestStatus !== "Connected") throw createHttpError(409, "Send a successful test text from Settings before using Ooma SMS with clients.");
  }
  if (channel === "Call" && (!config.callsEnabled || !config.callStartPath)) throw createHttpError(409, "Ooma calling is not enabled or its call path is missing in Settings.");
  return config;
}

export async function agencyOomaConnectionStatus(agencyId) {
  const settings = agencyId ? await prisma.agencyOomaSettings.findUnique({ where: { agencyId } }) : null;
  const zapier = storedZapierConfig(settings);
  if (zapier) {
    const smsReady = Boolean(zapier.enabled && zapier.lastTestStatus === "Connected");
    const callActivityReady = Boolean(settings?.webhookTokenHash && settings?.lastCallWebhookAt);
    return {
      Sms: {
        configured: smsReady,
        detail: !zapier.enabled ? "Zapier messaging is turned off in Settings" : smsReady ? `Connected through Zapier${zapier.fromNumber ? ` · ${zapier.fromNumber}` : ""}` : "Saved; send a test text from Settings",
        source: "Zapier",
      },
      Call: {
        configured: false,
        activityConfigured: Boolean(settings?.webhookTokenHash),
        activityConnected: callActivityReady,
        detail: callActivityReady
          ? `Ooma call activity is syncing through Zapier${zapier.fromNumber ? ` · ${zapier.fromNumber}` : ""}. Calls open in the Windows dialer.`
          : settings?.webhookTokenHash
            ? "Call webhook saved; waiting for the first Ooma call event from Zapier"
            : "Create the inbound Zapier connection to sync calls",
        source: "Zapier",
      },
      secureStorageReady: secretEncryptionReady(),
    };
  }
  if (settings?.webhookTokenHash && !settings?.apiBaseUrl) {
    const callActivityReady = Boolean(settings.lastCallWebhookAt);
    return {
      Sms: { configured: false, detail: "Add the outbound Zapier Catch Hook to send SMS", source: "Zapier" },
      Call: {
        configured: false,
        activityConfigured: true,
        activityConnected: callActivityReady,
        detail: callActivityReady
          ? "Ooma call activity is syncing through Zapier. Calls open in the Windows dialer."
          : "Call webhook saved; waiting for the first Ooma call event from Zapier",
        source: "Zapier",
      },
      secureStorageReady: secretEncryptionReady(),
    };
  }
  const config = storedConfig(settings) || environmentConfig();
  if (!config) return {
    Sms: { configured: false, detail: "Connect Ooma Enterprise in Settings", source: null },
    Call: { configured: false, detail: "Connect Ooma Enterprise in Settings", source: null },
    secureStorageReady: secretEncryptionReady(),
  };
  const smsReady = Boolean(config.enabled && config.smsEnabled && config.smsSendPath && (!settings || config.lastSmsTestStatus === "Connected"));
  const callReady = Boolean(config.enabled && config.callsEnabled && config.callStartPath);
  return {
    Sms: {
      configured: smsReady,
      detail: !config.enabled ? "Ooma is turned off in Settings" : smsReady ? `Connected to ${config.fromNumber}` : config.smsSendPath ? "Saved; send a test text from Settings" : "Add the SMS endpoint supplied by Ooma",
      source: config.source,
    },
    Call: {
      configured: callReady,
      detail: !config.enabled ? "Ooma is turned off in Settings" : callReady ? `Calling configured for ${config.fromNumber}` : "Add the call endpoint supplied by Ooma",
      source: config.source,
    },
    secureStorageReady: secretEncryptionReady(),
  };
}

export async function oomaRequest(config, pathValue, payload, idempotencyKey = null) {
  const url = new URL(pathValue, config.apiBaseUrl).toString();
  const authorization = [config.authPrefix, config.apiKey].filter(Boolean).join(" ");
  let response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { [config.authHeader]: authorization, "content-type": "application/json", ...(idempotencyKey ? { "idempotency-key": idempotencyKey } : {}) },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(25000),
    });
  } catch (error) {
    const wrapped = createHttpError(502, "CaseDesk could not reach the Ooma API. Check the API address and try again.");
    wrapped.cause = error;
    throw wrapped;
  }
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = response.status === 401 || response.status === 403
      ? "Ooma rejected the API key or account permissions. Confirm the credentials with Ooma Enterprise Support."
      : response.status === 404
        ? "The Ooma endpoint path was not found. Copy the exact path from Ooma's API documentation."
        : response.status === 429
          ? "Ooma temporarily limited API requests. Wait briefly and try again."
          : `Ooma returned an error (${response.status}). Confirm the endpoint and account permissions with Ooma Enterprise Support.`;
    throw createHttpError(502, String(message).slice(0, 300));
  }
  return {
    id: body.id || body.messageId || body.callId || null,
    provider: "Ooma",
    response: { accepted: true },
  };
}

export async function sendAgencyOomaSms({ agencyId, to, body, idempotencyKey, requireVerified = true }) {
  const settings = agencyId ? await prisma.agencyOomaSettings.findUnique({ where: { agencyId } }) : null;
  const zapier = storedZapierConfig(settings);
  if (zapier) {
    if (!zapier.enabled) throw createHttpError(409, "Zapier messaging is turned off in Settings.");
    if (requireVerified && zapier.lastTestStatus !== "Connected") throw createHttpError(409, "Send a successful Zapier test text from Settings before messaging clients.");
    return sendZapierSms({ agencyId, config: zapier, to, body, idempotencyKey });
  }
  const config = await resolveAgencyOomaConfig(agencyId, { channel: "Sms", requireVerified });
  return oomaRequest(config, config.smsSendPath, { from: config.fromNumber, to, body }, idempotencyKey);
}

export async function startAgencyOomaCall({ agencyId, to, idempotencyKey }) {
  const config = await resolveAgencyOomaConfig(agencyId, { channel: "Call" });
  return oomaRequest(config, config.callStartPath, { from: config.fromNumber, to }, idempotencyKey);
}
