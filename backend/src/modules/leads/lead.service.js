import prisma from "../../services/prisma/client.js";
import { createHttpError } from "../../utils/http.js";
import { nextClientNumber } from "../../services/clientNumberService.js";
import { canCreateLead, leadAccessWhere } from "./lead.permissions.js";
import { nextLeadNumber, requireLead } from "./lead.repository.js";
import { parseCommercialStatus, parseCreateConsultation, parseCreateLead, parseLeadActivity, parseLeadAssignment, parseLeadConversion, parseLeadFollowUp, parseLeadFollowUpOutcome, parseLeadListQuery, parseLeadLost, parseLeadNurture, parseLeadQualification, parseUpdateConsultation } from "./lead.validation.js";
import { DEFAULT_LEAD_SOURCES } from "./lead.constants.js";
import { assertNoContactDuplicate, lockAgencyContactIntake } from "../../services/contactDuplicateService.js";
import { notifyUsers } from "../../services/notificationService.js";
import { assertSlotAvailable } from "../../services/bookingAvailabilityService.js";
import { lockSchedulingTransaction } from "../../services/schedulingAssignmentService.js";
import { sendBookingMessages } from "../../services/bookingNotificationService.js";

const leadInclude = {
  owner: { select: { id: true, fullName: true, email: true } },
  nextActionOwner: { select: { id: true, fullName: true } },
  originalSource: { select: { id: true, name: true, type: true } },
  campaign: { select: { id: true, name: true } },
};

const leadTransactionOptions = {
  maxWait: 10_000,
  timeout: 20_000,
};

async function validateReferences(tx, agencyId, values) {
  const userIds = [...new Set([values.ownerUserId, values.nextActionOwnerId])];
  const [users, source, campaign] = await Promise.all([
    tx.user.findMany({
      where: { id: { in: userIds }, agencyId, status: "active", memberships: { some: { agencyId, isActive: true, role: { in: ["admin", "consultant", "frontdesk"] } } } },
      select: { id: true },
    }),
    tx.leadSource.findFirst({ where: { id: values.originalSourceId, agencyId, isActive: true }, select: { id: true } }),
    values.campaignId ? tx.leadCampaign.findFirst({ where: { id: values.campaignId, agencyId, sourceId: values.originalSourceId, isActive: true }, select: { id: true } }) : null,
  ]);
  if (users.length !== userIds.length) throw createHttpError(400, "Lead owner must be active workspace staff.", "INVALID_LEAD_OWNER");
  if (!source) throw createHttpError(400, "Lead source is not available for this agency.", "INVALID_LEAD_SOURCE");
  if (values.campaignId && !campaign) throw createHttpError(400, "Campaign does not belong to the selected source.", "INVALID_LEAD_CAMPAIGN");
}

export async function createLead(req, db = prisma) {
  if (!canCreateLead(req)) throw createHttpError(403, "You do not have permission to create leads.", "FORBIDDEN");
  const values = parseCreateLead(req.body);
  const agencyId = req.auth.agencyId;
  const actorId = req.auth.userId;

  const result = await db.$transaction(async (tx) => {
    await lockAgencyContactIntake(tx, agencyId);
    await assertNoContactDuplicate(tx, {
      agencyId,
      phoneNormalized: values.phoneNormalized,
      emailNormalized: values.emailNormalized,
    });
    await validateReferences(tx, agencyId, values);
    const leadNumber = await nextLeadNumber(tx, agencyId);
    const lead = await tx.lead.create({
      data: { ...values, agencyId, leadNumber, status: "OPEN", stage: "NEW" },
      include: leadInclude,
    });
    await tx.leadActivity.create({ data: { agencyId, leadId: lead.id, activityType: "LEAD_CREATED", direction: "INTERNAL", channel: "SYSTEM", title: "Lead created", description: lead.initialMessage, performedById: actorId } });
    await tx.leadStageHistory.create({ data: { agencyId, leadId: lead.id, newStage: "NEW", changedById: actorId, reason: "Lead created" } });
    await tx.leadAssignmentHistory.create({ data: { agencyId, leadId: lead.id, newOwnerId: values.ownerUserId, assignedById: actorId, assignmentType: "MANUAL", reason: "Initial assignment" } });
    await tx.leadFollowUp.create({ data: { agencyId, leadId: lead.id, assignedUserId: values.nextActionOwnerId, type: values.nextActionType, description: values.nextActionDescription, dueAt: values.nextActionAt } });
    await tx.activityLog.create({ data: { agencyId, userId: actorId, action: "lead.created", details: `Created ${leadNumber}`, entityType: "lead", entityId: lead.id, metadata: { leadNumber, sourceId: values.originalSourceId, ownerUserId: values.ownerUserId } } });
    return lead;
  }, leadTransactionOptions);
  if (db === prisma) {
    await notifyUsers({ agencyId, recipientIds: [result.ownerUserId], actorUserId: actorId, type: "lead.assigned", category: "leads", title: `New lead assigned: ${result.leadNumber}`, body: result.initialMessage, severity: result.priority === "URGENT" ? "critical" : result.priority === "HIGH" ? "warning" : "info", entityType: "lead", entityId: result.id, actionUrl: "/leads", dedupeKey: `lead:${result.id}:assigned:${result.ownerUserId}` });
  }
  return result;
}

export async function listLeads(req) {
  const { page, limit, search, status, stage, sourceId, sortBy, sortDirection } = parseLeadListQuery(req.query);
  const where = {
    agencyId: req.auth.agencyId,
    deletedAt: null,
    AND: [
      leadAccessWhere(req),
      ...(search ? [{ OR: [
        { leadNumber: { contains: search, mode: "insensitive" } },
        { firstName: { contains: search, mode: "insensitive" } },
        { lastName: { contains: search, mode: "insensitive" } },
        { phoneNormalized: { contains: search.replace(/\D/g, "") } },
        { emailNormalized: { contains: search.toLowerCase() } },
      ] }] : []),
    ],
    ...(status ? { status } : {}),
    ...(stage ? { stage } : {}),
    ...(sourceId ? { originalSourceId: sourceId } : {}),
  };
  const [data, total] = await Promise.all([
    prisma.lead.findMany({ where, include: leadInclude, orderBy: { [sortBy]: sortDirection }, skip: (page - 1) * limit, take: limit }),
    prisma.lead.count({ where }),
  ]);
  return { data, meta: { page, limit, total } };
}

export async function getLead(req) {
  const data = await prisma.lead.findFirst({
    where: { id: req.params.id, agencyId: req.auth.agencyId, deletedAt: null, ...leadAccessWhere(req) },
    include: { ...leadInclude, activities: { orderBy: { occurredAt: "desc" }, take: 100 }, stageHistory: { orderBy: { createdAt: "desc" } }, assignmentHistory: { orderBy: { createdAt: "desc" } }, followUps: { orderBy: { dueAt: "asc" } }, lostDetail: true, conversion: true },
  });
  if (!data) throw createHttpError(404, "Lead not found.", "LEAD_NOT_FOUND");
  return data;
}

export async function listLeadSources(req, db = prisma) {
  if (req.auth.role !== "frontdesk") {
    await db.leadSource.createMany({
      data: DEFAULT_LEAD_SOURCES.map(([name, type]) => ({ agencyId: req.auth.agencyId, name, type })),
      skipDuplicates: true,
    });
  }
  return db.leadSource.findMany({ where: { agencyId: req.auth.agencyId, isActive: true }, orderBy: { name: "asc" }, select: { id: true, name: true, type: true } });
}

export async function listLeadStaff(req) {
  return prisma.user.findMany({
    where: {
      agencyId: req.auth.agencyId,
      status: "active",
      memberships: { some: { agencyId: req.auth.agencyId, isActive: true, role: { in: ["admin", "consultant", "frontdesk"] } } },
    },
    orderBy: { fullName: "asc" },
    select: { id: true, fullName: true, email: true, role: true },
  });
}

async function requireLeadStaff(tx, agencyId, userId) {
  const user = await tx.user.findFirst({
    where: { id: userId, agencyId, status: "active", memberships: { some: { agencyId, isActive: true, role: { in: ["admin", "consultant", "frontdesk"] } } } },
    select: { id: true },
  });
  if (!user) throw createHttpError(400, "Select an active lead team member.", "INVALID_LEAD_OWNER");
  return user;
}

async function syncLeadNextAction(tx, leadId) {
  const next = await tx.leadFollowUp.findFirst({ where: { leadId, status: "PENDING" }, orderBy: [{ dueAt: "asc" }, { createdAt: "asc" }] });
  await tx.lead.update({ where: { id: leadId }, data: { nextActionType: next?.type || null, nextActionDescription: next?.description || null, nextActionAt: next?.dueAt || null, nextActionOwnerId: next?.assignedUserId || null, version: { increment: 1 } } });
  return next;
}

export async function recordLeadActivity(req, db = prisma) {
  const values = parseLeadActivity(req.body);
  const agencyId = req.auth.agencyId;
  const actorId = req.auth.userId;
  return db.$transaction(async (tx) => {
    const lead = await requireLead(tx, req, req.params.id);
    if (["CONVERTED", "ARCHIVED"].includes(lead.status)) throw createHttpError(409, "This lead no longer accepts contact activity.", "LEAD_CLOSED");
    const activity = await tx.leadActivity.create({ data: { ...values, agencyId, leadId: lead.id, performedById: actorId } });
    const contactActivity = values.activityType !== "INTERNAL_NOTE";
    const nextStage = contactActivity && ["NEW", "ASSIGNED"].includes(lead.stage) ? "CONTACTING" : lead.stage;
    await tx.lead.update({ where: { id: lead.id }, data: { ...(contactActivity ? { firstContactAt: lead.firstContactAt || values.occurredAt, lastContactAt: values.occurredAt } : {}), ...(nextStage !== lead.stage ? { stage: nextStage } : {}), version: { increment: 1 } } });
    if (nextStage !== lead.stage) await tx.leadStageHistory.create({ data: { agencyId, leadId: lead.id, previousStage: lead.stage, newStage: nextStage, changedById: actorId, reason: "Contact activity recorded" } });
    await tx.activityLog.create({ data: { agencyId, userId: actorId, action: "lead.contact_recorded", details: `${lead.leadNumber}: ${values.title}`, entityType: "lead", entityId: lead.id, metadata: { activityId: activity.id, activityType: values.activityType } } });
    return activity;
  }, leadTransactionOptions);
}

export async function createLeadFollowUp(req, db = prisma) {
  const values = parseLeadFollowUp(req.body);
  const agencyId = req.auth.agencyId;
  const actorId = req.auth.userId;
  const result = await db.$transaction(async (tx) => {
    const lead = await requireLead(tx, req, req.params.id);
    if (["CONVERTED", "LOST", "ARCHIVED"].includes(lead.status)) throw createHttpError(409, "This lead no longer accepts follow-ups.", "LEAD_CLOSED");
    await requireLeadStaff(tx, agencyId, values.assignedUserId);
    const followUp = await tx.leadFollowUp.create({ data: { ...values, agencyId, leadId: lead.id } });
    await syncLeadNextAction(tx, lead.id);
    await tx.leadActivity.create({ data: { agencyId, leadId: lead.id, activityType: "FOLLOW_UP_CREATED", direction: "INTERNAL", channel: "SYSTEM", title: values.description, description: `Due ${values.dueAt.toISOString()}`, performedById: actorId, metadata: { followUpId: followUp.id, assignedUserId: values.assignedUserId } } });
    await tx.activityLog.create({ data: { agencyId, userId: actorId, action: "lead.follow_up_created", details: `${lead.leadNumber}: ${values.description}`, entityType: "lead", entityId: lead.id, metadata: { followUpId: followUp.id } } });
    return followUp;
  }, leadTransactionOptions);
  if (db === prisma) {
    await notifyUsers({ agencyId, recipientIds: [values.assignedUserId], actorUserId: actorId, type: "lead.follow_up_assigned", category: "leads", title: "Lead follow-up assigned", body: `${values.description} — due ${values.dueAt.toISOString()}`, severity: "info", entityType: "lead", entityId: req.params.id, actionUrl: "/leads", dedupeKey: `lead-follow-up:${result.id}:assigned:${values.assignedUserId}` });
  }
  return result;
}

export async function updateLeadFollowUp(req, db = prisma) {
  const values = parseLeadFollowUpOutcome(req.body);
  const agencyId = req.auth.agencyId;
  const actorId = req.auth.userId;
  return db.$transaction(async (tx) => {
    const lead = await requireLead(tx, req, req.params.id);
    const existing = await tx.leadFollowUp.findFirst({ where: { id: req.params.followUpId, leadId: lead.id, agencyId, ...(req.auth.role === "frontdesk" ? { assignedUserId: actorId } : {}) } });
    if (!existing) throw createHttpError(404, "Lead follow-up not found.", "FOLLOW_UP_NOT_FOUND");
    if (existing.status !== "PENDING") throw createHttpError(409, "This lead follow-up is already closed.", "FOLLOW_UP_CLOSED");
    const followUp = await tx.leadFollowUp.update({ where: { id: existing.id }, data: { status: values.status, completionOutcome: values.completionOutcome, completedAt: new Date(), completedById: actorId } });
    await syncLeadNextAction(tx, lead.id);
    await tx.leadActivity.create({ data: { agencyId, leadId: lead.id, activityType: "FOLLOW_UP_COMPLETED", direction: "INTERNAL", channel: "SYSTEM", outcome: values.status, title: values.status === "COMPLETED" ? "Follow-up completed" : "Follow-up cancelled", description: values.completionOutcome, performedById: actorId, metadata: { followUpId: followUp.id } } });
    await tx.activityLog.create({ data: { agencyId, userId: actorId, action: values.status === "COMPLETED" ? "lead.follow_up_completed" : "lead.follow_up_cancelled", details: `${lead.leadNumber}: ${values.completionOutcome}`, entityType: "lead", entityId: lead.id, metadata: { followUpId: followUp.id } } });
    return followUp;
  }, leadTransactionOptions);
}

export async function assignLead(req, db = prisma) {
  const values = parseLeadAssignment(req.body);
  const agencyId = req.auth.agencyId;
  const actorId = req.auth.userId;
  const result = await db.$transaction(async (tx) => {
    const lead = await requireLead(tx, req, req.params.id);
    if (req.auth.role === "frontdesk" && lead.ownerUserId !== actorId) throw createHttpError(403, "Only the current lead owner can reassign this lead.", "FORBIDDEN");
    await requireLeadStaff(tx, agencyId, values.ownerUserId);
    if (lead.ownerUserId === values.ownerUserId) throw createHttpError(409, "This team member already owns the lead.", "NO_ASSIGNMENT_CHANGE");
    const updated = await tx.lead.update({ where: { id: lead.id }, data: { ownerUserId: values.ownerUserId, ...(lead.nextActionOwnerId === lead.ownerUserId ? { nextActionOwnerId: values.ownerUserId } : {}), stage: lead.stage === "NEW" ? "ASSIGNED" : lead.stage, version: { increment: 1 } }, include: leadInclude });
    await tx.leadAssignmentHistory.create({ data: { agencyId, leadId: lead.id, previousOwnerId: lead.ownerUserId, newOwnerId: values.ownerUserId, assignedById: actorId, assignmentType: "REASSIGNMENT", reason: values.reason } });
    await tx.leadActivity.create({ data: { agencyId, leadId: lead.id, activityType: "ASSIGNMENT_CHANGED", direction: "INTERNAL", channel: "SYSTEM", title: "Lead reassigned", description: values.reason, performedById: actorId, metadata: { previousOwnerId: lead.ownerUserId, ownerUserId: values.ownerUserId } } });
    await tx.activityLog.create({ data: { agencyId, userId: actorId, action: "lead.assigned", details: `${lead.leadNumber}: ${values.reason}`, entityType: "lead", entityId: lead.id, metadata: { previousOwnerId: lead.ownerUserId, ownerUserId: values.ownerUserId } } });
    return updated;
  }, leadTransactionOptions);
  if (db === prisma) {
    await notifyUsers({ agencyId, recipientIds: [values.ownerUserId], actorUserId: actorId, type: "lead.reassigned", category: "leads", title: `Lead reassigned: ${result.leadNumber}`, body: values.reason, severity: result.priority === "URGENT" ? "critical" : "info", entityType: "lead", entityId: result.id, actionUrl: "/leads", dedupeKey: `lead:${result.id}:assigned:${values.ownerUserId}:${result.updatedAt.toISOString()}` });
  }
  return result;
}

export async function moveLeadToNurture(req, db = prisma) {
  const values = parseLeadNurture(req.body);
  const agencyId = req.auth.agencyId;
  const actorId = req.auth.userId;
  return db.$transaction(async (tx) => {
    const lead = await requireLead(tx, req, req.params.id);
    if (lead.status !== "OPEN") throw createHttpError(409, "Only open leads can move to nurture.", "LEAD_NOT_OPEN");
    const followUp = await tx.leadFollowUp.create({ data: { agencyId, leadId: lead.id, assignedUserId: lead.ownerUserId, type: "REACTIVATE", description: values.reason, dueAt: values.nurtureUntil } });
    const updated = await tx.lead.update({ where: { id: lead.id }, data: { status: "NURTURE", nurtureUntil: values.nurtureUntil, nextActionType: followUp.type, nextActionDescription: followUp.description, nextActionAt: followUp.dueAt, nextActionOwnerId: followUp.assignedUserId, version: { increment: 1 } }, include: leadInclude });
    await tx.leadActivity.create({ data: { agencyId, leadId: lead.id, activityType: "LEAD_MOVED_TO_NURTURE", direction: "INTERNAL", channel: "SYSTEM", title: "Lead moved to nurture", description: values.reason, performedById: actorId, metadata: { nurtureUntil: values.nurtureUntil } } });
    await tx.activityLog.create({ data: { agencyId, userId: actorId, action: "lead.nurture_started", details: `${lead.leadNumber}: ${values.reason}`, entityType: "lead", entityId: lead.id, metadata: { nurtureUntil: values.nurtureUntil } } });
    return updated;
  }, leadTransactionOptions);
}

export async function markLeadLost(req, db = prisma) {
  const values = parseLeadLost(req.body);
  const agencyId = req.auth.agencyId;
  const actorId = req.auth.userId;
  return db.$transaction(async (tx) => {
    const lead = await requireLead(tx, req, req.params.id);
    if (!["OPEN", "NURTURE"].includes(lead.status)) throw createHttpError(409, "This lead cannot be marked lost.", "LEAD_NOT_OPEN");
    const lostAt = new Date();
    await tx.leadFollowUp.updateMany({ where: { agencyId, leadId: lead.id, status: "PENDING" }, data: { status: "CANCELLED", completedAt: lostAt, completedById: actorId, completionOutcome: "Lead marked lost" } });
    await tx.leadLostDetail.upsert({ where: { leadId: lead.id }, create: { ...values, agencyId, leadId: lead.id, lostById: actorId }, update: { ...values, lostById: actorId } });
    const updated = await tx.lead.update({ where: { id: lead.id }, data: { status: "LOST", lostAt, nurtureUntil: null, nextActionType: null, nextActionDescription: null, nextActionAt: null, nextActionOwnerId: null, version: { increment: 1 } }, include: leadInclude });
    await tx.leadActivity.create({ data: { agencyId, leadId: lead.id, activityType: "LEAD_LOST", direction: "INTERNAL", channel: "SYSTEM", outcome: values.reasonCode, title: "Lead marked lost", description: values.notes, performedById: actorId, metadata: { reasonCode: values.reasonCode } } });
    await tx.activityLog.create({ data: { agencyId, userId: actorId, action: "lead.marked_lost", details: `${lead.leadNumber}: ${values.reasonCode}`, entityType: "lead", entityId: lead.id, metadata: { reasonCode: values.reasonCode } } });
    return updated;
  }, leadTransactionOptions);
}

export async function qualifyLead(req, db = prisma) {
  const values = parseLeadQualification(req.body);
  const agencyId = req.auth.agencyId;
  const actorId = req.auth.userId;

  return db.$transaction(async (tx) => {
    const lead = await requireLead(tx, req, req.params.id);
    if (lead.status !== "OPEN") throw createHttpError(409, "Only open leads can be qualified.", "LEAD_NOT_OPEN");

    const previousQualification = await tx.leadQualification.findUnique({ where: { leadId: lead.id } });
    const qualification = await tx.leadQualification.upsert({
      where: { leadId: lead.id },
      create: { ...values, agencyId, leadId: lead.id, completedById: actorId },
      update: { ...values, completedById: actorId, completedAt: new Date() },
      include: { completedBy: { select: { id: true, fullName: true } } },
    });

    const stageOrder = ["NEW", "ASSIGNED", "CONTACTING", "CONNECTED", "QUALIFIED", "CONSULTATION_BOOKED", "CONSULTATION_COMPLETED", "RETAINER_PENDING", "PAYMENT_PENDING", "READY_TO_CONVERT"];
    const advancesToQualified = values.outcome === "QUALIFIED" && stageOrder.indexOf(lead.stage) < stageOrder.indexOf("QUALIFIED");
    await tx.lead.update({
      where: { id: lead.id },
      data: {
        immigrationInterest: values.immigrationService,
        currentImmigrationStatus: values.currentImmigrationStatus,
        ...(values.urgency ? { priority: values.urgency } : {}),
        ...(advancesToQualified ? { stage: "QUALIFIED" } : {}),
        version: { increment: 1 },
      },
    });

    if (advancesToQualified) {
      await tx.leadStageHistory.create({ data: { agencyId, leadId: lead.id, previousStage: lead.stage, newStage: "QUALIFIED", changedById: actorId, reason: "Qualification completed" } });
      await tx.leadActivity.create({ data: { agencyId, leadId: lead.id, activityType: "STAGE_CHANGED", direction: "INTERNAL", channel: "SYSTEM", title: "Stage changed to Qualified", performedById: actorId, metadata: { previousStage: lead.stage, newStage: "QUALIFIED" } } });
    }
    await tx.leadActivity.create({ data: { agencyId, leadId: lead.id, activityType: "INTERNAL_NOTE", direction: "INTERNAL", channel: "SYSTEM", outcome: values.outcome, title: previousQualification ? "Qualification updated" : "Qualification completed", description: values.notes, performedById: actorId, metadata: { outcome: values.outcome, eligibilityConfidence: values.eligibilityConfidence } } });
    await tx.activityLog.create({ data: { agencyId, userId: actorId, action: previousQualification ? "lead.qualification_updated" : "lead.qualified", details: `${lead.leadNumber}: ${values.outcome}`, entityType: "lead", entityId: lead.id, metadata: { beforeOutcome: previousQualification?.outcome || null, outcome: values.outcome } } });
    return qualification;
  }, leadTransactionOptions);
}

const consultationInclude = {
  consultant: { select: { id: true, fullName: true, email: true } },
  createdBy: { select: { id: true, fullName: true } },
  appointment: { include: { assignedTo: { select: { id: true, fullName: true } } } },
};

function nextConsultationAction(status, outcome, startAt = null) {
  const tomorrow = new Date(Date.now() + 24 * 60 * 60_000);
  if (["SCHEDULED", "RESCHEDULED"].includes(status)) {
    const reminder = new Date(startAt.getTime() - 24 * 60 * 60_000);
    return { type: "CONFIRM_CONSULTATION", description: "Confirm the scheduled consultation", at: reminder > new Date() ? reminder : new Date() };
  }
  if (status === "CONFIRMED") return { type: "COMPLETE_CONSULTATION", description: "Complete the consultation and record its outcome", at: startAt || tomorrow };
  if (["READY_TO_PROCEED", "AGREEMENT_REQUIRED"].includes(outcome)) return { type: "SEND_AGREEMENT", description: "Prepare and send the retainer agreement", at: tomorrow };
  if (outcome === "PAYMENT_REQUIRED") return { type: "REQUEST_PAYMENT", description: "Request the initial payment", at: tomorrow };
  if (status === "CANCELLED" || status === "NO_SHOW") return { type: "FOLLOW_UP", description: "Follow up about the missed consultation", at: tomorrow };
  return { type: "FOLLOW_UP", description: "Review the consultation outcome and follow up", at: tomorrow };
}

export async function listConsultations(req) {
  await requireLead(prisma, req, req.params.id);
  return prisma.leadConsultation.findMany({
    where: { agencyId: req.auth.agencyId, leadId: req.params.id },
    include: consultationInclude,
    orderBy: { startAt: "desc" },
  });
}

export async function createConsultation(req, db = prisma) {
  const values = parseCreateConsultation(req.body);
  const agencyId = req.auth.agencyId;
  const actorId = req.auth.userId;

  const result = await db.$transaction(async (tx) => {
    const lead = await requireLead(tx, req, req.params.id);
    if (lead.status !== "OPEN") throw createHttpError(409, "Only open leads can book consultations.", "LEAD_NOT_OPEN");
    const consultant = await tx.user.findFirst({
      where: { id: values.consultantUserId, agencyId, status: "active", memberships: { some: { agencyId, isActive: true, role: "consultant" } } },
      select: { id: true },
    });
    if (!consultant) throw createHttpError(400, "Consultant must be active workspace staff.", "INVALID_CONSULTANT");

    await lockSchedulingTransaction(tx, agencyId, values.startAt);
    const settings = await tx.bookingSettings.findUnique({ where: { agencyId } });
    const conflict = await assertSlotAvailable(tx, { agencyId, assignedToId: values.consultantUserId, startsAt: values.startAt, endsAt: values.endAt, bufferMinutes: settings?.bufferMinutes || 0 });
    if (conflict) throw createHttpError(409, "That consultant already has an appointment at this time.", "SLOT_TAKEN");
    const appointment = await tx.appointment.create({ data: {
      agencyId,
      leadId: lead.id,
      subject: "Lead consultation",
      location: values.location,
      calendar: "Workspace Calendar",
      startsAt: values.startAt,
      endsAt: values.endAt,
      description: values.notes,
      guestName: [lead.firstName, lead.lastName].filter(Boolean).join(" ") || null,
      guestEmail: lead.email,
      guestEmailNormalized: lead.emailNormalized,
      guestPhone: lead.phone,
      meetingMode: values.appointmentType === "VIDEO" ? "Online" : "InPerson",
      meetingUrl: values.meetingUrl,
      reminderDueAt: new Date(values.startAt.getTime() - (settings?.reminderMinutes || 1440) * 60_000),
      assignedToId: values.consultantUserId,
      createdById: actorId,
      source: "Lead",
      status: "Scheduled",
    } });
    const consultation = await tx.leadConsultation.create({ data: { ...values, agencyId, leadId: lead.id, createdById: actorId, appointmentId: appointment.id, status: "SCHEDULED" }, include: consultationInclude });
    const stageOrder = ["NEW", "ASSIGNED", "CONTACTING", "CONNECTED", "QUALIFIED", "CONSULTATION_BOOKED", "CONSULTATION_COMPLETED", "RETAINER_PENDING", "PAYMENT_PENDING", "READY_TO_CONVERT"];
    const advanceStage = stageOrder.indexOf(lead.stage) < stageOrder.indexOf("CONSULTATION_BOOKED");
    const next = nextConsultationAction("SCHEDULED", null, values.startAt);
    await tx.lead.update({ where: { id: lead.id }, data: { ...(advanceStage ? { stage: "CONSULTATION_BOOKED" } : {}), nextActionType: next.type, nextActionDescription: next.description, nextActionAt: next.at, nextActionOwnerId: values.consultantUserId, version: { increment: 1 } } });
    if (advanceStage) await tx.leadStageHistory.create({ data: { agencyId, leadId: lead.id, previousStage: lead.stage, newStage: "CONSULTATION_BOOKED", changedById: actorId, reason: "Consultation scheduled" } });
    await tx.leadFollowUp.create({ data: { agencyId, leadId: lead.id, assignedUserId: values.consultantUserId, type: next.type, description: next.description, dueAt: next.at } });
    await tx.leadActivity.create({ data: { agencyId, leadId: lead.id, activityType: "CONSULTATION_BOOKED", direction: "INTERNAL", channel: "SYSTEM", title: "Consultation scheduled", description: values.notes, performedById: actorId, metadata: { consultationId: consultation.id, startAt: values.startAt, consultantUserId: values.consultantUserId } } });
    await tx.activityLog.create({ data: { agencyId, userId: actorId, action: "lead.consultation_booked", details: `${lead.leadNumber}: ${values.startAt.toISOString()}`, entityType: "lead", entityId: lead.id, metadata: { consultationId: consultation.id } } });
    return consultation;
  }, leadTransactionOptions);
  if (db === prisma) {
    await notifyUsers({ agencyId, recipientIds: [values.consultantUserId], actorUserId: actorId, type: "lead.consultation_booked", category: "leads", title: "Lead consultation booked", body: values.startAt.toISOString(), severity: "info", entityType: "lead", entityId: req.params.id, actionUrl: "/leads", dedupeKey: `lead-consultation:${result.id}:booked:${result.startAt.toISOString()}` });
    if (result.appointment) await sendBookingMessages({ agencyId, appointment: result.appointment, kind: "booked", actorUserId: actorId }).catch(() => {});
  }
  return result;
}

export async function updateConsultation(req, db = prisma) {
  const values = parseUpdateConsultation(req.body);
  const agencyId = req.auth.agencyId;
  const actorId = req.auth.userId;
  const result = await db.$transaction(async (tx) => {
    const lead = await requireLead(tx, req, req.params.id);
    if (lead.status !== "OPEN") throw createHttpError(409, "Only open lead consultations can be updated.", "LEAD_NOT_OPEN");
    const existing = await tx.leadConsultation.findFirst({ where: { id: req.params.consultationId, leadId: lead.id, agencyId } });
    if (!existing) throw createHttpError(404, "Consultation not found.", "CONSULTATION_NOT_FOUND");
    const consultation = await tx.leadConsultation.update({ where: { id: existing.id }, data: values, include: consultationInclude });
    if (existing.appointmentId) {
      const appointmentStatus = values.status === "COMPLETED" ? "Completed" : values.status === "CANCELLED" ? "Cancelled" : values.status === "NO_SHOW" ? "NoShow" : "Scheduled";
      await tx.appointment.update({
        where: { id: existing.appointmentId },
        data: {
          status: appointmentStatus,
          ...(appointmentStatus === "Cancelled" ? { cancelledAt: new Date(), cancelledById: actorId, cancellationReason: values.notes || null } : {}),
        },
      });
    }
    const completedStage = values.outcome === "PAYMENT_REQUIRED" ? "PAYMENT_PENDING" : ["READY_TO_PROCEED", "AGREEMENT_REQUIRED"].includes(values.outcome) ? "RETAINER_PENDING" : "CONSULTATION_COMPLETED";
    const nextStage = values.status === "COMPLETED" ? completedStage : lead.stage;
    const next = nextConsultationAction(values.status, values.outcome, existing.startAt);
    await tx.lead.update({ where: { id: lead.id }, data: { stage: nextStage, nextActionType: next.type, nextActionDescription: next.description, nextActionAt: next.at, nextActionOwnerId: existing.consultantUserId, version: { increment: 1 } } });
    if (nextStage !== lead.stage) await tx.leadStageHistory.create({ data: { agencyId, leadId: lead.id, previousStage: lead.stage, newStage: nextStage, changedById: actorId, reason: `Consultation ${values.status.toLowerCase()}` } });
    await tx.leadFollowUp.create({ data: { agencyId, leadId: lead.id, assignedUserId: existing.consultantUserId, type: next.type, description: next.description, dueAt: next.at } });
    const activityType = values.status === "COMPLETED" ? "CONSULTATION_COMPLETED" : values.status === "CANCELLED" ? "CONSULTATION_CANCELLED" : values.status === "NO_SHOW" ? "CONSULTATION_NO_SHOW" : values.status === "RESCHEDULED" ? "CONSULTATION_RESCHEDULED" : "INTERNAL_NOTE";
    await tx.leadActivity.create({ data: { agencyId, leadId: lead.id, activityType, direction: "INTERNAL", channel: "SYSTEM", outcome: values.outcome, title: `Consultation ${humanizeForAudit(values.status)}`, description: values.notes, performedById: actorId, metadata: { consultationId: existing.id, status: values.status, outcome: values.outcome } } });
    await tx.activityLog.create({ data: { agencyId, userId: actorId, action: "lead.consultation_updated", details: `${lead.leadNumber}: ${values.status}`, entityType: "lead", entityId: lead.id, metadata: { consultationId: existing.id, status: values.status, outcome: values.outcome } } });
    return consultation;
  }, leadTransactionOptions);
  if (db === prisma) {
    await notifyUsers({ agencyId, recipientIds: [result.consultantUserId], actorUserId: actorId, type: "lead.consultation_updated", category: "leads", title: `Lead consultation ${String(result.status).toLowerCase().replaceAll("_", " ")}`, body: result.startAt.toISOString(), severity: result.status === "NO_SHOW" ? "warning" : "info", entityType: "lead", entityId: req.params.id, actionUrl: "/leads", dedupeKey: `lead-consultation:${result.id}:${result.status}:${result.updatedAt.toISOString()}` });
    if (result.appointment && result.status === "CANCELLED") await sendBookingMessages({ agencyId, appointment: { ...result.appointment, status: "Cancelled" }, kind: "cancelled", actorUserId: actorId }).catch(() => {});
  }
  return result;
}

function humanizeForAudit(value) {
  return value.toLowerCase().replaceAll("_", " ");
}

function commercialWorkflow(retainerStatus, initialPaymentStatus) {
  const at = new Date(Date.now() + 24 * 60 * 60_000);
  const retainerReady = ["SIGNED", "NOT_REQUIRED"].includes(retainerStatus);
  const paymentReady = ["PAID", "WAIVED"].includes(initialPaymentStatus);
  if (retainerReady && paymentReady) return { stage: "READY_TO_CONVERT", type: "REVIEW_CONVERSION", description: "Review the lead and convert to a client", at };
  if (!retainerReady) {
    if (["SENT", "VIEWED"].includes(retainerStatus)) return { stage: "RETAINER_PENDING", type: "FOLLOW_UP_AGREEMENT", description: "Follow up on the retainer agreement", at };
    if (["DECLINED", "EXPIRED"].includes(retainerStatus)) return { stage: "RETAINER_PENDING", type: "REVIEW_RETAINER", description: "Review the retainer outcome and follow up", at };
    return { stage: "RETAINER_PENDING", type: "SEND_AGREEMENT", description: retainerStatus === "PREPARED" ? "Send the prepared retainer agreement" : "Prepare the retainer agreement", at };
  }
  if (initialPaymentStatus === "NOT_REQUESTED") return { stage: "PAYMENT_PENDING", type: "REQUEST_PAYMENT", description: "Request the initial payment", at };
  return { stage: "PAYMENT_PENDING", type: "FOLLOW_UP_PAYMENT", description: "Follow up on the initial payment", at };
}

export async function updateCommercialStatus(req, db = prisma) {
  const values = parseCommercialStatus(req.body);
  const agencyId = req.auth.agencyId;
  const actorId = req.auth.userId;
  return db.$transaction(async (tx) => {
    const lead = await requireLead(tx, req, req.params.id);
    if (lead.status !== "OPEN") throw createHttpError(409, "Only open leads can update retainer or payment status.", "LEAD_NOT_OPEN");
    const retainerStatus = values.retainerStatus ?? lead.retainerStatus;
    const initialPaymentStatus = values.initialPaymentStatus ?? lead.initialPaymentStatus;
    if (retainerStatus === lead.retainerStatus && initialPaymentStatus === lead.initialPaymentStatus) throw createHttpError(409, "No status change was provided.", "NO_STATUS_CHANGE");
    const workflow = commercialWorkflow(retainerStatus, initialPaymentStatus);
    const updated = await tx.lead.update({
      where: { id: lead.id },
      data: { retainerStatus, initialPaymentStatus, stage: workflow.stage, nextActionType: workflow.type, nextActionDescription: workflow.description, nextActionAt: workflow.at, nextActionOwnerId: lead.ownerUserId, version: { increment: 1 } },
      include: leadInclude,
    });
    if (workflow.stage !== lead.stage) await tx.leadStageHistory.create({ data: { agencyId, leadId: lead.id, previousStage: lead.stage, newStage: workflow.stage, changedById: actorId, reason: "Retainer or initial-payment status updated" } });
    await tx.leadFollowUp.create({ data: { agencyId, leadId: lead.id, assignedUserId: lead.ownerUserId, type: workflow.type, description: workflow.description, dueAt: workflow.at } });
    if (retainerStatus !== lead.retainerStatus) {
      const activityType = retainerStatus === "PREPARED" ? "AGREEMENT_PREPARED" : retainerStatus === "SENT" ? "AGREEMENT_SENT" : retainerStatus === "SIGNED" ? "AGREEMENT_SIGNED" : "INTERNAL_NOTE";
      await tx.leadActivity.create({ data: { agencyId, leadId: lead.id, activityType, direction: "INTERNAL", channel: "SYSTEM", outcome: retainerStatus, title: `Retainer ${humanizeForAudit(retainerStatus)}`, description: values.notes, performedById: actorId, metadata: { previousStatus: lead.retainerStatus, status: retainerStatus } } });
    }
    if (initialPaymentStatus !== lead.initialPaymentStatus) {
      const activityType = initialPaymentStatus === "REQUESTED" ? "PAYMENT_REQUESTED" : ["PARTIAL", "PAID"].includes(initialPaymentStatus) ? "PAYMENT_RECEIVED" : "INTERNAL_NOTE";
      await tx.leadActivity.create({ data: { agencyId, leadId: lead.id, activityType, direction: "INTERNAL", channel: "SYSTEM", outcome: initialPaymentStatus, title: `Initial payment ${humanizeForAudit(initialPaymentStatus)}`, description: values.notes, performedById: actorId, metadata: { previousStatus: lead.initialPaymentStatus, status: initialPaymentStatus } } });
    }
    await tx.activityLog.create({ data: { agencyId, userId: actorId, action: "lead.commercial_status_updated", details: `${lead.leadNumber}: ${retainerStatus} / ${initialPaymentStatus}`, entityType: "lead", entityId: lead.id, metadata: { previousRetainerStatus: lead.retainerStatus, retainerStatus, previousInitialPaymentStatus: lead.initialPaymentStatus, initialPaymentStatus } } });
    return updated;
  }, leadTransactionOptions);
}

function qualificationSummary(qualification) {
  if (!qualification) return null;
  return [
    "Converted from lead qualification",
    qualification.immigrationService ? `Service: ${qualification.immigrationService}` : null,
    qualification.currentCountry ? `Current country: ${qualification.currentCountry}` : null,
    qualification.currentImmigrationStatus ? `Immigration status: ${qualification.currentImmigrationStatus}` : null,
    qualification.eligibilityConfidence !== null && qualification.eligibilityConfidence !== undefined ? `Eligibility confidence: ${qualification.eligibilityConfidence}%` : null,
    qualification.notes ? `Notes: ${qualification.notes}` : null,
  ].filter(Boolean).join("\n");
}

export async function convertLead(req, db = prisma) {
  const values = parseLeadConversion(req.body);
  const agencyId = req.auth.agencyId;
  const actorId = req.auth.userId;

  return db.$transaction(async (tx) => {
    const lead = await requireLead(tx, req, req.params.id);
    if (lead.status === "CONVERTED" || lead.convertedClientId) throw createHttpError(409, "This lead has already been converted.", "LEAD_ALREADY_CONVERTED");
    if (lead.status !== "OPEN") throw createHttpError(409, "Only open leads can be converted.", "LEAD_NOT_OPEN");
    const retainerReady = ["SIGNED", "NOT_REQUIRED"].includes(lead.retainerStatus);
    const paymentReady = ["PAID", "WAIVED"].includes(lead.initialPaymentStatus);
    if (lead.stage !== "READY_TO_CONVERT" || !retainerReady || !paymentReady) {
      throw createHttpError(409, "Complete the retainer and initial-payment requirements before conversion.", "LEAD_NOT_READY_TO_CONVERT");
    }

    const existingConversion = await tx.leadConversion.findUnique({ where: { leadId: lead.id }, select: { id: true } });
    if (existingConversion) throw createHttpError(409, "This lead has already been converted.", "LEAD_ALREADY_CONVERTED");

    await lockAgencyContactIntake(tx, agencyId);
    await assertNoContactDuplicate(tx, {
      agencyId,
      phoneNormalized: lead.phoneNormalized,
      emailNormalized: lead.emailNormalized,
      excludeLeadId: lead.id,
    });

    const qualification = await tx.leadQualification.findUnique({ where: { leadId: lead.id } });
    const clientNumber = await nextClientNumber(tx, agencyId);
    const client = await tx.client.create({
      data: { agencyId, clientNumber, fullName: values.fullName, phone: lead.phone, phoneNormalized: lead.phoneNormalized, email: lead.email, emailNormalized: lead.emailNormalized, preferredLanguage: lead.preferredLanguage, status: "Active", assignedUserId: lead.ownerUserId },
    });
    const caseItem = await tx.case.create({
      data: { agencyId, clientId: client.id, assignedUserId: lead.ownerUserId, caseType: values.caseType, stage: values.caseStage, status: "Active", nextAction: values.caseNextAction },
    });

    const summary = qualificationSummary(qualification);
    if (summary || values.notes) {
      await tx.note.create({ data: { agencyId, clientId: client.id, caseId: caseItem.id, userId: actorId, content: [summary, values.notes].filter(Boolean).join("\n\n") } });
    }
    await tx.followUp.create({ data: { agencyId, clientId: client.id, caseId: caseItem.id, assignedUserId: lead.ownerUserId, title: values.caseNextAction, description: "First action created during lead conversion", status: "Pending" } });
    await tx.leadFollowUp.updateMany({ where: { agencyId, leadId: lead.id, status: "PENDING" }, data: { status: "CANCELLED", completedAt: new Date(), completedById: actorId, completionOutcome: "Lead converted" } });

    const convertedAt = new Date();
    const conversion = await tx.leadConversion.create({
      data: { agencyId, leadId: lead.id, clientId: client.id, caseId: caseItem.id, convertedById: actorId, estimatedValue: lead.estimatedValue, actualValue: values.actualValue, convertedAt },
    });
    await tx.lead.update({
      where: { id: lead.id },
      data: { status: "CONVERTED", convertedClientId: client.id, convertedCaseId: caseItem.id, convertedAt, nextActionType: null, nextActionDescription: null, nextActionAt: null, nextActionOwnerId: null, version: { increment: 1 } },
    });
    await tx.leadActivity.create({ data: { agencyId, leadId: lead.id, activityType: "LEAD_CONVERTED", direction: "INTERNAL", channel: "SYSTEM", title: "Lead converted to client", description: values.notes, performedById: actorId, metadata: { conversionId: conversion.id, clientId: client.id, caseId: caseItem.id } } });
    await tx.activityLog.create({ data: { agencyId, userId: actorId, clientId: client.id, caseId: caseItem.id, action: "lead.converted", details: `${lead.leadNumber} converted to ${values.fullName}`, entityType: "lead", entityId: lead.id, metadata: { conversionId: conversion.id, clientId: client.id, caseId: caseItem.id, sourceId: lead.originalSourceId, campaignId: lead.campaignId } } });

    return { ...conversion, client, case: caseItem };
  }, leadTransactionOptions);
}
