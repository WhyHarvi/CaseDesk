import { randomUUID } from "node:crypto";
import path from "node:path";
import prisma from "../services/prisma/client.js";
import { hasPortalCapability } from "../services/portalAccessService.js";
import {
  createAuthUser,
  deleteAuthUser,
  findAuthUserByEmail,
  generateAuthLink,
  updateAuthUser,
} from "../services/supabaseAuth.js";
import { sendAccountAccessEmail } from "../services/accountAccessMailService.js";
import { generateTemporaryPassword } from "../utils/temporaryPassword.js";
import { publicAppUrl } from "../utils/publicAppUrl.js";
import {
  removeDocumentFile,
  requireDocumentFile,
  writeDocumentFile,
} from "../services/documentStorage.js";
import {
  communicationResolutionDueAt,
  communicationResponseDueAt,
} from "../services/communicationSlaService.js";
import { recordCommunicationAudit } from "../services/communicationAudit.js";
import { applyCommunicationAutomations } from "../services/communicationAutomationService.js";
import { broadcastCaseCommunication, getRealtimeClientConfig } from "../services/supabaseRealtimeService.js";
import { DOCUMENT_BUCKET, downloadStorageFile } from "../services/supabaseStorage.js";
import { CHAT_ATTACH_GRACE_MS, storeCommunicationAttachment } from "../services/communicationAttachmentStorage.js";
import { createHttpError } from "../utils/http.js";
import { recordActivity } from "../utils/prismaCrud.js";
import { getEffectiveClientCommunicationPreference } from "../services/clientCommunicationPolicyService.js";
import { filterPortalRecordsByPermission, loadPortalPolicyContext } from "../services/clientPortalPolicyService.js";

async function linkedClient(req) {
  const link = await prisma.clientUser.findFirst({
    where: { agencyId: req.auth.agencyId, userId: req.auth.userId },
    include: { client: true },
    orderBy: { isPrimary: "desc" },
  });
  if (!link)
    throw createHttpError(404, "Client portal profile not found.", "NOT_FOUND");
  return link;
}

const clean = (value, max = 500) =>
  String(value ?? "")
    .trim()
    .slice(0, max);
const GENERAL_CHAT_ID = "general";

async function linkedCase(req, clientId, caseId) {
  const data = await prisma.case.findFirst({
    where: {
      id: clean(caseId, 80),
      agencyId: req.auth.agencyId,
      clientId,
      deletedAt: null,
      archivedAt: null,
    },
    select: {
      id: true,
      clientId: true,
      caseType: true,
      stage: true,
      status: true,
      assignedUserId: true,
    },
  });
  if (!data) throw createHttpError(404, "Application not found.", "NOT_FOUND");
  return data;
}

export async function createPortalAccount(req, res) {
  if (
    req.auth.role !== "admin" &&
    !hasPortalCapability(req, "manageClientPortal")
  ) {
    throw createHttpError(
      403,
      "You do not have permission to create portal accounts.",
      "FORBIDDEN",
    );
  }
  const client = await prisma.client.findFirst({
    where: { id: req.params.clientId, agencyId: req.auth.agencyId },
  });
  if (!client) throw createHttpError(404, "Client not found.", "NOT_FOUND");
  if (req.auth.role === "consultant") {
    const allowed = await prisma.client.findFirst({
      where: {
        id: client.id,
        agencyId: req.auth.agencyId,
        OR: [
          { assignedUserId: req.auth.userId },
          {
            cases: {
              some: {
                OR: [
                  { assignedUserId: req.auth.userId },
                  {
                    assignments: {
                      some: {
                        consultantUserId: req.auth.userId,
                        status: "active",
                      },
                    },
                  },
                ],
              },
            },
          },
        ],
      },
      select: { id: true },
    });
    if (!allowed)
      throw createHttpError(
        403,
        "You do not have permission to create this portal account.",
        "FORBIDDEN",
      );
  }
  const existingLink = await prisma.clientUser.findFirst({
    where: { agencyId: req.auth.agencyId, clientId: client.id },
  });
  if (existingLink)
    throw createHttpError(
      400,
      "This client already has a portal account.",
      "VALIDATION_ERROR",
    );

  const email = String(req.body?.email || client.email || "")
    .trim()
    .toLowerCase();
  const fullName = String(req.body?.fullName || client.fullName).trim();
  if (!email || !email.includes("@"))
    throw createHttpError(
      400,
      "A valid email is required.",
      "VALIDATION_ERROR",
    );
  if (await prisma.user.findUnique({ where: { email }, select: { id: true } }))
    throw createHttpError(
      409,
      "An account with this email already exists.",
      "ACCOUNT_EXISTS",
    );

  const frontendUrl = publicAppUrl();
  const existingAuthUser = await findAuthUserByEmail(email).catch(() => null);
  let generated;
  try {
    generated = await generateAuthLink({
      type: existingAuthUser ? "recovery" : "invite",
      email,
      fullName,
      redirectTo: `${frontendUrl}/auth/accept-invite`,
    });
    if (!generated?.actionLink || !generated?.user?.id)
      throw new Error("Supabase did not return an invitation link");
  } catch {
    throw createHttpError(
      502,
      "The client invitation could not be sent.",
      "AUTH_INVITATION_FAILED",
    );
  }
  const authUser = existingAuthUser || generated.user;
  const authUserCreated = !existingAuthUser;

  // Best-effort: if the agency's mailbox isn't reachable, still create the
  // account and hand staff the link to send manually rather than failing
  // the whole invite (mirrors createTeamMember/createConsultant).
  let manualInvitationLink = null;
  try {
    await sendAccountAccessEmail({
      agencyId: req.auth.agencyId,
      email,
      fullName,
      actionLink: generated.actionLink,
      kind: existingAuthUser ? "reset" : "onboarding",
      audience: "client",
    });
  } catch {
    manualInvitationLink = generated.actionLink;
  }

  try {
    const user = await prisma.user.create({
      data: {
        agencyId: req.auth.agencyId,
        authUserId: authUser.id,
        email,
        fullName,
        role: "client",
        status: "invited",
        mustChangePassword: false,
        memberships: {
          create: {
            agencyId: req.auth.agencyId,
            role: "client",
            isActive: true,
            mustChangePassword: false,
          },
        },
        clientUsers: {
          create: {
            agencyId: req.auth.agencyId,
            clientId: client.id,
            relationship: String(req.body?.relationship || "self").slice(0, 80),
            isPrimary: true,
          },
        },
      },
      select: { id: true, email: true, fullName: true },
    });
    await recordActivity({
      agencyId: req.auth.agencyId,
      userId: req.auth.userId,
      clientId: client.id,
      action: "CLIENT_PORTAL_INVITED",
      details: `Portal invitation sent to ${client.fullName}`,
    });
    res
      .status(201)
      .json({
        success: true,
        data: user,
        message: manualInvitationLink
          ? "Account created. Copy and send the secure invitation link."
          : "Client portal invitation sent.",
        manualInvitationLink,
      });
  } catch (error) {
    if (authUserCreated) await deleteAuthUser(authUser.id).catch(() => {});
    throw error;
  }
}

// Staff-triggered, from the client's own profile — regenerates and emails
// a fresh Supabase link on demand, using the agency's own mailbox instead
// of relying on Supabase's invite-email sending. Doubles as "send
// onboarding link" (no portal account yet) and "send password reset link"
// (account already exists, any status) depending on what's already there.
export async function sendPortalAccessLink(req, res) {
  if (req.auth.role !== "admin" && !hasPortalCapability(req, "manageClientPortal")) {
    throw createHttpError(403, "You do not have permission to manage portal access.", "FORBIDDEN");
  }
  const client = await prisma.client.findFirst({
    where: { id: req.params.clientId, agencyId: req.auth.agencyId },
    select: { id: true, fullName: true, email: true },
  });
  if (!client) throw createHttpError(404, "Client not found.", "NOT_FOUND");

  const existingLink = await prisma.clientUser.findFirst({
    where: { agencyId: req.auth.agencyId, clientId: client.id },
    select: { userId: true, user: { select: { id: true, email: true, fullName: true, authUserId: true, status: true } } },
    orderBy: { isPrimary: "desc" },
  });

  const email = String(existingLink?.user?.email || client.email || "").trim().toLowerCase();
  const fullName = existingLink?.user?.fullName || client.fullName;
  if (!email || !email.includes("@")) throw createHttpError(400, "This client has no email on file.", "VALIDATION_ERROR");

  if (!existingLink && await prisma.user.findUnique({ where: { email }, select: { id: true } })) {
    throw createHttpError(409, "An account with this email already exists.", "ACCOUNT_EXISTS");
  }

  const frontendUrl = publicAppUrl();
  const hasAuthUser = existingLink ? Boolean(existingLink.user.authUserId) : Boolean(await findAuthUserByEmail(email).catch(() => null));
  const kind = hasAuthUser ? "recovery" : "invite";
  const isOnboarding = !existingLink || existingLink.user.status === "invited" || !hasAuthUser;
  const generated = await generateAuthLink({ type: kind, email, fullName, redirectTo: `${frontendUrl}/auth/accept-invite` }).catch(() => null);
  if (!generated?.actionLink || !generated?.user?.id) {
    throw createHttpError(502, "The portal link could not be generated.", "AUTH_LINK_FAILED");
  }

  if (!existingLink) {
    await prisma.user.create({
      data: {
        agencyId: req.auth.agencyId,
        authUserId: generated.user.id,
        email,
        fullName,
        role: "client",
        status: "invited",
        mustChangePassword: false,
        memberships: { create: { agencyId: req.auth.agencyId, role: "client", isActive: true, mustChangePassword: false } },
        clientUsers: { create: { agencyId: req.auth.agencyId, clientId: client.id, relationship: "self", isPrimary: true } },
      },
    });
  }

  await sendAccountAccessEmail({ agencyId: req.auth.agencyId, email, fullName, actionLink: generated.actionLink, kind: isOnboarding ? "onboarding" : "reset", audience: "client" });
  await recordActivity({
    agencyId: req.auth.agencyId,
    userId: req.auth.userId,
    clientId: client.id,
    action: isOnboarding ? "CLIENT_PORTAL_INVITED" : "CLIENT_PORTAL_LINK_RESENT",
    details: `${isOnboarding ? "Onboarding" : "Password reset"} link emailed to ${client.fullName}`,
  });
  res.json({ success: true, message: isOnboarding ? "Onboarding link emailed." : "Reset link emailed." });
}

// A deliberate second option next to sendPortalAccessLink's secure
// self-service link — some clients need direct access right away instead
// of navigating an email link/accept-invite flow. Generates a real
// temporary password server-side via Supabase's admin API (createAuthUser
// for a brand-new account, updateAuthUser to reset one that already
// exists) rather than a one-time link, and emails it in plain text — a
// materially weaker posture than the link flow, so this stays a distinct,
// explicitly-chosen action rather than the default.
export async function sendPortalTemporaryPassword(req, res) {
  if (req.auth.role !== "admin" && !hasPortalCapability(req, "manageClientPortal")) {
    throw createHttpError(403, "You do not have permission to manage portal access.", "FORBIDDEN");
  }
  const client = await prisma.client.findFirst({
    where: { id: req.params.clientId, agencyId: req.auth.agencyId },
    select: { id: true, fullName: true, email: true },
  });
  if (!client) throw createHttpError(404, "Client not found.", "NOT_FOUND");

  const existingLink = await prisma.clientUser.findFirst({
    where: { agencyId: req.auth.agencyId, clientId: client.id },
    select: { user: { select: { id: true, email: true, fullName: true, authUserId: true } } },
    orderBy: { isPrimary: "desc" },
  });

  const email = String(existingLink?.user?.email || client.email || "").trim().toLowerCase();
  const fullName = existingLink?.user?.fullName || client.fullName;
  if (!email || !email.includes("@")) throw createHttpError(400, "This client has no email on file.", "VALIDATION_ERROR");

  if (!existingLink && await prisma.user.findUnique({ where: { email }, select: { id: true } })) {
    throw createHttpError(409, "An account with this email already exists.", "ACCOUNT_EXISTS");
  }

  const password = generateTemporaryPassword();
  const existingAuthUserId = existingLink?.user?.authUserId || (await findAuthUserByEmail(email).catch(() => null))?.id || null;
  let authUserId = existingAuthUserId;
  let authUserCreated = false;
  if (existingAuthUserId) {
    // A portal identity can exist in Supabase before its invitation was
    // completed. Replacing only the password leaves that identity unable to
    // sign in with `email_not_confirmed`, even though staff just issued direct
    // credentials. Temporary-password access is an explicit staff activation,
    // so confirm the email and clear any previous revoke ban at the same time.
    await updateAuthUser(existingAuthUserId, {
      password,
      email_confirm: true,
      ban_duration: "none",
    }).catch(() => {
      throw createHttpError(502, "The temporary password could not be set.", "AUTH_UPDATE_FAILED");
    });
  } else {
    const created = await createAuthUser({ email, password, fullName, mustChangePassword: false }).catch(() => null);
    if (!created?.id) throw createHttpError(502, "The temporary password could not be set.", "AUTH_UPDATE_FAILED");
    authUserId = created.id;
    authUserCreated = true;
  }

  try {
    if (!existingLink) {
      await prisma.user.create({
        data: {
          agencyId: req.auth.agencyId,
          authUserId,
          email,
          fullName,
          role: "client",
          status: "active",
          mustChangePassword: false,
          memberships: { create: { agencyId: req.auth.agencyId, role: "client", isActive: true, mustChangePassword: false } },
          clientUsers: { create: { agencyId: req.auth.agencyId, clientId: client.id, relationship: "self", isPrimary: true } },
        },
      });
    } else if (existingLink.user.id) {
      // A portal account already existed (invited but never completed, or
      // previously issued a temporary password) — direct access should work
      // right away rather than leaving them stuck on "complete your setup."
      await prisma.user.update({ where: { id: existingLink.user.id }, data: { status: "active" } });
    }
  } catch (error) {
    if (authUserCreated) await deleteAuthUser(authUserId).catch(() => {});
    throw error;
  }

  const loginUrl = `${publicAppUrl()}/login`;
  let manualPassword = null;
  try {
    await sendAccountAccessEmail({ agencyId: req.auth.agencyId, email, fullName, password, loginUrl, kind: "temporaryPassword", audience: "client" });
  } catch {
    manualPassword = password;
  }
  await recordActivity({
    agencyId: req.auth.agencyId,
    userId: req.auth.userId,
    clientId: client.id,
    action: "CLIENT_PORTAL_TEMPORARY_PASSWORD_SENT",
    details: `Temporary portal password issued to ${client.fullName}`,
  });
  res.json({
    success: true,
    message: manualPassword ? "Password set. The email could not be sent — share it directly." : "Temporary password emailed.",
    // Always returned (not just on email failure) so staff can read it out
    // or relay it another way without having to open the client's inbox.
    password,
    loginUrl,
  });
}

export async function getPortalAccountStatus(req, res) {
  const client = await prisma.client.findFirst({
    where: { id: req.params.clientId, agencyId: req.auth.agencyId },
    select: { id: true },
  });
  if (!client) throw createHttpError(404, "Client not found.", "NOT_FOUND");
  const link = await prisma.clientUser.findFirst({
    where: { agencyId: req.auth.agencyId, clientId: client.id },
    select: {
      id: true,
      createdAt: true,
      user: { select: { email: true, status: true } },
    },
    orderBy: { isPrimary: "desc" },
  });
  const policyContext = link ? await loadPortalPolicyContext({ agencyId: req.auth.agencyId, clientUserId: link.id }) : null;
  const policyStatus = [policyContext?.agencyPolicy?.status, policyContext?.clientPolicy?.status].includes("SUSPENDED") ? "SUSPENDED" : [policyContext?.agencyPolicy?.status, policyContext?.clientPolicy?.status].includes("RESTRICTED") ? "RESTRICTED" : "ACTIVE";
  res.json({
    success: true,
    data: link
      ? {
          hasAccess: true,
          email: link.user.email,
          status: link.user.status,
          policyStatus,
          invitedAt: link.createdAt,
        }
      : { hasAccess: false, email: null, status: null, invitedAt: null },
  });
}

export async function setPortalAccountAccess(req, res) {
  if (typeof req.body?.active !== "boolean") {
    throw createHttpError(
      400,
      "Specify whether portal access should be active.",
      "VALIDATION_ERROR",
    );
  }
  const active = req.body.active;
  const client = await prisma.client.findFirst({
    where: { id: req.params.clientId, agencyId: req.auth.agencyId },
    select: { id: true, fullName: true },
  });
  if (!client) throw createHttpError(404, "Client not found.", "NOT_FOUND");
  const link = await prisma.clientUser.findFirst({
    where: { agencyId: req.auth.agencyId, clientId: client.id },
    select: {
      userId: true,
      user: { select: { authUserId: true, status: true } },
    },
    orderBy: { isPrimary: "desc" },
  });
  if (!link)
    throw createHttpError(
      404,
      "This client does not have a portal account yet.",
      "NOT_FOUND",
    );

  await prisma.$transaction([
    prisma.user.update({
      where: { id: link.userId },
      data: { status: active ? "active" : "disabled" },
    }),
    prisma.agencyMember.update({
      where: {
        agencyId_userId: { agencyId: req.auth.agencyId, userId: link.userId },
      },
      data: { isActive: active },
    }),
  ]);
  if (link.user.authUserId) {
    await updateAuthUser(link.user.authUserId, {
      ban_duration: active ? "none" : "876000h",
    }).catch(() => {});
  }
  await recordActivity({
    agencyId: req.auth.agencyId,
    userId: req.auth.userId,
    clientId: client.id,
    action: active
      ? "CLIENT_PORTAL_ACCESS_RESTORED"
      : "CLIENT_PORTAL_ACCESS_REVOKED",
    details: `Portal access ${active ? "restored" : "revoked"} for ${client.fullName}`,
  });
  res.json({
    success: true,
    message: active ? "Portal access restored." : "Portal access revoked.",
  });
}

export async function portalMe(req, res) {
  const link = await linkedClient(req);
  const currentApplication = await prisma.case.findFirst({
    where: {
      agencyId: req.auth.agencyId,
      clientId: link.clientId,
      deletedAt: null,
      archivedAt: null,
      status: { not: "Closed" },
    },
    orderBy: { updatedAt: "desc" },
    select: {
      id: true,
      caseType: true,
      stage: true,
      status: true,
      nextAction: true,
    },
  });
  res.json({
    success: true,
    data: {
      client: { id: link.client.id, fullName: link.client.fullName },
      currentApplication,
    },
  });
}

export async function portalApplications(req, res) {
  const link = await linkedClient(req);
  const data = await prisma.case.findMany({
    where: {
      agencyId: req.auth.agencyId,
      clientId: link.clientId,
      deletedAt: null,
      archivedAt: null,
    },
    select: {
      id: true,
      caseType: true,
      stage: true,
      status: true,
      nextAction: true,
      submittedAt: true,
      decisionAt: true,
      updatedAt: true,
    },
    orderBy: { updatedAt: "desc" },
  });
  res.json({ success: true, data });
}

export async function portalDocuments(req, res) {
  const link = await linkedClient(req);
  const data = await prisma.clientDocument.findMany({
    where: {
      agencyId: req.auth.agencyId,
      clientId: link.clientId,
      visibility: "Client",
    },
    select: {
      id: true,
      caseId: true,
      documentName: true,
      status: true,
      clientInstructions: true,
      receivedAt: true,
      originalFilename: true,
      mimeType: true,
      fileSize: true,
      storageKey: true,
      createdAt: true,
      updatedAt: true,
    },
    orderBy: { updatedAt: "desc" },
  });
  const visible = await filterPortalRecordsByPermission({ agencyId: req.auth.agencyId, clientUserId: link.id, key: "documents.view", records: data });
  res.json({
    success: true,
    data: visible.map(({ storageKey, ...item }) => ({
      ...item,
      hasFile: Boolean(storageKey),
    })),
  });
}

export async function uploadPortalDocument(req, res) {
  if (!req.file)
    throw createHttpError(
      400,
      "A document file is required.",
      "VALIDATION_ERROR",
    );
  const link = await linkedClient(req);
  const existing = await prisma.clientDocument.findFirst({
    where: {
      id: req.params.id,
      agencyId: req.auth.agencyId,
      clientId: link.clientId,
      visibility: "Client",
    },
  });
  if (!existing)
    throw createHttpError(404, "Document request not found.", "NOT_FOUND");
  if (["Approved", "Finalized", "NotRequired"].includes(existing.status)) {
    throw createHttpError(
      409,
      "This document request no longer accepts uploads.",
      "DOCUMENT_LOCKED",
    );
  }

  const extension = path
    .extname(req.file.originalname)
    .toLowerCase()
    .replace(/[^a-z0-9.]/g, "")
    .slice(0, 12);
  const storageKey = path.posix.join(
    req.auth.agencyId,
    existing.caseId || `client-${link.clientId}`,
    `${randomUUID()}${extension}`,
  );
  await writeDocumentFile(storageKey, req.file.buffer, req.file.mimetype);
  let committed = false;
  try {
    const updated = await prisma.clientDocument.updateMany({
      where: {
        id: existing.id,
        agencyId: req.auth.agencyId,
        clientId: link.clientId,
        visibility: "Client",
        updatedAt: existing.updatedAt,
        status: { notIn: ["Approved", "Finalized", "NotRequired"] },
      },
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
    if (updated.count !== 1)
      throw createHttpError(
        409,
        "This document request changed while the file was uploading. Refresh and try again.",
        "DOCUMENT_CHANGED",
      );
    committed = true;
    if (existing.storageKey && existing.storageKey !== storageKey)
      await removeDocumentFile(existing.storageKey).catch(() => {});
    const data = await prisma.clientDocument.findUnique({
      where: { id: existing.id },
      select: {
        id: true,
        caseId: true,
        documentName: true,
        status: true,
        clientInstructions: true,
        receivedAt: true,
        originalFilename: true,
        mimeType: true,
        fileSize: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    await recordActivity({
      agencyId: req.auth.agencyId,
      userId: req.auth.userId,
      clientId: link.clientId,
      caseId: existing.caseId,
      entityType: "client_document",
      entityId: existing.id,
      action: "client_document.portal_uploaded",
      details: `${req.file.originalname} uploaded by client portal`,
    });
    res.json({ success: true, data: { ...data, hasFile: true } });
  } catch (error) {
    if (!committed) await removeDocumentFile(storageKey);
    throw error;
  }
}

export async function servePortalDocument(req, res) {
  const link = await linkedClient(req);
  const data = await prisma.clientDocument.findFirst({
    where: {
      id: req.params.id,
      agencyId: req.auth.agencyId,
      clientId: link.clientId,
      visibility: "Client",
    },
    select: { storageKey: true, originalFilename: true, mimeType: true },
  });
  if (!data?.storageKey)
    throw createHttpError(
      404,
      "No file is available for this document.",
      "NOT_FOUND",
    );
  const buffer = await requireDocumentFile(data.storageKey);
  const disposition = req.query.download === "1" ? "attachment" : "inline";
  res.setHeader(
    "Content-Disposition",
    `${disposition}; filename*=UTF-8''${encodeURIComponent(data.originalFilename || "document")}`,
  );
  res.type(data.mimeType || "application/octet-stream");
  res.send(buffer);
}

export async function portalAppointments(req, res) {
  const link = await linkedClient(req);
  const data = await prisma.appointment.findMany({
    where: {
      agencyId: req.auth.agencyId,
      clientId: link.clientId,
      status: { not: "Cancelled" },
    },
    select: {
      id: true,
      caseId: true,
      subject: true,
      location: true,
      startsAt: true,
      endsAt: true,
      status: true,
      assignedTo: { select: { fullName: true } },
      case: { select: { caseType: true } },
    },
    orderBy: { startsAt: "asc" },
  });
  res.json({ success: true, data });
}

export async function portalActions(req, res) {
  const link = await linkedClient(req);
  const [cases, documents, appointments] = await Promise.all([
    prisma.case.findMany({
      where: {
        agencyId: req.auth.agencyId,
        clientId: link.clientId,
        deletedAt: null,
        archivedAt: null,
        status: { not: "Closed" },
        nextAction: { not: null },
      },
      select: { id: true, caseType: true, nextAction: true, stage: true },
      orderBy: { updatedAt: "desc" },
    }),
    prisma.clientDocument.findMany({
      where: {
        agencyId: req.auth.agencyId,
        clientId: link.clientId,
        visibility: "Client",
        status: { in: ["Requested", "ChangesRequested"] },
      },
      select: {
        id: true,
        caseId: true,
        documentName: true,
        status: true,
        clientInstructions: true,
      },
      orderBy: { updatedAt: "desc" },
    }),
    prisma.appointment.findMany({
      where: {
        agencyId: req.auth.agencyId,
        clientId: link.clientId,
        status: "Scheduled",
        endsAt: { gte: new Date() },
      },
      select: {
        id: true,
        caseId: true,
        subject: true,
        location: true,
        startsAt: true,
        endsAt: true,
        status: true,
        assignedTo: { select: { fullName: true } },
        case: { select: { caseType: true } },
      },
      orderBy: { startsAt: "asc" },
      take: 20,
    }),
  ]);
  res.json({ success: true, data: { cases, documents, appointments } });
}

export async function portalMessages(req, res) {
  const link = await linkedClient(req);
  const cases = await prisma.case.findMany({
    where: {
      agencyId: req.auth.agencyId,
      clientId: link.clientId,
      deletedAt: null,
      archivedAt: null,
    },
    select: { id: true, caseType: true, stage: true, status: true },
    orderBy: { updatedAt: "desc" },
  });
  const requestedCaseId = clean(req.query.caseId, 80);
  const selectedCaseId = requestedCaseId || cases[0]?.id || GENERAL_CHAT_ID;
  const generalChat = selectedCaseId === GENERAL_CHAT_ID;
  if (!generalChat && !cases.some((item) => item.id === selectedCaseId))
    throw createHttpError(404, "Application not found.", "NOT_FOUND");
  const messages = await prisma.communicationMessage.findMany({
    where: {
      agencyId: req.auth.agencyId,
      clientId: link.clientId,
      caseId: generalChat ? null : selectedCaseId,
      channel: "Chat",
      direction: { in: ["Inbound", "Outbound"] },
      deletedAt: null,
    },
    select: {
      id: true,
      direction: true,
      status: true,
      bodyText: true,
      occurredAt: true,
      senderUser: { select: { fullName: true } },
      attachmentRecords: {
        select: { id: true, originalFilename: true, mimeType: true, fileSize: true, scanStatus: true, createdAt: true },
      },
    },
    orderBy: [{ occurredAt: "asc" }, { id: "asc" }],
    take: 200,
  });
  res.json({
    success: true,
    data: {
      cases: [
        {
          id: GENERAL_CHAT_ID,
          caseType: "General inquiry",
          stage: null,
          status: "Open",
          isGeneral: true,
        },
        ...cases,
      ],
      selectedCaseId,
      messages,
    },
  });
}

export async function markPortalChatRead(req, res) {
  const link = await linkedClient(req);
  const requestedCaseId = clean(req.body.caseId, 80);
  const generalChat = !requestedCaseId || requestedCaseId === GENERAL_CHAT_ID;
  const caseItem = generalChat ? null : await linkedCase(req, link.clientId, requestedCaseId);
  await prisma.communicationConversation.updateMany({
    where: {
      agencyId: req.auth.agencyId,
      clientId: link.clientId,
      caseId: caseItem?.id || null,
      channel: "Chat",
      deletedAt: null,
    },
    data: { clientLastReadAt: new Date() },
  });
  res.json({ success: true });
}

// General (pre-case) chat has no case id and therefore no realtime topic —
// the broadcast/RLS scheme in supabaseRealtimeService.js is case-scoped
// only (case:{agencyId}:{caseId}), so that surface stays polling-only until
// a client-scoped topic namespace is worth adding.
export async function getPortalRealtimeConfig(req, res) {
  const link = await linkedClient(req);
  const requestedCaseId = clean(req.query.caseId, 80);
  const caseItem =
    requestedCaseId && requestedCaseId !== GENERAL_CHAT_ID
      ? await linkedCase(req, link.clientId, requestedCaseId)
      : null;
  res.json({
    success: true,
    data: caseItem
      ? getRealtimeClientConfig({
          userId: req.auth.userId,
          agencyId: req.auth.agencyId,
          caseId: caseItem.id,
          role: "client",
        })
      : { configured: false },
  });
}

export async function createPortalMessage(req, res) {
  const link = await linkedClient(req);
  const requestedCaseId = clean(req.body.caseId, 80);
  const caseItem =
    requestedCaseId && requestedCaseId !== GENERAL_CHAT_ID
      ? await linkedCase(req, link.clientId, requestedCaseId)
      : null;
  const bodyText = clean(req.body.bodyText, 5000);
  const hasAttachment = req.body.hasAttachment === true;
  if (!bodyText && !hasAttachment)
    throw createHttpError(
      400,
      "Write a message before sending.",
      "VALIDATION_ERROR",
    );
  const clientMessageId = clean(req.body.clientMessageId, 200) || randomUUID();
  const duplicate = await prisma.communicationMessage.findFirst({
    where: {
      agencyId: req.auth.agencyId,
      provider: "AuthenticatedPortal",
      providerMessageId: clientMessageId,
    },
  });
  if (duplicate)
    return res.json({
      success: true,
      data: duplicate,
      meta: { duplicate: true },
    });
  const preference = await getEffectiveClientCommunicationPreference({
    agencyId: req.auth.agencyId,
    clientId: link.clientId,
  });
  if (preference.doNotContact || !preference.allowChat)
    throw createHttpError(
      403,
      "Portal messaging is disabled for this account.",
      "CHAT_DISABLED",
    );
  const owner =
    caseItem?.assignedUserId ||
    link.client.assignedUserId ||
    (
      await prisma.user.findFirst({
        where: {
          agencyId: req.auth.agencyId,
          status: "active",
          role: { in: ["admin", "consultant"] },
        },
        orderBy: { createdAt: "asc" },
        select: { id: true },
      })
    )?.id;
  if (!owner)
    throw createHttpError(
      409,
      "No consultant is assigned to receive this message.",
      "NO_ASSIGNEE",
    );
  const occurredAt = new Date();
  const [responseDueAt, resolutionDueAt] = await Promise.all([
    communicationResponseDueAt(req.auth.agencyId, occurredAt),
    communicationResolutionDueAt(req.auth.agencyId, occurredAt),
  ]);
  const result = await prisma.$transaction(async (tx) => {
    let conversation = await tx.communicationConversation.findFirst({
      where: {
        agencyId: req.auth.agencyId,
        clientId: link.clientId,
        caseId: caseItem?.id || null,
        channel: "Chat",
        state: { not: "Closed" },
        deletedAt: null,
      },
      orderBy: { lastMessageAt: "desc" },
    });
    if (!conversation)
      conversation = await tx.communicationConversation.create({
        data: {
          agencyId: req.auth.agencyId,
          clientId: link.clientId,
          caseId: caseItem?.id || null,
          channel: "Chat",
          subject: caseItem
            ? "Client portal messages"
            : "General client inquiry",
          provider: "AuthenticatedPortal",
          assignedToId: owner,
          state: "WaitingOnAgency",
          firstInboundAt: occurredAt,
          lastInboundAt: occurredAt,
          responseDueAt,
          resolutionDueAt,
          lastMessageAt: occurredAt,
          createdById: owner,
        },
      });
    const message = await tx.communicationMessage.create({
      data: {
        agencyId: req.auth.agencyId,
        clientId: link.clientId,
        caseId: caseItem?.id || null,
        conversationId: conversation.id,
        channel: "Chat",
        direction: "Inbound",
        status: "Received",
        senderUserId: req.auth.userId,
        senderAddress: `client:${link.clientId}`,
        recipients: [],
        bodyText,
        provider: "AuthenticatedPortal",
        providerMessageId: clientMessageId,
        occurredAt,
        isRead: false,
      },
    });
    conversation = await tx.communicationConversation.update({
      where: { id: conversation.id },
      data: {
        state: "WaitingOnAgency",
        isArchived: false,
        firstInboundAt: conversation.firstInboundAt || occurredAt,
        lastInboundAt: occurredAt,
        responseDueAt,
        lastMessageAt: occurredAt,
        unreadCount: { increment: 1 },
      },
    });
    await tx.communicationDeliveryEvent.create({
      data: {
        agencyId: req.auth.agencyId,
        messageId: message.id,
        type: "Received",
        providerTimestamp: occurredAt,
        details: "Authenticated client portal message received",
      },
    });
    return { message, conversation };
  });
  await recordCommunicationAudit({
    agencyId: req.auth.agencyId,
    userId: req.auth.userId,
    conversationId: result.conversation.id,
    messageId: result.message.id,
    action: "communication.portal_message_received",
    details: `Portal message received from ${link.client.fullName}`,
  });
  await applyCommunicationAutomations({
    agencyId: req.auth.agencyId,
    trigger: "InboundReceived",
    message: result.message,
    conversation: result.conversation,
    caseItem,
    client: link.client,
  }).catch(() => {});
  // An attachment-only message broadcasts once the file finishes
  // uploading/scanning, not here — otherwise staff see an empty bubble
  // flash before the image or file appears in it.
  if (caseItem && !hasAttachment)
    await broadcastCaseCommunication({
      agencyId: req.auth.agencyId,
      caseId: caseItem.id,
      event: "message",
      payload: {
        messageId: result.message.id,
        conversationId: result.conversation.id,
        occurredAt,
      },
    }).catch(() => {});
  await recordActivity({
    agencyId: req.auth.agencyId,
    userId: req.auth.userId,
    clientId: link.clientId,
    caseId: caseItem?.id || null,
    action: "communication.portal_message_received",
    details: `Portal message received from ${link.client.fullName}`,
  });
  res.status(201).json({ success: true, data: result.message });
}

export async function uploadPortalMessageAttachment(req, res) {
  if (!req.file)
    throw createHttpError(400, "Choose a file to attach.", "VALIDATION_ERROR");
  const link = await linkedClient(req);
  const message = await prisma.communicationMessage.findFirst({
    where: {
      id: req.params.id,
      agencyId: req.auth.agencyId,
      clientId: link.clientId,
      channel: "Chat",
      deletedAt: null,
    },
  });
  if (!message) throw createHttpError(404, "Message not found.", "NOT_FOUND");
  // A client can only attach a file to their own just-sent message, within
  // a short grace window — the normal "pick an image, it uploads a moment
  // after the message shell is created" flow, not an open-ended edit.
  const attachAllowed =
    message.senderUserId === req.auth.userId &&
    Date.now() - message.createdAt.getTime() < CHAT_ATTACH_GRACE_MS;
  if (!attachAllowed)
    throw createHttpError(
      409,
      "This message can no longer accept an attachment.",
      "ATTACHMENT_WINDOW_CLOSED",
    );
  const data = await storeCommunicationAttachment({
    agencyId: req.auth.agencyId,
    message,
    file: req.file,
    uploadedById: req.auth.userId,
    auditUserId: req.auth.userId,
  });
  res.status(201).json({ success: true, data });
}

export async function servePortalMessageAttachment(req, res) {
  const link = await linkedClient(req);
  const data = await prisma.communicationAttachment.findFirst({
    where: {
      id: req.params.attachmentId,
      agencyId: req.auth.agencyId,
      message: { id: req.params.id, clientId: link.clientId, channel: "Chat", deletedAt: null },
    },
  });
  if (!data) throw createHttpError(404, "Attachment not found.", "NOT_FOUND");
  if (data.scanStatus === "Rejected")
    throw createHttpError(
      409,
      "This attachment was rejected by the security scanner.",
      "ATTACHMENT_REJECTED",
    );
  const buffer = await downloadStorageFile(DOCUMENT_BUCKET, data.storageKey, { allowMissing: true });
  if (!buffer) throw createHttpError(404, "Stored attachment file was not found.", "NOT_FOUND");
  const disposition = req.query.download === "1" ? "attachment" : "inline";
  res.setHeader(
    "Content-Disposition",
    `${disposition}; filename*=UTF-8''${encodeURIComponent(data.originalFilename || "attachment")}`,
  );
  res.type(data.mimeType || "application/octet-stream");
  res.send(buffer);
}

export async function portalProfile(req, res) {
  const link = await linkedClient(req);
  const { id, fullName, email, phone, dateOfBirth, address } = link.client;
  res.json({
    success: true,
    data: { id, fullName, email, phone, dateOfBirth, address },
  });
}
