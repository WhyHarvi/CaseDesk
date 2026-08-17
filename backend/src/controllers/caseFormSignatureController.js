import prisma from "../services/prisma/client.js";
import { createHttpError } from "../utils/http.js";
import { assertFormUnlocked, requireFormPermission } from "../services/formPermissions.js";
import { clientRecipientIds, notifyUsers } from "../services/notificationService.js";
import { recordActivity } from "../utils/prismaCrud.js";
import { recordFormAudit } from "../utils/formAudit.js";
import { caseFormAccessWhere } from "../services/caseFormAccessService.js";

function isImm5476(form) {
  return String(form?.formNumber || "").toUpperCase().replace(/[^A-Z0-9]/g, "") === "IMM5476";
}

async function loadForm(req) {
  const form = await prisma.caseForm.findFirst({
    where: caseFormAccessWhere(req, { id: req.params.id }),
    include: {
      client: { select: { fullName: true, familyName: true, givenNames: true, dateOfBirth: true } },
      applicantProfile: { select: { givenNames: true, familyName: true, dateOfBirth: true } },
      representativeUser: { select: { id: true, fullName: true, licenseNumber: true, representativeType: true, membershipBody: true, membershipProvince: true, formSignatureImage: true, formSignatureStrokes: true } },
      fieldValues: { select: { fieldKey: true, value: true } },
    },
  });
  if (!form) throw createHttpError(404, "Case form not found");
  return form;
}

function applicantName(form) {
  const profileName = form.applicantProfile
    ? `${form.applicantProfile.givenNames || ""} ${form.applicantProfile.familyName || ""}`.trim()
    : form.client.fullName || `${form.client.givenNames || ""} ${form.client.familyName || ""}`.trim();
  if (profileName) return profileName;

  const valuesByKey = new Map(form.fieldValues.map((field) => [field.fieldKey, field.value]));
  return `${valuesByKey.get("554R") || ""} ${valuesByKey.get("553R") || ""}`.trim();
}

function hasApplicantIdentity(form) {
  const valuesByKey = new Map(form.fieldValues.map((field) => [field.fieldKey, field.value]));
  const savedPdfName = `${valuesByKey.get("554R") || ""} ${valuesByKey.get("553R") || ""}`.trim();
  const savedPdfDob = String(valuesByKey.get("555R") || "").trim();
  const profileDob = form.applicantProfile?.dateOfBirth || form.client.dateOfBirth;

  // A browser-saved XFA copy may contain these values without creating
  // checklist rows. The selected applicant/client record is therefore a
  // valid identity source as well as the mapped PDF fields.
  return Boolean((applicantName(form) || savedPdfName) && (profileDob || savedPdfDob));
}

export async function listFormSignatureRequests(req, res) {
  await loadForm(req);
  const data = await prisma.caseFormSignatureRequest.findMany({
    where: { caseFormId: req.params.id, agencyId: req.user.agencyId },
    select: { id: true, status: true, submissionChannel: true, message: true, applicantNameSnapshot: true, representativeNameSnapshot: true, representativeLicenceSnapshot: true, createdAt: true, signedAt: true },
    orderBy: { createdAt: "desc" },
  });
  res.json({ data });
}

export async function sendFormSignatureRequest(req, res) {
  const form = await loadForm(req);
  assertFormUnlocked(form);
  await requireFormPermission(req, "canEdit");
  if (!isImm5476(form)) throw createHttpError(409, "Secure draw-only signing is currently available for IMM 5476");
  if (!form.storageKey || form.currentCopyType === "Original") throw createHttpError(409, "Save a filled IMM 5476 copy before requesting signatures");
  if (!form.representativeUser) throw createHttpError(409, "Select the licensed representative before requesting signatures");
  if (!form.representativeUser.licenseNumber?.trim()) throw createHttpError(409, "The selected representative does not have a licence number in their profile");
  if (!["paid", "unpaid"].includes(String(form.representativeUser.representativeType || "").toLowerCase()) || !form.representativeUser.membershipBody?.trim()) {
    throw createHttpError(409, `${form.representativeUser.fullName} must complete their representative type and membership body in Settings before this form can be sent`);
  }
  if (!form.representativeUser.formSignatureImage || !Array.isArray(form.representativeUser.formSignatureStrokes)) {
    throw createHttpError(409, `${form.representativeUser.fullName} must save their government-form signature in Settings before this form can be sent`);
  }
  if (!hasApplicantIdentity(form)) {
    throw createHttpError(409, "Complete and save the applicant name and date of birth before requesting signatures");
  }
  if (req.body?.submissionChannel === "OutsidePortal") {
    throw createHttpError(409, "For a submission outside an IRCC portal or secure account, use a printed wet-signed copy instead of this electronic signing flow");
  }
  const recipients = await clientRecipientIds(form.agencyId, form.clientId);
  if (!recipients.length) throw createHttpError(409, "Create client portal access before sending the signature request");
  const message = req.body?.message ? String(req.body.message).trim().slice(0, 1000) : null;
  const data = await prisma.$transaction(async (tx) => {
    await tx.caseFormSignatureRequest.updateMany({ where: { caseFormId: form.id, status: "Sent" }, data: { status: "Cancelled" } });
    const created = await tx.caseFormSignatureRequest.create({
      data: {
        agencyId: form.agencyId,
        caseFormId: form.id,
        caseId: form.caseId,
        clientId: form.clientId,
        representativeUserId: form.representativeUser.id,
        sourceStorageKey: form.storageKey,
        sourceFileHash: form.fileHash,
        submissionChannel: "PortalOrSecureAccount",
        message,
        applicantNameSnapshot: applicantName(form),
        representativeNameSnapshot: form.representativeUser.fullName,
        representativeLicenceSnapshot: form.representativeUser.licenseNumber.trim(),
        representativeSignatureImage: form.representativeUser.formSignatureImage,
        representativeSignatureStrokes: form.representativeUser.formSignatureStrokes,
        createdById: req.user.id,
      },
    });
    await tx.caseForm.update({ where: { id: form.id }, data: { status: "SignatureRequired" } });
    return created;
  });
  await recordActivity({ agencyId: form.agencyId, userId: req.user.id, clientId: form.clientId, caseId: form.caseId, action: "case_form.signature_requested", details: `Requested ${applicantName(form)}'s drawn signature on IMM 5476` });
  await recordFormAudit({ form, event: "SignatureRequested", details: `Secure draw-only signature requested from ${applicantName(form)}`, metadata: { representativeUserId: form.representativeUser.id }, userId: req.user.id });
  try {
    await notifyUsers({
      agencyId: form.agencyId,
      recipientIds: recipients,
      actorUserId: req.user.id,
      type: "case_form.signature_requested",
      category: "documents",
      title: "Please sign IMM 5476",
      body: message || "Review the declaration and draw your signature securely in CaseDesk.",
      actionUrl: "/client-portal/questionnaires",
      entityType: "case_form_signature_request",
      entityId: data.id,
      dedupeKey: `case-form:${form.id}:signature-request`,
    });
  } catch {
    // The portal request remains available if notification delivery fails.
  }
  res.status(201).json({ data });
}
