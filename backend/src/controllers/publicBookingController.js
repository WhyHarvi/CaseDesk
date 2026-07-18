import { randomUUID } from "node:crypto";
import prisma from "../services/prisma/client.js";
import { createHttpError } from "../utils/http.js";
import { recordActivity } from "../utils/prismaCrud.js";
import { assertSlotAvailable, availabilityForRange, localDateKey } from "../services/bookingAvailabilityService.js";
import { sendBookingMessages } from "../services/bookingNotificationService.js";

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function meetingLink() {
  return `https://meet.jit.si/CaseDesk-${randomUUID().replace(/-/g, "").slice(0, 14)}`;
}

async function resolveAgencyByToken(token) {
  const settings = await prisma.bookingSettings.findUnique({
    where: { publicToken: String(token || "") },
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
  const sessionTypes = await prisma.bookingSessionType.findMany({
    where: { agencyId: settings.agencyId, isActive: true },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    select: { id: true, name: true, durationMinutes: true, description: true },
  });
  res.json({
    data: {
      agencyName,
      agency: settings.agency,
      timezone: settings.timezone,
      horizonDays: settings.horizonDays,
      sessionTypes,
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
  const { days } = await availabilityForRange({
    agencyId: settings.agencyId,
    assignedToId: null,
    durationMinutes: sessionType.durationMinutes,
    fromKey: from,
    toKey: to,
  });
  res.json({ data: { days, timezone: settings.timezone } });
}

export async function createPublicBooking(req, res) {
  const settings = await resolveAgencyByToken(req.params.token);
  const body = req.body || {};

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
  const locations = Array.isArray(settings.locations) ? settings.locations : [];
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
  const { days } = await availabilityForRange({
    agencyId: settings.agencyId,
    assignedToId: null,
    durationMinutes: sessionType.durationMinutes,
    fromKey: dayKey,
    toKey: dayKey,
  });
  const offered = (days[dayKey] || []).some((slot) => slot.startsAt === startsAt.toISOString());
  if (!offered) throw createHttpError(409, "That time is no longer available. Pick another slot.", "SLOT_TAKEN");

  const existingClient = await prisma.client.findFirst({
    where: { agencyId: settings.agencyId, email: { equals: email, mode: "insensitive" } },
    select: { id: true },
  });

  const appointment = await prisma.$transaction(async (tx) => {
    const conflict = await assertSlotAvailable(tx, {
      agencyId: settings.agencyId,
      assignedToId: null,
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
        guestPhone: phone || null,
        meetingMode: online ? "Online" : "InPerson",
        meetingUrl: online ? meetingLink() : null,
        status: "Scheduled",
      },
      include: { client: { select: { fullName: true, email: true, phone: true } } },
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
  sendBookingMessages({ agencyId: settings.agencyId, appointment, kind: "booked" }).catch(() => {});

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
      sessionType: { select: { id: true, name: true, durationMinutes: true } },
      agency: { select: { id: true, name: true, legalName: true } },
    },
  });
  if (!appointment) throw createHttpError(404, "This appointment link is not valid.", "NOT_FOUND");
  return appointment;
}

function publicView(appointment, settings) {
  const locations = Array.isArray(settings?.locations) ? settings.locations : [];
  const locationId = locations.find((item) => `${item.name} — ${item.address}` === appointment.location)?.id || null;
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
    agencyName: appointment.agency.legalName || appointment.agency.name,
    timezone: settings?.timezone || "America/Toronto",
    name: appointment.guestName || appointment.client?.fullName || null,
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
  });
  res.json({ data: { days, timezone: settings.timezone } });
}

export async function cancelManagedBooking(req, res) {
  const appointment = await resolveManaged(req.params.manageToken);
  if (appointment.status !== "Scheduled") throw createHttpError(409, "This appointment is no longer active.", "ALREADY_DONE");
  if (new Date(appointment.startsAt) <= new Date()) throw createHttpError(409, "Past appointments cannot be cancelled.", "TOO_LATE");
  const updated = await prisma.appointment.update({
    where: { id: appointment.id },
    data: { status: "Cancelled" },
    include: { client: { select: { fullName: true, email: true, phone: true } }, sessionType: true, agency: { select: { name: true } } },
  });
  await recordActivity({
    agencyId: appointment.agencyId,
    userId: null,
    clientId: appointment.clientId,
    caseId: appointment.caseId,
    action: "appointment.cancelled",
    details: `${appointment.subject} cancelled via booking link`,
  }).catch(() => {});
  sendBookingMessages({ agencyId: appointment.agencyId, appointment: updated, kind: "cancelled" }).catch(() => {});
  const settings = await prisma.bookingSettings.findUnique({ where: { agencyId: appointment.agencyId } });
  res.json({ data: publicView(updated, settings) });
}

export async function rescheduleManagedBooking(req, res) {
  const appointment = await resolveManaged(req.params.manageToken);
  if (appointment.status !== "Scheduled") throw createHttpError(409, "This appointment is no longer active.", "ALREADY_DONE");
  const settings = await prisma.bookingSettings.findUnique({ where: { agencyId: appointment.agencyId } });
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
  const locations = Array.isArray(settings?.locations) ? settings.locations : [];
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
  });
  const offered = (days[dayKey] || []).some((slot) => slot.startsAt === startsAt.toISOString());
  if (!offered) throw createHttpError(409, "That time is not available. Pick another slot.", "SLOT_TAKEN");

  const updated = await prisma.$transaction(async (tx) => {
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
      },
      include: { client: { select: { fullName: true, email: true, phone: true } }, sessionType: true, agency: { select: { name: true, legalName: true } } },
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
  sendBookingMessages({ agencyId: appointment.agencyId, appointment: updated, kind: "rescheduled" }).catch(() => {});
  res.json({ data: publicView(updated, settings) });
}
