import prisma from "./prisma/client.js";
import { createHttpError } from "../utils/http.js";
import { recordAppointmentEvent } from "./appointmentOperationsService.js";
import { notifyUsers } from "./notificationService.js";
import { requireLead } from "../modules/leads/lead.repository.js";
import { moveLeadOwnership, requireLeadStaff, syncLeadNextAction } from "../modules/leads/lead.service.js";
import { canonicalCaseType } from "./workflowService.js";

// A real immigration practice advises across dozens of distinct pathways —
// PSW, PGWP, every family-sponsorship variant, every provincial stream,
// citizenship, refugee/H&C matters, admissibility remedies, and genuinely
// novel situations a fixed list would never anticipate. A hardcoded
// six-option list here would either force everything unusual into a
// meaningless "Other" bucket, or drift out of sync with IRCC's actual
// program list over time. Categories instead run through the same
// canonicalCaseType() the rest of the app already uses for real Case
// records (case creation, workflow templates, document checklists) — a
// known program (or a known alias/typo of one) resolves to its canonical
// name, and anything genuinely new is still accepted as a cleaned free-text
// tag rather than rejected. This also means a category here is already in
// the exact form a real case's caseType would take, so "the client agreed —
// start the case" stays a one-click handoff, not a re-typing exercise.
const MAX_CATEGORIES = 8;

const OUTCOME_LABEL = {
  PROCEEDING: "Client wants to proceed",
  CONSIDERING: "Client is considering",
  DECLINED: "Client declined",
};

const adviceInclude = {
  consultant: { select: { id: true, fullName: true } },
  assignedUser: { select: { id: true, fullName: true } },
  outcomeRecordedBy: { select: { id: true, fullName: true } },
};

function clean(value, max) {
  return String(value ?? "").trim().slice(0, max);
}

function cleanCategories(value) {
  const supplied = Array.isArray(value) ? value : [];
  const canonicalized = supplied.map((item) => canonicalCaseType(clean(item, 80))).filter(Boolean);
  return [...new Set(canonicalized)].slice(0, MAX_CATEGORIES);
}

async function requireAppointmentForAdvice(tx, req, appointmentId) {
  const appointment = await tx.appointment.findFirst({
    where: { id: appointmentId, agencyId: req.auth.agencyId },
    select: { id: true, agencyId: true, subject: true, leadId: true, clientId: true },
  });
  if (!appointment) throw createHttpError(404, "Appointment not found.", "NOT_FOUND");
  return appointment;
}

// Autosave path — no required fields, no side effects on the lead. Upserts
// by appointmentId (one advice record per appointment) so closing the
// curtain mid-draft never loses what the consultant already typed.
export async function saveAppointmentAdviceDraft(req, appointmentId, values) {
  const agencyId = req.auth.agencyId;
  return prisma.$transaction(async (tx) => {
    const appointment = await requireAppointmentForAdvice(tx, req, appointmentId);
    const existing = await tx.appointmentAdvice.findUnique({ where: { appointmentId } });
    const categories = values?.categories !== undefined ? cleanCategories(values.categories) : existing?.categories || [];
    const adviceText = values?.adviceText !== undefined ? clean(values.adviceText, 4000) : existing?.adviceText || "";
    const assignedUserId = values?.assignedUserId !== undefined ? clean(values.assignedUserId, 100) || null : existing?.assignedUserId || null;
    const followUpDateRaw = values?.followUpDate !== undefined ? values.followUpDate : existing?.followUpDate;
    const followUpDate = followUpDateRaw ? new Date(followUpDateRaw) : null;
    if (followUpDate && Number.isNaN(followUpDate.getTime())) throw createHttpError(400, "Choose a valid follow-up date.", "VALIDATION_ERROR");

    const data = {
      agencyId,
      appointmentId: appointment.id,
      leadId: appointment.leadId,
      clientId: appointment.clientId,
      consultantUserId: existing?.consultantUserId || req.auth.userId,
      assignedUserId: assignedUserId || existing?.assignedUserId || req.auth.userId,
      categories,
      adviceText,
      followUpDate: followUpDate || existing?.followUpDate || new Date(),
    };
    const advice = existing
      ? await tx.appointmentAdvice.update({ where: { appointmentId }, data, include: adviceInclude })
      : await tx.appointmentAdvice.create({ data, include: adviceInclude });
    return advice;
  });
}

// "Save and assign" — validates the full form, then (if a lead is linked)
// makes it the lead's advice: reassigns the lead owner to the selected
// employee, creates or updates the handoff follow-up, and logs it. Never
// creates a second lead/follow-up on repeat saves — an existing advice row
// (from an earlier draft or a previous confirm) is updated in place, and an
// existing linked follow-up is updated rather than duplicated.
export async function confirmAppointmentAdvice(req, appointmentId, values) {
  const agencyId = req.auth.agencyId;
  const actorId = req.auth.userId;

  const adviceText = clean(values?.adviceText, 4000);
  if (!adviceText) throw createHttpError(400, "Enter the advice given to the client.", "VALIDATION_ERROR");
  const categories = cleanCategories(values?.categories);
  if (!categories.length) throw createHttpError(400, "Choose at least one category.", "VALIDATION_ERROR");
  const assignedUserId = clean(values?.assignedUserId, 100);
  if (!assignedUserId) throw createHttpError(400, "Select who should contact the client.", "VALIDATION_ERROR");
  const followUpDate = values?.followUpDate ? new Date(values.followUpDate) : null;
  if (!followUpDate || Number.isNaN(followUpDate.getTime())) throw createHttpError(400, "Choose a follow-up date.", "VALIDATION_ERROR");

  const result = await prisma.$transaction(async (tx) => {
    const appointment = await requireAppointmentForAdvice(tx, req, appointmentId);
    const assignee = await requireLeadStaff(tx, agencyId, assignedUserId);
    const existing = await tx.appointmentAdvice.findUnique({ where: { appointmentId: appointment.id } });

    let advice = await tx.appointmentAdvice.upsert({
      where: { appointmentId: appointment.id },
      create: {
        agencyId,
        appointmentId: appointment.id,
        leadId: appointment.leadId,
        clientId: appointment.clientId,
        consultantUserId: actorId,
        assignedUserId,
        categories,
        adviceText,
        followUpDate,
      },
      update: { assignedUserId, categories, adviceText, followUpDate },
      include: adviceInclude,
    });

    let lead = null;
    let followUp = null;
    if (appointment.leadId) {
      // Never a duplicate: the appointment already has a lead, so every
      // save updates that same lead — it's never re-created or re-matched.
      lead = await requireLead(tx, req, appointment.leadId);
      lead = await moveLeadOwnership(tx, {
        agencyId,
        lead,
        ownerUserId: assignedUserId,
        actorId,
        reason: `Post-consultation advice handoff: ${categories.join(", ")}`,
        assignmentType: "REASSIGNMENT",
      });

      const followUpDescription = `Call client regarding ${categories.join(", ")} advice`;
      followUp = existing?.followUpId
        ? await tx.leadFollowUp.update({
            where: { id: existing.followUpId },
            data: { assignedUserId, dueAt: followUpDate, description: followUpDescription },
          })
        : await tx.leadFollowUp.create({
            data: {
              agencyId,
              leadId: lead.id,
              assignedUserId,
              type: "PHONE_CALL",
              description: followUpDescription,
              dueAt: followUpDate,
              status: "PENDING",
            },
          });
      if (!existing?.followUpId) {
        // Re-fetch with the same include shape so the function's return
        // value reflects the followUpId just written, not the stale
        // pre-update snapshot from the upsert() above.
        advice = await tx.appointmentAdvice.update({ where: { id: advice.id }, data: { followUpId: followUp.id }, include: adviceInclude });
      }
      await syncLeadNextAction(tx, lead.id);

      await tx.leadActivity.create({
        data: {
          agencyId,
          leadId: lead.id,
          activityType: "ADVICE_RECORDED",
          direction: "INTERNAL",
          channel: "SYSTEM",
          title: `Consultant advised: ${categories.join(", ")}`,
          description: adviceText,
          performedById: actorId,
          metadata: { appointmentId: appointment.id, adviceId: advice.id, followUpId: followUp.id, assignedUserId, categories },
        },
      });
      await tx.activityLog.create({
        data: {
          agencyId,
          userId: actorId,
          action: "lead.advice_recorded",
          details: `${lead.leadNumber}: ${categories.join(", ")} advice — assigned to ${assignee.fullName}`,
          entityType: "lead",
          entityId: lead.id,
          metadata: { appointmentId: appointment.id, adviceId: advice.id, followUpId: followUp.id },
        },
      });
    }

    await recordAppointmentEvent(tx, {
      agencyId,
      appointmentId: appointment.id,
      actorUserId: actorId,
      type: "ADVICE_RECORDED",
      summary: appointment.leadId ? "Post-consultation advice recorded and assigned" : "Post-consultation advice recorded",
      metadata: { adviceId: advice.id, categories, assignedUserId },
    });

    return { advice, lead, followUp, appointment };
  });

  if (result.lead) {
    await notifyUsers({
      agencyId,
      recipientIds: [result.advice.assignedUserId],
      actorUserId: actorId,
      type: "lead.advice_assigned",
      category: "leads",
      title: `Advice handoff: ${result.lead.leadNumber}`,
      body: `${result.advice.categories.join(", ")} — call by ${result.advice.followUpDate.toDateString()}`,
      severity: "info",
      entityType: "lead",
      entityId: result.lead.id,
      actionUrl: `/leads?lead=${encodeURIComponent(result.lead.id)}`,
      dedupeKey: `appointment-advice:${result.advice.id}:assigned:${result.advice.assignedUserId}:${result.advice.updatedAt.getTime()}`,
    });
  }

  return result.advice;
}

// The lead-curtain "Add call result" action — records what happened when the
// assigned employee actually called, and closes the handoff follow-up this
// advice created (if it's still pending). Doesn't touch adviceText/categories
// — the consultant's original advice is never rewritten by this.
export async function recordAppointmentAdviceOutcome(req, leadId, adviceId, outcome) {
  if (!OUTCOME_LABEL[outcome]) throw createHttpError(400, "Choose a valid call result.", "VALIDATION_ERROR");
  const agencyId = req.auth.agencyId;
  const actorId = req.auth.userId;

  return prisma.$transaction(async (tx) => {
    const lead = await requireLead(tx, req, leadId);
    const advice = await tx.appointmentAdvice.findFirst({ where: { id: adviceId, agencyId, leadId: lead.id } });
    if (!advice) throw createHttpError(404, "Advice record not found.", "NOT_FOUND");

    const updated = await tx.appointmentAdvice.update({
      where: { id: advice.id },
      data: { outcome, outcomeRecordedAt: new Date(), outcomeRecordedById: actorId },
      include: adviceInclude,
    });

    if (advice.followUpId) {
      const followUp = await tx.leadFollowUp.findFirst({ where: { id: advice.followUpId, agencyId } });
      if (followUp && followUp.status === "PENDING") {
        await tx.leadFollowUp.update({
          where: { id: followUp.id },
          data: { status: "COMPLETED", completionOutcome: OUTCOME_LABEL[outcome], completedAt: new Date(), completedById: actorId },
        });
        await syncLeadNextAction(tx, lead.id);
      }
    }

    await tx.leadActivity.create({
      data: {
        agencyId,
        leadId: lead.id,
        activityType: "ADVICE_OUTCOME_RECORDED",
        direction: "INTERNAL",
        channel: "SYSTEM",
        outcome,
        title: `Call result: ${OUTCOME_LABEL[outcome]}`,
        description: `Advice: ${advice.categories.join(", ")}`,
        performedById: actorId,
        metadata: { adviceId: advice.id, appointmentId: advice.appointmentId },
      },
    });
    await tx.activityLog.create({
      data: {
        agencyId,
        userId: actorId,
        action: "lead.advice_outcome_recorded",
        details: `${lead.leadNumber}: ${OUTCOME_LABEL[outcome]}`,
        entityType: "lead",
        entityId: lead.id,
        metadata: { adviceId: advice.id },
      },
    });

    return updated;
  });
}
