import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import prisma from "./prisma/client.js";
import { decryptSecret, encryptSecret, secretEncryptionReady } from "./secretEncryption.js";
import { createHttpError } from "../utils/http.js";

const GRAPH_BASE = "https://graph.microsoft.com/v1.0";
const STATE_TTL_MS = 10 * 60_000;
const SCOPES = ["openid", "profile", "email", "offline_access", "User.Read", "Mail.Read", "Mail.Send"];

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

export function microsoftMailboxAuthorizeUrl(state) {
  const params = new URLSearchParams({
    client_id: process.env.MS_MAIL_CLIENT_ID,
    response_type: "code",
    redirect_uri: process.env.MS_MAIL_REDIRECT_URI,
    response_mode: "query",
    scope: SCOPES.join(" "),
    state,
    prompt: "select_account",
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

const recipients = (values = []) => values.filter(Boolean).map((address) => ({ emailAddress: { address } }));
const escapeHtml = (value) =>
  String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");

export async function sendMicrosoftMailboxEmail({ userId, to, cc, bcc, replyTo, subject, text, html, headers, attachments = [] }) {
  const { connection, request } = await microsoftGraphClient(userId);
  const totalBytes = attachments.reduce((sum, item) => sum + Number(item.content?.length || 0), 0);
  if (totalBytes > 2.5 * 1024 * 1024) {
    throw createHttpError(413, "Microsoft mailbox attachments are currently limited to 2.5 MB per email.");
  }
  const signature = escapeHtml(connection.signatureHtml).trim().replace(/\n/g, "<br>");
  const contentType = html || signature ? "HTML" : "Text";
  const content = html
    ? `${html}${signature ? `<br><br>${signature}` : ""}`
    : signature
      ? `${escapeHtml(text).replace(/\n/g, "<br>")}<br><br>${signature}`
      : text || "";
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
        internetMessageHeaders: Object.entries(headers || {})
          .filter(([name, value]) => /^x-/i.test(name) && value)
          .map(([name, value]) => ({ name, value: String(value) })),
        attachments: attachments.map((item) => ({
          "@odata.type": "#microsoft.graph.fileAttachment",
          name: item.filename,
          contentType: item.contentType || "application/octet-stream",
          contentBytes: Buffer.from(item.content).toString("base64"),
        })),
      },
      saveToSentItems: true,
    }),
  });
  return { id: null, provider: "Microsoft 365", response: { accepted: true, mailbox: connection.emailAddress } };
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
      signatureHtml: true,
      connectedAt: true,
      lastSyncedAt: true,
      lastSyncStatus: true,
      lastSyncMessage: true,
      lastError: true,
    },
  });
  return { configured: microsoftMailboxConfigured(), connected: connection?.status === "connected", ...(connection || {}) };
}

export async function updatePersonalMailbox(userId, values) {
  return prisma.userMailboxConnection.update({
    where: { userId },
    data: {
      ...(values.syncEnabled !== undefined ? { syncEnabled: values.syncEnabled === true } : {}),
      ...(values.signatureHtml !== undefined ? { signatureHtml: String(values.signatureHtml || "").trim().slice(0, 10000) || null } : {}),
    },
  });
}

export async function disconnectPersonalMailbox(userId) {
  await prisma.userMailboxConnection.delete({ where: { userId } }).catch(() => {});
}
