import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import prisma from "../../services/prisma/client.js";
import { decryptSecret, encryptSecret, secretEncryptionReady } from "../../services/secretEncryption.js";
import { createHttpError } from "../../utils/http.js";
import { providerChannel, providerEventId } from "./lead.provider.adapters.js";

export const LEAD_CONNECTION_PROVIDERS = ["WEBSITE", "META", "WHATSAPP", "GOOGLE_ADS", "EMAIL"];

const clean = (value, max = 500) => String(value ?? "").trim().slice(0, max);
const connectionSelect = {
  id: true, name: true, provider: true, publicToken: true, isActive: true, firstResponseMinutes: true,
  allowedOrigins: true, lastEventAt: true, createdAt: true, updatedAt: true,
  source: { select: { id: true, name: true, type: true } }, campaign: { select: { id: true, name: true } },
  owner: { select: { id: true, fullName: true } },
};

function requireAdmin(req) {
  if (req.auth.role !== "admin") throw createHttpError(403, "Only agency administrators can manage website connectors.", "FORBIDDEN");
}

function webhookUrl(connection, req) {
  const base = clean(process.env.API_PUBLIC_URL || `${req.protocol}://${req.get("host")}`, 1000).replace(/\/+$/, "");
  return `${base}/api/lead-connectors/website/${connection.publicToken}/events`;
}

function providerWebhookUrl(connection, req) {
  const base = clean(process.env.API_PUBLIC_URL || `${req.protocol}://${req.get("host")}`, 1000).replace(/\/+$/, "");
  return `${base}/api/lead-connectors/${connection.provider.toLowerCase()}/${connection.publicToken}/events`;
}

function parseOrigins(value) {
  const values = Array.isArray(value) ? value : String(value || "").split(/[\n,]/);
  const origins = [...new Set(values.map((item) => clean(item, 500)).filter(Boolean).map((item) => {
    try {
      const parsed = new URL(item);
      if (parsed.protocol !== "https:" || parsed.pathname !== "/" || parsed.search || parsed.hash) throw new Error();
      return parsed.origin;
    } catch { throw createHttpError(400, `Allowed origin is invalid: ${item}`, "INVALID_ORIGIN"); }
  }))];
  if (origins.length > 20) throw createHttpError(400, "A connector supports up to 20 allowed origins.", "TOO_MANY_ORIGINS");
  return origins;
}

function parseConnection(body = {}) {
  const name = clean(body.name, 120), sourceId = clean(body.sourceId, 100), ownerUserId = clean(body.ownerUserId, 100);
  if (!name || !sourceId || !ownerUserId) throw createHttpError(400, "Name, source, and lead owner are required.", "VALIDATION_ERROR");
  const firstResponseMinutes = Number(body.firstResponseMinutes ?? 15);
  if (!Number.isInteger(firstResponseMinutes) || firstResponseMinutes < 1 || firstResponseMinutes > 10080) throw createHttpError(400, "Response target must be between 1 and 10080 minutes.", "VALIDATION_ERROR");
  return { name, sourceId, ownerUserId, campaignId: clean(body.campaignId, 100) || null, firstResponseMinutes, allowedOrigins: parseOrigins(body.allowedOrigins) };
}

function parseProvider(value) {
  const provider = clean(value, 40).toUpperCase();
  if (!LEAD_CONNECTION_PROVIDERS.includes(provider)) throw createHttpError(400, "Select a supported connector provider.", "INVALID_PROVIDER");
  return provider;
}

async function validateReferences(agencyId, values) {
  const [source, owner, campaign] = await Promise.all([
    prisma.leadSource.findFirst({ where: { id: values.sourceId, agencyId, isActive: true }, select: { id: true } }),
    prisma.user.findFirst({ where: { id: values.ownerUserId, agencyId, status: "active", memberships: { some: { agencyId, isActive: true, role: { in: ["admin", "consultant", "frontdesk"] } } } }, select: { id: true } }),
    values.campaignId ? prisma.leadCampaign.findFirst({ where: { id: values.campaignId, agencyId, sourceId: values.sourceId, isActive: true }, select: { id: true } }) : Promise.resolve(null),
  ]);
  if (!source) throw createHttpError(400, "Select an active lead source.", "INVALID_LEAD_SOURCE");
  if (!owner) throw createHttpError(400, "Select an active lead owner.", "INVALID_LEAD_OWNER");
  if (values.campaignId && !campaign) throw createHttpError(400, "Campaign does not match the selected source.", "INVALID_LEAD_CAMPAIGN");
}

function newCredentials() {
  const secret = randomBytes(32).toString("base64url");
  return { secret, publicToken: randomBytes(24).toString("base64url"), signingSecretEncrypted: encryptSecret(secret) };
}

export async function listWebsiteConnections(req) {
  requireAdmin(req);
  const connections = await prisma.leadSourceConnection.findMany({ where: { agencyId: req.auth.agencyId, provider: "WEBSITE" }, select: connectionSelect, orderBy: { createdAt: "desc" } });
  return { secureStorageReady: secretEncryptionReady(), connections: connections.map((item) => ({ ...item, webhookUrl: webhookUrl(item, req) })) };
}

export async function createWebsiteConnection(req) {
  requireAdmin(req);
  if (!secretEncryptionReady()) throw createHttpError(503, "Secure credential storage is not configured.", "SECRET_STORAGE_UNAVAILABLE");
  const values = parseConnection(req.body);
  await validateReferences(req.auth.agencyId, values);
  const credentials = newCredentials();
  const connection = await prisma.leadSourceConnection.create({ data: { ...values, agencyId: req.auth.agencyId, provider: "WEBSITE", publicToken: credentials.publicToken, signingSecretEncrypted: credentials.signingSecretEncrypted }, select: connectionSelect });
  await prisma.activityLog.create({ data: { agencyId: req.auth.agencyId, userId: req.auth.userId, action: "lead.website_connection_created", details: connection.name, entityType: "lead_source_connection", entityId: connection.id } });
  return { ...connection, webhookUrl: webhookUrl(connection, req), signingSecret: credentials.secret };
}

export async function updateWebsiteConnection(req) {
  requireAdmin(req);
  const existing = await prisma.leadSourceConnection.findFirst({ where: { id: req.params.connectionId, agencyId: req.auth.agencyId, provider: "WEBSITE" } });
  if (!existing) throw createHttpError(404, "Website connector not found.", "CONNECTION_NOT_FOUND");
  const data = {};
  if (typeof req.body.isActive === "boolean") data.isActive = req.body.isActive;
  if (["name", "sourceId", "ownerUserId", "firstResponseMinutes", "allowedOrigins", "campaignId"].some((key) => req.body[key] !== undefined)) {
    const values = parseConnection({ ...existing, ...req.body });
    await validateReferences(req.auth.agencyId, values);
    Object.assign(data, values);
  }
  const connection = await prisma.leadSourceConnection.update({ where: { id: existing.id }, data, select: connectionSelect });
  return { ...connection, webhookUrl: webhookUrl(connection, req) };
}

export async function rotateWebsiteSecret(req) {
  requireAdmin(req);
  const existing = await prisma.leadSourceConnection.findFirst({ where: { id: req.params.connectionId, agencyId: req.auth.agencyId, provider: "WEBSITE" } });
  if (!existing) throw createHttpError(404, "Website connector not found.", "CONNECTION_NOT_FOUND");
  const secret = randomBytes(32).toString("base64url");
  await prisma.leadSourceConnection.update({ where: { id: existing.id }, data: { signingSecretEncrypted: encryptSecret(secret) } });
  await prisma.activityLog.create({ data: { agencyId: req.auth.agencyId, userId: req.auth.userId, action: "lead.website_connection_secret_rotated", details: existing.name, entityType: "lead_source_connection", entityId: existing.id } });
  return { signingSecret: secret };
}

export function verifyWebsiteSignature({ rawBody, timestamp, signature, secret, now = Date.now() }) {
  const seconds = Number(timestamp);
  if (!Number.isInteger(seconds) || Math.abs(now - seconds * 1000) > 5 * 60_000) throw createHttpError(401, "Webhook timestamp is missing or expired.", "WEBHOOK_REPLAY_REJECTED");
  const supplied = clean(signature, 200).replace(/^sha256=/i, "");
  if (!/^[a-f\d]{64}$/i.test(supplied)) throw createHttpError(401, "Webhook signature is invalid.", "INVALID_WEBHOOK_SIGNATURE");
  const expected = createHmac("sha256", secret).update(`${seconds}.`).update(rawBody).digest("hex");
  const left = Buffer.from(expected, "hex"), right = Buffer.from(supplied, "hex");
  if (left.length !== right.length || !timingSafeEqual(left, right)) throw createHttpError(401, "Webhook signature is invalid.", "INVALID_WEBHOOK_SIGNATURE");
}

export async function receiveWebsiteEvent(req) {
  const connection = await prisma.leadSourceConnection.findUnique({ where: { publicToken: clean(req.params.token, 200) } });
  if (!connection?.isActive || connection.provider !== "WEBSITE") throw createHttpError(404, "Website connector not found.", "CONNECTION_NOT_FOUND");
  const origin = clean(req.get("origin"), 500);
  const allowedOrigins = Array.isArray(connection.allowedOrigins) ? connection.allowedOrigins : [];
  if (origin && allowedOrigins.length && !allowedOrigins.includes(origin)) throw createHttpError(403, "This website origin is not allowed.", "ORIGIN_NOT_ALLOWED");
  const rawBody = req.rawBody || Buffer.from(JSON.stringify(req.body || {}));
  verifyWebsiteSignature({ rawBody, timestamp: req.get("x-casedesk-timestamp"), signature: req.get("x-casedesk-signature"), secret: decryptSecret(connection.signingSecretEncrypted) });
  // Honeypot: a hidden form field a real visitor never fills in, only a
  // bot filling every field would. Silently accept-but-discard rather than
  // reject, mirroring parsePublicSubmission's bot handling — a 4xx here
  // would just teach the bot which field to leave blank next time.
  if (clean(req.body?.hp, 200) || clean(req.body?.website, 200)) {
    await prisma.leadSourceConnection.update({ where: { id: connection.id }, data: { lastEventAt: new Date() } });
    return { accepted: true, duplicate: false, reference: null };
  }
  const externalId = clean(req.get("x-casedesk-event-id") || req.body?.externalId || req.body?.providerRecordId || req.body?.id, 300) || createHash("sha256").update(rawBody).digest("hex");
  const idempotencyKey = `website:${connection.id}:${externalId}`;
  try {
    const event = await prisma.leadIncomingEvent.create({ data: {
      agencyId: connection.agencyId, sourceId: connection.sourceId, campaignId: connection.campaignId,
      sourceConnectionId: connection.id, channel: "WEBSITE_CONNECTOR", idempotencyKey, rawPayload: req.body || {},
    }, select: { id: true } });
    await prisma.leadSourceConnection.update({ where: { id: connection.id }, data: { lastEventAt: new Date() } });
    return { accepted: true, duplicate: false, reference: event.id };
  } catch (error) {
    if (error?.code !== "P2002") throw error;
    const event = await prisma.leadIncomingEvent.findFirst({ where: { agencyId: connection.agencyId, idempotencyKey }, select: { id: true } });
    return { accepted: true, duplicate: true, reference: event?.id || null };
  }
}

function publicConnection(connection, req) { return { ...connection, webhookUrl: providerWebhookUrl(connection, req), verificationToken: connection.publicToken }; }

export async function listSourceConnections(req) {
  requireAdmin(req);
  const connections = await prisma.leadSourceConnection.findMany({ where: { agencyId: req.auth.agencyId }, select: connectionSelect, orderBy: { createdAt: "desc" } });
  return { secureStorageReady: secretEncryptionReady(), connections: connections.map((item) => publicConnection(item, req)) };
}

export async function createSourceConnection(req) {
  requireAdmin(req);
  if (!secretEncryptionReady()) throw createHttpError(503, "Secure credential storage is not configured.", "SECRET_STORAGE_UNAVAILABLE");
  const provider = parseProvider(req.body.provider);
  const values = parseConnection(req.body);
  await validateReferences(req.auth.agencyId, values);
  const suppliedSecret = clean(req.body.providerSecret, 1000);
  const suppliedAccessToken = clean(req.body.providerAccessToken, 4000);
  if (["META", "WHATSAPP"].includes(provider) && !suppliedSecret) throw createHttpError(400, "The provider app secret is required for Meta and WhatsApp signature verification.", "PROVIDER_SECRET_REQUIRED");
  if (provider === "META" && !suppliedAccessToken) throw createHttpError(400, "A Meta page or system-user access token is required to retrieve lead details.", "PROVIDER_ACCESS_TOKEN_REQUIRED");
  const credentials = newCredentials();
  const signingSecret = suppliedSecret || credentials.secret;
  const connection = await prisma.leadSourceConnection.create({ data: { ...values, agencyId: req.auth.agencyId, provider, publicToken: credentials.publicToken, signingSecretEncrypted: encryptSecret(signingSecret), accessTokenEncrypted: suppliedAccessToken ? encryptSecret(suppliedAccessToken) : null }, select: connectionSelect });
  await prisma.activityLog.create({ data: { agencyId: req.auth.agencyId, userId: req.auth.userId, action: "lead.source_connection_created", details: `${provider}: ${connection.name}`, entityType: "lead_source_connection", entityId: connection.id } });
  return { ...publicConnection(connection, req), signingSecret: suppliedSecret ? null : signingSecret };
}

export async function updateSourceConnection(req) {
  requireAdmin(req);
  const existing = await prisma.leadSourceConnection.findFirst({ where: { id: req.params.connectionId, agencyId: req.auth.agencyId } });
  if (!existing) throw createHttpError(404, "Connector not found.", "CONNECTION_NOT_FOUND");
  const data = {};
  if (typeof req.body.isActive === "boolean") data.isActive = req.body.isActive;
  if (["name", "sourceId", "ownerUserId", "firstResponseMinutes", "allowedOrigins", "campaignId"].some((key) => req.body[key] !== undefined)) {
    const values = parseConnection({ ...existing, ...req.body }); await validateReferences(req.auth.agencyId, values); Object.assign(data, values);
  }
  const connection = await prisma.leadSourceConnection.update({ where: { id: existing.id }, data, select: connectionSelect });
  return publicConnection(connection, req);
}

export async function rotateSourceConnectionSecret(req) {
  requireAdmin(req);
  const existing = await prisma.leadSourceConnection.findFirst({ where: { id: req.params.connectionId, agencyId: req.auth.agencyId } });
  if (!existing) throw createHttpError(404, "Connector not found.", "CONNECTION_NOT_FOUND");
  const supplied = clean(req.body?.providerSecret, 1000);
  const suppliedAccessToken = clean(req.body?.providerAccessToken, 4000);
  if (["META", "WHATSAPP"].includes(existing.provider) && !supplied) throw createHttpError(400, "Enter the new provider app secret.", "PROVIDER_SECRET_REQUIRED");
  const secret = supplied || randomBytes(32).toString("base64url");
  await prisma.leadSourceConnection.update({ where: { id: existing.id }, data: { signingSecretEncrypted: encryptSecret(secret), ...(suppliedAccessToken ? { accessTokenEncrypted: encryptSecret(suppliedAccessToken) } : {}) } });
  await prisma.activityLog.create({ data: { agencyId: req.auth.agencyId, userId: req.auth.userId, action: "lead.source_connection_secret_rotated", details: `${existing.provider}: ${existing.name}`, entityType: "lead_source_connection", entityId: existing.id } });
  return { signingSecret: supplied ? null : secret };
}

function safeEqualText(leftValue, rightValue) {
  const left = Buffer.from(String(leftValue || "")), right = Buffer.from(String(rightValue || ""));
  return left.length === right.length && timingSafeEqual(left, right);
}

function verifyProviderRequest(provider, req, connection, rawBody) {
  const secret = decryptSecret(connection.signingSecretEncrypted);
  if (["META", "WHATSAPP"].includes(provider)) {
    const supplied = clean(req.get("x-hub-signature-256"), 200).replace(/^sha256=/i, "");
    const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
    if (!/^[a-f\d]{64}$/i.test(supplied) || !safeEqualText(expected, supplied)) throw createHttpError(401, "Provider signature is invalid.", "INVALID_WEBHOOK_SIGNATURE");
    return;
  }
  if (provider === "GOOGLE_ADS") {
    if (!safeEqualText(secret, req.body?.google_key || req.get("x-google-key"))) throw createHttpError(401, "Google lead key is invalid.", "INVALID_WEBHOOK_SIGNATURE");
    return;
  }
  verifyWebsiteSignature({ rawBody, timestamp: req.get("x-casedesk-timestamp"), signature: req.get("x-casedesk-signature"), secret });
}

export async function verifyProviderChallenge(req) {
  const provider = parseProvider(req.params.provider);
  if (!["META", "WHATSAPP"].includes(provider)) throw createHttpError(404, "Verification route not found.", "NOT_FOUND");
  const connection = await prisma.leadSourceConnection.findUnique({ where: { publicToken: clean(req.params.token, 200) } });
  if (!connection?.isActive || connection.provider !== provider) throw createHttpError(404, "Connector not found.", "CONNECTION_NOT_FOUND");
  if (req.query["hub.mode"] !== "subscribe" || !safeEqualText(connection.publicToken, req.query["hub.verify_token"])) throw createHttpError(403, "Provider verification failed.", "INVALID_VERIFICATION_TOKEN");
  return clean(req.query["hub.challenge"], 500);
}

export async function receiveProviderEvent(req) {
  const provider = parseProvider(req.params.provider);
  const connection = await prisma.leadSourceConnection.findUnique({ where: { publicToken: clean(req.params.token, 200) } });
  if (!connection?.isActive || connection.provider !== provider) throw createHttpError(404, "Connector not found.", "CONNECTION_NOT_FOUND");
  const rawBody = req.rawBody || Buffer.from(JSON.stringify(req.body || {}));
  verifyProviderRequest(provider, req, connection, rawBody);
  const eventId = clean(req.get("x-casedesk-event-id") || providerEventId(provider, req.body), 300) || createHash("sha256").update(rawBody).digest("hex");
  const idempotencyKey = `${provider.toLowerCase()}:${connection.id}:${eventId}`;
  try {
    const event = await prisma.leadIncomingEvent.create({ data: { agencyId: connection.agencyId, sourceId: connection.sourceId, campaignId: connection.campaignId, sourceConnectionId: connection.id, channel: providerChannel(provider), idempotencyKey, rawPayload: req.body || {} }, select: { id: true } });
    await prisma.leadSourceConnection.update({ where: { id: connection.id }, data: { lastEventAt: new Date() } });
    return { accepted: true, duplicate: false, reference: event.id };
  } catch (error) {
    if (error?.code !== "P2002") throw error;
    const event = await prisma.leadIncomingEvent.findFirst({ where: { agencyId: connection.agencyId, idempotencyKey }, select: { id: true } });
    return { accepted: true, duplicate: true, reference: event?.id || null };
  }
}

export async function enqueueTrustedProviderLead({ agencyId, provider, payload, eventId }) {
  const connection = await prisma.leadSourceConnection.findFirst({ where: { agencyId, provider, isActive: true }, orderBy: { createdAt: "asc" } });
  if (!connection) return null;
  const rawPayload = payload && typeof payload === "object" ? payload : {};
  const resolvedId = clean(eventId || providerEventId(provider, rawPayload), 300) || createHash("sha256").update(JSON.stringify(rawPayload)).digest("hex");
  const idempotencyKey = `${provider.toLowerCase()}:${connection.id}:${resolvedId}`;
  try {
    const event = await prisma.leadIncomingEvent.create({ data: { agencyId, sourceId: connection.sourceId, campaignId: connection.campaignId, sourceConnectionId: connection.id, channel: providerChannel(provider), idempotencyKey, rawPayload }, select: { id: true } });
    await prisma.leadSourceConnection.update({ where: { id: connection.id }, data: { lastEventAt: new Date() } });
    return event;
  } catch (error) {
    if (error?.code === "P2002") return prisma.leadIncomingEvent.findFirst({ where: { agencyId, idempotencyKey }, select: { id: true } });
    throw error;
  }
}
