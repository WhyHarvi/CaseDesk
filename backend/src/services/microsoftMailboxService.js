import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import prisma from "./prisma/client.js";
import { decryptSecret, encryptSecret, secretEncryptionReady } from "./secretEncryption.js";
import { createHttpError } from "../utils/http.js";

const GRAPH_BASE = "https://graph.microsoft.com/v1.0";
const STATE_TTL_MS = 10 * 60_000;
// Calendars.ReadWrite lets outlookCalendarSyncService.js mirror appointments
// onto a staff member's own Outlook calendar. Microsoft requires incremental
// consent for it — anyone who connected before this scope was added needs to
// reconnect once (same "Connect Outlook" button; Microsoft just shows one
// extra permission line) before their appointments start syncing.
const SCOPES = ["openid", "profile", "email", "offline_access", "User.Read", "Mail.Read", "Mail.Send", "Calendars.ReadWrite"];

const tenant = () => String(process.env.MS_MAIL_TENANT_ID || "organizations").trim();
const authority = () => `https://login.microsoftonline.com/${encodeURIComponent(tenant())}/oauth2/v2.0`;

export function microsoftMailboxConfigured() {
  return Boolean(
    process.env.MS_MAIL_CLIENT_ID &&
      process.env.MS_MAIL_CLIENT_SECRET &&
      process.env.MS_MAIL_REDIRECT_URI &&
      secretEncryptionReady(),
  );
}

function stateSecret() {
  return String(process.env.MAIL_SETTINGS_ENCRYPTION_KEY || process.env.MS_MAIL_CLIENT_SECRET);
}

export function buildMicrosoftMailboxState(agencyId, userId) {
  const payload = `${agencyId}.${userId}.${Date.now() + STATE_TTL_MS}.${randomUUID().slice(0, 12)}`;
  const signature = createHmac("sha256", stateSecret()).update(payload).digest("hex");
  return Buffer.from(`${payload}.${signature}`).toString("base64url");
}

export function buildAgencyMicrosoftMailboxState(agencyId, userId) {
  const payload = `system.${agencyId}.${userId}.${Date.now() + STATE_TTL_MS}.${randomUUID().slice(0, 12)}`;
  const signature = createHmac("sha256", stateSecret()).update(payload).digest("hex");
  return Buffer.from(`${payload}.${signature}`).toString("base64url");
}

export function parseMicrosoftMailboxState(state) {
  try {
    const parts = Buffer.from(String(state || ""), "base64url").toString().split(".");
    if (parts.length !== 5) return null;
    const [agencyId, userId, expiry, nonce, signature] = parts;
    const payload = `${agencyId}.${userId}.${expiry}.${nonce}`;
    const expected = createHmac("sha256", stateSecret()).update(payload).digest("hex");
    if (signature.length !== expected.length || !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;
    if (Number(expiry) < Date.now()) return null;
    return { agencyId, userId };
  } catch {
    return null;
  }
}

export function parseAgencyMicrosoftMailboxState(state) {
  try {
    const parts = Buffer.from(String(state || ""), "base64url").toString().split(".");
    if (parts.length !== 6 || parts[0] !== "system") return null;
    const [, agencyId, userId, expiry, nonce, signature] = parts;
    const payload = `system.${agencyId}.${userId}.${expiry}.${nonce}`;
    const expected = createHmac("sha256", stateSecret()).update(payload).digest("hex");
    if (signature.length !== expected.length || !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;
    if (Number(expiry) < Date.now()) return null;
    return { agencyId, userId, purpose: "system" };
  } catch {
    return null;
  }
}

export function microsoftMailboxAuthorizeUrl(state) {
  const params = new URLSearchParams({
    client_id: process.env.MS_MAIL_CLIENT_ID,
    response_type: "code",
    redirect_uri: process.env.MS_MAIL_REDIRECT_URI,
    response_mode: "query",
    scope: SCOPES.join(" "),
    state,
    // No `prompt` value at all — forcing one (this was "select_account
    // consent", invalid and rejected outright with AADSTS90023; then just
    // "consent") backfires on a tenant with self-service user consent
    // disabled (chkimmigration.ca): forcing an interactive consent screen
    // makes Microsoft require THIS signing-in user to personally approve
    // it, and a non-admin can't — so it bounces to "ask your admin" even
    // for scopes already granted tenant-wide. Omitting prompt entirely
    // lets Microsoft evaluate existing tenant consent silently (succeeds
    // immediately when everything requested is already granted) and still
    // auto-triggers incremental consent on its own for any newly-added,
    // not-yet-granted scope — no forced prompt is needed for that.
  });
  return `${authority()}/authorize?${params}`;
}

async function tokenRequest(values) {
  const response = await fetch(`${authority()}/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
    body: new URLSearchParams({
      client_id: process.env.MS_MAIL_CLIENT_ID,
      client_secret: process.env.MS_MAIL_CLIENT_SECRET,
      redirect_uri: process.env.MS_MAIL_REDIRECT_URI,
      scope: SCOPES.join(" "),
      ...values,
    }),
    signal: AbortSignal.timeout(20000),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw createHttpError(502, body.error_description || "Microsoft could not authorize this mailbox.", "MICROSOFT_MAIL_TOKEN_ERROR");
  }
  return body;
}

export function exchangeMicrosoftMailboxCode(code) {
  return tokenRequest({ grant_type: "authorization_code", code });
}

function jwtClaims(token) {
  try {
    return JSON.parse(Buffer.from(String(token).split(".")[1], "base64url").toString());
  } catch {
    return {};
  }
}

async function graphFetch(accessToken, path, options = {}) {
  const response = await fetch(path.startsWith("https://") ? path : `${GRAPH_BASE}${path}`, {
    ...options,
    headers: {
      authorization: `Bearer ${accessToken}`,
      accept: "application/json",
      ...(options.body ? { "content-type": "application/json" } : {}),
      ...options.headers,
    },
    signal: options.signal || AbortSignal.timeout(25000),
  });
  const body = response.status === 204 || response.status === 202 ? {} : await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = createHttpError(
      response.status === 401 ? 401 : 502,
      body?.error?.message || `Microsoft Graph returned an error (${response.status}).`,
      "MICROSOFT_GRAPH_ERROR",
    );
    error.graphStatus = response.status;
    throw error;
  }
  return body;
}

export async function saveMicrosoftMailboxConnection({ agencyId, userId, tokens }) {
  const profile = await graphFetch(tokens.access_token, "/me?$select=id,displayName,mail,userPrincipalName");
  const user = await prisma.user.findFirst({ where: { id: userId, agencyId }, select: { email: true } });
  if (!user) throw createHttpError(404, "CaseDesk user not found.");
  const emailAddress = String(profile.mail || profile.userPrincipalName || "").trim().toLowerCase();
  if (!emailAddress) throw createHttpError(409, "Microsoft did not provide an email address for this account.");
  if (emailAddress !== String(user.email).trim().toLowerCase()) {
    throw createHttpError(409, `Sign in with your own CaseDesk email (${user.email}).`, "MAILBOX_IDENTITY_MISMATCH");
  }
  const existingForAddress = await prisma.userMailboxConnection.findFirst({
    where: { agencyId, emailAddress, userId: { not: userId } },
    select: { id: true },
  });
  if (existingForAddress) throw createHttpError(409, "This mailbox is already connected to another team member.");
  const systemConnection = await prisma.agencyMicrosoftMailboxConnection.findFirst({
    where: { emailAddress },
    select: { id: true },
  });
  if (systemConnection) {
    throw createHttpError(409, "This mailbox is already connected as a workspace system mailbox.");
  }
  const claims = jwtClaims(tokens.access_token);
  const now = Date.now();
  return prisma.userMailboxConnection.upsert({
    where: { userId },
    create: {
      agencyId,
      userId,
      providerAccountId: profile.id,
      tenantId: claims.tid || null,
      emailAddress,
      displayName: profile.displayName || null,
      accessTokenEncrypted: encryptSecret(tokens.access_token),
      refreshTokenEncrypted: encryptSecret(tokens.refresh_token),
      accessTokenExpiresAt: new Date(now + Number(tokens.expires_in || 3600) * 1000),
      grantedScopes: tokens.scope || SCOPES.join(" "),
      status: "connected",
      lastError: null,
      lastSyncStatus: "Ready",
      lastSyncMessage: "Mailbox connected. CaseDesk will synchronize matching client email.",
    },
    update: {
      agencyId,
      providerAccountId: profile.id,
      tenantId: claims.tid || null,
      emailAddress,
      displayName: profile.displayName || null,
      accessTokenEncrypted: encryptSecret(tokens.access_token),
      refreshTokenEncrypted: encryptSecret(tokens.refresh_token),
      accessTokenExpiresAt: new Date(now + Number(tokens.expires_in || 3600) * 1000),
      grantedScopes: tokens.scope || SCOPES.join(" "),
      status: "connected",
      lastError: null,
      connectedAt: new Date(),
      lastSyncStatus: "Ready",
      lastSyncMessage: "Mailbox reconnected. CaseDesk will synchronize matching client email.",
    },
  });
}

export async function saveAgencyMicrosoftMailboxConnection({ agencyId, userId, tokens }) {
  const profile = await graphFetch(tokens.access_token, "/me?$select=id,displayName,mail,userPrincipalName");
  const emailAddress = String(profile.mail || profile.userPrincipalName || "").trim().toLowerCase();
  if (!emailAddress) throw createHttpError(409, "Microsoft did not provide an email address for this account.");
  if (!tokens.refresh_token) {
    throw createHttpError(409, "Microsoft did not provide long-term mailbox access. Approve offline access and try again.");
  }
  const personalConnection = await prisma.userMailboxConnection.findFirst({
    where: { emailAddress },
    select: { id: true },
  });
  if (personalConnection) {
    throw createHttpError(409, "This mailbox is already connected as a team member's personal mailbox.");
  }
  const claims = jwtClaims(tokens.access_token);
  const now = Date.now();
  const connection = await prisma.agencyMicrosoftMailboxConnection.upsert({
    where: { agencyId },
    create: {
      agencyId,
      providerAccountId: profile.id,
      tenantId: claims.tid || null,
      emailAddress,
      displayName: profile.displayName || null,
      accessTokenEncrypted: encryptSecret(tokens.access_token),
      refreshTokenEncrypted: encryptSecret(tokens.refresh_token),
      accessTokenExpiresAt: new Date(now + Number(tokens.expires_in || 3600) * 1000),
      grantedScopes: tokens.scope || SCOPES.join(" "),
      status: "connected",
      enabled: true,
      inboundEnabled: true,
      connectedById: userId,
      lastError: null,
      lastSyncStatus: "Ready",
      lastSyncMessage: "System mailbox connected. Inbox synchronization is ready.",
    },
    update: {
      providerAccountId: profile.id,
      tenantId: claims.tid || null,
      emailAddress,
      displayName: profile.displayName || null,
      accessTokenEncrypted: encryptSecret(tokens.access_token),
      refreshTokenEncrypted: encryptSecret(tokens.refresh_token),
      accessTokenExpiresAt: new Date(now + Number(tokens.expires_in || 3600) * 1000),
      grantedScopes: tokens.scope || SCOPES.join(" "),
      status: "connected",
      enabled: true,
      connectedById: userId,
      connectedAt: new Date(),
      lastError: null,
      lastSyncStatus: "Ready",
      lastSyncMessage: "System mailbox reconnected. Inbox synchronization is ready.",
    },
  });
  await prisma.agencyMailSettings.updateMany({
    where: { agencyId },
    data: { enabled: false, inboundEnabled: false },
  });
  return connection;
}

async function refreshConnection(connection) {
  try {
    const tokens = await tokenRequest({
      grant_type: "refresh_token",
      refresh_token: decryptSecret(connection.refreshTokenEncrypted),
    });
    return prisma.userMailboxConnection.update({
      where: { id: connection.id },
      data: {
        accessTokenEncrypted: encryptSecret(tokens.access_token),
        ...(tokens.refresh_token ? { refreshTokenEncrypted: encryptSecret(tokens.refresh_token) } : {}),
        accessTokenExpiresAt: new Date(Date.now() + Number(tokens.expires_in || 3600) * 1000),
        grantedScopes: tokens.scope || connection.grantedScopes,
        status: "connected",
        lastError: null,
      },
    });
  } catch (error) {
    await prisma.userMailboxConnection.update({
      where: { id: connection.id },
      data: { status: "reauthorization_required", lastError: String(error.message || "Microsoft authorization expired.").slice(0, 500) },
    }).catch(() => {});
    throw createHttpError(409, "Reconnect your Microsoft mailbox in Settings.", "MICROSOFT_MAIL_RECONNECT_REQUIRED");
  }
}

async function refreshAgencyConnection(connection) {
  try {
    const tokens = await tokenRequest({
      grant_type: "refresh_token",
      refresh_token: decryptSecret(connection.refreshTokenEncrypted),
    });
    return prisma.agencyMicrosoftMailboxConnection.update({
      where: { id: connection.id },
      data: {
        accessTokenEncrypted: encryptSecret(tokens.access_token),
        ...(tokens.refresh_token ? { refreshTokenEncrypted: encryptSecret(tokens.refresh_token) } : {}),
        accessTokenExpiresAt: new Date(Date.now() + Number(tokens.expires_in || 3600) * 1000),
        grantedScopes: tokens.scope || connection.grantedScopes,
        status: "connected",
        lastError: null,
      },
    });
  } catch (error) {
    await prisma.agencyMicrosoftMailboxConnection.update({
      where: { id: connection.id },
      data: {
        status: "reauthorization_required",
        lastError: String(error.message || "Microsoft authorization expired.").slice(0, 500),
      },
    }).catch(() => {});
    throw createHttpError(409, "Reconnect the system Microsoft mailbox in Settings.", "MICROSOFT_SYSTEM_MAIL_RECONNECT_REQUIRED");
  }
}

export async function microsoftGraphClient(userId, { forceRefresh = false } = {}) {
  let connection = await prisma.userMailboxConnection.findUnique({ where: { userId } });
  if (!connection || connection.status !== "connected") {
    throw createHttpError(409, "Connect your Microsoft mailbox in Settings before sending email.", "PERSONAL_MAILBOX_NOT_CONNECTED");
  }
  if (forceRefresh || connection.accessTokenExpiresAt.getTime() < Date.now() + 2 * 60_000) {
    connection = await refreshConnection(connection);
  }
  return {
    connection,
    request: async (path, options = {}) => {
      try {
        return await graphFetch(decryptSecret(connection.accessTokenEncrypted), path, options);
      } catch (error) {
        if (error.graphStatus !== 401) throw error;
        connection = await refreshConnection(connection);
        return graphFetch(decryptSecret(connection.accessTokenEncrypted), path, options);
      }
    },
  };
}

export async function agencyMicrosoftGraphClient(agencyId, { forceRefresh = false, requireEnabled = true } = {}) {
  let connection = await prisma.agencyMicrosoftMailboxConnection.findUnique({ where: { agencyId } });
  if (!connection || connection.status !== "connected" || (requireEnabled && !connection.enabled)) {
    throw createHttpError(409, "Connect and enable the system Microsoft mailbox in Settings.", "SYSTEM_MAILBOX_NOT_CONNECTED");
  }
  if (forceRefresh || connection.accessTokenExpiresAt.getTime() < Date.now() + 2 * 60_000) {
    connection = await refreshAgencyConnection(connection);
  }
  return {
    connection,
    request: async (path, options = {}) => {
      try {
        return await graphFetch(decryptSecret(connection.accessTokenEncrypted), path, options);
      } catch (error) {
        if (error.graphStatus !== 401) throw error;
        connection = await refreshAgencyConnection(connection);
        return graphFetch(decryptSecret(connection.accessTokenEncrypted), path, options);
      }
    },
  };
}

const recipients = (values = []) => values.filter(Boolean).map((address) => ({ emailAddress: { address } }));
const recipientValues = (values) => {
  if (!values) return [];
  if (Array.isArray(values)) return values.flatMap(recipientValues);
  if (typeof values === "string") return values.split(",").map((item) => item.trim()).filter(Boolean);
  if (values.address) return [values.address];
  return [];
};
export const microsoftInternetMessageHeaders = (headers) =>
  Object.entries(headers || {})
    .filter(([name, value]) => /^x-/i.test(name) && value)
    .slice(0, 5)
    .map(([name, value]) => ({ name, value: String(value) }));
const escapeHtml = (value) =>
  String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");

// The signature builder in Personal Settings saves genuine markup (a
// styled table, a script-font name, an accent rule) — escaping that would
// dump raw tags into the email as visible text. A signature saved before
// that builder existed is still plain text with real newlines, so only
// that legacy shape gets escape-and-<br>'d; anything already containing a
// real tag is trusted as-is, same as a composed email's own bodyHtml
// already is elsewhere in this app.
function renderSignatureHtml(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  return /<[a-z][\s\S]*>/i.test(raw) ? raw : escapeHtml(raw).replace(/\n/g, "<br>");
}

export async function sendMicrosoftMailboxEmail({ userId, to, cc, bcc, replyTo, subject, text, html, headers, attachments = [] }) {
  const { connection, request } = await microsoftGraphClient(userId);
  const totalBytes = attachments.reduce((sum, item) => sum + Number(item.content?.length || 0), 0);
  if (totalBytes > 2.5 * 1024 * 1024) {
    throw createHttpError(413, "Microsoft mailbox attachments are currently limited to 2.5 MB per email.");
  }
  const signature = renderSignatureHtml(connection.signatureHtml);
  const contentType = html || signature ? "HTML" : "Text";
  const content = html
    ? `${html}${signature ? `<br><br>${signature}` : ""}`
    : signature
      ? `${escapeHtml(text).replace(/\n/g, "<br>")}<br><br>${signature}`
      : text || "";
  const internetMessageHeaders = microsoftInternetMessageHeaders(headers);
  await request("/me/sendMail", {
    method: "POST",
    body: JSON.stringify({
      message: {
        subject: subject || "",
        body: { contentType, content },
        toRecipients: recipients(to),
        ccRecipients: recipients(cc),
        bccRecipients: recipients(bcc),
        ...(replyTo ? { replyTo: recipients([replyTo]) } : {}),
        ...(internetMessageHeaders.length ? { internetMessageHeaders } : {}),
        attachments: attachments.map((item) => ({
          "@odata.type": "#microsoft.graph.fileAttachment",
          name: item.filename,
          contentType: item.contentType || "application/octet-stream",
          contentBytes: Buffer.from(item.content).toString("base64"),
          // Nodemailer's cid/contentDisposition convention (used
          // elsewhere in the codebase, e.g. the booking-confirmation
          // avatar) has no Graph equivalent by default — without this,
          // every attachment lands as a plain file, and an
          // <img src="cid:..."> reference in the HTML body never
          // resolves inline.
          ...(item.cid ? { contentId: item.cid, isInline: item.contentDisposition === "inline" } : {}),
        })),
      },
      saveToSentItems: true,
    }),
  });
  return { id: null, provider: "Microsoft 365", response: { accepted: true, mailbox: connection.emailAddress } };
}

export async function sendAgencyMicrosoftMailboxEmail({
  agencyId,
  to,
  cc,
  bcc,
  replyTo,
  subject,
  text,
  html,
  headers,
  attachments = [],
}) {
  const { connection, request } = await agencyMicrosoftGraphClient(agencyId);
  const totalBytes = attachments.reduce((sum, item) => sum + Number(item.content?.length || 0), 0);
  if (totalBytes > 2.5 * 1024 * 1024) {
    throw createHttpError(413, "Microsoft mailbox attachments are currently limited to 2.5 MB per email.");
  }
  const internetMessageHeaders = microsoftInternetMessageHeaders(headers);
  await request("/me/sendMail", {
    method: "POST",
    body: JSON.stringify({
      message: {
        subject: subject || "",
        body: { contentType: html ? "HTML" : "Text", content: html || text || "" },
        toRecipients: recipients(recipientValues(to)),
        ccRecipients: recipients(recipientValues(cc)),
        bccRecipients: recipients(recipientValues(bcc)),
        ...(replyTo ? { replyTo: recipients(recipientValues(replyTo)) } : {}),
        ...(internetMessageHeaders.length ? { internetMessageHeaders } : {}),
        attachments: attachments.map((item) => ({
          "@odata.type": "#microsoft.graph.fileAttachment",
          name: item.filename,
          contentType: item.contentType || "application/octet-stream",
          contentBytes: Buffer.from(item.content).toString("base64"),
          // Nodemailer's cid/contentDisposition convention (used
          // elsewhere in the codebase, e.g. the booking-confirmation
          // avatar) has no Graph equivalent by default — without this,
          // every attachment lands as a plain file, and an
          // <img src="cid:..."> reference in the HTML body never
          // resolves inline.
          ...(item.cid ? { contentId: item.cid, isInline: item.contentDisposition === "inline" } : {}),
        })),
      },
      saveToSentItems: true,
    }),
  });
  return {
    id: null,
    provider: "Microsoft 365",
    response: { accepted: true, mailbox: connection.emailAddress },
  };
}

export async function testAgencyMicrosoftMailbox(agencyId) {
  const { connection, request } = await agencyMicrosoftGraphClient(agencyId, {
    forceRefresh: true,
    requireEnabled: false,
  });
  await request("/me/mailFolders/inbox?$select=id,displayName");
  return prisma.agencyMicrosoftMailboxConnection.update({
    where: { id: connection.id },
    data: {
      lastSyncStatus: "Connected",
      lastSyncMessage: "Microsoft Graph can send mail and read this inbox.",
      lastError: null,
    },
  });
}

export async function agencyMicrosoftMailboxStatus(agencyId) {
  const connection = await prisma.agencyMicrosoftMailboxConnection.findUnique({
    where: { agencyId },
    select: {
      provider: true,
      emailAddress: true,
      displayName: true,
      status: true,
      enabled: true,
      inboundEnabled: true,
      connectedAt: true,
      lastSyncedAt: true,
      lastSyncStatus: true,
      lastSyncMessage: true,
      lastError: true,
    },
  });
  return {
    configured: microsoftMailboxConfigured(),
    connected: connection?.status === "connected",
    ...(connection || {}),
  };
}

export async function updateAgencyMicrosoftMailbox(agencyId, values) {
  return prisma.agencyMicrosoftMailboxConnection.update({
    where: { agencyId },
    data: {
      ...(values.enabled !== undefined ? { enabled: values.enabled === true } : {}),
      ...(values.inboundEnabled !== undefined ? { inboundEnabled: values.inboundEnabled === true } : {}),
    },
  });
}

export async function disconnectAgencyMicrosoftMailbox(agencyId) {
  await prisma.agencyMicrosoftMailboxConnection.delete({ where: { agencyId } }).catch(() => {});
}

// Incremental consent means a connection made before Calendars.ReadWrite was
// added to SCOPES only carries the old, narrower grant until the person
// reconnects — this is what lets the Settings UI tell those two states apart
// without guessing.
export function mailboxGrantsCalendarAccess(grantedScopes) {
  return String(grantedScopes || "").toLowerCase().includes("calendars.");
}

export async function personalMailboxStatus(userId) {
  const connection = await prisma.userMailboxConnection.findUnique({
    where: { userId },
    select: {
      provider: true,
      emailAddress: true,
      displayName: true,
      status: true,
      syncEnabled: true,
      calendarSyncEnabled: true,
      signatureHtml: true,
      connectedAt: true,
      lastSyncedAt: true,
      lastSyncStatus: true,
      lastSyncMessage: true,
      lastError: true,
      grantedScopes: true,
    },
  });
  const calendarScopeGranted = Boolean(connection?.status === "connected" && mailboxGrantsCalendarAccess(connection.grantedScopes));
  return {
    configured: microsoftMailboxConfigured(),
    connected: connection?.status === "connected",
    calendarScopeGranted,
    calendarSyncReady: calendarScopeGranted && connection?.calendarSyncEnabled !== false,
    ...(connection || {}),
  };
}

export async function updatePersonalMailbox(userId, values) {
  return prisma.userMailboxConnection.update({
    where: { userId },
    data: {
      ...(values.syncEnabled !== undefined ? { syncEnabled: values.syncEnabled === true } : {}),
      ...(values.calendarSyncEnabled !== undefined ? { calendarSyncEnabled: values.calendarSyncEnabled === true } : {}),
      ...(values.signatureHtml !== undefined ? { signatureHtml: String(values.signatureHtml || "").trim().slice(0, 10000) || null } : {}),
    },
  });
}

export async function disconnectPersonalMailbox(userId) {
  await prisma.userMailboxConnection.delete({ where: { userId } }).catch(() => {});
}
