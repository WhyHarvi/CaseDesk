import { recordActivity } from "../utils/prismaCrud.js";
import { createHttpError } from "../utils/http.js";
import {
  buildMicrosoftMailboxState,
  disconnectPersonalMailbox,
  exchangeMicrosoftMailboxCode,
  microsoftMailboxAuthorizeUrl,
  microsoftMailboxConfigured,
  parseMicrosoftMailboxState,
  personalMailboxStatus,
  saveMicrosoftMailboxConnection,
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

export async function personalMailboxCallback(req, res) {
  if (req.query.error) return res.redirect(settingsUrl("denied", req.query.error_description || "Microsoft access was not approved."));
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
