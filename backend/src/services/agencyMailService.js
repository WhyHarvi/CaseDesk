import nodemailer from "nodemailer";
import prisma from "./prisma/client.js";
import { decryptSecret, secretEncryptionReady } from "./secretEncryption.js";
import { createHttpError } from "../utils/http.js";

const envReady = () => ["SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_PASSWORD", "SMTP_FROM"].every((key) => String(process.env[key] || "").trim());

function environmentConfig() {
  if (!envReady()) return null;
  return {
    source: "System",
    provider: "System SMTP",
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT),
    secure: String(process.env.SMTP_SECURE).toLowerCase() === "true",
    username: process.env.SMTP_USER,
    password: process.env.SMTP_PASSWORD,
    from: process.env.SMTP_FROM,
    imapHost: process.env.IMAP_HOST || null,
    imapPort: Number(process.env.IMAP_PORT) || 993,
    imapSecure: String(process.env.IMAP_SECURE ?? "true").toLowerCase() !== "false",
    imapUsername: process.env.IMAP_USER || process.env.SMTP_USER,
    imapPassword: process.env.IMAP_PASSWORD || process.env.SMTP_PASSWORD,
  };
}

function storedConfig(settings) {
  return {
    source: "Agency",
    provider: settings.provider,
    host: settings.smtpHost,
    port: settings.smtpPort,
    secure: settings.smtpSecure,
    username: settings.smtpUsername,
    password: decryptSecret(settings.smtpPasswordEncrypted).replace(/\s+/g, ""),
    from: settings.displayName
      ? { name: settings.displayName, address: settings.emailAddress }
      : settings.emailAddress,
    imapHost: settings.imapHost,
    imapPort: settings.imapPort || 993,
    imapSecure: settings.imapSecure,
    imapUsername: settings.imapUsername || settings.smtpUsername,
    imapPassword: decryptSecret(settings.imapPasswordEncrypted || settings.smtpPasswordEncrypted).replace(/\s+/g, ""),
    inboundEnabled: settings.inboundEnabled,
  };
}

export function createMailTransport(config) {
  return nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    requireTLS: !config.secure,
    auth: { user: config.username, pass: config.password },
    connectionTimeout: 12000,
    greetingTimeout: 12000,
    socketTimeout: 20000,
  });
}

export async function resolveAgencyMailConfig(agencyId, { requireVerified = true } = {}) {
  const settings = agencyId
    ? await prisma.agencyMailSettings.findUnique({ where: { agencyId } })
    : null;
  if (settings) {
    if (!settings.enabled) throw createHttpError(409, "Agency email is currently turned off in Settings.");
    if (requireVerified && settings.lastTestStatus !== "Connected") {
      throw createHttpError(409, "Test the agency email connection in Settings before sending client email.");
    }
    return storedConfig(settings);
  }
  const config = environmentConfig();
  if (!config) {
    throw createHttpError(409, "Agency email is not connected. Save this email as a draft or connect a mailbox in Settings.");
  }
  return config;
}

export async function resolveAgencyImapConfig(agencyId, { requireVerified = true } = {}) {
  const settings = agencyId ? await prisma.agencyMailSettings.findUnique({ where: { agencyId } }) : null;
  const config = settings ? storedConfig(settings) : environmentConfig();
  if (!config?.imapHost || !config?.imapUsername || !config?.imapPassword) {
    throw createHttpError(409, "Incoming email is not configured for this agency mailbox.");
  }
  if (settings && !settings.inboundEnabled) throw createHttpError(409, "Incoming mailbox synchronization is turned off in Settings.");
  if (requireVerified && settings && settings.lastTestStatus !== "Connected") throw createHttpError(409, "Test the agency mailbox connection before synchronizing incoming email.");
  return config;
}

export async function agencyMailConnectionStatus(agencyId) {
  const settings = agencyId
    ? await prisma.agencyMailSettings.findUnique({ where: { agencyId } })
    : null;
  const systemFallback = !settings && envReady();
  return {
    configured: Boolean((settings?.enabled && settings.lastTestStatus === "Connected") || systemFallback),
    source: settings ? "Agency" : systemFallback ? "System" : null,
    provider: settings ? settings.provider : systemFallback ? "System SMTP" : "SMTP",
    detail: settings
      ? !settings.enabled
        ? "Agency email is turned off in Settings"
        : settings.lastTestStatus === "Connected"
          ? `Connected as ${settings.emailAddress}`
          : `Saved for ${settings.emailAddress}; test the connection in Settings`
      : systemFallback
        ? "System mailbox connected"
          : "Connect an agency mailbox in Settings",
    secureStorageReady: secretEncryptionReady(),
  };
}

export function friendlyMailError(error) {
  if (error?.code === "EAUTH" || /auth|credential|password|username/i.test(error?.message || "")) {
    return "The email address or app password was not accepted. Check the mailbox sign-in details and try again.";
  }
  if (["ECONNECTION", "ECONNREFUSED", "ETIMEDOUT", "ESOCKET"].includes(error?.code)) {
    return "CaseDesk could not reach the outgoing mail server. Check the provider, server address, port, and security choice.";
  }
  if (/certificate|tls|ssl/i.test(error?.message || "")) {
    return "The mail server security check failed. Confirm whether your provider uses SSL or STARTTLS.";
  }
  return "The mailbox connection could not be verified. Confirm the details with your email provider and try again.";
}
