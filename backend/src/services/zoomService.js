import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import prisma from "./prisma/client.js";
import { decryptSecret, encryptSecret, secretEncryptionReady } from "./secretEncryption.js";
import { createHttpError } from "../utils/http.js";
import { logger } from "./logger.js";
import { lockSchedulingTransaction } from "./schedulingAssignmentService.js";
import { notifyUsers, schedulingCoordinatorRecipientIds } from "./notificationService.js";

const AUTHORIZE_URL = "https://zoom.us/oauth/authorize";
const TOKEN_URL = "https://zoom.us/oauth/token";
const REVOKE_URL = "https://zoom.us/oauth/revoke";
const API_BASE = "https://api.zoom.us/v2";
const STATE_TTL_MS = 10 * 60_000;
const TOKEN_REQUEST_TIMEOUT_MS = 15_000;
const API_REQUEST_TIMEOUT_MS = 20_000;
const REVOKE_REQUEST_TIMEOUT_MS = 10_000;
const CONNECTION_MAINTENANCE_INTERVAL_MS = 24 * 60 * 60_000;
const CONNECTION_REFRESH_AFTER_MS = 30 * 24 * 60 * 60_000;
let connectionMaintenanceTimer = null;

const REQUIRED_ZOOM_SCOPE_GROUPS = [
  {
    capability: "read the connected Zoom administrator",
    scopes: ["user:read:user:admin", "user:read:admin"],
  },
  {
    capability: "list organization Zoom users",
    scopes: ["user:read:list_users:admin", "user:read:admin"],
  },
  {
    capability: "create Zoom meetings",
    scopes: ["meeting:write:meeting:admin", "meeting:write:admin"],
  },
  {
    capability: "update Zoom meetings",
    scopes: ["meeting:update:meeting:admin", "meeting:write:admin"],
  },
  {
    capability: "delete Zoom meetings",
    scopes: ["meeting:delete:meeting:admin", "meeting:write:admin"],
  },
];

export function zoomConfigured() {
  return Boolean(
    process.env.ZOOM_CLIENT_ID
    && process.env.ZOOM_CLIENT_SECRET
    && process.env.ZOOM_REDIRECT_URI
    && process.env.ZOOM_WEBHOOK_SECRET_TOKEN
    && secretEncryptionReady(),
  );
}

export function assertZoomGrantedScopes(scopeValue) {
  const granted = new Set(
    String(scopeValue || "")
      .split(/[\s,]+/)
      .map((scope) => scope.trim().toLowerCase())
      .filter(Boolean),
  );
  const missing = REQUIRED_ZOOM_SCOPE_GROUPS
    .filter((group) => !group.scopes.some((scope) => granted.has(scope)))
    .map((group) => group.capability);
  if (missing.length) {
    throw createHttpError(
      409,
      `The Zoom app authorization is missing permission to ${missing.join(", ")}. Add the required scopes in Zoom Marketplace, then reconnect.`,
      "ZOOM_SCOPES_MISSING",
    );
  }
  return [...granted].sort().join(" ");
}

function stateSecret() {
  return String(process.env.MAIL_SETTINGS_ENCRYPTION_KEY || process.env.ZOOM_CLIENT_SECRET || "casedesk");
}

export function buildZoomOAuthState(agencyId, userId) {
  const payload = `${agencyId}.${userId}.${Date.now() + STATE_TTL_MS}.${randomUUID().slice(0, 8)}`;
  const signature = createHmac("sha256", stateSecret()).update(payload).digest("hex").slice(0, 32);
  return Buffer.from(`${payload}.${signature}`).toString("base64url");
}

export function parseZoomOAuthState(state) {
  try {
    const raw = Buffer.from(String(state || ""), "base64url").toString();
    const parts = raw.split(".");
    if (parts.length !== 5) return null;
    const [agencyId, userId, expiry, nonce, signature] = parts;
    const payload = `${agencyId}.${userId}.${expiry}.${nonce}`;
    const expected = createHmac("sha256", stateSecret()).update(payload).digest("hex").slice(0, 32);
    if (signature.length !== expected.length || !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;
    if (Number(expiry) < Date.now()) return null;
    return { agencyId, userId };
  } catch {
    return null;
  }
}

export function buildZoomAuthorizeUrl(state) {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: process.env.ZOOM_CLIENT_ID,
    redirect_uri: process.env.ZOOM_REDIRECT_URI,
    state,
  });
  return `${AUTHORIZE_URL}?${params.toString()}`;
}

function basicAuthHeader() {
  return `Basic ${Buffer.from(`${process.env.ZOOM_CLIENT_ID}:${process.env.ZOOM_CLIENT_SECRET}`).toString("base64")}`;
}

async function tokenRequest(values) {
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    signal: AbortSignal.timeout(TOKEN_REQUEST_TIMEOUT_MS),
    headers: {
      Authorization: basicAuthHeader(),
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: new URLSearchParams(values).toString(),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = createHttpError(502, payload.reason || payload.error_description || payload.error || "Zoom authorization failed.", "ZOOM_TOKEN_ERROR");
    error.providerStatus = response.status;
    throw error;
  }
  return payload;
}

export async function exchangeZoomAuthorizationCode(code) {
  return tokenRequest({
    grant_type: "authorization_code",
    code,
    redirect_uri: process.env.ZOOM_REDIRECT_URI,
  });
}

async function directZoomFetch(accessToken, path, options = {}) {
  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    signal: options.signal || AbortSignal.timeout(API_REQUEST_TIMEOUT_MS),
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(options.headers || {}),
    },
  });
  const payload = response.status === 204 ? null : await response.json().catch(() => ({}));
  return { response, payload };
}

function connectionTokenData(tokens, existingScopes = "") {
  const grantedScopes = tokens.scope
    ? assertZoomGrantedScopes(tokens.scope)
    : String(existingScopes || "");
  return {
    accessTokenEncrypted: encryptSecret(tokens.access_token),
    ...(tokens.refresh_token ? { refreshTokenEncrypted: encryptSecret(tokens.refresh_token) } : {}),
    accessTokenExpiresAt: new Date(Date.now() + Number(tokens.expires_in || 3600) * 1000),
    grantedScopes,
    status: "connected",
    lastError: null,
  };
}

export async function saveZoomConnection({ agencyId, userId, tokens }) {
  if (!tokens?.access_token || !tokens?.refresh_token) {
    throw createHttpError(
      502,
      "Zoom did not return the access and refresh tokens required for a durable connection.",
      "ZOOM_TOKEN_ERROR",
    );
  }
  assertZoomGrantedScopes(tokens.scope);
  const { response, payload: profile } = await directZoomFetch(tokens.access_token, "/users/me");
  if (!response.ok || !profile?.id) {
    throw createHttpError(502, profile?.message || "Zoom could not verify the connected administrator.", "ZOOM_PROFILE_ERROR");
  }
  const providerAccountId = String(profile.account_id || profile.id);
  const [taken, existing] = await Promise.all([
    prisma.agencyZoomConnection.findUnique({ where: { providerAccountId }, select: { agencyId: true } }),
    prisma.agencyZoomConnection.findUnique({ where: { agencyId }, select: { providerAccountId: true } }),
  ]);
  if (taken && taken.agencyId !== agencyId) {
    throw createHttpError(409, "This Zoom organization is already connected to another CaseDesk workspace.", "ZOOM_ACCOUNT_TAKEN");
  }
  const changingOrganization = Boolean(existing && existing.providerAccountId !== providerAccountId);
  if (changingOrganization) {
    const commitments = await activeZoomCommitments(agencyId);
    if (commitmentTotal(commitments)) {
      throw createHttpError(
        409,
        `This workspace still has ${commitments.futureMeetings} active/future Zoom appointment${commitments.futureMeetings === 1 ? "" : "s"}, ${commitments.activePaymentHolds} checkout${commitments.activePaymentHolds === 1 ? "" : "s"}, and ${commitments.activeWaitlistOffers} waitlist offer${commitments.activeWaitlistOffers === 1 ? "" : "s"}. Resolve them before connecting a different Zoom organization.`,
        "ZOOM_COMMITMENTS_ACTIVE",
      );
    }
  }
  const data = {
    agencyId,
    providerAccountId,
    accountName: profile.account_number ? `Zoom account ${profile.account_number}` : null,
    connectedUserId: String(profile.id),
    connectedUserEmail: profile.email || null,
    refreshTokenEncrypted: encryptSecret(tokens.refresh_token),
    connectedById: userId,
    connectedAt: new Date(),
    ...connectionTokenData(tokens),
  };
  return prisma.$transaction(async (tx) => {
    await lockSchedulingTransaction(tx, agencyId, new Date());
    const current = await tx.agencyZoomConnection.findUnique({
      where: { agencyId },
      select: { providerAccountId: true },
    });
    const replacingOrganization = Boolean(current && current.providerAccountId !== providerAccountId);
    if (replacingOrganization) {
      const currentCommitments = await activeZoomCommitments(agencyId, tx);
      if (commitmentTotal(currentCommitments)) {
        throw createHttpError(
          409,
          `This workspace still has ${currentCommitments.futureMeetings} active/future Zoom appointment${currentCommitments.futureMeetings === 1 ? "" : "s"}, ${currentCommitments.activePaymentHolds} checkout${currentCommitments.activePaymentHolds === 1 ? "" : "s"}, and ${currentCommitments.activeWaitlistOffers} waitlist offer${currentCommitments.activeWaitlistOffers === 1 ? "" : "s"}. Resolve them before connecting a different Zoom organization.`,
          "ZOOM_COMMITMENTS_ACTIVE",
        );
      }
    }
    const connection = await tx.agencyZoomConnection.upsert({
      where: { agencyId },
      create: data,
      update: data,
    });
    // Reauthorizing the same organization must not erase carefully chosen
    // consultant-host mappings or strand its future appointments. A genuine
    // organization switch has different host IDs, so only that case resets.
    if (!current || replacingOrganization) await tx.zoomHostMapping.deleteMany({ where: { agencyId } });
    return connection;
  });
}

async function refreshZoomConnection(connection) {
  try {
    return await prisma.$transaction(async (tx) => {
      // Zoom rotates refresh tokens. Serialize refreshes across every API
      // process so two simultaneous requests cannot invalidate each other.
      const lockKey = `zoom-token:${connection.agencyId}`;
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`;
      const latest = await tx.agencyZoomConnection.findUnique({ where: { id: connection.id } });
      if (!latest || latest.status !== "connected") {
        throw createHttpError(409, "The Zoom connection is no longer active.", "ZOOM_RECONNECT_REQUIRED");
      }
      const refreshedElsewhere = latest.refreshTokenEncrypted !== connection.refreshTokenEncrypted
        || latest.updatedAt.getTime() > connection.updatedAt.getTime();
      if (refreshedElsewhere && latest.accessTokenExpiresAt.getTime() > Date.now() + 30_000) {
        return { ...latest, accessToken: decryptSecret(latest.accessTokenEncrypted) };
      }
      const tokens = await tokenRequest({
        grant_type: "refresh_token",
        refresh_token: decryptSecret(latest.refreshTokenEncrypted),
      });
      const updated = await tx.agencyZoomConnection.update({
        where: { id: latest.id },
        data: connectionTokenData(tokens, latest.grantedScopes),
      });
      return { ...updated, accessToken: tokens.access_token };
    }, { maxWait: 10_000, timeout: 20_000 });
  } catch (error) {
    const permanent = [400, 401, 403].includes(Number(error.providerStatus))
      || ["ZOOM_RECONNECT_REQUIRED", "ZOOM_SCOPES_MISSING"].includes(error.code);
    if (!permanent) throw error;
    await prisma.$transaction([
      prisma.agencyZoomConnection.update({
        where: { id: connection.id },
        data: { status: "error", lastError: `Token refresh failed: ${error.message}`.slice(0, 500) },
      }),
      prisma.bookingSettings.updateMany({
        where: { agencyId: connection.agencyId },
        data: { zoomBookingEnabled: false },
      }),
    ]).catch(() => {});
    throw createHttpError(409, "The Zoom connection has expired. Reconnect it in Scheduling.", "ZOOM_RECONNECT_REQUIRED");
  }
}

export async function assertZoomOperational(agencyId, db = prisma) {
  if (!zoomConfigured()) {
    throw createHttpError(503, "Zoom is not configured on the server.", "ZOOM_NOT_CONFIGURED");
  }
  const connection = await db.agencyZoomConnection.findUnique({
    where: { agencyId },
    select: { status: true },
  });
  if (connection?.status !== "connected") {
    throw createHttpError(409, "Zoom is not connected for this workspace.", "ZOOM_NOT_CONNECTED");
  }
  return true;
}

export async function getZoomClient(agencyId, { forceRefresh = false } = {}) {
  let connection = await prisma.agencyZoomConnection.findUnique({ where: { agencyId } });
  if (!connection || connection.status !== "connected") {
    throw createHttpError(409, "Zoom is not connected for this workspace.", "ZOOM_NOT_CONNECTED");
  }
  if (forceRefresh || connection.accessTokenExpiresAt.getTime() < Date.now() + 2 * 60_000) {
    const refreshed = await refreshZoomConnection(connection);
    return { connection: refreshed, accessToken: refreshed.accessToken };
  }
  return { connection, accessToken: decryptSecret(connection.accessTokenEncrypted) };
}

export function zoomConnectionNeedsMaintenance(connection, now = Date.now()) {
  return connection?.status === "connected"
    && Number.isFinite(new Date(connection.updatedAt).getTime())
    && new Date(connection.updatedAt).getTime() <= now - CONNECTION_REFRESH_AFTER_MS;
}

export async function maintainZoomConnections() {
  if (!zoomConfigured()) return { checked: 0, refreshed: 0, failed: 0 };
  const due = await prisma.agencyZoomConnection.findMany({
    where: {
      status: "connected",
      updatedAt: { lte: new Date(Date.now() - CONNECTION_REFRESH_AFTER_MS) },
    },
    select: { id: true, agencyId: true, updatedAt: true },
    orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
  });
  let refreshed = 0;
  let failed = 0;
  for (const connection of due) {
    try {
      await getZoomClient(connection.agencyId, { forceRefresh: true });
      refreshed += 1;
    } catch (error) {
      failed += 1;
      logger.warn("zoom.connection_maintenance_failed", {
        agencyId: connection.agencyId,
        connectionId: connection.id,
        reason: error.message,
      });
      if (error.code === "ZOOM_RECONNECT_REQUIRED") {
        const recipientIds = await schedulingCoordinatorRecipientIds(connection.agencyId).catch(() => []);
        await notifyUsers({
          agencyId: connection.agencyId,
          recipientIds,
          type: "appointment.zoom_reconnect_required",
          category: "appointments",
          title: "Zoom needs to be reconnected",
          body: "Zoom authorization could not be renewed. New Zoom bookings were disabled. Reconnect Zoom under Settings → Scheduling before accepting more Zoom appointments.",
          severity: "critical",
          entityType: "zoom_connection",
          entityId: connection.id,
          actionUrl: "/app/settings?section=scheduling",
          dedupeKey: `zoom:${connection.id}:reconnect-required`,
          channels: ["in_app"],
        }).catch(() => {});
      }
    }
  }
  return { checked: due.length, refreshed, failed };
}

export function startZoomConnectionMaintenance() {
  if (connectionMaintenanceTimer) return;
  connectionMaintenanceTimer = setInterval(() => {
    void maintainZoomConnections().catch((error) => {
      logger.warn("zoom.connection_maintenance_pass_failed", { reason: error.message });
    });
  }, CONNECTION_MAINTENANCE_INTERVAL_MS);
  void maintainZoomConnections().catch((error) => {
    logger.warn("zoom.connection_maintenance_pass_failed", { reason: error.message });
  });
  if (connectionMaintenanceTimer.unref) connectionMaintenanceTimer.unref();
}

export function stopZoomConnectionMaintenance() {
  if (connectionMaintenanceTimer) clearInterval(connectionMaintenanceTimer);
  connectionMaintenanceTimer = null;
}

export async function zoomRequest(agencyId, { method = "GET", path, body = null, allowNotFound = false } = {}) {
  let client = await getZoomClient(agencyId);
  let result = await directZoomFetch(client.accessToken, path, {
    method,
    body: body == null ? undefined : JSON.stringify(body),
  });
  if (result.response.status === 401) {
    client = await getZoomClient(agencyId, { forceRefresh: true });
    result = await directZoomFetch(client.accessToken, path, {
      method,
      body: body == null ? undefined : JSON.stringify(body),
    });
  }
  if (allowNotFound && result.response.status === 404) return null;
  if (!result.response.ok) {
    const message = result.payload?.message || result.payload?.reason || "Zoom did not accept the request.";
    logger.warn("zoom.request_failed", { agencyId, method, path, status: result.response.status, message });
    throw createHttpError(result.response.status === 401 ? 409 : 502, message, result.response.status === 401 ? "ZOOM_RECONNECT_REQUIRED" : "ZOOM_REQUEST_FAILED");
  }
  return result.payload;
}

export async function listZoomUsers(agencyId) {
  const users = [];
  let nextPageToken = "";
  do {
    const params = new URLSearchParams({ status: "active", page_size: "300" });
    if (nextPageToken) params.set("next_page_token", nextPageToken);
    const payload = await zoomRequest(agencyId, { path: `/users?${params.toString()}` });
    users.push(...(Array.isArray(payload?.users) ? payload.users : []));
    nextPageToken = String(payload?.next_page_token || "");
  } while (nextPageToken && users.length < 3000);
  return users.map((user) => ({
    id: String(user.id),
    email: user.email || "",
    name: user.display_name || [user.first_name, user.last_name].filter(Boolean).join(" ") || user.email || "Zoom user",
    status: user.status || "active",
    licenseType: Number(user.type) === 2 ? "Licensed" : Number(user.type) === 1 ? "Basic" : "Unknown",
  }));
}

export async function activeZoomCommitments(agencyId, db = prisma) {
  const now = new Date();
  const [appointments, paymentHolds, waitlistHolds] = await Promise.all([
    db.appointment.findMany({
      where: { agencyId, status: "Scheduled", meetingMode: "Zoom", endsAt: { gt: now } },
      select: { assignedToId: true },
    }),
    db.bookingPaymentHold.findMany({
      where: {
        agencyId,
        meetingMode: "Zoom",
        OR: [
          { status: "AwaitingPayment", expiresAt: { gt: now } },
          { status: "Confirming" },
        ],
      },
      select: { assignedToId: true },
    }),
    db.bookingSlotHold.findMany({
      where: {
        agencyId,
        claimedAt: null,
        expiresAt: { gt: now },
        waitlistEntry: { meetingMode: "Zoom", status: "Offered" },
      },
      select: { assignedToId: true },
    }),
  ]);
  return {
    futureMeetings: appointments.length,
    activePaymentHolds: paymentHolds.length,
    activeWaitlistOffers: waitlistHolds.length,
    assigneeIds: [...new Set([...appointments, ...paymentHolds, ...waitlistHolds].map((item) => item.assignedToId).filter(Boolean))],
  };
}

function commitmentTotal(commitments) {
  return commitments.futureMeetings + commitments.activePaymentHolds + commitments.activeWaitlistOffers;
}

export async function removeZoomConnectionData(agencyId, { deauthorized = false, refuseActiveCommitments = false } = {}) {
  const connection = await prisma.agencyZoomConnection.findUnique({ where: { agencyId } });
  if (!connection) return false;
  const now = new Date();
  const removal = await prisma.$transaction(async (tx) => {
    // Coordinate disconnect with every appointment-creation path. The
    // controller normally refuses a manual disconnect while future Zoom
    // meetings exist, but this lock also closes the narrow race where a
    // new booking begins between that check and token revocation.
    await lockSchedulingTransaction(tx, agencyId, now);
    const commitments = await activeZoomCommitments(agencyId, tx);
    if (refuseActiveCommitments && commitmentTotal(commitments)) {
      throw createHttpError(
        409,
        `Zoom cannot be disconnected while ${commitments.futureMeetings} future meeting${commitments.futureMeetings === 1 ? "" : "s"}, ${commitments.activePaymentHolds} active checkout${commitments.activePaymentHolds === 1 ? "" : "s"}, or ${commitments.activeWaitlistOffers} waitlist offer${commitments.activeWaitlistOffers === 1 ? "" : "s"} still depend on it.`,
        "ZOOM_COMMITMENTS_ACTIVE",
      );
    }
    const zoomAppointments = await tx.appointment.findMany({
      where: { agencyId, meetingMode: "Zoom" },
      select: { id: true },
    });
    const zoomAppointmentIds = zoomAppointments.map((item) => item.id);
    await tx.bookingSettings.updateMany({ where: { agencyId }, data: { zoomBookingEnabled: false } });
    await tx.appointment.updateMany({
      where: { agencyId, meetingProvider: "Zoom" },
      data: {
        meetingUrl: null,
        meetingProvider: null,
        meetingProviderId: null,
        meetingProviderHostId: null,
        meetingSyncStatus: "NotRequired",
        meetingSyncError: null,
      },
    });
    if (commitments.futureMeetings) {
      await tx.appointment.updateMany({
        where: { agencyId, status: "Scheduled", meetingMode: "Zoom", endsAt: { gt: now } },
        data: {
          meetingSyncStatus: "Failed",
          meetingSyncError: deauthorized
            ? "Zoom was disconnected outside CaseDesk. Reconnect Zoom or change this appointment format."
            : "Zoom was disconnected. Reconnect Zoom or change this appointment format.",
        },
      });
    }
    if (zoomAppointmentIds.length) {
      await tx.leadConsultation.updateMany({
        where: { agencyId, appointmentId: { in: zoomAppointmentIds } },
        data: { meetingUrl: null },
      });
    }
    await tx.appointmentMeetingJob.deleteMany({ where: { agencyId } });
    await tx.zoomHostMapping.deleteMany({ where: { agencyId } });
    await tx.agencyZoomConnection.delete({ where: { id: connection.id } });
    return commitments;
  });
  return { connection, ...removal };
}

export async function revokeZoomConnection(agencyId) {
  const removal = await removeZoomConnectionData(agencyId, { refuseActiveCommitments: true });
  if (!removal) return false;
  try {
    await fetch(REVOKE_URL, {
      method: "POST",
      signal: AbortSignal.timeout(REVOKE_REQUEST_TIMEOUT_MS),
      headers: {
        Authorization: basicAuthHeader(),
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: new URLSearchParams({ token: decryptSecret(removal.connection.accessTokenEncrypted) }).toString(),
    });
  } catch { /* Local removal must still succeed if Zoom is unavailable. */ }
  return true;
}

export function verifyZoomWebhookSignature(rawBody, signature, timestamp) {
  const secret = process.env.ZOOM_WEBHOOK_SECRET_TOKEN;
  if (!secret || !signature || !timestamp) return false;
  const timestampMs = Number(timestamp) * 1000;
  if (!Number.isFinite(timestampMs) || Math.abs(Date.now() - timestampMs) > 5 * 60_000) return false;
  const message = `v0:${timestamp}:${Buffer.isBuffer(rawBody) ? rawBody.toString("utf8") : String(rawBody || "")}`;
  const expected = `v0=${createHmac("sha256", secret).update(message).digest("hex")}`;
  if (expected.length !== String(signature).length) return false;
  return timingSafeEqual(Buffer.from(expected), Buffer.from(String(signature)));
}

export function zoomEndpointValidationResponse(plainToken) {
  const secret = process.env.ZOOM_WEBHOOK_SECRET_TOKEN;
  if (!secret || !plainToken) return null;
  return {
    plainToken,
    encryptedToken: createHmac("sha256", secret).update(String(plainToken)).digest("hex"),
  };
}

export async function createZoomMeeting(agencyId, { hostUserId, appointment, timezone }) {
  const duration = Math.max(1, Math.round((new Date(appointment.endsAt) - new Date(appointment.startsAt)) / 60_000));
  const agencyName = appointment.agency?.legalName || appointment.agency?.name || "CaseDesk";
  return zoomRequest(agencyId, {
    method: "POST",
    path: `/users/${encodeURIComponent(hostUserId)}/meetings`,
    body: {
      topic: `${agencyName} — ${appointment.subject || "Consultation"}`,
      type: 2,
      start_time: new Date(appointment.startsAt).toISOString(),
      duration,
      timezone: timezone || "America/Toronto",
      agenda: `CaseDesk appointment ${appointment.referenceCode || appointment.id}`,
      settings: {
        waiting_room: true,
        join_before_host: false,
        mute_upon_entry: true,
        participant_video: true,
        host_video: true,
        auto_recording: "none",
      },
    },
  });
}

export async function updateZoomMeeting(agencyId, { meetingId, appointment, timezone }) {
  const duration = Math.max(1, Math.round((new Date(appointment.endsAt) - new Date(appointment.startsAt)) / 60_000));
  const agencyName = appointment.agency?.legalName || appointment.agency?.name || "CaseDesk";
  const result = await zoomRequest(agencyId, {
    method: "PATCH",
    path: `/meetings/${encodeURIComponent(meetingId)}`,
    body: {
      topic: `${agencyName} — ${appointment.subject || "Consultation"}`,
      start_time: new Date(appointment.startsAt).toISOString(),
      duration,
      timezone: timezone || "America/Toronto",
    },
    allowNotFound: true,
  });
  return result !== null;
}

export async function deleteZoomMeeting(agencyId, meetingId) {
  await zoomRequest(agencyId, {
    method: "DELETE",
    path: `/meetings/${encodeURIComponent(meetingId)}?schedule_for_reminder=false&cancel_meeting_reminder=false`,
    allowNotFound: true,
  });
}
