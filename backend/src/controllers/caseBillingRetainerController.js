import prisma from "../services/prisma/client.js";
import { createHttpError } from "../utils/http.js";
import { recordActivity } from "../utils/prismaCrud.js";
import { applyResolvedMergeValues, ensureDefaultCorrespondenceTemplates, escapeHtml, getCorrespondenceContext, renderCorrespondenceHtml, templateMatchesCase } from "../services/correspondenceTemplateService.js";
import { createCaseSchedule, getRetainerScheduleMergeContext } from "../services/paymentScheduleService.js";
import { changeCorrespondenceStatus } from "./correspondenceController.js";
import { notifyRetainerIssued } from "../services/agreementNotificationService.js";

const documentInclude = {
  correspondenceTemplate: { select: { id: true, title: true, kind: true, category: true, versionNumber: true } },
  clientDocument: { select: { id: true, documentName: true, originalFilename: true, storageKey: true, updatedAt: true } },
  issuedClientDocument: { select: { id: true, documentName: true, originalFilename: true, storageKey: true, updatedAt: true } },
  updatedBy: { select: { id: true, fullName: true } },
  issuedBy: { select: { id: true, fullName: true } },
};

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
  const caseItem = await scopedCase(req, req.params.caseId);
  const alreadyExists = await prisma.writtenDocument.findFirst({ where: { agencyId: req.user.agencyId, caseId: caseItem.id, correspondenceKind: "Agreement" }, select: { id: true } });
  if (alreadyExists) throw createHttpError(409, "This case already has a retainer.", "RETAINER_EXISTS");
  const { template } = await resolveRetainerTemplate(req.user.agencyId, caseItem.caseType);
  if (!template) throw createHttpError(409, "No retainer template is available yet — ask an administrator to add one in Settings.", "NO_TEMPLATE");

  const context = await getCorrespondenceContext(req.user.agencyId, caseItem.id, req.user.id);
  const rendered = renderCorrespondenceHtml(template.contentHtml, context);
  const title = `${template.title} — ${caseItem.client.fullName}`;
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

  let scheduleContext = await getRetainerScheduleMergeContext(req.user.agencyId, caseItem.id);
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
