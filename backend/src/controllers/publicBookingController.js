import { createHash, randomInt, randomUUID, timingSafeEqual } from "node:crypto";
import prisma from "../services/prisma/client.js";
import { createHttpError } from "../utils/http.js";
import { logger } from "../services/logger.js";
import { recordActivity } from "../utils/prismaCrud.js";
import { assertSlotAvailable, availabilityForRange, localDateKey, localDateTimeToUtc } from "../services/bookingAvailabilityService.js";
import {
  processBookingMessageDeliveries,
  sendBookingMessages,
  sendBookingStaffNotification,
} from "../services/bookingNotificationService.js";
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
import { createPaymentHoldForPublicBooking, getPaymentHoldStatus, voidOpenPaymentHoldForAppointment } from "../services/bookingPaymentHoldService.js";
import { resolveFreeConsultationEligibility } from "../services/bookingFreeConsultationService.js";
import { createOrLinkLeadForConsultation } from "../modules/leads/lead.booking.js";
import { ensureRetainerClientForLead } from "../modules/leads/lead.retainer.service.js";
import { reconcilePaymentHold } from "../services/quickbooksWebhookService.js";
import { AVATAR_BUCKET, downloadStorageFile } from "../services/supabaseStorage.js";
import {
  MEETING_MODES,
  appointmentMeetingFields,
  assertMeetingModeConfigured,
  meetingModeEnabled,
  normalizeBookingPhone,
  normalizeMeetingMode,
} from "../services/bookingMeetingModeService.js";
import { enqueueAppointmentMeetingJob } from "../services/appointmentMeetingService.js";
import { estimateRefundAfterFees, refundFeeRateForAgency } from "../services/refundFeeEstimateService.js";
import { syncLeadConsultationFromAppointment } from "../services/leadConsultationAppointmentService.js";
import { assertZoomOperational } from "../services/zoomService.js";

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function sessionLocations(settings, sessionType) {
  const allLocations = Array.isArray(settings.locations) ? settings.locations : [];
  return sessionType?.allowedLocationIds?.length
    ? allLocations.filter((item) => sessionType.allowedLocationIds.includes(item.id))
    : allLocations;
}

function resolvePublicLocation(settings, sessionType, requestedLocationId) {
  const locations = sessionLocations(settings, sessionType);
  if (!locations.length) {
    throw createHttpError(409, "In-person booking is not configured for this session.", "LOCATION_NOT_CONFIGURED");
  }
  const location = locations.find((item) => item.id === String(requestedLocationId || ""))
    || (locations.length === 1 ? locations[0] : null);
  if (!location) throw createHttpError(400, "Choose an office location.", "VALIDATION_ERROR");
  return location;
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
          avatarStorageKey: true,
          avatarMimeType: true,
          phone: true,
          email: true,
          website: true,
          address: true,
          city: true,
          province: true,
          postalCode: true,
          country: true,
          defaultCurrency: true,
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
  const { avatarStorageKey: _avatarStorageKey, avatarMimeType: _avatarMimeType, ...publicAgency } = settings.agency;
  const [sessionTypes, consultants, zoomConnection] = await Promise.all([prisma.bookingSessionType.findMany({
    where: { agencyId: settings.agencyId, isActive: true },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    select: { id: true, name: true, durationMinutes: true, description: true, allowedMeetingModes: true, allowedLocationIds: true, bufferMinutes: true, preparationInstructions: true, preparationChecklist: true, parkingInstructions: true, eligibleStaff: { select: { userId: true } } },
  }), eligibleSchedulingStaff({ agencyId: settings.agencyId, publicOnly: true }), prisma.agencyZoomConnection.findUnique({ where: { agencyId: settings.agencyId }, select: { status: true } })]);
  const zoomReady = meetingModeEnabled(settings, MEETING_MODES.ZOOM) && zoomConnection?.status === "connected";
  const offerToken = String(req.query.offer || "");
  const hold = offerToken ? await prisma.bookingSlotHold.findFirst({ where: { agencyId: settings.agencyId, claimToken: offerToken, claimedAt: null, expiresAt: { gt: new Date() } }, include: { waitlistEntry: true } }) : null;
  res.json({
    data: {
      agencyName,
      agency: {
        ...publicAgency,
        hasAvatar: Boolean(settings.agency.avatarStorageKey),
      },
      timezone: settings.timezone,
      horizonDays: settings.horizonDays,
      sessionTypes,
      consultants: consultants.map(({ id, fullName, jobTitle, consultantProfiles, zoomHostMapping }) => ({ id, name: fullName, title: jobTitle || "Immigration consultant", specializations: consultantProfiles?.[0]?.specializations || [], masteryLevel: consultantProfiles?.[0]?.masteryLevel || null, zoomEnabled: zoomReady && zoomHostMapping?.status === "active" })),
      locations: Array.isArray(settings.locations) ? settings.locations : [],
      waitlistEnabled: settings.waitlistEnabled,
      attendanceConfirmationEnabled: settings.attendanceConfirmationEnabled,
      onlineBookingEnabled: meetingModeEnabled(settings, MEETING_MODES.JITSI),
      phoneBookingEnabled: meetingModeEnabled(settings, MEETING_MODES.PHONE) && Boolean(settings.phoneCallerId),
      phoneCallerId: settings.phoneCallerId,
      phoneCallInstructions: settings.phoneCallInstructions,
      zoomBookingEnabled: zoomReady,
      consultFeeEnabled: settings.consultFeeEnabled,
      consultFeeAmount: settings.consultFeeAmount,
      consultFeeTerms: settings.consultFeeTerms,
      publicHeadline: settings.publicHeadline,
      publicWelcomeMessage: settings.publicWelcomeMessage,
      publicSignOffName: settings.publicSignOffName,
      offer: hold ? { token: hold.claimToken, startsAt: hold.startsAt, endsAt: hold.endsAt, expiresAt: hold.expiresAt, sessionTypeId: hold.sessionTypeId, consultantId: hold.assignedToId, name: hold.waitlistEntry.name, email: hold.waitlistEntry.email, phone: hold.waitlistEntry.phone, meetingMode: hold.waitlistEntry.meetingMode, locationId: hold.waitlistEntry.locationId } : null,
      offerExpired: Boolean(offerToken && !hold),
    },
  });
}

export async function getPublicBookingAvatar(req, res) {
  const settings = await resolveAgencyByToken(req.params.token);
  if (!settings.agency.avatarStorageKey) throw createHttpError(404, "No workspace image is available.", "NOT_FOUND");
  const buffer = await downloadStorageFile(AVATAR_BUCKET, settings.agency.avatarStorageKey, { allowMissing: true });
  if (!buffer) throw createHttpError(404, "The workspace image could not be found.", "NOT_FOUND");
  res.set("Cache-Control", "public, max-age=300");
  // The booking UI and API are deployed on different sites. This image is
  // intentionally public and token-scoped, so override the API-wide
  // same-site policy that would otherwise make browsers block the <img>.
  res.set("Cross-Origin-Resource-Policy", "cross-origin");
  res.type(settings.agency.avatarMimeType || "application/octet-stream");
  res.send(buffer);
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
  const meetingMode = normalizeMeetingMode(req.query.meetingMode);
  if (!meetingModeEnabled(settings, meetingMode) || (sessionType.allowedMeetingModes?.length && !sessionType.allowedMeetingModes.includes(meetingMode))) {
    throw createHttpError(400, "That appointment format is unavailable.", "VALIDATION_ERROR");
  }
  if (meetingMode === MEETING_MODES.ZOOM) await assertZoomOperational(settings.agencyId);
  const location = meetingMode === MEETING_MODES.IN_PERSON
    ? resolvePublicLocation(settings, sessionType, req.query.locationId)
    : null;
  const requestedConsultantId = String(req.query.consultantId || "") || null;
  const offerToken = String(req.query.offerToken || "") || null;
  const offerHold = offerToken ? await prisma.bookingSlotHold.findFirst({ where: { agencyId: settings.agencyId, claimToken: offerToken, claimedAt: null, expiresAt: { gt: new Date() } } }) : null;
  if (offerToken && !offerHold) throw createHttpError(410, "This reserved waitlist time has expired.", "OFFER_EXPIRED");
  const staff = await eligibleSchedulingStaff({
    agencyId: settings.agencyId,
    sessionTypeId: sessionType.id,
    publicOnly: true,
    requestedUserId: requestedConsultantId,
    meetingMode,
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
    locationId: location?.id || null,
    meetingMode,
  });
  const publicDays = Object.fromEntries(Object.entries(days).map(([key, slots]) => [key, slots.map(({ staffIds, ...slot }) => slot)]));
  res.json({ data: { days: publicDays, timezone: settings.timezone } });
}

export async function createPublicBooking(req, res) {
  const settings = await resolveAgencyByToken(req.params.token);
  // The browser normally chooses the payment-hold endpoint when a
  // consultation fee is enabled, but public API callers must not be able to
  // bypass payment by posting directly to the free appointment endpoint.
  if (settings.consultFeeEnabled && Number(settings.consultFeeAmount) > 0) {
    throw createHttpError(
      409,
      "Payment is required before this appointment can be confirmed.",
      "PAYMENT_REQUIRED",
    );
  }
  const body = req.body || {};
  if (String(body.website || "").trim()) throw createHttpError(400, "The booking could not be completed.", "VALIDATION_ERROR");

  const sessionType = await prisma.bookingSessionType.findFirst({
    where: { id: String(body.sessionTypeId || ""), agencyId: settings.agencyId, isActive: true },
  });
  if (!sessionType) throw createHttpError(400, "Choose a session type.", "VALIDATION_ERROR");

  const idempotencyKey = String(req.get("Idempotency-Key") || body.idempotencyKey || "").trim().slice(0, 160) || null;
  if (idempotencyKey) {
    const prior = await prisma.appointment.findUnique({
      where: { agencyId_idempotencyKey: { agencyId: settings.agencyId, idempotencyKey } },
      include: {
        assignedTo: { select: { id: true, fullName: true } },
        sessionType: {
          select: {
            preparationInstructions: true,
            preparationChecklist: true,
            parkingInstructions: true,
          },
        },
      },
    });
    if (prior) return res.status(200).json({ data: bookingConfirmationView(prior, settings) });
  }

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
  const phone = normalizeBookingPhone(String(body.phone || "").trim().slice(0, 40), "Client phone number");
  const notes = String(body.notes || "").trim().slice(0, 1000);
  const meetingMode = normalizeMeetingMode(body.meetingMode);
  assertMeetingModeConfigured({ settings, sessionType, mode: meetingMode, guestPhone: phone });
  if (meetingMode === MEETING_MODES.ZOOM) await assertZoomOperational(settings.agencyId);
  const location = meetingMode === MEETING_MODES.IN_PERSON
    ? resolvePublicLocation(settings, sessionType, body.locationId)
    : null;
  if (!name) throw createHttpError(400, "Your name is required.", "VALIDATION_ERROR");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw createHttpError(400, "A valid email is required.", "VALIDATION_ERROR");
  if (!phone) throw createHttpError(400, "A valid phone number is required.", "VALIDATION_ERROR");
  if (offerHold && email !== offerHold.waitlistEntry.emailNormalized) throw createHttpError(400, "Use the email address that joined the waitlist.", "INVALID_OFFER");

  // Re-validate that the requested slot really is offered (working hours,
  // days off, notice, horizon) — never trust the widget.
  const dayKey = localDateKey(startsAt, settings.timezone);
  const requestedConsultantId = offerHold?.assignedToId || String(body.consultantId || "") || null;
  const staff = await eligibleSchedulingStaff({ agencyId: settings.agencyId, sessionTypeId: sessionType.id, publicOnly: true, requestedUserId: requestedConsultantId, meetingMode });
  const { days } = await availabilityForRange({
    agencyId: settings.agencyId,
    assignedToIds: staff.map((item) => item.id),
    durationMinutes: sessionType.durationMinutes,
    sessionBufferMinutes: sessionType.bufferMinutes,
    fromKey: dayKey,
    toKey: dayKey,
    excludeHoldToken: offerHold?.claimToken || null,
    locationId: meetingMode === MEETING_MODES.IN_PERSON ? location?.id || null : null,
    meetingMode,
  });
  const offered = (days[dayKey] || []).some((slot) => slot.startsAt === startsAt.toISOString());
  if (!offered) throw createHttpError(409, "That time is no longer available. Pick another slot.", "SLOT_TAKEN");

  const verification = body.verificationToken ? await prisma.bookingVerificationCode.findFirst({ where: { agencyId: settings.agencyId, emailNormalized: email, verificationToken: String(body.verificationToken), verifiedAt: { not: null }, expiresAt: { gt: new Date() } } }) : null;
  const existingClient = verification ? await prisma.client.findFirst({
    where: { agencyId: settings.agencyId, email: { equals: email, mode: "insensitive" } },
    select: { id: true, assignedUserId: true },
  }) : null;
  const freeEligibility = await resolveFreeConsultationEligibility(settings.agencyId, settings, {
    clientId: existingClient?.id || null,
    // A raw email address is not proof of identity. Only a valid booking
    // verification token may use historic payments to unlock a free visit.
    guestEmailNormalized: verification ? email : null,
    durationMinutes: sessionType.durationMinutes,
  });
  if (settings.freeConsultationsEnabled && !freeEligibility.eligible) {
    const message = freeEligibility.reason === "PAID_BOOKING_REQUIRED"
      ? "A free consultation is available only after a previous paid consultation."
      : freeEligibility.reason === "FIFTEEN_MINUTE_SESSION_REQUIRED"
        ? "Free follow-up consultations must use a 15-minute appointment type."
        : freeEligibility.reason === "VERIFIED_CONTACT_REQUIRED"
          ? "Verify your email before using a free follow-up consultation."
          : "The free consultation limit for this email has been reached. Please contact the office.";
    throw createHttpError(409, message, freeEligibility.reason);
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
      meetingMode,
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
      meetingMode,
    });
    if (conflict) throw createHttpError(409, "That time was just taken. Pick another slot.", "SLOT_TAKEN");
    const meetingFields = appointmentMeetingFields({ mode: meetingMode, settings });
    const created = await tx.appointment.create({
      data: {
        agencyId: settings.agencyId,
        clientId: existingClient?.id || null,
        sessionTypeId: sessionType.id,
        subject: sessionType.name,
        location: location ? `${location.name} — ${location.address}` : null,
        locationId: location?.id || null,
        locationMapsUrl: location?.mapsUrl || null,
        calendar: "Workspace Calendar",
        startsAt,
        endsAt,
        description: notes || null,
        purpose: notes || null,
        guestName: name,
        guestEmail: email,
        guestEmailNormalized: email,
        guestPhone: phone || null,
        ...meetingFields,
        assignedToId: assignee.id,
        source: "Public",
        isFreeConsultation: freeEligibility.eligible,
        idempotencyKey,
        reminderDueAt: new Date(startsAt.getTime() - Math.max(...(Array.isArray(settings.reminderSchedule) && settings.reminderSchedule.length ? settings.reminderSchedule : [settings.reminderMinutes])) * 60_000),
        referenceCode: appointmentReference(),
        status: "Scheduled",
      },
      include: { client: { select: { fullName: true, email: true, phone: true } }, assignedTo: { select: { id: true, fullName: true } } },
    });
    await recordAppointmentEvent(tx, { agencyId: settings.agencyId, appointmentId: created.id, type: "BOOKED", summary: "Appointment booked through the public page", metadata: { meetingMode: created.meetingMode } });
    if (meetingMode === MEETING_MODES.ZOOM) {
      await enqueueAppointmentMeetingJob(tx, { appointment: created, action: "SYNC", notifyKind: "booked" });
    } else {
      await sendBookingMessages({ agencyId: settings.agencyId, appointment: created, kind: "booked", db: tx });
    }
    if (offerHold) {
      const claimed = await tx.bookingSlotHold.updateMany({ where: { id: offerHold.id, claimedAt: null, expiresAt: { gt: new Date() } }, data: { claimedAt: new Date() } });
      if (!claimed.count) throw createHttpError(409, "This reserved waitlist time has expired.", "OFFER_EXPIRED");
      await tx.bookingWaitlistEntry.update({ where: { id: offerHold.waitlistEntryId }, data: { status: "Booked" } });
    }
    // If this booking matches an existing open Lead (by email/phone) or an
    // already-converted Client, link it and advance the lead's funnel
    // stage automatically — mirrors what already happens for paid public
    // bookings once payment confirms (quickbooksWebhookService.js).
    await createOrLinkLeadForConsultation(tx, { agencyId: settings.agencyId, appointment: created, guestName: name, guestEmail: email, guestPhone: phone, paymentStatus: "UNPAID" });
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
  if (appointment.meetingMode !== MEETING_MODES.ZOOM) void processBookingMessageDeliveries();
  invalidateDashboardCache(settings.agencyId);

  res.status(201).json({ data: bookingConfirmationView(appointment, settings, sessionType) });
}

function bookingConfirmationView(appointment, settings, sessionType = appointment.sessionType) {
  return {
    manageToken: appointment.manageToken,
    subject: appointment.subject,
    startsAt: appointment.startsAt,
    endsAt: appointment.endsAt,
    meetingMode: appointment.meetingMode,
    meetingUrl: appointment.meetingUrl,
    meetingPhoneNumber: appointment.meetingPhoneNumber,
    meetingSyncStatus: appointment.meetingSyncStatus,
    location: appointment.location,
    locationMapsUrl: appointment.locationMapsUrl,
    timezone: settings.timezone,
    agencyName: settings.agency.legalName || settings.agency.name,
    referenceCode: appointment.referenceCode,
    assignedTo: appointment.assignedTo,
    preparationInstructions: sessionType?.preparationInstructions || null,
    preparationChecklist: sessionType?.preparationChecklist || [],
    parkingInstructions: sessionType?.parkingInstructions || null,
  };
}

function publicHoldView(hold, settings) {
  return {
    claimToken: hold.claimToken,
    startsAt: hold.startsAt,
    endsAt: hold.endsAt,
    amount: hold.amount,
    invoiceNumber: hold.qbInvoiceNumber,
    status: hold.status,
    expiresAt: hold.expiresAt,
    payNowUrl: hold.status === "AwaitingPayment" ? hold.qbInvoiceLink || null : null,
    appointment: hold.status === "Paid" && hold.appointment
      ? bookingConfirmationView(hold.appointment, settings)
      : null,
    requiresStaffResolution: hold.status === "Paid" && !hold.appointmentId,
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

  const idempotencyKey = String(req.get("Idempotency-Key") || body.idempotencyKey || "").trim().slice(0, 160) || null;
  if (idempotencyKey) {
    const prior = await prisma.bookingPaymentHold.findUnique({
      where: { agencyId_idempotencyKey: { agencyId: settings.agencyId, idempotencyKey } },
      include: {
        appointment: {
          include: {
            assignedTo: { select: { id: true, fullName: true } },
            sessionType: {
              select: {
                preparationInstructions: true,
                preparationChecklist: true,
                parkingInstructions: true,
              },
            },
          },
        },
      },
    });
    if (prior) return res.status(200).json({ data: publicHoldView(prior, settings) });
  }

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
  const phone = normalizeBookingPhone(String(body.phone || "").trim().slice(0, 40), "Client phone number");
  const notes = String(body.notes || "").trim().slice(0, 1000);
  const meetingMode = normalizeMeetingMode(body.meetingMode);
  assertMeetingModeConfigured({ settings, sessionType, mode: meetingMode, guestPhone: phone });
  if (meetingMode === MEETING_MODES.ZOOM) await assertZoomOperational(settings.agencyId);
  const location = meetingMode === MEETING_MODES.IN_PERSON
    ? resolvePublicLocation(settings, sessionType, body.locationId)
    : null;
  if (!name) throw createHttpError(400, "Your name is required.", "VALIDATION_ERROR");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw createHttpError(400, "A valid email is required.", "VALIDATION_ERROR");
  if (!phone) throw createHttpError(400, "A valid phone number is required.", "VALIDATION_ERROR");
  if (offerHold && email !== offerHold.waitlistEntry.emailNormalized) throw createHttpError(400, "Use the email address that joined the waitlist.", "INVALID_OFFER");
  const verification = body.verificationToken ? await prisma.bookingVerificationCode.findFirst({
    where: {
      agencyId: settings.agencyId,
      emailNormalized: email,
      verificationToken: String(body.verificationToken),
      verifiedAt: { not: null },
      expiresAt: { gt: new Date() },
    },
  }) : null;
  const existingClient = verification ? await prisma.client.findFirst({
    where: { agencyId: settings.agencyId, email: { equals: email, mode: "insensitive" } },
    select: { id: true, assignedUserId: true },
  }) : null;

  // Re-validate that the requested slot really is offered — never trust the widget.
  const dayKey = localDateKey(startsAt, settings.timezone);
  const requestedConsultantId = offerHold?.assignedToId || String(body.consultantId || "") || null;
  const staff = await eligibleSchedulingStaff({ agencyId: settings.agencyId, sessionTypeId: sessionType.id, publicOnly: true, requestedUserId: requestedConsultantId, meetingMode });
  const { days } = await availabilityForRange({
    agencyId: settings.agencyId,
    assignedToIds: staff.map((item) => item.id),
    durationMinutes: sessionType.durationMinutes,
    sessionBufferMinutes: sessionType.bufferMinutes,
    fromKey: dayKey,
    toKey: dayKey,
    excludeHoldToken: offerHold?.claimToken || null,
    locationId: meetingMode === MEETING_MODES.IN_PERSON ? location?.id || null : null,
    meetingMode,
  });
  const offered = (days[dayKey] || []).some((slot) => slot.startsAt === startsAt.toISOString());
  if (!offered) throw createHttpError(409, "That time is no longer available. Pick another slot.", "SLOT_TAKEN");

  const hold = await createPaymentHoldForPublicBooking(settings.agencyId, {
    sessionTypeId: sessionType.id,
    sessionTypeName: sessionType.name,
    startsAt,
    endsAt,
    requestedConsultantId,
    preferredConsultantId: existingClient?.assignedUserId || null,
    clientId: existingClient?.id || null,
    meetingMode,
    settings,
    location,
    name,
    email,
    phone,
    notes,
    amount: Number(settings.consultFeeAmount),
    holdMinutes: settings.consultFeeHoldMinutes,
    idempotencyKey,
    bufferMinutes: sessionType.bufferMinutes ?? settings.bufferMinutes,
    offerHold,
  });

  res.status(201).json({ data: publicHoldView(hold, settings) });
}

export async function getPublicBookingPaymentHoldStatus(req, res) {
  const settings = await resolveAgencyByToken(req.params.token);
  const claimToken = String(req.params.claimToken || "");
  let hold = await getPaymentHoldStatus(settings.agencyId, claimToken);
  if (hold.qbInvoiceId && ["AwaitingPayment", "Expired"].includes(hold.status)) {
    await reconcilePaymentHold(settings.agencyId, hold.id, { allowExpired: true }).catch((error) => {
      logger.warn("booking_payment_hold.status_reconcile_failed", {
        agencyId: settings.agencyId,
        holdId: hold.id,
        reason: error.message,
      });
    });
    hold = await getPaymentHoldStatus(settings.agencyId, claimToken);
  }
  res.json({ data: publicHoldView(hold, settings) });
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

export async function resolveManaged(token) {
  const appointment = await prisma.appointment.findUnique({
    where: { manageToken: String(token || "") },
    include: {
      client: { select: { fullName: true, email: true, phone: true } },
      sessionType: { select: { id: true, name: true, durationMinutes: true, allowedMeetingModes: true, allowedLocationIds: true, bufferMinutes: true, preparationInstructions: true, preparationChecklist: true, parkingInstructions: true } },
      assignedTo: {
        select: {
          id: true,
          fullName: true,
          schedulingPreference: { select: { bufferMinutes: true } },
          zoomHostMapping: { select: { status: true } },
        },
      },
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
  const locationId = appointment.locationId || locations.find((item) => `${item.name} — ${item.address}` === appointment.location)?.id || null;
  const configuredModes = (appointment.sessionType?.allowedMeetingModes || ["InPerson", "Online"])
    .filter((mode) => meetingModeEnabled(settings, mode))
    .filter((mode) => mode !== MEETING_MODES.ZOOM || appointment.assignedTo?.zoomHostMapping?.status === "active");
  const allowedMeetingModes = [...new Set([
    ...configuredModes,
    ...(appointment.status === "Scheduled" ? [appointment.meetingMode] : []),
  ])];
  const timeUntilStart = new Date(appointment.startsAt).getTime() - Date.now();
  return {
    subject: appointment.subject,
    status: appointment.status,
    startsAt: appointment.startsAt,
    endsAt: appointment.endsAt,
    meetingMode: appointment.meetingMode,
    meetingUrl: appointment.status === "Scheduled" ? appointment.meetingUrl : null,
    meetingPhoneNumber: appointment.meetingPhoneNumber,
    meetingSyncStatus: appointment.meetingSyncStatus,
    location: appointment.location,
    locationMapsUrl: appointment.locationMapsUrl,
    locationId,
    locations,
    sessionType: appointment.sessionType,
    allowedMeetingModes,
    phoneCallerId: settings?.phoneCallerId || null,
    phoneCallInstructions: settings?.phoneCallInstructions || null,
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
  const [settings, paidHold, feeRate] = await Promise.all([
    prisma.bookingSettings.findUnique({ where: { agencyId: appointment.agencyId } }),
    appointment.status === "Scheduled"
      ? prisma.bookingPaymentHold.findFirst({ where: { agencyId: appointment.agencyId, appointmentId: appointment.id, status: "Paid" }, select: { amount: true } })
      : null,
    refundFeeRateForAgency(appointment.agencyId),
  ]);
  res.json({ data: { ...publicView(appointment, settings), refundEstimate: paidHold ? estimateRefundAfterFees(paidHold.amount, feeRate) : null } });
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
  const settingsRow = await prisma.bookingSettings.findUnique({ where: { agencyId: appointment.agencyId } });
  const requestedMode = req.query.meetingMode
    ? normalizeMeetingMode(req.query.meetingMode, appointment.meetingMode)
    : appointment.meetingMode;
  if (requestedMode !== appointment.meetingMode) {
    assertMeetingModeConfigured({
      settings: settingsRow,
      sessionType: appointment.sessionType,
      mode: requestedMode,
      guestPhone: appointment.client?.phone || appointment.guestPhone,
    });
  }
  if (requestedMode === MEETING_MODES.ZOOM) await assertZoomOperational(appointment.agencyId);
  if (requestedMode === MEETING_MODES.ZOOM && appointment.assignedTo?.zoomHostMapping?.status !== "active") {
    throw createHttpError(409, "Zoom is not configured for this consultant.", "ZOOM_HOST_NOT_MAPPED");
  }
  const { days, settings } = await availabilityForRange({
    agencyId: appointment.agencyId,
    assignedToId: appointment.assignedToId,
    durationMinutes: duration,
    sessionBufferMinutes: appointment.sessionType?.bufferMinutes,
    fromKey: from,
    toKey: to,
    excludeAppointmentId: appointment.id,
    locationId: requestedMode === MEETING_MODES.IN_PERSON ? String(req.query.locationId || "") || appointment.locationId : null,
    meetingMode: requestedMode,
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
    const cancelledAt = new Date();
    const cancelled = series.map((item) => ({ ...item, status: "Cancelled", cancelledAt, cancellationReason: reason }));
    await prisma.$transaction(async (tx) => {
      await tx.appointment.updateMany({ where: { id: { in: series.map((item) => item.id) }, status: "Scheduled" }, data: { status: "Cancelled", cancelledAt, cancellationReason: reason } });
      for (const item of cancelled) {
        await syncLeadConsultationFromAppointment(tx, item, { consultationStatus: "CANCELLED" });
        await sendBookingMessages({ agencyId: appointment.agencyId, appointment: item, kind: "cancelled", db: tx });
        if (item.meetingProvider === "Zoom" && item.meetingProviderId) {
          await enqueueAppointmentMeetingJob(tx, { appointment: item, action: "DELETE", providerMeetingId: item.meetingProviderId, dedupeSuffix: "guest-series-cancelled" });
        }
      }
      if (series.length) await tx.appointmentEvent.createMany({ data: series.map((item) => ({ agencyId: appointment.agencyId, appointmentId: item.id, type: "SERIES_CANCELLED", summary: "Guest cancelled appointment with recurring series", metadata: { seriesKey: appointment.seriesKey } })) });
    });
    void processBookingMessageDeliveries();
    await Promise.all(cancelled.map((item) => offerWaitlistOpening(item).catch(() => {})));
    await Promise.all(cancelled.map((item) => voidOpenPaymentHoldForAppointment(appointment.agencyId, item.id)));
    invalidateDashboardCache(appointment.agencyId);
    return res.json({ data: { ...publicView(cancelled.find((item) => item.id === appointment.id), settings), seriesAffected: series.length } });
  }
  const updated = await prisma.$transaction(async (tx) => {
    const result = await tx.appointment.update({
      where: { id: appointment.id },
      data: { status: "Cancelled", cancelledAt: new Date(), cancellationReason: String(req.body?.reason || "Cancelled by guest").trim().slice(0, 500) },
      include: { client: { select: { fullName: true, email: true, phone: true } }, assignedTo: { select: { id: true, fullName: true } }, sessionType: true, agency: { select: { name: true } } },
    });
    await syncLeadConsultationFromAppointment(tx, result, { consultationStatus: "CANCELLED" });
    await recordAppointmentEvent(tx, { agencyId: appointment.agencyId, appointmentId: appointment.id, type: "CANCELLED", summary: "Guest cancelled through the manage link", metadata: { reason: result.cancellationReason } });
    await sendBookingMessages({ agencyId: appointment.agencyId, appointment: result, kind: "cancelled", db: tx });
    if (result.meetingProvider === "Zoom" && result.meetingProviderId) {
      await enqueueAppointmentMeetingJob(tx, { appointment: result, action: "DELETE", providerMeetingId: result.meetingProviderId, dedupeSuffix: "guest-cancelled" });
    }
    return result;
  });
  await recordActivity({
    agencyId: appointment.agencyId,
    userId: null,
    clientId: appointment.clientId,
    caseId: appointment.caseId,
    action: "appointment.cancelled",
    details: `${appointment.subject} cancelled via booking link`,
  }).catch(() => {});
  void processBookingMessageDeliveries();
  await offerWaitlistOpening(updated).catch(() => {});
  await voidOpenPaymentHoldForAppointment(appointment.agencyId, appointment.id);
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
  const meetingMode = req.body?.meetingMode
    ? normalizeMeetingMode(req.body.meetingMode, appointment.meetingMode)
    : appointment.meetingMode;
  const timeChanged = startsAt.getTime() !== new Date(appointment.startsAt).getTime();
  const modeChanged = meetingMode !== appointment.meetingMode;
  const notificationKind = timeChanged ? "rescheduled" : modeChanged ? "format_updated" : "rescheduled";
  if (meetingMode !== appointment.meetingMode) {
    assertMeetingModeConfigured({
      settings,
      sessionType: appointment.sessionType,
      mode: meetingMode,
      guestPhone: appointment.client?.phone || appointment.guestPhone,
    });
  }
  if (meetingMode === MEETING_MODES.ZOOM) await assertZoomOperational(appointment.agencyId);
  if (meetingMode === MEETING_MODES.ZOOM && appointment.assignedTo?.zoomHostMapping?.status !== "active") {
    throw createHttpError(409, "Zoom is not configured for this consultant.", "ZOOM_HOST_NOT_MAPPED");
  }
  const allLocations = Array.isArray(settings?.locations) ? settings.locations : [];
  const locations = appointment.sessionType?.allowedLocationIds?.length
    ? allLocations.filter((item) => appointment.sessionType.allowedLocationIds.includes(item.id))
    : allLocations;
  let selectedLocation = null;
  if (meetingMode === MEETING_MODES.IN_PERSON) {
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
    if (meetingMode === MEETING_MODES.ZOOM) {
      const assigneeIds = [...new Set(series.map((item) => item.assignedToId).filter(Boolean))];
      const mappedCount = await prisma.zoomHostMapping.count({
        where: { agencyId: appointment.agencyId, userId: { in: assigneeIds }, status: "active" },
      });
      if (mappedCount !== assigneeIds.length) {
        throw createHttpError(409, "Zoom is not configured for every consultant in this recurring series.", "ZOOM_HOST_NOT_MAPPED");
      }
    }
    const delta = startsAt.getTime() - new Date(appointment.startsAt).getTime();
    const moves = series.map((item) => ({ item, startsAt: new Date(new Date(item.startsAt).getTime() + delta), endsAt: new Date(new Date(item.endsAt).getTime() + delta), buffer: item.sessionType?.bufferMinutes ?? item.assignedTo?.schedulingPreference?.bufferMinutes ?? settings?.bufferMinutes ?? 0 }));
    for (const move of moves) {
      const key = localDateKey(move.startsAt, settings?.timezone || "America/Toronto");
      const offered = await availabilityForRange({ agencyId: appointment.agencyId, assignedToId: move.item.assignedToId, durationMinutes: Math.round((move.endsAt - move.startsAt) / 60_000), sessionBufferMinutes: move.item.sessionType?.bufferMinutes, fromKey: key, toKey: key, excludeAppointmentIds: seriesIds, locationId: meetingMode === MEETING_MODES.IN_PERSON ? selectedLocation?.id || move.item.locationId || null : null, meetingMode });
      if (!(offered.days[key] || []).some((slot) => slot.startsAt === move.startsAt.toISOString())) throw createHttpError(409, `${key} at the recurring time is unavailable. The series was not changed.`, "SLOT_TAKEN");
    }
    const updatedSeries = await prisma.$transaction(async (tx) => {
      const results = [];
      if (meetingMode === MEETING_MODES.ZOOM) {
        await lockSchedulingTransaction(tx, appointment.agencyId, moves[0]?.startsAt || startsAt);
        await assertZoomOperational(appointment.agencyId, tx);
        const assigneeIds = [...new Set(moves.map((move) => move.item.assignedToId).filter(Boolean))];
        const mappedCount = await tx.zoomHostMapping.count({
          where: { agencyId: appointment.agencyId, userId: { in: assigneeIds }, status: "active" },
        });
        if (mappedCount !== assigneeIds.length) {
          throw createHttpError(409, "Zoom is no longer configured for every consultant in this recurring series.", "ZOOM_HOST_NOT_MAPPED");
        }
      }
      for (const move of moves) {
        await lockSchedulingTransaction(tx, appointment.agencyId, move.startsAt);
        const conflict = await assertSlotAvailable(tx, { agencyId: appointment.agencyId, assignedToId: move.item.assignedToId, startsAt: move.startsAt, endsAt: move.endsAt, bufferMinutes: move.buffer, excludeAppointmentIds: seriesIds, meetingMode });
        if (conflict) throw createHttpError(409, "A recurring time was just taken. The series was not changed.", "SLOT_TAKEN");
        const meetingFields = appointmentMeetingFields({ mode: meetingMode, settings, existing: move.item });
        const result = await tx.appointment.update({ where: { id: move.item.id }, data: { startsAt: move.startsAt, endsAt: move.endsAt, ...meetingFields, location: meetingMode === MEETING_MODES.IN_PERSON ? selectedLocation ? `${selectedLocation.name} — ${selectedLocation.address}` : move.item.location : null, locationId: meetingMode === MEETING_MODES.IN_PERSON ? selectedLocation?.id || move.item.locationId : null, locationMapsUrl: meetingMode === MEETING_MODES.IN_PERSON ? selectedLocation?.mapsUrl || move.item.locationMapsUrl : null, reminderSentAt: null, reminderDueAt: new Date(move.startsAt.getTime() - Math.max(...(Array.isArray(settings?.reminderSchedule) && settings.reminderSchedule.length ? settings.reminderSchedule : [settings?.reminderMinutes || 1440])) * 60_000), reminderQueuedAt: null }, include: { client: { select: { fullName: true, email: true, phone: true } }, assignedTo: { select: { id: true, fullName: true } }, sessionType: true, agency: { select: { name: true, legalName: true } } } });
        await syncLeadConsultationFromAppointment(tx, result, { consultationStatus: "RESCHEDULED" });
        await recordAppointmentEvent(tx, { agencyId: appointment.agencyId, appointmentId: move.item.id, type: "SERIES_RESCHEDULED", summary: "Guest moved appointment with recurring series", metadata: { from: move.item.startsAt, to: move.startsAt, seriesKey: appointment.seriesKey } });
        if (move.item.meetingProvider === "Zoom" && move.item.meetingProviderId && meetingMode !== MEETING_MODES.ZOOM) {
          await enqueueAppointmentMeetingJob(tx, { appointment: result, action: "DELETE", providerMeetingId: move.item.meetingProviderId, dedupeSuffix: "guest-series-mode-changed" });
        }
        if (meetingMode === MEETING_MODES.ZOOM) {
          await enqueueAppointmentMeetingJob(tx, { appointment: result, action: "SYNC", notifyKind: notificationKind, dedupeSuffix: "guest-series-rescheduled" });
        } else {
          await sendBookingMessages({ agencyId: appointment.agencyId, appointment: result, kind: notificationKind, db: tx });
        }
        results.push(result);
      }
      return results;
    });
    if (updatedSeries.some((item) => item.meetingMode !== MEETING_MODES.ZOOM)) void processBookingMessageDeliveries();
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
    locationId: meetingMode === MEETING_MODES.IN_PERSON ? selectedLocation?.id || appointment.locationId || null : null,
    meetingMode,
  });
  const offered = (days[dayKey] || []).some((slot) => slot.startsAt === startsAt.toISOString());
  if (!offered) throw createHttpError(409, "That time is not available. Pick another slot.", "SLOT_TAKEN");

  const updated = await prisma.$transaction(async (tx) => {
    await lockSchedulingTransaction(tx, appointment.agencyId, startsAt);
    if (meetingMode === MEETING_MODES.ZOOM) {
      await assertZoomOperational(appointment.agencyId, tx);
      const mapped = await tx.zoomHostMapping.findFirst({
        where: { agencyId: appointment.agencyId, userId: appointment.assignedToId, status: "active" },
        select: { id: true },
      });
      if (!mapped) throw createHttpError(409, "Zoom is no longer configured for this consultant.", "ZOOM_HOST_NOT_MAPPED");
    }
    const conflict = await assertSlotAvailable(tx, {
      agencyId: appointment.agencyId,
      assignedToId: appointment.assignedToId,
      startsAt,
      endsAt,
      bufferMinutes: appointment.sessionType?.bufferMinutes ?? appointment.assignedTo?.schedulingPreference?.bufferMinutes ?? settings?.bufferMinutes ?? 0,
      excludeAppointmentId: appointment.id,
      meetingMode,
    });
    if (conflict) throw createHttpError(409, "That time was just taken. Pick another slot.", "SLOT_TAKEN");
    const meetingFields = appointmentMeetingFields({ mode: meetingMode, settings, existing: appointment });
    const result = await tx.appointment.update({
      where: { id: appointment.id },
      data: {
        startsAt,
        endsAt,
        ...meetingFields,
        location: meetingMode === MEETING_MODES.IN_PERSON
          ? selectedLocation ? `${selectedLocation.name} — ${selectedLocation.address}` : appointment.location
          : null,
        locationId: meetingMode === MEETING_MODES.IN_PERSON ? selectedLocation?.id || appointment.locationId : null,
        locationMapsUrl: meetingMode === MEETING_MODES.IN_PERSON
          ? selectedLocation?.mapsUrl || (selectedLocation ? null : appointment.locationMapsUrl)
          : null,
        reminderSentAt: null,
        reminderDueAt: new Date(startsAt.getTime() - Math.max(...(Array.isArray(settings?.reminderSchedule) && settings.reminderSchedule.length ? settings.reminderSchedule : [settings?.reminderMinutes || 1440])) * 60_000),
        reminderQueuedAt: null,
      },
      include: { client: { select: { fullName: true, email: true, phone: true } }, assignedTo: { select: { id: true, fullName: true } }, sessionType: true, agency: { select: { name: true, legalName: true } } },
    });
    await syncLeadConsultationFromAppointment(tx, result, { consultationStatus: "RESCHEDULED" });
    await recordAppointmentEvent(tx, { agencyId: appointment.agencyId, appointmentId: appointment.id, type: "RESCHEDULED", summary: "Guest rescheduled through the manage link", metadata: { from: appointment.startsAt, to: startsAt, meetingMode } });
    if (appointment.meetingProvider === "Zoom" && appointment.meetingProviderId && meetingMode !== MEETING_MODES.ZOOM) {
      await enqueueAppointmentMeetingJob(tx, { appointment: result, action: "DELETE", providerMeetingId: appointment.meetingProviderId, dedupeSuffix: "guest-mode-changed" });
    }
    if (meetingMode === MEETING_MODES.ZOOM) {
      await enqueueAppointmentMeetingJob(tx, { appointment: result, action: "SYNC", notifyKind: notificationKind });
    } else {
      await sendBookingMessages({ agencyId: appointment.agencyId, appointment: result, kind: notificationKind, db: tx });
    }
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
  if (updated.meetingMode !== MEETING_MODES.ZOOM) void processBookingMessageDeliveries();
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
    await sendBookingStaffNotification({ agencyId: appointment.agencyId, appointment: result, kind: "confirmed", db: tx });
    return result;
  });
  void processBookingMessageDeliveries();
  // Best-effort, and deliberately outside the transaction above — this is a
  // separate concern (does the lead's first-consultation retainer flow
  // start) from confirming attendance, which has already succeeded by this
  // point. A failure here shouldn't turn a successful guest confirmation
  // into an error response.
  if (updated.leadId) {
    ensureRetainerClientForLead(updated).catch((error) => {
      logger.warn("lead_retainer.confirm_hook_failed", { agencyId: updated.agencyId, appointmentId: updated.id, leadId: updated.leadId, reason: error.message });
    });
  }
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
  const preferredFromKey = String(body.preferredFrom || "").slice(0, 10);
  const preferredToKey = String(body.preferredTo || "").slice(0, 10);
  const preferredRangeDays = DATE_PATTERN.test(preferredFromKey) && DATE_PATTERN.test(preferredToKey)
    ? Math.round((new Date(`${preferredToKey}T00:00:00.000Z`) - new Date(`${preferredFromKey}T00:00:00.000Z`)) / 86_400_000)
    : Number.NaN;
  if (!Number.isInteger(preferredRangeDays) || preferredRangeDays < 0 || preferredRangeDays > 90) {
    throw createHttpError(400, "Choose a valid waitlist date range up to 90 days.", "VALIDATION_ERROR");
  }
  // Waitlist preferences are calendar dates in the agency timezone, not
  // server-local timestamps. Railway runs in UTC, so parsing a timezone-
  // less browser value with `new Date()` can trim the last Toronto evening
  // from the requested range.
  const preferredFrom = localDateTimeToUtc(preferredFromKey, 0, settings.timezone);
  const preferredTo = new Date(localDateTimeToUtc(preferredToKey, 24 * 60, settings.timezone).getTime() - 1);
  const meetingMode = normalizeMeetingMode(body.meetingMode);
  const phone = normalizeBookingPhone(String(body.phone || "").trim().slice(0, 40), "Client phone number");
  assertMeetingModeConfigured({
    settings,
    sessionType,
    mode: meetingMode,
    guestPhone: phone,
  });
  if (meetingMode === MEETING_MODES.ZOOM) await assertZoomOperational(settings.agencyId);
  const location = meetingMode === MEETING_MODES.IN_PERSON
    ? resolvePublicLocation(settings, sessionType, body.locationId)
    : null;
  const preferredUserId = String(body.consultantId || "") || null;
  const eligibleStaff = await eligibleSchedulingStaff({
    agencyId: settings.agencyId,
    sessionTypeId: sessionType.id,
    publicOnly: true,
    requestedUserId: preferredUserId,
    meetingMode,
  });
  if (!eligibleStaff.length) {
    throw createHttpError(
      preferredUserId ? 400 : 409,
      preferredUserId
        ? "The selected consultant is not available for this appointment format."
        : "No scheduling staff are available for this appointment format.",
      preferredUserId ? "INVALID_ASSIGNEE" : "NO_BOOKABLE_STAFF",
    );
  }
  const result = await prisma.$transaction(async (tx) => {
    // Serialize joins per workspace so two simultaneous submissions from
    // the same person cannot create duplicate active requests.
    await lockSchedulingTransaction(tx, settings.agencyId, preferredFrom);
    const active = await tx.bookingWaitlistEntry.findFirst({
      where: {
        agencyId: settings.agencyId,
        sessionTypeId: sessionType.id,
        emailNormalized: email,
        status: { in: ["Waiting", "Offered"] },
      },
      orderBy: { createdAt: "asc" },
    });
    if (active?.status === "Offered") return { data: active, created: false };
    if (active) {
      const updated = await tx.bookingWaitlistEntry.update({
        where: { id: active.id },
        data: {
          preferredUserId,
          name,
          email,
          phone,
          meetingMode,
          locationId: location?.id || null,
          preferredFrom,
          preferredTo,
        },
      });
      return { data: updated, created: false };
    }
    const created = await tx.bookingWaitlistEntry.create({ data: {
      agencyId: settings.agencyId,
      sessionTypeId: sessionType.id,
      preferredUserId,
      name,
      email,
      emailNormalized: email,
      phone,
      meetingMode,
      locationId: location?.id || null,
      preferredFrom,
      preferredTo,
    } });
    return { data: created, created: true };
  });
  const { data } = result;
  if (result.created) {
    await notifyUsers({
      agencyId: settings.agencyId,
      recipientIds: await schedulingCoordinatorRecipientIds(settings.agencyId),
      type: "appointment.waitlist_joined",
      category: "appointments",
      title: `New appointment waitlist request: ${sessionType.name}`,
      body: `${name} · ${meetingMode === MEETING_MODES.PHONE ? "Phone" : meetingMode === MEETING_MODES.ZOOM ? "Zoom" : meetingMode === MEETING_MODES.JITSI ? "Jitsi" : "In person"} · ${preferredFrom.toLocaleDateString("en-CA", { timeZone: settings.timezone })}–${preferredTo.toLocaleDateString("en-CA", { timeZone: settings.timezone })}`,
      severity: "info",
      entityType: "booking_waitlist",
      entityId: data.id,
      actionUrl: "/app/dashboard#appointment-register-heading",
      dedupeKey: `appointment-waitlist:${data.id}:joined`,
    }).catch(() => {});
  }
  res.status(result.created ? 201 : 200).json({ data: { id: data.id, status: data.status, createdAt: data.createdAt } });
}
