import { recordActivity } from "../utils/prismaCrud.js";
import { createHttpError } from "../utils/http.js";
import {
  agencyMicrosoftMailboxStatus,
  buildAgencyMicrosoftMailboxState,
  buildMicrosoftMailboxState,
  disconnectAgencyMicrosoftMailbox,
  disconnectPersonalMailbox,
  exchangeMicrosoftMailboxCode,
  microsoftMailboxAuthorizeUrl,
  microsoftMailboxConfigured,
  parseAgencyMicrosoftMailboxState,
  parseMicrosoftMailboxState,
  personalMailboxStatus,
  saveAgencyMicrosoftMailboxConnection,
  saveMicrosoftMailboxConnection,
  testAgencyMicrosoftMailbox,
  updateAgencyMicrosoftMailbox,
  updatePersonalMailbox,
} from "../services/microsoftMailboxService.js";

function frontendBase() {
  return String(process.env.FRONTEND_URL || "http://localhost:5173").split(",")[0].trim().replace(/\/$/, "");
}

function settingsUrl(result, message = "") {
  const query = new URLSearchParams({ section: "personal-email", mailbox: result });
  if (message) query.set("message", String(message).slice(0, 180));
  return `${frontendBase()}/app/settings?${query}`;
}

function systemSettingsUrl(result, message = "") {
  const query = new URLSearchParams({ section: "agency-email", systemMailbox: result });
  if (message) query.set("message", String(message).slice(0, 180));
  return `${frontendBase()}/app/settings?${query}`;
}

export async function getPersonalMailbox(req, res) {
  res.json({ data: await personalMailboxStatus(req.auth.userId) });
}

export async function startPersonalMailboxConnect(req, res) {
  if (!microsoftMailboxConfigured()) {
    throw createHttpError(503, "Microsoft mailbox connection is not configured on the CaseDesk server.", "MICROSOFT_MAIL_NOT_CONFIGURED");
  }
  const state = buildMicrosoftMailboxState(req.auth.agencyId, req.auth.userId);
  res.json({ data: { url: microsoftMailboxAuthorizeUrl(state) } });
}

export async function getAgencyMicrosoftMailbox(req, res) {
  res.json({ data: await agencyMicrosoftMailboxStatus(req.auth.agencyId) });
}

export async function startAgencyMicrosoftMailboxConnect(req, res) {
  if (!microsoftMailboxConfigured()) {
    throw createHttpError(503, "Microsoft mailbox connection is not configured on the CaseDesk server.", "MICROSOFT_MAIL_NOT_CONFIGURED");
  }
  const state = buildAgencyMicrosoftMailboxState(req.auth.agencyId, req.auth.userId);
  res.json({ data: { url: microsoftMailboxAuthorizeUrl(state) } });
}

export async function personalMailboxCallback(req, res) {
  const systemState = parseAgencyMicrosoftMailboxState(req.query.state);
  if (req.query.error) {
    const redirect = systemState ? systemSettingsUrl : settingsUrl;
    return res.redirect(redirect("denied", req.query.error_description || "Microsoft access was not approved."));
  }
  if (systemState) {
    if (!req.query.code) return res.redirect(systemSettingsUrl("invalid", "The Microsoft connection request expired. Please try again."));
    try {
      const tokens = await exchangeMicrosoftMailboxCode(String(req.query.code));
      const connection = await saveAgencyMicrosoftMailboxConnection({ ...systemState, tokens });
      await recordActivity({
        agencyId: systemState.agencyId,
        userId: systemState.userId,
        action: "mailbox.microsoft_system_connected",
        details: `System Microsoft mailbox connected for ${connection.emailAddress}`,
      }).catch(() => {});
      return res.redirect(systemSettingsUrl("connected"));
    } catch (error) {
      return res.redirect(systemSettingsUrl("error", error.message || "Microsoft system mailbox connection failed."));
    }
  }
  const state = parseMicrosoftMailboxState(req.query.state);
  if (!state || !req.query.code) return res.redirect(settingsUrl("invalid", "The Microsoft connection request expired. Please try again."));
  try {
    const tokens = await exchangeMicrosoftMailboxCode(String(req.query.code));
    const connection = await saveMicrosoftMailboxConnection({ ...state, tokens });
    await recordActivity({
      agencyId: state.agencyId,
      userId: state.userId,
      action: "mailbox.microsoft_connected",
      details: `Personal Microsoft mailbox connected for ${connection.emailAddress}`,
    }).catch(() => {});
    return res.redirect(settingsUrl("connected"));
  } catch (error) {
    return res.redirect(settingsUrl("error", error.message || "Microsoft mailbox connection failed."));
  }
}

export async function patchAgencyMicrosoftMailbox(req, res) {
  await updateAgencyMicrosoftMailbox(req.auth.agencyId, {
    enabled: req.body.enabled,
    inboundEnabled: req.body.inboundEnabled,
  });
  await recordActivity({
    agencyId: req.auth.agencyId,
    userId: req.auth.userId,
    action: "mailbox.microsoft_system_preferences_updated",
    details: "System Microsoft mailbox preferences updated",
  }).catch(() => {});
  res.json({ data: await agencyMicrosoftMailboxStatus(req.auth.agencyId) });
}

export async function testAgencyMicrosoftMailboxConnection(req, res) {
  await testAgencyMicrosoftMailbox(req.auth.agencyId);
  res.json({ data: await agencyMicrosoftMailboxStatus(req.auth.agencyId) });
}

export async function deleteAgencyMicrosoftMailbox(req, res) {
  await disconnectAgencyMicrosoftMailbox(req.auth.agencyId);
  await recordActivity({
    agencyId: req.auth.agencyId,
    userId: req.auth.userId,
    action: "mailbox.microsoft_system_disconnected",
    details: "System Microsoft mailbox disconnected",
  }).catch(() => {});
  res.status(204).send();
}

export async function patchPersonalMailbox(req, res) {
  const updated = await updatePersonalMailbox(req.auth.userId, {
    syncEnabled: req.body.syncEnabled,
    signatureHtml: req.body.signatureHtml,
  });
  await recordActivity({
    agencyId: req.auth.agencyId,
    userId: req.auth.userId,
    action: "mailbox.preferences_updated",
    details: "Personal mailbox preferences updated",
  }).catch(() => {});
  res.json({ data: await personalMailboxStatus(updated.userId) });
}

export async function deletePersonalMailbox(req, res) {
  await disconnectPersonalMailbox(req.auth.userId);
  await recordActivity({
    agencyId: req.auth.agencyId,
    userId: req.auth.userId,
    action: "mailbox.disconnected",
    details: "Personal Microsoft mailbox disconnected",
  }).catch(() => {});
  res.status(204).send();
}
