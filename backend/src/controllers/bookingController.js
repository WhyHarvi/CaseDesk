import { randomUUID } from "node:crypto";
import {
  bookingTemplatePreview,
  processBookingMessageDeliveries,
  paymentHoldDeliverySummary,
  sendBookingMessages,
  sendBookingStaffNotification,
  sendBookingTemplateTest,
} from "../services/bookingNotificationService.js";
import { agencyMailConnectionStatus } from "../services/agencyMailService.js";
import prisma from "../services/prisma/client.js";
import { createHttpError } from "../utils/http.js";
import { logger } from "../services/logger.js";
import { recordActivity } from "../utils/prismaCrud.js";
import {
  assertSlotAvailable,
  availabilityForRange,
  getOrCreateBookingSettings,
  localDateKey,
  localDateTimeToUtc,
  parseSchedulingBlockDateTime,
  schedulingBlockRecurrenceDays,
  schedulingBlockRecurrenceEnd,
} from "../services/bookingAvailabilityService.js";
import { nextClientNumber } from "../services/clientNumberService.js";
import { shortenSubjectLine } from "../services/ollama.service.js";
import { lockAgencyContactIntake, normalizeContact } from "../services/contactDuplicateService.js";
import {
  chooseAppointmentAssignee,
  eligibleSchedulingStaff,
  lockSchedulingTransaction,
} from "../services/schedulingAssignmentService.js";
import { appointmentReference, recordAppointmentEvent, recurrenceStarts } from "../services/appointmentOperationsService.js";
import { offerWaitlistOpening, releaseExpiredWaitlistHolds } from "../services/bookingWaitlistService.js";
import {
  cancelPaymentHoldRequest as cancelPaymentHoldRequestService,
  createPaymentHoldForStaffBooking,
  createPaymentHoldForWalkIn,
  createPendingWalkInETransfer,
  notifyMissingAppointmentPayment,
  recordWalkInManualPayment as recordWalkInManualPaymentService,
  resendPaymentHoldRequest as resendPaymentHoldRequestService,
  resolveMissingAppointmentPaymentNotification,
  updatePaidAppointmentPaymentDetails as updatePaidAppointmentPaymentDetailsService,
  voidOpenPaymentHoldForAppointment,
} from "../services/bookingPaymentHoldService.js";
import { reconcilePaymentHold } from "../services/quickbooksWebhookService.js";
import { resolveFreeConsultationEligibility } from "../services/bookingFreeConsultationService.js";
import { invalidateDashboardCache } from "../services/dashboardCache.js";
import { submitPaymentApproval } from "../services/paymentApprovalService.js";
import { reportingBounds } from "../modules/leads/lead.metrics.js";
import { estimateRefundAfterFees, refundFeeRateForAgency } from "../services/refundFeeEstimateService.js";
import {
  MEETING_MODES,
  MEETING_MODE_VALUES,
  appointmentMeetingFields,
  assertMeetingModeConfigured,
  meetingModeEnabled,
  normalizeBookingPhone,
  normalizeMeetingMode,
} from "../services/bookingMeetingModeService.js";
import { enqueueAppointmentMeetingJob } from "../services/appointmentMeetingService.js";
import { assertZoomOperational, zoomConfigured } from "../services/zoomService.js";
import {
  leadConsultationStatusForAppointment,
  syncLeadConsultationFromAppointment,
} from "../services/leadConsultationAppointmentService.js";
import { ensureAppointmentCompletionFollowUp, requireAppointmentProfile } from "../services/appointmentProfileService.js";
import { resolveNotifications } from "../services/notificationService.js";

const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
// Staff booking internally already knows what actually happened today —
// unlike a client picking a slot on the public page, there's no reason to
// hide today's already-passed times from them. Useful for logging a
// walk-in, an earlier call, or otherwise adjusting the day's schedule to
// match reality after the fact. Was previously frontdesk-only; every
// internal role hits this same need when managing the calendar directly.
const STAFF_ROLES_SEEING_PAST_SLOTS = new Set(["admin", "consultant", "frontdesk"]);

export const APPOINTMENT_SUBJECT_MAX_WORDS = 10;
function appointmentSubjectWordCount(value) {
  return String(value || "").trim().split(/\s+/).filter(Boolean).length;
}

function requireAdmin(req) {
  if (req.auth.role !== "admin") {
    throw createHttpError(403, "Only workspace administrators can change scheduling settings.", "FORBIDDEN");
  }
}

function validWorkingHours(value) {
  if (!Array.isArray(value) || value.length > 7) throw createHttpError(400, "Working hours are invalid.", "VALIDATION_ERROR");
  return value.map((rule) => {
    const day = Number(rule.day);
    if (!Number.isInteger(day) || day < 0 || day > 6) throw createHttpError(400, "Working hours day is invalid.", "VALIDATION_ERROR");
    if (!TIME_PATTERN.test(rule.start) || !TIME_PATTERN.test(rule.end)) throw createHttpError(400, "Working hours must use HH:mm times.", "VALIDATION_ERROR");
    if (rule.start >= rule.end) throw createHttpError(400, "Working hours must end after they start.", "VALIDATION_ERROR");
    return { day, enabled: Boolean(rule.enabled), start: rule.start, end: rule.end };
  });
}

function validDaysOff(value) {
  if (!Array.isArray(value) || value.length > 366) throw createHttpError(400, "Days off are invalid.", "VALIDATION_ERROR");
  const days = value.map((item) => String(item));
  if (days.some((item) => !DATE_PATTERN.test(item))) throw createHttpError(400, "Days off must use YYYY-MM-DD dates.", "VALIDATION_ERROR");
  return [...new Set(days)].sort();
}

// google.com only isn't enough — Google routinely serves Maps links on
// regional domains (google.ca, google.co.uk, ...), and Canadian users in
// particular get google.ca by default. Anchored so "google.evil.com" or
// "notgoogle.com" still can't sneak past as a lookalike.
function isValidGoogleMapsHost(hostname) {
  const host = hostname.toLowerCase();
  if (host === "goo.gl" || host.endsWith(".goo.gl")) return true;
  return /^(maps\.|www\.)?google\.[a-z]{2,3}(\.[a-z]{2})?$/.test(host);
}

function validLocations(value) {
  if (!Array.isArray(value) || value.length > 20) throw createHttpError(400, "Locations are invalid.", "VALIDATION_ERROR");
  return value.map((item, index) => {
    const name = String(item?.name || "").trim().slice(0, 120);
    const address = String(item?.address || "").trim().slice(0, 300);
    let mapsUrl = String(item?.mapsUrl || "").trim().slice(0, 500);
    if (!name || !address) throw createHttpError(400, "Every location needs a name and address.", "VALIDATION_ERROR");
    if (mapsUrl) {
      try {
        const parsed = new URL(mapsUrl);
        if (parsed.protocol !== "https:" || !isValidGoogleMapsHost(parsed.hostname)) throw new Error("invalid map URL");
        mapsUrl = parsed.href;
      } catch {
        throw createHttpError(400, "Use a valid HTTPS Google Maps link.", "VALIDATION_ERROR");
      }
    }
    const useCustomHours = Boolean(item?.useCustomHours);
    const workingHours = useCustomHours && item?.workingHours !== undefined ? validWorkingHours(item.workingHours) : [];
    const daysOff = useCustomHours && item?.daysOff !== undefined ? validDaysOff(item.daysOff) : [];
    return { id: String(item?.id || `loc-${index + 1}-${Date.now()}`), name, address, mapsUrl: mapsUrl || null, useCustomHours, workingHours, daysOff };
  });
}

function boundedInt(value, field, minimum, maximum) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw createHttpError(400, `${field} must be between ${minimum} and ${maximum}.`, "VALIDATION_ERROR");
  }
  return parsed;
}

function validFeeAmount(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 10_000) {
    throw createHttpError(400, "Consultation fee must be between $0.01 and $10,000.", "VALIDATION_ERROR");
  }
  return parsed;
}

function validMeetingModes(value, fallback = ["InPerson", "Online"]) {
  if (value === undefined) return fallback;
  const modes = [...new Set((Array.isArray(value) ? value : []).filter((item) => MEETING_MODE_VALUES.includes(item)))];
  if (!modes.length) throw createHttpError(400, "Each session type needs at least one appointment format.", "VALIDATION_ERROR");
  return modes;
}

function sessionLocationsForIds(locations, allowedLocationIds) {
  return allowedLocationIds?.length
    ? locations.filter((location) => allowedLocationIds.includes(location.id))
    : locations;
}

function usableSessionMeetingModes(settings, modes, allowedLocationIds, locations = null) {
  const configuredLocations = Array.isArray(locations) ? locations : (Array.isArray(settings.locations) ? settings.locations : []);
  const sessionLocations = sessionLocationsForIds(configuredLocations, allowedLocationIds);
  return modes.filter((mode) =>
    (mode === MEETING_MODES.IN_PERSON && sessionLocations.length > 0)
    || (mode === MEETING_MODES.PHONE && meetingModeEnabled(settings, mode) && Boolean(settings.phoneCallerId))
    || (mode === MEETING_MODES.JITSI && meetingModeEnabled(settings, mode))
    || (mode === MEETING_MODES.ZOOM && meetingModeEnabled(settings, mode)));
}

function validSessionLocationIds(value, locations) {
  const ids = [...new Set((Array.isArray(value) ? value : []).map(String))].slice(0, 20);
  if (ids.some((id) => !locations.some((location) => location.id === id))) {
    throw createHttpError(400, "A session type contains an office location that is no longer available.", "VALIDATION_ERROR");
  }
  return ids;
}

async function assertPublicSessionTypeUsable(settings, {
  name,
  isActive,
  modes,
  allowedLocationIds,
  sessionTypeId = null,
  eligibleStaffIds = null,
}) {
  if (!settings.publicBookingEnabled || !isActive) return;
  const usable = usableSessionMeetingModes(settings, modes, allowedLocationIds);
  if (!usable.length) {
    throw createHttpError(400, `"${name}" would have no available appointment format. Enable one of its formats first.`, "MEETING_MODE_REQUIRED");
  }
  const staff = await eligibleSchedulingStaff({
    agencyId: settings.agencyId,
    sessionTypeId: eligibleStaffIds === null ? sessionTypeId : null,
    publicOnly: true,
  });
  const restrictedStaff = eligibleStaffIds?.length
    ? staff.filter((member) => eligibleStaffIds.includes(member.id))
    : staff;
  let zoomConnected = false;
  if (usable.includes(MEETING_MODES.ZOOM)) {
    const connection = await prisma.agencyZoomConnection.findUnique({
      where: { agencyId: settings.agencyId },
      select: { status: true },
    });
    zoomConnected = zoomConfigured() && connection?.status === "connected";
  }
  const hasStaffForUsableMode = usable.some((mode) =>
    restrictedStaff.some((member) =>
      mode !== MEETING_MODES.ZOOM
      || (zoomConnected && member.zoomHostMapping?.status === "active")));
  if (!hasStaffForUsableMode) {
    throw createHttpError(
      400,
      `"${name}" has no public-bookable consultant for its enabled appointment formats.`,
      "BOOKABLE_STAFF_REQUIRED",
    );
  }
}

function validReminderSchedule(value) {
  if (!Array.isArray(value) || !value.length || value.length > 6) throw createHttpError(400, "Choose between one and six reminders.", "VALIDATION_ERROR");
  return [...new Set(value.map((item) => boundedInt(item, "Reminder", 5, 10080)))].sort((a, b) => b - a);
}

function optionalTimezone(value) {
  if (value === null || value === "") return null;
  const zone = String(value).trim().slice(0, 80);
  try { new Intl.DateTimeFormat("en-CA", { timeZone: zone }).format(new Date()); }
  catch { throw createHttpError(400, "Timezone is invalid.", "VALIDATION_ERROR"); }
  return zone;
}

function optionalPublicCopy(value, field, max) {
  const normalized = String(value ?? "").trim();
  if (normalized.length > max) {
    throw createHttpError(400, `${field} must be ${max} characters or fewer.`, "VALIDATION_ERROR");
  }
  return normalized || null;
}

export async function getBookingSettings(req, res) {
  const [settings, sessionTypes, staff] = await Promise.all([
    getOrCreateBookingSettings(req.auth.agencyId),
    prisma.bookingSessionType.findMany({ where: { agencyId: req.auth.agencyId }, include: { eligibleStaff: { select: { userId: true } } }, orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] }),
    prisma.user.findMany({
      where: { agencyId: req.auth.agencyId, status: "active", role: { in: ["admin", "consultant"] } },
      select: { id: true, fullName: true, email: true, role: true, schedulingPreference: true, zoomHostMapping: { select: { status: true } } },
      orderBy: { fullName: "asc" },
    }),
  ]);
  res.json({ data: { settings, sessionTypes, staff } });
}

export async function updateBookingSettings(req, res) {
  requireAdmin(req);
  const body = req.body || {};
  const data = {
    ...(body.timezone !== undefined ? { timezone: (() => {
      const zone = String(body.timezone || "").trim().slice(0, 80);
      try { new Intl.DateTimeFormat("en-CA", { timeZone: zone }).format(new Date()); }
      catch { throw createHttpError(400, "Timezone is invalid.", "VALIDATION_ERROR"); }
      return zone;
    })() } : {}),
    ...(body.workingHours !== undefined ? { workingHours: validWorkingHours(body.workingHours) } : {}),
    ...(body.daysOff !== undefined ? { daysOff: validDaysOff(body.daysOff) } : {}),
    ...(body.bufferMinutes !== undefined ? { bufferMinutes: boundedInt(body.bufferMinutes, "Buffer", 0, 240) } : {}),
    ...(body.minNoticeMinutes !== undefined ? { minNoticeMinutes: boundedInt(body.minNoticeMinutes, "Minimum notice", 0, 20160) } : {}),
    ...(body.horizonDays !== undefined ? { horizonDays: boundedInt(body.horizonDays, "Booking horizon", 1, 365) } : {}),
    ...(body.reminderMinutes !== undefined ? { reminderMinutes: boundedInt(body.reminderMinutes, "Reminder lead time", 5, 10080) } : {}),
    ...(body.reminderSchedule !== undefined ? { reminderSchedule: validReminderSchedule(body.reminderSchedule) } : {}),
    ...(typeof body.waitlistEnabled === "boolean" ? { waitlistEnabled: body.waitlistEnabled } : {}),
    ...(typeof body.attendanceConfirmationEnabled === "boolean" ? { attendanceConfirmationEnabled: body.attendanceConfirmationEnabled } : {}),
    ...(typeof body.onlineBookingEnabled === "boolean" ? { onlineBookingEnabled: body.onlineBookingEnabled } : {}),
    ...(typeof body.phoneBookingEnabled === "boolean" ? { phoneBookingEnabled: body.phoneBookingEnabled } : {}),
    ...(body.phoneCallerId !== undefined ? { phoneCallerId: normalizeBookingPhone(body.phoneCallerId, "Outgoing caller ID") } : {}),
    ...(body.phoneCallInstructions !== undefined ? { phoneCallInstructions: optionalPublicCopy(body.phoneCallInstructions, "Phone call instructions", 500) } : {}),
    ...(typeof body.zoomBookingEnabled === "boolean" ? { zoomBookingEnabled: body.zoomBookingEnabled } : {}),
    ...(body.messageTemplates !== undefined && body.messageTemplates && typeof body.messageTemplates === "object" && !Array.isArray(body.messageTemplates) ? { messageTemplates: body.messageTemplates } : {}),
    ...(typeof body.freeConsultationsEnabled === "boolean" ? { freeConsultationsEnabled: body.freeConsultationsEnabled } : {}),
    ...(body.freeConsultationsPerContact !== undefined ? { freeConsultationsPerContact: boundedInt(body.freeConsultationsPerContact, "Free consultations per contact", 1, 20) } : {}),
    ...(body.cancellationCutoffMinutes !== undefined ? { cancellationCutoffMinutes: boundedInt(body.cancellationCutoffMinutes, "Cancellation cutoff", 0, 10080) } : {}),
    ...(body.rescheduleCutoffMinutes !== undefined ? { rescheduleCutoffMinutes: boundedInt(body.rescheduleCutoffMinutes, "Reschedule cutoff", 0, 10080) } : {}),
    ...(body.locations !== undefined ? { locations: validLocations(body.locations) } : {}),
    ...(typeof body.publicBookingEnabled === "boolean" ? { publicBookingEnabled: body.publicBookingEnabled } : {}),
    ...(typeof body.consultFeeEnabled === "boolean" ? { consultFeeEnabled: body.consultFeeEnabled } : {}),
    ...(body.consultFeeAmount !== undefined ? { consultFeeAmount: body.consultFeeAmount === null ? null : validFeeAmount(body.consultFeeAmount) } : {}),
    ...(body.consultFeeHoldMinutes !== undefined ? { consultFeeHoldMinutes: boundedInt(body.consultFeeHoldMinutes, "Payment hold window", 5, 120) } : {}),
    ...(body.consultFeeTerms !== undefined ? { consultFeeTerms: optionalPublicCopy(body.consultFeeTerms, "Payment terms", 2000) } : {}),
    ...(body.publicHeadline !== undefined ? { publicHeadline: optionalPublicCopy(body.publicHeadline, "Public headline", 140) } : {}),
    ...(body.publicWelcomeMessage !== undefined ? { publicWelcomeMessage: optionalPublicCopy(body.publicWelcomeMessage, "Welcome message", 2000) } : {}),
    ...(body.publicSignOffName !== undefined ? { publicSignOffName: optionalPublicCopy(body.publicSignOffName, "Sign-off", 160) } : {}),
  };
  const current = await getOrCreateBookingSettings(req.auth.agencyId);
  const finalLocations = data.locations !== undefined ? data.locations : (Array.isArray(current.locations) ? current.locations : []);
  const enablingPublic = data.publicBookingEnabled === true || (data.publicBookingEnabled === undefined && current.publicBookingEnabled);
  const finalPhoneEnabled = data.phoneBookingEnabled ?? current.phoneBookingEnabled;
  const finalJitsiEnabled = data.onlineBookingEnabled ?? current.onlineBookingEnabled;
  const finalZoomEnabled = data.zoomBookingEnabled ?? current.zoomBookingEnabled;
  if (enablingPublic && finalLocations.length === 0 && !finalPhoneEnabled && !finalJitsiEnabled && !finalZoomEnabled) {
    throw createHttpError(400, "Enable a remote appointment format or add an office location before activating the public booking link.", "MEETING_MODE_REQUIRED");
  }
  // Only gate the OFF -> ON transition, not every resave of an
  // already-enabled page — a live agency whose mailbox connection later
  // breaks must still be able to save unrelated settings changes. This
  // exists because an agency ran with public booking live and zero mail/SMS
  // config for 11 days, silently failing to notify 8 real clients.
  if (data.publicBookingEnabled === true && current.publicBookingEnabled !== true) {
    const mailStatus = await agencyMailConnectionStatus(req.auth.agencyId);
    if (!mailStatus.configured) {
      throw createHttpError(400, "Connect and verify a mailbox in Settings before turning on the public booking page — otherwise clients booking online won't receive a confirmation email.", "MAIL_REQUIRED");
    }
    const bookableStaff = await eligibleSchedulingStaff({ agencyId: req.auth.agencyId, publicOnly: true });
    if (!bookableStaff.length) {
      throw createHttpError(400, "Make at least one administrator or consultant public-bookable before turning on the public booking page.", "BOOKABLE_STAFF_REQUIRED");
    }
    if (finalZoomEnabled) await assertZoomOperational(req.auth.agencyId);
  }
  const enablingConsultFee = data.consultFeeEnabled === true || (data.consultFeeEnabled === undefined && current.consultFeeEnabled);
  const finalFeeAmount = data.consultFeeAmount !== undefined ? data.consultFeeAmount : current.consultFeeAmount;
  if (enablingConsultFee && !finalFeeAmount) {
    throw createHttpError(400, "Set a consultation fee amount before enabling paid bookings.", "VALIDATION_ERROR");
  }
  const activatingPaidPublicBooking = enablingConsultFee && (
    (data.consultFeeEnabled === true && current.consultFeeEnabled !== true)
    || (data.publicBookingEnabled === true && current.publicBookingEnabled !== true)
  );
  if (activatingPaidPublicBooking) {
    const quickBooks = await prisma.agencyQuickBooksSettings.findUnique({
      where: { agencyId: req.auth.agencyId },
      select: { status: true, consultFeeItemId: true },
    });
    if (quickBooks?.status !== "connected") {
      throw createHttpError(
        409,
        "Connect QuickBooks before enabling paid consultation bookings.",
        "QBO_NOT_CONNECTED",
      );
    }
    if (!quickBooks.consultFeeItemId) {
      throw createHttpError(
        409,
        "Map a QuickBooks item for consultation fees before enabling paid consultation bookings.",
        "QBO_MAPPING_REQUIRED",
      );
    }
  }
  const availabilityConfigurationChanged = Boolean(
    data.publicBookingEnabled === true
    || data.locations !== undefined
    || data.onlineBookingEnabled !== undefined
    || data.phoneBookingEnabled !== undefined
    || data.phoneCallerId !== undefined
    || data.zoomBookingEnabled !== undefined
  );
  if (enablingPublic && availabilityConfigurationChanged) {
    const finalSettings = { ...current, ...data, locations: finalLocations };
    const activeTypes = await prisma.bookingSessionType.findMany({
      where: { agencyId: req.auth.agencyId, isActive: true },
      select: {
        id: true,
        name: true,
        allowedMeetingModes: true,
        allowedLocationIds: true,
        eligibleStaff: { select: { userId: true } },
      },
    });
    const unavailableType = activeTypes.find((type) => {
      const modes = type.allowedMeetingModes?.length ? type.allowedMeetingModes : [MEETING_MODES.IN_PERSON, MEETING_MODES.JITSI];
      const availableLocations = sessionLocationsForIds(finalLocations, type.allowedLocationIds);
      return !modes.some((mode) =>
        (mode === MEETING_MODES.IN_PERSON && availableLocations.length > 0)
        || (mode === MEETING_MODES.PHONE && finalPhoneEnabled)
        || (mode === MEETING_MODES.JITSI && finalJitsiEnabled)
        || (mode === MEETING_MODES.ZOOM && finalZoomEnabled));
    });
    if (unavailableType) {
      throw createHttpError(400, `"${unavailableType.name}" would have no available appointment format. Enable one of its formats or update the session type first.`, "MEETING_MODE_REQUIRED");
    }
    for (const type of activeTypes) {
      await assertPublicSessionTypeUsable(finalSettings, {
        name: type.name,
        isActive: true,
        modes: type.allowedMeetingModes?.length ? type.allowedMeetingModes : [MEETING_MODES.IN_PERSON, MEETING_MODES.JITSI],
        allowedLocationIds: type.allowedLocationIds,
        sessionTypeId: type.id,
        eligibleStaffIds: type.eligibleStaff.map((item) => item.userId),
      });
    }
  }
  if (finalPhoneEnabled && !(data.phoneCallerId ?? current.phoneCallerId)) {
    throw createHttpError(400, "Set the outgoing caller ID before enabling phone appointments.", "PHONE_NOT_CONFIGURED");
  }
  // Verify the live OAuth connection only on the OFF -> ON transition.
  // If Zoom later expires, administrators must still be able to save
  // unrelated scheduling changes or turn Zoom off; public endpoints hide
  // the format until it is reconnected.
  const enablingZoom = data.zoomBookingEnabled === true && current.zoomBookingEnabled !== true;
  if (enablingZoom) {
    if (!zoomConfigured()) {
      throw createHttpError(
        503,
        "Configure the Zoom OAuth credentials, redirect URI, and webhook secret on the server before enabling Zoom bookings.",
        "ZOOM_NOT_CONFIGURED",
      );
    }
    const [connection, zoomStaff] = await Promise.all([
      prisma.agencyZoomConnection.findUnique({ where: { agencyId: req.auth.agencyId }, select: { status: true } }),
      eligibleSchedulingStaff({
        agencyId: req.auth.agencyId,
        publicOnly: true,
        meetingMode: MEETING_MODES.ZOOM,
      }),
    ]);
    if (connection?.status !== "connected") throw createHttpError(409, "Connect Zoom before enabling Zoom bookings.", "ZOOM_NOT_CONNECTED");
    if (!zoomStaff.length) throw createHttpError(409, "Map at least one public-bookable consultant to a Zoom host before enabling Zoom bookings.", "ZOOM_HOST_REQUIRED");
  }
  const settings = data.reminderMinutes === undefined
    ? await prisma.bookingSettings.update({ where: { agencyId: req.auth.agencyId }, data })
    : await prisma.$transaction(async (tx) => {
      const updated = await tx.bookingSettings.update({ where: { agencyId: req.auth.agencyId }, data });
      await tx.$executeRaw`UPDATE appointments SET reminder_due_at = starts_at - make_interval(mins => ${data.reminderMinutes}::int) WHERE agency_id = ${req.auth.agencyId} AND status = 'Scheduled' AND starts_at > NOW() AND reminder_queued_at IS NULL`;
      return updated;
    });
  res.json({ data: settings });
}

export async function createSessionType(req, res) {
  requireAdmin(req);
  const name = String(req.body?.name || "").trim();
  if (!name || name.length > 120) throw createHttpError(400, "Session name is required (120 characters max).", "VALIDATION_ERROR");
  const settings = await getOrCreateBookingSettings(req.auth.agencyId);
  const allowedMeetingModes = validMeetingModes(req.body?.allowedMeetingModes);
  await assertPublicSessionTypeUsable(settings, {
    name,
    isActive: true,
    modes: allowedMeetingModes,
    allowedLocationIds: [],
  });
  const data = await prisma.bookingSessionType.create({
    data: {
      agencyId: req.auth.agencyId,
      name,
      durationMinutes: boundedInt(req.body?.durationMinutes, "Duration", 5, 480),
      description: String(req.body?.description || "").trim().slice(0, 500) || null,
      sortOrder: Number.isInteger(Number(req.body?.sortOrder)) ? Number(req.body.sortOrder) : 0,
      allowedMeetingModes,
      bufferMinutes: req.body?.bufferMinutes == null || req.body?.bufferMinutes === "" ? null : boundedInt(req.body.bufferMinutes, "Session buffer", 0, 240),
      preparationInstructions: String(req.body?.preparationInstructions || "").trim().slice(0, 2000) || null,
      preparationChecklist: Array.isArray(req.body?.preparationChecklist) ? req.body.preparationChecklist.map((item) => String(item).trim().slice(0, 180)).filter(Boolean).slice(0, 20) : [],
      parkingInstructions: String(req.body?.parkingInstructions || "").trim().slice(0, 1000) || null,
    },
  });
  res.status(201).json({ data });
}

export async function updateSessionType(req, res) {
  requireAdmin(req);
  const [existing, settings] = await Promise.all([
    prisma.bookingSessionType.findFirst({ where: { id: req.params.id, agencyId: req.auth.agencyId } }),
    getOrCreateBookingSettings(req.auth.agencyId),
  ]);
  if (!existing) throw createHttpError(404, "Session type not found.", "NOT_FOUND");
  const body = req.body || {};
  const locations = Array.isArray(settings.locations) ? settings.locations : [];
  const allowedMeetingModes = body.allowedMeetingModes === undefined
    ? existing.allowedMeetingModes
    : validMeetingModes(body.allowedMeetingModes);
  const allowedLocationIds = body.allowedLocationIds === undefined
    ? existing.allowedLocationIds
    : validSessionLocationIds(body.allowedLocationIds, locations);
  const nextName = body.name === undefined ? existing.name : String(body.name).trim().slice(0, 120) || existing.name;
  const nextActive = typeof body.isActive === "boolean" ? body.isActive : existing.isActive;
  const eligibleStaffIds = Array.isArray(body.eligibleStaffIds) ? [...new Set(body.eligibleStaffIds.map(String))] : null;
  if (eligibleStaffIds) {
    const validCount = await prisma.user.count({ where: { id: { in: eligibleStaffIds }, agencyId: req.auth.agencyId, status: "active", role: { in: ["admin", "consultant"] } } });
    if (validCount !== eligibleStaffIds.length) throw createHttpError(400, "Session eligibility contains an invalid team member.", "VALIDATION_ERROR");
  }
  await assertPublicSessionTypeUsable(settings, {
    name: nextName,
    isActive: nextActive,
    modes: allowedMeetingModes,
    allowedLocationIds,
    sessionTypeId: existing.id,
    eligibleStaffIds,
  });
  const data = await prisma.$transaction(async (tx) => {
    const updated = await tx.bookingSessionType.update({
      where: { id: existing.id },
      data: {
      ...(body.name !== undefined ? { name: nextName } : {}),
      ...(body.durationMinutes !== undefined ? { durationMinutes: boundedInt(body.durationMinutes, "Duration", 5, 480) } : {}),
      ...(body.description !== undefined ? { description: String(body.description || "").trim().slice(0, 500) || null } : {}),
      ...(typeof body.isActive === "boolean" ? { isActive: body.isActive } : {}),
      ...(body.sortOrder !== undefined ? { sortOrder: Number(body.sortOrder) || 0 } : {}),
      ...(body.allowedMeetingModes !== undefined ? { allowedMeetingModes } : {}),
      ...(body.allowedLocationIds !== undefined ? { allowedLocationIds } : {}),
      ...(body.bufferMinutes !== undefined ? { bufferMinutes: body.bufferMinutes == null || body.bufferMinutes === "" ? null : boundedInt(body.bufferMinutes, "Session buffer", 0, 240) } : {}),
      ...(body.preparationInstructions !== undefined ? { preparationInstructions: String(body.preparationInstructions || "").trim().slice(0, 2000) || null } : {}),
      ...(body.preparationChecklist !== undefined ? { preparationChecklist: Array.isArray(body.preparationChecklist) ? body.preparationChecklist.map((item) => String(item).trim().slice(0, 180)).filter(Boolean).slice(0, 20) : [] } : {}),
      ...(body.parkingInstructions !== undefined ? { parkingInstructions: String(body.parkingInstructions || "").trim().slice(0, 1000) || null } : {}),
      },
    });
    if (eligibleStaffIds) {
      await tx.bookingSessionTypeStaff.deleteMany({ where: { sessionTypeId: existing.id } });
      if (eligibleStaffIds.length) await tx.bookingSessionTypeStaff.createMany({ data: eligibleStaffIds.map((userId) => ({ agencyId: req.auth.agencyId, sessionTypeId: existing.id, userId })) });
    }
    return tx.bookingSessionType.findUnique({ where: { id: updated.id }, include: { eligibleStaff: { select: { userId: true } } } });
  });
  res.json({ data });
}

export async function deleteSessionType(req, res) {
  requireAdmin(req);
  const existing = await prisma.bookingSessionType.findFirst({
    where: { id: req.params.id, agencyId: req.auth.agencyId },
    include: { _count: { select: { appointments: true } } },
  });
  if (!existing) throw createHttpError(404, "Session type not found.", "NOT_FOUND");
  if (existing._count.appointments > 0) {
    const data = await prisma.bookingSessionType.update({ where: { id: existing.id }, data: { isActive: false } });
    return res.json({ data, meta: { deactivated: true } });
  }
  await prisma.bookingSessionType.delete({ where: { id: existing.id } });
  res.json({ data: { id: existing.id }, meta: { deleted: true } });
}

export async function getAvailability(req, res) {
  const durationMinutes = boundedInt(req.query.durationMinutes || 30, "Duration", 5, 480);
  const from = String(req.query.from || "");
  const to = String(req.query.to || from);
  if (!DATE_PATTERN.test(from) || !DATE_PATTERN.test(to)) {
    throw createHttpError(400, "from/to must be YYYY-MM-DD dates.", "VALIDATION_ERROR");
  }
  const assignedToId = req.auth.role === "consultant" ? req.auth.userId : String(req.query.assignedToId || "") || null;
  const meetingMode = normalizeMeetingMode(req.query.meetingMode);
  if (meetingMode === MEETING_MODES.ZOOM) {
    await assertZoomOperational(req.auth.agencyId);
  }
  if (meetingMode === MEETING_MODES.ZOOM && assignedToId) {
    const mapped = await prisma.zoomHostMapping.findFirst({
      where: { agencyId: req.auth.agencyId, userId: assignedToId, status: "active" },
      select: { id: true },
    });
    if (!mapped) throw createHttpError(409, "Zoom is not configured for this consultant.", "ZOOM_HOST_NOT_MAPPED");
  }
  const staff = assignedToId ? [] : await eligibleSchedulingStaff({ agencyId: req.auth.agencyId, sessionTypeId: String(req.query.sessionTypeId || "") || null, meetingMode });
  const { days, settings } = await availabilityForRange({
    agencyId: req.auth.agencyId,
    assignedToId,
    assignedToIds: assignedToId ? null : staff.map((item) => item.id),
    durationMinutes,
    sessionBufferMinutes: req.query.sessionTypeId ? (await prisma.bookingSessionType.findFirst({ where: { id: String(req.query.sessionTypeId), agencyId: req.auth.agencyId }, select: { bufferMinutes: true } }))?.bufferMinutes ?? undefined : undefined,
    fromKey: from,
    toKey: to,
    minNoticeOverrideMinutes: 0,
    locationId: meetingMode === MEETING_MODES.IN_PERSON ? String(req.query.locationId || "") || null : null,
    meetingMode,
    ignorePastCutoff: STAFF_ROLES_SEEING_PAST_SLOTS.has(req.auth.role), ignoreLocationClosure: STAFF_ROLES_SEEING_PAST_SLOTS.has(req.auth.role),
  });
  res.json({ data: { days, timezone: settings.timezone } });
}

const calendarInclude = {
  client: { select: { id: true, fullName: true } },
  case: { select: { id: true, caseType: true } },
  assignedTo: { select: { id: true, fullName: true, zoomHostMapping: { select: { status: true } } } },
  sessionType: { select: { id: true, name: true, durationMinutes: true, allowedMeetingModes: true } },
  paymentHold: {
    select: {
      id: true,
      status: true,
      amount: true,
      qbInvoiceNumber: true,
      qbInvoiceLink: true,
      paidAt: true,
      expiresAt: true,
      paymentMethod: true,
      manualPaymentReference: true,
      paymentError: true,
    },
  },
  paymentApprovals: {
    where: { status: { in: ["Pending", "Processing", "Failed"] } },
    select: { id: true, status: true, method: true, amount: true, transactionReference: true, processingError: true },
    orderBy: { createdAt: "desc" },
    take: 1,
  },
};

export async function listCalendarAppointments(req, res) {
  const from = new Date(String(req.query.from || ""));
  const to = new Date(String(req.query.to || ""));
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || to <= from) {
    throw createHttpError(400, "A valid from/to range is required.", "VALIDATION_ERROR");
  }
  if (to.getTime() - from.getTime() > 93 * 24 * 60 * 60_000) {
    throw createHttpError(400, "Range cannot exceed 93 days.", "VALIDATION_ERROR");
  }
  const data = await prisma.appointment.findMany({
    where: {
      agencyId: req.auth.agencyId,
      startsAt: { lt: to },
      endsAt: { gt: from },
      ...(req.auth.role === "consultant" ? { assignedToId: req.auth.userId } : {}),
    },
    include: { ...calendarInclude, client: { select: { id: true, fullName: true, email: true, phone: true } } },
    orderBy: { startsAt: "asc" },
  });
  const unlinkedContacts = data
    .filter((item) => !item.clientId && (item.guestEmail || item.guestPhone))
    .map((item) => ({ appointmentId: item.id, ...normalizeContact({ email: item.guestEmail, phone: item.guestPhone }) }));
  const contactWhere = [
    ...new Set(unlinkedContacts.map((item) => item.emailNormalized).filter(Boolean)),
  ].map((emailNormalized) => ({ emailNormalized }));
  contactWhere.push(...[
    ...new Set(unlinkedContacts.map((item) => item.phoneNormalized).filter(Boolean)),
  ].map((phoneNormalized) => ({ phoneNormalized })));
  const matchingClients = contactWhere.length ? await prisma.client.findMany({
    where: { agencyId: req.auth.agencyId, OR: contactWhere },
    select: { id: true, fullName: true, email: true, phone: true, emailNormalized: true, phoneNormalized: true },
  }) : [];
  const contactByAppointment = new Map(unlinkedContacts.map((item) => [item.appointmentId, item]));
  res.json({
    data: data.map((item) => {
      if (item.clientId) return item;
      const contact = contactByAppointment.get(item.id);
      const candidates = matchingClients.filter((client) =>
        (contact?.emailNormalized && client.emailNormalized === contact.emailNormalized)
        || (contact?.phoneNormalized && client.phoneNormalized === contact.phoneNormalized));
      const matchedClient = candidates.length === 1 ? candidates[0] : null;
      if (!matchedClient) return item;
      const { emailNormalized: _emailNormalized, phoneNormalized: _phoneNormalized, ...safeClient } = matchedClient;
      return { ...item, matchedClient: safeClient };
    }),
  });
}

export async function createBookingAppointment(req, res) {
  const body = req.body || {};
  const idempotencyKey = String(body.idempotencyKey || "").trim().replace(/[^a-zA-Z0-9:_-]/g, "").slice(0, 180) || null;
  const startsAt = new Date(String(body.startsAt || ""));
  if (Number.isNaN(startsAt.getTime())) throw createHttpError(400, "A valid start time is required.", "VALIDATION_ERROR");

  const settings = await getOrCreateBookingSettings(req.auth.agencyId);
  let durationMinutes = Number(body.durationMinutes);
  let sessionType = null;
  if (body.sessionTypeId) {
    sessionType = await prisma.bookingSessionType.findFirst({ where: { id: body.sessionTypeId, agencyId: req.auth.agencyId } });
    if (!sessionType) throw createHttpError(400, "Session type was not found.", "VALIDATION_ERROR");
    durationMinutes = sessionType.durationMinutes;
  }
  if (!Number.isInteger(durationMinutes) || durationMinutes < 5 || durationMinutes > 480) {
    throw createHttpError(400, "Choose a session type or a duration between 5 and 480 minutes.", "VALIDATION_ERROR");
  }
  const endsAt = new Date(startsAt.getTime() + durationMinutes * 60_000);
  const startDates = recurrenceStarts(startsAt, body.recurrence);
  if (startDates.length > 1 && !["DAILY", "WEEKLY", "MONTHLY"].includes(String(body.recurrence?.frequency))) {
    throw createHttpError(400, "Choose a valid recurrence.", "VALIDATION_ERROR");
  }
  const requestedMeetingMode = normalizeMeetingMode(body.meetingMode);

  const locations = Array.isArray(settings.locations) ? settings.locations : [];
  const selectedLocation = requestedMeetingMode === MEETING_MODES.IN_PERSON
    ? locations.find((item) => item.id === String(body.locationId || "")) || (locations.length === 1 ? locations[0] : null)
    : null;
  if (requestedMeetingMode === MEETING_MODES.IN_PERSON && locations.length && !selectedLocation) throw createHttpError(400, "Choose an office location.", "VALIDATION_ERROR");

  let assignedToId = String(body.assignedToId || "") || null;
  if (req.auth.role === "consultant") assignedToId = req.auth.userId;

  let client = null;
  if (body.clientId) {
    client = await prisma.client.findFirst({ where: { id: body.clientId, agencyId: req.auth.agencyId }, select: { id: true, fullName: true, assignedUserId: true, email: true, phone: true } });
    if (!client) throw createHttpError(400, "Client was not found.", "VALIDATION_ERROR");
  }
  const guestName = String(body.guestName || "").trim().slice(0, 160) || null;
  if (!client && !guestName) throw createHttpError(400, "Pick a client or enter the visitor’s name.", "VALIDATION_ERROR");
  if (!client && !String(body.guestEmail || "").trim() && !String(body.guestPhone || "").trim()) {
    throw createHttpError(400, "Enter the visitor’s email or phone number.", "VALIDATION_ERROR");
  }

  // Never leave a walk-in as a disconnected guest when their contact info
  // already matches a real Client — best-effort only: guest phone/email are
  // free text with no format validation upstream of this call, and
  // normalizeContact() throws on anything that doesn't parse, which must
  // never fail the booking itself. Ambiguous (2+) matches are deliberately
  // left unlinked, same as convertAppointmentToClient's own semantics —
  // resolvable later by staff rather than guessed here.
  if (!client && guestName) {
    try {
      const contact = normalizeContact({ phone: body.guestPhone, email: body.guestEmail });
      const contactOr = [
        contact.emailNormalized ? { emailNormalized: contact.emailNormalized } : null,
        contact.phoneNormalized ? { phoneNormalized: contact.phoneNormalized } : null,
      ].filter(Boolean);
      if (contactOr.length) {
        const matches = await prisma.client.findMany({
          where: { agencyId: req.auth.agencyId, OR: contactOr },
          select: { id: true, fullName: true, assignedUserId: true, email: true, phone: true },
          take: 2,
        });
        if (matches.length === 1) client = matches[0];
      }
    } catch (error) {
      logger.warn("booking.guest_duplicate_lookup_skipped", { agencyId: req.auth.agencyId, reason: error.message });
    }
  }
  const guestEmailNormalized = String(body.guestEmail || "").trim().toLowerCase().slice(0, 254) || null;
  // Staff can always complete the booking even past the free-consultation
  // cutoff — unlike the public page, this never blocks; it only decides
  // whether the appointment is flagged free or billable.
  const freeEligibility = await resolveFreeConsultationEligibility(req.auth.agencyId, settings, {
    clientId: client?.id || null,
    guestEmailNormalized: client ? client.email?.toLowerCase() || null : guestEmailNormalized,
    durationMinutes,
  });
  assertMeetingModeConfigured({
    settings,
    sessionType,
    mode: requestedMeetingMode,
    guestPhone: client?.phone || body.guestPhone,
  });
  if (requestedMeetingMode === MEETING_MODES.ZOOM) await assertZoomOperational(req.auth.agencyId);

  const trimmedSubject = String(body.subject || "").trim();
  if (!trimmedSubject) throw createHttpError(400, "Add a subject for this appointment.", "SUBJECT_REQUIRED");
  const subjectWords = appointmentSubjectWordCount(trimmedSubject);
  if (subjectWords > APPOINTMENT_SUBJECT_MAX_WORDS) {
    throw createHttpError(400, `Keep the subject to ${APPOINTMENT_SUBJECT_MAX_WORDS} words or fewer (currently ${subjectWords}).`, "SUBJECT_TOO_LONG");
  }
  const subject = trimmedSubject.slice(0, 200);
  const effectiveBuffer = sessionType?.bufferMinutes ?? settings.bufferMinutes;
  const paymentMethod = ["Card", "Cash", "ETransfer", "Cheque", "Wire", "Debit", "BankDraft"].includes(String(body.paymentMethod || "")) ? String(body.paymentMethod) : null;
  const feeApplies = !freeEligibility.eligible && Number(settings.consultFeeAmount) > 0;
  const paymentReference = String(body.paymentReference || "").trim().slice(0, 100) || null;
  const [existingRequestAppointment, existingRequestHold] = idempotencyKey
    ? await Promise.all([
        prisma.appointment.findUnique({
          where: { agencyId_idempotencyKey: { agencyId: req.auth.agencyId, idempotencyKey } },
          include: { ...calendarInclude, client: { select: { id: true, fullName: true, email: true, phone: true } } },
        }),
        prisma.bookingPaymentHold.findUnique({
          where: { agencyId_idempotencyKey: { agencyId: req.auth.agencyId, idempotencyKey } },
        }),
      ])
    : [null, null];
  const pool = assignedToId ? null : await eligibleSchedulingStaff({ agencyId: req.auth.agencyId, sessionTypeId: sessionType?.id || null, meetingMode: requestedMeetingMode });
  for (const occurrenceStart of existingRequestAppointment || existingRequestHold ? [] : startDates) {
    const dayKey = localDateKey(occurrenceStart, settings.timezone);
    const offeredAvailability = await availabilityForRange({
      agencyId: req.auth.agencyId,
      assignedToId,
      assignedToIds: assignedToId ? null : pool.map((item) => item.id),
      durationMinutes,
      sessionBufferMinutes: effectiveBuffer,
      fromKey: dayKey,
      toKey: dayKey,
      minNoticeOverrideMinutes: 0,
      locationId: requestedMeetingMode === MEETING_MODES.IN_PERSON ? selectedLocation?.id || null : null,
      meetingMode: requestedMeetingMode,
      ignorePastCutoff: STAFF_ROLES_SEEING_PAST_SLOTS.has(req.auth.role), ignoreLocationClosure: STAFF_ROLES_SEEING_PAST_SLOTS.has(req.auth.role),
    });
    if (!(offeredAvailability.days[dayKey] || []).some((slot) => slot.startsAt === occurrenceStart.toISOString())) {
      throw createHttpError(409, `${dayKey} at the selected time is unavailable. No appointments were created.`, "SLOT_TAKEN");
    }
  }

  // Card payment reserves the slot and waits for QuickBooks to confirm the
  // charge before it becomes a real appointment (mirrors the public booking
  // page). Cash/e-transfer/free walk-ins still book immediately below —
  // staff already know the fee is settled or will be collected in person,
  // so there's nothing to wait on.
  if (paymentMethod === "Card" && feeApplies) {
    if (startDates.length > 1) {
      throw createHttpError(400, "Card payment isn't available for recurring appointments yet — choose an offline payment method or skip payment for now.", "VALIDATION_ERROR");
    }
    const submittedEmail = String(body.guestEmail || "").trim().toLowerCase().slice(0, 254);
    const submittedPhone = String(body.guestPhone || "").trim().slice(0, 40) || null;
    // In guest mode, use exactly what front desk just confirmed instead of
    // silently replacing it with a possibly stale email from an auto-matched
    // client profile. Existing-client mode has no submitted guest contact and
    // therefore correctly falls back to the profile.
    const holdEmail = body.source === "WalkIn" && submittedEmail ? submittedEmail : client?.email || submittedEmail;
    const holdPhone = body.source === "WalkIn" && submittedPhone ? submittedPhone : client?.phone || submittedPhone;
    if (!holdEmail && !holdPhone) throw createHttpError(400, "An email address or phone number is required to send the card payment link.", "VALIDATION_ERROR");
    if (holdEmail && !/^\S+@\S+\.\S+$/.test(holdEmail)) throw createHttpError(400, "Enter a valid email address for the card payment link.", "VALIDATION_ERROR");
    const hold = await createPaymentHoldForStaffBooking(req.auth.agencyId, {
      sessionTypeId: sessionType?.id || null,
      sessionTypeName: sessionType?.name || null,
      subject,
      startsAt,
      endsAt,
      requestedUserId: assignedToId,
      meetingMode: requestedMeetingMode,
      settings,
      location: requestedMeetingMode === MEETING_MODES.IN_PERSON ? selectedLocation : null,
      clientId: client?.id || null,
      name: client?.fullName || guestName,
      email: holdEmail,
      phone: holdPhone,
      notes: String(body.description || "").trim().slice(0, 2000) || null,
      amount: Number(settings.consultFeeAmount),
      bufferMinutes: effectiveBuffer,
      actorUserId: req.auth.userId,
      idempotencyKey,
    });
    res.status(202).json({
      data: {
        pending: true,
        holdId: hold.id,
        status: hold.status,
        amount: hold.amount,
        invoiceNumber: hold.qbInvoiceNumber,
        payNowUrl: hold.qbInvoiceLink,
        expiresAt: hold.expiresAt,
        guestName: hold.guestName,
        guestEmail: hold.guestEmail,
        guestPhone: hold.guestPhone,
        startsAt: hold.startsAt,
        endsAt: hold.endsAt,
        delivery: await paymentHoldDeliverySummary(hold.id),
      },
    });
    return;
  }

  const requestedSeriesKey = startDates.length > 1 ? randomUUID() : null;
  let createdAppointments;
  let createdNewCount = 0;
  if (existingRequestAppointment) {
    createdAppointments = existingRequestAppointment.seriesKey
      ? await prisma.appointment.findMany({
          where: { agencyId: req.auth.agencyId, seriesKey: existingRequestAppointment.seriesKey },
          include: { ...calendarInclude, client: { select: { id: true, fullName: true, email: true, phone: true } } },
          orderBy: { recurrenceIndex: "asc" },
        })
      : [existingRequestAppointment];
  } else {
    const creation = await prisma.$transaction(async (tx) => {
      const created = [];
      let newCount = 0;
      for (const [index, occurrenceStart] of startDates.entries()) {
      const occurrenceEnd = new Date(occurrenceStart.getTime() + durationMinutes * 60_000);
      const occurrenceIdempotencyKey = idempotencyKey ? (index === 0 ? idempotencyKey : `${idempotencyKey}:${index + 1}`.slice(0, 200)) : null;
      await lockSchedulingTransaction(tx, req.auth.agencyId, occurrenceStart);
      if (occurrenceIdempotencyKey) {
        const existing = await tx.appointment.findUnique({
          where: { agencyId_idempotencyKey: { agencyId: req.auth.agencyId, idempotencyKey: occurrenceIdempotencyKey } },
          include: { ...calendarInclude, client: { select: { id: true, fullName: true, email: true, phone: true } } },
        });
        if (existing) {
          created.push(existing);
          continue;
        }
      }
      const assignee = await chooseAppointmentAssignee({
        agencyId: req.auth.agencyId,
        sessionTypeId: sessionType?.id || null,
        startsAt: occurrenceStart,
        endsAt: occurrenceEnd,
        requestedUserId: assignedToId,
        preferredUserId: client?.assignedUserId,
        bufferMinutes: settings.bufferMinutes,
        sessionBufferMinutes: sessionType?.bufferMinutes,
        meetingMode: requestedMeetingMode,
        timezone: settings.timezone,
        db: tx,
      });
      const assignmentBuffer = sessionType?.bufferMinutes ?? assignee.schedulingPreference?.bufferMinutes ?? settings.bufferMinutes;
      const conflict = await assertSlotAvailable(tx, {
        agencyId: req.auth.agencyId,
        assignedToId: assignee.id,
        startsAt: occurrenceStart,
        endsAt: occurrenceEnd,
        bufferMinutes: assignmentBuffer,
        meetingMode: requestedMeetingMode,
      });
      if (conflict) throw createHttpError(409, "One of those times was just taken. No appointments were created.", "SLOT_TAKEN");
      const meetingFields = appointmentMeetingFields({ mode: requestedMeetingMode, settings });
      const appointment = await tx.appointment.create({
        data: {
        agencyId: req.auth.agencyId,
        clientId: client?.id || null,
        caseId: null,
        sessionTypeId: sessionType?.id || null,
        subject,
        location: requestedMeetingMode === MEETING_MODES.IN_PERSON
          ? selectedLocation ? `${selectedLocation.name} — ${selectedLocation.address}` : String(body.location || "").trim().slice(0, 200) || null
          : null,
        locationId: selectedLocation?.id || null,
        locationMapsUrl: selectedLocation?.mapsUrl || null,
        calendar: "Workspace Calendar",
        startsAt: occurrenceStart,
        endsAt: occurrenceEnd,
        description: String(body.description || "").trim().slice(0, 2000) || null,
        purpose: String(body.description || "").trim().slice(0, 2000) || null,
        guestName,
        guestEmail: String(body.guestEmail || "").trim().slice(0, 254) || null,
        guestEmailNormalized,
        guestPhone: String(body.guestPhone || "").trim().slice(0, 40) || null,
        ...meetingFields,
        assignedToId: assignee.id,
        createdById: req.auth.userId,
        source: body.source === "WalkIn" ? "WalkIn" : "Internal",
        isFreeConsultation: freeEligibility.eligible,
        idempotencyKey: occurrenceIdempotencyKey,
        reminderDueAt: new Date(occurrenceStart.getTime() - Math.max(...(Array.isArray(settings.reminderSchedule) && settings.reminderSchedule.length ? settings.reminderSchedule : [settings.reminderMinutes])) * 60_000),
        referenceCode: appointmentReference(),
        seriesKey: requestedSeriesKey,
        recurrenceIndex: requestedSeriesKey ? index + 1 : null,
        recurrenceCount: requestedSeriesKey ? startDates.length : null,
        status: "Scheduled",
      },
      include: { ...calendarInclude, client: { select: { id: true, fullName: true, email: true, phone: true } } },
      });
      await recordAppointmentEvent(tx, { agencyId: req.auth.agencyId, appointmentId: appointment.id, actorUserId: req.auth.userId, type: "BOOKED", summary: requestedSeriesKey ? `Recurring appointment ${index + 1} of ${startDates.length} created` : "Appointment created", metadata: { source: appointment.source } });
      if (requestedMeetingMode === MEETING_MODES.ZOOM) {
        await enqueueAppointmentMeetingJob(tx, {
          appointment,
          action: "SYNC",
          notifyKind: "booked",
          actorUserId: req.auth.userId,
          dedupeSuffix: requestedSeriesKey ? `series-${index + 1}` : "",
        });
      } else {
        await sendBookingMessages({
          agencyId: req.auth.agencyId,
          appointment,
          kind: "booked",
          actorUserId: req.auth.userId,
          dedupeSuffix: requestedSeriesKey ? `series-${index + 1}` : "",
          db: tx,
        });
      }
      created.push(appointment);
      newCount += 1;
      }
      return { appointments: created, newCount };
    });
    createdAppointments = creation.appointments;
    createdNewCount = creation.newCount;
  }
  const data = createdAppointments[0];
  const seriesKey = data?.seriesKey || requestedSeriesKey;

  if (createdNewCount && createdAppointments.some((appointment) => appointment.meetingMode !== MEETING_MODES.ZOOM)) void processBookingMessageDeliveries();

  if (createdNewCount) {
    await recordActivity({
      agencyId: req.auth.agencyId,
      userId: req.auth.userId,
      clientId: client?.id || null,
      caseId: null,
      action: "appointment.booked",
      details: `${subject} booked for ${client?.fullName || guestName} on ${localDateKey(startsAt, settings.timezone)}${startDates.length > 1 ? ` (${startDates.length} recurring appointments)` : ""}`,
    });
    invalidateDashboardCache(req.auth.agencyId);
  }

  // Only the first occurrence of a recurring series gets the consultation
  // fee recorded — a consult fee belongs to the initial visit, not every
  // future occurrence in the series.
  let manualPaymentWarning = null;
  let manualPaymentHold = data.paymentHold?.status === "Paid" ? data.paymentHold : null;
  let manualPaymentApproval = null;
  if (createdNewCount && feeApplies && !paymentMethod) {
    manualPaymentWarning = "The appointment was booked without payment and will remain flagged until its consultation payment is recorded.";
    await notifyMissingAppointmentPayment(req.auth.agencyId, data, req.auth.userId).catch((error) => {
      logger.warn("booking.missing_payment_notification_failed", {
        agencyId: req.auth.agencyId,
        appointmentId: data.id,
        reason: error.message,
      });
    });
  }
  if (paymentMethod && paymentMethod !== "Card" && feeApplies) {
    try {
      if (manualPaymentHold) {
        // A transport retry after the original request succeeded must return
        // the paid appointment, not attempt to charge it a second time.
      } else if (req.auth.role === "frontdesk" && paymentMethod === "Cash") {
        manualPaymentApproval = await submitPaymentApproval(req.auth.agencyId, {
          entryType: "appointment_payment",
          appointmentId: data.id,
          method: paymentMethod,
          amount: Number(settings.consultFeeAmount),
          transactionReference: paymentReference,
          paymentDate: new Date().toISOString().slice(0, 10),
          actorUserId: req.auth.userId,
          sourceRole: req.auth.role,
          idempotencyKey: `booking-create:${data.id}`,
        });
        manualPaymentWarning = "The appointment is booked. The payment is waiting for administrator approval before it is finalized.";
      } else {
      manualPaymentHold = paymentMethod === "ETransfer" && !paymentReference
        ? await createPendingWalkInETransfer(req.auth.agencyId, {
            appointmentId: data.id,
            actorUserId: req.auth.userId,
          })
        : await recordWalkInManualPaymentService(req.auth.agencyId, {
            appointmentId: data.id,
            method: paymentMethod,
            transactionReference: paymentReference,
            note: null,
            actorUserId: req.auth.userId,
            actorRole: req.auth.role,
          });
      }
      if (manualPaymentHold?.status === "PaymentFailed") {
        manualPaymentWarning = "The appointment was booked and the e-transfer is still flagged as pending, but its QuickBooks invoice needs attention.";
      }
    } catch (error) {
      manualPaymentWarning = error.message || "Could not record the payment automatically.";
      manualPaymentHold = await prisma.bookingPaymentHold.findUnique({
        where: { appointmentId: data.id },
      }).catch(() => null);
    }
  }

  res.status(201).json({
    data: {
      ...data,
      ...(manualPaymentHold ? {
        paymentHold: {
          id: manualPaymentHold.id,
          status: manualPaymentHold.status,
          amount: manualPaymentHold.amount,
          qbInvoiceNumber: manualPaymentHold.qbInvoiceNumber,
          qbInvoiceLink: manualPaymentHold.qbInvoiceLink,
          paidAt: manualPaymentHold.paidAt,
          expiresAt: manualPaymentHold.expiresAt,
          paymentMethod: manualPaymentHold.paymentMethod,
          manualPaymentReference: manualPaymentHold.manualPaymentReference,
          paymentError: manualPaymentHold.paymentError,
        },
      } : {}),
      ...(manualPaymentApproval ? { paymentApprovals: [{
        id: manualPaymentApproval.id,
        status: manualPaymentApproval.status,
        method: manualPaymentApproval.method,
        amount: manualPaymentApproval.amount,
        transactionReference: manualPaymentApproval.transactionReference,
        processingError: manualPaymentApproval.processingError,
      }] } : {}),
      manualPaymentWarning,
      manualPaymentApproval: manualPaymentApproval ? { id: manualPaymentApproval.id, status: manualPaymentApproval.status, method: manualPaymentApproval.method, amount: manualPaymentApproval.amount } : null,
      series: seriesKey ? { key: seriesKey, count: createdAppointments.length, appointments: createdAppointments.map((item) => ({ id: item.id, startsAt: item.startsAt, referenceCode: item.referenceCode })) } : null,
    },
  });
}

// Lets the new-appointment form preview whether this visitor still qualifies
// for a free consultation before submitting, using the same rule the booking
// itself applies (resolveFreeConsultationEligibility).
export async function getFreeConsultationEligibility(req, res) {
  const settings = await getOrCreateBookingSettings(req.auth.agencyId);
  const clientId = String(req.query.clientId || "") || null;
  const guestEmailNormalized = String(req.query.guestEmail || "").trim().toLowerCase() || null;
  const sessionTypeId = String(req.query.sessionTypeId || "") || null;
  const sessionType = sessionTypeId
    ? await prisma.bookingSessionType.findFirst({ where: { id: sessionTypeId, agencyId: req.auth.agencyId, isActive: true }, select: { durationMinutes: true } })
    : null;
  const eligibility = await resolveFreeConsultationEligibility(req.auth.agencyId, settings, {
    clientId,
    guestEmailNormalized,
    durationMinutes: sessionType?.durationMinutes || null,
  });
  res.json({ data: eligibility });
}

// Narrow, booking-form-only client lookup — deliberately returns far less
// than GET /clients (no case/portal/notes data) since frontdesk uses this to
// match a walk-in to their existing client record without gaining the
// broader client-browsing access that role is otherwise kept out of.
export async function lookupBookingClients(req, res) {
  const search = String(req.query.search || "").trim().slice(0, 200);
  const searchDigits = search.replace(/\D/g, "");
  const searchFields = search ? ["fullName", "email", "emailNormalized", "phone", "clientNumber"].map((field) => ({
    [field]: { contains: search, mode: "insensitive" },
  })) : [];
  if (searchDigits.length >= 7) searchFields.push({ phoneNormalized: { contains: searchDigits } });
  const clients = await prisma.client.findMany({
    where: {
      agencyId: req.auth.agencyId,
      archivedAt: null,
      ...(searchFields.length ? { OR: searchFields } : {}),
    },
    select: { id: true, fullName: true, email: true, phone: true, clientNumber: true },
    orderBy: { createdAt: "desc" },
    take: search ? 20 : 100,
  });
  res.json({ data: clients });
}

// Polled by the new-appointment sheet after a card-payment hold is created,
// so staff see the reservation flip to a real appointment the moment
// QuickBooks confirms — actively re-checks the invoice (same as the public
// booking page's status endpoint) rather than only reading the last known
// DB state, since the webhook can lag.
export async function getBookingPaymentHoldById(req, res) {
  const hold = await prisma.bookingPaymentHold.findFirst({ where: { id: req.params.id, agencyId: req.auth.agencyId } });
  if (!hold) throw createHttpError(404, "This reservation was not found.", "NOT_FOUND");
  if (hold.qbInvoiceId && ["AwaitingPayment", "Expired"].includes(hold.status)) {
    await reconcilePaymentHold(req.auth.agencyId, hold.id, { allowExpired: true }).catch((error) => {
      logger.warn("booking_payment_hold.staff_status_reconcile_failed", { agencyId: req.auth.agencyId, holdId: hold.id, reason: error.message });
    });
  }
  const latest = await prisma.bookingPaymentHold.findFirst({ where: { id: req.params.id, agencyId: req.auth.agencyId } });
  const delivery = await paymentHoldDeliverySummary(latest.id);
  res.json({
    data: {
      id: latest.id,
      status: latest.status,
      amount: latest.amount,
      invoiceNumber: latest.qbInvoiceNumber,
      payNowUrl: latest.status === "AwaitingPayment" ? latest.qbInvoiceLink : null,
      expiresAt: latest.expiresAt,
      appointmentId: latest.appointmentId,
      guestName: latest.guestName,
      guestEmail: latest.guestEmail,
      guestPhone: latest.guestPhone,
      startsAt: latest.startsAt,
      endsAt: latest.endsAt,
      paymentMethod: latest.paymentMethod,
      paymentReference: latest.manualPaymentReference,
      paymentError: latest.paymentError,
      qbInvoiceNumber: latest.qbInvoiceNumber,
      delivery,
    },
  });
}

export async function resendBookingPaymentHoldRequest(req, res) {
  const email = req.body?.email == null ? null : String(req.body.email).trim().toLowerCase();
  if (email != null && !/^\S+@\S+\.\S+$/.test(email)) {
    throw createHttpError(400, "Enter a valid email address.", "VALIDATION_ERROR");
  }
  const data = await resendPaymentHoldRequestService(req.auth.agencyId, req.params.id, {
    email,
    phone: req.body?.phone,
    actorUserId: req.auth.userId,
  });
  res.json({ data: {
    id: data.id,
    status: data.status,
    amount: data.amount,
    payNowUrl: data.qbInvoiceLink,
    expiresAt: data.expiresAt,
    appointmentId: data.appointmentId,
    guestName: data.guestName,
    guestEmail: data.guestEmail,
    guestPhone: data.guestPhone,
    startsAt: data.startsAt,
    endsAt: data.endsAt,
    delivery: data.delivery,
  } });
}

export async function cancelBookingPaymentHoldRequest(req, res) {
  const data = await cancelPaymentHoldRequestService(req.auth.agencyId, req.params.id, { actorUserId: req.auth.userId });
  res.json({ data: { id: data.id, status: data.status, expiresAt: data.expiresAt, appointmentId: data.appointmentId, delivery: data.delivery } });
}

// Front-desk "on the spot" flow: appointment already exists (booked
// through the normal staff flow above, no hold/expiry involved) — this
// generates a QuickBooks pay-now link so a walk-in client can pay by card
// immediately. Idempotent: calling it again on the same appointment just
// returns the existing hold rather than creating a second invoice.
export async function createWalkInPayNowLink(req, res) {
  const hold = await createPaymentHoldForWalkIn(req.auth.agencyId, { appointmentId: req.params.id, actorUserId: req.auth.userId });
  res.status(201).json({
    data: {
      id: hold.id,
      appointmentId: hold.appointmentId,
      status: hold.status,
      amount: hold.amount,
      invoiceNumber: hold.qbInvoiceNumber,
      payNowUrl: hold.status === "AwaitingPayment" ? hold.qbInvoiceLink || null : null,
      paymentMethod: hold.paymentMethod,
      guestEmail: hold.guestEmail,
      guestPhone: hold.guestPhone,
      delivery: await paymentHoldDeliverySummary(hold.id),
    },
  });
}

// Client paid outside QuickBooks' hosted checkout entirely (cash in hand,
// an e-transfer to the office) — records it directly rather than routing
// through a card charge that never happened.
export async function recordWalkInManualPayment(req, res) {
  const method = String(req.body?.method || "");
  const transactionReference = String(req.body?.transactionReference || "").trim().slice(0, 100) || null;
  const note = String(req.body?.note || "").trim().slice(0, 500) || null;
  if (req.auth.role === "frontdesk" && method === "Cash") {
    const approval = await submitPaymentApproval(req.auth.agencyId, {
      entryType: "appointment_payment",
      appointmentId: req.params.id,
      method,
      transactionReference,
      paymentDate: req.body?.paymentDate,
      note,
      actorUserId: req.auth.userId,
      sourceRole: req.auth.role,
      idempotencyKey: req.body?.idempotencyKey || `appointment-payment:${req.params.id}:${method}:${transactionReference || req.body?.paymentDate || "pending"}`,
    });
    return res.status(202).json({ data: {
      id: approval.id,
      appointmentId: approval.appointmentId,
      status: "PendingApproval",
      amount: approval.amount,
      paymentMethod: approval.method,
      paymentReference: approval.transactionReference,
      approvalRequired: true,
      approval,
    } });
  }
  const hold = await recordWalkInManualPaymentService(req.auth.agencyId, {
    appointmentId: req.params.id,
    method,
    transactionReference,
    paymentDate: req.body?.paymentDate,
    note,
    actorUserId: req.auth.userId,
    actorRole: req.auth.role,
  });
  res.status(201).json({
    data: {
      id: hold.id,
      appointmentId: hold.appointmentId,
      status: hold.status,
      amount: hold.amount,
      paidAt: hold.paidAt,
      paymentMethod: hold.paymentMethod,
      paymentReference: hold.manualPaymentReference,
      invoiceNumber: hold.qbInvoiceNumber,
      paymentError: hold.paymentError,
    },
  });
}

export async function updatePaidAppointmentPaymentDetails(req, res) {
  if (req.auth.role === "frontdesk" && req.body?.method === "Cash") {
    const approval = await submitPaymentApproval(req.auth.agencyId, {
      entryType: "appointment_payment_details",
      appointmentId: req.params.id,
      method: req.body?.method,
      transactionReference: req.body?.transactionReference,
      paymentDate: req.body?.paymentDate,
      actorUserId: req.auth.userId,
      sourceRole: req.auth.role,
      idempotencyKey: req.body?.idempotencyKey || `appointment-payment-details:${req.params.id}:${req.body?.method}:${req.body?.transactionReference || req.body?.paymentDate || "pending"}`,
    });
    return res.status(202).json({ data: { id: approval.id, appointmentId: approval.appointmentId, status: "PendingApproval", amount: approval.amount, paymentMethod: approval.method, paymentReference: approval.transactionReference, approvalRequired: true, approval } });
  }
  const hold = await updatePaidAppointmentPaymentDetailsService(req.auth.agencyId, {
    appointmentId: req.params.id,
    method: req.body?.method,
    transactionReference: req.body?.transactionReference,
    paymentDate: req.body?.paymentDate,
    actorUserId: req.auth.userId,
    actorRole: req.auth.role,
  });
  res.json({
    data: {
      id: hold.id,
      appointmentId: hold.appointmentId,
      status: hold.status,
      amount: hold.amount,
      paidAt: hold.paidAt,
      paymentMethod: hold.paymentMethod,
      paymentReference: hold.manualPaymentReference,
      invoiceNumber: hold.qbInvoiceNumber,
      paymentError: hold.paymentError,
    },
  });
}

// Feeds the "Amount paid" / refund-fee disclosure into the booked and
// cancelled emails (bookingEmailContent's invoiceUrl/refundEstimate) —
// empty object when nothing was ever paid, so those emails render exactly
// as before for free/unpaid appointments.
async function paidHoldSummary(db, agencyId, appointmentId) {
  const hold = await db.bookingPaymentHold.findFirst({
    where: { agencyId, appointmentId, status: "Paid" },
    select: { amount: true, qbInvoiceLink: true },
  });
  if (!hold) return {};
  const feeRate = await refundFeeRateForAgency(agencyId);
  return { amount: Number(hold.amount), invoiceUrl: hold.qbInvoiceLink, refundEstimate: estimateRefundAfterFees(hold.amount, feeRate) };
}

export async function cancelBookingAppointment(req, res) {
  const existing = await prisma.appointment.findFirst({
    where: {
      id: req.params.id,
      agencyId: req.auth.agencyId,
      ...(req.auth.role === "consultant" ? { assignedToId: req.auth.userId } : {}),
    },
    include: {
      sessionType: { select: { bufferMinutes: true, allowedMeetingModes: true } },
      assignedTo: { select: { schedulingPreference: { select: { bufferMinutes: true } } } },
      client: { select: { phone: true } },
    },
  });
  if (!existing) throw createHttpError(404, "Appointment not found.", "NOT_FOUND");
  if (existing.status !== "Scheduled") throw createHttpError(409, "Only a scheduled appointment can be cancelled.", "ALREADY_DONE");
  if (new Date(existing.startsAt) <= new Date()) throw createHttpError(409, "Past appointments should be marked attended or no-show.", "TOO_LATE");
  const cancelSeries = req.body?.scope === "series" && existing.seriesKey;
  if (cancelSeries) {
    const series = await prisma.appointment.findMany({ where: { agencyId: req.auth.agencyId, seriesKey: existing.seriesKey, status: "Scheduled", startsAt: { gte: existing.startsAt }, ...(req.auth.role === "consultant" ? { assignedToId: req.auth.userId } : {}) }, include: { ...calendarInclude, client: { select: { id: true, fullName: true, email: true, phone: true } } }, orderBy: { startsAt: "asc" } });
    const reason = String(req.body?.reason || "").trim().slice(0, 500) || null;
    const cancelledAt = new Date();
    const cancelled = series.map((item) => ({ ...item, status: "Cancelled", cancelledAt, cancellationReason: reason }));
    await prisma.$transaction(async (tx) => {
      await tx.appointment.updateMany({ where: { id: { in: series.map((item) => item.id) }, status: "Scheduled" }, data: { status: "Cancelled", cancelledAt, cancelledById: req.auth.userId, cancellationReason: reason } });
      for (const item of cancelled) {
        await syncLeadConsultationFromAppointment(tx, item, { consultationStatus: "CANCELLED" });
        await sendBookingMessages({ agencyId: req.auth.agencyId, appointment: item, kind: "cancelled", actorUserId: req.auth.userId, db: tx, ...(await paidHoldSummary(tx, req.auth.agencyId, item.id)) });
        if (item.meetingProvider === "Zoom" && item.meetingProviderId) {
          await enqueueAppointmentMeetingJob(tx, {
            appointment: item,
            action: "DELETE",
            providerMeetingId: item.meetingProviderId,
            dedupeSuffix: "series-cancelled",
          });
        }
      }
      if (tx.appointmentEvent && series.length) await tx.appointmentEvent.createMany({ data: series.map((item) => ({ agencyId: req.auth.agencyId, appointmentId: item.id, actorUserId: req.auth.userId, type: "SERIES_CANCELLED", summary: "Appointment cancelled with recurring series", metadata: { seriesKey: existing.seriesKey } })) });
    });
    void processBookingMessageDeliveries();
    await Promise.all(cancelled.map((item) => offerWaitlistOpening(item).catch(() => {})));
    await Promise.all(cancelled.map((item) => voidOpenPaymentHoldForAppointment(req.auth.agencyId, item.id)));
    await Promise.all(cancelled.map((item) => resolveMissingAppointmentPaymentNotification(req.auth.agencyId, item.id).catch(() => {})));
    await recordActivity({ agencyId: req.auth.agencyId, userId: req.auth.userId, clientId: existing.clientId, caseId: existing.caseId, action: "appointment.series_cancelled", details: `${series.length} recurring appointments cancelled` });
    invalidateDashboardCache(req.auth.agencyId);
    return res.json({ data: { ...cancelled.find((item) => item.id === existing.id), seriesAffected: series.length } });
  }
  const data = await prisma.$transaction(async (tx) => {
    const result = await tx.appointment.update({
      where: { id: existing.id },
      data: { status: "Cancelled", cancelledAt: new Date(), cancelledById: req.auth.userId, cancellationReason: String(req.body?.reason || "").trim().slice(0, 500) || null },
      include: { ...calendarInclude, client: { select: { id: true, fullName: true, email: true, phone: true } } },
    });
    await syncLeadConsultationFromAppointment(tx, result, { consultationStatus: "CANCELLED" });
    await recordAppointmentEvent(tx, { agencyId: req.auth.agencyId, appointmentId: existing.id, actorUserId: req.auth.userId, type: "CANCELLED", summary: "Appointment cancelled", metadata: { reason: result.cancellationReason } });
    await sendBookingMessages({ agencyId: req.auth.agencyId, appointment: result, kind: "cancelled", actorUserId: req.auth.userId, db: tx, ...(await paidHoldSummary(tx, req.auth.agencyId, existing.id)) });
    if (result.meetingProvider === "Zoom" && result.meetingProviderId) {
      await enqueueAppointmentMeetingJob(tx, {
        appointment: result,
        action: "DELETE",
        providerMeetingId: result.meetingProviderId,
        dedupeSuffix: "cancelled",
      });
    }
    return result;
  });
  await recordActivity({
    agencyId: req.auth.agencyId,
    userId: req.auth.userId,
    clientId: existing.clientId,
    caseId: existing.caseId,
    action: "appointment.cancelled",
    details: `${existing.subject} cancelled`,
  });
  invalidateDashboardCache(req.auth.agencyId);
  void processBookingMessageDeliveries();
  await offerWaitlistOpening(data).catch(() => {});
  await voidOpenPaymentHoldForAppointment(req.auth.agencyId, existing.id);
  await resolveMissingAppointmentPaymentNotification(req.auth.agencyId, existing.id).catch(() => {});
  res.json({ data });
}

export async function rescheduleBookingAppointment(req, res) {
  const existing = await prisma.appointment.findFirst({
    where: {
      id: req.params.id,
      agencyId: req.auth.agencyId,
      status: { in: ["Scheduled", "NoShow"] },
      ...(req.auth.role === "consultant" ? { assignedToId: req.auth.userId } : {}),
    },
    include: {
      sessionType: { select: { bufferMinutes: true, allowedMeetingModes: true } },
      assignedTo: { select: { schedulingPreference: { select: { bufferMinutes: true } } } },
      client: { select: { phone: true } },
    },
  });
  if (!existing) throw createHttpError(404, "Appointment not found.", "NOT_FOUND");
  if (existing.status === "Scheduled" && new Date(existing.startsAt) <= new Date()) throw createHttpError(409, "Past appointments must be marked attended or no-show before they can be rescheduled.", "TOO_LATE");
  const startsAt = new Date(String(req.body?.startsAt || ""));
  if (Number.isNaN(startsAt.getTime())) throw createHttpError(400, "Pick a new time.", "VALIDATION_ERROR");
  const duration = Math.round((new Date(existing.endsAt) - new Date(existing.startsAt)) / 60_000);
  const endsAt = new Date(startsAt.getTime() + duration * 60_000);
  const settings = await getOrCreateBookingSettings(req.auth.agencyId);
  const requestedMode = req.body?.meetingMode;
  const meetingMode = requestedMode ? normalizeMeetingMode(requestedMode, existing.meetingMode) : existing.meetingMode;
  const timeChanged = startsAt.getTime() !== new Date(existing.startsAt).getTime();
  const modeChanged = meetingMode !== existing.meetingMode;
  const notificationKind = timeChanged ? "rescheduled" : modeChanged ? "format_updated" : "rescheduled";
  assertMeetingModeConfigured({ settings, sessionType: existing.sessionType, mode: meetingMode, guestPhone: existing.client?.phone || existing.guestPhone });
  if (meetingMode === MEETING_MODES.ZOOM) {
    await assertZoomOperational(req.auth.agencyId);
    const mapped = await prisma.zoomHostMapping.findFirst({
      where: { agencyId: req.auth.agencyId, userId: existing.assignedToId, status: "active" },
      select: { id: true },
    });
    if (!mapped) throw createHttpError(409, "Zoom is not configured for this consultant.", "ZOOM_HOST_NOT_MAPPED");
  }
  const locations = Array.isArray(settings.locations) ? settings.locations : [];
  const selectedLocation = meetingMode === MEETING_MODES.IN_PERSON
    ? locations.find((item) => item.id === String(req.body?.locationId || "")) || (locations.length === 1 ? locations[0] : null)
    : null;
  if (meetingMode === MEETING_MODES.IN_PERSON && locations.length && !selectedLocation) throw createHttpError(400, "Choose an office location.", "VALIDATION_ERROR");
  const dayKey = localDateKey(startsAt, settings.timezone);
  const effectiveBuffer = existing.sessionType?.bufferMinutes ?? existing.assignedTo?.schedulingPreference?.bufferMinutes ?? settings.bufferMinutes;
  const rescheduleSeries = existing.status === "Scheduled" && req.body?.scope === "series" && existing.seriesKey;
  if (rescheduleSeries) {
    const series = await prisma.appointment.findMany({
      where: { agencyId: req.auth.agencyId, seriesKey: existing.seriesKey, status: "Scheduled", startsAt: { gte: existing.startsAt }, ...(req.auth.role === "consultant" ? { assignedToId: req.auth.userId } : {}) },
      include: { ...calendarInclude, client: { select: { id: true, fullName: true, email: true, phone: true } }, assignedTo: { select: { id: true, fullName: true, schedulingPreference: { select: { bufferMinutes: true } } } } },
      orderBy: { startsAt: "asc" },
    });
    const seriesIds = series.map((item) => item.id);
    if (meetingMode === MEETING_MODES.ZOOM) {
      const assigneeIds = [...new Set(series.map((item) => item.assignedToId).filter(Boolean))];
      const mappedCount = await prisma.zoomHostMapping.count({
        where: { agencyId: req.auth.agencyId, userId: { in: assigneeIds }, status: "active" },
      });
      if (mappedCount !== assigneeIds.length) {
        throw createHttpError(409, "Zoom is not configured for every consultant in this recurring series.", "ZOOM_HOST_NOT_MAPPED");
      }
    }
    const delta = startsAt.getTime() - new Date(existing.startsAt).getTime();
    const moves = series.map((item) => {
      const nextStart = new Date(new Date(item.startsAt).getTime() + delta);
      const nextEnd = new Date(new Date(item.endsAt).getTime() + delta);
      return { item, startsAt: nextStart, endsAt: nextEnd, buffer: existing.sessionType?.bufferMinutes ?? item.assignedTo?.schedulingPreference?.bufferMinutes ?? settings.bufferMinutes };
    });
    for (const move of moves) {
      const key = localDateKey(move.startsAt, settings.timezone);
      const offered = await availabilityForRange({ agencyId: req.auth.agencyId, assignedToId: move.item.assignedToId, durationMinutes: Math.round((move.endsAt - move.startsAt) / 60_000), sessionBufferMinutes: existing.sessionType?.bufferMinutes, fromKey: key, toKey: key, excludeAppointmentIds: seriesIds, minNoticeOverrideMinutes: 0, locationId: meetingMode === MEETING_MODES.IN_PERSON ? selectedLocation?.id || null : null, meetingMode, ignorePastCutoff: STAFF_ROLES_SEEING_PAST_SLOTS.has(req.auth.role), ignoreLocationClosure: STAFF_ROLES_SEEING_PAST_SLOTS.has(req.auth.role) });
      if (!(offered.days[key] || []).some((slot) => slot.startsAt === move.startsAt.toISOString())) throw createHttpError(409, `${key} at the recurring time is unavailable. The series was not changed.`, "SLOT_TAKEN");
    }
    const updated = await prisma.$transaction(async (tx) => {
      const results = [];
      if (meetingMode === MEETING_MODES.ZOOM) {
        await lockSchedulingTransaction(tx, req.auth.agencyId, moves[0]?.startsAt || startsAt);
        await assertZoomOperational(req.auth.agencyId, tx);
        const assigneeIds = [...new Set(moves.map((move) => move.item.assignedToId).filter(Boolean))];
        const mappedCount = await tx.zoomHostMapping.count({
          where: { agencyId: req.auth.agencyId, userId: { in: assigneeIds }, status: "active" },
        });
        if (mappedCount !== assigneeIds.length) {
          throw createHttpError(409, "Zoom is no longer configured for every consultant in this recurring series.", "ZOOM_HOST_NOT_MAPPED");
        }
      }
      for (const move of moves) {
        await lockSchedulingTransaction(tx, req.auth.agencyId, move.startsAt);
        const conflict = await assertSlotAvailable(tx, { agencyId: req.auth.agencyId, assignedToId: move.item.assignedToId, startsAt: move.startsAt, endsAt: move.endsAt, bufferMinutes: move.buffer, excludeAppointmentIds: seriesIds, meetingMode });
        if (conflict) throw createHttpError(409, "A recurring time was just taken. The series was not changed.", "SLOT_TAKEN");
        const meetingFields = appointmentMeetingFields({ mode: meetingMode, settings, existing: move.item });
        const result = await tx.appointment.update({ where: { id: move.item.id }, data: { startsAt: move.startsAt, endsAt: move.endsAt, ...meetingFields, location: meetingMode === MEETING_MODES.IN_PERSON ? selectedLocation ? `${selectedLocation.name} — ${selectedLocation.address}` : move.item.location : null, locationId: meetingMode === MEETING_MODES.IN_PERSON ? selectedLocation?.id || move.item.locationId : null, locationMapsUrl: meetingMode === MEETING_MODES.IN_PERSON ? selectedLocation?.mapsUrl || move.item.locationMapsUrl : null, reminderSentAt: null, reminderDueAt: new Date(move.startsAt.getTime() - Math.max(...(Array.isArray(settings.reminderSchedule) && settings.reminderSchedule.length ? settings.reminderSchedule : [settings.reminderMinutes])) * 60_000), reminderQueuedAt: null }, include: { ...calendarInclude, client: { select: { id: true, fullName: true, email: true, phone: true } } } });
        await syncLeadConsultationFromAppointment(tx, result, { consultationStatus: "RESCHEDULED" });
        await recordAppointmentEvent(tx, { agencyId: req.auth.agencyId, appointmentId: move.item.id, actorUserId: req.auth.userId, type: "SERIES_RESCHEDULED", summary: "Appointment moved with recurring series", metadata: { from: move.item.startsAt, to: move.startsAt, seriesKey: existing.seriesKey } });
        if (move.item.meetingProvider === "Zoom" && move.item.meetingProviderId && meetingMode !== MEETING_MODES.ZOOM) {
          await enqueueAppointmentMeetingJob(tx, { appointment: result, action: "DELETE", providerMeetingId: move.item.meetingProviderId, dedupeSuffix: "series-mode-changed" });
        }
        if (meetingMode === MEETING_MODES.ZOOM) {
          await enqueueAppointmentMeetingJob(tx, { appointment: result, action: "SYNC", notifyKind: notificationKind, actorUserId: req.auth.userId, dedupeSuffix: "series-rescheduled" });
        } else {
          await sendBookingMessages({ agencyId: req.auth.agencyId, appointment: result, kind: notificationKind, actorUserId: req.auth.userId, db: tx });
        }
        results.push(result);
      }
      return results;
    });
    if (updated.some((item) => item.meetingMode !== MEETING_MODES.ZOOM)) void processBookingMessageDeliveries();
    await recordActivity({ agencyId: req.auth.agencyId, userId: req.auth.userId, clientId: existing.clientId, caseId: existing.caseId, action: "appointment.series_rescheduled", details: `${updated.length} recurring appointments rescheduled` });
    invalidateDashboardCache(req.auth.agencyId);
    return res.json({ data: { ...updated.find((item) => item.id === existing.id), seriesAffected: updated.length } });
  }
  const offeredAvailability = await availabilityForRange({ agencyId: req.auth.agencyId, assignedToId: existing.assignedToId, durationMinutes: duration, sessionBufferMinutes: effectiveBuffer, fromKey: dayKey, toKey: dayKey, excludeAppointmentId: existing.id, minNoticeOverrideMinutes: 0, locationId: meetingMode === MEETING_MODES.IN_PERSON ? selectedLocation?.id || existing.locationId || null : null, meetingMode, ignorePastCutoff: STAFF_ROLES_SEEING_PAST_SLOTS.has(req.auth.role), ignoreLocationClosure: STAFF_ROLES_SEEING_PAST_SLOTS.has(req.auth.role) });
  if (!(offeredAvailability.days[dayKey] || []).some((slot) => slot.startsAt === startsAt.toISOString())) throw createHttpError(409, "That time is outside bookable hours or no longer available.", "SLOT_TAKEN");

  const data = await prisma.$transaction(async (tx) => {
    await lockSchedulingTransaction(tx, req.auth.agencyId, startsAt);
    if (meetingMode === MEETING_MODES.ZOOM) {
      await assertZoomOperational(req.auth.agencyId, tx);
      const mapped = await tx.zoomHostMapping.findFirst({
        where: { agencyId: req.auth.agencyId, userId: existing.assignedToId, status: "active" },
        select: { id: true },
      });
      if (!mapped) throw createHttpError(409, "Zoom is no longer configured for this consultant.", "ZOOM_HOST_NOT_MAPPED");
    }
    const conflict = await assertSlotAvailable(tx, {
      agencyId: req.auth.agencyId,
      assignedToId: existing.assignedToId,
      startsAt,
      endsAt,
      bufferMinutes: effectiveBuffer,
      excludeAppointmentId: existing.id,
      meetingMode,
    });
    if (conflict) throw createHttpError(409, "That time was just taken. Pick another slot.", "SLOT_TAKEN");
    const meetingFields = appointmentMeetingFields({ mode: meetingMode, settings, existing });
    const updated = await tx.appointment.update({
      where: { id: existing.id },
      data: {
        ...(existing.status === "NoShow" ? { status: "Scheduled" } : {}),
        startsAt,
        endsAt,
        ...meetingFields,
        location: meetingMode === MEETING_MODES.IN_PERSON ? selectedLocation ? `${selectedLocation.name} — ${selectedLocation.address}` : existing.location : null,
        locationId: meetingMode === MEETING_MODES.IN_PERSON ? selectedLocation?.id || existing.locationId : null,
        locationMapsUrl: meetingMode === MEETING_MODES.IN_PERSON ? selectedLocation?.mapsUrl || existing.locationMapsUrl : null,
        reminderSentAt: null,
        reminderDueAt: new Date(startsAt.getTime() - Math.max(...(Array.isArray(settings.reminderSchedule) && settings.reminderSchedule.length ? settings.reminderSchedule : [settings.reminderMinutes])) * 60_000),
        reminderQueuedAt: null,
      },
      include: { ...calendarInclude, client: { select: { id: true, fullName: true, email: true, phone: true } } },
    });
    await syncLeadConsultationFromAppointment(tx, updated, { consultationStatus: "RESCHEDULED" });
    await recordAppointmentEvent(tx, { agencyId: req.auth.agencyId, appointmentId: existing.id, actorUserId: req.auth.userId, type: "RESCHEDULED", summary: existing.status === "NoShow" ? "No-show appointment rescheduled" : "Appointment date or format changed", metadata: { from: existing.startsAt, to: startsAt, fromStatus: existing.status, toStatus: "Scheduled", meetingMode } });
    if (existing.meetingProvider === "Zoom" && existing.meetingProviderId && meetingMode !== MEETING_MODES.ZOOM) {
      await enqueueAppointmentMeetingJob(tx, { appointment: updated, action: "DELETE", providerMeetingId: existing.meetingProviderId, dedupeSuffix: "mode-changed" });
    }
    if (meetingMode === MEETING_MODES.ZOOM) {
      await enqueueAppointmentMeetingJob(tx, { appointment: updated, action: "SYNC", notifyKind: notificationKind, actorUserId: req.auth.userId });
    } else {
      await sendBookingMessages({ agencyId: req.auth.agencyId, appointment: updated, kind: notificationKind, actorUserId: req.auth.userId, db: tx });
    }
    return updated;
  });

  await recordActivity({
    agencyId: req.auth.agencyId,
    userId: req.auth.userId,
    clientId: existing.clientId,
    caseId: existing.caseId,
    action: "appointment.rescheduled",
    details: `${existing.subject} rescheduled`,
  });
  invalidateDashboardCache(req.auth.agencyId);
  if (existing.status === "NoShow") {
    await resolveNotifications({
      agencyId: req.auth.agencyId,
      entityType: "appointment",
      entityId: existing.id,
      types: ["appointment.no_show"],
    });
  }
  if (data.meetingMode !== MEETING_MODES.ZOOM) void processBookingMessageDeliveries();
  res.json({ data });
}

export async function updateSchedulingStaff(req, res) {
  requireAdmin(req);
  const user = await prisma.user.findFirst({
    where: { id: req.params.userId, agencyId: req.auth.agencyId, status: "active", role: { in: ["admin", "consultant"] } },
    select: { id: true },
  });
  if (!user) throw createHttpError(404, "Scheduling team member not found.", "NOT_FOUND");
  const body = req.body || {};
  const data = await prisma.schedulingStaffPreference.upsert({
    where: { userId: user.id },
    create: {
      agencyId: req.auth.agencyId,
      userId: user.id,
      acceptsAppointments: Boolean(body.acceptsAppointments),
      publicBookable: Boolean(body.publicBookable),
      maxDailyAppointments: body.maxDailyAppointments == null || body.maxDailyAppointments === "" ? null : boundedInt(body.maxDailyAppointments, "Daily appointment limit", 1, 50),
      timezone: body.timezone === undefined ? null : optionalTimezone(body.timezone),
      workingHours: body.workingHours === undefined || body.workingHours === null ? undefined : validWorkingHours(body.workingHours),
      daysOff: body.daysOff === undefined ? [] : validDaysOff(body.daysOff),
      bufferMinutes: body.bufferMinutes == null || body.bufferMinutes === "" ? null : boundedInt(body.bufferMinutes, "Personal buffer", 0, 240),
    },
    update: {
      ...(typeof body.acceptsAppointments === "boolean" ? { acceptsAppointments: body.acceptsAppointments } : {}),
      ...(typeof body.publicBookable === "boolean" ? { publicBookable: body.publicBookable } : {}),
      ...(body.maxDailyAppointments !== undefined ? { maxDailyAppointments: body.maxDailyAppointments == null || body.maxDailyAppointments === "" ? null : boundedInt(body.maxDailyAppointments, "Daily appointment limit", 1, 50) } : {}),
      ...(body.timezone !== undefined ? { timezone: optionalTimezone(body.timezone) } : {}),
      ...(body.workingHours !== undefined ? { workingHours: body.workingHours === null ? null : validWorkingHours(body.workingHours) } : {}),
      ...(body.daysOff !== undefined ? { daysOff: validDaysOff(body.daysOff) } : {}),
      ...(body.bufferMinutes !== undefined ? { bufferMinutes: body.bufferMinutes == null || body.bufferMinutes === "" ? null : boundedInt(body.bufferMinutes, "Personal buffer", 0, 240) } : {}),
    },
  });
  res.json({ data });
}

export async function buildSchedulingAnalytics(req, query) {
  const settings = await getOrCreateBookingSettings(req.auth.agencyId);
  const range = query.range == null ? null : String(query.range);
  let dateWhere;
  if (range !== null) {
    if (!["today", "7", "30", "all"].includes(range)) throw createHttpError(400, "Choose a valid analytics range.", "VALIDATION_ERROR");
    if (range === "today") {
      // The Dashboard's scheduling widget defaults to this range on every
      // load ("Today" is its initial filter state, not just an option a
      // user can pick) — it was 400ing unconditionally because "today" was
      // never in the accepted set, only "7"/"30"/"all".
      const todayKey = localDateKey(new Date(), settings.timezone);
      dateWhere = { startsAt: { gte: localDateTimeToUtc(todayKey, 0, settings.timezone), lt: localDateTimeToUtc(todayKey, 24 * 60, settings.timezone) } };
    } else {
      dateWhere = range === "all" ? {} : { startsAt: { gte: new Date(Date.now() - Number(range) * 86_400_000) } };
    }
  } else {
    const todayKey = localDateKey(new Date(), settings.timezone);
    const monthKey = `${todayKey.slice(0, 8)}01`;
    const from = query.from ? new Date(String(query.from)) : localDateTimeToUtc(monthKey, 0, settings.timezone);
    const to = query.to ? new Date(String(query.to)) : new Date();
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || to < from || to.getTime() - from.getTime() > 366 * 86_400_000) {
      throw createHttpError(400, "Choose a valid analytics range up to 366 days.", "VALIDATION_ERROR");
    }
    dateWhere = { startsAt: { gte: from, lte: to } };
  }
  const grouped = await prisma.appointment.groupBy({
    by: ["status"],
    where: { agencyId: req.auth.agencyId, ...dateWhere },
    _count: { _all: true },
  });
  const counts = Object.fromEntries(grouped.map((item) => [item.status, item._count._all]));
  return { booked: Object.values(counts).reduce((sum, value) => sum + value, 0), attended: counts.Completed || 0, cancelled: counts.Cancelled || 0, noShow: counts.NoShow || 0 };
}

export async function getSchedulingAnalytics(req, res) {
  requireAdmin(req);
  res.json({ data: await buildSchedulingAnalytics(req, req.query) });
}

export async function convertAppointmentToClient(req, res) {
  const appointment = await prisma.appointment.findFirst({ where: { id: req.params.id, agencyId: req.auth.agencyId, ...(req.auth.role === "consultant" ? { assignedToId: req.auth.userId } : {}) } });
  if (!appointment) throw createHttpError(404, "Appointment not found.", "NOT_FOUND");
  if (appointment.clientId) return res.json({ data: { clientId: appointment.clientId, existing: true } });
  if (!appointment.guestName) throw createHttpError(400, "This appointment has no visitor name.", "VALIDATION_ERROR");
  const result = await prisma.$transaction(async (tx) => {
    await lockAgencyContactIntake(tx, req.auth.agencyId);
    const contact = normalizeContact({ phone: appointment.guestPhone, email: appointment.guestEmail });
    const contactOr = [contact.emailNormalized ? { emailNormalized: contact.emailNormalized } : null, contact.phoneNormalized ? { phoneNormalized: contact.phoneNormalized } : null].filter(Boolean);
    const existingMatches = contactOr.length ? await tx.client.findMany({ where: { agencyId: req.auth.agencyId, OR: contactOr }, take: 3 }) : [];
    if (existingMatches.length > 1) {
      throw createHttpError(409, "More than one client matches this visitor. Open the client list and link the correct record before continuing.", "AMBIGUOUS_CLIENT_MATCH");
    }
    const existing = existingMatches[0] || null;
    const created = existing || await tx.client.create({ data: {
      agencyId: req.auth.agencyId,
      clientNumber: await nextClientNumber(tx, req.auth.agencyId),
      fullName: appointment.guestName,
      ...contact,
      status: "Active",
      // Saving an appointment guest creates a client profile, not a case.
      // Keep that profile unassigned until a case grants access or an admin
      // deliberately assigns the client through Client Access.
      assignedUserId: null,
    } });
    await tx.appointment.update({ where: { id: appointment.id }, data: { clientId: created.id } });
    await tx.note.updateMany({ where: { appointmentId: appointment.id, clientId: null }, data: { clientId: created.id } });
    await tx.followUp.updateMany({ where: { appointmentId: appointment.id, clientId: null }, data: { clientId: created.id } });
    await tx.bookingPaymentHold.updateMany({
      where: { appointmentId: appointment.id, clientId: null },
      data: { clientId: created.id },
    });
    await recordAppointmentEvent(tx, { agencyId: req.auth.agencyId, appointmentId: appointment.id, actorUserId: req.auth.userId, type: "CLIENT_LINKED", summary: existing ? "Linked to an existing client" : "Visitor converted to a client", metadata: { clientId: created.id } });
    return { client: created, existing: Boolean(existing) };
  });
  await recordActivity({
    agencyId: req.auth.agencyId,
    userId: req.auth.userId,
    clientId: result.client.id,
    action: result.existing ? "appointment.client_linked" : "client.created",
    details: result.existing
      ? `${appointment.guestName} appointment linked to the existing client profile`
      : `${result.client.fullName} created from appointment ${appointment.referenceCode || appointment.subject}`,
    entityType: "appointment",
    entityId: appointment.id,
  });
  res.status(result.existing ? 200 : 201).json({ data: { clientId: result.client.id, existing: result.existing } });
}

// Shared by the manual "mark attended/cancelled/no-show" HTTP endpoint below
// and appointmentNoShowService.js's automatic end-of-day poller, so both
// paths get identical side effects (lead-consultation sync, event log,
// completion follow-up, staff/client notifications, waitlist offer, and —
// importantly — closing an open payment hold when cancelled) with nothing to drift out of
// sync between a human-triggered and a system-triggered status change.
// actorUserId is null for the automatic path; every downstream call here
// already treats a null actor as "system-triggered" (recordAppointmentEvent
// defaults actorUserId to null, and both notification helpers accept a null
// actorUserId as just metadata on the delivery record).
export async function applyAppointmentStatusChange({ agencyId, existing, status, actorUserId = null, reason = null }) {
  const data = await prisma.$transaction(async (tx) => {
    const result = await tx.appointment.update({
      where: { id: existing.id },
      data: {
        status,
        ...(status === "Cancelled" ? { cancelledAt: new Date(), cancelledById: actorUserId, cancellationReason: reason } : {}),
      },
      include: { ...calendarInclude, client: { select: { id: true, fullName: true, email: true, phone: true } } },
    });
    await syncLeadConsultationFromAppointment(tx, result, {
      consultationStatus: leadConsultationStatusForAppointment(status),
    });
    await recordAppointmentEvent(tx, { agencyId, appointmentId: existing.id, actorUserId, type: "STATUS_CHANGED", summary: `Appointment marked ${status}`, metadata: { from: existing.status, to: status } });
    if (status === "Completed") await ensureAppointmentCompletionFollowUp(tx, result);
    if (["Completed", "NoShow"].includes(status)) {
      await sendBookingStaffNotification({ agencyId, appointment: result, kind: status === "Completed" ? "attended" : "no_show", actorUserId, db: tx });
    } else if (status === "Cancelled") {
      await sendBookingMessages({ agencyId, appointment: result, kind: "cancelled", actorUserId, db: tx });
      if (result.meetingProvider === "Zoom" && result.meetingProviderId) {
        await enqueueAppointmentMeetingJob(tx, {
          appointment: result,
          action: "DELETE",
          providerMeetingId: result.meetingProviderId,
          dedupeSuffix: "status-cancelled",
        });
      }
    }
    // status === "Scheduled" (unmark): no client- or staff-facing
    // notification — the admin doing it already knows, and there's nothing
    // for the client to be told since nothing about their appointment
    // actually changed from their perspective.
    return result;
  });
  await recordActivity({ agencyId, userId: actorUserId, clientId: existing.clientId, caseId: existing.caseId, action: "appointment.status_updated", details: `${existing.subject} marked ${status}` });
  invalidateDashboardCache(agencyId);
  void processBookingMessageDeliveries();
  if (status === "Cancelled") {
    await offerWaitlistOpening(data).catch(() => {});
  }
  if (status === "Cancelled") {
    await voidOpenPaymentHoldForAppointment(agencyId, existing.id);
  }
  if (status !== "Scheduled") {
    await resolveMissingAppointmentPaymentNotification(agencyId, existing.id).catch(() => {});
  }
  return data;
}

export async function updateBookingAppointmentStatus(req, res) {
  const status = String(req.body?.status || "");
  if (!["Completed", "Cancelled", "NoShow", "Scheduled"].includes(status)) throw createHttpError(400, "Choose a valid appointment status.", "VALIDATION_ERROR");
  const existing = await prisma.appointment.findFirst({
    where: { id: req.params.id, agencyId: req.auth.agencyId, ...(req.auth.role === "consultant" ? { assignedToId: req.auth.userId } : {}) },
  });
  if (!existing) throw createHttpError(404, "Appointment not found.", "NOT_FOUND");

  if (status === "Scheduled") {
    // "Unmark attended" — reverses a Completed appointment back to
    // Scheduled. Admin-only, and only from Completed: no legitimate reason
    // to "unmark" a Cancelled/NoShow appointment through this endpoint.
    if (req.auth.role !== "admin") throw createHttpError(403, "Only an admin can unmark an appointment.", "FORBIDDEN");
    if (existing.status !== "Completed") throw createHttpError(409, "Only an appointment marked attended can be unmarked.", "ALREADY_DONE");
  } else {
    // A missed appointment may have been completed outside the calendar
    // (for example, the consultant took the call later). Let authorized
    // staff correct NoShow -> Completed without first rescheduling it.
    const correctingNoShowToCompleted = existing.status === "NoShow" && status === "Completed";
    if (existing.status !== "Scheduled" && !correctingNoShowToCompleted) {
      throw createHttpError(409, "Only a scheduled appointment can be completed, cancelled, or marked no-show.", "ALREADY_DONE");
    }
    if (status === "Completed" && req.auth.role === "frontdesk") {
      throw createHttpError(403, "Frontdesk cannot mark an appointment attended.", "FORBIDDEN");
    }
    if (["Completed", "NoShow"].includes(status) && new Date(existing.startsAt) > new Date()) {
      throw createHttpError(409, "An appointment cannot be marked attended or no-show before it starts.", "TOO_EARLY");
    }
  }

  const data = await applyAppointmentStatusChange({
    agencyId: req.auth.agencyId,
    existing,
    status,
    actorUserId: req.auth.userId,
    reason: status === "Cancelled" ? (String(req.body?.reason || "").trim().slice(0, 500) || null) : null,
  });
  res.json({ data });
}

// Only meaningful when there's actually money on the table — returns null
// for an appointment with no Paid hold rather than a zeroed-out estimate,
// so the frontend knows to skip the disclosure step entirely for free or
// unpaid appointments instead of showing a "$0.00 fee" confirmation.
export async function getAppointmentRefundEstimate(req, res) {
  const hold = await prisma.bookingPaymentHold.findFirst({
    where: { agencyId: req.auth.agencyId, appointmentId: req.params.id, status: "Paid" },
    select: { amount: true },
  });
  if (!hold) return res.json({ data: null });
  const feeRate = await refundFeeRateForAgency(req.auth.agencyId);
  res.json({ data: estimateRefundAfterFees(hold.amount, feeRate) });
}

export async function buildAppointmentRegistry(req, query) {
  const attendance = String(query.attendance || "all");
  const range = String(query.range || "30");
  if (!["all", "attended", "not_attended", "no_show", "cancelled", "upcoming"].includes(attendance)) {
    throw createHttpError(400, "Choose a valid attendance filter.", "VALIDATION_ERROR");
  }
  if (!["7", "30", "all", "today"].includes(range)) throw createHttpError(400, "Choose a valid date range.", "VALIDATION_ERROR");
  const page = boundedInt(query.page || 1, "Page", 1, 100000);
  const limit = boundedInt(query.limit || 25, "Page size", 1, 100);
  const now = new Date();
  let todayStart = null;
  let tomorrowStart = null;
  if (range === "today") {
    const agency = await prisma.agency.findUnique({ where: { id: req.auth.agencyId }, select: { timezone: true } });
    ({ todayStart, tomorrowStart } = reportingBounds(now, agency?.timezone || "America/Toronto"));
  }
  const from = range === "all" || range === "today" ? null : new Date(now.getTime() - Number(range) * 86_400_000);
  const search = String(query.search || "").trim().slice(0, 120);
  const statusWhere = attendance === "attended" ? { status: "Completed" }
    : attendance === "no_show" ? { status: "NoShow" }
      : attendance === "cancelled" ? { status: "Cancelled" }
        : attendance === "upcoming" ? { status: "Scheduled", startsAt: { gte: now } }
          : attendance === "not_attended" ? { OR: [{ status: "NoShow" }, { status: "Scheduled", endsAt: { lt: now } }] }
            : {};
  const where = {
    agencyId: req.auth.agencyId,
    ...(req.auth.role === "consultant" ? { assignedToId: req.auth.userId } : {}),
    ...(query.assignedToId && req.auth.role !== "consultant" ? { assignedToId: String(query.assignedToId) } : {}),
    AND: [
      statusWhere,
      ...(from && attendance !== "upcoming" ? [{ startsAt: { gte: from } }] : []),
      ...(range === "today" && attendance !== "upcoming" ? [{ startsAt: { gte: todayStart, lt: tomorrowStart } }] : []),
      ...(search ? [{ OR: [
      { guestName: { contains: search, mode: "insensitive" } },
      { guestEmail: { contains: search, mode: "insensitive" } },
      { referenceCode: { contains: search, mode: "insensitive" } },
      { subject: { contains: search, mode: "insensitive" } },
      { client: { is: { fullName: { contains: search, mode: "insensitive" } } } },
      ] }] : []),
    ],
  };
  const [data, total] = await Promise.all([
    prisma.appointment.findMany({
      where,
      include: {
        client: { select: { id: true, fullName: true, email: true, phone: true } },
        assignedTo: { select: { id: true, fullName: true } },
        sessionType: { select: { id: true, name: true } },
      },
      orderBy: { startsAt: attendance === "upcoming" || range === "today" ? "asc" : "desc" },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.appointment.count({ where }),
  ]);
  return { data, meta: { total, page, limit, pages: Math.max(1, Math.ceil(total / limit)) } };
}

export async function listAppointmentRegistry(req, res) {
  res.json(await buildAppointmentRegistry(req, req.query));
}

export async function getAppointmentRegistryDetail(req, res) {
  res.json({ data: await requireAppointmentProfile(req, req.params.id) });
}

export async function listSchedulingBlocks(req, res) {
  const from = req.query.from ? new Date(String(req.query.from)) : new Date();
  const to = req.query.to ? new Date(String(req.query.to)) : new Date(from.getTime() + 180 * 86_400_000);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || to <= from || to.getTime() - from.getTime() > 366 * 86_400_000) {
    throw createHttpError(400, "Choose a valid block range up to one year.", "VALIDATION_ERROR");
  }
  const [data, settings] = await Promise.all([
    prisma.schedulingBlock.findMany({
      where: {
        agencyId: req.auth.agencyId,
        ...(req.auth.role === "consultant" ? { userId: req.auth.userId } : req.query.userId ? { userId: String(req.query.userId) } : {}),
        startsAt: { lt: to },
        OR: [{ endsAt: { gt: from } }, { recurrence: { in: ["DAILY", "WEEKLY"] }, recurrenceUntil: { gte: from } }],
      },
      include: {
        user: {
          select: {
            id: true,
            fullName: true,
            schedulingPreference: { select: { timezone: true } },
          },
        },
      },
      orderBy: { startsAt: "asc" },
    }),
    prisma.bookingSettings.findUnique({ where: { agencyId: req.auth.agencyId }, select: { timezone: true } }),
  ]);
  const agencyTimezone = settings?.timezone || "America/Toronto";
  res.json({
    data: data.map(({ user, ...block }) => ({
      ...block,
      timezone: user?.schedulingPreference?.timezone || agencyTimezone,
      user: user ? { id: user.id, fullName: user.fullName } : null,
    })),
  });
}

export async function createSchedulingBlock(req, res) {
  const recurrence = String(req.body?.recurrence || "NONE");
  if (!["NONE", "DAILY", "WEEKLY"].includes(recurrence)) throw createHttpError(400, "Choose a valid recurrence.", "VALIDATION_ERROR");
  const userId = req.auth.role === "consultant" ? req.auth.userId : String(req.body?.userId || req.auth.userId);
  const [user, settings] = await Promise.all([
    prisma.user.findFirst({
      where: { id: userId, agencyId: req.auth.agencyId, status: "active" },
      select: { id: true, schedulingPreference: { select: { timezone: true } } },
    }),
    prisma.bookingSettings.findUnique({ where: { agencyId: req.auth.agencyId }, select: { timezone: true } }),
  ]);
  if (!user) throw createHttpError(400, "Team member not found.", "VALIDATION_ERROR");
  const timezone = user.schedulingPreference?.timezone || settings?.timezone || "America/Toronto";
  const startsAt = parseSchedulingBlockDateTime(req.body?.startsAt, timezone);
  const endsAt = parseSchedulingBlockDateTime(req.body?.endsAt, timezone);
  if (Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime()) || endsAt <= startsAt) throw createHttpError(400, "Choose a valid start and end.", "VALIDATION_ERROR");
  const recurrenceUntilKey = String(req.body?.recurrenceUntil || "");
  const recurrenceUntil = recurrence === "NONE" ? null : schedulingBlockRecurrenceEnd(recurrenceUntilKey, timezone);
  const recurrenceDays = recurrence === "NONE" ? 0 : schedulingBlockRecurrenceDays(startsAt, recurrenceUntilKey, timezone);
  if (recurrence !== "NONE" && (Number.isNaN(recurrenceUntil.getTime()) || !Number.isInteger(recurrenceDays) || recurrenceDays < 0 || recurrenceDays > 366)) {
    throw createHttpError(400, "Recurring blocks need an end date within one year.", "VALIDATION_ERROR");
  }
  const data = await prisma.schedulingBlock.create({ data: {
    agencyId: req.auth.agencyId,
    userId,
    startsAt,
    endsAt,
    title: String(req.body?.title || "Unavailable").trim().slice(0, 120) || "Unavailable",
    recurrence,
    recurrenceUntil,
  }, include: { user: { select: { id: true, fullName: true } } } });
  res.status(201).json({ data: { ...data, timezone } });
}

export async function deleteSchedulingBlock(req, res) {
  const existing = await prisma.schedulingBlock.findFirst({ where: { id: req.params.id, agencyId: req.auth.agencyId, ...(req.auth.role === "consultant" ? { userId: req.auth.userId } : {}) } });
  if (!existing) throw createHttpError(404, "Availability block not found.", "NOT_FOUND");
  await prisma.schedulingBlock.delete({ where: { id: existing.id } });
  res.json({ data: { id: existing.id } });
}

export async function buildBookingWaitlist(req, statusValue) {
  await releaseExpiredWaitlistHolds(req.auth.agencyId);
  const status = String(statusValue || "Waiting");
  if (!["Waiting", "Offered", "Booked", "Closed", "all"].includes(status)) throw createHttpError(400, "Choose a valid waitlist status.", "VALIDATION_ERROR");
  const data = await prisma.bookingWaitlistEntry.findMany({ where: { agencyId: req.auth.agencyId, ...(status === "all" ? {} : { status }) }, orderBy: { createdAt: "asc" }, take: 250 });
  const typeIds = [...new Set(data.map((item) => item.sessionTypeId))];
  const types = await prisma.bookingSessionType.findMany({ where: { id: { in: typeIds }, agencyId: req.auth.agencyId }, select: { id: true, name: true } });
  const typeMap = new Map(types.map((item) => [item.id, item]));
  return data.map((item) => ({ ...item, sessionType: typeMap.get(item.sessionTypeId) || null }));
}

export async function listBookingWaitlist(req, res) {
  requireAdmin(req);
  res.json({ data: await buildBookingWaitlist(req, req.query.status) });
}

export async function updateBookingWaitlistEntry(req, res) {
  requireAdmin(req);
  const status = String(req.body?.status || "");
  if (!["Waiting", "Offered", "Booked", "Closed"].includes(status)) throw createHttpError(400, "Choose a valid waitlist status.", "VALIDATION_ERROR");
  const existing = await prisma.bookingWaitlistEntry.findFirst({ where: { id: req.params.id, agencyId: req.auth.agencyId } });
  if (!existing) throw createHttpError(404, "Waitlist entry not found.", "NOT_FOUND");
  const data = await prisma.$transaction(async (tx) => {
    const updated = await tx.bookingWaitlistEntry.update({ where: { id: existing.id }, data: { status } });
    if (status === "Closed") await tx.bookingSlotHold.deleteMany({ where: { waitlistEntryId: existing.id, claimedAt: null } });
    return updated;
  });
  res.json({ data });
}

export async function previewBookingEmailTemplate(req, res) {
  requireAdmin(req);
  const kind = String(req.body?.kind || "booked");
  if (!["booked", "reminder", "rescheduled", "cancelled"].includes(kind)) throw createHttpError(400, "Choose a valid email type.", "VALIDATION_ERROR");
  const messageTemplates = req.body?.messageTemplates && typeof req.body.messageTemplates === "object" ? req.body.messageTemplates : null;
  const data = await bookingTemplatePreview({ agencyId: req.auth.agencyId, kind, messageTemplates });
  res.json({ data });
}

export async function testBookingEmailTemplate(req, res) {
  requireAdmin(req);
  const kind = String(req.body?.kind || "booked");
  if (!["booked", "reminder", "rescheduled", "cancelled"].includes(kind)) throw createHttpError(400, "Choose a valid email type.", "VALIDATION_ERROR");
  const messageTemplates = req.body?.messageTemplates && typeof req.body.messageTemplates === "object" ? req.body.messageTemplates : null;
  const data = await sendBookingTemplateTest({ agencyId: req.auth.agencyId, userId: req.auth.userId, kind, messageTemplates });
  res.json({ data });
}

// A suggestion only — nothing is saved here. The booking sheet still
// requires the staff member to accept it (or edit further) before it ever
// reaches the subject that actually gets booked.
export async function shortenAppointmentSubject(req, res) {
  const subject = String(req.body?.subject || "").trim();
  if (!subject) throw createHttpError(400, "Enter a subject to shorten.", "VALIDATION_ERROR");
  const suggestion = await shortenSubjectLine({ subject, maxWords: APPOINTMENT_SUBJECT_MAX_WORDS });
  res.json({ data: { subject: suggestion, maxWords: APPOINTMENT_SUBJECT_MAX_WORDS } });
}
