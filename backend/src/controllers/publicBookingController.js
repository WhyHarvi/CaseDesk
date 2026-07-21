import { createHash, randomInt, randomUUID, timingSafeEqual } from "node:crypto";
import prisma from "../services/prisma/client.js";
import { createHttpError } from "../utils/http.js";
import { recordActivity } from "../utils/prismaCrud.js";
import { assertSlotAvailable, availabilityForRange, localDateKey } from "../services/bookingAvailabilityService.js";
import { sendBookingMessages, sendBookingStaffNotification } from "../services/bookingNotificationService.js";
import { invalidateDashboardCache } from "../services/dashboardCache.js";
import {
  chooseAppointmentAssignee,
  eligibleSchedulingStaff,
  lockSchedulingTransaction,
} from "../services/schedulingAssignmentService.js";
import { appointmentReference, recordAppointmentEvent } from "../services/appointmentOperationsService.js";
import { offerWaitlistOpening, releaseExpiredWaitlistHolds } from "../services/bookingWaitlistService.js";
import { createMailTransport, resolveAgencyMailConfig } from "../services/agencyMailService.js";
import { notifyUsers, schedulingCoordinatorRecipientIds } from "../services/notificationService.js";
import { createPaymentHoldForPublicBooking, getPaymentHoldStatus } from "../services/bookingPaymentHoldService.js";

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function meetingLink() {
  return `https://meet.jit.si/CaseDesk-${randomUUID().replace(/-/g, "").slice(0, 14)}`;
}

function verificationHash(agencyId, email, code) {
  return createHash("sha256").update(`${agencyId}:${email}:${code}:${process.env.BOOKING_VERIFICATION_SECRET || process.env.DATABASE_URL || "casedesk"}`).digest("hex");
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
    select: { id: true, name: true, durationMinutes: true, description: true, allowedMeetingModes: true, allowedLocationIds: true, bufferMinutes: true, preparationInstructions: true, preparationChecklist: true, parkingInstructions: true, eligibleStaff: { select: { userId: true } } },
  }), eligibleSchedulingStaff({ agencyId: settings.agencyId, publicOnly: true })]);
  const offerToken = String(req.query.offer || "");
  const hold = offerToken ? await prisma.bookingSlotHold.findFirst({ where: { agencyId: settings.agencyId, claimToken: offerToken, claimedAt: null, expiresAt: { gt: new Date() } }, include: { waitlistEntry: true } }) : null;
  res.json({
    data: {
      agencyName,
      agency: settings.agency,
      timezone: settings.timezone,
      horizonDays: settings.horizonDays,
      sessionTypes,
      consultants: consultants.map(({ id, fullName, jobTitle, consultantProfiles }) => ({ id, name: fullName, title: jobTitle || "Immigration consultant", specializations: consultantProfiles?.[0]?.specializations || [], masteryLevel: consultantProfiles?.[0]?.masteryLevel || null })),
      locations: Array.isArray(settings.locations) ? settings.locations : [],
      waitlistEnabled: settings.waitlistEnabled,
      attendanceConfirmationEnabled: settings.attendanceConfirmationEnabled,
      consultFeeEnabled: settings.consultFeeEnabled,
      consultFeeAmount: settings.consultFeeAmount,
      offer: hold ? { token: hold.claimToken, startsAt: hold.startsAt, endsAt: hold.endsAt, expiresAt: hold.expiresAt, sessionTypeId: hold.sessionTypeId, consultantId: hold.assignedToId, name: hold.waitlistEntry.name, email: hold.waitlistEntry.email, phone: hold.waitlistEntry.phone, meetingMode: hold.waitlistEntry.meetingMode, locationId: hold.waitlistEntry.locationId } : null,
      offerExpired: Boolean(offerToken && !hold),
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
  const offerToken = String(req.query.offerToken || "") || null;
  const offerHold = offerToken ? await prisma.bookingSlotHold.findFirst({ where: { agencyId: settings.agencyId, claimToken: offerToken, claimedAt: null, expiresAt: { gt: new Date() } } }) : null;
  if (offerToken && !offerHold) throw createHttpError(410, "This reserved waitlist time has expired.", "OFFER_EXPIRED");
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
    sessionBufferMinutes: sessionType.bufferMinutes,
    fromKey: from,
    toKey: to,
    excludeHoldToken: offerHold?.claimToken || null,
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

  const offerToken = String(body.offerToken || "") || null;
  const offerHold = offerToken ? await prisma.bookingSlotHold.findFirst({ where: { agencyId: settings.agencyId, claimToken: offerToken, claimedAt: null, expiresAt: { gt: new Date() } }, include: { waitlistEntry: true } }) : null;
  if (offerToken && !offerHold) throw createHttpError(410, "This reserved waitlist time has expired.", "OFFER_EXPIRED");
  if (offerHold && offerHold.sessionTypeId !== sessionType.id) throw createHttpError(400, "This waitlist offer is for a different session type.", "INVALID_OFFER");

  const startsAt = new Date(String(body.startsAt || ""));
  if (Number.isNaN(startsAt.getTime())) throw createHttpError(400, "Pick a time.", "VALIDATION_ERROR");
  const endsAt = new Date(startsAt.getTime() + sessionType.durationMinutes * 60_000);
  if (offerHold && startsAt.getTime() !== new Date(offerHold.startsAt).getTime()) throw createHttpError(400, "Choose the time reserved by your waitlist offer.", "INVALID_OFFER");

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
  if (offerHold && email !== offerHold.waitlistEntry.emailNormalized) throw createHttpError(400, "Use the email address that joined the waitlist.", "INVALID_OFFER");

  // Re-validate that the requested slot really is offered (working hours,
  // days off, notice, horizon) — never trust the widget.
  const dayKey = localDateKey(startsAt, settings.timezone);
  const requestedConsultantId = offerHold?.assignedToId || String(body.consultantId || "") || null;
  const staff = await eligibleSchedulingStaff({ agencyId: settings.agencyId, sessionTypeId: sessionType.id, publicOnly: true, requestedUserId: requestedConsultantId });
  const { days } = await availabilityForRange({
    agencyId: settings.agencyId,
    assignedToIds: staff.map((item) => item.id),
    durationMinutes: sessionType.durationMinutes,
    sessionBufferMinutes: sessionType.bufferMinutes,
    fromKey: dayKey,
    toKey: dayKey,
    excludeHoldToken: offerHold?.claimToken || null,
  });
  const offered = (days[dayKey] || []).some((slot) => slot.startsAt === startsAt.toISOString());
  if (!offered) throw createHttpError(409, "That time is no longer available. Pick another slot.", "SLOT_TAKEN");

  const verification = body.verificationToken ? await prisma.bookingVerificationCode.findFirst({ where: { agencyId: settings.agencyId, emailNormalized: email, verificationToken: String(body.verificationToken), verifiedAt: { not: null }, expiresAt: { gt: new Date() } } }) : null;
  const existingClient = verification ? await prisma.client.findFirst({
    where: { agencyId: settings.agencyId, email: { equals: email, mode: "insensitive" } },
    select: { id: true, assignedUserId: true },
  }) : null;
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
      sessionBufferMinutes: sessionType.bufferMinutes,
      excludeHoldToken: offerHold?.claimToken || null,
      timezone: settings.timezone,
      db: tx,
    });
    const assignmentBuffer = sessionType.bufferMinutes ?? assignee.schedulingPreference?.bufferMinutes ?? settings.bufferMinutes;
    const conflict = await assertSlotAvailable(tx, {
      agencyId: settings.agencyId,
      assignedToId: assignee.id,
      startsAt,
      endsAt,
      bufferMinutes: assignmentBuffer,
      excludeHoldToken: offerHold?.claimToken || null,
    });
    if (conflict) throw createHttpError(409, "That time was just taken. Pick another slot.", "SLOT_TAKEN");
    const created = await tx.appointment.create({
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
        reminderDueAt: new Date(startsAt.getTime() - Math.max(...(Array.isArray(settings.reminderSchedule) && settings.reminderSchedule.length ? settings.reminderSchedule : [settings.reminderMinutes])) * 60_000),
        referenceCode: appointmentReference(),
        status: "Scheduled",
      },
      include: { client: { select: { fullName: true, email: true, phone: true } }, assignedTo: { select: { id: true, fullName: true } } },
    });
    await recordAppointmentEvent(tx, { agencyId: settings.agencyId, appointmentId: created.id, type: "BOOKED", summary: "Appointment booked through the public page", metadata: { meetingMode: created.meetingMode } });
    if (offerHold) {
      const claimed = await tx.bookingSlotHold.updateMany({ where: { id: offerHold.id, claimedAt: null, expiresAt: { gt: new Date() } }, data: { claimedAt: new Date() } });
      if (!claimed.count) throw createHttpError(409, "This reserved waitlist time has expired.", "OFFER_EXPIRED");
      await tx.bookingWaitlistEntry.update({ where: { id: offerHold.waitlistEntryId }, data: { status: "Booked" } });
    }
    return created;
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
      referenceCode: appointment.referenceCode,
      assignedTo: appointment.assignedTo,
      preparationInstructions: sessionType.preparationInstructions,
      preparationChecklist: sessionType.preparationChecklist,
      parkingInstructions: sessionType.parkingInstructions,
    },
  });
}

function publicHoldView(hold) {
  return {
    claimToken: hold.claimToken,
    startsAt: hold.startsAt,
    endsAt: hold.endsAt,
    amount: hold.amount,
    status: hold.status,
    expiresAt: hold.expiresAt,
    payNowUrl: hold.status === "AwaitingPayment" ? hold.qbInvoiceLink || null : null,
  };
}

// Paid-booking counterpart to createPublicBooking above: instead of
// creating the Appointment immediately, this locks the slot behind a
// BookingPaymentHold and returns a QuickBooks "Pay now" link. The
// appointment itself is only created once the QuickBooks webhook confirms
// payment (see quickbooksWebhookService.js).
export async function createPublicBookingPaymentHold(req, res) {
  const settings = await resolveAgencyByToken(req.params.token);
  if (!settings.consultFeeEnabled || !settings.consultFeeAmount) {
    throw createHttpError(409, "Paid consultation booking is not enabled for this workspace.", "CONSULT_FEE_DISABLED");
  }
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

  // Re-validate that the requested slot really is offered — never trust the widget.
  const dayKey = localDateKey(startsAt, settings.timezone);
  const requestedConsultantId = String(body.consultantId || "") || null;
  const staff = await eligibleSchedulingStaff({ agencyId: settings.agencyId, sessionTypeId: sessionType.id, publicOnly: true, requestedUserId: requestedConsultantId });
  const { days } = await availabilityForRange({
    agencyId: settings.agencyId,
    assignedToIds: staff.map((item) => item.id),
    durationMinutes: sessionType.durationMinutes,
    sessionBufferMinutes: sessionType.bufferMinutes,
    fromKey: dayKey,
    toKey: dayKey,
  });
  const offered = (days[dayKey] || []).some((slot) => slot.startsAt === startsAt.toISOString());
  if (!offered) throw createHttpError(409, "That time is no longer available. Pick another slot.", "SLOT_TAKEN");

  const idempotencyKey = String(req.get("Idempotency-Key") || body.idempotencyKey || "").trim().slice(0, 160) || null;
  if (idempotencyKey) {
    const prior = await prisma.bookingPaymentHold.findUnique({ where: { agencyId_idempotencyKey: { agencyId: settings.agencyId, idempotencyKey } } });
    if (prior) return res.status(200).json({ data: publicHoldView(prior) });
  }

  const hold = await createPaymentHoldForPublicBooking(settings.agencyId, {
    sessionTypeId: sessionType.id,
    sessionTypeName: sessionType.name,
    startsAt,
    endsAt,
    requestedConsultantId,
    meetingMode: online ? "Online" : "InPerson",
    location,
    name,
    email,
    phone,
    notes,
    amount: Number(settings.consultFeeAmount),
    holdMinutes: settings.consultFeeHoldMinutes,
    idempotencyKey,
    bufferMinutes: settings.bufferMinutes,
  });

  res.status(201).json({ data: publicHoldView(hold) });
}

export async function getPublicBookingPaymentHoldStatus(req, res) {
  const settings = await resolveAgencyByToken(req.params.token);
  const hold = await getPaymentHoldStatus(settings.agencyId, String(req.params.claimToken || ""));
  res.json({ data: publicHoldView(hold) });
}

export async function requestBookingVerification(req, res) {
  const settings = await resolveAgencyByToken(req.params.token);
  const email = String(req.body?.email || "").trim().toLowerCase().slice(0, 254);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw createHttpError(400, "Enter a valid email.", "VALIDATION_ERROR");
  await prisma.bookingVerificationCode.deleteMany({ where: { agencyId: settings.agencyId, emailNormalized: email, OR: [{ expiresAt: { lt: new Date() } }, { verifiedAt: { not: null } }] } });
  const code = String(randomInt(100000, 1000000));
  const record = await prisma.bookingVerificationCode.create({ data: { agencyId: settings.agencyId, emailNormalized: email, codeHash: verificationHash(settings.agencyId, email, code), expiresAt: new Date(Date.now() + 10 * 60_000) } });
  try {
    const config = await resolveAgencyMailConfig(settings.agencyId);
    const transport = createMailTransport(config);
    const agencyName = settings.agency.legalName || settings.agency.name;
    await transport.sendMail({ from: config.from, to: email, subject: `${code} is your ${agencyName} verification code`, text: `Your verification code is ${code}. It expires in 10 minutes.`, html: `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f1f5f9;padding:32px"><div style="max-width:520px;margin:auto;background:#fff;border-radius:24px;padding:32px"><p style="color:#64748b">Verify your email for ${agencyName}</p><p style="font-size:38px;letter-spacing:.18em;font-weight:800;color:#0f172a">${code}</p><p style="color:#64748b">This code expires in 10 minutes.</p></div></div>` });
  } catch {
    await prisma.bookingVerificationCode.delete({ where: { id: record.id } }).catch(() => {});
    throw createHttpError(503, "A verification email could not be sent. You can still continue as a guest.", "MAIL_UNAVAILABLE");
  }
  res.status(201).json({ data: { verificationId: record.id, expiresInSeconds: 600 } });
}

export async function verifyBookingEmail(req, res) {
  const settings = await resolveAgencyByToken(req.params.token);
  const id = String(req.body?.verificationId || "");
  const code = String(req.body?.code || "").trim();
  const record = await prisma.bookingVerificationCode.findFirst({ where: { id, agencyId: settings.agencyId } });
  if (!record || record.expiresAt <= new Date() || record.attempts >= 5) throw createHttpError(400, "That code is expired. Request a new one.", "CODE_EXPIRED");
  const expected = Buffer.from(record.codeHash, "hex");
  const actual = Buffer.from(verificationHash(settings.agencyId, record.emailNormalized, code), "hex");
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    await prisma.bookingVerificationCode.update({ where: { id: record.id }, data: { attempts: { increment: 1 } } });
    throw createHttpError(400, "That verification code is not correct.", "CODE_INVALID");
  }
  const verificationToken = randomUUID();
  await prisma.bookingVerificationCode.update({ where: { id: record.id }, data: { verifiedAt: new Date(), verificationToken } });
  const client = await prisma.client.findFirst({ where: { agencyId: settings.agencyId, email: { equals: record.emailNormalized, mode: "insensitive" } }, select: { assignedUser: { select: { id: true, fullName: true } } } });
  res.json({ data: { verificationToken, recognized: Boolean(client), consultant: client?.assignedUser ? { id: client.assignedUser.id, name: client.assignedUser.fullName } : null } });
}

async function resolveManaged(token) {
  const appointment = await prisma.appointment.findUnique({
    where: { manageToken: String(token || "") },
    include: {
      client: { select: { fullName: true, email: true, phone: true } },
      sessionType: { select: { id: true, name: true, durationMinutes: true, allowedMeetingModes: true, allowedLocationIds: true, bufferMinutes: true, preparationInstructions: true, preparationChecklist: true, parkingInstructions: true } },
      assignedTo: { select: { id: true, fullName: true, schedulingPreference: { select: { bufferMinutes: true } } } },
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
    referenceCode: appointment.referenceCode,
    confirmationStatus: appointment.confirmationStatus,
    confirmedAt: appointment.confirmedAt,
    preparationCompletedAt: appointment.preparationCompletedAt,
    preparationInstructions: appointment.sessionType?.preparationInstructions || null,
    preparationChecklist: appointment.sessionType?.preparationChecklist || [],
    parkingInstructions: appointment.sessionType?.parkingInstructions || null,
    consultant: appointment.assignedTo ? { id: appointment.assignedTo.id, name: appointment.assignedTo.fullName } : null,
    isRecurring: Boolean(appointment.seriesKey),
    recurrenceIndex: appointment.recurrenceIndex,
    recurrenceCount: appointment.recurrenceCount,
    canConfirm: appointment.status === "Scheduled" && appointment.confirmationStatus !== "Confirmed" && settings?.attendanceConfirmationEnabled !== false,
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
    sessionBufferMinutes: appointment.sessionType?.bufferMinutes,
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
  if (req.body?.scope === "series" && appointment.seriesKey) {
    const series = await prisma.appointment.findMany({ where: { agencyId: appointment.agencyId, seriesKey: appointment.seriesKey, status: "Scheduled", startsAt: { gte: appointment.startsAt } }, include: { client: { select: { fullName: true, email: true, phone: true } }, assignedTo: { select: { id: true, fullName: true } }, sessionType: true, agency: { select: { name: true, legalName: true } } }, orderBy: { startsAt: "asc" } });
    const reason = String(req.body?.reason || "Cancelled by guest").trim().slice(0, 500);
    await prisma.$transaction(async (tx) => {
      await tx.appointment.updateMany({ where: { id: { in: series.map((item) => item.id) }, status: "Scheduled" }, data: { status: "Cancelled", cancelledAt: new Date(), cancellationReason: reason } });
      if (series.length) await tx.appointmentEvent.createMany({ data: series.map((item) => ({ agencyId: appointment.agencyId, appointmentId: item.id, type: "SERIES_CANCELLED", summary: "Guest cancelled appointment with recurring series", metadata: { seriesKey: appointment.seriesKey } })) });
    });
    const cancelled = series.map((item) => ({ ...item, status: "Cancelled", cancelledAt: new Date(), cancellationReason: reason }));
    await Promise.all(cancelled.flatMap((item) => [sendBookingMessages({ agencyId: appointment.agencyId, appointment: item, kind: "cancelled" }).catch(() => {}), offerWaitlistOpening(item).catch(() => {})]));
    invalidateDashboardCache(appointment.agencyId);
    return res.json({ data: { ...publicView(cancelled.find((item) => item.id === appointment.id), settings), seriesAffected: series.length } });
  }
  const updated = await prisma.appointment.update({
    where: { id: appointment.id },
    data: { status: "Cancelled", cancelledAt: new Date(), cancellationReason: String(req.body?.reason || "Cancelled by guest").trim().slice(0, 500) },
    include: { client: { select: { fullName: true, email: true, phone: true } }, assignedTo: { select: { id: true, fullName: true } }, sessionType: true, agency: { select: { name: true } } },
  });
  await recordAppointmentEvent(prisma, { agencyId: appointment.agencyId, appointmentId: appointment.id, type: "CANCELLED", summary: "Guest cancelled through the manage link", metadata: { reason: updated.cancellationReason } });
  await recordActivity({
    agencyId: appointment.agencyId,
    userId: null,
    clientId: appointment.clientId,
    caseId: appointment.caseId,
    action: "appointment.cancelled",
    details: `${appointment.subject} cancelled via booking link`,
  }).catch(() => {});
  await sendBookingMessages({ agencyId: appointment.agencyId, appointment: updated, kind: "cancelled" }).catch(() => {});
  await offerWaitlistOpening(updated).catch(() => {});
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

  if (req.body?.scope === "series" && appointment.seriesKey) {
    const series = await prisma.appointment.findMany({ where: { agencyId: appointment.agencyId, seriesKey: appointment.seriesKey, status: "Scheduled", startsAt: { gte: appointment.startsAt } }, include: { client: { select: { fullName: true, email: true, phone: true } }, assignedTo: { select: { id: true, fullName: true, schedulingPreference: { select: { bufferMinutes: true } } } }, sessionType: true, agency: { select: { name: true, legalName: true } } }, orderBy: { startsAt: "asc" } });
    const seriesIds = series.map((item) => item.id);
    const delta = startsAt.getTime() - new Date(appointment.startsAt).getTime();
    const moves = series.map((item) => ({ item, startsAt: new Date(new Date(item.startsAt).getTime() + delta), endsAt: new Date(new Date(item.endsAt).getTime() + delta), buffer: item.sessionType?.bufferMinutes ?? item.assignedTo?.schedulingPreference?.bufferMinutes ?? settings?.bufferMinutes ?? 0 }));
    for (const move of moves) {
      const key = localDateKey(move.startsAt, settings?.timezone || "America/Toronto");
      const offered = await availabilityForRange({ agencyId: appointment.agencyId, assignedToId: move.item.assignedToId, durationMinutes: Math.round((move.endsAt - move.startsAt) / 60_000), sessionBufferMinutes: move.item.sessionType?.bufferMinutes, fromKey: key, toKey: key, excludeAppointmentIds: seriesIds });
      if (!(offered.days[key] || []).some((slot) => slot.startsAt === move.startsAt.toISOString())) throw createHttpError(409, `${key} at the recurring time is unavailable. The series was not changed.`, "SLOT_TAKEN");
    }
    const updatedSeries = await prisma.$transaction(async (tx) => {
      const results = [];
      for (const move of moves) {
        await lockSchedulingTransaction(tx, appointment.agencyId, move.startsAt);
        const conflict = await assertSlotAvailable(tx, { agencyId: appointment.agencyId, assignedToId: move.item.assignedToId, startsAt: move.startsAt, endsAt: move.endsAt, bufferMinutes: move.buffer, excludeAppointmentIds: seriesIds });
        if (conflict) throw createHttpError(409, "A recurring time was just taken. The series was not changed.", "SLOT_TAKEN");
        const result = await tx.appointment.update({ where: { id: move.item.id }, data: { startsAt: move.startsAt, endsAt: move.endsAt, meetingMode, meetingUrl: meetingMode === "Online" ? move.item.meetingUrl || meetingLink() : null, location: meetingMode === "InPerson" ? selectedLocation ? `${selectedLocation.name} — ${selectedLocation.address}` : move.item.location : null, locationMapsUrl: meetingMode === "InPerson" ? selectedLocation?.mapsUrl || move.item.locationMapsUrl : null, reminderSentAt: null, reminderDueAt: new Date(move.startsAt.getTime() - Math.max(...(Array.isArray(settings?.reminderSchedule) && settings.reminderSchedule.length ? settings.reminderSchedule : [settings?.reminderMinutes || 1440])) * 60_000), reminderQueuedAt: null }, include: { client: { select: { fullName: true, email: true, phone: true } }, assignedTo: { select: { id: true, fullName: true } }, sessionType: true, agency: { select: { name: true, legalName: true } } } });
        await recordAppointmentEvent(tx, { agencyId: appointment.agencyId, appointmentId: move.item.id, type: "SERIES_RESCHEDULED", summary: "Guest moved appointment with recurring series", metadata: { from: move.item.startsAt, to: move.startsAt, seriesKey: appointment.seriesKey } });
        results.push(result);
      }
      return results;
    });
    await Promise.all(updatedSeries.map((item) => sendBookingMessages({ agencyId: appointment.agencyId, appointment: item, kind: "rescheduled" }).catch(() => {})));
    invalidateDashboardCache(appointment.agencyId);
    return res.json({ data: { ...publicView(updatedSeries.find((item) => item.id === appointment.id), settings), seriesAffected: updatedSeries.length } });
  }

  const dayKey = localDateKey(startsAt, settings?.timezone || "America/Toronto");
  const { days } = await availabilityForRange({
    agencyId: appointment.agencyId,
    assignedToId: appointment.assignedToId,
    durationMinutes: duration,
    sessionBufferMinutes: appointment.sessionType?.bufferMinutes,
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
      bufferMinutes: appointment.sessionType?.bufferMinutes ?? appointment.assignedTo?.schedulingPreference?.bufferMinutes ?? settings?.bufferMinutes ?? 0,
      excludeAppointmentId: appointment.id,
    });
    if (conflict) throw createHttpError(409, "That time was just taken. Pick another slot.", "SLOT_TAKEN");
    const result = await tx.appointment.update({
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
        reminderDueAt: new Date(startsAt.getTime() - Math.max(...(Array.isArray(settings?.reminderSchedule) && settings.reminderSchedule.length ? settings.reminderSchedule : [settings?.reminderMinutes || 1440])) * 60_000),
        reminderQueuedAt: null,
      },
      include: { client: { select: { fullName: true, email: true, phone: true } }, assignedTo: { select: { id: true, fullName: true } }, sessionType: true, agency: { select: { name: true, legalName: true } } },
    });
    await recordAppointmentEvent(tx, { agencyId: appointment.agencyId, appointmentId: appointment.id, type: "RESCHEDULED", summary: "Guest rescheduled through the manage link", metadata: { from: appointment.startsAt, to: startsAt, meetingMode } });
    return result;
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

export async function confirmManagedBooking(req, res) {
  const appointment = await resolveManaged(req.params.manageToken);
  if (appointment.status !== "Scheduled") throw createHttpError(409, "This appointment is no longer active.", "ALREADY_DONE");
  const settings = await prisma.bookingSettings.findUnique({ where: { agencyId: appointment.agencyId } });
  if (settings?.attendanceConfirmationEnabled === false) throw createHttpError(409, "Attendance confirmation is not enabled.", "DISABLED");
  const updated = await prisma.$transaction(async (tx) => {
    const result = await tx.appointment.update({ where: { id: appointment.id }, data: { confirmationStatus: "Confirmed", confirmedAt: new Date() }, include: { client: { select: { fullName: true, email: true, phone: true } }, assignedTo: { select: { id: true, fullName: true } }, sessionType: true, agency: { select: { name: true, legalName: true } } } });
    await recordAppointmentEvent(tx, { agencyId: appointment.agencyId, appointmentId: appointment.id, type: "CONFIRMED", summary: "Guest confirmed attendance" });
    return result;
  });
  await sendBookingStaffNotification({ agencyId: appointment.agencyId, appointment: updated, kind: "confirmed" }).catch(() => {});
  res.json({ data: publicView(updated, settings) });
}

export async function completeManagedPreparation(req, res) {
  const appointment = await resolveManaged(req.params.manageToken);
  if (appointment.status !== "Scheduled") throw createHttpError(409, "This appointment is no longer active.", "ALREADY_DONE");
  const updated = await prisma.$transaction(async (tx) => {
    const result = await tx.appointment.update({ where: { id: appointment.id }, data: { preparationCompletedAt: new Date() }, include: { client: { select: { fullName: true, email: true, phone: true } }, assignedTo: { select: { id: true, fullName: true } }, sessionType: true, agency: { select: { name: true, legalName: true } } } });
    await recordAppointmentEvent(tx, { agencyId: appointment.agencyId, appointmentId: appointment.id, type: "PREPARATION_COMPLETED", summary: "Guest marked preparation complete" });
    return result;
  });
  const settings = await prisma.bookingSettings.findUnique({ where: { agencyId: appointment.agencyId } });
  res.json({ data: publicView(updated, settings) });
}

export async function joinPublicWaitlist(req, res) {
  const settings = await resolveAgencyByToken(req.params.token);
  await releaseExpiredWaitlistHolds(settings.agencyId);
  if (!settings.waitlistEnabled) throw createHttpError(409, "The waitlist is not enabled.", "DISABLED");
  const body = req.body || {};
  const sessionType = await prisma.bookingSessionType.findFirst({ where: { id: String(body.sessionTypeId || ""), agencyId: settings.agencyId, isActive: true } });
  if (!sessionType) throw createHttpError(400, "Choose a session type.", "VALIDATION_ERROR");
  const name = String(body.name || "").trim().slice(0, 160);
  const email = String(body.email || "").trim().toLowerCase().slice(0, 254);
  if (!name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw createHttpError(400, "Your name and a valid email are required.", "VALIDATION_ERROR");
  const preferredFrom = new Date(String(body.preferredFrom || ""));
  const preferredTo = new Date(String(body.preferredTo || ""));
  if (Number.isNaN(preferredFrom.getTime()) || Number.isNaN(preferredTo.getTime()) || preferredTo <= preferredFrom || preferredTo.getTime() - preferredFrom.getTime() > 90 * 86_400_000) throw createHttpError(400, "Choose a valid waitlist date range up to 90 days.", "VALIDATION_ERROR");
  const meetingMode = body.meetingMode === "Online" ? "Online" : "InPerson";
  if (!sessionType.allowedMeetingModes.includes(meetingMode)) throw createHttpError(400, "That appointment format is unavailable.", "VALIDATION_ERROR");
  const prior = await prisma.bookingWaitlistEntry.findFirst({ where: { agencyId: settings.agencyId, sessionTypeId: sessionType.id, emailNormalized: email, status: "Waiting" } });
  const data = prior || await prisma.bookingWaitlistEntry.create({ data: {
    agencyId: settings.agencyId,
    sessionTypeId: sessionType.id,
    preferredUserId: String(body.consultantId || "") || null,
    name,
    email,
    emailNormalized: email,
    phone: String(body.phone || "").trim().slice(0, 40) || null,
    meetingMode,
    locationId: String(body.locationId || "") || null,
    preferredFrom,
    preferredTo,
  } });
  if (!prior) {
    await notifyUsers({
      agencyId: settings.agencyId,
      recipientIds: await schedulingCoordinatorRecipientIds(settings.agencyId),
      type: "appointment.waitlist_joined",
      category: "appointments",
      title: `New appointment waitlist request: ${sessionType.name}`,
      body: `${name} · ${meetingMode === "Online" ? "Online" : "In person"} · ${preferredFrom.toLocaleDateString("en-CA")}–${preferredTo.toLocaleDateString("en-CA")}`,
      severity: "info",
      entityType: "booking_waitlist",
      entityId: data.id,
      actionUrl: "/app/dashboard#appointment-register-heading",
      dedupeKey: `appointment-waitlist:${data.id}:joined`,
    }).catch(() => {});
  }
  res.status(prior ? 200 : 201).json({ data: { id: data.id, status: data.status, createdAt: data.createdAt } });
}
