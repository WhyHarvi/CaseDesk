import { randomUUID } from "node:crypto";
import prisma from "../services/prisma/client.js";
import { createHttpError } from "../utils/http.js";
import { recordActivity } from "../utils/prismaCrud.js";
import { assertSlotAvailable, availabilityForRange, localDateKey } from "../services/bookingAvailabilityService.js";
import { sendBookingMessages } from "../services/bookingNotificationService.js";
import { invalidateDashboardCache } from "../services/dashboardCache.js";
import {
  chooseAppointmentAssignee,
  eligibleSchedulingStaff,
  lockSchedulingTransaction,
} from "../services/schedulingAssignmentService.js";

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function meetingLink() {
  return `https://meet.jit.si/CaseDesk-${randomUUID().replace(/-/g, "").slice(0, 14)}`;
}

async function resolveAgencyByToken(token) {
  const value = String(token || "").trim().toLowerCase();
  const settings = await prisma.bookingSettings.findFirst({
    where: { OR: [{ publicToken: value }, { publicSlug: value }] },
    include: {
      agency: {
        select: {
          id: true,
          name: true,
          legalName: true,
          logoUrl: true,
          phone: true,
          email: true,
          website: true,
          address: true,
          city: true,
          province: true,
          postalCode: true,
          country: true,
        },
      },
    },
  });
  if (!settings || !settings.publicBookingEnabled) {
    throw createHttpError(404, "This booking page is not available.", "NOT_FOUND");
  }
  return settings;
}

export async function getPublicBookingInfo(req, res) {
  const settings = await resolveAgencyByToken(req.params.token);
  const agencyName = settings.agency.legalName || settings.agency.name;
  const [sessionTypes, consultants] = await Promise.all([prisma.bookingSessionType.findMany({
    where: { agencyId: settings.agencyId, isActive: true },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    select: { id: true, name: true, durationMinutes: true, description: true, allowedMeetingModes: true, allowedLocationIds: true, eligibleStaff: { select: { userId: true } } },
  }), eligibleSchedulingStaff({ agencyId: settings.agencyId, publicOnly: true })]);
  res.json({
    data: {
      agencyName,
      agency: settings.agency,
      timezone: settings.timezone,
      horizonDays: settings.horizonDays,
      sessionTypes,
      consultants: consultants.map(({ id, fullName }) => ({ id, name: fullName })),
      locations: Array.isArray(settings.locations) ? settings.locations : [],
    },
  });
}

export async function getPublicAvailability(req, res) {
  const settings = await resolveAgencyByToken(req.params.token);
  const from = String(req.query.from || "");
  const to = String(req.query.to || "");
  if (!DATE_PATTERN.test(from) || !DATE_PATTERN.test(to)) {
    throw createHttpError(400, "from/to must be YYYY-MM-DD dates.", "VALIDATION_ERROR");
  }
  const sessionType = await prisma.bookingSessionType.findFirst({
    where: { id: String(req.query.sessionTypeId || ""), agencyId: settings.agencyId, isActive: true },
  });
  if (!sessionType) throw createHttpError(400, "Choose a session type.", "VALIDATION_ERROR");
  const requestedConsultantId = String(req.query.consultantId || "") || null;
  const staff = await eligibleSchedulingStaff({
    agencyId: settings.agencyId,
    sessionTypeId: sessionType.id,
    publicOnly: true,
    requestedUserId: requestedConsultantId,
  });
  if (requestedConsultantId && !staff.length) throw createHttpError(400, "The selected consultant is not bookable.", "INVALID_ASSIGNEE");
  const { days } = await availabilityForRange({
    agencyId: settings.agencyId,
    assignedToIds: staff.map((item) => item.id),
    durationMinutes: sessionType.durationMinutes,
    fromKey: from,
    toKey: to,
  });
  const publicDays = Object.fromEntries(Object.entries(days).map(([key, slots]) => [key, slots.map(({ staffIds, ...slot }) => slot)]));
  res.json({ data: { days: publicDays, timezone: settings.timezone } });
}

export async function createPublicBooking(req, res) {
  const settings = await resolveAgencyByToken(req.params.token);
  const body = req.body || {};
  if (String(body.website || "").trim()) throw createHttpError(400, "The booking could not be completed.", "VALIDATION_ERROR");

  const sessionType = await prisma.bookingSessionType.findFirst({
    where: { id: String(body.sessionTypeId || ""), agencyId: settings.agencyId, isActive: true },
  });
  if (!sessionType) throw createHttpError(400, "Choose a session type.", "VALIDATION_ERROR");

  const startsAt = new Date(String(body.startsAt || ""));
  if (Number.isNaN(startsAt.getTime())) throw createHttpError(400, "Pick a time.", "VALIDATION_ERROR");
  const endsAt = new Date(startsAt.getTime() + sessionType.durationMinutes * 60_000);

  const name = String(body.name || "").trim().slice(0, 160);
  const email = String(body.email || "").trim().toLowerCase().slice(0, 254);
  const phone = String(body.phone || "").trim().slice(0, 40);
  const notes = String(body.notes || "").trim().slice(0, 1000);
  const online = body.meetingMode === "Online";
  if (!sessionType.allowedMeetingModes.includes(online ? "Online" : "InPerson")) {
    throw createHttpError(400, "That appointment format is not available for this session.", "VALIDATION_ERROR");
  }
  const allLocations = Array.isArray(settings.locations) ? settings.locations : [];
  const locations = sessionType.allowedLocationIds.length ? allLocations.filter((item) => sessionType.allowedLocationIds.includes(item.id)) : allLocations;
  let location = null;
  if (!online && locations.length) {
    location = locations.find((item) => item.id === String(body.locationId || "")) || (locations.length === 1 ? locations[0] : null);
    if (!location) throw createHttpError(400, "Choose an office location.", "VALIDATION_ERROR");
  }
  if (!name) throw createHttpError(400, "Your name is required.", "VALIDATION_ERROR");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw createHttpError(400, "A valid email is required.", "VALIDATION_ERROR");

  // Re-validate that the requested slot really is offered (working hours,
  // days off, notice, horizon) — never trust the widget.
  const dayKey = localDateKey(startsAt, settings.timezone);
  const requestedConsultantId = String(body.consultantId || "") || null;
  const staff = await eligibleSchedulingStaff({ agencyId: settings.agencyId, sessionTypeId: sessionType.id, publicOnly: true, requestedUserId: requestedConsultantId });
  const { days } = await availabilityForRange({
    agencyId: settings.agencyId,
    assignedToIds: staff.map((item) => item.id),
    durationMinutes: sessionType.durationMinutes,
    fromKey: dayKey,
    toKey: dayKey,
  });
  const offered = (days[dayKey] || []).some((slot) => slot.startsAt === startsAt.toISOString());
  if (!offered) throw createHttpError(409, "That time is no longer available. Pick another slot.", "SLOT_TAKEN");

  const existingClient = await prisma.client.findFirst({
    where: { agencyId: settings.agencyId, email: { equals: email, mode: "insensitive" } },
    select: { id: true, assignedUserId: true },
  });
  const priorFreeCount = settings.freeConsultationsEnabled ? await prisma.appointment.count({
    where: {
      agencyId: settings.agencyId,
      isFreeConsultation: true,
      status: { not: "Cancelled" },
      OR: [
        ...(existingClient ? [{ clientId: existingClient.id }] : []),
        { guestEmailNormalized: email },
      ],
    },
  }) : 0;
  if (settings.freeConsultationsEnabled && priorFreeCount >= settings.freeConsultationsPerContact) {
    throw createHttpError(409, "The free consultation limit for this email has been reached. Please contact the office.", "FREE_LIMIT_REACHED");
  }

  const idempotencyKey = String(req.get("Idempotency-Key") || body.idempotencyKey || "").trim().slice(0, 160) || null;
  if (idempotencyKey) {
    const prior = await prisma.appointment.findUnique({
      where: { agencyId_idempotencyKey: { agencyId: settings.agencyId, idempotencyKey } },
      include: { client: { select: { fullName: true, email: true, phone: true } } },
    });
    if (prior) return res.status(200).json({ data: { ...publicView(prior, settings), manageToken: prior.manageToken } });
  }

  const appointment = await prisma.$transaction(async (tx) => {
    await lockSchedulingTransaction(tx, settings.agencyId, startsAt);
    const assignee = await chooseAppointmentAssignee({
      agencyId: settings.agencyId,
      sessionTypeId: sessionType.id,
      startsAt,
      endsAt,
      requestedUserId: requestedConsultantId,
      preferredUserId: existingClient?.assignedUserId,
      publicOnly: true,
      bufferMinutes: settings.bufferMinutes,
      timezone: settings.timezone,
      db: tx,
    });
    const conflict = await assertSlotAvailable(tx, {
      agencyId: settings.agencyId,
      assignedToId: assignee.id,
      startsAt,
      endsAt,
      bufferMinutes: settings.bufferMinutes,
    });
    if (conflict) throw createHttpError(409, "That time was just taken. Pick another slot.", "SLOT_TAKEN");
    return tx.appointment.create({
      data: {
        agencyId: settings.agencyId,
        clientId: existingClient?.id || null,
        sessionTypeId: sessionType.id,
        subject: sessionType.name,
        location: location ? `${location.name} — ${location.address}` : null,
        locationMapsUrl: location?.mapsUrl || null,
        calendar: "Workspace Calendar",
        startsAt,
        endsAt,
        description: notes || null,
        guestName: name,
        guestEmail: email,
        guestEmailNormalized: email,
        guestPhone: phone || null,
        meetingMode: online ? "Online" : "InPerson",
        meetingUrl: online ? meetingLink() : null,
        assignedToId: assignee.id,
        source: "Public",
        isFreeConsultation: settings.freeConsultationsEnabled,
        idempotencyKey,
        reminderDueAt: new Date(startsAt.getTime() - settings.reminderMinutes * 60_000),
        status: "Scheduled",
      },
      include: { client: { select: { fullName: true, email: true, phone: true } }, assignedTo: { select: { id: true, fullName: true } } },
    });
  });

  await recordActivity({
    agencyId: settings.agencyId,
    userId: null,
    clientId: appointment.clientId,
    caseId: null,
    action: "appointment.booked",
    details: `${sessionType.name} booked online by ${name} for ${localDateKey(startsAt, settings.timezone)}`,
  }).catch(() => {});
  await sendBookingMessages({ agencyId: settings.agencyId, appointment, kind: "booked" }).catch(() => {});
  invalidateDashboardCache(settings.agencyId);

  res.status(201).json({
    data: {
      manageToken: appointment.manageToken,
      subject: appointment.subject,
      startsAt: appointment.startsAt,
      endsAt: appointment.endsAt,
      meetingMode: appointment.meetingMode,
      meetingUrl: appointment.meetingUrl,
      location: appointment.location,
      locationMapsUrl: appointment.locationMapsUrl,
      timezone: settings.timezone,
      agencyName: settings.agency.legalName || settings.agency.name,
    },
  });
}

async function resolveManaged(token) {
  const appointment = await prisma.appointment.findUnique({
    where: { manageToken: String(token || "") },
    include: {
      client: { select: { fullName: true, email: true, phone: true } },
      sessionType: { select: { id: true, name: true, durationMinutes: true, allowedMeetingModes: true, allowedLocationIds: true } },
      agency: { select: { id: true, name: true, legalName: true } },
    },
  });
  if (!appointment) throw createHttpError(404, "This appointment link is not valid.", "NOT_FOUND");
  return appointment;
}

function publicView(appointment, settings) {
  const allLocations = Array.isArray(settings?.locations) ? settings.locations : [];
  const locations = appointment.sessionType?.allowedLocationIds?.length
    ? allLocations.filter((item) => appointment.sessionType.allowedLocationIds.includes(item.id))
    : allLocations;
  const locationId = locations.find((item) => `${item.name} — ${item.address}` === appointment.location)?.id || null;
  const timeUntilStart = new Date(appointment.startsAt).getTime() - Date.now();
  return {
    subject: appointment.subject,
    status: appointment.status,
    startsAt: appointment.startsAt,
    endsAt: appointment.endsAt,
    meetingMode: appointment.meetingMode,
    meetingUrl: appointment.status === "Scheduled" ? appointment.meetingUrl : null,
    location: appointment.location,
    locationMapsUrl: appointment.locationMapsUrl,
    locationId,
    locations,
    sessionType: appointment.sessionType,
    allowedMeetingModes: appointment.sessionType?.allowedMeetingModes || ["InPerson", "Online"],
    agencyName: appointment.agency.legalName || appointment.agency.name,
    timezone: settings?.timezone || "America/Toronto",
    name: appointment.guestName || appointment.client?.fullName || null,
    canCancel: appointment.status === "Scheduled" && timeUntilStart >= (settings?.cancellationCutoffMinutes || 0) * 60_000,
    canReschedule: appointment.status === "Scheduled" && timeUntilStart >= (settings?.rescheduleCutoffMinutes || 0) * 60_000,
  };
}

export async function getManagedBooking(req, res) {
  const appointment = await resolveManaged(req.params.manageToken);
  const settings = await prisma.bookingSettings.findUnique({ where: { agencyId: appointment.agencyId } });
  res.json({ data: publicView(appointment, settings) });
}

export async function getManagedAvailability(req, res) {
  const appointment = await resolveManaged(req.params.manageToken);
  const from = String(req.query.from || "");
  const to = String(req.query.to || "");
  if (!DATE_PATTERN.test(from) || !DATE_PATTERN.test(to)) {
    throw createHttpError(400, "from/to must be YYYY-MM-DD dates.", "VALIDATION_ERROR");
  }
  const duration = appointment.sessionType?.durationMinutes
    || Math.round((new Date(appointment.endsAt) - new Date(appointment.startsAt)) / 60_000);
  const { days, settings } = await availabilityForRange({
    agencyId: appointment.agencyId,
    assignedToId: appointment.assignedToId,
    durationMinutes: duration,
    fromKey: from,
    toKey: to,
    excludeAppointmentId: appointment.id,
  });
  res.json({ data: { days, timezone: settings.timezone } });
}

export async function cancelManagedBooking(req, res) {
  const appointment = await resolveManaged(req.params.manageToken);
  if (appointment.status !== "Scheduled") throw createHttpError(409, "This appointment is no longer active.", "ALREADY_DONE");
  const settings = await prisma.bookingSettings.findUnique({ where: { agencyId: appointment.agencyId } });
  const cutoff = (settings?.cancellationCutoffMinutes || 0) * 60_000;
  if (new Date(appointment.startsAt).getTime() - Date.now() < cutoff) throw createHttpError(409, "This appointment is inside the cancellation cutoff.", "TOO_LATE");
  const updated = await prisma.appointment.update({
    where: { id: appointment.id },
    data: { status: "Cancelled", cancelledAt: new Date(), cancellationReason: String(req.body?.reason || "Cancelled by guest").trim().slice(0, 500) },
    include: { client: { select: { fullName: true, email: true, phone: true } }, assignedTo: { select: { id: true, fullName: true } }, sessionType: true, agency: { select: { name: true } } },
  });
  await recordActivity({
    agencyId: appointment.agencyId,
    userId: null,
    clientId: appointment.clientId,
    caseId: appointment.caseId,
    action: "appointment.cancelled",
    details: `${appointment.subject} cancelled via booking link`,
  }).catch(() => {});
  await sendBookingMessages({ agencyId: appointment.agencyId, appointment: updated, kind: "cancelled" }).catch(() => {});
  invalidateDashboardCache(appointment.agencyId);
  res.json({ data: publicView(updated, settings) });
}

export async function rescheduleManagedBooking(req, res) {
  const appointment = await resolveManaged(req.params.manageToken);
  if (appointment.status !== "Scheduled") throw createHttpError(409, "This appointment is no longer active.", "ALREADY_DONE");
  const settings = await prisma.bookingSettings.findUnique({ where: { agencyId: appointment.agencyId } });
  if (new Date(appointment.startsAt).getTime() - Date.now() < (settings?.rescheduleCutoffMinutes || 0) * 60_000) {
    throw createHttpError(409, "This appointment is inside the rescheduling cutoff.", "TOO_LATE");
  }
  const startsAt = new Date(String(req.body?.startsAt || ""));
  if (Number.isNaN(startsAt.getTime())) throw createHttpError(400, "Pick a new time.", "VALIDATION_ERROR");
  const duration = appointment.sessionType?.durationMinutes
    || Math.round((new Date(appointment.endsAt) - new Date(appointment.startsAt)) / 60_000);
  const endsAt = new Date(startsAt.getTime() + duration * 60_000);
  const meetingMode = req.body?.meetingMode === "Online"
    ? "Online"
    : req.body?.meetingMode === "InPerson"
      ? "InPerson"
      : appointment.meetingMode;
  if (appointment.sessionType?.allowedMeetingModes?.length && !appointment.sessionType.allowedMeetingModes.includes(meetingMode)) {
    throw createHttpError(400, "That appointment format is unavailable for this session.", "VALIDATION_ERROR");
  }
  const allLocations = Array.isArray(settings?.locations) ? settings.locations : [];
  const locations = appointment.sessionType?.allowedLocationIds?.length
    ? allLocations.filter((item) => appointment.sessionType.allowedLocationIds.includes(item.id))
    : allLocations;
  let selectedLocation = null;
  if (meetingMode === "InPerson") {
    selectedLocation = locations.find((item) => item.id === String(req.body?.locationId || ""))
      || (locations.length === 1 ? locations[0] : null);
    const retainingLegacyLocation = appointment.meetingMode === "InPerson" && !locations.length && appointment.location;
    if (!selectedLocation && !retainingLegacyLocation) {
      throw createHttpError(400, "Choose an office location.", "VALIDATION_ERROR");
    }
  }

  const dayKey = localDateKey(startsAt, settings?.timezone || "America/Toronto");
  const { days } = await availabilityForRange({
    agencyId: appointment.agencyId,
    assignedToId: appointment.assignedToId,
    durationMinutes: duration,
    fromKey: dayKey,
    toKey: dayKey,
    excludeAppointmentId: appointment.id,
  });
  const offered = (days[dayKey] || []).some((slot) => slot.startsAt === startsAt.toISOString());
  if (!offered) throw createHttpError(409, "That time is not available. Pick another slot.", "SLOT_TAKEN");

  const updated = await prisma.$transaction(async (tx) => {
    await lockSchedulingTransaction(tx, appointment.agencyId, startsAt);
    const conflict = await assertSlotAvailable(tx, {
      agencyId: appointment.agencyId,
      assignedToId: appointment.assignedToId,
      startsAt,
      endsAt,
      bufferMinutes: settings?.bufferMinutes || 0,
      excludeAppointmentId: appointment.id,
    });
    if (conflict) throw createHttpError(409, "That time was just taken. Pick another slot.", "SLOT_TAKEN");
    return tx.appointment.update({
      where: { id: appointment.id },
      data: {
        startsAt,
        endsAt,
        meetingMode,
        meetingUrl: meetingMode === "Online" ? appointment.meetingUrl || meetingLink() : null,
        location: meetingMode === "InPerson"
          ? selectedLocation ? `${selectedLocation.name} — ${selectedLocation.address}` : appointment.location
          : null,
        locationMapsUrl: meetingMode === "InPerson"
          ? selectedLocation?.mapsUrl || (selectedLocation ? null : appointment.locationMapsUrl)
          : null,
        reminderSentAt: null,
        reminderDueAt: new Date(startsAt.getTime() - (settings?.reminderMinutes || 1440) * 60_000),
        reminderQueuedAt: null,
      },
      include: { client: { select: { fullName: true, email: true, phone: true } }, assignedTo: { select: { id: true, fullName: true } }, sessionType: true, agency: { select: { name: true, legalName: true } } },
    });
  });

  await recordActivity({
    agencyId: appointment.agencyId,
    userId: null,
    clientId: appointment.clientId,
    caseId: appointment.caseId,
    action: "appointment.rescheduled",
    details: `${appointment.subject} rescheduled via booking link`,
  }).catch(() => {});
  await sendBookingMessages({ agencyId: appointment.agencyId, appointment: updated, kind: "rescheduled" }).catch(() => {});
  invalidateDashboardCache(appointment.agencyId);
  res.json({ data: publicView(updated, settings) });
}
