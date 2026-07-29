import { randomUUID } from "node:crypto";
import prisma from "./prisma/client.js";
import { createMailTransport, resolveAgencyMailConfig } from "./agencyMailService.js";
import { logger } from "./logger.js";
import { publicBookingPageUrl } from "./bookingPublicLinkService.js";

function escapeHtml(value) {
  return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

export async function releaseExpiredWaitlistHolds(agencyId = null) {
  const expired = await prisma.bookingSlotHold.findMany({ where: { ...(agencyId ? { agencyId } : {}), claimedAt: null, expiresAt: { lte: new Date() } }, select: { id: true, waitlistEntryId: true } });
  if (!expired.length) return 0;
  await prisma.$transaction(async (tx) => {
    await tx.bookingSlotHold.deleteMany({ where: { id: { in: expired.map((item) => item.id) } } });
    await tx.bookingWaitlistEntry.updateMany({ where: { id: { in: expired.map((item) => item.waitlistEntryId) }, status: "Offered" }, data: { status: "Waiting", offeredStartsAt: null, offerToken: null, offerExpiresAt: null } });
  });
  return expired.length;
}

export async function offerWaitlistOpening(appointment) {
  if (!appointment?.sessionTypeId || !appointment?.startsAt || !appointment?.assignedToId) return null;
  const settings = await prisma.bookingSettings.findUnique({ where: { agencyId: appointment.agencyId }, include: { agency: { select: { name: true, legalName: true } } } });
  if (!settings?.waitlistEnabled) return null;
  await releaseExpiredWaitlistHolds(appointment.agencyId);
  const locations = Array.isArray(settings.locations) ? settings.locations : [];
  const locationId = locations.find((item) => `${item.name} — ${item.address}` === appointment.location)?.id || null;
  const candidate = await prisma.bookingWaitlistEntry.findFirst({
    where: {
      agencyId: appointment.agencyId,
      sessionTypeId: appointment.sessionTypeId,
      status: "Waiting",
      preferredFrom: { lte: appointment.startsAt },
      preferredTo: { gte: appointment.endsAt },
      meetingMode: appointment.meetingMode,
      AND: [
        ...(appointment.assignedToId ? [{ OR: [{ preferredUserId: null }, { preferredUserId: appointment.assignedToId }] }] : []),
        ...(locationId ? [{ OR: [{ locationId: null }, { locationId }] }] : []),
      ],
    },
    orderBy: { createdAt: "asc" },
  });
  if (!candidate) return null;
  const offerToken = randomUUID();
  const offerExpiresAt = new Date(Date.now() + 15 * 60_000);
  const claimed = await prisma.$transaction(async (tx) => {
    const result = await tx.bookingWaitlistEntry.updateMany({ where: { id: candidate.id, status: "Waiting" }, data: { status: "Offered", offeredStartsAt: appointment.startsAt, offerToken, offerExpiresAt } });
    if (!result.count) return false;
    await tx.bookingSlotHold.create({ data: { agencyId: appointment.agencyId, waitlistEntryId: candidate.id, assignedToId: appointment.assignedToId, sessionTypeId: appointment.sessionTypeId, startsAt: appointment.startsAt, endsAt: appointment.endsAt, claimToken: offerToken, expiresAt: offerExpiresAt } });
    return true;
  });
  if (!claimed) return null;
  try {
    const config = await resolveAgencyMailConfig(appointment.agencyId);
    const transport = createMailTransport(config);
    const agencyName = settings.agency.legalName || settings.agency.name;
    const bookingUrl = publicBookingPageUrl(settings, { offerToken });
    const when = new Date(appointment.startsAt).toLocaleString("en-CA", { timeZone: settings.timezone, dateStyle: "full", timeStyle: "short" });
    await transport.sendMail({
      from: config.from,
      to: candidate.email,
      subject: `An appointment time opened — ${agencyName}`,
      text: `Hi ${candidate.name},\n\nAn appointment matching your waitlist request is reserved for you until ${offerExpiresAt.toLocaleTimeString("en-CA", { timeZone: settings.timezone, hour: "numeric", minute: "2-digit" })}.\n\nClaim it: ${bookingUrl}\n\n${agencyName}`,
      html: `<div style="background:#f1f5f9;padding:32px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif"><div style="max-width:560px;margin:auto;background:white;border-radius:24px;padding:32px"><p style="color:#0284c7;font-size:12px;font-weight:800;text-transform:uppercase;letter-spacing:.12em">Waitlist opening</p><h1 style="font-size:26px;color:#0f172a">A matching time is reserved for you</h1><p style="color:#475569;line-height:1.65">Hi ${escapeHtml(candidate.name)}, we’re holding <strong>${escapeHtml(when)}</strong> for 15 minutes.</p><a href="${escapeHtml(bookingUrl)}" style="display:inline-block;margin-top:12px;border-radius:999px;background:#0f172a;color:white;text-decoration:none;padding:14px 22px;font-weight:700">Claim appointment →</a><p style="margin-top:26px;color:#94a3b8;font-size:12px">${escapeHtml(agencyName)}</p></div></div>`,
    });
  } catch (error) {
    logger.warn("booking.waitlist_offer_email_failed", { waitlistId: candidate.id, reason: error.message });
  }
  return candidate.id;
}
