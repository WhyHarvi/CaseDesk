import prisma from "../services/prisma/client.js";
import { createHttpError } from "../utils/http.js";
import { assertFormUnlocked, requireFormPermission } from "../services/formPermissions.js";
import { autofillCaseForm, getCaseFormChecklist, setCaseFormFieldValue } from "../services/caseFormFillService.js";
import { createClientRequest, listClientRequestsForForm, reviewClientRequest } from "../services/caseFormClientRequestService.js";
import { recordActivity } from "../utils/prismaCrud.js";
import { clientRecipientIds, notifyUsers } from "../services/notificationService.js";
import { caseFormAccessWhere } from "../services/caseFormAccessService.js";

async function loadForm(req) {
  const form = await prisma.caseForm.findFirst({ where: caseFormAccessWhere(req, { id: req.params.id }) });
  if (!form) throw createHttpError(404, "Case form not found");
  return form;
}

export async function getChecklist(req, res) {
  const form = await loadForm(req);
  const data = await getCaseFormChecklist({ caseFormId: form.id, agencyId: req.user.agencyId });
  res.json({ data });
}

export async function runAutofill(req, res) {
  const form = await loadForm(req);
  assertFormUnlocked(form);
  await requireFormPermission(req, "canEdit");
  const result = await autofillCaseForm({ caseFormId: form.id, agencyId: req.user.agencyId });
  if (!result) throw createHttpError(404, "Case form not found");
  res.json({ data: result });
}

export async function patchFieldValue(req, res) {
  const form = await loadForm(req);
  assertFormUnlocked(form);
  await requireFormPermission(req, "canEdit");
  const data = await setCaseFormFieldValue({
    caseFormId: form.id,
    agencyId: req.user.agencyId,
    fieldKey: req.params.fieldKey,
    value: req.body.value,
    status: "ConsultantEntered",
    filledById: req.user.id,
  });
  res.json({ data });
}

export async function setRepresentative(req, res) {
  const form = await loadForm(req);
  assertFormUnlocked(form);
  await requireFormPermission(req, "canEdit");
  const representativeUserId = req.body.representativeUserId ? String(req.body.representativeUserId) : null;
  if (representativeUserId) {
    const user = await prisma.user.findFirst({
      where: {
        id: representativeUserId,
        agencyId: req.user.agencyId,
        role: { in: ["admin", "consultant"] },
        status: "active",
        licenseNumber: { not: null },
      },
    });
    if (!user?.licenseNumber?.trim()) throw createHttpError(400, "Choose an active licensed representative from this agency");
  }
  const data = await prisma.caseForm.update({ where: { id: form.id }, data: { representativeUserId } });
  res.json({ data });
}

export async function setApplicant(req, res) {
  const form = await loadForm(req);
  assertFormUnlocked(form);
  await requireFormPermission(req, "canEdit");
  const applicantProfileId = req.body.applicantProfileId ? String(req.body.applicantProfileId) : null;
  if (applicantProfileId) {
    const profile = await prisma.immigrationProfile.findFirst({
      where: { id: applicantProfileId, agencyId: req.user.agencyId, caseAccesses: { some: { caseId: form.caseId } } },
    });
    if (!profile) throw createHttpError(400, "That applicant is not linked to this case");
  }
  const data = await prisma.caseForm.update({ where: { id: form.id }, data: { applicantProfileId } });
  res.json({ data });
}

export async function listRepresentativeOptions(req, res) {
  const data = await prisma.user.findMany({
    where: {
      agencyId: req.user.agencyId,
      role: { in: ["admin", "consultant"] },
      status: "active",
      licenseNumber: { not: null },
    },
    select: { id: true, fullName: true, role: true, licenseNumber: true, representativeType: true, membershipBody: true, membershipProvince: true, formSignatureImage: true, formSignatureStrokes: true, formSignatureUpdatedAt: true },
    orderBy: { fullName: "asc" },
  });
  res.json({
    data: data.filter((user) => user.licenseNumber?.trim()).map(({ formSignatureImage, formSignatureStrokes, ...user }) => ({
      ...user,
      hasFormSignature: Boolean(formSignatureImage && Array.isArray(formSignatureStrokes)),
    })),
  });
}

export async function getClientRequests(req, res) {
  const form = await loadForm(req);
  const data = await listClientRequestsForForm({ caseFormId: form.id, agencyId: req.user.agencyId });
  res.json({ data });
}

export async function postClientRequest(req, res) {
  const form = await loadForm(req);
  assertFormUnlocked(form);
  await requireFormPermission(req, "canEdit");
  const fieldKeys = [...new Set(Array.isArray(req.body.fieldKeys) ? req.body.fieldKeys.map(String) : [])];
  if (!fieldKeys.length) throw createHttpError(400, "Select at least one field to send to the client");

  const schema = await prisma.formTemplateFieldSchema.findMany({ where: { agencyFormTemplateId: form.sourceAgencyFormTemplateId || "", fieldKey: { in: fieldKeys } } });
  const invalid = fieldKeys.filter((key) => {
    const field = schema.find((row) => row.fieldKey === key);
    return !field || field.fillableBy === "Consultant" || field.fieldType === "Signature";
  });
  if (invalid.length) throw createHttpError(400, "One or more selected fields cannot be sent to the client");

  const message = req.body.message ? String(req.body.message).trim().slice(0, 1000) : null;
  const dueAt = req.body.dueAt ? new Date(req.body.dueAt) : null;
  const data = await createClientRequest({ agencyId: req.user.agencyId, caseFormId: form.id, caseId: form.caseId, clientId: form.clientId, fieldKeys, message, dueAt });

  await recordActivity({ agencyId: req.user.agencyId, userId: req.user.id, clientId: form.clientId, caseId: form.caseId, action: "case_form.client_request_sent", details: `Asked the client to complete ${fieldKeys.length} field${fieldKeys.length === 1 ? "" : "s"} on ${form.title}` });
  try {
    await notifyUsers({
      agencyId: req.user.agencyId,
      recipientIds: await clientRecipientIds(req.user.agencyId, form.clientId),
      actorUserId: req.user.id,
      type: "case_form.client_request",
      category: "documents",
      title: `Please complete ${form.title}`,
      body: message || "A few details are needed to finish this form.",
      actionUrl: "/client-portal",
      entityType: "case_form",
      entityId: form.id,
      dedupeKey: `case-form:${form.id}:client-request`,
    });
  } catch {
    /* notification failure shouldn't block the request itself */
  }

  res.status(201).json({ data });
}

export async function patchReviewClientRequest(req, res) {
  const form = await loadForm(req);
  await requireFormPermission(req, "canReview");
  const data = await reviewClientRequest({ id: req.params.requestId, agencyId: req.user.agencyId, caseFormId: form.id, reviewedById: req.user.id });
  if (!data) throw createHttpError(404, "Client request not found");
  res.json({ data });
}
