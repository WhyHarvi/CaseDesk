import { randomUUID } from "node:crypto";
import path from "node:path";
import prisma from "../../services/prisma/client.js";
import { logger } from "../../services/logger.js";
import { nextClientNumber } from "../../services/clientNumberService.js";
import { assertNoContactDuplicate, lockAgencyContactIntake } from "../../services/contactDuplicateService.js";
import { removeDocumentFile, writeDocumentFile } from "../../services/documentStorage.js";
import { normalizeDocumentName } from "../../utils/documentNames.js";
import { AVATAR_BUCKET, downloadStorageFile } from "../../services/supabaseStorage.js";
import { renderRetainerDocumentHtml, wrapRetainerDocument } from "./retainerDocumentTemplate.js";
import { sendAccountAccessEmail } from "../../services/accountAccessMailService.js";
import { sendAgencyOomaSms } from "../../services/agencyOomaService.js";
import { publicRetainerSignUrl } from "../../services/bookingPublicLinkService.js";

const retainerTransactionOptions = { maxWait: 10_000, timeout: 20_000 };

function leadDisplayName(lead) {
  return [lead.firstName, lead.lastName].filter(Boolean).join(" ").trim() || "New client";
}

// The agency's workspace avatar, embedded as a data URI so it renders
// inside the sandboxed document iframe without an external request. Falls
// back to null (the template shows a monogram instead) whenever there's no
// logo uploaded, or storage isn't reachable — a missing letterhead image
// shouldn't block a retainer from going out.
async function agencyLogoDataUri(agency) {
  if (!agency?.avatarStorageKey) return null;
  try {
    const buffer = await downloadStorageFile(AVATAR_BUCKET, agency.avatarStorageKey, { allowMissing: true });
    if (!buffer?.length) return null;
    return `data:${agency.avatarMimeType || "image/png"};base64,${buffer.toString("base64")}`;
  } catch (error) {
    logger.warn("lead_retainer.logo_unavailable", { agencyId: agency.id, reason: error.message });
    return null;
  }
}

// Triggered from confirmManagedBooking (publicBookingController.js) the
// moment a lead's first consultation is confirmed. Creates a real Client +
// Case purely so the existing agreement e-signature system has somewhere to
// attach a retainer document — the lead itself is untouched otherwise and
// keeps working its normal pipeline (see Lead.earlyClientId's schema
// comment). Idempotent: a second call for the same lead is a no-op.
//
// db/writeFile/sendEmail/sendSms/fetchLogo are injectable (default to the
// real implementations) purely so tests can exercise this end to end
// against a mocked db without actually writing to storage or sending mail —
// the same db-injection convention the rest of lead.service.js uses,
// widened here to cover this function's non-Prisma side effects too.
export async function ensureRetainerClientForLead(appointment, { db = prisma, writeFile = writeDocumentFile, sendEmail = sendAccountAccessEmail, sendSms = sendAgencyOomaSms, fetchLogo = agencyLogoDataUri } = {}) {
  if (!appointment?.leadId) return null;
  const lead = await db.lead.findUnique({ where: { id: appointment.leadId } });
  if (!lead || lead.status !== "OPEN" || lead.earlyClientId) return null;

  const agencyId = lead.agencyId;
  const [agency, consultant, consultation] = await Promise.all([
    db.agency.findUnique({ where: { id: agencyId } }),
    db.user.findUnique({ where: { id: lead.ownerUserId } }),
    db.leadConsultation.findFirst({ where: { agencyId, leadId: lead.id, appointmentId: appointment.id } }),
  ]);

  // Phase 1: create the client/case shell and re-point the lead's records
  // onto it. DB-only — safe inside a transaction.
  const created = await db.$transaction(async (tx) => {
    const freshLead = await tx.lead.findUnique({ where: { id: lead.id } });
    if (!freshLead || freshLead.status !== "OPEN" || freshLead.earlyClientId) return null;

    await lockAgencyContactIntake(tx, agencyId);
    await assertNoContactDuplicate(tx, {
      agencyId,
      phoneNormalized: freshLead.phoneNormalized,
      emailNormalized: freshLead.emailNormalized,
      excludeLeadId: freshLead.id,
    });

    const clientNumber = await nextClientNumber(tx, agencyId);
    const client = await tx.client.create({
      data: {
        agencyId, clientNumber, fullName: leadDisplayName(freshLead),
        phone: freshLead.phone, phoneNormalized: freshLead.phoneNormalized,
        email: freshLead.email, emailNormalized: freshLead.emailNormalized,
        preferredLanguage: freshLead.preferredLanguage, status: "Active",
        assignedUserId: freshLead.ownerUserId,
      },
    });
    const caseItem = await tx.case.create({
      data: {
        agencyId, clientId: client.id, assignedUserId: freshLead.ownerUserId,
        caseType: freshLead.immigrationInterest || "Immigration consultation",
        stage: "Retainer Pending", status: "Active",
        nextAction: "Send retainer for signature",
      },
    });

    const leadAppointments = await tx.appointment.findMany({ where: { agencyId, leadId: freshLead.id }, select: { id: true } });
    const leadAppointmentIds = leadAppointments.map((item) => item.id);
    if (leadAppointmentIds.length) {
      await tx.appointment.updateMany({ where: { id: { in: leadAppointmentIds } }, data: { clientId: client.id } });
      await tx.note.updateMany({ where: { appointmentId: { in: leadAppointmentIds }, clientId: null }, data: { clientId: client.id } });
      await tx.followUp.updateMany({ where: { appointmentId: { in: leadAppointmentIds }, clientId: null }, data: { clientId: client.id } });
    }

    await tx.lead.update({ where: { id: freshLead.id }, data: { earlyClientId: client.id, earlyCaseId: caseItem.id, version: { increment: 1 } } });

    return { client, caseItem, freshLead };
  }, retainerTransactionOptions);

  if (!created) return null; // lost a confirm-twice race, or the lead is no longer open
  const { client, caseItem, freshLead } = created;

  // Phase 2: render + store the retainer document, then link it into a real
  // WrittenDocument/ClientDocument pair. Kept out of the transaction above —
  // both writeFile and fetchLogo are network calls, not DB operations (the
  // same reasoning applied to signing itself; see applyAgreementSignature in
  // clientPortalController.js).
  const consultationFee = consultation?.fee != null ? consultation.fee : 0;
  const logoDataUri = await fetchLogo(agency);
  const matter = freshLead.immigrationInterest ? `${freshLead.immigrationInterest} — Initial Consultation` : "Initial Consultation";
  const title = `Retainer Agreement — ${client.fullName}`;
  const contentHtml = renderRetainerDocumentHtml({
    agency, agencyLogoDataUri: logoDataUri, consultant: consultant || null, client,
    fileNumber: client.clientNumber, matter, consultationFee,
  });
  const fileHtml = wrapRetainerDocument({ title, contentHtml });
  const storageKey = path.posix.join(agencyId, caseItem.id, `${randomUUID()}.html`);
  const buffer = Buffer.from(fileHtml, "utf8");
  await writeFile(storageKey, buffer, "text/html");

  let writtenDocument;
  try {
    writtenDocument = await db.$transaction(async (tx) => {
      const clientDocument = await tx.clientDocument.create({
        data: {
          agencyId, clientId: client.id, caseId: caseItem.id,
          documentName: title, normalizedName: normalizeDocumentName(title),
          visibility: "Client", status: "Uploaded",
          notes: "Retainer agreement issued automatically after the consultation was confirmed.",
          storageKey, originalFilename: `${title}.html`, mimeType: "text/html", fileSize: buffer.length,
          receivedAt: new Date(), uploadedById: freshLead.ownerUserId,
        },
      });
      const document = await tx.writtenDocument.create({
        data: {
          agencyId, clientId: client.id, caseId: caseItem.id,
          title, contentHtml,
          headerText: agency?.name || null,
          footerText: [agency?.email, agency?.phone].filter(Boolean).join(" · ") || null,
          status: "Draft", correspondenceStatus: "Issued", correspondenceKind: "Agreement",
          issuedAt: new Date(), issuedById: freshLead.ownerUserId,
          issuedClientDocumentId: clientDocument.id,
          createdById: freshLead.ownerUserId, updatedById: freshLead.ownerUserId,
        },
      });
      await tx.lead.update({ where: { id: freshLead.id }, data: { retainerStatus: "SENT", version: { increment: 1 } } });
      await tx.leadActivity.create({
        data: {
          agencyId, leadId: freshLead.id, activityType: "AGREEMENT_SENT", direction: "INTERNAL", channel: "SYSTEM",
          title: "Retainer sent for e-signature",
          description: "Sent automatically after the first consultation was confirmed.",
          performedById: freshLead.ownerUserId,
          metadata: { writtenDocumentId: document.id, caseId: caseItem.id, clientId: client.id },
        },
      });
      await tx.activityLog.create({
        data: {
          agencyId, userId: freshLead.ownerUserId, clientId: client.id, caseId: caseItem.id,
          action: "lead.retainer_requested",
          details: `${freshLead.leadNumber}: retainer sent to ${client.fullName} for e-signature`,
          entityType: "lead", entityId: freshLead.id,
          metadata: { writtenDocumentId: document.id },
        },
      });
      return document;
    });
  } catch (error) {
    await removeDocumentFile(storageKey).catch(() => {});
    throw error;
  }

  await deliverRetainerRequest({ db, sendEmail, sendSms, agency, agencyId, lead: freshLead, client, appointment });

  return { client, caseItem, writtenDocument };
}

// Best-effort — a delivery failure shouldn't undo the client/case/document
// creation above (same reasoning bookingNotificationService uses: log and
// move on, don't throw, since the guest-facing confirm action already
// succeeded by this point).
async function deliverRetainerRequest({ db, sendEmail, sendSms, agency, agencyId, lead, client, appointment }) {
  const actionLink = publicRetainerSignUrl(appointment.manageToken);
  if (client.email) {
    try {
      await sendEmail({ agencyId, email: client.email, fullName: client.fullName, actionLink, kind: "retainer", audience: "client" });
      await db.leadMessageDelivery.create({
        data: {
          agencyId, leadId: lead.id, kind: "retainer_requested", channel: "email", recipient: client.email,
          status: "sent", sentAt: new Date(), subject: "Sign your retainer agreement",
          dedupeKey: `retainer:${lead.id}:email:${appointment.id}`,
        },
      }).catch(() => {});
    } catch (error) {
      logger.warn("lead_retainer.email_skipped", { agencyId, leadId: lead.id, reason: error.message });
    }
  }
  if (client.phone) {
    try {
      const agencyName = agency?.legalName || agency?.name || "Your consultant";
      await sendSms({
        agencyId, to: client.phone,
        body: `${agencyName}: your consultation is confirmed. Please review and sign your retainer agreement: ${actionLink}`,
        idempotencyKey: `retainer:${lead.id}:sms:${appointment.id}`,
      });
      await db.leadMessageDelivery.create({
        data: {
          agencyId, leadId: lead.id, kind: "retainer_requested", channel: "sms", recipient: client.phone,
          status: "sent", sentAt: new Date(), body: `Sign your retainer: ${actionLink}`,
          dedupeKey: `retainer:${lead.id}:sms:${appointment.id}`,
        },
      }).catch(() => {});
    } catch (error) {
      logger.warn("lead_retainer.sms_skipped", { agencyId, leadId: lead.id, reason: error.message });
    }
  }
}
