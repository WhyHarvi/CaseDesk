import { randomUUID } from "node:crypto";
import prisma from "./prisma/client.js";
import { createMailTransport, resolveAgencyMailConfig } from "./agencyMailService.js";
import { logger } from "./logger.js";
import { publicBookingPageUrl } from "./bookingPublicLinkService.js";
import { notifyUsers, schedulingCoordinatorRecipientIds } from "./notificationService.js";
import {
  assertSlotAvailable,
  availabilityForRange,
  localDateKey,
} from "./bookingAvailabilityService.js";
import {
  eligibleSchedulingStaff,
  lockSchedulingTransaction,
} from "./schedulingAssignmentService.js";
import {
  MEETING_MODES,
  assertMeetingModeConfigured,
  meetingModeEnabled,
} from "./bookingMeetingModeService.js";
import { sendAgencyOomaSms } from "./agencyOomaService.js";
import { assertZoomOperational } from "./zoomService.js";

function escapeHtml(value) {
  return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

export async function releaseExpiredWaitlistHolds(agencyId = null) {
  const rows = await prisma.bookingSlotHold.findMany({
    where: { ...(agencyId ? { agencyId } : {}), claimedAt: null, expiresAt: { lte: new Date() } },
    select: { id: true, waitlistEntryId: true, paymentHold: { select: { status: true } } },
  });
  // A waitlist guest may already be in QuickBooks checkout. The payment
  // hold extends the offer window, but retaining this guard prevents a
  // delayed cleanup pass from unlinking an active checkout.
  const expired = rows.filter((item) => !["AwaitingPayment", "Confirming"].includes(item.paymentHold?.status));
  if (!expired.length) return 0;
  await prisma.$transaction(async (tx) => {
    await tx.bookingSlotHold.deleteMany({ where: { id: { in: expired.map((item) => item.id) } } });
    await tx.bookingWaitlistEntry.updateMany({ where: { id: { in: expired.map((item) => item.waitlistEntryId) }, status: "Offered" }, data: { status: "Waiting", offeredStartsAt: null, offerToken: null, offerExpiresAt: null } });
  });
  return expired.length;
}

export async function offerWaitlistOpening(appointment) {
  if (!appointment?.sessionTypeId || !appointment?.startsAt || !appointment?.assignedToId) return null;
  const [settings, sessionType] = await Promise.all([
    prisma.bookingSettings.findUnique({ where: { agencyId: appointment.agencyId }, include: { agency: { select: { name: true, legalName: true } } } }),
    prisma.bookingSessionType.findFirst({ where: { id: appointment.sessionTypeId, agencyId: appointment.agencyId, isActive: true } }),
  ]);
  if (!settings?.waitlistEnabled || !sessionType) return null;
  await releaseExpiredWaitlistHolds(appointment.agencyId);
  const locations = Array.isArray(settings.locations) ? settings.locations : [];
  const startsAt = new Date(appointment.startsAt);
  const endsAt = new Date(appointment.endsAt);
  const dayKey = localDateKey(startsAt, settings.timezone);
  const durationMinutes = Math.max(1, Math.round((endsAt - startsAt) / 60_000));
  const candidateWhere = {
    agencyId: appointment.agencyId,
    sessionTypeId: appointment.sessionTypeId,
    status: "Waiting",
    preferredFrom: { lte: startsAt },
    preferredTo: { gte: endsAt },
    OR: [{ preferredUserId: null }, { preferredUserId: appointment.assignedToId }],
  };
  const eligibleCandidateIds = [];
  const resolvedLocationByCandidate = new Map();
  let candidateCursor = null;
  while (eligibleCandidateIds.length < 10) {
    const possibleCandidates = await prisma.bookingWaitlistEntry.findMany({
      where: {
        ...candidateWhere,
        ...(candidateCursor ? {
          AND: [{
            OR: [
              { createdAt: { gt: candidateCursor.createdAt } },
              { createdAt: candidateCursor.createdAt, id: { gt: candidateCursor.id } },
            ],
          }],
        } : {}),
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: 50,
    });
    if (!possibleCandidates.length) break;
    for (const candidate of possibleCandidates) {
      const candidateMode = candidate.meetingMode;
      if (!meetingModeEnabled(settings, candidateMode)) continue;
      if (sessionType.allowedMeetingModes?.length && !sessionType.allowedMeetingModes.includes(candidateMode)) continue;
      try {
        assertMeetingModeConfigured({
          settings,
          sessionType,
          mode: candidateMode,
          guestPhone: candidate.phone,
        });
        if (candidateMode === MEETING_MODES.ZOOM) await assertZoomOperational(appointment.agencyId);
      } catch {
        continue;
      }

      const sessionLocations = sessionType.allowedLocationIds?.length
        ? locations.filter((location) => sessionType.allowedLocationIds.includes(location.id))
        : locations;
      const resolvedLocationId = candidateMode === MEETING_MODES.IN_PERSON
        ? candidate.locationId || (sessionLocations.length === 1 ? sessionLocations[0].id : null)
        : null;
      if (
        candidateMode === MEETING_MODES.IN_PERSON
        && (!resolvedLocationId || !sessionLocations.some((location) => location.id === resolvedLocationId))
      ) continue;

      const eligibleStaff = await eligibleSchedulingStaff({
        agencyId: appointment.agencyId,
        sessionTypeId: appointment.sessionTypeId,
        publicOnly: true,
        requestedUserId: appointment.assignedToId,
        meetingMode: candidateMode,
      });
      if (!eligibleStaff.length) continue;

      // A cancellation does not necessarily mean the same time remains
      // publicly valid for this candidate: notice windows, office/staff
      // hours, days off, and format configuration may have changed since
      // they joined. Never email an offer the public endpoint would reject.
      const { days } = await availabilityForRange({
        agencyId: appointment.agencyId,
        assignedToId: appointment.assignedToId,
        durationMinutes,
        sessionBufferMinutes: sessionType.bufferMinutes,
        fromKey: dayKey,
        toKey: dayKey,
        locationId: candidateMode === MEETING_MODES.IN_PERSON ? resolvedLocationId : null,
        meetingMode: candidateMode,
      });
      if (!(days[dayKey] || []).some((slot) => slot.startsAt === startsAt.toISOString())) continue;
      eligibleCandidateIds.push(candidate.id);
      resolvedLocationByCandidate.set(candidate.id, resolvedLocationId);
      // Keep a few fallbacks so a concurrent cancellation claiming the
      // oldest candidate does not waste this newly opened seat.
      if (eligibleCandidateIds.length >= 10) break;
    }
    const lastCandidate = possibleCandidates.at(-1);
    candidateCursor = { createdAt: lastCandidate.createdAt, id: lastCandidate.id };
    if (possibleCandidates.length < 50) break;
  }
  if (!eligibleCandidateIds.length) return null;

  const claimed = await prisma.$transaction(async (tx) => {
    // Coordinate with every booking/payment path. Without this lock a new
    // appointment can take the newly freed seat while an offer hold is
    // being inserted, leaving the recipient with an unclaimable offer.
    await lockSchedulingTransaction(tx, appointment.agencyId, startsAt);
    const conflict = await assertSlotAvailable(tx, {
      agencyId: appointment.agencyId,
      assignedToId: appointment.assignedToId,
      startsAt,
      endsAt,
      bufferMinutes: sessionType.bufferMinutes ?? settings.bufferMinutes,
    });
    if (conflict) return null;
    const candidate = await tx.bookingWaitlistEntry.findFirst({
      where: {
        id: { in: eligibleCandidateIds },
        status: "Waiting",
      },
      orderBy: { createdAt: "asc" },
    });
    if (!candidate) return null;
    const offerToken = randomUUID();
    const offerExpiresAt = new Date(Date.now() + 15 * 60_000);
    const resolvedLocationId = resolvedLocationByCandidate.get(candidate.id);
    const result = await tx.bookingWaitlistEntry.updateMany({
      where: { id: candidate.id, status: "Waiting" },
      data: {
        status: "Offered",
        offeredStartsAt: startsAt,
        offerToken,
        offerExpiresAt,
        ...(resolvedLocationId ? { locationId: resolvedLocationId } : {}),
      },
    });
    if (!result.count) return null;
    await tx.bookingSlotHold.create({ data: { agencyId: appointment.agencyId, waitlistEntryId: candidate.id, assignedToId: appointment.assignedToId, sessionTypeId: appointment.sessionTypeId, startsAt: appointment.startsAt, endsAt: appointment.endsAt, claimToken: offerToken, expiresAt: offerExpiresAt } });
    return {
      candidate: resolvedLocationId ? { ...candidate, locationId: resolvedLocationId } : candidate,
      offerToken,
      offerExpiresAt,
    };
  });
  if (!claimed) return null;
  const { candidate, offerToken, offerExpiresAt } = claimed;
  const agencyName = settings.agency.legalName || settings.agency.name;
  const bookingUrl = publicBookingPageUrl(settings, { offerToken });
  const when = new Date(appointment.startsAt).toLocaleString("en-CA", { timeZone: settings.timezone, dateStyle: "full", timeStyle: "short" });
  let emailDelivered = false;
  try {
    const config = await resolveAgencyMailConfig(appointment.agencyId);
    const transport = createMailTransport(config);
    await transport.sendMail({
      from: config.from,
      to: candidate.email,
      subject: `An appointment time opened — ${agencyName}`,
      text: `Hi ${candidate.name},\n\nAn appointment matching your waitlist request is reserved for you until ${offerExpiresAt.toLocaleTimeString("en-CA", { timeZone: settings.timezone, hour: "numeric", minute: "2-digit" })}.\n\nClaim it: ${bookingUrl}\n\n${agencyName}`,
      html: `<div style="background:#f1f5f9;padding:32px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif"><div style="max-width:560px;margin:auto;background:white;border-radius:24px;padding:32px"><p style="color:#0284c7;font-size:12px;font-weight:800;text-transform:uppercase;letter-spacing:.12em">Waitlist opening</p><h1 style="font-size:26px;color:#0f172a">A matching time is reserved for you</h1><p style="color:#475569;line-height:1.65">Hi ${escapeHtml(candidate.name)}, we’re holding <strong>${escapeHtml(when)}</strong> for 15 minutes.</p><a href="${escapeHtml(bookingUrl)}" style="display:inline-block;margin-top:12px;border-radius:999px;background:#0f172a;color:white;text-decoration:none;padding:14px 22px;font-weight:700">Claim appointment →</a><p style="margin-top:26px;color:#94a3b8;font-size:12px">${escapeHtml(agencyName)}</p></div></div>`,
    });
    emailDelivered = true;
  } catch (error) {
    logger.warn("booking.waitlist_offer_email_failed", { waitlistId: candidate.id, reason: error.message });
  }
  let smsDelivered = false;
  if (candidate.phone) {
    try {
      await sendAgencyOomaSms({
        agencyId: appointment.agencyId,
        to: candidate.phone,
        body: `${agencyName}: a ${when} appointment is reserved for you for 15 minutes. Claim it: ${bookingUrl}`,
        idempotencyKey: `waitlist:${candidate.id}:offer:${offerToken}`,
      });
      smsDelivered = true;
    } catch (error) {
      logger.warn("booking.waitlist_offer_sms_failed", { waitlistId: candidate.id, reason: error.message });
    }
  }
  if (!emailDelivered && !smsDelivered) {
    // Do not silently consume the newly opened slot for 15 minutes when
    // every configured client channel failed to deliver the claim link.
    await prisma.$transaction(async (tx) => {
      await tx.bookingSlotHold.deleteMany({ where: { claimToken: offerToken, claimedAt: null } });
      await tx.bookingWaitlistEntry.updateMany({
        where: { id: candidate.id, status: "Offered", offerToken },
        data: { status: "Waiting", offeredStartsAt: null, offerToken: null, offerExpiresAt: null },
      });
    }).catch((rollbackError) => {
      logger.warn("booking.waitlist_offer_release_failed", { waitlistId: candidate.id, reason: rollbackError.message });
    });
    await notifyUsers({
      agencyId: appointment.agencyId,
      recipientIds: await schedulingCoordinatorRecipientIds(appointment.agencyId),
      type: "appointment.waitlist_delivery_failed",
      category: "appointments",
      title: "Waitlist offer could not be delivered",
      body: `${candidate.name} did not receive the offer for ${new Date(appointment.startsAt).toLocaleString("en-CA", { timeZone: settings.timezone })}. The reservation was released.`,
      severity: "critical",
      entityType: "booking_waitlist",
      entityId: candidate.id,
      actionUrl: "/app/dashboard#appointment-register-heading",
      dedupeKey: `appointment-waitlist:${candidate.id}:offer:${offerToken}:failed`,
      channels: ["in_app"],
    }).catch(() => {});
    return null;
  }
  return candidate.id;
}
