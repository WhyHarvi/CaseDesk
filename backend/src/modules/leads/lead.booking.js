import { parsePhoneNumberFromString } from "libphonenumber-js";
import prisma from "../../services/prisma/client.js";
import { logger } from "../../services/logger.js";
import { nextLeadNumber } from "./lead.repository.js";
import { nextConsultationAction } from "./lead.service.js";
import { leadConsultationAppointmentType, leadConsultationStatusForAppointment } from "../../services/leadConsultationAppointmentService.js";
import { sendAbandonedBookingPaymentEmail } from "../../services/bookingNotificationService.js";

const STAGE_ORDER = ["NEW", "ASSIGNED", "CONTACTING", "CONNECTED", "QUALIFIED", "CONSULTATION_BOOKED", "CONSULTATION_COMPLETED", "RETAINER_PENDING", "PAYMENT_PENDING", "READY_TO_CONVERT"];

function normalizePhoneSafe(phone) {
  if (!phone) return null;
  try {
    const parsed = parsePhoneNumberFromString(phone, "CA");
    return parsed?.isValid() ? parsed.number : null;
  } catch {
    return null;
  }
}

async function ensureBookingLeadSource(tx, agencyId, name) {
  return tx.leadSource.upsert({
    where: { agencyId_name: { agencyId, name } },
    create: { agencyId, name, type: "WEBSITE" },
    update: {},
  });
}

/**
 * Called once a booked consultation is real and confirmed — either a paid
 * BookingPaymentHold clearing (quickbooksWebhookService.js's
 * confirmPaymentHold) or a free public booking completing outright
 * (publicBookingController.js's createPublicBooking). Not modeled on
 * createLead(req) — that function needs req.body-shaped input and throws
 * on contact duplicates, both wrong for a system-triggered creation firing
 * after a booking already exists. Modeled instead on
 * lead.intake.worker.js's processClaimed(): build the Lead/activity rows
 * directly, with non-throwing duplicate detection — link to an existing
 * open lead or attach an already-converted client instead of ever failing
 * here.
 */
export async function createOrLinkLeadForConsultation(tx, {
  agencyId,
  appointment,
  guestName,
  guestEmail,
  guestPhone,
  paymentStatus = "UNPAID",
  fee = null,
  holdId = null,
  leadId = null,
}) {
  const phoneNormalized = normalizePhoneSafe(guestPhone);
  const emailNormalized = guestEmail ? guestEmail.toLowerCase() : null;
  const paid = paymentStatus === "PAID";
  const sourceName = paid ? "Online Booking (Paid Consultation)" : "Online Booking (Free Consultation)";
  // This function can also run later as a repair/reconciliation operation.
  // Timeline records must reflect when the appointment was actually booked,
  // not when the lead link happened to be created.
  const bookingOccurredAt = appointment.createdAt ? new Date(appointment.createdAt) : new Date();

  // Email is more specific than phone (families may share a phone number),
  // so only fall back to phone when the exact normalized email has no open
  // lead. This also makes website-lead → booking linkage deterministic.
  let existingLead = leadId ? await tx.lead.findFirst({
    where: { id: leadId, agencyId, deletedAt: null, status: "OPEN", convertedClientId: null },
  }) : emailNormalized ? await tx.lead.findFirst({
    where: { agencyId, deletedAt: null, status: "OPEN", emailNormalized },
    orderBy: { createdAt: "desc" },
  }) : null;
  if (!existingLead && !leadId && phoneNormalized) {
    existingLead = await tx.lead.findFirst({
      where: { agencyId, deletedAt: null, status: "OPEN", phoneNormalized },
      orderBy: { createdAt: "desc" },
    });
  }

  const existingClient = guestEmail ? await tx.client.findFirst({
    where: { agencyId, email: { equals: guestEmail, mode: "insensitive" } },
    select: { id: true },
  }) : null;
  if (existingClient) {
    await tx.appointment.update({ where: { id: appointment.id }, data: { clientId: existingClient.id } });
    if (holdId) {
      await tx.bookingPaymentHold.updateMany({
        where: { id: holdId, agencyId, clientId: null },
        data: { clientId: existingClient.id },
      });
    }
    // An existing Client and an open pre-conversion Lead may legitimately
    // coexist (for example, a returning client submits a new website lead).
    // Link the appointment to both; only stop here when no open lead exists.
    if (!existingLead) return { clientId: existingClient.id, leadId: null };
  }

  // OPEN leads carry a DB check constraint requiring the next-action fields
  // to be set — compute this before creating the lead, not only in the
  // stage-advance update below, or the insert itself is rejected.
  const consultationStatus = leadConsultationStatusForAppointment(appointment.status);
  const next = nextConsultationAction(consultationStatus, null, appointment.startsAt);

  let lead = existingLead;
  if (!lead) {
    const source = await ensureBookingLeadSource(tx, agencyId, sourceName);
    const leadNumber = await nextLeadNumber(tx, agencyId);
    const nameParts = String(guestName || "").trim().split(/\s+/);
    lead = await tx.lead.create({
      data: {
        agencyId,
        leadNumber,
        firstName: nameParts[0] || guestName,
        lastName: nameParts.slice(1).join(" ") || null,
        phone: guestPhone,
        phoneNormalized,
        email: guestEmail,
        emailNormalized,
        ownerUserId: appointment.assignedToId,
        originalSourceId: source.id,
        status: "OPEN",
        stage: "NEW",
        priority: "NORMAL",
        temperature: "WARM",
        nextActionType: next.type,
        nextActionDescription: next.description,
        nextActionAt: next.at,
        nextActionOwnerId: appointment.assignedToId,
      },
    });
    await tx.leadActivity.create({
      data: {
        agencyId,
        leadId: lead.id,
        activityType: "LEAD_CREATED",
        direction: "INTERNAL",
        channel: "WEBSITE",
        title: `Lead created from a ${paid ? "paid" : "free"} consultation booking`,
        metadata: { holdId, appointmentId: appointment.id },
      },
    });
    await tx.leadStageHistory.create({ data: { agencyId, leadId: lead.id, newStage: "NEW", reason: `Created from a ${paid ? "paid" : "free"} consultation booking` } });
    await tx.leadAssignmentHistory.create({ data: { agencyId, leadId: lead.id, newOwnerId: appointment.assignedToId, assignmentType: "SYSTEM", reason: "Assigned to the booked consultant" } });
    await tx.activityLog.create({ data: { agencyId, action: "lead.created_from_booking", details: `Created ${leadNumber} from a ${paid ? "paid" : "free"} consultation booking`, entityType: "lead", entityId: lead.id, metadata: { holdId, appointmentId: appointment.id } } });
  }

  await tx.appointment.update({ where: { id: appointment.id }, data: { leadId: lead.id } });
  const consultation = await tx.leadConsultation.create({
    data: {
      agencyId,
      leadId: lead.id,
      consultantUserId: appointment.assignedToId,
      createdById: appointment.assignedToId,
      appointmentId: appointment.id,
      startAt: appointment.startsAt,
      endAt: appointment.endsAt,
      appointmentType: leadConsultationAppointmentType(appointment.meetingMode),
      status: consultationStatus,
      fee,
      paymentStatus,
      createdAt: bookingOccurredAt,
    },
  });

  const advanceStage = STAGE_ORDER.indexOf(lead.stage) < STAGE_ORDER.indexOf("CONSULTATION_BOOKED");
  await tx.lead.update({
    where: { id: lead.id },
    data: {
      ...(advanceStage ? { stage: "CONSULTATION_BOOKED" } : {}),
      nextActionType: next.type,
      nextActionDescription: next.description,
      nextActionAt: next.at,
      nextActionOwnerId: appointment.assignedToId,
      firstContactAt: lead.firstContactAt || bookingOccurredAt,
      firstConnectedAt: lead.firstConnectedAt || bookingOccurredAt,
      lastContactAt: bookingOccurredAt,
      version: { increment: 1 },
    },
  });
  if (advanceStage) {
    await tx.leadStageHistory.create({ data: { agencyId, leadId: lead.id, previousStage: lead.stage, newStage: "CONSULTATION_BOOKED", reason: `${paid ? "Paid" : "Free"} consultation booked and confirmed`, createdAt: bookingOccurredAt } });
  }
  await tx.leadFollowUp.updateMany({
    where: { leadId: lead.id, status: "PENDING", type: "CALL", description: "Contact the new lead" },
    data: { status: "COMPLETED", completedAt: bookingOccurredAt, completionOutcome: "Consultation booked" },
  });
  await tx.leadFollowUp.create({ data: { agencyId, leadId: lead.id, assignedUserId: appointment.assignedToId, type: next.type, description: next.description, dueAt: next.at } });
  await tx.leadActivity.create({
    data: {
      agencyId,
      leadId: lead.id,
      activityType: "CONSULTATION_BOOKED",
      direction: "INTERNAL",
      channel: "SYSTEM",
      title: `${paid ? "Paid" : "Free"} consultation confirmed`,
      occurredAt: bookingOccurredAt,
      metadata: { consultationId: consultation.id, holdId, appointmentId: appointment.id },
    },
  });

  return { clientId: existingClient?.id || null, leadId: lead.id };
}

/**
 * A public paid-booking visitor who never completes checkout leaves behind
 * only a BookingPaymentHold — no Appointment is ever created for it (see
 * createPaymentHoldForPublicBooking), so unlike createOrLinkLeadForConsultation
 * above there's no appointment to hand this a scheduling snapshot or hang a
 * LeadConsultation off of. Called once a hold has settled into a terminal
 * unpaid state (Expired or Voided) from releaseExpiredPaymentHolds and both
 * "invoice voided" branches in quickbooksWebhookService.js, so their contact
 * info isn't simply lost.
 *
 * Idempotent on the Lead itself (via hold.leadId), but callable more than
 * once per hold on purpose — releaseExpiredPaymentHolds calls this right
 * away with sendEmail:false (there's a void grace period now, so a hold
 * that just expired might still revive; only the CRM lead/follow-up task
 * is safe to create immediately), then attemptVoid calls it again once the
 * void actually succeeds to send the client-facing email exactly once, at
 * the point the checkout is genuinely, irreversibly dead.
 */
export async function captureAbandonedPublicBookingLead(agencyId, holdId, { sendEmail = true } = {}) {
  const result = await prisma.$transaction(async (tx) => {
    // None of this function's callers check their own status-flip update's
    // affected-row count before calling here, so two of them can race on the
    // same hold (e.g. the webhook handler and a reconcile poll firing close
    // together) — this lock plus the re-fetch-and-check below is what
    // actually prevents a duplicate Lead, not just the leadId check alone.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`booking_payment_hold_lead:${holdId}`}, 0))`;

    const hold = await tx.bookingPaymentHold.findFirst({ where: { id: holdId, agencyId }, include: { sessionType: { select: { name: true } } } });
    if (!hold || hold.source !== "Public" || hold.appointmentId || !["Expired", "Voided"].includes(hold.status)) {
      return { leadId: hold?.leadId || null, created: false, hold: null };
    }
    if (hold.leadId) {
      // Lead already captured by an earlier call on this same hold — just
      // hand back the hold so the caller can still (maybe) send the email.
      return { leadId: hold.leadId, created: false, hold };
    }

    const phoneNormalized = normalizePhoneSafe(hold.guestPhone);
    const now = new Date();

    // Portal bookings already carry a verified Client link. An expired
    // checkout from a known client is client activity, not a new sales lead.
    // Use the hold as the activity entity so retries remain idempotent.
    if (hold.clientId) {
      const priorActivity = await tx.activityLog.findFirst({
        where: {
          agencyId,
          clientId: hold.clientId,
          action: "client.booking_checkout_abandoned",
          entityType: "bookingPaymentHold",
          entityId: hold.id,
        },
        select: { id: true },
      });
      if (!priorActivity) {
        await tx.activityLog.create({
          data: {
            agencyId,
            clientId: hold.clientId,
            action: "client.booking_checkout_abandoned",
            details: `${hold.sessionType?.name || "Consultation"} checkout was started but not completed`,
            entityType: "bookingPaymentHold",
            entityId: hold.id,
            metadata: { holdId: hold.id, status: hold.status },
          },
        });
      }
      return { leadId: null, created: false, hold: null };
    }

    let existingLead = hold.guestEmailNormalized ? await tx.lead.findFirst({
      where: { agencyId, deletedAt: null, status: "OPEN", emailNormalized: hold.guestEmailNormalized },
      orderBy: { createdAt: "desc" },
    }) : null;
    if (!existingLead && phoneNormalized) {
      existingLead = await tx.lead.findFirst({
        where: { agencyId, deletedAt: null, status: "OPEN", phoneNormalized },
        orderBy: { createdAt: "desc" },
      });
    }

    let lead = existingLead;
    if (lead) {
      await tx.leadActivity.create({
        data: {
          agencyId,
          leadId: lead.id,
          activityType: "INTERNAL_NOTE",
          direction: "INTERNAL",
          channel: "WEBSITE",
          title: "Started but did not complete a paid consultation booking",
          description: hold.notes || null,
          metadata: { holdId },
        },
      });
      if (!lead.nextActionAt || lead.nextActionAt > now) {
        await tx.lead.update({
          where: { id: lead.id },
          data: { nextActionType: "CALL", nextActionDescription: "Follow up — payment wasn't completed for a requested consultation", nextActionAt: now, version: { increment: 1 } },
        });
        await tx.leadFollowUp.create({
          data: { agencyId, leadId: lead.id, assignedUserId: lead.nextActionOwnerId || hold.assignedToId, type: "CALL", description: "Follow up — payment wasn't completed for a requested consultation", dueAt: now },
        });
      }
    } else {
      const source = await ensureBookingLeadSource(tx, agencyId, "Online Booking (Payment Abandoned)");
      const leadNumber = await nextLeadNumber(tx, agencyId);
      const nameParts = String(hold.guestName || "").trim().split(/\s+/);
      lead = await tx.lead.create({
        data: {
          agencyId,
          leadNumber,
          firstName: nameParts[0] || hold.guestName,
          lastName: nameParts.slice(1).join(" ") || null,
          phone: hold.guestPhone,
          phoneNormalized,
          email: hold.guestEmail,
          emailNormalized: hold.guestEmailNormalized,
          initialMessage: hold.notes || null,
          estimatedValue: hold.amount,
          ownerUserId: hold.assignedToId,
          originalSourceId: source.id,
          status: "OPEN",
          stage: "NEW",
          priority: "NORMAL",
          temperature: "WARM",
          nextActionType: "CALL",
          nextActionDescription: "Follow up — payment wasn't completed for a requested consultation",
          nextActionAt: now,
          nextActionOwnerId: hold.assignedToId,
          // Deliberately not set: notificationScheduler.js fires a
          // "first response breached" critical alert the moment
          // firstContactDueAt is in the past, and there's no real SLA
          // commitment for this lead type to breach — nextActionAt above
          // already drives its own due-today follow-up correctly.
          // createOrLinkLeadForConsultation (this file's sibling for
          // confirmed bookings) leaves it unset for the same reason.
        },
      });
      await tx.leadActivity.create({
        data: {
          agencyId,
          leadId: lead.id,
          activityType: "LEAD_CREATED",
          direction: "INTERNAL",
          channel: "WEBSITE",
          title: "Lead created from an abandoned paid consultation booking",
          metadata: { holdId },
        },
      });
      await tx.leadStageHistory.create({ data: { agencyId, leadId: lead.id, newStage: "NEW", reason: "Created from an abandoned paid consultation booking" } });
      await tx.leadAssignmentHistory.create({ data: { agencyId, leadId: lead.id, newOwnerId: hold.assignedToId, assignmentType: "SYSTEM", reason: "Assigned to the requested consultant" } });
      await tx.leadFollowUp.create({ data: { agencyId, leadId: lead.id, assignedUserId: hold.assignedToId, type: "CALL", description: "Follow up — payment wasn't completed for a requested consultation", dueAt: now } });
      await tx.activityLog.create({ data: { agencyId, action: "lead.created_from_abandoned_booking", details: `Created ${leadNumber} from an abandoned paid consultation booking`, entityType: "lead", entityId: lead.id, metadata: { holdId } } });
    }

    await tx.bookingPaymentHold.update({ where: { id: hold.id }, data: { leadId: lead.id } });
    return { leadId: lead.id, created: !existingLead, hold };
  });

  // Outside the transaction since a network call to SMTP has no business
  // holding the advisory lock open, and a mail hiccup must never undo the
  // lead capture that already committed. result.hold is only populated for
  // an applicable hold (not a not-found/wrong-status one); sendEmail is
  // what actually controls whether this specific call sends it.
  if (result.hold && sendEmail) {
    await sendAbandonedBookingPaymentEmail({ agencyId, hold: result.hold, sessionType: result.hold.sessionType }).catch((error) => {
      logger.warn("booking_payment_hold.abandoned_email_failed", { agencyId, holdId, reason: error.message });
    });
  }
  return { leadId: result.leadId, created: result.created };
}
