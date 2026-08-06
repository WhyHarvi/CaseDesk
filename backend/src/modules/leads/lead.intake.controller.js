import * as service from "./lead.intake.service.js";
import prisma from "../../services/prisma/client.js";
import { createHttpError } from "../../utils/http.js";
import { processClaimed } from "./lead.intake.worker.js";

export async function listForms(req, res) { res.json({ data: await service.listIntakeForms(req) }); }
export async function createForm(req, res) { res.status(201).json({ data: await service.createIntakeForm(req) }); }
export async function updateForm(req, res) { res.json({ data: await service.updateIntakeForm(req) }); }
export async function getPublicForm(req, res) { res.json({ data: await service.getPublicIntake(req.params.token) }); }
export async function submitPublicForm(req, res) { res.status(202).json({ data: await service.submitPublicIntake(req) }); }
export async function previewImport(req, res) { res.status(201).json({ data: await service.previewImport(req) }); }
export async function listImports(req, res) { res.json({ data: await service.listImports(req) }); }
export async function getImport(req, res) { res.json({ data: await service.getImport(req) }); }
export async function commitImport(req, res) { res.status(202).json({ data: await service.commitImport(req) }); }
export async function listEvents(req, res) { res.json({ data: await service.listIncomingEvents(req) }); }
export async function getOperations(req, res) { res.json({ data: await service.getIntakeOperations(req) }); }
export async function retryEvent(req, res) { res.json({ data: await service.retryIncomingEvent(req) }); }

export async function getDuplicateReview(req, res) {
  const event = await prisma.leadIncomingEvent.findFirst({
    where: { id: req.params.eventId, agencyId: req.auth.agencyId },
    include: {
      source: { select: { id: true, name: true } },
      duplicateCandidates: {
        include: {
          candidateLead: {
            select: {
              id: true, leadNumber: true, firstName: true, lastName: true,
              phone: true, email: true, stage: true, status: true,
              owner: { select: { id: true, fullName: true } },
            },
          },
        },
        orderBy: [{ score: "desc" }, { createdAt: "asc" }],
      },
    },
  });
  if (!event) throw createHttpError(404, "Incoming event not found.", "EVENT_NOT_FOUND");
  res.json({ data: event });
}

export async function resolveDuplicate(req, res) {
  const action = String(req.body?.action || "").toUpperCase();
  if (!["LINK", "MERGE", "DISMISS"].includes(action)) {
    throw createHttpError(400, "Choose Link or Dismiss.", "VALIDATION_ERROR");
  }
  const result = await prisma.$transaction(async (tx) => {
    const event = await tx.leadIncomingEvent.findFirst({ where: { id: req.params.eventId, agencyId: req.auth.agencyId }, select: { id: true, agencyId: true, status: true, normalizedPayload: true } });
    if (!event) throw createHttpError(404, "Incoming event not found.", "EVENT_NOT_FOUND");
    const candidate = await tx.leadDuplicateCandidate.findFirst({ where: { id: req.params.candidateId, incomingEventId: event.id, agencyId: event.agencyId }, include: { candidateLead: { select: { id: true, leadNumber: true } } } });
    if (!candidate) throw createHttpError(404, "Duplicate candidate not found.", "DUPLICATE_NOT_FOUND");
    if (action === "DISMISS") {
      await tx.leadDuplicateCandidate.update({ where: { id: candidate.id }, data: { status: "DISMISSED" } });
      const pending = await tx.leadDuplicateCandidate.count({ where: { incomingEventId: event.id, id: { not: candidate.id }, status: "PENDING" } });
      if (!pending) await tx.leadIncomingEvent.update({ where: { id: event.id }, data: { status: "PENDING", availableAt: new Date(), lockedAt: null, processedAt: null, lastError: null } });
      return { action, candidateId: candidate.id, eventStatus: pending ? "DUPLICATE_REVIEW" : "PENDING" };
    }
    const normalized = event.normalizedPayload && typeof event.normalizedPayload === "object" ? event.normalizedPayload : {};
    await tx.leadDuplicateCandidate.update({ where: { id: candidate.id }, data: { status: "CONFIRMED" } });
    await tx.leadDuplicateCandidate.updateMany({ where: { incomingEventId: event.id, id: { not: candidate.id }, status: "PENDING" }, data: { status: "DISMISSED" } });
    await tx.leadIncomingEvent.update({ where: { id: event.id }, data: { status: "PROCESSED", processedLeadId: candidate.candidateLeadId, processedAt: new Date(), lockedAt: null, lastError: null } });
    await tx.leadActivity.create({ data: { agencyId: event.agencyId, leadId: candidate.candidateLeadId, activityType: "INTERNAL_NOTE", direction: "INTERNAL", channel: "SYSTEM", title: "Duplicate inquiry linked", description: normalized.initialMessage || "A repeat inquiry was linked to this lead.", performedById: req.auth.userId, metadata: { incomingEventId: event.id, duplicateCandidateId: candidate.id } } });
    await tx.activityLog.create({ data: { agencyId: event.agencyId, userId: req.auth.userId, action: "lead.duplicate_linked", details: `Inquiry linked to ${candidate.candidateLead.leadNumber}`, entityType: "lead", entityId: candidate.candidateLeadId, metadata: { incomingEventId: event.id } } });
    return { action: "LINK", leadId: candidate.candidateLeadId, eventStatus: "PROCESSED" };
  });
  res.json({ data: result });
}

export async function forceCreateFromEvent(req, res) {
  const event = await prisma.$transaction(async (tx) => {
    const existing = await tx.leadIncomingEvent.findFirst({ where: { id: req.params.eventId, agencyId: req.auth.agencyId }, select: { id: true, status: true } });
    if (!existing) throw createHttpError(404, "Incoming event not found.", "EVENT_NOT_FOUND");
    if (existing.status === "PROCESSED") throw createHttpError(409, "This event has already been processed.", "EVENT_ALREADY_PROCESSED");
    await tx.leadDuplicateCandidate.updateMany({ where: { incomingEventId: existing.id, status: "PENDING" }, data: { status: "DISMISSED" } });
    return tx.leadIncomingEvent.update({ where: { id: existing.id }, data: { status: "PROCESSING", lockedAt: new Date(), processedAt: null, lastError: null } });
  });
  try {
    await processClaimed(event.id);
  } catch (error) {
    await prisma.leadIncomingEvent.update({
      where: { id: event.id },
      data: {
        status: "PENDING",
        lockedAt: null,
        availableAt: new Date(Date.now() + 60_000),
        lastError: String(error?.message || "The intake event could not be processed.").slice(0, 2_000),
      },
    });
    throw error;
  }
  const completed = await prisma.leadIncomingEvent.findUnique({ where: { id: event.id }, select: { id: true, status: true, processedLeadId: true } });
  res.status(201).json({ data: completed });
}
