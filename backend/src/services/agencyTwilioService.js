import twilio from "twilio";
import prisma from "./prisma/client.js";
import { decryptSecret, secretEncryptionReady } from "./secretEncryption.js";
import { createHttpError } from "../utils/http.js";

const present = (value) => Boolean(String(value || "").trim());

function storedConfig(settings) {
  if (![settings?.accountSid, settings?.authTokenEncrypted].every(present)) return null;
  return {
    source: "Agency",
    accountSid: settings.accountSid,
    authToken: decryptSecret(settings.authTokenEncrypted),
    fromNumber: settings.fromNumber || null,
    messagingServiceSid: settings.messagingServiceSid || null,
    enabled: settings.enabled,
    smsEnabled: settings.smsEnabled,
    sendReady: Boolean(settings.fromNumber || settings.messagingServiceSid),
    lastSmsTestStatus: settings.lastSmsTestStatus,
  };
}

// Twilio's numeric error codes are more specific than generic HTTP statuses —
// map the ones an agency will actually hit to plain language
// instead of surfacing "Error 21608" to a consultant.
function friendlyTwilioError(error) {
  const code = error?.code;
  if (error?.status === 401 || code === 20003) return "Twilio rejected the Account SID or Auth Token. Confirm the credentials in the Twilio Console.";
  if (code === 21211) return "Twilio rejected the destination phone number. Check the number and country code.";
  if (code === 21606 || code === 21659) return "That number is not a valid Twilio sending number for this account.";
  if (code === 21608) return "This Twilio account is in trial mode and can only text verified numbers. Upgrade the account or verify the recipient in the Twilio Console.";
  if (code === 21610) return "That recipient has opted out (replied STOP) and cannot be texted.";
  return `Twilio returned an error${code ? ` (${code})` : ""}. Confirm the account and number with Twilio.`;
}

// optional:true returns null instead of throwing so connection-status checks
// can probe an incomplete setup. Actual sends require a complete configuration.
export async function resolveAgencyTwilioConfig(agencyId, { requireVerified = true, optional = false, sendingNumber = null } = {}) {
  const settings = agencyId ? await prisma.agencyTwilioSettings.findUnique({ where: { agencyId } }) : null;
  const config = storedConfig(settings);
  const fail = (message) => {
    if (optional) return null;
    throw createHttpError(409, message);
  };
  if (!config) return fail("Twilio is not connected. Add the Account SID and Auth Token in Settings.");
  if (!config.enabled || !config.smsEnabled) return fail("Twilio SMS is turned off in Settings.");
  if (!config.sendReady && !sendingNumber) return fail("Add a Twilio phone number or Messaging Service SID in Settings before sending.");
  if (requireVerified && config.lastSmsTestStatus !== "Connected") return fail("Send a successful test text from Settings before using Twilio with clients.");
  return config;
}

export async function agencyTwilioConnectionStatus(agencyId) {
  const settings = agencyId ? await prisma.agencyTwilioSettings.findUnique({ where: { agencyId } }) : null;
  const config = storedConfig(settings);
  if (!config) {
    return {
      Sms: { configured: false, detail: "Connect Twilio in Settings", source: null },
      secureStorageReady: secretEncryptionReady(),
    };
  }
  const smsReady = Boolean(config.enabled && config.smsEnabled && config.sendReady && config.lastSmsTestStatus === "Connected");
  return {
    Sms: {
      configured: smsReady,
      detail: !config.enabled || !config.smsEnabled
        ? "Twilio is turned off in Settings"
        : !config.sendReady
          ? "Credentials saved; add a phone number or Messaging Service to start sending"
          : smsReady
            ? `Connected to ${config.fromNumber || config.messagingServiceSid}`
            : "Send a test text from Settings",
      source: "Twilio",
    },
    secureStorageReady: secretEncryptionReady(),
  };
}

// Credential-only check — works with just an Account SID + Auth Token, no
// phone number required. Hits Twilio's Account resource: no message sent, no
// cost, just confirms the credentials are real.
export async function verifyAgencyTwilioCredentials({ accountSid, authToken }) {
  const client = twilio(accountSid, authToken);
  try {
    const account = await client.api.v2010.accounts(accountSid).fetch();
    return { status: account.status, friendlyName: account.friendlyName };
  } catch (error) {
    throw createHttpError(error?.status === 401 ? 401 : 502, friendlyTwilioError(error));
  }
}

// idempotencyKey is accepted for a consistent communication-service signature
// but not forwarded to Twilio — the classic Messages resource has no native
// idempotency-key input, and real dedupe already lives in
// communicationOutboxService.js's claim-based row-status transition.
export async function sendAgencyTwilioSms({ agencyId, to, body, fromNumber, idempotencyKey, requireVerified = true, config }) {
  const resolved = config || (await resolveAgencyTwilioConfig(agencyId, { requireVerified, sendingNumber: fromNumber }));
  const client = twilio(resolved.accountSid, resolved.authToken);
  try {
    const message = await client.messages.create({
      body,
      to,
      ...(fromNumber
        ? { from: fromNumber }
        : resolved.messagingServiceSid
          ? { messagingServiceSid: resolved.messagingServiceSid }
          : { from: resolved.fromNumber }),
    });
    return { id: message.sid, provider: "Twilio", response: { accepted: true, status: message.status } };
  } catch (error) {
    throw createHttpError(502, friendlyTwilioError(error));
  }
}

export async function agencyTwilioSmsSendingOptions(agencyId) {
  const [settings, lines] = await Promise.all([
    prisma.agencyTwilioSettings.findUnique({ where: { agencyId } }),
    prisma.agencyTwilioVoiceLine.findMany({
      where: { agencyId, enabled: true },
      select: { id: true, phoneNumber: true, label: true, isPrimary: true },
      orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
    }),
  ]);
  const primary = lines.find((line) => line.isPrimary)?.phoneNumber || null;
  const defaultNumber = primary || settings?.voiceNumber || settings?.fromNumber || null;
  const numbers = [...lines];
  if (defaultNumber && !numbers.some((line) => line.phoneNumber === defaultNumber)) {
    numbers.unshift({ id: "default", phoneNumber: defaultNumber, label: "Default calling number", isPrimary: true });
  }
  return {
    defaultNumber,
    numbers,
    requiresSelection: !defaultNumber && numbers.length > 0,
    configured: Boolean(settings?.accountSid && settings?.authTokenEncrypted && settings.enabled && settings.smsEnabled),
    verified: settings?.lastSmsTestStatus === "Connected",
  };
}
