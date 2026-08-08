import prisma from "../services/prisma/client.js";
import { createHttpError } from "../utils/http.js";
import { recordActivity } from "../utils/prismaCrud.js";
import { ensureDefaultCorrespondenceTemplates, getCorrespondenceContext, renderCorrespondenceHtml, templateMatchesCase } from "../services/correspondenceTemplateService.js";
import { changeCorrespondenceStatus } from "./correspondenceController.js";
import { notifyRetainerIssued } from "../services/agreementNotificationService.js";

const documentInclude = {
  correspondenceTemplate: { select: { id: true, title: true, kind: true, category: true, versionNumber: true } },
  clientDocument: { select: { id: true, documentName: true, originalFilename: true, storageKey: true, updatedAt: true } },
  issuedClientDocument: { select: { id: true, documentName: true, originalFilename: true, storageKey: true, updatedAt: true } },
  updatedBy: { select: { id: true, fullName: true } },
  issuedBy: { select: { id: true, fullName: true } },
};

async function scopedCase(req, caseId) {
  const data = await prisma.case.findFirst({ where: { id: caseId, agencyId: req.user.agencyId }, include: { client: true } });
  if (!data) throw createHttpError(404, "Case not found");
  if (data.archivedAt || data.deletedAt) throw createHttpError(409, "Restore this case before working with its billing retainer");
  return data;
}

// Fix 3.1's resolution order: (1) the case's own Agreement WrittenDocument
// if one already exists, at any status — once staff has started or issued
// a retainer, that's always what Billing should show, not a fresh
// suggestion; (2) otherwise the isSystemDefault Agreement template whose
// caseTags match this case's caseType, via the same forgiving matcher
// CorrespondenceTemplate matching already uses; (3) otherwise the agency's
// general-purpose system template, so Billing never dead-ends with nothing
// to show.
async function resolveRetainerTemplate(agencyId, caseType) {
  await ensureDefaultCorrespondenceTemplates(agencyId);
  const templates = await prisma.correspondenceTemplate.findMany({
    where: { agencyId, isActive: true, kind: "Agreement", isSystemDefault: true },
    orderBy: { title: "asc" },
  });
  const specific = templates.find((template) => !template.caseTags.includes("general") && templateMatchesCase(template, caseType));
  if (specific) return { template: specific, isGeneralFallback: false };
  const general = templates.find((template) => template.caseTags.includes("general"));
  return general ? { template: general, isGeneralFallback: true } : { template: null, isGeneralFallback: false };
}

export async function getCaseBillingRetainer(req, res) {
  const caseItem = await scopedCase(req, req.params.caseId);
  const existing = await prisma.writtenDocument.findFirst({
    where: { agencyId: req.user.agencyId, caseId: caseItem.id, correspondenceKind: "Agreement" },
    include: documentInclude,
    orderBy: { updatedAt: "desc" },
  });
  if (existing) {
    res.json({ data: { source: "existing", document: existing, template: null, isGeneralFallback: false } });
    return;
  }
  const { template, isGeneralFallback } = await resolveRetainerTemplate(req.user.agencyId, caseItem.caseType);
  res.json({
    data: {
      source: template ? "template" : "none",
      document: null,
      template: template ? { id: template.id, title: template.title, isSystemDefault: template.isSystemDefault } : null,
      isGeneralFallback,
    },
  });
}

// Creates the case's retainer draft from the resolved system template — the
// Billing-tab equivalent of correspondenceController's createCorrespondenceDraft,
// scoped to Agreement-kind documents only so Billing-tab-only staff (who may
// not have Agreements & Letters access) can start a retainer without that
// broader permission.
export async function createCaseBillingRetainerDraft(req, res) {
  const caseItem = await scopedCase(req, req.params.caseId);
  const alreadyExists = await prisma.writtenDocument.findFirst({ where: { agencyId: req.user.agencyId, caseId: caseItem.id, correspondenceKind: "Agreement" }, select: { id: true } });
  if (alreadyExists) throw createHttpError(409, "This case already has a retainer.", "RETAINER_EXISTS");
  const { template } = await resolveRetainerTemplate(req.user.agencyId, caseItem.caseType);
  if (!template) throw createHttpError(409, "No retainer template is available yet — ask an administrator to add one in Settings.", "NO_TEMPLATE");

  const context = await getCorrespondenceContext(req.user.agencyId, caseItem.id, req.user.id);
  const rendered = renderCorrespondenceHtml(template.contentHtml, context);
  const title = `${template.title} — ${caseItem.client.fullName}`;
  const data = await prisma.writtenDocument.create({
    data: {
      agencyId: req.user.agencyId,
      clientId: caseItem.clientId,
      caseId: caseItem.id,
      title,
      contentHtml: rendered.html,
      headerText: context.agency?.name || null,
      footerText: [context.agency?.email, context.agency?.phone].filter(Boolean).join(" · ") || null,
      status: "Draft",
      correspondenceStatus: "Draft",
      correspondenceKind: "Agreement",
      correspondenceTemplateId: template.id,
      createdById: req.user.id,
      updatedById: req.user.id,
    },
    include: documentInclude,
  });
  await recordActivity({ agencyId: req.user.agencyId, userId: req.user.id, clientId: caseItem.clientId, caseId: caseItem.id, action: "correspondence.draft_created", details: `${data.title} created from ${template.title}` });
  res.status(201).json({ data: { source: "existing", document: data, template: null, isGeneralFallback: false } });
}

// Fix 4.1 — the "Approve and send" action. Only an admin or consultant may
// approve a retainer for signature; front-desk and other roles can prepare
// the draft (via the Writer, same as any other Agreement) but not send it.
// Reuses changeCorrespondenceStatus so the underlying transition — copying
// the working file to a client-facing document, requiring a portal link,
// stamping issuedById/issuedAt — is identical to the Agreements & Letters
// path, just gated differently and followed by an email.
export async function approveCaseBillingRetainer(req, res) {
  if (!["admin", "consultant"].includes(req.user.role)) {
    throw createHttpError(403, "Only a consultant or administrator can approve and send a retainer.", "FORBIDDEN");
  }
  const caseItem = await scopedCase(req, req.params.caseId);
  const existing = await prisma.writtenDocument.findFirst({
    where: { agencyId: req.user.agencyId, caseId: caseItem.id, correspondenceKind: "Agreement" },
    orderBy: { updatedAt: "desc" },
    select: { id: true },
  });
  if (!existing) throw createHttpError(404, "This case has no retainer draft yet.", "NOT_FOUND");
  const data = await changeCorrespondenceStatus(req.user.agencyId, existing.id, "Issued", { actorUserId: req.user.id, requireKind: "Agreement" });
  await notifyRetainerIssued({ agencyId: req.user.agencyId, caseItem, document: data, actorUserId: req.user.id }).catch(() => {});
  res.json({ data: { source: "existing", document: data, template: null, isGeneralFallback: false } });
}
