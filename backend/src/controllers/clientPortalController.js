import path from "node:path";
import { randomUUID } from "node:crypto";
import prisma from "../services/prisma/client.js";
import { removeDocumentFile, requireDocumentFile, writeDocumentFile } from "../services/documentStorage.js";
import { createHttpError } from "../utils/http.js";
import { recordActivity } from "../utils/prismaCrud.js";
import { updateNormalizedQuestionnaireAssignment } from "../services/questionnaireAssignmentService.js";
import { getClientInvoicePdf } from "../services/caseInvoiceService.js";
import { getCaseSchedule } from "../services/paymentScheduleService.js";
import { buildClientBillingLedger } from "../services/accountStatementService.js";
import { resolveSectionRequirements } from "../modules/case-information/caseRequirementResolver.js";
import { resolveFreeConsultationEligibility } from "../services/bookingFreeConsultationService.js";

// Everything in this controller is scoped through the logged-in user's
// ClientUser link — the frontend never supplies client or agency ids.
async function linkedClient(req) {
  const link = await prisma.clientUser.findFirst({
    where: { agencyId: req.auth.agencyId, userId: req.auth.userId },
    include: { client: true },
    orderBy: { isPrimary: "desc" },
  });
  if (!link) throw createHttpError(404, "Client portal profile not found.", "NOT_FOUND");
  return link;
}

const STAGE_PROGRESS = {
  Lead: 5,
  Consultation: 15,
  "Retainer Pending": 25,
  "Documents Pending": 40,
  "Reviewing Documents": 60,
  "Application Preparing": 75,
  Submitted: 90,
  "Decision Received": 100,
  Closed: 100,
};

const CLIENT_DOCUMENT_STATUS = {
  Requested: "Required",
  Uploaded: "Uploaded",
  UnderReview: "Under Review",
  Approved: "Accepted",
  Finalized: "Accepted",
  ChangesRequested: "Needs Changes",
  NotRequired: "Not Required",
};

const money = (value) => Math.round(Number(value || 0) * 100) / 100;

// --- Questionnaires -------------------------------------------------------
// Assignments live in CaseAssessment.formData.questionnaireAssignments and
// answers in formData.profileQuestionnaires / top-level collection keys —
// the same storage the staff case profile uses.

const CLIENT_FLAT_SECTIONS = new Set(["applicantIdentity", "canadianStatus", "background", "sponsorship", "programDetails", "humanitarianCitizenship", "rehabilitation", "refugeeProtection"]);
const CLIENT_COLLECTION_SECTIONS = new Set(["addressHistory", "travelHistory", "activityHistory", "identityPermits", "dependantsAndChildren", "siblings", "parents"]);

// moduleSteps() step ids predate informationSectionCatalog.js's 16 canonical
// sectionKeys and don't share its naming — this maps the ones that overlap
// so publicAssignment() can ask caseRequirementResolver.js whether a step is
// actually relevant to this case's case type. Steps with no entry here
// (there are none today) fall back to "optional" rather than being hidden.
const STEP_ID_TO_SECTION_KEY = {
  applicantIdentity: "applicantDetails",
  canadianStatus: "canadianStatus",
  background: "backgroundAdmissibility",
  identityPermits: "identityPermits",
  addressHistory: "addressHistory",
  activityHistory: "activityHistory",
  travelHistory: "travelHistory",
  dependantsAndChildren: "children",
  siblings: "siblingDetails",
  parents: "parentDetails",
  sponsorship: "relationshipSponsorship",
  programDetails: "programDetails",
  humanitarianCitizenship: "humanitarianCitizenship",
  rehabilitation: "rehabilitation",
  refugeeProtection: "refugeeProtection",
};

function moduleSteps(moduleName) {
  const name = String(moduleName || "").toLowerCase();
  if (name.includes("applicant")) return [{ type: "flat", id: "applicantIdentity", label: "Applicant identity" }];
  if (name.includes("canadian status") || name.includes("immigration status")) return [{ type: "flat", id: "canadianStatus", label: "Canadian status" }];
  if (name.includes("background")) return [{ type: "flat", id: "background", label: "Background declarations" }];
  if (name.includes("identity") || name.includes("travel documents")) return [{ type: "collection", id: "identityPermits", label: "Identity & permits" }];
  if (name.includes("address") || name.includes("residence")) return [{ type: "collection", id: "addressHistory", label: "Address history" }];
  if (name.includes("personal history")) return [{ type: "collection", id: "activityHistory", label: "Activity history" }];
  if (name.includes("travel history")) return [{ type: "collection", id: "travelHistory", label: "Travel history" }];
  if (name.includes("family")) {
    return [
      { type: "collection", id: "dependantsAndChildren", label: "Dependants & children" },
      { type: "collection", id: "siblings", label: "Siblings" },
      { type: "collection", id: "parents", label: "Parents" },
    ];
  }
  if (name.includes("sponsor") || name.includes("relationship")) return [{ type: "flat", id: "sponsorship", label: "Relationship & sponsorship" }];
  if (name.includes("funds") || name.includes("purpose")) return [{ type: "flat", id: "programDetails", label: "Purpose, funds & program" }];
  if (name.includes("humanitarian") || name.includes("establishment") || name.includes("citizenship")) return [{ type: "flat", id: "humanitarianCitizenship", label: "Humanitarian & citizenship" }];
  if (name.includes("rehabilitation") || name.includes("court")) return [{ type: "flat", id: "rehabilitation", label: "Rehabilitation & court" }];
  if (name.includes("refugee") || name.includes("claim") || name.includes("protection")) return [{ type: "flat", id: "refugeeProtection", label: "Refugee claim & protection" }];
  return null;
}

const hasContent = (value) => {
  if (Array.isArray(value)) return value.some(hasContent);
  if (value && typeof value === "object") return Object.values(value).some(hasContent);
  return Boolean(String(value ?? "").trim());
};

function stepHasData(step, formData) {
  const source = step.type === "flat" ? (formData.profileQuestionnaires || {})[step.id] : formData[step.id];
  return hasContent(source);
}

function sharedAssignments(formData) {
  const assignments = Array.isArray(formData?.questionnaireAssignments) ? formData.questionnaireAssignments : [];
  return assignments.filter((item) => item?.sharing === "Shared");
}

function publicAssignment(assignment, formData, caseType) {
  const requirementByKey = new Map(resolveSectionRequirements(caseType).map((entry) => [entry.sectionKey, entry.level]));
  const modules = (assignment.modules || []).map((moduleName) => {
    const steps = moduleSteps(moduleName);
    return {
      name: moduleName,
      steps: steps
        ? steps
            .map((step) => ({
              ...step,
              completed: stepHasData(step, formData),
              requirementLevel: requirementByKey.get(STEP_ID_TO_SECTION_KEY[step.id]) || "optional",
            }))
            // Sections not_applicable to this case's case type never show —
            // a study-permit client never sees Siblings/Parents steps, for
            // example — while an unclassified case type resolves every
            // section to "optional" (see caseRequirementResolver.js's
            // fail-open default) so nothing is hidden by mistake.
            .filter((step) => step.requirementLevel !== "not_applicable")
        : null,
    };
  });
  const clientSteps = modules.flatMap((module) => module.steps || []);
  const uniqueSteps = [...new Map(clientSteps.map((step) => [step.id, step])).values()];
  return {
    id: assignment.id,
    name: assignment.name || assignment.applicationType,
    categoryTitle: assignment.categoryTitle || null,
    applicationType: assignment.applicationType || null,
    dueDate: assignment.dueDate || null,
    locked: Boolean(assignment.locked),
    submitted: assignment.status === "Submitted",
    submittedAt: assignment.submittedAt || null,
    updatedAt: assignment.updatedAt || assignment.assignedAt || null,
    modules,
    progress: { completed: uniqueSteps.filter((step) => step.completed).length, total: uniqueSteps.length },
  };
}

function sanitizeAnswers(value, depth = 0) {
  if (depth > 4) return null;
  if (Array.isArray(value)) return value.slice(0, 100).map((item) => sanitizeAnswers(item, depth + 1)).filter((item) => item !== null);
  if (value && typeof value === "object") {
    const entries = Object.entries(value).slice(0, 120)
      .filter(([key]) => /^[\w.-]{1,80}$/.test(key))
      .map(([key, item]) => [key, sanitizeAnswers(item, depth + 1)])
      .filter(([, item]) => item !== null);
    return Object.fromEntries(entries);
  }
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "string") return value.slice(0, 4000);
  return "";
}

async function caseAssessmentFor(req, caseId) {
  if (!caseId) return null;
  return prisma.caseAssessment.findFirst({ where: { agencyId: req.auth.agencyId, caseId } });
}

// --- Agreements / e-sign ---------------------------------------------------

const AGREEMENT_CLIENT_STATUS = { Issued: "Awaiting your signature", Signed: "Signed", Finalized: "Finalized" };

function publicAgreement(document) {
  return {
    id: document.id,
    title: document.title,
    kind: document.correspondenceKind,
    status: AGREEMENT_CLIENT_STATUS[document.correspondenceStatus] || document.correspondenceStatus,
    awaitingSignature: document.correspondenceStatus === "Issued",
    issuedAt: document.issuedAt,
    updatedAt: document.updatedAt,
    hasFile: Boolean(document.issuedClientDocumentId),
  };
}

function clientAgreementsWhere(req, clientId) {
  return {
    agencyId: req.auth.agencyId,
    clientId,
    correspondenceKind: "Agreement",
    correspondenceStatus: { in: ["Issued", "Signed", "Finalized"] },
    case: { deletedAt: null, archivedAt: null },
  };
}

const agreementSelect = { id: true, title: true, correspondenceKind: true, correspondenceStatus: true, issuedAt: true, updatedAt: true, issuedClientDocumentId: true };

const escapeHtml = (value) =>
  String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);

function signatureBlockHtml({ signerName, signedAt, signatureMethod = "typed", signatureImage = null }) {
  const formatted = new Intl.DateTimeFormat("en-CA", { dateStyle: "long", timeStyle: "short", timeZone: "UTC" }).format(signedAt);
  const signatureMark = signatureMethod === "drawn" && signatureImage
    ? `<img src="${signatureImage}" alt="Hand-drawn signature of ${escapeHtml(signerName)}" style="display:block;width:auto;max-width:320px;height:auto;max-height:120px;margin:12px 0 0;object-fit:contain;object-position:left center;" />`
    : `<p style="margin:12px 0 0;font-family:'Brush Script MT','Segoe Script','Snell Roundhand',cursive;font-size:34px;line-height:1.2;color:#0f172a;">${escapeHtml(signerName)}</p>`;
  return [
    '<div data-casedesk-signature="true" style="margin-top:48px;padding:20px 24px;border:1px solid #cbd5e1;border-radius:14px;background:#f8fafc;page-break-inside:avoid;">',
    '<p style="margin:0;font-size:11px;letter-spacing:.18em;text-transform:uppercase;color:#64748b;font-weight:700;">Electronically signed</p>',
    signatureMark,
    `<p style="margin:8px 0 0;font-size:13px;color:#334155;font-weight:600;">${escapeHtml(signerName)}</p>`,
    `<p style="margin:2px 0 0;font-size:12px;color:#64748b;">Signed electronically via the CaseDesk client portal on ${escapeHtml(formatted)} (UTC).</p>`,
    "</div>",
  ].join("");
}

function drawnSignatureImage(value) {
  if (typeof value !== "string" || value.length > 600_000) throw createHttpError(400, "Draw your signature inside the signature box.", "INVALID_SIGNATURE");
  const match = value.match(/^data:image\/png;base64,([A-Za-z0-9+/]+={0,2})$/);
  if (!match) throw createHttpError(400, "The drawn signature image is invalid.", "INVALID_SIGNATURE");
  const buffer = Buffer.from(match[1], "base64");
  const pngHeader = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (buffer.length < pngHeader.length || buffer.length > 400_000 || !buffer.subarray(0, pngHeader.length).equals(pngHeader)) {
    throw createHttpError(400, "The drawn signature image is invalid.", "INVALID_SIGNATURE");
  }
  return `data:image/png;base64,${buffer.toString("base64")}`;
}

function agreementDocumentHtml({ title, headerText, contentHtml, footerText }) {
  return [
    "<!doctype html><html><head><meta charset=\"utf-8\" /><meta name=\"viewport\" content=\"width=device-width, initial-scale=1\" />",
    `<title>${escapeHtml(title)}</title>`,
    "<style>body{margin:0;background:#f1f5f9;} .casedesk-page{max-width:760px;margin:0 auto;padding:32px 24px 48px;background:#ffffff;min-height:100vh;box-sizing:border-box;font-family:Georgia,'Times New Roman',serif;color:#0f172a;font-size:15px;line-height:1.7;} .casedesk-meta{font-family:Arial,Helvetica,sans-serif;color:#64748b;font-size:12px;} img{max-width:100%;} table{max-width:100%;}</style>",
    "</head><body><div class=\"casedesk-page\">",
    headerText ? `<p class="casedesk-meta" style="margin:0 0 20px;border-bottom:1px solid #e2e8f0;padding-bottom:12px;">${escapeHtml(headerText)}</p>` : "",
    contentHtml || "<p style=\"color:#64748b;\">This document has no content preview. Contact your consultant for a copy.</p>",
    footerText ? `<p class="casedesk-meta" style="margin:32px 0 0;border-top:1px solid #e2e8f0;padding-top:12px;">${escapeHtml(footerText)}</p>` : "",
    "</div></body></html>",
  ].join("");
}

function publicDocument(document) {
  return {
    id: document.id,
    name: document.documentName,
    description: document.clientInstructions || null,
    status: CLIENT_DOCUMENT_STATUS[document.status] || "Required",
    uploadedFileName: document.originalFilename || null,
    uploadedAt: document.receivedAt,
    reviewedAt: document.reviewedAt,
    updatedAt: document.updatedAt,
    clientVisibleNote: document.clientInstructions || null,
  };
}

// The numbers come from the unified client ledger. This attaches the small
// set of display fields shared by the portal home and Payments page.
function withPaymentDisplay(summary, agency) {
  const status = summary.status === "Refunded" ? "Refunded" : summary.totalFee === 0 ? "No Fee Recorded" : summary.status === "Paid" ? "Paid" : summary.status === "Partial" ? "Partially Paid" : "Not Paid";
  return {
    totalFee: money(summary.totalFee),
    paidAmount: money(summary.paidAmount),
    balance: money(summary.balance),
    status,
    currency: agency?.defaultCurrency || "CAD",
    nextDueDate: null,
  };
}

function paymentSummaryFromLedger(ledger) {
  const fullyRefunded = ledger.summary.totalPayments > 0
    && ledger.summary.totalRefunds >= ledger.summary.totalPayments
    && ledger.summary.closingBalance <= 0;
  return {
    totalFee: ledger.summary.totalCharges,
    paidAmount: ledger.summary.netCollected,
    balance: Math.max(0, ledger.summary.closingBalance),
    status: fullyRefunded
      ? "Refunded"
      : ledger.summary.closingBalance <= 0 && ledger.summary.totalCharges > 0
        ? "Paid"
        : ledger.summary.netCollected > 0
          ? "Partial"
          : "Unpaid",
  };
}

function nextActionFor({ caseItem, documents, payment, assessment, agreements }) {
  const missing = documents.filter((item) => item.status === "Requested");
  const changesRequested = documents.filter((item) => item.status === "ChangesRequested");
  const underReview = documents.filter((item) => ["Uploaded", "UnderReview"].includes(item.status));
  const awaitingSignature = (agreements || []).filter((item) => item.correspondenceStatus === "Issued");
  const pendingQuestionnaires = sharedAssignments(assessment?.formData || {}).filter((item) => !item.locked && item.status !== "Submitted");

  if (!caseItem) {
    return { type: "none", title: "No active application", reason: "Your consultant has not opened an application file yet. Contact them if you believe this is a mistake.", dueDate: null, documentId: null, actionUrl: null };
  }
  if (caseItem.stage === "Closed" || caseItem.status === "Closed") {
    return { type: "closed", title: "Case completed", reason: "This application file is closed. Contact your consultant if you need anything else.", dueDate: null, documentId: null, actionUrl: null };
  }
  if (awaitingSignature.length) {
    const agreement = awaitingSignature[0];
    return { type: "agreement", title: `Review and sign: ${agreement.title}`, reason: "We need your signature before work on your file can continue.", dueDate: null, documentId: null, actionUrl: "/client-portal/documents" };
  }
  if (caseItem.stage === "Retainer Pending") {
    return { type: "agreement", title: "Review and sign your service agreement", reason: "We need your signed agreement before work on your file can continue.", dueDate: null, documentId: null, actionUrl: "/client-portal/help" };
  }
  if (payment.balance > 0 && payment.paidAmount === 0 && ["Consultation", "Retainer Pending", "Documents Pending"].includes(caseItem.stage)) {
    return { type: "payment", title: "Complete your pending payment", reason: "A payment is due before we can continue preparing your file.", dueDate: null, documentId: null, actionUrl: "/client-portal/payments" };
  }
  if (pendingQuestionnaires.length) {
    const assignment = pendingQuestionnaires[0];
    return { type: "questionnaire", title: `Complete your ${assignment.name || assignment.applicationType} questionnaire`, reason: "Your answers give us the information we need before preparing your documents.", dueDate: assignment.dueDate || null, documentId: null, actionUrl: "/client-portal/questionnaires" };
  }
  if (changesRequested.length) {
    const doc = changesRequested[0];
    return { type: "document", title: `Re-upload ${doc.documentName}`, reason: doc.clientInstructions || "Your consultant asked for changes to this document.", dueDate: null, documentId: doc.id, actionUrl: "/client-portal/documents" };
  }
  if (missing.length) {
    const doc = missing[0];
    return { type: "document", title: `Upload ${doc.documentName}`, reason: doc.clientInstructions || `Your ${doc.documentName.toLowerCase()} is required before we can continue preparing your file.`, dueDate: null, documentId: doc.id, actionUrl: "/client-portal/documents" };
  }
  if (underReview.length) {
    return { type: "waiting", title: "Waiting for review", reason: "Your documents were received and are being reviewed. We will let you know if anything else is needed.", dueDate: null, documentId: null, actionUrl: null };
  }
  if (caseItem.stage === "Application Preparing" || caseItem.stage === "Reviewing Documents") {
    return { type: "waiting", title: "Your application is being prepared", reason: "Your consultant is working on your file. No action is needed from you right now.", dueDate: null, documentId: null, actionUrl: null };
  }
  if (caseItem.stage === "Submitted") {
    return { type: "submitted", title: "Application submitted — waiting for decision", reason: "Your application has been submitted. We will notify you as soon as there is an update.", dueDate: null, documentId: null, actionUrl: null };
  }
  if (caseItem.stage === "Decision Received") {
    return { type: "decision", title: "A decision has been received", reason: "Contact your consultant to review the decision on your application.", dueDate: null, documentId: null, actionUrl: "/client-portal/help" };
  }
  return { type: "none", title: "You're all caught up", reason: "There is nothing you need to do right now. We will let you know when something changes.", dueDate: null, documentId: null, actionUrl: null };
}

function buildTimeline({ caseItem, documents, invoices, assessment, agreements }) {
  const events = [];
  sharedAssignments(assessment?.formData || {}).forEach((assignment) => {
    if (assignment.assignedAt) events.push({ id: `questionnaire-${assignment.id}-assigned`, title: `Questionnaire assigned: ${assignment.name || assignment.applicationType}`, description: "Complete it from the Forms tab.", createdAt: assignment.assignedAt, type: "questionnaire" });
    if (assignment.status === "Submitted" && assignment.submittedAt) events.push({ id: `questionnaire-${assignment.id}-submitted`, title: `Questionnaire submitted: ${assignment.name || assignment.applicationType}`, description: "Your consultant will review your answers.", createdAt: assignment.submittedAt, type: "questionnaire" });
  });
  (agreements || []).forEach((agreement) => {
    if (agreement.issuedAt) events.push({ id: `agreement-${agreement.id}-issued`, title: `Sent for signature: ${agreement.title}`, description: "Review and sign it from the Documents tab.", createdAt: agreement.issuedAt, type: "agreement" });
    if (["Signed", "Finalized"].includes(agreement.correspondenceStatus)) events.push({ id: `agreement-${agreement.id}-signed`, title: `Signed: ${agreement.title}`, description: "Thank you — no further action needed.", createdAt: agreement.updatedAt, type: "agreement" });
  });
  if (caseItem) {
    events.push({ id: `case-${caseItem.id}-opened`, title: "Application file opened", description: caseItem.caseType, createdAt: caseItem.createdAt, type: "case" });
    if (caseItem.submittedAt) events.push({ id: `case-${caseItem.id}-submitted`, title: "Application submitted", description: "Your application was submitted for processing.", createdAt: caseItem.submittedAt, type: "case" });
    if (caseItem.decisionAt) events.push({ id: `case-${caseItem.id}-decision`, title: "Decision received", description: "Contact your consultant to review the outcome.", createdAt: caseItem.decisionAt, type: "case" });
  }
  documents.forEach((document) => {
    if (document.receivedAt) events.push({ id: `doc-${document.id}-received`, title: `Document received: ${document.documentName}`, description: "Uploaded and waiting for review.", createdAt: document.receivedAt, type: "document" });
    if (document.reviewedAt && ["Approved", "Finalized"].includes(document.status)) events.push({ id: `doc-${document.id}-accepted`, title: `Document accepted: ${document.documentName}`, description: "No further action needed for this document.", createdAt: document.reviewedAt, type: "document" });
    if (document.reviewedAt && document.status === "ChangesRequested") events.push({ id: `doc-${document.id}-changes`, title: `Changes requested: ${document.documentName}`, description: document.clientInstructions || "Please re-upload this document.", createdAt: document.reviewedAt, type: "document" });
  });
  (invoices || []).forEach((invoice) => {
    events.push({ id: `invoice-${invoice.id}-issued`, title: "Invoice issued", description: `$${money(invoice.amount).toFixed(2)} invoiced.`, createdAt: invoice.createdAt, type: "payment" });
    if (Number(invoice.balance) <= 0) events.push({ id: `invoice-${invoice.id}-paid`, title: "Payment received", description: `$${money(invoice.amount).toFixed(2)} paid in full.`, createdAt: invoice.updatedAt, type: "payment" });
  });
  return events.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, 25);
}

async function portalData(req) {
  const link = await linkedClient(req);
  const [agency, bookingSettings, caseItem, documents, agreements] = await Promise.all([
    prisma.agency.findUnique({
      where: { id: req.auth.agencyId },
      select: { name: true, email: true, phone: true, address: true, city: true, province: true, country: true, postalCode: true, logoUrl: true, paymentInstructions: true, defaultCurrency: true },
    }),
    prisma.bookingSettings.findUnique({
      where: { agencyId: req.auth.agencyId },
      select: { publicSlug: true, publicBookingEnabled: true, freeConsultationsEnabled: true, freeConsultationsPerContact: true },
    }),
    prisma.case.findFirst({
      where: { agencyId: req.auth.agencyId, clientId: link.clientId, deletedAt: null, archivedAt: null },
      orderBy: [{ status: "asc" }, { updatedAt: "desc" }],
      select: { id: true, caseType: true, stage: true, status: true, submittedAt: true, decisionAt: true, createdAt: true, updatedAt: true, assignedUser: { select: { fullName: true } } },
    }),
    prisma.clientDocument.findMany({
      where: { agencyId: req.auth.agencyId, clientId: link.clientId, visibility: "Client" },
      select: { id: true, documentName: true, status: true, clientInstructions: true, receivedAt: true, reviewedAt: true, originalFilename: true, updatedAt: true },
      orderBy: { updatedAt: "desc" },
    }),
    prisma.writtenDocument.findMany({
      where: clientAgreementsWhere(req, link.clientId),
      select: agreementSelect,
      orderBy: { updatedAt: "desc" },
    }),
  ]);
  const [assessment, billingLedger, invoices] = await Promise.all([
    caseItem ? caseAssessmentFor(req, caseItem.id) : null,
    buildClientBillingLedger({
      agencyId: req.auth.agencyId,
      client: link.client,
      currency: agency?.defaultCurrency || "CAD",
      defaultCurrency: agency?.defaultCurrency || "CAD",
      caseReferences: caseItem ? { [caseItem.id]: caseItem.caseType } : {},
      refreshQuickBooks: false,
    }),
    caseItem
      ? prisma.caseInvoice.findMany({
          where: { agencyId: req.auth.agencyId, caseId: caseItem.id },
          select: { id: true, amount: true, balance: true, status: true, createdAt: true, updatedAt: true },
          orderBy: { createdAt: "desc" },
        })
      : Promise.resolve([]),
  ]);
  const paymentSummary = paymentSummaryFromLedger(billingLedger);
  return { link, agency, bookingSettings, caseItem, documents, paymentSummary, invoices, agreements, assessment };
}

function agencyAddress(agency) {
  return [agency?.address, agency?.city, agency?.province, agency?.postalCode, agency?.country].filter(Boolean).join(", ") || null;
}

export async function getPortalOverview(req, res) {
  const { link, agency, bookingSettings, caseItem, documents, paymentSummary, invoices, agreements, assessment } = await portalData(req);
  const payment = withPaymentDisplay(paymentSummary, agency);
  const nameParts = String(link.client.fullName || "").trim().split(/\s+/);
  const shared = sharedAssignments(assessment?.formData || {});
  const freeSessionType = bookingSettings?.freeConsultationsEnabled
    ? await prisma.bookingSessionType.findFirst({
        where: { agencyId: req.auth.agencyId, isActive: true, durationMinutes: 15 },
        select: { id: true, name: true, durationMinutes: true },
        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      })
    : null;
  const freeEligibility = freeSessionType
    ? await resolveFreeConsultationEligibility(req.auth.agencyId, bookingSettings, {
        clientId: link.clientId,
        guestEmailNormalized: String(link.client.email || "").trim().toLowerCase() || null,
        durationMinutes: freeSessionType.durationMinutes,
      })
    : null;

  res.json({
    success: true,
    data: {
      client: {
        id: link.client.id,
        firstName: nameParts[0] || "there",
        lastName: nameParts.slice(1).join(" ") || null,
        fullName: link.client.fullName,
        email: link.client.email,
        phone: link.client.phone,
        address: link.client.address,
      },
      agency: {
        name: agency?.name || "Your consultant",
        email: agency?.email || null,
        phone: agency?.phone || null,
        address: agencyAddress(agency),
        logoUrl: agency?.logoUrl || null,
      },
      booking: {
        enabled: Boolean(
          bookingSettings?.publicBookingEnabled && bookingSettings?.publicSlug,
        ),
        path:
          bookingSettings?.publicBookingEnabled && bookingSettings?.publicSlug
            ? `/b/${encodeURIComponent(bookingSettings.publicSlug)}`
            : null,
        freeFollowUpOffer: freeEligibility?.eligible
          ? { sessionTypeId: freeSessionType.id, sessionName: freeSessionType.name, durationMinutes: 15 }
          : null,
      },
      case: caseItem
        ? {
            id: caseItem.id,
            caseType: caseItem.caseType,
            stage: caseItem.stage,
            status: caseItem.status,
            progressPercent: STAGE_PROGRESS[caseItem.stage] ?? 10,
            consultantName: caseItem.assignedUser?.fullName || null,
            lastUpdatedAt: caseItem.updatedAt,
          }
        : null,
      nextAction: nextActionFor({ caseItem, documents, payment, assessment, agreements }),
      documents: documents.map(publicDocument),
      payment,
      questionnaires: {
        assigned: shared.length,
        pending: shared.filter((item) => !item.locked && item.status !== "Submitted").length,
      },
      agreements: {
        total: agreements.length,
        awaitingSignature: agreements.filter((item) => item.correspondenceStatus === "Issued").length,
      },
      timeline: buildTimeline({ caseItem, documents, invoices, assessment, agreements }),
    },
  });
}

export async function getPortalDocuments(req, res) {
  const link = await linkedClient(req);
  const documents = await prisma.clientDocument.findMany({
    where: { agencyId: req.auth.agencyId, clientId: link.clientId, visibility: "Client" },
    select: { id: true, documentName: true, status: true, clientInstructions: true, receivedAt: true, reviewedAt: true, originalFilename: true, updatedAt: true },
    orderBy: [{ status: "asc" }, { updatedAt: "desc" }],
  });
  res.json({ success: true, data: documents.map(publicDocument) });
}

export async function getPortalPayments(req, res) {
  const link = await linkedClient(req);
  const [agency, caseItem, cases] = await Promise.all([
    prisma.agency.findUnique({
      where: { id: req.auth.agencyId },
      select: { paymentInstructions: true, defaultCurrency: true },
    }),
    prisma.case.findFirst({
      where: { agencyId: req.auth.agencyId, clientId: link.clientId, deletedAt: null, archivedAt: null },
      orderBy: [{ status: "asc" }, { updatedAt: "desc" }],
      select: { id: true },
    }),
    prisma.case.findMany({
      where: { agencyId: req.auth.agencyId, clientId: link.clientId },
      select: { id: true, caseType: true },
    }),
  ]);
  const currency = agency?.defaultCurrency || "CAD";
  const [invoices, schedule, ledger] = await Promise.all([
    prisma.caseInvoice.findMany({
      where: { agencyId: req.auth.agencyId, clientId: link.clientId },
      orderBy: { createdAt: "desc" },
    }),
    caseItem ? getCaseSchedule(req.auth.agencyId, caseItem.id).catch(() => null) : null,
    buildClientBillingLedger({
      agencyId: req.auth.agencyId,
      client: link.client,
      currency,
      defaultCurrency: currency,
      caseReferences: Object.fromEntries(cases.map((item) => [item.id, item.caseType])),
    }),
  ]);
  const paymentSummary = paymentSummaryFromLedger(ledger);
  res.json({
    success: true,
    data: {
      summary: {
        ...withPaymentDisplay(paymentSummary, agency),
        totalRefunds: money(ledger.summary.totalRefunds),
        netCollected: money(ledger.summary.netCollected),
      },
      instructions: agency?.paymentInstructions || null,
      syncWarning: ledger.syncWarning,
      schedule: schedule
        ? {
            signingDate: schedule.signingDate,
            installments: schedule.installments
              .filter((installment) => installment.status !== "Void")
              .map((installment) => ({
                id: installment.id,
                label: installment.label,
                paymentType: installment.paymentType,
                amount: money(installment.amount),
                triggerType: installment.triggerType,
                triggerStage: installment.triggerStage,
                triggerDaysAfterSigning: installment.triggerDaysAfterSigning,
                status: installment.status === "Invoicing" ? "Scheduled" : installment.status,
                invoice: installment.caseInvoice
                  ? {
                      invoiceNumber: installment.caseInvoice.qbInvoiceNumber,
                      status: installment.caseInvoice.status,
                      balance: money(installment.caseInvoice.balance),
                    }
                  : null,
              })),
          }
        : null,
      // A voided invoice (e.g. corrected via the staff "Void invoice"
      // action after a mistake) has nothing left for the client to act
      // on — it's replaced by whatever real invoice gets created next, if
      // any — so it's dropped here rather than shown with a stale balance
      // or a dead pay-now link.
      invoices: invoices.filter((invoice) => invoice.status !== "Void").map((invoice) => ({
        id: invoice.id,
        description: invoice.description,
        paymentType: invoice.paymentType,
        invoiceNumber: invoice.qbInvoiceNumber,
        amount: money(invoice.amount),
        balance: money(invoice.balance),
        status: invoice.status,
        dueDate: invoice.dueDate,
        createdAt: invoice.createdAt,
        payNowUrl: Number(invoice.balance) > 0 ? invoice.qbInvoiceLink || null : null,
      })),
      // This is the same unified account ledger used by the staff billing
      // view. It includes case fees, consultations, cash/e-transfer records,
      // QuickBooks allocations, credits, and refunds without double-counting.
      transactions: [...ledger.transactions].reverse(),
      history: [],
    },
  });
}

export async function getPortalAppointments(req, res) {
  const link = await linkedClient(req);
  const appointments = await prisma.appointment.findMany({
    where: { agencyId: req.auth.agencyId, clientId: link.clientId },
    select: {
      id: true,
      subject: true,
      purpose: true,
      description: true,
      startsAt: true,
      endsAt: true,
      status: true,
      confirmationStatus: true,
      location: true,
      locationMapsUrl: true,
      meetingMode: true,
      meetingUrl: true,
      meetingPhoneNumber: true,
      cancellationReason: true,
      cancelledAt: true,
      referenceCode: true,
      assignedTo: { select: { fullName: true } },
      sessionType: { select: { name: true } },
      paymentHold: { select: { amount: true, status: true, paymentMethod: true, qbInvoiceNumber: true, paidAt: true } },
    },
    orderBy: [{ startsAt: "desc" }, { createdAt: "desc" }],
  });
  const now = Date.now();
  const rows = appointments.map((item) => ({
    ...item,
    purpose: item.purpose || item.description || null,
    description: undefined,
    consultantName: item.assignedTo?.fullName || null,
    assignedTo: undefined,
    sessionTypeName: item.sessionType?.name || null,
    sessionType: undefined,
    payment: item.paymentHold
      ? {
          amount: money(item.paymentHold.amount),
          status: item.paymentHold.status,
          method: item.paymentHold.paymentMethod || null,
          invoiceNumber: item.paymentHold.qbInvoiceNumber || null,
          paidAt: item.paymentHold.paidAt || null,
        }
      : null,
    paymentHold: undefined,
  }));
  const upcoming = rows
    .filter((item) => item.status === "Scheduled" && new Date(item.endsAt).getTime() >= now)
    .sort((a, b) => new Date(a.startsAt) - new Date(b.startsAt));
  const history = rows
    .filter((item) => !upcoming.some((upcomingItem) => upcomingItem.id === item.id))
    .sort((a, b) => new Date(b.startsAt) - new Date(a.startsAt));
  res.json({ success: true, data: { upcoming, history, total: rows.length } });
}

export async function createPortalBookingSession(req, res) {
  const link = await linkedClient(req);
  const emailNormalized = String(link.client.email || "").trim().toLowerCase();
  if (!emailNormalized) {
    throw createHttpError(
      400,
      "Add an email address to your profile before booking an appointment.",
      "CLIENT_EMAIL_REQUIRED",
    );
  }

  const settings = await prisma.bookingSettings.findUnique({
    where: { agencyId: req.auth.agencyId },
    select: { publicSlug: true, publicBookingEnabled: true },
  });
  if (!settings?.publicBookingEnabled || !settings.publicSlug) {
    throw createHttpError(
      409,
      "Online appointment booking is not currently available.",
      "BOOKING_UNAVAILABLE",
    );
  }

  const now = new Date();
  const expiresAt = new Date(now.getTime() + 30 * 60_000);
  const verificationToken = randomUUID();
  await prisma.$transaction(async (tx) => {
    await tx.bookingVerificationCode.deleteMany({
      where: {
        agencyId: req.auth.agencyId,
        emailNormalized,
        expiresAt: { lt: now },
      },
    });
    await tx.bookingVerificationCode.create({
      data: {
        agencyId: req.auth.agencyId,
        emailNormalized,
        codeHash: randomUUID().replaceAll("-", ""),
        expiresAt,
        verifiedAt: now,
        verificationToken,
      },
    });
  });

  res.status(201).json({
    success: true,
    data: {
      path: `/b/${encodeURIComponent(settings.publicSlug)}`,
      verificationToken,
      expiresAt,
      client: {
        fullName: link.client.fullName,
        email: link.client.email,
        phone: link.client.phone,
      },
    },
  });
}

export async function downloadPortalInvoicePdf(req, res) {
  const link = await linkedClient(req);
  const { buffer, filename } = await getClientInvoicePdf(req.auth.agencyId, { clientId: link.clientId, invoiceId: req.params.invoiceId });
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.setHeader("Content-Length", buffer.length);
  res.send(buffer);
}

export async function getPortalTimeline(req, res) {
  const { caseItem, documents, invoices, assessment, agreements } = await portalData(req);
  res.json({ success: true, data: buildTimeline({ caseItem, documents, invoices, assessment, agreements }) });
}

export async function getPortalQuestionnaires(req, res) {
  const link = await linkedClient(req);
  const caseItem = await prisma.case.findFirst({
    where: { agencyId: req.auth.agencyId, clientId: link.clientId, deletedAt: null, archivedAt: null },
    orderBy: [{ status: "asc" }, { updatedAt: "desc" }],
    select: { id: true, caseType: true },
  });
  const assessment = caseItem ? await caseAssessmentFor(req, caseItem.id) : null;
  const formData = assessment?.formData || {};
  const answers = {
    flat: Object.fromEntries([...CLIENT_FLAT_SECTIONS].map((id) => [id, (formData.profileQuestionnaires || {})[id] || {}])),
    collections: Object.fromEntries([...CLIENT_COLLECTION_SECTIONS].map((id) => [id, formData[id] || {}])),
  };
  res.json({
    success: true,
    data: {
      caseType: caseItem?.caseType || null,
      assignments: sharedAssignments(formData).map((assignment) => publicAssignment(assignment, formData, caseItem?.caseType)),
      answers,
    },
  });
}

export async function savePortalQuestionnaireAnswers(req, res) {
  const link = await linkedClient(req);
  const type = req.body?.type === "collection" ? "collection" : "flat";
  const sectionId = String(req.body?.sectionId || "");
  const allowed = type === "flat" ? CLIENT_FLAT_SECTIONS : CLIENT_COLLECTION_SECTIONS;
  if (!allowed.has(sectionId)) throw createHttpError(400, "This section cannot be updated from the portal.", "VALIDATION_ERROR");
  if (!req.body?.values || typeof req.body.values !== "object" || JSON.stringify(req.body.values).length > 200_000) {
    throw createHttpError(400, "The submitted answers are invalid.", "VALIDATION_ERROR");
  }

  const caseItem = await prisma.case.findFirst({
    where: { agencyId: req.auth.agencyId, clientId: link.clientId, deletedAt: null, archivedAt: null },
    orderBy: [{ status: "asc" }, { updatedAt: "desc" }],
    select: { id: true },
  });
  const assessment = caseItem ? await caseAssessmentFor(req, caseItem.id) : null;
  if (!assessment) throw createHttpError(404, "No questionnaire is assigned to you yet.", "NOT_FOUND");

  const formData = assessment.formData || {};
  const editable = sharedAssignments(formData).some(
    (assignment) => !assignment.locked && (assignment.modules || []).some((moduleName) => (moduleSteps(moduleName) || []).some((step) => step.id === sectionId)),
  );
  if (!editable) throw createHttpError(403, "This section is not part of your assigned questionnaires.", "FORBIDDEN");

  const values = sanitizeAnswers(req.body.values) || {};
  const now = new Date().toISOString();
  const nextFormData = {
    ...formData,
    ...(type === "flat"
      ? { profileQuestionnaires: { ...(formData.profileQuestionnaires || {}), [sectionId]: values } }
      : { [sectionId]: values }),
    questionnaireAssignments: (formData.questionnaireAssignments || []).map((assignment) =>
      assignment.sharing === "Shared" && !assignment.locked && assignment.status !== "Submitted" && (assignment.modules || []).some((moduleName) => (moduleSteps(moduleName) || []).some((step) => step.id === sectionId))
        ? { ...assignment, status: "In progress", updatedAt: now }
        : assignment,
    ),
  };

  await prisma.caseAssessment.update({ where: { id: assessment.id }, data: { formData: nextFormData } });
  for (const assignment of nextFormData.questionnaireAssignments || []) {
    if (assignment.status === "In progress") {
      await updateNormalizedQuestionnaireAssignment({ assessmentId: assessment.id, sourceId: assignment.id, data: { status: "In progress", sourceData: assignment } });
    }
  }
  await recordActivity({ agencyId: req.auth.agencyId, userId: req.auth.userId, clientId: link.clientId, caseId: caseItem.id, action: "questionnaire.portal_updated", details: `Client updated questionnaire answers (${sectionId})` });
  res.json({ success: true, message: "Your answers were saved." });
}

export async function submitPortalQuestionnaire(req, res) {
  const link = await linkedClient(req);
  const caseItem = await prisma.case.findFirst({
    where: { agencyId: req.auth.agencyId, clientId: link.clientId, deletedAt: null, archivedAt: null },
    orderBy: [{ status: "asc" }, { updatedAt: "desc" }],
    select: { id: true },
  });
  const assessment = caseItem ? await caseAssessmentFor(req, caseItem.id) : null;
  if (!assessment) throw createHttpError(404, "Questionnaire not found.", "NOT_FOUND");

  const formData = assessment.formData || {};
  const assignments = Array.isArray(formData.questionnaireAssignments) ? formData.questionnaireAssignments : [];
  const target = assignments.find((assignment) => assignment.id === req.params.assignmentId && assignment.sharing === "Shared");
  if (!target) throw createHttpError(404, "Questionnaire not found.", "NOT_FOUND");
  if (target.locked) throw createHttpError(409, "This questionnaire is locked. Contact your consultant to make changes.", "QUESTIONNAIRE_LOCKED");

  const now = new Date().toISOString();
  const nextFormData = {
    ...formData,
    questionnaireAssignments: assignments.map((assignment) =>
      assignment.id === target.id ? { ...assignment, status: "Submitted", submittedAt: now, updatedAt: now } : assignment,
    ),
  };
  await prisma.caseAssessment.update({ where: { id: assessment.id }, data: { formData: nextFormData } });
  await updateNormalizedQuestionnaireAssignment({
    assessmentId: assessment.id,
    sourceId: target.id,
    data: { status: "Submitted", submittedAt: new Date(now), sourceData: nextFormData.questionnaireAssignments.find((item) => item.id === target.id) },
  });
  await recordActivity({ agencyId: req.auth.agencyId, userId: req.auth.userId, clientId: link.clientId, caseId: caseItem.id, action: "questionnaire.portal_submitted", details: `${target.name || target.applicationType} questionnaire submitted by client` });
  res.json({ success: true, message: "Questionnaire submitted. Your consultant will review your answers." });
}

export async function getPortalAgreements(req, res) {
  const link = await linkedClient(req);
  const agreements = await prisma.writtenDocument.findMany({
    where: clientAgreementsWhere(req, link.clientId),
    select: agreementSelect,
    orderBy: [{ correspondenceStatus: "desc" }, { updatedAt: "desc" }],
  });
  res.json({ success: true, data: agreements.map(publicAgreement) });
}

export async function getPortalAgreementView(req, res) {
  const link = await linkedClient(req);
  const agreement = await prisma.writtenDocument.findFirst({
    where: { id: req.params.id, ...clientAgreementsWhere(req, link.clientId) },
    select: { ...agreementSelect, contentHtml: true, headerText: true, footerText: true },
  });
  if (!agreement) throw createHttpError(404, "Agreement not found.", "NOT_FOUND");

  let signature = null;
  try {
    const signatureLog = await prisma.activityLog.findFirst({
      where: { agencyId: req.auth.agencyId, clientId: link.clientId, action: "correspondence.portal_signed", metadata: { path: ["writtenDocumentId"], equals: agreement.id } },
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

  res.json({
    success: true,
    data: {
      ...publicAgreement(agreement),
      hasPreview: Boolean(String(agreement.contentHtml || "").trim()),
      html: agreementDocumentHtml(agreement),
      signature,
    },
  });
}

export async function servePortalAgreementFile(req, res) {
  const link = await linkedClient(req);
  const agreement = await prisma.writtenDocument.findFirst({
    where: { id: req.params.id, ...clientAgreementsWhere(req, link.clientId) },
    select: { issuedClientDocumentId: true, title: true },
  });
  if (!agreement?.issuedClientDocumentId) throw createHttpError(404, "No file is available for this agreement.", "NOT_FOUND");
  const document = await prisma.clientDocument.findFirst({
    where: { id: agreement.issuedClientDocumentId, agencyId: req.auth.agencyId, clientId: link.clientId, visibility: "Client" },
    select: { storageKey: true, originalFilename: true, mimeType: true },
  });
  if (!document?.storageKey) throw createHttpError(404, "No file is available for this agreement.", "NOT_FOUND");
  const buffer = await requireDocumentFile(document.storageKey);
  const disposition = req.query.download === "1" ? "attachment" : "inline";
  if ((document.mimeType || "").includes("html")) res.setHeader("Content-Security-Policy", "sandbox");
  res.setHeader("Content-Disposition", `${disposition}; filename*=UTF-8''${encodeURIComponent(document.originalFilename || "agreement")}`);
  res.type(document.mimeType || "application/octet-stream");
  res.send(buffer);
}

export async function signPortalAgreement(req, res) {
  const link = await linkedClient(req);
  const signerName = String(req.body?.fullName || "").trim().replace(/\s+/g, " ").slice(0, 160);
  if (!signerName) throw createHttpError(400, "Type your full legal name to sign.", "VALIDATION_ERROR");
  if (req.body?.consent !== true) throw createHttpError(400, "You must agree to sign electronically.", "CONSENT_REQUIRED");
  const signatureMethod = req.body?.signatureMethod === "drawn" ? "drawn" : "typed";
  const signatureImage = signatureMethod === "drawn" ? drawnSignatureImage(req.body?.signatureImage) : null;

  const agreement = await prisma.writtenDocument.findFirst({
    where: {
      id: req.params.id,
      agencyId: req.auth.agencyId,
      clientId: link.clientId,
      correspondenceKind: "Agreement",
      case: { deletedAt: null, archivedAt: null },
    },
    select: { id: true, title: true, correspondenceStatus: true, caseId: true, contentHtml: true, headerText: true, footerText: true, issuedClientDocumentId: true },
  });
  if (!agreement) throw createHttpError(404, "Agreement not found.", "NOT_FOUND");
  if (agreement.correspondenceStatus !== "Issued") throw createHttpError(409, "This document is not awaiting your signature.", "NOT_SIGNABLE");

  const signedAt = new Date();
  // Stamp the signature into the document content itself so the signed
  // record is visible in the staff Writer and on the issued client file.
  const signedContentHtml = `${agreement.contentHtml || ""}${signatureBlockHtml({ signerName, signedAt, signatureMethod, signatureImage })}`;
  const signedFileHtml = agreementDocumentHtml({ ...agreement, contentHtml: signedContentHtml });
  const signedStorageKey = path.posix.join(req.auth.agencyId, agreement.caseId || `client-${link.clientId}`, `${randomUUID()}.html`);
  const signedFilename = `${String(agreement.title || "agreement").replace(/[^\w\s.-]/g, "").trim().slice(0, 120) || "agreement"} (signed).html`;
  const signedBuffer = Buffer.from(signedFileHtml, "utf8");

  const issuedDocument = agreement.issuedClientDocumentId
    ? await prisma.clientDocument.findFirst({
        where: { id: agreement.issuedClientDocumentId, agencyId: req.auth.agencyId, clientId: link.clientId },
        select: { id: true, storageKey: true },
      })
    : null;

  await writeDocumentFile(signedStorageKey, signedBuffer, "text/html");
  let committed = false;
  try {
    await prisma.$transaction(async (tx) => {
      const updated = await tx.writtenDocument.updateMany({
        where: {
          id: agreement.id,
          agencyId: req.auth.agencyId,
          clientId: link.clientId,
          correspondenceKind: "Agreement",
          correspondenceStatus: "Issued",
          case: { deletedAt: null, archivedAt: null },
        },
        data: { correspondenceStatus: "Signed", contentHtml: signedContentHtml },
      });
      if (updated.count !== 1) throw createHttpError(409, "This document changed while signing. Refresh and try again.", "AGREEMENT_CHANGED");
      if (issuedDocument) {
        await tx.clientDocument.update({
          where: { id: issuedDocument.id },
          data: {
            storageKey: signedStorageKey,
            originalFilename: signedFilename,
            mimeType: "text/html",
            fileSize: signedBuffer.length,
            receivedAt: signedAt,
          },
        });
      }
    });
    committed = true;
  } finally {
    if (!committed) await removeDocumentFile(signedStorageKey).catch(() => {});
  }
  if (issuedDocument?.storageKey && issuedDocument.storageKey !== signedStorageKey) {
    await removeDocumentFile(issuedDocument.storageKey).catch(() => {});
  }

  await recordActivity({
    agencyId: req.auth.agencyId,
    userId: req.auth.userId,
    clientId: link.clientId,
    caseId: agreement.caseId,
    action: "correspondence.portal_signed",
    details: `${agreement.title} signed electronically by ${signerName}`,
    metadata: { writtenDocumentId: agreement.id, signerName, signedAt: signedAt.toISOString(), consent: true, signatureMethod },
  });
  res.json({ success: true, message: "Signed. Thank you — your consultant has been notified." });
}

export async function updatePortalProfile(req, res) {
  const link = await linkedClient(req);
  const phone = String(req.body?.phone ?? link.client.phone ?? "").trim().slice(0, 40) || null;
  const address = String(req.body?.address ?? link.client.address ?? "").trim().slice(0, 300) || null;
  const client = await prisma.client.update({
    where: { id: link.clientId },
    data: { phone, address },
    select: { id: true, fullName: true, email: true, phone: true, address: true, dateOfBirth: true },
  });
  await recordActivity({ agencyId: req.auth.agencyId, userId: req.auth.userId, clientId: link.clientId, action: "client.portal_profile_updated", details: "Client updated contact details from the portal" });
  res.json({ success: true, data: client, message: "Your details were updated." });
}
