import prisma from "../services/prisma/client.js";
import { createHttpError } from "../utils/http.js";
import { clientAccessWhere } from "../middleware/authorization.js";
import { portalDataScope } from "../services/portalAccessService.js";
import { leadAccessWhere } from "../modules/leads/lead.permissions.js";
import { createLead as createLeadRecord } from "../modules/leads/lead.service.js";
import { DEFAULT_LEAD_SOURCES } from "../modules/leads/lead.constants.js";
import {
  ensureOomaCallbackFollowUp,
  syncOomaClientCommunication,
  syncOomaLeadActivity,
} from "../services/oomaCallService.js";

const clean = (value, max = 500) => String(value ?? "").trim().slice(0, max);
const callStatuses = new Set(["RINGING", "ANSWERED", "COMPLETED", "MISSED", "FAILED"]);
const callDirections = new Set(["INBOUND", "OUTBOUND"]);
const callResolutions = new Set(["UNRESOLVED", "LINKED_LEAD", "LINKED_CLIENT", "SPAM"]);

const callInclude = {
  lead: { select: { id: true, leadNumber: true, firstName: true, lastName: true, phone: true, status: true, stage: true, owner: { select: { id: true, fullName: true } } } },
  client: { select: { id: true, clientNumber: true, fullName: true, phone: true, status: true } },
  case: { select: { id: true, caseType: true, status: true } },
  handledBy: { select: { id: true, fullName: true, email: true } },
  resolvedBy: { select: { id: true, fullName: true } },
  followUp: { select: { id: true, type: true, description: true, dueAt: true, status: true } },
};

function callAccessWhere(req) {
  const scope = portalDataScope(req, "leads");
  if (req.auth.role === "admin" || req.auth.role === "frontdesk" || scope === "all") return {};
  return {
    OR: [
      { AND: [{ handledByUserId: req.auth.userId }, { resolution: "UNRESOLVED" }] },
      { lead: { ownerUserId: req.auth.userId } },
      { lead: { followUps: { some: { assignedUserId: req.auth.userId, status: "PENDING" } } } },
      { client: { assignedUserId: req.auth.userId } },
      { case: { assignedUserId: req.auth.userId } },
      { case: { assignments: { some: { consultantUserId: req.auth.userId, status: "active" } } } },
    ],
  };
}

async function requireCall(req, include = callInclude) {
  const item = await prisma.oomaCallSession.findFirst({
    where: { id: req.params.id, agencyId: req.auth.agencyId, ...callAccessWhere(req) },
    ...(include && Object.keys(include).length ? { include } : {}),
  });
  if (!item) throw createHttpError(404, "Ooma call not found.", "OOMA_CALL_NOT_FOUND");
  return item;
}

function leadName(lead) {
  return [lead.firstName, lead.lastName].filter(Boolean).join(" ") || lead.leadNumber;
}

async function addMatchSummaries(data, agencyId) {
  const numbers = [...new Set(data.map((item) => item.remoteNumberNormalized).filter(Boolean))];
  if (!numbers.length) return data.map((item) => ({ ...item, matchSummary: { leads: [], clients: [] } }));
  const [leads, clients] = await Promise.all([
    prisma.lead.findMany({
      where: { agencyId, phoneNormalized: { in: numbers }, deletedAt: null },
      select: { id: true, leadNumber: true, firstName: true, lastName: true, phoneNormalized: true, status: true, pipelineSegment: true },
    }),
    prisma.client.findMany({
      where: { agencyId, phoneNormalized: { in: numbers } },
      select: { id: true, clientNumber: true, fullName: true, phoneNormalized: true, status: true },
    }),
  ]);
  return data.map((item) => ({
    ...item,
    matchSummary: {
      leads: leads.filter((lead) => lead.phoneNormalized === item.remoteNumberNormalized).map((lead) => ({ ...lead, fullName: leadName(lead) })),
      clients: clients.filter((client) => client.phoneNormalized === item.remoteNumberNormalized),
    },
  }));
}

export async function listOomaCalls(req, res) {
  const page = Math.max(Number(req.query.page) || 1, 1);
  const limit = Math.min(Math.max(Number(req.query.limit) || 25, 1), 100);
  const status = callStatuses.has(req.query.status) ? req.query.status : null;
  const direction = callDirections.has(req.query.direction) ? req.query.direction : null;
  const resolution = callResolutions.has(req.query.resolution) ? req.query.resolution : null;
  const search = clean(req.query.search, 120);
  const where = {
    agencyId: req.auth.agencyId,
    AND: [
      callAccessWhere(req),
      ...(search ? [{
        OR: [
          { remoteNumber: { contains: search, mode: "insensitive" } },
          { providerCallId: { contains: search, mode: "insensitive" } },
          { extensionLabel: { contains: search, mode: "insensitive" } },
          { lead: { OR: [{ leadNumber: { contains: search, mode: "insensitive" } }, { firstName: { contains: search, mode: "insensitive" } }, { lastName: { contains: search, mode: "insensitive" } }] } },
          { client: { OR: [{ clientNumber: { contains: search, mode: "insensitive" } }, { fullName: { contains: search, mode: "insensitive" } }] } },
        ],
      }] : []),
    ],
    ...(status ? { status } : {}),
    ...(direction ? { direction } : {}),
    ...(resolution ? { resolution } : {}),
  };
  const [raw, total, unresolved] = await Promise.all([
    prisma.oomaCallSession.findMany({ where, include: callInclude, orderBy: { lastEventAt: "desc" }, skip: (page - 1) * limit, take: limit }),
    prisma.oomaCallSession.count({ where }),
    prisma.oomaCallSession.count({ where: { agencyId: req.auth.agencyId, resolution: "UNRESOLVED", ...callAccessWhere(req) } }),
  ]);
  const data = await addMatchSummaries(raw, req.auth.agencyId);
  res.json({ data, meta: { page, limit, total, unresolved, hasMore: page * limit < total } });
}

export async function getOomaCallAttention(req, res) {
  const recent = new Date(Date.now() - 15 * 60_000);
  const data = await prisma.oomaCallSession.findFirst({
    where: { agencyId: req.auth.agencyId, direction: "INBOUND", status: { in: ["RINGING", "ANSWERED"] }, lastEventAt: { gte: recent }, ...callAccessWhere(req) },
    include: callInclude,
    orderBy: { lastEventAt: "desc" },
  });
  res.json({ data });
}

export async function getOomaCall(req, res) {
  res.json({ data: await requireCall(req) });
}

export async function listOomaCallCandidates(req, res) {
  await requireCall(req, {});
  const search = clean(req.query.search, 120);
  const digits = search.replace(/\D/g, "");
  const leadScope = req.auth.role === "admin" || req.auth.role === "frontdesk" ? {} : leadAccessWhere(req);
  const clientScope = req.auth.role === "admin" || req.auth.role === "frontdesk" ? {} : clientAccessWhere(req);
  const [leads, clients] = await Promise.all([
    prisma.lead.findMany({
      where: {
        agencyId: req.auth.agencyId,
        deletedAt: null,
        AND: [leadScope, ...(search ? [{ OR: [{ leadNumber: { contains: search, mode: "insensitive" } }, { firstName: { contains: search, mode: "insensitive" } }, { lastName: { contains: search, mode: "insensitive" } }, { phone: { contains: digits || search, mode: "insensitive" } }, { email: { contains: search, mode: "insensitive" } }] }] : [])],
      },
      select: { id: true, leadNumber: true, firstName: true, lastName: true, phone: true, email: true, status: true, stage: true },
      orderBy: { updatedAt: "desc" },
      take: 12,
    }),
    prisma.client.findMany({
      where: {
        agencyId: req.auth.agencyId,
        AND: [clientScope, ...(search ? [{ OR: [{ clientNumber: { contains: search, mode: "insensitive" } }, { fullName: { contains: search, mode: "insensitive" } }, { phone: { contains: digits || search, mode: "insensitive" } }, { email: { contains: search, mode: "insensitive" } }] }] : [])],
      },
      select: { id: true, clientNumber: true, fullName: true, phone: true, email: true, status: true },
      orderBy: { updatedAt: "desc" },
      take: 12,
    }),
  ]);
  res.json({ data: { leads: leads.map((lead) => ({ ...lead, fullName: leadName(lead) })), clients } });
}

export async function linkOomaCallToLead(req, res) {
  const call = await requireCall(req, {});
  const lead = await prisma.lead.findFirst({
    where: { id: clean(req.body.leadId, 100), agencyId: req.auth.agencyId, deletedAt: null, ...(req.auth.role === "admin" || req.auth.role === "frontdesk" ? {} : leadAccessWhere(req)) },
    select: { id: true },
  });
  if (!lead) throw createHttpError(404, "Lead not found or not available to you.", "LEAD_NOT_FOUND");
  const data = await prisma.oomaCallSession.update({
    where: { id: call.id },
    data: { leadId: lead.id, clientId: null, caseId: null, resolution: "LINKED_LEAD", resolvedAt: new Date(), resolvedById: req.auth.userId },
    include: callInclude,
  });
  await syncOomaLeadActivity(call.id);
  await ensureOomaCallbackFollowUp(call.id);
  res.json({ data });
}

export async function linkOomaCallToClient(req, res) {
  const call = await requireCall(req, {});
  const scope = req.auth.role === "admin" || req.auth.role === "frontdesk" ? {} : clientAccessWhere(req);
  const client = await prisma.client.findFirst({
    where: { id: clean(req.body.clientId, 100), agencyId: req.auth.agencyId, ...scope },
    select: { id: true, assignedUserId: true },
  });
  if (!client) throw createHttpError(404, "Client not found or not available to you.", "CLIENT_NOT_FOUND");
  const caseItem = await prisma.case.findFirst({
    where: { agencyId: req.auth.agencyId, clientId: client.id, deletedAt: null },
    orderBy: { updatedAt: "desc" },
    select: { id: true, assignedUserId: true },
  });
  const data = await prisma.oomaCallSession.update({
    where: { id: call.id },
    data: { clientId: client.id, caseId: caseItem?.id || null, leadId: null, followUpId: null, resolution: "LINKED_CLIENT", resolvedAt: new Date(), resolvedById: req.auth.userId, handledByUserId: call.handledByUserId || caseItem?.assignedUserId || client.assignedUserId || null },
    include: callInclude,
  });
  await syncOomaClientCommunication(call.id);
  res.json({ data });
}

export async function createLeadFromOomaCall(req, res) {
  const call = await requireCall(req, {});
  if (!call.remoteNumberNormalized) throw createHttpError(400, "A valid caller phone number is required before creating a lead.", "INVALID_CALLER_PHONE");
  const sourceDefinition = DEFAULT_LEAD_SOURCES.find(([, type]) => type === "OOMA") || ["Ooma", "OOMA"];
  await prisma.leadSource.createMany({ data: [{ agencyId: req.auth.agencyId, name: sourceDefinition[0], type: sourceDefinition[1] }], skipDuplicates: true });
  const source = await prisma.leadSource.findFirst({ where: { agencyId: req.auth.agencyId, type: "OOMA", isActive: true }, orderBy: { createdAt: "asc" } });
  if (!source) throw createHttpError(409, "The Ooma lead source is unavailable.", "OOMA_SOURCE_UNAVAILABLE");
  const ownerUserId = clean(req.body.ownerUserId, 100) || call.handledByUserId || req.auth.userId;
  const nextActionAt = new Date(Date.now() + 15 * 60_000);
  const lead = await createLeadRecord({
    auth: req.auth,
    body: {
      firstName: clean(req.body.firstName, 100) || null,
      lastName: clean(req.body.lastName, 100) || null,
      phone: call.remoteNumberNormalized,
      email: clean(req.body.email, 320) || null,
      ownerUserId,
      originalSourceId: source.id,
      immigrationInterest: clean(req.body.immigrationInterest, 150) || null,
      initialMessage: clean(req.body.initialMessage, 5000) || `Inbound Ooma call received ${call.startedAt.toISOString()}`,
      priority: clean(req.body.priority, 20) || (call.status === "MISSED" ? "HIGH" : "NORMAL"),
      temperature: "WARM",
      nextActionType: "PHONE_CALL",
      nextActionDescription: `Return Ooma call to ${call.remoteNumberNormalized}`,
      nextActionAt: nextActionAt.toISOString(),
      nextActionOwnerId: ownerUserId,
      firstContactDueAt: nextActionAt.toISOString(),
    },
  });
  await prisma.oomaCallSession.update({
    where: { id: call.id },
    data: { leadId: lead.id, clientId: null, caseId: null, resolution: "LINKED_LEAD", resolvedAt: new Date(), resolvedById: req.auth.userId, handledByUserId: call.handledByUserId || ownerUserId },
  });
  await syncOomaLeadActivity(call.id);
  await ensureOomaCallbackFollowUp(call.id);
  res.status(201).json({ data: { lead, call: await prisma.oomaCallSession.findUnique({ where: { id: call.id }, include: callInclude }) } });
}

export async function markOomaCallSpam(req, res) {
  if (!["admin", "frontdesk"].includes(req.auth.role)) throw createHttpError(403, "Only administrators and front desk staff can mark calls as spam.", "FORBIDDEN");
  const call = await requireCall(req, {});
  const data = await prisma.oomaCallSession.update({
    where: { id: call.id },
    data: { resolution: "SPAM", resolvedAt: new Date(), resolvedById: req.auth.userId, leadId: null, clientId: null, caseId: null, followUpId: null, outcomeNotes: clean(req.body.notes, 1000) || "Marked as spam" },
    include: callInclude,
  });
  res.json({ data });
}

export async function recordOomaCallOutcome(req, res) {
  const call = await requireCall(req, {});
  const allowed = new Set(["COMPLETED", "FOLLOW_UP_REQUIRED", "NO_ANSWER", "BUSY", "VOICEMAIL", "WRONG_NUMBER", "NOT_INTERESTED", "OTHER"]);
  const outcome = clean(req.body.outcome, 80).toUpperCase();
  if (!allowed.has(outcome)) throw createHttpError(400, "Select a valid call outcome.", "INVALID_CALL_OUTCOME");
  const notes = clean(req.body.notes, 3000) || null;
  const data = await prisma.$transaction(async (tx) => {
    const updated = await tx.oomaCallSession.update({ where: { id: call.id }, data: { disposition: outcome, outcomeNotes: notes } });
    if (req.body.nextFollowUp && call.leadId) {
      const lead = await tx.lead.findFirst({ where: { id: call.leadId, agencyId: req.auth.agencyId, status: "OPEN", pipelineSegment: "STANDARD", deletedAt: null } });
      if (lead) {
        const dueAt = new Date(req.body.nextFollowUp.dueAt);
        if (Number.isNaN(dueAt.getTime())) throw createHttpError(400, "Choose a valid follow-up date and time.", "INVALID_FOLLOW_UP_DATE");
        const assignedUserId = clean(req.body.nextFollowUp.assignedUserId, 100) || lead.ownerUserId;
        const staff = await tx.user.findFirst({ where: { id: assignedUserId, agencyId: req.auth.agencyId, status: "active" }, select: { id: true } });
        if (!staff) throw createHttpError(400, "Select an active team member for the follow-up.", "INVALID_FOLLOW_UP_OWNER");
        const followUp = await tx.leadFollowUp.create({ data: { agencyId: req.auth.agencyId, leadId: lead.id, assignedUserId, type: "PHONE_CALL", description: clean(req.body.nextFollowUp.description, 500) || "Follow up after Ooma call", dueAt } });
        await tx.leadActivity.create({ data: { agencyId: req.auth.agencyId, leadId: lead.id, activityType: "FOLLOW_UP_CREATED", direction: "INTERNAL", channel: "SYSTEM", title: followUp.description, description: `Due ${dueAt.toISOString()}`, performedById: req.auth.userId, metadata: { followUpId: followUp.id, oomaCallSessionId: call.id } } });
        if (!lead.nextActionAt || dueAt < lead.nextActionAt) await tx.lead.update({ where: { id: lead.id }, data: { nextActionType: followUp.type, nextActionDescription: followUp.description, nextActionAt: dueAt, nextActionOwnerId: assignedUserId, version: { increment: 1 } } });
      }
    }
    return updated;
  });
  if (call.leadId) await syncOomaLeadActivity(call.id);
  if (call.clientId) await syncOomaClientCommunication(call.id);
  res.json({ data: { ...data, ...(await prisma.oomaCallSession.findUnique({ where: { id: call.id }, include: callInclude })) } });
}
