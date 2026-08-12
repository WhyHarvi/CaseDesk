import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import prisma from "../services/prisma/client.js";
import { createHttpError } from "../utils/http.js";
import { recordActivity } from "../utils/prismaCrud.js";
import { applyResolvedMergeValues, ensureDefaultCorrespondenceTemplates, escapeHtml, getCorrespondenceContext, renderCorrespondenceHtml, templateMatchesCase } from "../services/correspondenceTemplateService.js";
import { createCaseSchedule, getRetainerScheduleMergeContext, previewRetainerScheduleMergeContext } from "../services/paymentScheduleService.js";
import { changeCorrespondenceStatus } from "./correspondenceController.js";
import { notifyRetainerIssued } from "../services/agreementNotificationService.js";
import { removeDocumentFile } from "../services/documentStorage.js";

const documentInclude = {
  correspondenceTemplate: { select: { id: true, title: true, kind: true, category: true, versionNumber: true } },
  clientDocument: { select: { id: true, documentName: true, originalFilename: true, storageKey: true, updatedAt: true } },
  issuedClientDocument: { select: { id: true, documentName: true, originalFilename: true, storageKey: true, updatedAt: true } },
  updatedBy: { select: { id: true, fullName: true } },
  issuedBy: { select: { id: true, fullName: true } },
};

const RETAINER_REVIEW_TTL_MS = 15 * 60_000;

function retainerReviewSecret() {
  const secret = String(
    process.env.MAIL_SETTINGS_ENCRYPTION_KEY
      || process.env.SUPABASE_SERVICE_ROLE_KEY
      || process.env.MS_MAIL_CLIENT_SECRET
      || "",
  );
  if (!secret) {
    throw createHttpError(
      503,
      "Secure retainer review is not configured.",
      "RETAINER_REVIEW_NOT_CONFIGURED",
    );
  }
  return secret;
}

function retainerPreviewDigest({ title, contentHtml, headerText, footerText }) {
  return createHash("sha256")
    .update(JSON.stringify({ title, contentHtml, headerText, footerText }))
    .digest("hex");
}

function createRetainerReviewToken(req, caseId, templateId, preview) {
  const payload = Buffer.from(
    JSON.stringify({
      agencyId: req.user.agencyId,
      userId: req.user.id,
      caseId,
      templateId,
      digest: retainerPreviewDigest(preview),
      expiresAt: Date.now() + RETAINER_REVIEW_TTL_MS,
    }),
  ).toString("base64url");
  const signature = createHmac("sha256", retainerReviewSecret())
    .update(payload)
    .digest("base64url");
  return `${payload}.${signature}`;
}

function requireMatchingRetainerReview(
  req,
  caseId,
  templateId,
  preview,
) {
  const [payload, suppliedSignature] = String(req.body?.reviewToken || "").split(".");
  if (!payload || !suppliedSignature) {
    throw createHttpError(
      409,
      "View the retainer before approving it.",
      "RETAINER_REVIEW_REQUIRED",
    );
  }
  const expectedSignature = createHmac("sha256", retainerReviewSecret())
    .update(payload)
    .digest("base64url");
  const suppliedBuffer = Buffer.from(suppliedSignature);
  const expectedBuffer = Buffer.from(expectedSignature);
  if (
    suppliedBuffer.length !== expectedBuffer.length
    || !timingSafeEqual(suppliedBuffer, expectedBuffer)
  ) {
    throw createHttpError(
      409,
      "The retainer review is no longer valid. View it again before approving.",
      "RETAINER_REVIEW_EXPIRED",
    );
  }
  let values;
  try {
    values = JSON.parse(Buffer.from(payload, "base64url").toString());
  } catch {
    values = null;
  }
  if (
    !values
    || values.agencyId !== req.user.agencyId
    || values.userId !== req.user.id
    || values.caseId !== caseId
    || values.templateId !== templateId
    || values.digest !== retainerPreviewDigest(preview)
    || Number(values.expiresAt) < Date.now()
  ) {
    throw createHttpError(
      409,
      "The retainer or payment schedule changed. View it again before approving.",
      "RETAINER_REVIEW_EXPIRED",
    );
  }
}

function requireRetainerApprover(req) {
  if (!["admin", "consultant"].includes(req.user.role)) {
    throw createHttpError(
      403,
      "Only a consultant or administrator can review and create a retainer.",
      "FORBIDDEN",
    );
  }
}

// Rebuilds the "Payment Schedule" table's rows to match the case's real
// installments exactly — the template ships with 3 fixed rows, but a real
// schedule can have anywhere from 1 to several, so a simple per-cell merge
// fill (fine for the fee-breakdown table, which never changes row count)
// can't represent it. Anchored on the section's own visible heading text
// plus the immediately-following <tbody>, not any custom marker — those
// are the only parts of this specific block guaranteed to survive being
// opened in the Writer (whose TipTap schema recognizes headings and table
// structure, but has no mark/highlight extension to preserve a custom
// data-* anchor).
function replaceInstallmentScheduleRows(html, installmentRows, totalLabel) {
  if (!installmentRows?.length) return html;
  const headingIndex = html.indexOf("Payment Schedule</h2>");
  if (headingIndex === -1) return html;
  const tbodyOpenIndex = html.indexOf("<tbody", headingIndex);
  if (tbodyOpenIndex === -1) return html;
  const tbodyOpenEnd = html.indexOf(">", tbodyOpenIndex);
  if (tbodyOpenEnd === -1) return html;
  const tbodyContentStart = tbodyOpenEnd + 1;
  const tbodyCloseIndex = html.indexOf("</tbody>", tbodyContentStart);
  if (tbodyCloseIndex === -1) return html;

  const rowsHtml = installmentRows
    .map((row) => `<tr><td>${escapeHtml(row.label)}</td><td>${escapeHtml(row.amount)}</td><td>${escapeHtml(row.due)}</td></tr>`)
    .join("");
  const totalRowHtml = `<tr><td><strong>Total</strong></td><td><strong>${escapeHtml(totalLabel)}</strong></td><td></td></tr>`;
  return `${html.slice(0, tbodyContentStart)}${rowsHtml}${totalRowHtml}${html.slice(tbodyCloseIndex)}`;
}

function replaceRetainerFeeRowValue(html, labelPattern, value) {
  const pattern = new RegExp(`(<tr><td>${labelPattern}<\\/td><td>).*?(<\\/td><\\/tr>)`, "i");
  return html.replace(pattern, (_match, prefix, suffix) => `${prefix}${escapeHtml(value)}${suffix}`);
}

// When a draft that already contained schedule-generated numbers is synced
// after a discount changes, placeholder-only merging is not enough: the
// former tax and total are no longer placeholders. Refresh only the known
// schedule-owned rows in the fee table. Administrative and courier rows
// remain untouched because they are consultant-entered values.
function syncRetainerFeeBreakdown(html, scheduleContext) {
  const headingIndex = html.indexOf("Payment Schedule</h2>");
  const splitAt = headingIndex === -1 ? html.length : headingIndex;
  let feeSection = html.slice(0, splitAt);
  const suffix = html.slice(splitAt);
  feeSection = replaceRetainerFeeRowValue(feeSection, "Professional Fees", scheduleContext.values["agreement.professionalFees"]);
  feeSection = replaceRetainerFeeRowValue(feeSection, "Government Fees \\(Biometrics, Permits, etc\\.\\)", scheduleContext.values["agreement.governmentFees"]);
  feeSection = replaceRetainerFeeRowValue(feeSection, "Applicable Taxes \\(professional fees\\)", scheduleContext.values["agreement.taxes"]);
  feeSection = feeSection.replace(
    /(<tr><td><strong>Total<\/strong><\/td><td><strong>).*?(<\/strong><\/td><\/tr>)/i,
    (_match, prefix, suffix) => `${prefix}${escapeHtml(scheduleContext.values["agreement.totalFees"])}${suffix}`,
  );

  const discountRowPattern = /<tr><td>Discount<\/td><td>.*?<\/td><\/tr>/i;
  if (scheduleContext.hasDiscount) {
    const discountRow = `<tr><td>Discount</td><td>-${escapeHtml(scheduleContext.discountLabel)}</td></tr>`;
    if (discountRowPattern.test(feeSection)) feeSection = feeSection.replace(discountRowPattern, discountRow);
    else {
      const professionalRow = /(<tr><td>Professional Fees<\/td><td>.*?<\/td><\/tr>)/i;
      if (professionalRow.test(feeSection)) feeSection = feeSection.replace(professionalRow, (_match, row) => `${row}${discountRow}`);
      else feeSection += `<p><strong>Discount:</strong> -${escapeHtml(scheduleContext.discountLabel)}</p>`;
    }
  } else {
    feeSection = feeSection.replace(discountRowPattern, "");
  }
  return `${feeSection}${suffix}`;
}

// Applies a case's payment schedule to a retainer's content: fills in
// whichever fee-breakdown fields (professional/government fees, tax,
// total) are still showing their blank placeholder, and rebuilds the
// Payment Schedule table to list the schedule's real installments. Safe to
// call on a document that already has some of this filled in by hand —
// applyResolvedMergeValues only ever touches a field still showing "[Add
// X]"; the installment table is the one part that's always rebuilt
// wholesale, since representing a different number of installments means
// the row count itself has to change.
export function applyScheduleToRetainerHtml(html, scheduleContext) {
  if (!scheduleContext) return html;
  const { html: withFees } = applyResolvedMergeValues(html, scheduleContext.values);
  const withDiscount = syncRetainerFeeBreakdown(withFees, scheduleContext);
  return replaceInstallmentScheduleRows(withDiscount, scheduleContext.installmentRows, scheduleContext.totalLabel);
}

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
  // isRetainerTemplate scopes this to the one Agreement template meant to
  // stand in for "the retainer" — without it, this picked whichever
  // isSystemDefault, general-tagged Agreement template sorted first
  // alphabetically (e.g. "Additional Services / Retainer Amendment" beating
  // an agency's actual retainer template), which was wrong.
  const templates = await prisma.correspondenceTemplate.findMany({
    where: { agencyId, isActive: true, kind: "Agreement", isSystemDefault: true, isRetainerTemplate: true },
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

// Produces the same merged retainer HTML the create action will save, while
// remaining read-only. When the case has no schedule yet the proposed rows
// are fully validated and priced (including discount and tax) in memory;
// neither a WrittenDocument nor a CasePaymentSchedule is created here.
export async function previewCaseBillingRetainer(req, res) {
  requireRetainerApprover(req);
  const caseItem = await scopedCase(req, req.params.caseId);
  const alreadyExists = await prisma.writtenDocument.findFirst({
    where: {
      agencyId: req.user.agencyId,
      caseId: caseItem.id,
      correspondenceKind: "Agreement",
    },
    select: { id: true },
  });
  if (alreadyExists) {
    throw createHttpError(
      409,
      "This case already has a retainer.",
      "RETAINER_EXISTS",
    );
  }

  const { template } = await resolveRetainerTemplate(
    req.user.agencyId,
    caseItem.caseType,
  );
  if (!template) {
    throw createHttpError(
      409,
      "No retainer template is available yet — ask an administrator to add one in Settings.",
      "NO_TEMPLATE",
    );
  }

  const context = await getCorrespondenceContext(
    req.user.agencyId,
    caseItem.id,
    req.user.id,
  );
  const rendered = renderCorrespondenceHtml(template.contentHtml, context);
  let scheduleContext;
  if (Object.prototype.hasOwnProperty.call(req.body || {}, "installments")) {
    scheduleContext = await previewRetainerScheduleMergeContext(
      req.user.agencyId,
      {
        signingDate: req.body?.signingDate,
        installments: req.body?.installments,
        discountAmount: req.body?.discountAmount,
      },
    );
  } else {
    scheduleContext = await getRetainerScheduleMergeContext(
      req.user.agencyId,
      caseItem.id,
    );
  }

  const preview = {
    title: `${template.title} — ${caseItem.client.fullName}`,
    contentHtml: applyScheduleToRetainerHtml(rendered.html, scheduleContext),
    headerText: context.agency?.name || null,
    footerText:
      [context.agency?.email, context.agency?.phone]
        .filter(Boolean)
        .join(" · ") || null,
  };
  res.json({
    data: {
      ...preview,
      reviewToken: createRetainerReviewToken(
        req,
        caseItem.id,
        template.id,
        preview,
      ),
    },
  });
}

// Creates the case's retainer draft from the resolved system template — the
// Billing-tab equivalent of correspondenceController's createCorrespondenceDraft,
// scoped to Agreement-kind documents only so Billing-tab-only staff (who may
// not have Agreements & Letters access) can start a retainer without that
// broader permission.
//
// If the case already has a payment schedule, or the request body includes
// installments a consultant just reviewed and approved (the schedule
// builder the Billing tab shows inline when a case has no schedule yet),
// the retainer's fee and payment-schedule sections are filled in from it
// immediately instead of being left as blank placeholders. The document is
// deliberately created before the schedule: fireInstallment holds real
// invoicing back for any case with a not-yet-Finalized retainer, and that
// guard only works if the retainer already exists by the time the
// schedule's own catch-up invoicing runs.
export async function createCaseBillingRetainerDraft(req, res) {
  requireRetainerApprover(req);
  const caseItem = await scopedCase(req, req.params.caseId);
  const alreadyExists = await prisma.writtenDocument.findFirst({ where: { agencyId: req.user.agencyId, caseId: caseItem.id, correspondenceKind: "Agreement" }, select: { id: true } });
  if (alreadyExists) throw createHttpError(409, "This case already has a retainer.", "RETAINER_EXISTS");
  const { template } = await resolveRetainerTemplate(req.user.agencyId, caseItem.caseType);
  if (!template) throw createHttpError(409, "No retainer template is available yet — ask an administrator to add one in Settings.", "NO_TEMPLATE");

  const context = await getCorrespondenceContext(req.user.agencyId, caseItem.id, req.user.id);
  const rendered = renderCorrespondenceHtml(template.contentHtml, context);
  const title = `${template.title} — ${caseItem.client.fullName}`;
  const existingScheduleContext = await getRetainerScheduleMergeContext(
    req.user.agencyId,
    caseItem.id,
  );
  let reviewedScheduleContext = existingScheduleContext;
  if (
    !reviewedScheduleContext
    && Object.prototype.hasOwnProperty.call(req.body || {}, "installments")
  ) {
    reviewedScheduleContext = await previewRetainerScheduleMergeContext(
      req.user.agencyId,
      {
        signingDate: req.body?.signingDate,
        installments: req.body?.installments,
        discountAmount: req.body?.discountAmount,
      },
    );
  }
  requireMatchingRetainerReview(req, caseItem.id, template.id, {
    title,
    contentHtml: applyScheduleToRetainerHtml(
      rendered.html,
      reviewedScheduleContext,
    ),
    headerText: context.agency?.name || null,
    footerText:
      [context.agency?.email, context.agency?.phone]
        .filter(Boolean)
        .join(" · ") || null,
  });
  let data = await prisma.writtenDocument.create({
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

  let scheduleContext = existingScheduleContext;
  if (!scheduleContext && Array.isArray(req.body?.installments) && req.body.installments.length) {
    try {
      await createCaseSchedule(req.user.agencyId, {
        caseId: caseItem.id,
        signingDate: req.body.signingDate,
        installments: req.body.installments,
        discountAmount: req.body.discountAmount,
        actorUserId: req.user.id,
      });
    } catch (error) {
      // The retainer and its schedule were requested as one action — a
      // schedule that fails validation shouldn't leave a half-created,
      // blank-payment-fields retainer behind for staff to find later.
      await prisma.writtenDocument.delete({ where: { id: data.id } }).catch(() => {});
      throw error;
    }
    scheduleContext = await getRetainerScheduleMergeContext(req.user.agencyId, caseItem.id);
  }

  if (scheduleContext) {
    const updatedHtml = applyScheduleToRetainerHtml(data.contentHtml, scheduleContext);
    if (updatedHtml !== data.contentHtml) {
      data = await prisma.writtenDocument.update({ where: { id: data.id }, data: { contentHtml: updatedHtml }, include: documentInclude });
    }
  }

  await recordActivity({ agencyId: req.user.agencyId, userId: req.user.id, clientId: caseItem.clientId, caseId: caseItem.id, action: "correspondence.draft_created", details: `${data.title} created from ${template.title}` });
  res.status(201).json({ data: { source: "existing", document: data, template: null, isGeneralFallback: false } });
}

// "Sync from payment schedule" — re-applies the case's current payment
// schedule to an already-created retainer, for a schedule that didn't
// exist yet when the retainer was drafted, or that's changed since. Only
// ever fills a field still showing its blank placeholder, or rebuilds the
// Payment Schedule table to match the schedule's installments — never
// touches anything staff already typed into the document by hand.
export async function syncCaseBillingRetainerWithSchedule(req, res) {
  const caseItem = await scopedCase(req, req.params.caseId);
  const existing = await prisma.writtenDocument.findFirst({
    where: { agencyId: req.user.agencyId, caseId: caseItem.id, correspondenceKind: "Agreement" },
    orderBy: { updatedAt: "desc" },
    include: documentInclude,
  });
  if (!existing) throw createHttpError(404, "This case has no retainer draft yet.", "NOT_FOUND");
  if (["Issued", "Signed", "Finalized"].includes(existing.correspondenceStatus)) {
    throw createHttpError(409, "Issued and signed documents are locked. Create a new draft to make changes.", "DOCUMENT_LOCKED");
  }
  const scheduleContext = await getRetainerScheduleMergeContext(req.user.agencyId, caseItem.id);
  if (!scheduleContext) throw createHttpError(409, "This case has no payment schedule yet — set one up first.", "NO_SCHEDULE");

  const updatedHtml = applyScheduleToRetainerHtml(existing.contentHtml, scheduleContext);
  let data = existing;
  if (updatedHtml !== existing.contentHtml) {
    data = await prisma.writtenDocument.update({ where: { id: existing.id }, data: { contentHtml: updatedHtml, updatedById: req.user.id }, include: documentInclude });
    await recordActivity({ agencyId: req.user.agencyId, userId: req.user.id, clientId: caseItem.clientId, caseId: caseItem.id, action: "correspondence.synced_from_schedule", details: `${data.title} updated from the case's payment schedule` });
  }
  res.json({ data: { source: "existing", document: data, template: null, isGeneralFallback: false } });
}

// Removes only an unissued retainer draft so staff can recover from choosing
// the wrong agreement/template. The case's payment schedule and every billing
// record remain intact; a newly selected retainer can reuse that schedule.
export async function resetCaseBillingRetainer(req, res) {
  if (!["admin", "consultant"].includes(req.user.role)) {
    throw createHttpError(
      403,
      "Only a consultant or administrator can reset a retainer draft.",
      "FORBIDDEN",
    );
  }
  const caseItem = await scopedCase(req, req.params.caseId);
  const documentId = String(req.body?.documentId || "").trim();
  if (!documentId) {
    throw createHttpError(
      400,
      "Choose the retainer draft to reset.",
      "VALIDATION_ERROR",
    );
  }
  const existing = await prisma.writtenDocument.findFirst({
    where: {
      id: documentId,
      agencyId: req.user.agencyId,
      caseId: caseItem.id,
      correspondenceKind: "Agreement",
    },
    include: {
      clientDocument: { select: { id: true, storageKey: true } },
      issuedClientDocument: { select: { id: true, storageKey: true } },
    },
  });
  if (!existing) {
    throw createHttpError(404, "Retainer draft not found.", "NOT_FOUND");
  }
  if (
    !["Draft", "Saved", "ReadyToIssue"].includes(
      existing.correspondenceStatus,
    )
  ) {
    throw createHttpError(
      409,
      "Issued or signed retainers cannot be reset.",
      "DOCUMENT_LOCKED",
    );
  }

  const linkedDocuments = [
    existing.clientDocument,
    existing.issuedClientDocument,
  ].filter(Boolean);
  await prisma.$transaction(async (tx) => {
    const deleted = await tx.writtenDocument.deleteMany({
      where: {
        id: existing.id,
        agencyId: req.user.agencyId,
        caseId: caseItem.id,
        correspondenceStatus: { in: ["Draft", "Saved", "ReadyToIssue"] },
      },
    });
    if (deleted.count !== 1) {
      throw createHttpError(
        409,
        "This retainer changed and can no longer be reset.",
        "DOCUMENT_CHANGED",
      );
    }
    if (linkedDocuments.length) {
      await tx.clientDocument.deleteMany({
        where: {
          agencyId: req.user.agencyId,
          id: { in: linkedDocuments.map((item) => item.id) },
        },
      });
    }
  });
  await Promise.all(
    linkedDocuments
      .map((item) => item.storageKey)
      .filter(Boolean)
      .map((storageKey) => removeDocumentFile(storageKey).catch(() => {})),
  );
  await recordActivity({
    agencyId: req.user.agencyId,
    userId: req.user.id,
    clientId: caseItem.clientId,
    caseId: caseItem.id,
    action: "correspondence.retainer_reset",
    details: `${existing.title} reset so a new retainer template can be selected`,
  });

  const { template, isGeneralFallback } = await resolveRetainerTemplate(
    req.user.agencyId,
    caseItem.caseType,
  );
  res.json({
    data: {
      source: template ? "template" : "none",
      document: null,
      template: template
        ? {
            id: template.id,
            title: template.title,
            isSystemDefault: template.isSystemDefault,
          }
        : null,
      isGeneralFallback,
    },
  });
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
