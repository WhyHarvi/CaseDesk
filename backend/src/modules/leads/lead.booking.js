import { parsePhoneNumberFromString } from "libphonenumber-js";
import { nextLeadNumber } from "./lead.repository.js";
import { nextConsultationAction } from "./lead.service.js";

const STAGE_ORDER = ["NEW", "ASSIGNED", "CONTACTING", "CONNECTED", "QUALIFIED", "CONSULTATION_BOOKED", "CONSULTATION_COMPLETED", "RETAINER_PENDING", "PAYMENT_PENDING", "READY_TO_CONVERT"];
const BOOKING_SOURCE_NAME = "Online Booking (Paid Consultation)";

function normalizePhoneSafe(phone) {
  if (!phone) return null;
  try {
    const parsed = parsePhoneNumberFromString(phone, "CA");
    return parsed?.isValid() ? parsed.number : null;
  } catch {
    return null;
  }
}

async function ensureBookingLeadSource(tx, agencyId) {
  return tx.leadSource.upsert({
    where: { agencyId_name: { agencyId, name: BOOKING_SOURCE_NAME } },
    create: { agencyId, name: BOOKING_SOURCE_NAME, type: "WEBSITE" },
    update: {},
  });
}

/**
 * Called once a BookingPaymentHold's payment is confirmed and its
 * Appointment has been created. Not modeled on createLead(req) — that
 * function needs req.body-shaped input and throws on contact duplicates,
 * both wrong for a system-triggered creation firing after money has
 * already changed hands. Modeled instead on lead.intake.worker.js's
 * processClaimed(): build the Lead/activity rows directly, with
 * non-throwing duplicate detection — link to an existing open lead or
 * attach an already-converted client instead of ever failing here.
 */
export async function createOrLinkLeadForPaidConsultation(tx, { agencyId, hold, appointment }) {
  const phoneNormalized = normalizePhoneSafe(hold.guestPhone);
  const emailNormalized = hold.guestEmailNormalized;

  const existingClient = await tx.client.findFirst({
    where: { agencyId, email: { equals: hold.guestEmail, mode: "insensitive" } },
    select: { id: true },
  });
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
    const source = await ensureBookingLeadSource(tx, agencyId);
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
        emailNormalized,
        ownerUserId: hold.assignedToId,
        originalSourceId: source.id,
        status: "OPEN",
        stage: "NEW",
        priority: "NORMAL",
        temperature: "WARM",
        initialMessage: hold.notes || null,
        nextActionType: next.type,
        nextActionDescription: next.description,
        nextActionAt: next.at,
        nextActionOwnerId: hold.assignedToId,
      },
    });
    await tx.leadActivity.create({
      data: {
        agencyId,
        leadId: lead.id,
        activityType: "LEAD_CREATED",
        direction: "INTERNAL",
        channel: "WEBSITE",
        title: "Lead created from a paid consultation booking",
        metadata: { holdId: hold.id },
      },
    });
    await tx.leadStageHistory.create({ data: { agencyId, leadId: lead.id, newStage: "NEW", reason: "Created from a paid consultation booking" } });
    await tx.leadAssignmentHistory.create({ data: { agencyId, leadId: lead.id, newOwnerId: hold.assignedToId, assignmentType: "SYSTEM", reason: "Assigned to the booked consultant" } });
    await tx.activityLog.create({ data: { agencyId, action: "lead.created_from_paid_booking", details: `Created ${leadNumber} from a paid consultation booking`, entityType: "lead", entityId: lead.id, metadata: { holdId: hold.id } } });
  }

  await tx.appointment.update({ where: { id: appointment.id }, data: { leadId: lead.id } });
  const consultation = await tx.leadConsultation.create({
    data: {
      agencyId,
      leadId: lead.id,
      consultantUserId: hold.assignedToId,
      createdById: hold.assignedToId,
      appointmentId: appointment.id,
      startAt: appointment.startsAt,
      endAt: appointment.endsAt,
      appointmentType: appointment.meetingMode === "Online" ? "VIDEO" : "IN_PERSON",
      status: "SCHEDULED",
      fee: hold.amount,
      paymentStatus: "PAID",
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
      nextActionOwnerId: hold.assignedToId,
      version: { increment: 1 },
    },
  });
  if (advanceStage) {
    await tx.leadStageHistory.create({ data: { agencyId, leadId: lead.id, previousStage: lead.stage, newStage: "CONSULTATION_BOOKED", reason: "Paid consultation booked and confirmed" } });
  }
  await tx.leadFollowUp.create({ data: { agencyId, leadId: lead.id, assignedUserId: hold.assignedToId, type: next.type, description: next.description, dueAt: next.at } });
  await tx.leadActivity.create({
    data: {
      agencyId,
      leadId: lead.id,
      activityType: "CONSULTATION_BOOKED",
      direction: "INTERNAL",
      channel: "SYSTEM",
      title: "Paid consultation confirmed",
      metadata: { consultationId: consultation.id, holdId: hold.id },
    },
  });

  return { clientId: null, leadId: lead.id };
}
