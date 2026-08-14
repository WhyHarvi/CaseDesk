import prisma from "../services/prisma/client.js";
import { createHttpError } from "../utils/http.js";
import { submitClientRequest } from "../services/caseFormClientRequestService.js";
import { recordActivity } from "../utils/prismaCrud.js";
import { drawnSignatureImage } from "./clientPortalController.js";
import { validatedSignatureStrokes } from "../utils/signatureStrokes.js";
import { createSignedImm5476Copy } from "../services/imm5476SignatureService.js";
import { internalCaseRecipientIds, notifyUsers } from "../services/notificationService.js";
import { recordFormAudit } from "../utils/formAudit.js";

async function linkedClient(req) {
  const link = await prisma.clientUser.findFirst({
    where: { agencyId: req.auth.agencyId, userId: req.auth.userId },
    include: { client: true },
    orderBy: { isPrimary: "desc" },
  });
  if (!link) throw createHttpError(404, "Client portal profile not found.", "NOT_FOUND");
  return link;
}

// Shows the client only the fields a consultant explicitly asked them for,
// in plain language — never the whole form, never anything not theirs to
// answer. Mirrors ClientPortalQuestionnaires' one-short-screen shape.
export async function getPortalCaseFormRequests(req, res) {
  const link = await linkedClient(req);
  await prisma.caseFormSignatureRequest.updateMany({
    where: { agencyId: req.auth.agencyId, clientId: link.clientId, status: "Signing", updatedAt: { lt: new Date(Date.now() - 5 * 60_000) } },
    data: { status: "Sent" },
  });
  const [requests, signatureRequests] = await Promise.all([
    prisma.caseFormClientRequest.findMany({
      where: { agencyId: req.auth.agencyId, clientId: link.clientId, status: { in: ["Sent", "InProgress"] } },
      orderBy: { sentAt: "desc" },
      include: { caseForm: { select: { id: true, title: true, formNumber: true, sourceAgencyFormTemplateId: true } } },
    }),
    prisma.caseFormSignatureRequest.findMany({
      where: { agencyId: req.auth.agencyId, clientId: link.clientId, status: "Sent" },
      orderBy: { createdAt: "desc" },
      include: { caseForm: { select: { id: true, title: true, formNumber: true } } },
    }),
  ]);

  const schemaByTemplate = new Map();
  const data = [];
  for (const request of requests) {
    const templateId = request.caseForm?.sourceAgencyFormTemplateId;
    if (!templateId) continue;
    if (!schemaByTemplate.has(templateId)) {
      schemaByTemplate.set(templateId, await prisma.formTemplateFieldSchema.findMany({ where: { agencyFormTemplateId: templateId } }));
    }
    const schema = schemaByTemplate.get(templateId);
    const keys = Array.isArray(request.requestedFieldKeys) ? request.requestedFieldKeys : [];
    const values = await prisma.caseFormFieldValue.findMany({ where: { caseFormId: request.caseFormId, fieldKey: { in: keys } } });
    const valuesByKey = new Map(values.map((row) => [row.fieldKey, row]));
    const fields = keys.map((key) => {
      const fieldSchema = schema.find((row) => row.fieldKey === key);
      return {
        fieldKey: key,
        label: fieldSchema?.label || key,
        helpText: fieldSchema?.helpText || null,
        fieldType: fieldSchema?.fieldType || "Text",
        value: valuesByKey.get(key)?.value ?? null,
      };
    });
    data.push({
      id: request.id,
      requestType: "Fields",
      status: request.status,
      message: request.message,
      dueAt: request.dueAt,
      formTitle: request.caseForm?.title,
      formNumber: request.caseForm?.formNumber,
      fields,
    });
  }
  data.push(...signatureRequests.map((request) => ({
    id: request.id,
    requestType: "Signature",
    status: request.status,
    message: request.message,
    formTitle: request.caseForm?.title,
    formNumber: request.caseForm?.formNumber,
    applicantName: request.applicantNameSnapshot,
    representativeName: request.representativeNameSnapshot,
    representativeLicence: request.representativeLicenceSnapshot,
    fields: [],
    createdAt: request.createdAt,
  })));
  data.sort((left, right) => new Date(right.createdAt || right.dueAt || 0) - new Date(left.createdAt || left.dueAt || 0));
  res.json({ data });
}

export async function submitPortalCaseFormRequest(req, res) {
  const link = await linkedClient(req);
  const request = await prisma.caseFormClientRequest.findFirst({ where: { id: req.params.requestId, agencyId: req.auth.agencyId, clientId: link.clientId } });
  if (!request) throw createHttpError(404, "Request not found.", "NOT_FOUND");
  if (request.status === "Submitted" || request.status === "Reviewed") {
    return res.json({ data: request, meta: { alreadySubmitted: true } });
  }
  const answers = req.body.answers && typeof req.body.answers === "object" ? req.body.answers : {};
  const updated = await submitClientRequest({ id: request.id, clientId: link.clientId, answers });
  await recordActivity({ agencyId: req.auth.agencyId, userId: req.auth.userId, clientId: link.clientId, caseId: request.caseId, action: "case_form.client_request_submitted", details: "Client submitted requested form details" });
  res.json({ data: updated });
}

export async function signPortalCaseFormRequest(req, res) {
  const link = await linkedClient(req);
  const request = await prisma.caseFormSignatureRequest.findFirst({
    where: { id: req.params.requestId, agencyId: req.auth.agencyId, clientId: link.clientId },
    include: { caseForm: true },
  });
  if (!request) throw createHttpError(404, "Signature request not found.", "NOT_FOUND");
  if (request.status === "Signed") return res.json({ data: request, meta: { alreadySigned: true } });
  if (request.status !== "Sent") throw createHttpError(409, "This signature request is no longer active.", "SIGNATURE_REQUEST_INACTIVE");
  if (request.submissionChannel !== "PortalOrSecureAccount") throw createHttpError(409, "This form requires a printed wet signature.", "WET_SIGNATURE_REQUIRED");
  if (req.body?.consent !== true) throw createHttpError(400, "Confirm the declaration before signing.", "SIGNATURE_CONSENT_REQUIRED");
  const applicantSignatureImage = drawnSignatureImage(req.body?.signatureImage);
  const applicantSignatureStrokes = validatedSignatureStrokes(req.body?.signatureStrokes);

  const claimed = await prisma.caseFormSignatureRequest.updateMany({ where: { id: request.id, status: "Sent" }, data: { status: "Signing" } });
  if (claimed.count !== 1) throw createHttpError(409, "This signature request is already being processed.", "SIGNATURE_REQUEST_INACTIVE");
  let signingResult;
  try {
    signingResult = await createSignedImm5476Copy({
      request,
      applicantStrokes: applicantSignatureStrokes,
      applicantSignatureImage,
      actorUserId: req.auth.userId,
      signerIp: String(req.ip || "").slice(0, 128) || null,
      signerUserAgent: String(req.get("user-agent") || "").slice(0, 500) || null,
    });
  } catch (error) {
    await prisma.caseFormSignatureRequest.updateMany({ where: { id: request.id, status: "Signing" }, data: { status: "Sent" } });
    throw error;
  }
  const { signedForm, signatureRequest: updated } = signingResult;
  await recordActivity({ agencyId: req.auth.agencyId, userId: req.auth.userId, clientId: link.clientId, caseId: request.caseId, action: "case_form.portal_signed", details: `${request.applicantNameSnapshot} drew their signature on IMM 5476` });
  await recordFormAudit({ form: signedForm, event: "ClientSigned", details: `${request.applicantNameSnapshot} signed securely in the client portal`, metadata: { signatureRequestId: request.id, submissionChannel: request.submissionChannel }, userId: req.auth.userId });
  try {
    await notifyUsers({
      agencyId: req.auth.agencyId,
      recipientIds: [...new Set([...(await internalCaseRecipientIds(req.auth.agencyId, request.caseId)), request.createdById, request.representativeUserId].filter(Boolean))],
      actorUserId: req.auth.userId,
      type: "case_form.client_signed",
      category: "documents",
      title: "IMM 5476 signed",
      body: `${request.applicantNameSnapshot} completed the secure signature request.`,
      actionUrl: `/app/cases/${request.caseId}?tab=forms`,
      entityType: "case_form",
      entityId: request.caseFormId,
      dedupeKey: `case-form:${request.caseFormId}:signed:${request.id}`,
    });
  } catch {
    // The signed PDF and audit record are already safely stored.
  }
  res.json({ data: updated });
}
