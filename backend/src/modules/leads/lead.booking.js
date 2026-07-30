import { parsePhoneNumberFromString } from "libphonenumber-js";
import { nextLeadNumber } from "./lead.repository.js";
import { nextConsultationAction } from "./lead.service.js";

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
}) {
  const phoneNormalized = normalizePhoneSafe(guestPhone);
  const emailNormalized = guestEmail ? guestEmail.toLowerCase() : null;
  const paid = paymentStatus === "PAID";
  const sourceName = paid ? "Online Booking (Paid Consultation)" : "Online Booking (Free Consultation)";

  const existingClient = guestEmail ? await tx.client.findFirst({
    where: { agencyId, email: { equals: guestEmail, mode: "insensitive" } },
    select: { id: true },
  }) : null;
  if (existingClient) {
    await tx.appointment.update({ where: { id: appointment.id }, data: { clientId: existingClient.id } });
    return { clientId: existingClient.id, leadId: null };
  }

  const existingLead = await tx.lead.findFirst({
    where: {
      agencyId,
      deletedAt: null,
      status: "OPEN",
      OR: [
        ...(phoneNormalized ? [{ phoneNormalized }] : []),
        ...(emailNormalized ? [{ emailNormalized }] : []),
      ],
    },
  });

  // OPEN leads carry a DB check constraint requiring the next-action fields
  // to be set — compute this before creating the lead, not only in the
  // stage-advance update below, or the insert itself is rejected.
  const next = nextConsultationAction("SCHEDULED", null, appointment.startsAt);

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
      appointmentType: ["Online", "Zoom"].includes(appointment.meetingMode)
        ? "VIDEO"
        : appointment.meetingMode === "Phone"
          ? "PHONE"
          : "IN_PERSON",
      status: "SCHEDULED",
      fee,
      paymentStatus,
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
      version: { increment: 1 },
    },
  });
  if (advanceStage) {
    await tx.leadStageHistory.create({ data: { agencyId, leadId: lead.id, previousStage: lead.stage, newStage: "CONSULTATION_BOOKED", reason: `${paid ? "Paid" : "Free"} consultation booked and confirmed` } });
  }
  await tx.leadFollowUp.create({ data: { agencyId, leadId: lead.id, assignedUserId: appointment.assignedToId, type: next.type, description: next.description, dueAt: next.at } });
  await tx.leadActivity.create({
    data: {
      agencyId,
      leadId: lead.id,
      activityType: "CONSULTATION_BOOKED",
      direction: "INTERNAL",
      channel: "SYSTEM",
      title: `${paid ? "Paid" : "Free"} consultation confirmed`,
      metadata: { consultationId: consultation.id, holdId, appointmentId: appointment.id },
    },
  });

  return { clientId: null, leadId: lead.id };
}
