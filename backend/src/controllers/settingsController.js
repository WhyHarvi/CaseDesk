import prisma from "../services/prisma/client.js";
import { createMailTransport, friendlyMailError, resolveAgencyMailConfig } from "../services/agencyMailService.js";
import { resolveAgencyImapConfig } from "../services/agencyMailService.js";
import { ImapFlow } from "imapflow";
import { encryptSecret, secretEncryptionReady } from "../services/secretEncryption.js";
import { createHttpError } from "../utils/http.js";
import { recordActivity } from "../utils/prismaCrud.js";

const providers = new Set(["Google Workspace", "Microsoft 365", "Zoho Mail", "Custom"]);
const clean = (value, max = 300) => String(value ?? "").trim().slice(0, max);
const inboundDefaults = {
  "Google Workspace": { host: "imap.gmail.com", port: 993, secure: true },
  "Microsoft 365": { host: "outlook.office365.com", port: 993, secure: true },
  "Zoho Mail": { host: "imap.zoho.com", port: 993, secure: true },
  Custom: { host: "", port: 993, secure: true },
};

function requireAdmin(req) {
  if (req.user.role !== "admin") throw createHttpError(403, "Only workspace administrators can manage the email connection");
}

function publicSettings(settings, canManage) {
  return {
    configured: Boolean(settings),
    canManage,
    secureStorageReady: secretEncryptionReady(),
    provider: settings?.provider || "Google Workspace",
    displayName: settings?.displayName || "",
    emailAddress: settings?.emailAddress || "",
    smtpHost: settings?.smtpHost || "smtp.gmail.com",
    smtpPort: settings?.smtpPort || 465,
    smtpSecure: settings?.smtpSecure ?? true,
    smtpUsername: settings?.smtpUsername || "",
    imapHost: settings?.imapHost || inboundDefaults[settings?.provider || "Google Workspace"].host,
    imapPort: settings?.imapPort || 993,
    imapSecure: settings?.imapSecure ?? true,
    imapUsername: settings?.imapUsername || settings?.smtpUsername || "",
    inboundEnabled: settings?.inboundEnabled ?? false,
    lastInboundSyncAt: settings?.lastInboundSyncAt || null,
    lastInboundSyncStatus: settings?.lastInboundSyncStatus || null,
    lastInboundSyncMessage: settings?.lastInboundSyncMessage || null,
    hasPassword: Boolean(settings?.smtpPasswordEncrypted),
    enabled: settings?.enabled ?? true,
    lastTestedAt: settings?.lastTestedAt || null,
    lastTestStatus: settings?.lastTestStatus || null,
    lastTestMessage: settings?.lastTestMessage || null,
    updatedAt: settings?.updatedAt || null,
  };
}

function validatePayload(body) {
  const provider = providers.has(body.provider) ? body.provider : "Custom";
  const displayName = clean(body.displayName, 120);
  const emailAddress = clean(body.emailAddress, 320).toLowerCase();
  const smtpHost = clean(body.smtpHost, 255).toLowerCase();
  const smtpPort = Number(body.smtpPort);
  const smtpUsername = clean(body.smtpUsername, 320);
  const defaults = inboundDefaults[provider];
  const inboundEnabled = body.inboundEnabled === true;
  const imapHost = clean(body.imapHost || defaults.host, 255).toLowerCase();
  const imapPort = Number(body.imapPort || defaults.port);
  const imapUsername = clean(body.imapUsername || smtpUsername, 320);
  if (!/^\S+@\S+\.\S+$/.test(emailAddress)) throw createHttpError(400, "Enter the email address clients should see");
  if (!smtpHost || /[:/\s]/.test(smtpHost)) throw createHttpError(400, "Enter a valid outgoing mail server, such as smtp.gmail.com");
  if (!Number.isInteger(smtpPort) || smtpPort < 1 || smtpPort > 65535) throw createHttpError(400, "Enter a valid mail server port");
  if (!smtpUsername) throw createHttpError(400, "Enter the mailbox sign-in email or username");
  if (inboundEnabled && (!imapHost || /[:/\s]/.test(imapHost))) throw createHttpError(400, "Enter a valid incoming mail server, such as imap.gmail.com");
  if (inboundEnabled && (!Number.isInteger(imapPort) || imapPort < 1 || imapPort > 65535)) throw createHttpError(400, "Enter a valid incoming mail server port");
  return { provider, displayName: displayName || null, emailAddress, smtpHost, smtpPort, smtpSecure: body.smtpSecure === true, smtpUsername, imapHost: imapHost || null, imapPort, imapSecure: body.imapSecure !== false, imapUsername: imapUsername || null, inboundEnabled, enabled: body.enabled !== false };
}

export async function getMailSettings(req, res) {
  const settings = await prisma.agencyMailSettings.findUnique({ where: { agencyId: req.user.agencyId } });
  res.json({ data: publicSettings(settings, req.user.role === "admin") });
}

export async function saveMailSettings(req, res) {
  requireAdmin(req);
  if (!secretEncryptionReady()) throw createHttpError(503, "Secure mailbox storage is not configured on this CaseDesk server");
  const existing = await prisma.agencyMailSettings.findUnique({ where: { agencyId: req.user.agencyId } });
  const values = validatePayload(req.body);
  const suppliedPassword = clean(req.body.password, 1000).replace(/\s+/g, "");
  if (!existing && !suppliedPassword) throw createHttpError(400, "Enter the app password supplied by your email provider");
  const passwordData = suppliedPassword ? encryptSecret(suppliedPassword) : existing.smtpPasswordEncrypted;
  const imapPasswordData = suppliedPassword ? encryptSecret(suppliedPassword) : existing?.imapPasswordEncrypted || existing?.smtpPasswordEncrypted;
  const data = await prisma.agencyMailSettings.upsert({
    where: { agencyId: req.user.agencyId },
    create: { agencyId: req.user.agencyId, ...values, smtpPasswordEncrypted: passwordData, imapPasswordEncrypted: imapPasswordData, lastTestStatus: "Not tested", lastTestMessage: "Save complete. Test the connection before sending client email.", lastInboundSyncStatus: values.inboundEnabled ? "Not tested" : null },
    update: { ...values, smtpPasswordEncrypted: passwordData, imapPasswordEncrypted: imapPasswordData, lastTestedAt: null, lastTestStatus: "Not tested", lastTestMessage: "Settings changed. Test the connection again.", lastInboundSyncStatus: values.inboundEnabled ? "Not tested" : null },
  });
  await recordActivity({ agencyId: req.user.agencyId, userId: req.user.id, action: "settings.mail_saved", details: `Agency email settings saved for ${data.emailAddress}` });
  res.json({ data: publicSettings(data, true) });
}

export async function testMailSettings(req, res) {
  requireAdmin(req);
  const existing = await prisma.agencyMailSettings.findUnique({ where: { agencyId: req.user.agencyId } });
  if (!existing) throw createHttpError(409, "Save the mailbox details before testing the connection");
  const testedAt = new Date();
  try {
    const config = await resolveAgencyMailConfig(req.user.agencyId, { requireVerified: false });
    await createMailTransport(config).verify();
    if (existing.inboundEnabled) {
      const incoming = await resolveAgencyImapConfig(req.user.agencyId, { requireVerified: false });
      const client = new ImapFlow({ host: incoming.imapHost, port: incoming.imapPort, secure: incoming.imapSecure, auth: { user: incoming.imapUsername, pass: incoming.imapPassword }, logger: false });
      await client.connect();
      await client.logout();
    }
    const data = await prisma.agencyMailSettings.update({ where: { agencyId: req.user.agencyId }, data: { lastTestedAt: testedAt, lastTestStatus: "Connected", lastTestMessage: existing.inboundEnabled ? "CaseDesk successfully connected to outgoing and incoming mail." : "CaseDesk successfully signed in to the outgoing mail server.", lastInboundSyncStatus: existing.inboundEnabled ? "Connected" : null, lastInboundSyncMessage: existing.inboundEnabled ? "Incoming mailbox connection verified. Synchronization will run automatically." : null } });
    await recordActivity({ agencyId: req.user.agencyId, userId: req.user.id, action: "settings.mail_tested", details: `Agency email connection verified for ${data.emailAddress}` });
    res.json({ data: publicSettings(data, true) });
  } catch (error) {
    const message = friendlyMailError(error);
    const data = await prisma.agencyMailSettings.update({ where: { agencyId: req.user.agencyId }, data: { lastTestedAt: testedAt, lastTestStatus: "Failed", lastTestMessage: message, lastInboundSyncStatus: existing.inboundEnabled ? "Failed" : null, lastInboundSyncMessage: existing.inboundEnabled ? message : null } });
    await recordActivity({ agencyId: req.user.agencyId, userId: req.user.id, action: "settings.mail_test_failed", details: message });
    res.status(400).json({ status: "error", message, data: publicSettings(data, true) });
  }
}

export async function deleteMailSettings(req, res) {
  requireAdmin(req);
  const existing = await prisma.agencyMailSettings.findUnique({ where: { agencyId: req.user.agencyId } });
  if (existing) await prisma.agencyMailSettings.delete({ where: { id: existing.id } });
  await recordActivity({ agencyId: req.user.agencyId, userId: req.user.id, action: "settings.mail_disconnected", details: "Workspace email connection removed" });
  res.status(204).send();
}
