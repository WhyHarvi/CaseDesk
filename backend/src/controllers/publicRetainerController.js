import prisma from "../services/prisma/client.js";
import { createHttpError } from "../utils/http.js";
import { recordActivity } from "../utils/prismaCrud.js";
import { resolveManaged } from "./publicBookingController.js";
import { applyAgreementSignature, publicAgreement } from "./clientPortalController.js";
import { wrapRetainerDocument } from "../modules/leads/retainerDocumentTemplate.js";

// No-login counterpart to the client-portal agreement view/sign endpoints in
// clientPortalController.js — same WrittenDocument, same signature logic
// (applyAgreementSignature), just reached via the appointment's manageToken
// (already emailed/texted to the guest) instead of a portal session. Exists
// because a Lead's early-created Client (see lead.retainer.service.js) has
// no portal login yet — the client hasn't been invited to one, and
// shouldn't need to create one just to sign a retainer.

async function retainerAgreementForAppointment(appointment, select) {
  if (!appointment.caseId || !appointment.clientId) {
    throw createHttpError(404, "No retainer is available for this appointment yet.", "NOT_FOUND");
  }
  const agreement = await prisma.writtenDocument.findFirst({
    where: {
      agencyId: appointment.agencyId,
      caseId: appointment.caseId,
      clientId: appointment.clientId,
      correspondenceKind: "Agreement",
      correspondenceStatus: { in: ["Issued", "Signed", "Finalized"] },
      case: { deletedAt: null, archivedAt: null },
    },
    orderBy: { createdAt: "desc" },
    select,
  });
  if (!agreement) throw createHttpError(404, "No retainer is available for this appointment yet.", "NOT_FOUND");
  return agreement;
}

const agreementSelect = { id: true, title: true, correspondenceKind: true, correspondenceStatus: true, issuedAt: true, updatedAt: true, issuedClientDocumentId: true };

export async function getManagedRetainer(req, res) {
  const appointment = await resolveManaged(req.params.manageToken);
  const agreement = await retainerAgreementForAppointment(appointment, { ...agreementSelect, caseId: true, contentHtml: true, headerText: true, footerText: true });

  let signature = null;
  try {
    const signatureLog = await prisma.activityLog.findFirst({
      where: { agencyId: appointment.agencyId, clientId: appointment.clientId, action: "correspondence.portal_signed", metadata: { path: ["writtenDocumentId"], equals: agreement.id } },
      orderBy: { createdAt: "desc" },
      select: { metadata: true, createdAt: true },
    });
    if (signatureLog) signature = {
      signerName: signatureLog.metadata?.signerName || null,
      signedAt: signatureLog.metadata?.signedAt || signatureLog.createdAt,
      method: signatureLog.metadata?.signatureMethod || "typed",
    };
  } catch {
    signature = null;
  }

  // First view — advance the lead's retainer status past "Sent" the same
  // way the ladder was always meant to work, without disturbing it once the
  // client has actually signed.
  if (appointment.leadId && !signature) {
    await prisma.lead.updateMany({ where: { id: appointment.leadId, retainerStatus: "SENT" }, data: { retainerStatus: "VIEWED" } }).catch(() => {});
  }

  res.json({
    success: true,
    data: {
      ...publicAgreement(agreement),
      hasPreview: Boolean(String(agreement.contentHtml || "").trim()),
      html: wrapRetainerDocument(agreement),
      signature,
    },
  });
}

export async function signManagedRetainer(req, res) {
  const appointment = await resolveManaged(req.params.manageToken);
  const agreement = await retainerAgreementForAppointment(appointment, { id: true, title: true, correspondenceStatus: true, caseId: true, contentHtml: true, headerText: true, footerText: true, issuedClientDocumentId: true });

  await applyAgreementSignature({
    agreement,
    agencyId: appointment.agencyId,
    clientId: appointment.clientId,
    signerName: req.body?.fullName,
    consent: req.body?.consent,
    // Retainers are finger/stylus signature only — forced here rather than
    // trusted from the request body, so a typed signature can't be slipped
    // in through a raw API call even though the field still exists for
    // every other document type this shared function signs.
    signatureMethod: "drawn",
    signatureImage: req.body?.signatureImage,
    userId: null,
    activityAction: "correspondence.portal_signed",
    renderDocument: wrapRetainerDocument,
  });

  if (appointment.leadId) {
    await prisma.lead.update({ where: { id: appointment.leadId }, data: { retainerStatus: "SIGNED", version: { increment: 1 } } }).catch(() => {});
    const lead = await prisma.lead.findUnique({ where: { id: appointment.leadId }, select: { leadNumber: true } });
    await prisma.leadActivity.create({
      data: {
        agencyId: appointment.agencyId, leadId: appointment.leadId, activityType: "AGREEMENT_SIGNED", direction: "INBOUND", channel: "SYSTEM",
        title: "Retainer signed", description: `Signed electronically by ${String(req.body?.fullName || "").trim()}`,
        metadata: { writtenDocumentId: agreement.id },
      },
    }).catch(() => {});
    await recordActivity({
      agencyId: appointment.agencyId, userId: null, clientId: appointment.clientId, caseId: appointment.caseId,
      action: "lead.retainer_signed",
      details: `${lead?.leadNumber || "Lead"}: retainer signed electronically`,
      entityType: "lead", entityId: appointment.leadId,
      metadata: { writtenDocumentId: agreement.id },
    }).catch(() => {});
  }

  res.json({ success: true, message: "Signed. Thank you — your consultant has been notified." });
}
