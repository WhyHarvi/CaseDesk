import prisma from "../services/prisma/client.js";
import { createHttpError } from "../utils/http.js";
import { logger } from "../services/logger.js";
import { recordActivity } from "../utils/prismaCrud.js";
import { enqueueAppointmentMeetingJob, processAppointmentMeetingJobs } from "../services/appointmentMeetingService.js";
import {
  activeZoomCommitments,
  buildZoomAuthorizeUrl,
  buildZoomOAuthState,
  exchangeZoomAuthorizationCode,
  listZoomUsers,
  parseZoomOAuthState,
  removeZoomConnectionData,
  revokeZoomConnection,
  saveZoomConnection,
  verifyZoomWebhookSignature,
  zoomConfigured,
  zoomEndpointValidationResponse,
} from "../services/zoomService.js";
import { notifyUsers, schedulingCoordinatorRecipientIds } from "../services/notificationService.js";
import { lockSchedulingTransaction } from "../services/schedulingAssignmentService.js";
import { recordAppointmentEvent } from "../services/appointmentOperationsService.js";
import { autoMarkAppointmentAttended } from "../services/appointmentAttendanceService.js";

function frontendBase() {
  return String(process.env.FRONTEND_URL || "http://localhost:5173").split(",")[0].trim().replace(/\/$/, "");
}

function schedulingUrl(result, message = "") {
  const params = new URLSearchParams({ section: "scheduling", zoom: result });
  if (message) params.set("message", message.slice(0, 160));
  return `${frontendBase()}/app/settings?${params.toString()}`;
}

function requireAdmin(req) {
  if (req.auth?.role !== "admin") throw createHttpError(403, "Only workspace administrators can manage Zoom.", "FORBIDDEN");
}

async function autoMapZoomUsers(agencyId) {
  const [zoomUsers, staff] = await Promise.all([
    listZoomUsers(agencyId),
    prisma.user.findMany({
      where: { agencyId, status: "active", role: { in: ["admin", "consultant"] } },
      select: { id: true, email: true },
    }),
  ]);
  const byEmail = new Map(zoomUsers.map((item) => [item.email.toLowerCase(), item]));
  const mappings = staff.map((member) => {
    const host = byEmail.get(member.email.toLowerCase());
    return host ? {
      agencyId,
      userId: member.id,
      zoomUserId: host.id,
      zoomEmail: host.email,
      displayName: host.name,
      licenseType: host.licenseType,
    } : null;
  }).filter(Boolean);
  if (mappings.length) await prisma.zoomHostMapping.createMany({ data: mappings, skipDuplicates: true });
  return mappings.length;
}

export async function getZoomStatus(req, res) {
  requireAdmin(req);
  let [connection, mappings] = await Promise.all([
    prisma.agencyZoomConnection.findUnique({
      where: { agencyId: req.auth.agencyId },
      select: {
        providerAccountId: true,
        accountName: true,
        connectedUserEmail: true,
        status: true,
        lastError: true,
        connectedAt: true,
        updatedAt: true,
      },
    }),
    prisma.zoomHostMapping.findMany({
      where: { agencyId: req.auth.agencyId },
      select: { userId: true, zoomUserId: true, zoomEmail: true, displayName: true, licenseType: true, status: true },
      orderBy: { zoomEmail: "asc" },
    }),
  ]);
  let hosts = [];
  let hostLoadError = null;
  if (connection?.status === "connected") {
    try {
      hosts = await listZoomUsers(req.auth.agencyId);
    } catch (error) {
      hostLoadError = error.message;
      // A permanent refresh-token failure marks the connection as errored
      // inside zoomService. Reflect that new state in this same response
      // instead of rendering a misleading green "Connected" card.
      connection = await prisma.agencyZoomConnection.findUnique({
        where: { agencyId: req.auth.agencyId },
        select: {
          providerAccountId: true,
          accountName: true,
          connectedUserEmail: true,
          status: true,
          lastError: true,
          connectedAt: true,
          updatedAt: true,
        },
      });
      if (connection?.status !== "connected") {
        mappings = [];
      }
    }
  }
  res.json({
    data: {
      configured: zoomConfigured(),
      connected: connection?.status === "connected",
      status: connection?.status || "disconnected",
      accountName: connection?.accountName || null,
      connectedUserEmail: connection?.connectedUserEmail || null,
      connectedAt: connection?.connectedAt || null,
      lastError: connection?.lastError || hostLoadError,
      mappings,
      hosts,
    },
  });
}

export async function startZoomConnect(req, res) {
  requireAdmin(req);
  if (!zoomConfigured()) {
    throw createHttpError(503, "Zoom credentials are not configured on the server yet.", "ZOOM_NOT_CONFIGURED");
  }
  const state = buildZoomOAuthState(req.auth.agencyId, req.auth.userId);
  res.json({ data: { url: buildZoomAuthorizeUrl(state) } });
}

export async function zoomOAuthCallback(req, res) {
  const { code, state, error, reason } = req.query;
  if (error) return res.redirect(schedulingUrl("denied", String(reason || error)));
  const parsed = parseZoomOAuthState(state);
  if (!parsed || !code || !zoomConfigured()) return res.redirect(schedulingUrl("invalid"));
  try {
    const administrator = await prisma.user.findFirst({
      where: {
        id: parsed.userId,
        agencyId: parsed.agencyId,
        status: "active",
        memberships: { some: { agencyId: parsed.agencyId, isActive: true, role: "admin" } },
      },
      select: { id: true },
    });
    if (!administrator) return res.redirect(schedulingUrl("invalid", "Your administrator access is no longer active."));
    const tokens = await exchangeZoomAuthorizationCode(String(code));
    // The scope-mismatch error a failed connect shows in the browser has
    // no server-side trail otherwise (the catch below only redirects) —
    // logging the raw grant here is the only way to tell "app config is
    // missing a scope" apart from "code has the wrong scope string" without
    // guessing. Not sensitive: scope names, not tokens.
    logger.info("zoom.oauth_scope_granted", { agencyId: parsed.agencyId, scope: tokens.scope || null });
    await saveZoomConnection({ agencyId: parsed.agencyId, userId: parsed.userId, tokens });
    const mapped = await autoMapZoomUsers(parsed.agencyId).catch(() => 0);
    await recordActivity({
      agencyId: parsed.agencyId,
      userId: parsed.userId,
      action: "zoom.connected",
      details: `Zoom organization connected${mapped ? `; ${mapped} consultant${mapped === 1 ? "" : "s"} mapped automatically` : ""}`,
    }).catch(() => {});
    return res.redirect(schedulingUrl("connected"));
  } catch (errorValue) {
    logger.warn("zoom.oauth_callback_failed", { agencyId: parsed?.agencyId, code: errorValue.code, reason: errorValue.message });
    return res.redirect(schedulingUrl("error", String(errorValue.message || "Connection failed")));
  }
}

export async function updateZoomMappings(req, res) {
  requireAdmin(req);
  const requested = Array.isArray(req.body?.mappings) ? req.body.mappings : [];
  const userIds = [...new Set(requested.map((item) => String(item.userId || "")).filter(Boolean))];
  const zoomUserIds = [...new Set(requested.map((item) => String(item.zoomUserId || "")).filter(Boolean))];
  if (userIds.length !== requested.length || zoomUserIds.length !== requested.length) {
    throw createHttpError(400, "Each consultant and Zoom host can only be mapped once.", "VALIDATION_ERROR");
  }
  const [staff, hosts, commitments] = await Promise.all([
    prisma.user.findMany({
      where: { agencyId: req.auth.agencyId, id: { in: userIds }, status: "active", role: { in: ["admin", "consultant"] } },
      select: { id: true },
    }),
    listZoomUsers(req.auth.agencyId),
    activeZoomCommitments(req.auth.agencyId),
  ]);
  if (staff.length !== userIds.length) throw createHttpError(400, "A selected consultant is not active scheduling staff.", "VALIDATION_ERROR");
  const hostsById = new Map(hosts.map((host) => [host.id, host]));
  if (zoomUserIds.some((id) => !hostsById.has(id))) throw createHttpError(400, "A selected Zoom host was not found in the connected organization.", "VALIDATION_ERROR");
  const requestedByUser = new Map(requested.map((item) => [String(item.userId), String(item.zoomUserId)]));
  const unmappedActiveConsultant = commitments.assigneeIds.find((userId) => !requestedByUser.has(userId));
  if (unmappedActiveConsultant) {
    throw createHttpError(409, "A consultant with an active/future Zoom appointment, checkout, or waitlist offer cannot be left without a Zoom host. Resolve those commitments first.", "ZOOM_COMMITMENTS_ACTIVE");
  }
  const result = await prisma.$transaction(async (tx) => {
    await lockSchedulingTransaction(tx, req.auth.agencyId, new Date());
    const currentCommitments = await activeZoomCommitments(req.auth.agencyId, tx);
    const newlyUnmappedConsultant = currentCommitments.assigneeIds.find((userId) => !requestedByUser.has(userId));
    if (newlyUnmappedConsultant) {
      throw createHttpError(
        409,
        "A consultant with an active/future Zoom appointment, checkout, or waitlist offer cannot be left without a Zoom host. Resolve those commitments first.",
        "ZOOM_COMMITMENTS_ACTIVE",
      );
    }
    const currentMappings = await tx.zoomHostMapping.findMany({
      where: { agencyId: req.auth.agencyId },
      select: { userId: true, zoomUserId: true },
    });
    const priorByUser = new Map(currentMappings.map((item) => [item.userId, item.zoomUserId]));
    const changedUserIds = requested
      .filter((item) => priorByUser.get(String(item.userId))
        && priorByUser.get(String(item.userId)) !== String(item.zoomUserId))
      .map((item) => String(item.userId));

    await tx.zoomHostMapping.deleteMany({ where: { agencyId: req.auth.agencyId } });
    if (requested.length) {
      await tx.zoomHostMapping.createMany({
        data: requested.map((item) => {
          const host = hostsById.get(String(item.zoomUserId));
          return {
            agencyId: req.auth.agencyId,
            userId: String(item.userId),
            zoomUserId: host.id,
            zoomEmail: host.email,
            displayName: host.name,
            licenseType: host.licenseType,
          };
        }),
      });
    } else {
      await tx.bookingSettings.updateMany({ where: { agencyId: req.auth.agencyId }, data: { zoomBookingEnabled: false } });
    }
    const mappings = await tx.zoomHostMapping.findMany({
      where: { agencyId: req.auth.agencyId },
      select: { userId: true, zoomUserId: true, zoomEmail: true, displayName: true, licenseType: true, status: true },
    });
    let queuedMeetings = 0;
    if (changedUserIds.length) {
      const appointmentIds = (await tx.appointment.findMany({
        where: {
          agencyId: req.auth.agencyId,
          assignedToId: { in: changedUserIds },
          status: "Scheduled",
          meetingMode: "Zoom",
          endsAt: { gt: new Date() },
        },
        select: { id: true },
      })).map((appointment) => appointment.id);
      if (appointmentIds.length) {
        await tx.appointment.updateMany({
          where: { id: { in: appointmentIds } },
          data: { meetingSyncStatus: "Pending", meetingSyncError: "The Zoom host changed and the meeting link is being refreshed." },
        });
        const appointments = await tx.appointment.findMany({ where: { id: { in: appointmentIds } } });
        for (const appointment of appointments) {
          await enqueueAppointmentMeetingJob(tx, {
            appointment,
            action: "SYNC",
            notifyKind: "meeting_updated",
            actorUserId: req.auth.userId,
            dedupeSuffix: `host-remapped-${requestedByUser.get(appointment.assignedToId)}`,
          });
        }
        queuedMeetings = appointments.length;
      }
    }
    return { mappings, queuedMeetings };
  });
  const data = result.mappings;
  await recordActivity({
    agencyId: req.auth.agencyId,
    userId: req.auth.userId,
    action: "zoom.host_mappings_updated",
    details: `${data.length} Zoom host mapping${data.length === 1 ? "" : "s"} configured`,
  }).catch(() => {});
  if (result.queuedMeetings) void processAppointmentMeetingJobs();
  res.json({ data });
}

export async function disconnectZoom(req, res) {
  requireAdmin(req);
  const disconnected = await revokeZoomConnection(req.auth.agencyId);
  if (!disconnected) {
    await prisma.bookingSettings.updateMany({
      where: { agencyId: req.auth.agencyId },
      data: { zoomBookingEnabled: false },
    });
  }
  if (disconnected) {
    await recordActivity({
      agencyId: req.auth.agencyId,
      userId: req.auth.userId,
      action: "zoom.disconnected",
      details: "Zoom organization disconnected; new Zoom bookings disabled",
    }).catch(() => {});
  }
  res.json({ data: { disconnected } });
}

async function handleMeetingDeleted(payload) {
  const accountId = String(payload?.payload?.account_id || "");
  const meetingId = String(payload?.payload?.object?.id || "");
  if (!accountId || !meetingId) return;
  const connection = await prisma.agencyZoomConnection.findUnique({ where: { providerAccountId: accountId } });
  if (!connection) return;
  const appointment = await prisma.appointment.findFirst({
    where: {
      agencyId: connection.agencyId,
      meetingProvider: "Zoom",
      meetingProviderId: meetingId,
      meetingMode: "Zoom",
      status: "Scheduled",
    },
  });
  if (!appointment) return;
  const activeSync = await prisma.appointmentMeetingJob.findFirst({
    where: {
      appointmentId: appointment.id,
      action: "SYNC",
      status: { in: ["pending", "processing"] },
    },
    select: { id: true },
  });
  // A host-remap or reschedule sync can deliberately delete the old Zoom
  // meeting. Its existing job will create/update the replacement; adding a
  // second force-create job here would produce an orphan duplicate meeting.
  if (activeSync) return;
  const updated = await prisma.appointment.update({
    where: { id: appointment.id },
    data: {
      meetingUrl: null,
      meetingProviderId: null,
      meetingSyncStatus: "Pending",
      meetingSyncError: "The Zoom meeting was deleted outside CaseDesk and is being recreated.",
    },
  });
  await enqueueAppointmentMeetingJob(prisma, {
    appointment: updated,
    action: "SYNC",
    notifyKind: "meeting_updated",
    forceCreate: true,
    dedupeSuffix: `zoom-deleted-${payload.event_ts || Date.now()}`,
  });
  await notifyUsers({
    agencyId: connection.agencyId,
    recipientIds: await schedulingCoordinatorRecipientIds(connection.agencyId),
    type: "appointment.zoom_deleted_externally",
    category: "appointments",
    title: "Zoom meeting deleted outside CaseDesk",
    body: `${appointment.subject} · ${appointment.referenceCode || appointment.id}. CaseDesk is recreating the meeting and will send the client an updated link.`,
    severity: "warning",
    entityType: "appointment",
    entityId: appointment.id,
    actionUrl: `/app/calendar?appointment=${encodeURIComponent(appointment.id)}`,
    dedupeKey: `appointment:${appointment.id}:zoom-deleted:${payload.event_ts || meetingId}`,
    channels: ["in_app"],
  }).catch(() => {});
}

async function handleMeetingUpdated(payload) {
  const accountId = String(payload?.payload?.account_id || "");
  const object = payload?.payload?.object || {};
  const meetingId = String(object.id || "");
  if (!accountId || !meetingId) return;
  const connection = await prisma.agencyZoomConnection.findUnique({ where: { providerAccountId: accountId } });
  if (!connection) return;
  const appointment = await prisma.appointment.findFirst({
    where: { agencyId: connection.agencyId, meetingProvider: "Zoom", meetingProviderId: meetingId, meetingMode: "Zoom", status: "Scheduled" },
  });
  if (!appointment) return;
  const expectedDuration = Math.round((new Date(appointment.endsAt) - new Date(appointment.startsAt)) / 60_000);
  const startMatches = !object.start_time || Math.abs(new Date(object.start_time).getTime() - new Date(appointment.startsAt).getTime()) < 1000;
  const durationMatches = !object.duration || Number(object.duration) === expectedDuration;
  if (startMatches && durationMatches) return;
  const updated = await prisma.appointment.update({
    where: { id: appointment.id },
    data: { meetingSyncStatus: "Pending", meetingSyncError: "Zoom meeting details changed outside CaseDesk and are being restored." },
  });
  await enqueueAppointmentMeetingJob(prisma, {
    appointment: updated,
    action: "SYNC",
    dedupeSuffix: `zoom-updated-${payload.event_ts || Date.now()}`,
  });
}

async function handleParticipantJoined(payload) {
  const accountId = String(payload?.payload?.account_id || "");
  const object = payload?.payload?.object || {};
  const meetingId = String(object.id || "");
  const participant = object.participant || {};
  if (!accountId || !meetingId) return;
  const connection = await prisma.agencyZoomConnection.findUnique({ where: { providerAccountId: accountId } });
  if (!connection) return;
  const appointment = await prisma.appointment.findFirst({
    where: { agencyId: connection.agencyId, meetingProvider: "Zoom", meetingProviderId: meetingId, meetingMode: "Zoom", status: "Scheduled" },
    include: { client: { select: { email: true } } },
  });
  if (!appointment) return;

  const participantEmail = String(participant.user_email || participant.email || "").trim().toLowerCase();
  const participantUserId = String(participant.user_id || participant.id || "");
  const guestEmail = String(appointment.guestEmail || appointment.client?.email || "").trim().toLowerCase();
  const role = participantUserId && participantUserId === String(appointment.meetingProviderHostId || "")
    ? "consultant"
    : participantEmail && guestEmail && participantEmail === guestEmail
      ? "client"
      : null;
  if (!role) return;

  const priorJoins = await prisma.appointmentEvent.findMany({
    where: { appointmentId: appointment.id, type: "MEETING_PARTICIPANT_JOINED" },
    orderBy: { createdAt: "desc" },
    take: 20,
  });
  const hasOtherRole = priorJoins.some((event) => event?.metadata?.attendanceRole && event.metadata.attendanceRole !== role);
  await recordAppointmentEvent(prisma, {
    agencyId: appointment.agencyId,
    appointmentId: appointment.id,
    type: "MEETING_PARTICIPANT_JOINED",
    summary: role === "consultant" ? "Consultant joined Zoom" : "Client joined Zoom",
    metadata: { attendanceRole: role, participantId: participantUserId || null },
  });
  if (hasOtherRole) {
    await autoMarkAppointmentAttended({
      agencyId: appointment.agencyId,
      appointmentId: appointment.id,
      source: "Consultant and client joined Zoom",
      requireAssignedActor: false,
      allowBeforeStartMinutes: 15,
      metadata: { meetingProvider: "Zoom", meetingId },
    });
  }
}

async function handleDeauthorization(payload) {
  const accountId = String(payload?.payload?.account_id || "");
  if (!accountId) return;
  const connection = await prisma.agencyZoomConnection.findUnique({ where: { providerAccountId: accountId } });
  if (!connection) return;
  const removal = await removeZoomConnectionData(connection.agencyId, { deauthorized: true });
  await notifyUsers({
    agencyId: connection.agencyId,
    recipientIds: await schedulingCoordinatorRecipientIds(connection.agencyId),
    type: "appointment.zoom_deauthorized",
    category: "appointments",
    title: "Zoom disconnected outside CaseDesk",
    body: `New Zoom bookings were disabled. ${removal?.futureMeetings || 0} active/future appointment${removal?.futureMeetings === 1 ? "" : "s"}, ${removal?.activePaymentHolds || 0} checkout${removal?.activePaymentHolds === 1 ? "" : "s"}, and ${removal?.activeWaitlistOffers || 0} waitlist offer${removal?.activeWaitlistOffers === 1 ? "" : "s"} require reconnection, a format change, or staff follow-up.`,
    severity: "critical",
    entityType: "zoom_connection",
    entityId: connection.id,
    actionUrl: "/app/settings?section=scheduling",
    dedupeKey: `zoom:${connection.id}:deauthorized`,
    channels: ["in_app"],
  }).catch(() => {});
}

export async function zoomWebhook(req, res) {
  const event = req.body || {};
  if (!verifyZoomWebhookSignature(req.rawBody, req.get("x-zm-signature"), req.get("x-zm-request-timestamp"))) {
    throw createHttpError(401, "Invalid Zoom webhook signature.", "INVALID_SIGNATURE");
  }
  if (event.event === "endpoint.url_validation") {
    const response = zoomEndpointValidationResponse(event.payload?.plainToken);
    if (!response) throw createHttpError(503, "Zoom webhook verification is not configured.", "ZOOM_WEBHOOK_NOT_CONFIGURED");
    return res.json(response);
  }
  if (event.event === "meeting.deleted") await handleMeetingDeleted(event);
  else if (event.event === "meeting.updated") await handleMeetingUpdated(event);
  else if (event.event === "meeting.participant_joined") await handleParticipantJoined(event);
  else if (event.event === "app_deauthorized") await handleDeauthorization(event);
  res.status(204).send();
}
