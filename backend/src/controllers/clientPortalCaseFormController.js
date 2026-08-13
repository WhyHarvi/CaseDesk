import prisma from "../services/prisma/client.js";
import { createHttpError } from "../utils/http.js";
import { submitClientRequest } from "../services/caseFormClientRequestService.js";
import { recordActivity } from "../utils/prismaCrud.js";

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
  const requests = await prisma.caseFormClientRequest.findMany({
    where: { agencyId: req.auth.agencyId, clientId: link.clientId, status: { in: ["Sent", "InProgress"] } },
    orderBy: { sentAt: "desc" },
    include: { caseForm: { select: { id: true, title: true, formNumber: true, sourceAgencyFormTemplateId: true } } },
  });
  if (!requests.length) return res.json({ data: [] });

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
      status: request.status,
      message: request.message,
      dueAt: request.dueAt,
      formTitle: request.caseForm?.title,
      formNumber: request.caseForm?.formNumber,
      fields,
    });
  }
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
