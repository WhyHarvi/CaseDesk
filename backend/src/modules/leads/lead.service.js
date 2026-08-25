import { randomUUID } from "node:crypto";
import prisma from "../../services/prisma/client.js";
import { createHttpError } from "../../utils/http.js";
import { nextClientNumber } from "../../services/clientNumberService.js";
import { assertLeadWorkflowEditable, canCreateLead, leadAccessWhere, leadSegmentWhere } from "./lead.permissions.js";
import { reportingBounds } from "./lead.metrics.js";
import { nextLeadNumber, requireLead } from "./lead.repository.js";
import { parseBulkReassignment, parseCommercialStatus, parseCreateConsultation, parseCreateLead, parseLeadActivity, parseLeadAssignment, parseLeadConversion, parseLeadFollowUp, parseLeadFollowUpOutcome, parseLeadListQuery, parseLeadLost, parseLeadNurture, parseLeadPriorityChange, parseLeadQualification, parseLeadReactivation, parseLeadStageChange, parseUpdateConsultation, parseUpdateLeadDetails } from "./lead.validation.js";
import { DEFAULT_LEAD_SOURCES } from "./lead.constants.js";
import { resolveRoutedOwner } from "./lead.routing.service.js";
import { assertNoContactDuplicate, lockAgencyContactIntake } from "../../services/contactDuplicateService.js";
import { createLeadClientForPayment } from "./lead.retainer.service.js";
import { adminRecipientIds, notifyUsers, resolveNotifications } from "../../services/notificationService.js";
import {
  assertSlotAvailable,
  availabilityForRange,
  getOrCreateBookingSettings,
  localDateKey,
} from "../../services/bookingAvailabilityService.js";
import { lockSchedulingTransaction } from "../../services/schedulingAssignmentService.js";
import {
  processBookingMessageDeliveries,
  sendBookingMessages,
  sendBookingStaffNotification,
} from "../../services/bookingNotificationService.js";
import { appointmentMeetingFields, assertMeetingModeConfigured, MEETING_MODES } from "../../services/bookingMeetingModeService.js";
import { enqueueAppointmentMeetingJob } from "../../services/appointmentMeetingService.js";
import { syncLeadConsultationFromAppointment } from "../../services/leadConsultationAppointmentService.js";
import { offerWaitlistOpening } from "../../services/bookingWaitlistService.js";
import { assertZoomOperational } from "../../services/zoomService.js";
import { recordAppointmentEvent } from "../../services/appointmentOperationsService.js";
import { triggerRetainerFlow } from "./lead.retainer.service.js";
import { isGlobalCaseType, listAgencyCaseTypeOptions } from "../../services/caseTypeOptionsService.js";
import { canonicalCaseType, normalizeCaseType } from "../../services/workflowService.js";
import { staleLeadOutreachOverview } from "./lead.staleOutreach.service.js";

const leadInclude = {
  owner: { select: { id: true, fullName: true, email: true } },
  nextActionOwner: { select: { id: true, fullName: true } },
  originalSource: { select: { id: true, name: true, type: true } },
  campaign: { select: { id: true, name: true } },
};

export function visibleLeadActivities(activities = []) {
  const hasReconciledFollowUp = activities.some((activity) => activity.title === "Follow-up (reconciled)");
  const hasReconciledAdmissions = activities.some((activity) => activity.title === "Admissions detail (reconciled)");
  const hasAdmissionsAssociationCorrection = activities.some((activity) => activity.title === "Admissions import association corrected");

  return activities.filter((activity) => {
    if (activity.title === "Follow-up (imported)") {
      return Boolean(String(activity.description || "").trim()) && !hasReconciledFollowUp;
    }
    if (activity.title === "Admissions detail (imported)") {
      return !hasReconciledAdmissions && !hasAdmissionsAssociationCorrection;
    }
    return true;
  });
}

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

  let routed = null;
  const result = await db.$transaction(async (tx) => {
    await lockAgencyContactIntake(tx, agencyId);
    await assertNoContactDuplicate(tx, {
      agencyId,
      phoneNormalized: values.phoneNormalized,
      emailNormalized: values.emailNormalized,
    });
    if (!values.ownerUserId) {
      const source = await tx.leadSource.findFirst({ where: { id: values.originalSourceId, agencyId }, select: { type: true } });
      routed = await resolveRoutedOwner(tx, agencyId, {
        initialMessage: values.initialMessage,
        immigrationInterest: values.immigrationInterest,
        province: values.province,
        preferredLanguage: values.preferredLanguage,
        priority: values.priority,
      }, source?.type);
      if (!routed) throw createHttpError(400, "ownerUserId is required.", "VALIDATION_ERROR");
      values.ownerUserId = routed.ownerUserId;
      values.nextActionOwnerId = values.nextActionOwnerId || values.ownerUserId;
    }
    await validateReferences(tx, agencyId, values);
    const leadNumber = await nextLeadNumber(tx, agencyId);
    const lead = await tx.lead.create({
      data: { ...values, agencyId, leadNumber, status: "OPEN", stage: "NEW" },
      include: leadInclude,
    });
    await tx.leadActivity.create({ data: { agencyId, leadId: lead.id, activityType: "LEAD_CREATED", direction: "INTERNAL", channel: "SYSTEM", title: "Lead created", description: lead.initialMessage, performedById: actorId } });
    await tx.leadStageHistory.create({ data: { agencyId, leadId: lead.id, newStage: "NEW", changedById: actorId, reason: "Lead created" } });
    await tx.leadAssignmentHistory.create({ data: { agencyId, leadId: lead.id, newOwnerId: values.ownerUserId, assignedById: actorId, assignmentType: routed ? "RULE_BASED" : "MANUAL", reason: routed ? `Routed by rule "${routed.ruleName}"` : "Initial assignment" } });
    await tx.leadFollowUp.create({ data: { agencyId, leadId: lead.id, assignedUserId: values.nextActionOwnerId, type: values.nextActionType, description: values.nextActionDescription, dueAt: values.nextActionAt } });
    await tx.activityLog.create({ data: { agencyId, userId: actorId, action: "lead.created", details: `Created ${leadNumber}`, entityType: "lead", entityId: lead.id, metadata: { leadNumber, sourceId: values.originalSourceId, ownerUserId: values.ownerUserId } } });
    return lead;
  }, leadTransactionOptions);
  if (db === prisma) {
    await notifyUsers({ agencyId, recipientIds: [result.ownerUserId], actorUserId: actorId, type: "lead.assigned", category: "leads", title: `New lead assigned: ${result.leadNumber}`, body: result.initialMessage, severity: result.priority === "URGENT" ? "critical" : result.priority === "HIGH" ? "warning" : "info", entityType: "lead", entityId: result.id, actionUrl: "/leads", dedupeKey: `lead:${result.id}:assigned:${result.ownerUserId}` });
  }
  return result;
}

export function leadSearchWhere(search) {
  const normalized = String(search || "").trim();
  if (!normalized) return null;

  const digits = normalized.replace(/\D/g, "");
  const shortNumber = /^(?:(?:lead(?:\s+number)?)\s*)?#?\s*(\d{1,6})$/i.exec(normalized);
  const canonicalNumber = /^ld[-\s](\d{4})[-\s](\d{1,6})$/i.exec(normalized);
  const leadNumberFilter = canonicalNumber
    ? {
        leadNumber: {
          equals: `LD-${canonicalNumber[1]}-${canonicalNumber[2].padStart(6, "0")}`,
          mode: "insensitive",
        },
      }
    : shortNumber
      ? {
          leadNumber: {
            endsWith: `-${shortNumber[1].padStart(6, "0")}`,
            mode: "insensitive",
          },
        }
      : { leadNumber: { contains: normalized, mode: "insensitive" } };
  const nameParts = normalized.split(/\s+/).filter(Boolean);

  return {
    OR: [
      leadNumberFilter,
      { firstName: { contains: normalized, mode: "insensitive" } },
      { lastName: { contains: normalized, mode: "insensitive" } },
      { emailNormalized: { contains: normalized.toLowerCase() } },
      ...(nameParts.length > 1
        ? [
            {
              AND: nameParts.map((part) => ({
                OR: [
                  { firstName: { contains: part, mode: "insensitive" } },
                  { lastName: { contains: part, mode: "insensitive" } },
                ],
              })),
            },
          ]
        : []),
      // Short numbers are overwhelmingly likely to be lead sequence
      // numbers. Requiring seven digits prevents searches like "100" or a
      // name with no digits from matching unrelated phone records.
      ...(digits.length >= 7
        ? [{ phoneNormalized: { contains: digits } }]
        : []),
    ],
  };
}

export async function listLeads(req) {
  const { page, limit, search, status, stage, segment, sourceId, ownerUserId, includeConverted, sortBy, sortDirection, month, createdToday, uncontacted, convertedThisWeek, lostThisWeek } = parseLeadListQuery(req.query);

  // Only computed when a date-scoped dashboard flag is present — same
  // bounds getLeadDashboard() uses, so a stat card's count and this list
  // never disagree.
  let bounds = null;
  if (createdToday || convertedThisWeek || lostThisWeek) {
    const agency = await prisma.agency.findUnique({ where: { id: req.auth.agencyId }, select: { timezone: true } });
    bounds = reportingBounds(new Date(), agency?.timezone || "America/Toronto");
  }

  const where = {
    agencyId: req.auth.agencyId,
    deletedAt: null,
    AND: [
      leadAccessWhere(req),
      ...(search ? [leadSearchWhere(search)] : []),
    ],
    ...leadSegmentWhere(segment),
    // With no status filter picked, "All statuses" means the working
    // pipeline, not literally every record — a converted lead is done and
    // shouldn't keep cluttering the default list. Still fully visible by
    // explicitly filtering to Converted.
    ...(status ? { status } : includeConverted ? {} : { status: { not: "CONVERTED" } }),
    ...(stage ? { stage } : {}),
    ...(sourceId ? { originalSourceId: sourceId } : {}),
    ...(ownerUserId ? { ownerUserId } : {}),
    ...(month ? { inquiryDate: { gte: new Date(Date.UTC(month.year, month.month - 1, 1)), lt: new Date(Date.UTC(month.month === 12 ? month.year + 1 : month.year, month.month === 12 ? 0 : month.month, 1)) } } : {}),
    ...(createdToday ? { createdAt: { gte: bounds.todayStart, lt: bounds.tomorrowStart } } : {}),
    ...(uncontacted ? { firstContactAt: null } : {}),
    ...(convertedThisWeek ? { convertedAt: { gte: bounds.weekStart, lt: bounds.tomorrowStart } } : {}),
    ...(lostThisWeek ? { lostAt: { gte: bounds.weekStart, lt: bounds.tomorrowStart } } : {}),
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
    include: {
      ...leadInclude,
      activities: { orderBy: { occurredAt: "desc" }, take: 100 },
      oomaCallSessions: {
        where: { provider: "TWILIO" },
        orderBy: { startedAt: "desc" },
        select: { id: true, direction: true, status: true, remoteNumber: true, startedAt: true, answeredAt: true, endedAt: true, durationSeconds: true, disposition: true, outcomeNotes: true, recordingUrl: true, handledBy: { select: { id: true, fullName: true } } },
      },
      stageHistory: { orderBy: { createdAt: "desc" } },
      assignmentHistory: { orderBy: { createdAt: "desc" } },
      transferRequests: {
        where: { status: "PENDING" },
        orderBy: { createdAt: "desc" },
        take: 1,
        include: {
          toOwner: { select: { id: true, fullName: true, role: true } },
          requestedBy: { select: { id: true, fullName: true } },
        },
      },
      followUps: { orderBy: { dueAt: "asc" } },
      messageDeliveries: {
        orderBy: { createdAt: "desc" },
        take: 100,
        select: {
          id: true,
          kind: true,
          channel: true,
          recipient: true,
          status: true,
          attempts: true,
          sentAt: true,
          failedAt: true,
          provider: true,
          providerId: true,
          lastError: true,
          subject: true,
          body: true,
          sourceChannel: true,
          createdAt: true,
        },
      },
      appointments: {
        orderBy: { startsAt: "desc" },
        select: {
          id: true,
          subject: true,
          purpose: true,
          description: true,
          startsAt: true,
          endsAt: true,
          status: true,
          meetingMode: true,
          referenceCode: true,
          assignedTo: { select: { id: true, fullName: true } },
          messageDeliveries: {
            orderBy: { createdAt: "desc" },
            take: 50,
            select: {
              id: true,
              kind: true,
              channel: true,
              recipient: true,
              status: true,
              attempts: true,
              sentAt: true,
              failedAt: true,
              lastError: true,
              createdAt: true,
            },
          },
          _count: {
            select: {
              notes: { where: { deletedAt: null } },
              followUps: true,
            },
          },
        },
      },
      lostDetail: true,
      conversion: true,
      qualification: true,
    },
  });
  if (!data) throw createHttpError(404, "Lead not found.", "LEAD_NOT_FOUND");
  return { ...data, activities: visibleLeadActivities(data.activities) };
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
    // schedulingPreference is included (not filtered on here) — this list
    // is shared by non-booking consumers too (e.g. lead-owner assignment),
    // where someone who's turned off accepting appointments should still
    // be assignable. Booking-specific UI (the calendar) filters on it itself.
    select: { id: true, fullName: true, email: true, role: true, zoomHostMapping: { select: { status: true } }, schedulingPreference: { select: { acceptsAppointments: true } } },
  });
}

export async function listLeadImmigrationInterests(req) {
  return listAgencyCaseTypeOptions(req.auth.agencyId);
}

export async function getLeadSettings(req) {
  return prisma.leadSettings.upsert({
    where: { agencyId: req.auth.agencyId },
    create: { agencyId: req.auth.agencyId },
    update: {},
  });
}

export async function getStaleLeadOutreachOverview(req) {
  return staleLeadOutreachOverview(req.auth.agencyId);
}

export async function updateLeadSettings(req) {
  const data = {};
  for (const field of ["welcomeEmailEnabled", "staleOutreachEnabled", "staleOutreachEmailEnabled", "staleOutreachSmsEnabled", "overdueAlertEnabled"]) {
    if (req.body?.[field] !== undefined) {
      if (typeof req.body[field] !== "boolean") throw createHttpError(400, `${field} must be true or false.`, "VALIDATION_ERROR");
      data[field] = req.body[field];
    }
  }
  if (req.body?.staleOutreachDays !== undefined) {
    const days = Number(req.body.staleOutreachDays);
    if (!Number.isInteger(days) || days < 3 || days > 180) throw createHttpError(400, "staleOutreachDays must be between 3 and 180.", "VALIDATION_ERROR");
    data.staleOutreachDays = days;
  }
  if (req.body?.overdueAlertAdminThreshold !== undefined) {
    const threshold = Number(req.body.overdueAlertAdminThreshold);
    if (!Number.isInteger(threshold) || threshold < 1 || threshold > 100) throw createHttpError(400, "overdueAlertAdminThreshold must be between 1 and 100.", "VALIDATION_ERROR");
    data.overdueAlertAdminThreshold = threshold;
  }
  if (!Object.keys(data).length) throw createHttpError(400, "No lead setting was provided.", "VALIDATION_ERROR");
  if (["staleOutreachEnabled", "staleOutreachEmailEnabled", "staleOutreachSmsEnabled"].some((field) => data[field] !== undefined)) {
    const current = await prisma.leadSettings.findUnique({ where: { agencyId: req.auth.agencyId } });
    const outreachEnabled = data.staleOutreachEnabled ?? current?.staleOutreachEnabled ?? false;
    const emailEnabled = data.staleOutreachEmailEnabled ?? current?.staleOutreachEmailEnabled ?? true;
    const smsEnabled = data.staleOutreachSmsEnabled ?? current?.staleOutreachSmsEnabled ?? true;
    if (outreachEnabled && !emailEnabled && !smsEnabled) throw createHttpError(400, "Enable email, SMS, or both before turning on stale-lead outreach.", "VALIDATION_ERROR");
  }
  return prisma.leadSettings.upsert({
    where: { agencyId: req.auth.agencyId },
    create: { agencyId: req.auth.agencyId, ...data },
    update: data,
  });
}

export async function requireLeadStaff(tx, agencyId, userId) {
  const user = await tx.user.findFirst({
    where: { id: userId, agencyId, status: "active", memberships: { some: { agencyId, isActive: true, role: { in: ["admin", "consultant", "frontdesk"] } } } },
    select: { id: true, fullName: true },
  });
  if (!user) throw createHttpError(400, "Select an active lead team member.", "INVALID_LEAD_OWNER");
  return user;
}

async function lockLeadTransfer(tx, agencyId, leadId) {
  if (typeof tx.$executeRaw !== "function") return;
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`lead-transfer:${agencyId}:${leadId}`}, 0))`;
}

async function syncLeadNextAction(tx, leadId) {
  const next = await tx.leadFollowUp.findFirst({ where: { leadId, status: "PENDING" }, orderBy: [{ dueAt: "asc" }, { createdAt: "asc" }] });
  await tx.lead.update({ where: { id: leadId }, data: { nextActionType: next?.type || null, nextActionDescription: next?.description || null, nextActionAt: next?.dueAt || null, nextActionOwnerId: next?.assignedUserId || null, version: { increment: 1 } } });
  return next;
}

export async function moveLeadOwnership(tx, { agencyId, lead, ownerUserId, actorId, reason, assignmentType = "REASSIGNMENT" }) {
  const updated = await tx.lead.update({
    where: { id: lead.id },
    data: {
      ownerUserId,
      ...(lead.nextActionOwnerId === lead.ownerUserId ? { nextActionOwnerId: ownerUserId } : {}),
      stage: lead.stage === "NEW" ? "ASSIGNED" : lead.stage,
      version: { increment: 1 },
    },
    include: leadInclude,
  });
  await tx.leadFollowUp.updateMany({
    where: { agencyId, leadId: lead.id, status: "PENDING" },
    data: { assignedUserId: ownerUserId },
  });
  await tx.leadAssignmentHistory.create({
    data: {
      agencyId,
      leadId: lead.id,
      previousOwnerId: lead.ownerUserId,
      newOwnerId: ownerUserId,
      assignedById: actorId,
      assignmentType,
      reason,
    },
  });
  await tx.leadActivity.create({
    data: {
      agencyId,
      leadId: lead.id,
      activityType: "ASSIGNMENT_CHANGED",
      direction: "INTERNAL",
      channel: "SYSTEM",
      title: "Lead reassigned",
      description: reason,
      performedById: actorId,
      metadata: { previousOwnerId: lead.ownerUserId, ownerUserId },
    },
  });
  return updated;
}

export async function supersedePendingFollowUps(tx, agencyId, leadId, actorId, outcome) {
  await tx.leadFollowUp.updateMany({
    where: { agencyId, leadId, status: "PENDING" },
    data: {
      status: "CANCELLED",
      completedAt: new Date(),
      completedById: actorId || null,
      completionOutcome: outcome,
    },
  });
}

// Editing core contact/demographic fields — separate from recordLeadActivity
// (which is for logging contact events) and reassignLead/nurture/etc (which
// are pipeline-stage actions). This is just "the details were wrong or
// incomplete, fix them" — e.g. a lead imported with no phone number yet.
export async function updateLeadDetails(req, db = prisma) {
  const values = parseUpdateLeadDetails(req.body);
  const agencyId = req.auth.agencyId;
  const actorId = req.auth.userId;
  return db.$transaction(async (tx) => {
    const lead = await requireLead(tx, req, req.params.id);
    if (lead.status === "CONVERTED") {
      throw createHttpError(409, "This lead has been converted — edit its contact details on the linked client instead.", "LEAD_CONVERTED");
    }
    if (values.phoneNormalized !== undefined || values.emailNormalized !== undefined) {
      await lockAgencyContactIntake(tx, agencyId);
      await assertNoContactDuplicate(tx, {
        agencyId,
        phoneNormalized: values.phoneNormalized !== undefined ? values.phoneNormalized : lead.phoneNormalized,
        emailNormalized: values.emailNormalized !== undefined ? values.emailNormalized : lead.emailNormalized,
        excludeLeadId: lead.id,
      });
    }
    const updated = await tx.lead.update({ where: { id: lead.id }, data: { ...values, version: { increment: 1 } }, include: leadInclude });
    await tx.activityLog.create({ data: { agencyId, userId: actorId, action: "lead.details_updated", details: `${lead.leadNumber}: contact details updated`, entityType: "lead", entityId: lead.id, metadata: { fields: Object.keys(values) } } });
    return updated;
  }, leadTransactionOptions);
}

export async function recordLeadActivity(req, db = prisma) {
  const values = parseLeadActivity(req.body);
  const agencyId = req.auth.agencyId;
  const actorId = req.auth.userId;
  return db.$transaction(async (tx) => {
    const lead = await requireLead(tx, req, req.params.id);
    if (["CONVERTED", "ARCHIVED"].includes(lead.status)) throw createHttpError(409, "This lead no longer accepts contact activity.", "LEAD_CLOSED");
    const { connected, ...activityValues } = values;
    const activity = await tx.leadActivity.create({ data: { ...activityValues, agencyId, leadId: lead.id, performedById: actorId } });
    const contactActivity = values.activityType !== "INTERNAL_NOTE";
    const connectionTypes = ["INCOMING_CALL", "OUTGOING_CALL", "WHATSAPP_RECEIVED", "WHATSAPP_SENT", "SMS_RECEIVED", "SMS_SENT", "EMAIL_RECEIVED", "EMAIL_SENT"];
    const isConnection = connected && connectionTypes.includes(values.activityType);
    const stageOrder = ["NEW", "ASSIGNED", "CONTACTING", "CONNECTED", "QUALIFIED", "CONSULTATION_BOOKED", "CONSULTATION_COMPLETED", "RETAINER_PENDING", "PAYMENT_PENDING", "READY_TO_CONVERT"];
    const nextStage = isConnection && stageOrder.indexOf(lead.stage) < stageOrder.indexOf("CONNECTED")
      ? "CONNECTED"
      : contactActivity && ["NEW", "ASSIGNED"].includes(lead.stage)
        ? "CONTACTING"
        : lead.stage;
    await tx.lead.update({ where: { id: lead.id }, data: { ...(contactActivity ? { firstContactAt: lead.firstContactAt || values.occurredAt, lastContactAt: values.occurredAt } : {}), ...(isConnection ? { firstConnectedAt: lead.firstConnectedAt || values.occurredAt } : {}), ...(nextStage !== lead.stage ? { stage: nextStage } : {}), version: { increment: 1 } } });
    if (nextStage !== lead.stage) await tx.leadStageHistory.create({ data: { agencyId, leadId: lead.id, previousStage: lead.stage, newStage: nextStage, changedById: actorId, reason: "Contact activity recorded" } });
    await tx.activityLog.create({ data: { agencyId, userId: actorId, action: contactActivity ? "lead.contact_recorded" : "lead.note_added", details: `${lead.leadNumber}: ${values.title}`, entityType: "lead", entityId: lead.id, metadata: { activityId: activity.id, activityType: values.activityType } } });
    return activity;
  }, leadTransactionOptions);
}

export async function updateLeadNote(req, db = prisma) {
  const description = String(req.body?.description || "").trim();
  if (!description) throw createHttpError(400, "Note is required.", "VALIDATION_ERROR");
  if (description.length > 5000) throw createHttpError(400, "Note is too long.", "VALIDATION_ERROR");
  const agencyId = req.auth.agencyId;
  const actorId = req.auth.userId;
  return db.$transaction(async (tx) => {
    const lead = await requireLead(tx, req, req.params.id);
    const note = await tx.leadActivity.findFirst({
      where: { id: req.params.activityId, leadId: lead.id, agencyId, activityType: "INTERNAL_NOTE" },
    });
    if (!note) throw createHttpError(404, "Lead note not found.", "LEAD_NOTE_NOT_FOUND");
    if (req.auth.role !== "admin" && note.performedById !== actorId) {
      throw createHttpError(403, "You can edit only notes you created.", "FORBIDDEN");
    }
    const updated = await tx.leadActivity.update({
      where: { id: note.id },
      data: { description },
      include: { performedBy: { select: { id: true, fullName: true } } },
    });
    await tx.activityLog.create({ data: { agencyId, userId: actorId, action: "lead.note_updated", details: `${lead.leadNumber}: Lead note updated`, entityType: "lead", entityId: lead.id, metadata: { activityId: note.id } } });
    return updated;
  }, leadTransactionOptions);
}

export async function createLeadFollowUp(req, db = prisma) {
  const values = parseLeadFollowUp(req.body);
  const agencyId = req.auth.agencyId;
  const actorId = req.auth.userId;
  const result = await db.$transaction(async (tx) => {
    await lockLeadTransfer(tx, agencyId, req.params.id);
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
    const existing = await tx.leadFollowUp.findFirst({ where: { id: req.params.followUpId, leadId: lead.id, agencyId } });
    if (!existing) throw createHttpError(404, "Lead follow-up not found.", "FOLLOW_UP_NOT_FOUND");
    if (req.auth.role !== "admin" && lead.ownerUserId !== actorId && existing.assignedUserId !== actorId) {
      throw createHttpError(403, "You can only close a follow-up assigned to you.", "FORBIDDEN");
    }
    if (existing.status !== "PENDING") throw createHttpError(409, "This lead follow-up is already closed.", "FOLLOW_UP_CLOSED");
    const followUp = await tx.leadFollowUp.update({ where: { id: existing.id }, data: { status: values.status, completionOutcome: values.completionOutcome, completedAt: new Date(), completedById: actorId } });
    let next = await tx.leadFollowUp.findFirst({
      where: { agencyId, leadId: lead.id, status: "PENDING" },
      orderBy: [{ dueAt: "asc" }, { createdAt: "asc" }],
    });
    const reactivatesLead = existing.type === "REACTIVATE" && lead.status === "NURTURE" && values.status === "COMPLETED";
    if (!next && (lead.status === "OPEN" || reactivatesLead)) {
      if (!values.nextFollowUp) {
        throw createHttpError(
          409,
          "This is the lead's last open follow-up. Add the next action before closing it.",
          "NEXT_FOLLOW_UP_REQUIRED",
        );
      }
      await requireLeadStaff(tx, agencyId, values.nextFollowUp.assignedUserId);
      next = await tx.leadFollowUp.create({
        data: { ...values.nextFollowUp, agencyId, leadId: lead.id },
      });
      await tx.leadActivity.create({
        data: {
          agencyId,
          leadId: lead.id,
          activityType: "FOLLOW_UP_CREATED",
          direction: "INTERNAL",
          channel: "SYSTEM",
          title: values.nextFollowUp.description,
          description: `Due ${values.nextFollowUp.dueAt.toISOString()}`,
          performedById: actorId,
          metadata: { followUpId: next.id, assignedUserId: values.nextFollowUp.assignedUserId, createdWhileClosingFollowUpId: existing.id },
        },
      });
    }
    if (reactivatesLead) {
      await tx.lead.update({ where: { id: lead.id }, data: { status: "OPEN", nurtureUntil: null, version: { increment: 1 } } });
      await tx.leadActivity.create({ data: { agencyId, leadId: lead.id, activityType: "LEAD_REACTIVATED", direction: "INTERNAL", channel: "SYSTEM", title: "Lead reactivated from nurture", description: values.completionOutcome, performedById: actorId } });
    }
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
    const owner = await requireLeadStaff(tx, agencyId, values.ownerUserId);
    if (lead.ownerUserId === values.ownerUserId) throw createHttpError(409, "This team member already owns the lead.", "NO_ASSIGNMENT_CHANGE");
    const assignmentReason = values.reason || `Transferred by an administrator to ${owner.fullName}`;
    const updated = await moveLeadOwnership(tx, { agencyId, lead, ownerUserId: values.ownerUserId, actorId, reason: assignmentReason });
    const pendingRequests = await tx.leadTransferRequest.findMany({ where: { agencyId, leadId: lead.id, status: "PENDING" }, select: { id: true } });
    await tx.leadTransferRequest.updateMany({
      where: { agencyId, leadId: lead.id, status: "PENDING" },
      data: { status: "STALE", reviewedById: actorId, reviewedAt: new Date(), reviewNote: "Lead was transferred directly by an administrator." },
    });
    await tx.activityLog.create({ data: { agencyId, userId: actorId, action: "lead.assigned", details: `${lead.leadNumber}: ${assignmentReason}`, entityType: "lead", entityId: lead.id, metadata: { previousOwnerId: lead.ownerUserId, ownerUserId: values.ownerUserId } } });
    return { updated, assignmentReason, staleRequestIds: pendingRequests.map((item) => item.id) };
  }, leadTransactionOptions);
  if (db === prisma) {
    await Promise.all(result.staleRequestIds.map((id) => resolveNotifications({ agencyId, entityType: "leadTransferRequest", entityId: id, types: ["lead.transfer_approval_required"] })));
    await notifyUsers({ agencyId, recipientIds: [values.ownerUserId], actorUserId: actorId, type: "lead.reassigned", category: "leads", title: `Lead reassigned: ${result.updated.leadNumber}`, body: result.assignmentReason, severity: result.updated.priority === "URGENT" ? "critical" : "info", entityType: "lead", entityId: result.updated.id, actionUrl: "/leads", dedupeKey: `lead:${result.updated.id}:assigned:${values.ownerUserId}:${result.updated.updatedAt.toISOString()}` });
  }
  return result.updated;
}

const transferRequestInclude = {
  lead: {
    select: {
      id: true,
      leadNumber: true,
      firstName: true,
      lastName: true,
      status: true,
      ownerUserId: true,
    },
  },
  fromOwner: { select: { id: true, fullName: true, role: true } },
  toOwner: { select: { id: true, fullName: true, role: true } },
  requestedBy: { select: { id: true, fullName: true } },
  reviewedBy: { select: { id: true, fullName: true } },
};

export async function requestLeadTransfer(req, db = prisma) {
  const values = parseLeadAssignment(req.body);
  const agencyId = req.auth.agencyId;
  const actorId = req.auth.userId;
  let request;
  try {
    request = await db.$transaction(async (tx) => {
      await lockLeadTransfer(tx, agencyId, req.params.id);
      const lead = await requireLead(tx, req, req.params.id);
      if (!["OPEN", "NURTURE"].includes(lead.status)) throw createHttpError(409, "Only an open or nurturing lead can be transferred.", "LEAD_NOT_WORKABLE");
      if (lead.ownerUserId !== actorId) throw createHttpError(403, "Only the consultant who owns this lead can request its transfer.", "FORBIDDEN");
      const target = await requireLeadStaff(tx, agencyId, values.ownerUserId);
      if (lead.ownerUserId === values.ownerUserId) throw createHttpError(409, "This team member already owns the lead.", "NO_ASSIGNMENT_CHANGE");
      const existing = await tx.leadTransferRequest.findFirst({ where: { agencyId, leadId: lead.id, status: "PENDING" }, include: transferRequestInclude });
      if (existing) throw createHttpError(409, `A transfer to ${existing.toOwner.fullName} is already waiting for approval.`, "TRANSFER_ALREADY_PENDING");
      const created = await tx.leadTransferRequest.create({
        data: { agencyId, leadId: lead.id, fromOwnerId: lead.ownerUserId, toOwnerId: target.id, requestedById: actorId },
        include: transferRequestInclude,
      });
      await tx.leadActivity.create({ data: { agencyId, leadId: lead.id, activityType: "INTERNAL_NOTE", direction: "INTERNAL", channel: "SYSTEM", title: "Lead transfer requested", description: `${created.requestedBy.fullName} requested transfer to ${target.fullName}. Waiting for administrator approval.`, performedById: actorId, metadata: { transferRequestId: created.id, toOwnerId: target.id } } });
      await tx.activityLog.create({ data: { agencyId, userId: actorId, action: "lead.transfer_requested", details: `${lead.leadNumber}: requested transfer to ${target.fullName}`, entityType: "leadTransferRequest", entityId: created.id, metadata: { leadId: lead.id, fromOwnerId: lead.ownerUserId, toOwnerId: target.id } } });
      return created;
    }, leadTransactionOptions);
  } catch (error) {
    if (error?.code === "P2002") throw createHttpError(409, "A transfer request for this lead is already waiting for approval.", "TRANSFER_ALREADY_PENDING");
    throw error;
  }
  if (db === prisma) {
    const adminIds = await adminRecipientIds(agencyId);
    await notifyUsers({ agencyId, recipientIds: adminIds, actorUserId: actorId, type: "lead.transfer_approval_required", category: "leads", title: "Lead transfer needs approval", body: `${request.requestedBy.fullName} wants to transfer ${request.lead.leadNumber} to ${request.toOwner.fullName}.`, severity: "warning", entityType: "leadTransferRequest", entityId: request.id, actionUrl: "/leads", destinationKey: "leads", dedupeKey: `lead-transfer:${request.id}:pending`, attentionLevel: "action_required" }).catch(() => {});
  }
  return request;
}

export async function listLeadTransferRequests(req, db = prisma) {
  const requestedStatus = String(req.query?.status || "PENDING").toUpperCase();
  const status = ["PENDING", "APPROVED", "REJECTED", "STALE"].includes(requestedStatus) ? requestedStatus : "PENDING";
  return db.leadTransferRequest.findMany({ where: { agencyId: req.auth.agencyId, status }, include: transferRequestInclude, orderBy: { createdAt: "asc" }, take: 100 });
}

export async function approveLeadTransferRequest(req, db = prisma) {
  const agencyId = req.auth.agencyId;
  const actorId = req.auth.userId;
  const result = await db.$transaction(async (tx) => {
    const requestSummary = await tx.leadTransferRequest.findFirst({ where: { id: req.params.requestId, agencyId }, select: { leadId: true } });
    if (!requestSummary) throw createHttpError(404, "Lead transfer request was not found.", "NOT_FOUND");
    await lockLeadTransfer(tx, agencyId, requestSummary.leadId);
    const request = await tx.leadTransferRequest.findFirst({ where: { id: req.params.requestId, agencyId }, include: transferRequestInclude });
    if (!request) throw createHttpError(404, "Lead transfer request was not found.", "NOT_FOUND");
    if (request.status !== "PENDING") throw createHttpError(409, "This lead transfer request has already been reviewed.", "TRANSFER_ALREADY_REVIEWED");
    const lead = await tx.lead.findFirst({ where: { id: request.leadId, agencyId, deletedAt: null } });
    if (!lead || lead.ownerUserId !== request.fromOwnerId || !["OPEN", "NURTURE"].includes(lead.status)) {
      const closed = await tx.leadTransferRequest.updateMany({ where: { id: request.id, status: "PENDING" }, data: { status: "STALE", reviewedById: actorId, reviewedAt: new Date(), reviewNote: "The lead owner or status changed before review." } });
      if (closed.count !== 1) throw createHttpError(409, "This lead transfer request has already been reviewed.", "TRANSFER_ALREADY_REVIEWED");
      const stale = await tx.leadTransferRequest.findUnique({ where: { id: request.id }, include: transferRequestInclude });
      return { stale: true, request: stale, updated: null };
    }
    const target = await requireLeadStaff(tx, agencyId, request.toOwnerId);
    const assignmentReason = `Transfer requested by ${request.requestedBy.fullName} and approved by an administrator for ${target.fullName}`;
    const claimed = await tx.leadTransferRequest.updateMany({ where: { id: request.id, status: "PENDING" }, data: { status: "APPROVED", reviewedById: actorId, reviewedAt: new Date() } });
    if (claimed.count !== 1) throw createHttpError(409, "This lead transfer request has already been reviewed.", "TRANSFER_ALREADY_REVIEWED");
    const updated = await moveLeadOwnership(tx, { agencyId, lead, ownerUserId: target.id, actorId, reason: assignmentReason });
    const approved = await tx.leadTransferRequest.findUnique({ where: { id: request.id }, include: transferRequestInclude });
    await tx.activityLog.create({ data: { agencyId, userId: actorId, action: "lead.transfer_approved", details: `${lead.leadNumber}: ${assignmentReason}`, entityType: "leadTransferRequest", entityId: request.id, metadata: { leadId: lead.id, fromOwnerId: lead.ownerUserId, toOwnerId: target.id } } });
    return { stale: false, request: approved, updated };
  }, leadTransactionOptions);
  if (db === prisma) await resolveNotifications({ agencyId, entityType: "leadTransferRequest", entityId: req.params.requestId, types: ["lead.transfer_approval_required"] }).catch(() => {});
  if (result.stale) throw createHttpError(409, "The lead changed after this request was submitted. The request was closed without transferring it.", "TRANSFER_REQUEST_STALE");
  if (db === prisma) {
    await notifyUsers({ agencyId, recipientIds: [...new Set([result.request.requestedById, result.request.toOwnerId])], actorUserId: actorId, type: "lead.transfer_approved", category: "leads", title: `Lead transfer approved: ${result.updated.leadNumber}`, body: `${result.request.toOwner.fullName} is now responsible for this lead and its pending follow-ups.`, severity: "info", entityType: "lead", entityId: result.updated.id, actionUrl: "/leads", destinationKey: "leads", dedupeKey: `lead-transfer:${result.request.id}:approved` }).catch(() => {});
  }
  return { request: result.request, lead: result.updated };
}

export async function rejectLeadTransferRequest(req, db = prisma) {
  const agencyId = req.auth.agencyId;
  const actorId = req.auth.userId;
  const reviewNote = String(req.body?.reviewNote || "").trim().slice(0, 500) || null;
  const request = await db.$transaction(async (tx) => {
    const requestSummary = await tx.leadTransferRequest.findFirst({ where: { id: req.params.requestId, agencyId }, select: { leadId: true } });
    if (!requestSummary) throw createHttpError(404, "Lead transfer request was not found.", "NOT_FOUND");
    await lockLeadTransfer(tx, agencyId, requestSummary.leadId);
    const current = await tx.leadTransferRequest.findFirst({ where: { id: req.params.requestId, agencyId }, include: transferRequestInclude });
    if (!current) throw createHttpError(404, "Lead transfer request was not found.", "NOT_FOUND");
    if (current.status !== "PENDING") throw createHttpError(409, "This lead transfer request has already been reviewed.", "TRANSFER_ALREADY_REVIEWED");
    const claimed = await tx.leadTransferRequest.updateMany({ where: { id: current.id, status: "PENDING" }, data: { status: "REJECTED", reviewedById: actorId, reviewedAt: new Date(), reviewNote } });
    if (claimed.count !== 1) throw createHttpError(409, "This lead transfer request has already been reviewed.", "TRANSFER_ALREADY_REVIEWED");
    const updated = await tx.leadTransferRequest.findUnique({ where: { id: current.id }, include: transferRequestInclude });
    await tx.leadActivity.create({ data: { agencyId, leadId: current.leadId, activityType: "INTERNAL_NOTE", direction: "INTERNAL", channel: "SYSTEM", title: "Lead transfer declined", description: reviewNote || "An administrator declined the transfer request.", performedById: actorId, metadata: { transferRequestId: current.id } } });
    await tx.activityLog.create({ data: { agencyId, userId: actorId, action: "lead.transfer_rejected", details: `${current.lead.leadNumber}: transfer to ${current.toOwner.fullName} rejected`, entityType: "leadTransferRequest", entityId: current.id, metadata: { leadId: current.leadId, reviewNote } } });
    return updated;
  }, leadTransactionOptions);
  if (db === prisma) {
    await resolveNotifications({ agencyId, entityType: "leadTransferRequest", entityId: request.id, types: ["lead.transfer_approval_required"] }).catch(() => {});
    await notifyUsers({ agencyId, recipientIds: [request.requestedById], actorUserId: actorId, type: "lead.transfer_rejected", category: "leads", title: `Lead transfer not approved: ${request.lead.leadNumber}`, body: reviewNote || `The requested transfer to ${request.toOwner.fullName} was declined.`, severity: "info", entityType: "lead", entityId: request.leadId, actionUrl: "/leads", destinationKey: "leads", dedupeKey: `lead-transfer:${request.id}:rejected` }).catch(() => {});
  }
  return request;
}

export async function moveLeadToNurture(req, db = prisma) {
  const values = parseLeadNurture(req.body);
  const agencyId = req.auth.agencyId;
  const actorId = req.auth.userId;
  return db.$transaction(async (tx) => {
    const lead = await requireLead(tx, req, req.params.id);
    if (lead.status !== "OPEN") throw createHttpError(409, "Only open leads can move to nurture.", "LEAD_NOT_OPEN");
    await supersedePendingFollowUps(tx, agencyId, lead.id, actorId, "Lead moved to nurture");
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

export async function reactivateLead(req, db = prisma) {
  const values = parseLeadReactivation(req.body);
  const agencyId = req.auth.agencyId;
  const actorId = req.auth.userId;
  return db.$transaction(async (tx) => {
    const lead = await requireLead(tx, req, req.params.id);
    if (lead.status !== "LOST") throw createHttpError(409, "Only lost leads can be reactivated.", "LEAD_NOT_LOST");
    const detail = await tx.leadLostDetail.findUnique({ where: { leadId: lead.id } });
    if (!detail?.reactivationAllowed) throw createHttpError(409, "This lead was not marked as eligible for reactivation.", "REACTIVATION_NOT_ALLOWED");
    await supersedePendingFollowUps(tx, agencyId, lead.id, actorId, "Lead reactivated");
    const dueAt = new Date(Date.now() + 24 * 60 * 60_000);
    const followUp = await tx.leadFollowUp.create({ data: { agencyId, leadId: lead.id, assignedUserId: lead.ownerUserId, type: "FOLLOW_UP", description: values.reason, dueAt } });
    const updated = await tx.lead.update({ where: { id: lead.id }, data: { status: "OPEN", lostAt: null, nextActionType: followUp.type, nextActionDescription: followUp.description, nextActionAt: followUp.dueAt, nextActionOwnerId: followUp.assignedUserId, version: { increment: 1 } }, include: leadInclude });
    await tx.leadActivity.create({ data: { agencyId, leadId: lead.id, activityType: "LEAD_REACTIVATED", direction: "INTERNAL", channel: "SYSTEM", title: "Lead reactivated", description: values.reason, performedById: actorId } });
    await tx.activityLog.create({ data: { agencyId, userId: actorId, action: "lead.reactivated", details: `${lead.leadNumber}: ${values.reason}`, entityType: "lead", entityId: lead.id } });
    return updated;
  }, leadTransactionOptions);
}

export async function promoteLeadToPipeline(req, db = prisma) {
  const agencyId = req.auth.agencyId;
  const actorId = req.auth.userId;
  return db.$transaction(async (tx) => {
    const lead = await requireLead(tx, req, req.params.id);
    if (lead.pipelineSegment === "STANDARD") throw createHttpError(409, "This lead is already in the active pipeline.", "LEAD_ALREADY_STANDARD");
    const updated = await tx.lead.update({ where: { id: lead.id }, data: { pipelineSegment: "STANDARD", version: { increment: 1 } }, include: leadInclude });
    await tx.leadActivity.create({ data: { agencyId, leadId: lead.id, activityType: "LEAD_PROMOTED_TO_PIPELINE", direction: "INTERNAL", channel: "SYSTEM", title: "Promoted to active pipeline", performedById: actorId } });
    await tx.activityLog.create({ data: { agencyId, userId: actorId, action: "lead.promoted_to_pipeline", details: `${lead.leadNumber} moved from Import Review to the active pipeline`, entityType: "lead", entityId: lead.id } });
    return updated;
  }, leadTransactionOptions);
}

// One transaction per lead rather than one giant transaction for the whole
// batch — a single bad id (already promoted, deleted, out of access scope)
// shouldn't roll back everyone else's promotion. Sequential, not
// Promise.all, since the dev DB pool is sized down to a single connection
// (see runtimeDatabaseUrl in prisma/client.js) and concurrent transactions
// there would just serialize behind the pool anyway — better to be
// deliberate about it than rely on that happening to work out.
export async function bulkPromoteLeadsToPipeline(req, db = prisma) {
  const ids = [...new Set((Array.isArray(req.body?.leadIds) ? req.body.leadIds : []).filter((id) => typeof id === "string" && id))].slice(0, 500);
  if (!ids.length) throw createHttpError(400, "Select at least one lead to promote.", "VALIDATION_ERROR");
  const agencyId = req.auth.agencyId;
  const actorId = req.auth.userId;
  const promoted = [];
  const skipped = [];
  for (const id of ids) {
    try {
      await db.$transaction(async (tx) => {
        const lead = await requireLead(tx, req, id);
        if (lead.pipelineSegment === "STANDARD") { skipped.push({ id, leadNumber: lead.leadNumber, reason: "Already in the active pipeline." }); return; }
        await tx.lead.update({ where: { id: lead.id }, data: { pipelineSegment: "STANDARD", version: { increment: 1 } } });
        await tx.leadActivity.create({ data: { agencyId, leadId: lead.id, activityType: "LEAD_PROMOTED_TO_PIPELINE", direction: "INTERNAL", channel: "SYSTEM", title: "Promoted to active pipeline", performedById: actorId, metadata: { bulk: true } } });
        await tx.activityLog.create({ data: { agencyId, userId: actorId, action: "lead.promoted_to_pipeline", details: `${lead.leadNumber} moved from Import Review to the active pipeline (bulk)`, entityType: "lead", entityId: lead.id } });
        promoted.push({ id, leadNumber: lead.leadNumber });
      }, leadTransactionOptions);
    } catch (error) {
      skipped.push({ id, reason: error.message || "Could not be promoted." });
    }
  }
  return { promoted, skipped };
}

// Least-loaded-first distribution: seeded from each target's real current
// open-lead count, then updated in memory as the batch is worked through —
// this is what actually corrects an existing imbalance (one person holding
// most of the pipeline) rather than just spreading new leads evenly the way
// plain round-robin would. Sequential per-lead transactions, matching
// bulkPromoteLeadsToPipeline exactly: this DB's connection pool is sized to
// a single connection, so concurrent $transaction calls would only queue
// behind each other anyway, and one bad lead should never roll back the
// rest of the batch.
export async function bulkReassignLeads(req, db = prisma) {
  const { leadIds, targetUserIds } = parseBulkReassignment(req.body);
  const agencyId = req.auth.agencyId;
  const actorId = req.auth.userId;
  const runId = randomUUID();

  for (const targetUserId of targetUserIds) await requireLeadStaff(db, agencyId, targetUserId);

  const grouped = await db.lead.groupBy({
    by: ["ownerUserId"],
    where: { agencyId, ownerUserId: { in: targetUserIds }, status: "OPEN" },
    _count: true,
  });
  const counts = new Map(targetUserIds.map((id) => [id, 0]));
  for (const row of grouped) counts.set(row.ownerUserId, row._count);

  const reassigned = [];
  const skipped = [];
  for (const id of leadIds) {
    const targetUserId = [...counts.entries()].sort(
      (a, b) => a[1] - b[1] || targetUserIds.indexOf(a[0]) - targetUserIds.indexOf(b[0]),
    )[0][0];
    try {
      let succeeded = false;
      await db.$transaction(async (tx) => {
        const lead = await requireLead(tx, req, id);
        if (lead.ownerUserId === targetUserId) {
          skipped.push({ id, leadNumber: lead.leadNumber, reason: "Already owned by the selected team member." });
          return;
        }
        const updated = await moveLeadOwnership(tx, {
          agencyId,
          lead,
          ownerUserId: targetUserId,
          actorId,
          reason: "Bulk rebalance",
          assignmentType: "ROUND_ROBIN",
        });
        await tx.activityLog.create({
          data: {
            agencyId,
            userId: actorId,
            action: "lead.bulk_reassigned",
            details: `${lead.leadNumber} rebalanced to a new owner`,
            entityType: "lead",
            entityId: lead.id,
            metadata: { runId, previousOwnerId: lead.ownerUserId, ownerUserId: targetUserId },
          },
        });
        reassigned.push({ id, leadNumber: updated.leadNumber, ownerUserId: targetUserId });
        succeeded = true;
      }, leadTransactionOptions);
      if (succeeded) counts.set(targetUserId, (counts.get(targetUserId) || 0) + 1);
    } catch (error) {
      skipped.push({ id, reason: error.message || "Could not be reassigned." });
    }
  }

  if (db === prisma) {
    const byOwner = new Map();
    for (const item of reassigned) byOwner.set(item.ownerUserId, (byOwner.get(item.ownerUserId) || 0) + 1);
    for (const [ownerUserId, count] of byOwner) {
      await notifyUsers({
        agencyId,
        recipientIds: [ownerUserId],
        actorUserId: actorId,
        type: "lead.bulk_reassigned",
        category: "leads",
        title: `${count} lead${count === 1 ? "" : "s"} reassigned to you`,
        body: "Rebalanced from another team member's queue.",
        severity: "info",
        actionUrl: "/leads",
        dedupeKey: `lead-bulk-reassign:${runId}:${ownerUserId}`,
      });
    }
  }

  return { reassigned, skipped };
}

export async function changeLeadStage(req, db = prisma) {
  const values = parseLeadStageChange(req.body);
  const agencyId = req.auth.agencyId;
  const actorId = req.auth.userId;
  return db.$transaction(async (tx) => {
    const lead = await requireLead(tx, req, req.params.id);
    assertLeadWorkflowEditable(req, lead);
    if (!["OPEN", "NURTURE"].includes(lead.status)) throw createHttpError(409, "Only open or nurtured leads can have their stage changed.", "LEAD_NOT_OPEN");
    if (values.stage === lead.stage) throw createHttpError(409, "This lead is already at that stage.", "LEAD_STAGE_UNCHANGED");
    const updated = await tx.lead.update({ where: { id: lead.id }, data: { stage: values.stage, version: { increment: 1 } }, include: leadInclude });
    await tx.leadStageHistory.create({ data: { agencyId, leadId: lead.id, previousStage: lead.stage, newStage: values.stage, changedById: actorId, reason: values.reason || "Manually changed" } });
    const stageLabel = values.stage.toLowerCase().split("_").map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ");
    await tx.leadActivity.create({ data: { agencyId, leadId: lead.id, activityType: "STAGE_CHANGED", direction: "INTERNAL", channel: "SYSTEM", title: `Stage changed to ${stageLabel}`, description: values.reason, performedById: actorId, metadata: { previousStage: lead.stage, newStage: values.stage, manual: true } } });
    await tx.activityLog.create({ data: { agencyId, userId: actorId, action: "lead.stage_changed", details: `${lead.leadNumber}: ${lead.stage} → ${values.stage}`, entityType: "lead", entityId: lead.id, metadata: { previousStage: lead.stage, newStage: values.stage } } });
    return updated;
  }, leadTransactionOptions);
}

export async function changeLeadPriority(req, db = prisma) {
  const values = parseLeadPriorityChange(req.body);
  const agencyId = req.auth.agencyId;
  const actorId = req.auth.userId;
  return db.$transaction(async (tx) => {
    const lead = await requireLead(tx, req, req.params.id);
    assertLeadWorkflowEditable(req, lead);
    if (!["OPEN", "NURTURE"].includes(lead.status)) throw createHttpError(409, "Only open or nurtured leads can have their priority changed.", "LEAD_NOT_OPEN");
    if (values.priority === lead.priority) throw createHttpError(409, "This lead is already at that priority.", "LEAD_PRIORITY_UNCHANGED");
    const updated = await tx.lead.update({ where: { id: lead.id }, data: { priority: values.priority, version: { increment: 1 } }, include: leadInclude });
    await tx.leadActivity.create({ data: { agencyId, leadId: lead.id, activityType: "PRIORITY_CHANGED", direction: "INTERNAL", channel: "SYSTEM", title: `Priority changed to ${values.priority.charAt(0)}${values.priority.slice(1).toLowerCase()}`, description: values.reason, performedById: actorId, metadata: { previousPriority: lead.priority, newPriority: values.priority } } });
    await tx.activityLog.create({ data: { agencyId, userId: actorId, action: "lead.priority_changed", details: `${lead.leadNumber}: ${lead.priority} → ${values.priority}`, entityType: "lead", entityId: lead.id, metadata: { previousPriority: lead.priority, newPriority: values.priority } } });
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

    const workflow = qualificationWorkflow(values.outcome);
    const stageOrder = ["NEW", "ASSIGNED", "CONTACTING", "CONNECTED", "QUALIFIED", "CONSULTATION_BOOKED", "CONSULTATION_COMPLETED", "RETAINER_PENDING", "PAYMENT_PENDING", "READY_TO_CONVERT"];
    const nextStage = workflow.stage && stageOrder.indexOf(lead.stage) < stageOrder.indexOf(workflow.stage) ? workflow.stage : lead.stage;
    await tx.lead.update({
      where: { id: lead.id },
      data: {
        immigrationInterest: values.immigrationService,
        currentImmigrationStatus: values.currentImmigrationStatus,
        ...(values.urgency ? { priority: values.urgency } : {}),
        ...(values.estimatedBudget != null && lead.estimatedValue == null ? { estimatedValue: values.estimatedBudget } : {}),
        ...(nextStage !== lead.stage ? { stage: nextStage } : {}),
        nextActionType: workflow.type,
        nextActionDescription: workflow.description,
        nextActionAt: workflow.at,
        nextActionOwnerId: lead.ownerUserId,
        version: { increment: 1 },
      },
    });

    await supersedePendingFollowUps(tx, agencyId, lead.id, actorId, "Qualification updated the next action");
    await tx.leadFollowUp.create({ data: { agencyId, leadId: lead.id, assignedUserId: lead.ownerUserId, type: workflow.type, description: workflow.description, dueAt: workflow.at } });
    if (nextStage !== lead.stage) {
      await tx.leadStageHistory.create({ data: { agencyId, leadId: lead.id, previousStage: lead.stage, newStage: nextStage, changedById: actorId, reason: "Qualification completed" } });
      await tx.leadActivity.create({ data: { agencyId, leadId: lead.id, activityType: "STAGE_CHANGED", direction: "INTERNAL", channel: "SYSTEM", title: `Stage changed to ${humanizeForAudit(nextStage)}`, performedById: actorId, metadata: { previousStage: lead.stage, newStage: nextStage } } });
    }
    await tx.leadActivity.create({ data: { agencyId, leadId: lead.id, activityType: "INTERNAL_NOTE", direction: "INTERNAL", channel: "SYSTEM", outcome: values.outcome, title: previousQualification ? "Qualification updated" : "Qualification completed", description: values.notes, performedById: actorId, metadata: { outcome: values.outcome, eligibilityConfidence: values.eligibilityConfidence } } });
    await tx.activityLog.create({ data: { agencyId, userId: actorId, action: previousQualification ? "lead.qualification_updated" : "lead.qualified", details: `${lead.leadNumber}: ${values.outcome}`, entityType: "lead", entityId: lead.id, metadata: { beforeOutcome: previousQualification?.outcome || null, outcome: values.outcome } } });
    return qualification;
  }, leadTransactionOptions);
}

export function qualificationWorkflow(outcome) {
  const at = new Date(Date.now() + 24 * 60 * 60_000);
  const workflows = {
    QUALIFIED: { stage: "QUALIFIED", type: "BOOK_CONSULTATION", description: "Book a consultation" },
    CONSULTATION_REQUIRED: { stage: null, type: "BOOK_CONSULTATION", description: "Book a consultation to finish assessing eligibility" },
    MORE_INFORMATION_REQUIRED: { stage: null, type: "FOLLOW_UP", description: "Follow up to gather the missing information" },
    NOT_ELIGIBLE: { stage: null, type: "MARK_LOST", description: "Not eligible — confirm and mark the lead lost" },
    FUTURE_OPPORTUNITY: { stage: null, type: "NURTURE", description: "Not ready yet — move to nurture" },
    SERVICE_NOT_OFFERED: { stage: null, type: "MARK_LOST", description: "Service not offered — confirm and mark the lead lost" },
  };
  return { ...workflows[outcome], at };
}

const consultationInclude = {
  consultant: { select: { id: true, fullName: true, email: true } },
  createdBy: { select: { id: true, fullName: true } },
  appointment: { include: { assignedTo: { select: { id: true, fullName: true } } } },
};

export function nextConsultationAction(status, outcome, startAt = null) {
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
  const meetingMode = values.appointmentType === "PHONE"
    ? MEETING_MODES.PHONE
    : values.appointmentType === "ZOOM"
      ? MEETING_MODES.ZOOM
      : ["VIDEO", "JITSI"].includes(values.appointmentType)
        ? MEETING_MODES.JITSI
        : MEETING_MODES.IN_PERSON;
  let preflightLocation = null;
  if (db === prisma) {
    const [lead, settings] = await Promise.all([
      requireLead(prisma, req, req.params.id),
      getOrCreateBookingSettings(agencyId),
    ]);
    assertMeetingModeConfigured({ settings, mode: meetingMode, guestPhone: lead.phone });
    if (meetingMode === MEETING_MODES.ZOOM) await assertZoomOperational(agencyId);
    const locations = Array.isArray(settings.locations) ? settings.locations : [];
    if (meetingMode === MEETING_MODES.IN_PERSON) {
      preflightLocation = locations.find((location) => location.id === values.locationId)
        || (locations.length === 1 ? locations[0] : null);
      if (!preflightLocation) throw createHttpError(400, "Choose an office location.", "VALIDATION_ERROR");
    }
    const dayKey = localDateKey(values.startAt, settings.timezone);
    const offered = await availabilityForRange({
      agencyId,
      assignedToId: values.consultantUserId,
      durationMinutes: 30,
      fromKey: dayKey,
      toKey: dayKey,
      minNoticeOverrideMinutes: 0,
      locationId: preflightLocation?.id || null,
      meetingMode,
    });
    if (!(offered.days[dayKey] || []).some((slot) => slot.startsAt === values.startAt.toISOString())) {
      throw createHttpError(409, "That time is outside the consultant’s bookable hours or is no longer available.", "SLOT_TAKEN");
    }
  }

  const result = await db.$transaction(async (tx) => {
    const lead = await requireLead(tx, req, req.params.id);
    if (lead.status !== "OPEN") throw createHttpError(409, "Only open leads can book consultations.", "LEAD_NOT_OPEN");
    if (values.paymentStatus === "PAID" && req.auth.role !== "admin") {
      throw createHttpError(403, "Only an admin can mark a consultation payment received without linked payment evidence.", "FORBIDDEN");
    }
    const consultant = await tx.user.findFirst({
      where: { id: values.consultantUserId, agencyId, status: "active", memberships: { some: { agencyId, isActive: true, role: { in: ["admin", "consultant"] } } } },
      select: { id: true, schedulingPreference: { select: { acceptsAppointments: true, bufferMinutes: true } } },
    });
    if (!consultant) throw createHttpError(400, "Consultant must be active scheduling staff.", "INVALID_CONSULTANT");
    if (consultant.schedulingPreference?.acceptsAppointments === false) {
      throw createHttpError(409, "This consultant is not accepting appointments.", "INVALID_CONSULTANT");
    }

    await lockSchedulingTransaction(tx, agencyId, values.startAt);
    const settings = await tx.bookingSettings.findUnique({ where: { agencyId } });
    assertMeetingModeConfigured({ settings, mode: meetingMode, guestPhone: lead.phone });
    if (meetingMode === MEETING_MODES.ZOOM) {
      await assertZoomOperational(agencyId, tx);
      const mapped = await tx.zoomHostMapping.findFirst({ where: { agencyId, userId: values.consultantUserId, status: "active" }, select: { id: true } });
      if (!mapped) throw createHttpError(409, "Zoom is not configured for this consultant.", "ZOOM_HOST_NOT_MAPPED");
    }
    const locations = Array.isArray(settings?.locations) ? settings.locations : [];
    const location = meetingMode === MEETING_MODES.IN_PERSON
      ? locations.find((item) => item.id === values.locationId) || preflightLocation || (locations.length === 1 ? locations[0] : null)
      : null;
    if (meetingMode === MEETING_MODES.IN_PERSON && !location) {
      throw createHttpError(400, "Choose an office location.", "VALIDATION_ERROR");
    }
    const conflict = await assertSlotAvailable(tx, {
      agencyId,
      assignedToId: values.consultantUserId,
      startsAt: values.startAt,
      endsAt: values.endAt,
      bufferMinutes: consultant.schedulingPreference?.bufferMinutes ?? settings?.bufferMinutes ?? 0,
    });
    if (conflict) throw createHttpError(409, "That consultant already has an appointment at this time.", "SLOT_TAKEN");
    const meetingFields = appointmentMeetingFields({ mode: meetingMode, settings });
    const appointment = await tx.appointment.create({ data: {
      agencyId,
      leadId: lead.id,
      subject: "Lead consultation",
      location: location ? `${location.name} — ${location.address}` : null,
      locationId: location?.id || null,
      locationMapsUrl: location?.mapsUrl || null,
      calendar: "Workspace Calendar",
      startsAt: values.startAt,
      endsAt: values.endAt,
      description: values.notes,
      purpose: values.notes,
      guestName: [lead.firstName, lead.lastName].filter(Boolean).join(" ") || null,
      guestEmail: lead.email,
      guestEmailNormalized: lead.emailNormalized,
      guestPhone: lead.phone,
      ...meetingFields,
      reminderDueAt: new Date(values.startAt.getTime() - Math.max(...(Array.isArray(settings?.reminderSchedule) && settings.reminderSchedule.length ? settings.reminderSchedule : [settings?.reminderMinutes || 1440])) * 60_000),
      assignedToId: values.consultantUserId,
      createdById: actorId,
      source: "Lead",
      status: "Scheduled",
    } });
    await recordAppointmentEvent(tx, {
      agencyId,
      appointmentId: appointment.id,
      actorUserId: actorId,
      type: "BOOKED",
      summary: "Lead consultation booked",
      metadata: { leadId: lead.id },
    });
    if (meetingMode === MEETING_MODES.ZOOM) {
      await enqueueAppointmentMeetingJob(tx, { appointment, action: "SYNC", notifyKind: "booked", actorUserId: actorId });
    } else if (db === prisma) {
      await sendBookingMessages({ agencyId, appointment, kind: "booked", actorUserId: actorId, db: tx });
    }
    const { locationId: _locationId, ...consultationValues } = values;
    const consultation = await tx.leadConsultation.create({ data: { ...consultationValues, location: appointment.location, meetingUrl: appointment.meetingUrl, agencyId, leadId: lead.id, createdById: actorId, appointmentId: appointment.id, status: "SCHEDULED" }, include: consultationInclude });
    const stageOrder = ["NEW", "ASSIGNED", "CONTACTING", "CONNECTED", "QUALIFIED", "CONSULTATION_BOOKED", "CONSULTATION_COMPLETED", "RETAINER_PENDING", "PAYMENT_PENDING", "READY_TO_CONVERT"];
    const advanceStage = stageOrder.indexOf(lead.stage) < stageOrder.indexOf("CONSULTATION_BOOKED");
    const next = nextConsultationAction("SCHEDULED", null, values.startAt);
    await tx.lead.update({ where: { id: lead.id }, data: { ...(advanceStage ? { stage: "CONSULTATION_BOOKED" } : {}), nextActionType: next.type, nextActionDescription: next.description, nextActionAt: next.at, nextActionOwnerId: values.consultantUserId, version: { increment: 1 } } });
    if (advanceStage) await tx.leadStageHistory.create({ data: { agencyId, leadId: lead.id, previousStage: lead.stage, newStage: "CONSULTATION_BOOKED", changedById: actorId, reason: "Consultation scheduled" } });
    await supersedePendingFollowUps(tx, agencyId, lead.id, actorId, "Consultation booked");
    await tx.leadFollowUp.create({ data: { agencyId, leadId: lead.id, assignedUserId: values.consultantUserId, type: next.type, description: next.description, dueAt: next.at } });
    await tx.leadActivity.create({ data: { agencyId, leadId: lead.id, activityType: "CONSULTATION_BOOKED", direction: "INTERNAL", channel: "SYSTEM", title: "Consultation scheduled", description: values.notes, performedById: actorId, metadata: { consultationId: consultation.id, startAt: values.startAt, consultantUserId: values.consultantUserId } } });
    await tx.activityLog.create({ data: { agencyId, userId: actorId, action: "lead.consultation_booked", details: `${lead.leadNumber}: ${values.startAt.toISOString()}`, entityType: "lead", entityId: lead.id, metadata: { consultationId: consultation.id } } });
    return consultation;
  }, leadTransactionOptions);
  if (db === prisma) {
    await notifyUsers({ agencyId, recipientIds: [values.consultantUserId], actorUserId: actorId, type: "lead.consultation_booked", category: "leads", title: "Lead consultation booked", body: values.startAt.toISOString(), severity: "info", entityType: "lead", entityId: req.params.id, actionUrl: "/leads", dedupeKey: `lead-consultation:${result.id}:booked:${result.startAt.toISOString()}` });
    if (result.appointment && result.appointment.meetingMode !== MEETING_MODES.ZOOM) void processBookingMessageDeliveries();
    triggerRetainerFlow(result.appointment);
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
      const appointment = await tx.appointment.update({
        where: { id: existing.appointmentId },
        data: {
          status: appointmentStatus,
          ...(appointmentStatus === "Cancelled" ? { cancelledAt: new Date(), cancelledById: actorId, cancellationReason: values.notes || null } : {}),
        },
      });
      await syncLeadConsultationFromAppointment(tx, appointment, {
        consultationStatus: values.status,
        // This workflow records a richer activity below with outcome and actor.
        recordLeadActivity: false,
      });
      await recordAppointmentEvent(tx, {
        agencyId,
        appointmentId: appointment.id,
        actorUserId: actorId,
        type: appointmentStatus === "Cancelled" ? "CANCELLED" : "STATUS_CHANGED",
        summary: appointmentStatus === "Cancelled" ? "Lead consultation cancelled" : `Appointment marked ${appointmentStatus}`,
        metadata: { from: existing.status, to: values.status, consultationId: existing.id },
      });
      if (db === prisma && appointmentStatus === "Cancelled") {
        await sendBookingMessages({ agencyId, appointment, kind: "cancelled", actorUserId: actorId, db: tx });
        if (appointment.meetingProvider === "Zoom" && appointment.meetingProviderId) {
          await enqueueAppointmentMeetingJob(tx, {
            appointment,
            action: "DELETE",
            providerMeetingId: appointment.meetingProviderId,
            dedupeSuffix: "lead-cancelled",
          });
        }
      } else if (db === prisma && appointmentStatus === "NoShow") {
        await sendBookingStaffNotification({ agencyId, appointment, kind: "no_show", actorUserId: actorId, db: tx });
      } else if (db === prisma && appointmentStatus === "Completed") {
        await sendBookingStaffNotification({ agencyId, appointment, kind: "attended", actorUserId: actorId, db: tx });
      }
    }
    const completedStage = values.outcome === "PAYMENT_REQUIRED" ? "PAYMENT_PENDING" : ["READY_TO_PROCEED", "AGREEMENT_REQUIRED"].includes(values.outcome) ? "RETAINER_PENDING" : "CONSULTATION_COMPLETED";
    const nextStage = values.status === "COMPLETED" ? completedStage : lead.stage;
    const next = nextConsultationAction(values.status, values.outcome, existing.startAt);
    await tx.lead.update({ where: { id: lead.id }, data: { stage: nextStage, nextActionType: next.type, nextActionDescription: next.description, nextActionAt: next.at, nextActionOwnerId: existing.consultantUserId, version: { increment: 1 } } });
    if (nextStage !== lead.stage) await tx.leadStageHistory.create({ data: { agencyId, leadId: lead.id, previousStage: lead.stage, newStage: nextStage, changedById: actorId, reason: `Consultation ${values.status.toLowerCase()}` } });
    await supersedePendingFollowUps(tx, agencyId, lead.id, actorId, `Consultation ${values.status.toLowerCase()}`);
    await tx.leadFollowUp.create({ data: { agencyId, leadId: lead.id, assignedUserId: existing.consultantUserId, type: next.type, description: next.description, dueAt: next.at } });
    const activityType = values.status === "COMPLETED" ? "CONSULTATION_COMPLETED" : values.status === "CANCELLED" ? "CONSULTATION_CANCELLED" : values.status === "NO_SHOW" ? "CONSULTATION_NO_SHOW" : values.status === "RESCHEDULED" ? "CONSULTATION_RESCHEDULED" : "INTERNAL_NOTE";
    await tx.leadActivity.create({ data: { agencyId, leadId: lead.id, activityType, direction: "INTERNAL", channel: "SYSTEM", outcome: values.outcome, title: `Consultation ${humanizeForAudit(values.status)}`, description: values.notes, performedById: actorId, metadata: { consultationId: existing.id, status: values.status, outcome: values.outcome } } });
    await tx.activityLog.create({ data: { agencyId, userId: actorId, action: "lead.consultation_updated", details: `${lead.leadNumber}: ${values.status}`, entityType: "lead", entityId: lead.id, metadata: { consultationId: existing.id, status: values.status, outcome: values.outcome } } });
    return consultation;
  }, leadTransactionOptions);
  if (db === prisma) {
    await notifyUsers({ agencyId, recipientIds: [result.consultantUserId], actorUserId: actorId, type: "lead.consultation_updated", category: "leads", title: `Lead consultation ${String(result.status).toLowerCase().replaceAll("_", " ")}`, body: result.startAt.toISOString(), severity: result.status === "NO_SHOW" ? "warning" : "info", entityType: "lead", entityId: req.params.id, actionUrl: "/leads", dedupeKey: `lead-consultation:${result.id}:${result.status}:${result.updatedAt.toISOString()}` });
    if (["CANCELLED", "NO_SHOW", "COMPLETED"].includes(result.status)) void processBookingMessageDeliveries();
    if (result.appointment && result.status === "CANCELLED") {
      const cancelledAppointment = { ...result.appointment, status: "Cancelled" };
      await offerWaitlistOpening(cancelledAppointment).catch(() => {});
    }
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
    const settingSigned = retainerStatus === "SIGNED" && lead.retainerStatus !== "SIGNED";
    const settingPaid = ["PAID", "WAIVED"].includes(initialPaymentStatus) && !["PAID", "WAIVED"].includes(lead.initialPaymentStatus);
    // Same admin-or-owning-consultant rule as changeLeadStage/changeLeadPriority
    // (see assertLeadWorkflowEditable) — a consultant confirming their own
    // lead's retainer/payment isn't a stranger overriding someone else's
    // pipeline, it's the person who was actually there for it.
    if (settingSigned || settingPaid) assertLeadWorkflowEditable(req, lead);
    if (retainerStatus === lead.retainerStatus && initialPaymentStatus === lead.initialPaymentStatus) throw createHttpError(409, "No status change was provided.", "NO_STATUS_CHANGE");
    const workflow = commercialWorkflow(retainerStatus, initialPaymentStatus);
    const updated = await tx.lead.update({
      where: { id: lead.id },
      data: { retainerStatus, initialPaymentStatus, stage: workflow.stage, nextActionType: workflow.type, nextActionDescription: workflow.description, nextActionAt: workflow.at, nextActionOwnerId: lead.ownerUserId, version: { increment: 1 } },
      include: leadInclude,
    });
    if (workflow.stage !== lead.stage) await tx.leadStageHistory.create({ data: { agencyId, leadId: lead.id, previousStage: lead.stage, newStage: workflow.stage, changedById: actorId, reason: "Retainer or initial-payment status updated" } });
    await supersedePendingFollowUps(tx, agencyId, lead.id, actorId, "Commercial status updated");
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

// Unblocks the lead conversion checklist for a retainer that was signed
// outside the automated flow (see updateCommercialStatus's manual "Signed"
// option) — there's otherwise no client/case to record the initial payment
// against, and no way forward except marking it Waived even when a real
// payment was collected. Same admin-or-owning-consultant gate as converting
// the lead itself: this creates a real Client + Case, same consequential
// write.
export async function createClientForPayment(req, db = prisma) {
  const lead = await requireLead(db, req, req.params.id);
  if (lead.status !== "OPEN") throw createHttpError(409, "Only open leads can do this.", "LEAD_NOT_OPEN");
  if (lead.earlyClientId) throw createHttpError(409, "This lead already has a linked client.", "LEAD_ALREADY_HAS_CLIENT");
  const retainerReady = ["SIGNED", "NOT_REQUIRED"].includes(lead.retainerStatus);
  if (!retainerReady) throw createHttpError(409, "Mark the retainer Signed or Not Required before creating a client to record payment against.", "RETAINER_NOT_READY");
  assertLeadWorkflowEditable(req, lead);
  const created = await createLeadClientForPayment(lead.id, { db, actorUserId: req.auth.userId });
  if (!created) throw createHttpError(409, "This lead already has a linked client, or is no longer open.", "LEAD_ALREADY_HAS_CLIENT");
  return created;
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

// Same defaults ConvertLeadSheet.jsx pre-fills the manual conversion form
// with — reused so an automatic conversion (convertLeadCore called with no
// values, see lead.financial.service.js's syncLeadInitialPaymentFromEvidence)
// behaves exactly like a human opening that form and submitting it
// unedited, not like a different, invented flow.
const AUTO_CONVERSION_DEFAULT_CASE_STAGE = "Documents Pending";
const AUTO_CONVERSION_DEFAULT_NEXT_ACTION = "Complete client intake and collect initial documents";

// The shared transaction body behind both the human-initiated HTTP
// endpoint (convertLead below) and the automatic conversion triggered by
// syncLeadInitialPaymentFromEvidence when an early client's initial
// payment clears. Re-validates everything itself (not just relying on a
// caller's earlier check) since it has to be safe to call from a
// background job with no request/session backing it. `values` is the
// human-submitted form payload for the HTTP path; omit it (or pass null)
// to have this derive the same values ConvertLeadSheet.jsx would default
// to, for an unattended conversion.
export async function convertLeadCore(agencyId, leadId, { actorId, values = null }, db = prisma) {
  return db.$transaction(async (tx) => {
    const lead = await tx.lead.findFirst({ where: { id: leadId, agencyId } });
    if (!lead) throw createHttpError(404, "Lead not found.", "NOT_FOUND");
    if (lead.status === "CONVERTED" || lead.convertedClientId) throw createHttpError(409, "This lead has already been converted.", "LEAD_ALREADY_CONVERTED");
    if (lead.status !== "OPEN") throw createHttpError(409, "Only open leads can be converted.", "LEAD_NOT_OPEN");
    const retainerReady = ["SIGNED", "NOT_REQUIRED"].includes(lead.retainerStatus);
    const paymentReady = ["PAID", "WAIVED"].includes(lead.initialPaymentStatus);
    if (lead.stage !== "READY_TO_CONVERT" || !retainerReady || !paymentReady) {
      throw createHttpError(409, "Complete the retainer and initial-payment requirements before conversion.", "LEAD_NOT_READY_TO_CONVERT");
    }

    const existingConversion = await tx.leadConversion.findUnique({ where: { leadId: lead.id }, select: { id: true } });
    if (existingConversion) throw createHttpError(409, "This lead has already been converted.", "LEAD_ALREADY_CONVERTED");

    if (!values) {
      // Automatic path — nobody typed this in. Case.caseType can never be
      // blank, so if the lead's own immigrationInterest is unusable, fall
      // back to whatever the existing early case is already using rather
      // than fail a conversion that financial evidence says is genuinely
      // ready.
      const fallbackCaseType = lead.earlyCaseId
        ? (await tx.case.findUnique({ where: { id: lead.earlyCaseId }, select: { caseType: true } }))?.caseType
        : null;
      const derivedCaseType = canonicalCaseType(lead.immigrationInterest) || fallbackCaseType;
      if (!derivedCaseType) throw createHttpError(409, "This lead has no case type to convert into — set an immigration interest, or convert manually.", "LEAD_CASE_TYPE_UNKNOWN");
      values = {
        givenNames: lead.firstName || "",
        familyName: lead.lastName || "",
        fullName: [lead.firstName, lead.lastName].filter(Boolean).join(" ") || lead.leadNumber,
        caseType: derivedCaseType,
        caseStage: AUTO_CONVERSION_DEFAULT_CASE_STAGE,
        caseNextAction: AUTO_CONVERSION_DEFAULT_NEXT_ACTION,
        studyIntakeMonth: null,
        actualValue: lead.estimatedValue ? Number(lead.estimatedValue) : null,
        notes: null,
      };
    }

    const qualification = await tx.leadQualification.findUnique({ where: { leadId: lead.id } });

    // A retainer may already have been requested and signed before this
    // lead was formally converted (see lead.retainer.service.js) — reuse
    // that client/case instead of creating a second one. Its phone/email
    // duplicate-checked clean against this exact lead when it was created,
    // so there's nothing new to re-check here.
    let client;
    let caseItem;
    if (lead.earlyClientId && lead.earlyCaseId) {
      client = await tx.client.update({
        where: { id: lead.earlyClientId },
        data: { fullName: values.fullName, givenNames: values.givenNames, familyName: values.familyName },
      });
      caseItem = await tx.case.update({
        where: { id: lead.earlyCaseId },
        data: { caseType: values.caseType, stage: values.caseStage, nextAction: values.caseNextAction, studyIntakeMonth: values.studyIntakeMonth },
      });
    } else {
      await lockAgencyContactIntake(tx, agencyId);
      await assertNoContactDuplicate(tx, {
        agencyId,
        phoneNormalized: lead.phoneNormalized,
        emailNormalized: lead.emailNormalized,
        excludeLeadId: lead.id,
      });
      const clientNumber = await nextClientNumber(tx, agencyId);
      client = await tx.client.create({
        data: { agencyId, clientNumber, fullName: values.fullName, givenNames: values.givenNames, familyName: values.familyName, phone: lead.phone, phoneNormalized: lead.phoneNormalized, email: lead.email, emailNormalized: lead.emailNormalized, preferredLanguage: lead.preferredLanguage, status: "Active", assignedUserId: lead.ownerUserId },
      });
      caseItem = await tx.case.create({
        data: { agencyId, clientId: client.id, assignedUserId: lead.ownerUserId, caseType: values.caseType, stage: values.caseStage, status: "Active", nextAction: values.caseNextAction, studyIntakeMonth: values.studyIntakeMonth },
      });
    }

    const leadAppointments = await tx.appointment.findMany({ where: { agencyId, leadId: lead.id }, select: { id: true } });
    const leadAppointmentIds = leadAppointments.map((item) => item.id);
    if (leadAppointmentIds.length) {
      await tx.appointment.updateMany({ where: { id: { in: leadAppointmentIds } }, data: { clientId: client.id } });
      await tx.note.updateMany({ where: { appointmentId: { in: leadAppointmentIds }, clientId: null }, data: { clientId: client.id } });
      await tx.followUp.updateMany({ where: { appointmentId: { in: leadAppointmentIds }, clientId: null }, data: { clientId: client.id } });
    }
    await tx.caseManualLedgerEntry.updateMany({ where: { agencyId, leadId: lead.id }, data: { leadId: null, caseId: caseItem.id, clientId: client.id } });

    const summary = qualificationSummary(qualification);
    if (summary || values.notes) {
      await tx.note.create({ data: { agencyId, clientId: client.id, caseId: caseItem.id, userId: actorId, content: [summary, values.notes].filter(Boolean).join("\n\n") } });
    }
    await tx.followUp.create({ data: { agencyId, clientId: client.id, caseId: caseItem.id, assignedUserId: lead.ownerUserId, createdById: actorId, title: values.caseNextAction, description: "First action created during lead conversion", status: "Pending" } });
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

export async function convertLead(req, db = prisma) {
  const values = parseLeadConversion(req.body);
  const agencyId = req.auth.agencyId;

  if (req.auth.role === "consultant" && !isGlobalCaseType(values.caseType)) {
    const caseTypes = await listAgencyCaseTypeOptions(agencyId, db);
    if (!caseTypes.some((caseType) => normalizeCaseType(caseType) === normalizeCaseType(values.caseType))) {
      throw createHttpError(400, "Choose a case type from the global or agency list. Ask an administrator to configure a genuinely new service in Settings.", "CASE_TYPE_NOT_CONFIGURED");
    }
  }

  // Converting creates both a client and a case assigned to this lead's
  // owner. Keep that consequential write limited to the administrator or
  // the consultant who actually owns the lead, even when a consultant has
  // workspace-wide Lead visibility or can see the lead through an assigned
  // follow-up. convertLeadCore re-validates everything else itself.
  const lead = await requireLead(db, req, req.params.id);
  assertLeadWorkflowEditable(req, lead);
  return convertLeadCore(agencyId, lead.id, { actorId: req.auth.userId, values }, db);
}
