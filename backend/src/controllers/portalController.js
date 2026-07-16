import { randomUUID } from "node:crypto";
import path from "node:path";
import prisma from "../services/prisma/client.js";
import { deleteAuthUser, inviteAuthUser, updateAuthUser } from "../services/supabaseAuth.js";
import { removeDocumentFile, requireDocumentFile, writeDocumentFile } from "../services/documentStorage.js";
import { communicationResolutionDueAt, communicationResponseDueAt } from "../services/communicationSlaService.js";
import { recordCommunicationAudit } from "../services/communicationAudit.js";
import { applyCommunicationAutomations } from "../services/communicationAutomationService.js";
import { broadcastCaseCommunication } from "../services/supabaseRealtimeService.js";
import { createHttpError } from "../utils/http.js";
import { recordActivity } from "../utils/prismaCrud.js";

async function linkedClient(req) {
  const link = await prisma.clientUser.findFirst({
    where: { agencyId: req.auth.agencyId, userId: req.auth.userId },
    include: { client: true }, orderBy: { isPrimary: "desc" },
  });
  if (!link) throw createHttpError(404, "Client portal profile not found.", "NOT_FOUND");
  return link;
}

const clean = (value, max = 500) => String(value ?? "").trim().slice(0, max);

async function linkedCase(req, clientId, caseId) {
  const data = await prisma.case.findFirst({
    where: { id: clean(caseId, 80), agencyId: req.auth.agencyId, clientId },
    select: { id: true, clientId: true, caseType: true, stage: true, status: true, assignedUserId: true },
  });
  if (!data) throw createHttpError(404, "Application not found.", "NOT_FOUND");
  return data;
}

export async function createPortalAccount(req, res) {
  if (req.auth.role === "consultant" && req.auth.permissions?.createClientPortal !== true) {
    throw createHttpError(403, "You do not have permission to create portal accounts.", "FORBIDDEN");
  }
  const client = await prisma.client.findFirst({ where: { id: req.params.clientId, agencyId: req.auth.agencyId } });
  if (!client) throw createHttpError(404, "Client not found.", "NOT_FOUND");
  if (req.auth.role === "consultant") {
    const allowed = await prisma.client.findFirst({ where: { id: client.id, agencyId: req.auth.agencyId, OR: [
      { assignedUserId: req.auth.userId },
      { cases: { some: { OR: [{ assignedUserId: req.auth.userId }, { assignments: { some: { consultantUserId: req.auth.userId, status: "active" } } }] } } },
    ] }, select: { id: true } });
    if (!allowed) throw createHttpError(403, "You do not have permission to create this portal account.", "FORBIDDEN");
  }
  const existingLink = await prisma.clientUser.findFirst({ where: { agencyId: req.auth.agencyId, clientId: client.id } });
  if (existingLink) throw createHttpError(400, "This client already has a portal account.", "VALIDATION_ERROR");

  const email = String(req.body?.email || client.email || "").trim().toLowerCase();
  const fullName = String(req.body?.fullName || client.fullName).trim();
  if (!email || !email.includes("@")) throw createHttpError(400, "A valid email is required.", "VALIDATION_ERROR");
  if (await prisma.user.findUnique({ where: { email }, select: { id: true } })) throw createHttpError(409, "An account with this email already exists.", "ACCOUNT_EXISTS");

  let authUser;
  try {
    const frontendUrl = String(process.env.FRONTEND_URL || "http://localhost:5173").split(",")[0].trim().replace(/\/$/, "");
    authUser = await inviteAuthUser({ email, fullName, redirectTo: `${frontendUrl}/auth/accept-invite` });
  } catch { throw createHttpError(502, "The client invitation could not be sent.", "AUTH_INVITATION_FAILED"); }
  try {
    const user = await prisma.user.create({
      data: {
        agencyId: req.auth.agencyId, authUserId: authUser.id, email, fullName, role: "client", status: "invited", mustChangePassword: false,
        memberships: { create: { agencyId: req.auth.agencyId, role: "client", isActive: true, mustChangePassword: false } },
        clientUsers: { create: { agencyId: req.auth.agencyId, clientId: client.id, relationship: String(req.body?.relationship || "self").slice(0, 80), isPrimary: true } },
      }, select: { id: true, email: true, fullName: true },
    });
    await recordActivity({ agencyId: req.auth.agencyId, userId: req.auth.userId, clientId: client.id, action: "CLIENT_PORTAL_INVITED", details: `Portal invitation sent to ${client.fullName}` });
    res.status(201).json({ success: true, data: user, message: "Client portal invitation sent." });
  } catch (error) {
    await deleteAuthUser(authUser.id).catch(() => {});
    throw error;
  }
}

export async function getPortalAccountStatus(req, res) {
  const client = await prisma.client.findFirst({ where: { id: req.params.clientId, agencyId: req.auth.agencyId }, select: { id: true } });
  if (!client) throw createHttpError(404, "Client not found.", "NOT_FOUND");
  const link = await prisma.clientUser.findFirst({
    where: { agencyId: req.auth.agencyId, clientId: client.id },
    select: { createdAt: true, user: { select: { email: true, status: true } } },
    orderBy: { isPrimary: "desc" },
  });
  res.json({
    success: true,
    data: link
      ? { hasAccess: true, email: link.user.email, status: link.user.status, invitedAt: link.createdAt }
      : { hasAccess: false, email: null, status: null, invitedAt: null },
  });
}

export async function setPortalAccountAccess(req, res) {
  if (typeof req.body?.active !== "boolean") {
    throw createHttpError(400, "Specify whether portal access should be active.", "VALIDATION_ERROR");
  }
  const active = req.body.active;
  const client = await prisma.client.findFirst({ where: { id: req.params.clientId, agencyId: req.auth.agencyId }, select: { id: true, fullName: true } });
  if (!client) throw createHttpError(404, "Client not found.", "NOT_FOUND");
  const link = await prisma.clientUser.findFirst({
    where: { agencyId: req.auth.agencyId, clientId: client.id },
    select: { userId: true, user: { select: { authUserId: true, status: true } } },
    orderBy: { isPrimary: "desc" },
  });
  if (!link) throw createHttpError(404, "This client does not have a portal account yet.", "NOT_FOUND");

  await prisma.$transaction([
    prisma.user.update({ where: { id: link.userId }, data: { status: active ? "active" : "disabled" } }),
    prisma.agencyMember.update({
      where: { agencyId_userId: { agencyId: req.auth.agencyId, userId: link.userId } },
      data: { isActive: active },
    }),
  ]);
  if (link.user.authUserId) {
    await updateAuthUser(link.user.authUserId, { ban_duration: active ? "none" : "876000h" }).catch(() => {});
  }
  await recordActivity({
    agencyId: req.auth.agencyId,
    userId: req.auth.userId,
    clientId: client.id,
    action: active ? "CLIENT_PORTAL_ACCESS_RESTORED" : "CLIENT_PORTAL_ACCESS_REVOKED",
    details: `Portal access ${active ? "restored" : "revoked"} for ${client.fullName}`,
  });
  res.json({ success: true, message: active ? "Portal access restored." : "Portal access revoked." });
}

export async function portalMe(req, res) {
  const link = await linkedClient(req);
  const currentApplication = await prisma.case.findFirst({
    where: { agencyId: req.auth.agencyId, clientId: link.clientId, status: { not: "Closed" } },
    orderBy: { updatedAt: "desc" }, select: { id: true, caseType: true, stage: true, status: true, nextAction: true },
  });
  res.json({ success: true, data: { client: { id: link.client.id, fullName: link.client.fullName }, currentApplication } });
}

export async function portalApplications(req, res) {
  const link = await linkedClient(req);
  const data = await prisma.case.findMany({
    where: { agencyId: req.auth.agencyId, clientId: link.clientId },
    select: { id: true, caseType: true, stage: true, status: true, nextAction: true, submittedAt: true, decisionAt: true, updatedAt: true },
    orderBy: { updatedAt: "desc" },
  });
  res.json({ success: true, data });
}

export async function portalDocuments(req, res) {
  const link = await linkedClient(req);
  const data = await prisma.clientDocument.findMany({
    where: { agencyId: req.auth.agencyId, clientId: link.clientId, visibility: "Client" },
    select: { id: true, caseId: true, documentName: true, status: true, clientInstructions: true, receivedAt: true, originalFilename: true, mimeType: true, fileSize: true, storageKey: true, createdAt: true, updatedAt: true },
    orderBy: { updatedAt: "desc" },
  });
  res.json({ success: true, data: data.map(({ storageKey, ...item }) => ({ ...item, hasFile: Boolean(storageKey) })) });
}

export async function uploadPortalDocument(req, res) {
  if (!req.file) throw createHttpError(400, "A document file is required.", "VALIDATION_ERROR");
  const link = await linkedClient(req);
  const existing = await prisma.clientDocument.findFirst({
    where: { id: req.params.id, agencyId: req.auth.agencyId, clientId: link.clientId, visibility: "Client" },
  });
  if (!existing) throw createHttpError(404, "Document request not found.", "NOT_FOUND");
  if (["Approved", "Finalized", "NotRequired"].includes(existing.status)) {
    throw createHttpError(409, "This document request no longer accepts uploads.", "DOCUMENT_LOCKED");
  }

  const extension = path.extname(req.file.originalname).toLowerCase().replace(/[^a-z0-9.]/g, "").slice(0, 12);
  const storageKey = path.posix.join(req.auth.agencyId, existing.caseId || `client-${link.clientId}`, `${randomUUID()}${extension}`);
  await writeDocumentFile(storageKey, req.file.buffer);
  let committed = false;
  try {
    const updated = await prisma.clientDocument.updateMany({
      where: { id: existing.id, agencyId: req.auth.agencyId, clientId: link.clientId, visibility: "Client", updatedAt: existing.updatedAt, status: { notIn: ["Approved", "Finalized", "NotRequired"] } },
      data: {
        storageKey,
        originalFilename: req.file.originalname,
        mimeType: req.file.mimetype,
        fileSize: req.file.size,
        status: "Uploaded",
        receivedAt: new Date(),
        reviewedAt: null,
        reviewedById: null,
        uploadedById: req.auth.userId,
      },
    });
    if (updated.count !== 1) throw createHttpError(409, "This document request changed while the file was uploading. Refresh and try again.", "DOCUMENT_CHANGED");
    committed = true;
    if (existing.storageKey && existing.storageKey !== storageKey) await removeDocumentFile(existing.storageKey).catch(() => {});
    const data = await prisma.clientDocument.findUnique({
      where: { id: existing.id },
      select: { id: true, caseId: true, documentName: true, status: true, clientInstructions: true, receivedAt: true, originalFilename: true, mimeType: true, fileSize: true, createdAt: true, updatedAt: true },
    });
    await recordActivity({ agencyId: req.auth.agencyId, userId: req.auth.userId, clientId: link.clientId, caseId: existing.caseId, action: "client_document.portal_uploaded", details: `${req.file.originalname} uploaded by client portal` });
    res.json({ success: true, data: { ...data, hasFile: true } });
  } catch (error) {
    if (!committed) await removeDocumentFile(storageKey);
    throw error;
  }
}

export async function servePortalDocument(req, res) {
  const link = await linkedClient(req);
  const data = await prisma.clientDocument.findFirst({
    where: { id: req.params.id, agencyId: req.auth.agencyId, clientId: link.clientId, visibility: "Client" },
    select: { storageKey: true, originalFilename: true, mimeType: true },
  });
  if (!data?.storageKey) throw createHttpError(404, "No file is available for this document.", "NOT_FOUND");
  const fullPath = await requireDocumentFile(data.storageKey);
  const disposition = req.query.download === "1" ? "attachment" : "inline";
  res.setHeader("Content-Disposition", `${disposition}; filename*=UTF-8''${encodeURIComponent(data.originalFilename || "document")}`);
  res.type(data.mimeType || "application/octet-stream");
  res.sendFile(fullPath);
}

export async function portalAppointments(req, res) {
  const link = await linkedClient(req);
  const data = await prisma.appointment.findMany({
    where: { agencyId: req.auth.agencyId, clientId: link.clientId, status: { not: "Cancelled" } },
    select: { id: true, caseId: true, subject: true, location: true, startsAt: true, endsAt: true, status: true, assignedTo: { select: { fullName: true } }, case: { select: { caseType: true } } },
    orderBy: { startsAt: "asc" },
  });
  res.json({ success: true, data });
}

export async function portalActions(req, res) {
  const link = await linkedClient(req);
  const [cases, documents, appointments] = await Promise.all([
    prisma.case.findMany({ where: { agencyId: req.auth.agencyId, clientId: link.clientId, status: { not: "Closed" }, nextAction: { not: null } }, select: { id: true, caseType: true, nextAction: true, stage: true }, orderBy: { updatedAt: "desc" } }),
    prisma.clientDocument.findMany({ where: { agencyId: req.auth.agencyId, clientId: link.clientId, visibility: "Client", status: { in: ["Requested", "ChangesRequested"] } }, select: { id: true, caseId: true, documentName: true, status: true, clientInstructions: true }, orderBy: { updatedAt: "desc" } }),
    prisma.appointment.findMany({ where: { agencyId: req.auth.agencyId, clientId: link.clientId, status: "Scheduled", endsAt: { gte: new Date() } }, select: { id: true, caseId: true, subject: true, location: true, startsAt: true, endsAt: true, status: true, assignedTo: { select: { fullName: true } }, case: { select: { caseType: true } } }, orderBy: { startsAt: "asc" }, take: 20 }),
  ]);
  res.json({ success: true, data: { cases, documents, appointments } });
}

export async function portalMessages(req, res) {
  const link = await linkedClient(req);
  const cases = await prisma.case.findMany({
    where: { agencyId: req.auth.agencyId, clientId: link.clientId },
    select: { id: true, caseType: true, stage: true, status: true },
    orderBy: { updatedAt: "desc" },
  });
  const requestedCaseId = clean(req.query.caseId, 80);
  const caseId = requestedCaseId || cases[0]?.id;
  if (!caseId) return res.json({ success: true, data: { cases: [], selectedCaseId: null, messages: [] } });
  if (!cases.some((item) => item.id === caseId)) throw createHttpError(404, "Application not found.", "NOT_FOUND");
  const messages = await prisma.communicationMessage.findMany({
    where: { agencyId: req.auth.agencyId, clientId: link.clientId, caseId, channel: "Chat", direction: { in: ["Inbound", "Outbound"] }, deletedAt: null },
    select: { id: true, direction: true, status: true, bodyText: true, occurredAt: true, senderUser: { select: { fullName: true } } },
    orderBy: [{ occurredAt: "asc" }, { id: "asc" }],
    take: 200,
  });
  res.json({ success: true, data: { cases, selectedCaseId: caseId, messages } });
}

export async function createPortalMessage(req, res) {
  const link = await linkedClient(req);
  const caseItem = await linkedCase(req, link.clientId, req.body.caseId);
  const bodyText = clean(req.body.bodyText, 5000);
  if (!bodyText) throw createHttpError(400, "Write a message before sending.", "VALIDATION_ERROR");
  const clientMessageId = clean(req.body.clientMessageId, 200) || randomUUID();
  const duplicate = await prisma.communicationMessage.findFirst({ where: { agencyId: req.auth.agencyId, provider: "AuthenticatedPortal", providerMessageId: clientMessageId } });
  if (duplicate) return res.json({ success: true, data: duplicate, meta: { duplicate: true } });
  const preference = await prisma.communicationPreference.findUnique({ where: { clientId: link.clientId } });
  if (preference?.allowChat === false) throw createHttpError(403, "Portal messaging is disabled for this account.", "CHAT_DISABLED");
  const owner = caseItem.assignedUserId || link.client.assignedUserId || (await prisma.user.findFirst({ where: { agencyId: req.auth.agencyId, status: "active", role: { in: ["admin", "consultant"] } }, orderBy: { createdAt: "asc" }, select: { id: true } }))?.id;
  if (!owner) throw createHttpError(409, "No consultant is assigned to receive this message.", "NO_ASSIGNEE");
  const occurredAt = new Date();
  const [responseDueAt, resolutionDueAt] = await Promise.all([communicationResponseDueAt(req.auth.agencyId, occurredAt), communicationResolutionDueAt(req.auth.agencyId, occurredAt)]);
  const result = await prisma.$transaction(async (tx) => {
    let conversation = await tx.communicationConversation.findFirst({ where: { agencyId: req.auth.agencyId, caseId: caseItem.id, channel: "Chat", state: { not: "Closed" }, deletedAt: null }, orderBy: { lastMessageAt: "desc" } });
    if (!conversation) conversation = await tx.communicationConversation.create({ data: { agencyId: req.auth.agencyId, clientId: link.clientId, caseId: caseItem.id, channel: "Chat", subject: "Client portal messages", provider: "AuthenticatedPortal", assignedToId: owner, state: "WaitingOnAgency", firstInboundAt: occurredAt, lastInboundAt: occurredAt, responseDueAt, resolutionDueAt, lastMessageAt: occurredAt, createdById: owner } });
    const message = await tx.communicationMessage.create({ data: { agencyId: req.auth.agencyId, clientId: link.clientId, caseId: caseItem.id, conversationId: conversation.id, channel: "Chat", direction: "Inbound", status: "Received", senderUserId: req.auth.userId, senderAddress: `client:${link.clientId}`, recipients: [], bodyText, provider: "AuthenticatedPortal", providerMessageId: clientMessageId, occurredAt, isRead: false } });
    conversation = await tx.communicationConversation.update({ where: { id: conversation.id }, data: { state: "WaitingOnAgency", isArchived: false, firstInboundAt: conversation.firstInboundAt || occurredAt, lastInboundAt: occurredAt, responseDueAt, lastMessageAt: occurredAt, unreadCount: { increment: 1 } } });
    await tx.communicationDeliveryEvent.create({ data: { agencyId: req.auth.agencyId, messageId: message.id, type: "Received", providerTimestamp: occurredAt, details: "Authenticated client portal message received" } });
    return { message, conversation };
  });
  await recordCommunicationAudit({ agencyId: req.auth.agencyId, userId: req.auth.userId, conversationId: result.conversation.id, messageId: result.message.id, action: "communication.portal_message_received", details: `Portal message received from ${link.client.fullName}` });
  await applyCommunicationAutomations({ agencyId: req.auth.agencyId, trigger: "InboundReceived", message: result.message, conversation: result.conversation, caseItem, client: link.client }).catch(() => {});
  await broadcastCaseCommunication({ agencyId: req.auth.agencyId, caseId: caseItem.id, event: "message", payload: { messageId: result.message.id, conversationId: result.conversation.id, occurredAt } }).catch(() => {});
  res.status(201).json({ success: true, data: result.message });
}

export async function portalProfile(req, res) {
  const link = await linkedClient(req);
  const { id, fullName, email, phone, dateOfBirth, address } = link.client;
  res.json({ success: true, data: { id, fullName, email, phone, dateOfBirth, address } });
}
