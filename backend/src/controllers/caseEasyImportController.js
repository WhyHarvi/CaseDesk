import ExcelJS from "exceljs";
import prisma from "../services/prisma/client.js";
import { createHttpError } from "../utils/http.js";
import { recordActivity } from "../utils/prismaCrud.js";
import { assertNoContactDuplicate, lockAgencyContactIntake } from "../services/contactDuplicateService.js";
import { normalizeEmail, normalizePhone } from "../modules/leads/lead.validation.js";
import { parseCsv } from "../modules/leads/lead.csv.js";
import { CASE_STAGES, isCaseStageAllowedForType } from "../constants/caseStages.js";
import { nextClientNumber } from "../services/clientNumberService.js";
import { mapCaseEasyStatus } from "../services/caseEasyStatusMapping.js";
import {
  classifyWorkbookHeaders,
  importCaseEasyExports,
  isUsableCaseEasyCaseType,
  materializeCaseEasyLastNotes,
  readSheetRowsFromWorkbook,
} from "../services/caseEasyImportService.js";
import {
  CASE_EASY_REPORT_DEFINITIONS,
  inferCaseEasyReportTypeFromFileName,
  importCaseEasyReport,
  materializeCaseEasyActivityNotes,
  refreshCaseEasyReportProductionLinks,
} from "../services/caseEasyReportImportService.js";
import { calculateCrsScore } from "./caseAssessmentController.js";
import { normalizeMaritalStatus } from "../services/clientProfileSyncService.js";
import { notifyCaseAssignment } from "../services/caseAssignmentNotificationService.js";
import {
  assignDefaultWorkflowToCase,
  canonicalCaseType,
} from "../services/workflowService.js";
import {
  buildCaseEasyContactSearchWhere,
  cleanCaseEasySearch,
} from "../services/caseEasySearchService.js";

const caseInclude = { resolvedAssignee: { select: { id: true, fullName: true } } };
const caseDetailInclude = {
  ...caseInclude,
  reportRows: {
    where: { uci: { not: null } },
    select: { uci: true },
    orderBy: { importedAt: "desc" },
    take: 1,
  },
};
const CONTACT_IMPORT_STATUSES = new Set(["imported", "reviewed", "converted"]);
const RECORD_TYPES = new Set(["client", "prospect", "undetermined"]);
const REPORT_LINK_STATUSES = new Set([
  "linked",
  "unlinked",
  "ambiguous",
  "standalone",
  "aggregate",
  "source_only",
]);
const CASE_STATUSES = new Set([
  "Open",
  "Active",
  "On Hold",
  "Completed",
  "Closed",
  "Cancelled",
  "Inactive",
]);
const TERMINAL_CASE_STATUSES = new Set([
  "Completed",
  "Closed",
  "Cancelled",
  "Inactive",
]);

async function loadWorkbook(file) {
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(file.buffer);
  } catch {
    const error = createHttpError(400, `${file.originalname} could not be read as an Excel workbook.`, "VALIDATION_ERROR");
    error.file = file.originalname;
    throw error;
  }
  return workbook;
}

// Classifies each uploaded file as a Contacts or Cases export by its
// headers (see classifyWorkbookHeaders) rather than requiring the caller
// to label which slot each file goes in — the upload UI is just a single
// drop zone. Accepts one file or both: the two exports don't have to
// arrive together (see importCaseEasyExports's resolution pass, which
// re-scans the agency's whole staging set every run, not just this
// batch — a Cases-only import today still links correctly once the
// matching Contacts file shows up later). Throws a descriptive error if
// classification is ambiguous or if two files turn out to be the same type.
async function classifyUploads(files) {
  if (!files || files.length === 0) {
    throw createHttpError(400, "Upload at least one file — a Contacts export, a Cases export, or both.", "VALIDATION_ERROR");
  }
  if (files.length > 2) {
    throw createHttpError(400, "Upload at most two files — a Contacts export and a Cases export.", "VALIDATION_ERROR");
  }

  const classified = await Promise.all(files.map(async (file) => {
    const workbook = await loadWorkbook(file);
    const { headers } = readSheetRowsFromWorkbook(workbook, file.originalname);
    const classification = classifyWorkbookHeaders(headers);
    return { file, workbook, ...classification };
  }));

  const ambiguousOrUnknown = classified.filter((entry) => entry.type === "ambiguous" || entry.type === "unknown");
  if (ambiguousOrUnknown.length) {
    throw createHttpError(
      422,
      `Couldn't tell what kind of Case Easy export ${ambiguousOrUnknown.map((entry) => entry.file.originalname).join(" or ")} is. Confirm this is a real Case Easy Contacts or Cases export.`,
      "CLASSIFICATION_FAILED",
    );
  }

  const contactsEntry = classified.find((entry) => entry.type === "contacts");
  const casesEntry = classified.find((entry) => entry.type === "cases");
  if (classified.length === 2 && (!contactsEntry || !casesEntry)) {
    throw createHttpError(
      422,
      `Both files look like ${classified[0].type} exports (${classified.map((entry) => entry.file.originalname).join(", ")}) — need one Contacts export and one Cases export.`,
      "CLASSIFICATION_FAILED",
    );
  }

  return {
    contactsWorkbook: contactsEntry?.workbook,
    contactsFileName: contactsEntry?.file.originalname ?? null,
    casesWorkbook: casesEntry?.workbook,
    casesFileName: casesEntry?.file.originalname ?? null,
  };
}

async function runUploadedImport(req) {
  const agencyId = req.user.agencyId;
  const { contactsWorkbook, contactsFileName, casesWorkbook, casesFileName } = await classifyUploads(req.files);

  const prospectOrClientOverride = req.body.prospectOrClient;
  if (prospectOrClientOverride && !["client", "prospect"].includes(prospectOrClientOverride)) {
    throw createHttpError(400, 'prospectOrClient must be "client" or "prospect".', "VALIDATION_ERROR");
  }

  try {
    const result = await importCaseEasyExports({
      agencyId,
      contactsWorkbook,
      casesWorkbook,
      prospectOrClientOverride,
      apply: req.body.apply === true,
    });
    return { ...result, contactsFileName, casesFileName };
  } catch (error) {
    if (error.code === "TOGGLE_COLUMN_NOT_FOUND") throw createHttpError(422, error.message, error.code);
    if (error.code === "IMPORT_TOO_LARGE") throw createHttpError(400, error.message, error.code);
    throw error;
  }
}

// Preview only — classifies + parses both files and reports which file was
// detected as which export, row counts, parse errors, and a small sample
// of mapped rows so an admin can confirm everything read correctly before
// anything is written to the staging tables.
export async function previewCaseEasyImportUpload(req, res) {
  const result = await runUploadedImport(req);
  res.json({ data: result });
}

// Same parse, but commits: upserts into the staging tables and re-runs the
// join/assignee/record-type resolution pass, exactly like the CLI script's
// --apply mode.
export async function confirmCaseEasyImportUpload(req, res) {
  req.body.apply = true;
  const result = await runUploadedImport(req);
  await refreshCaseEasyReportProductionLinks(req.user.agencyId);
  await recordActivity({
    agencyId: req.user.agencyId,
    userId: req.user.id,
    action: "case_easy_import.uploaded",
    details: `Imported ${result.contactRowCount} contact row(s), ${result.caseRowCount} case row(s) from Case Easy export`,
  });
  res.status(201).json({ data: result });
}

export async function listCaseEasyImportContacts(req, res) {
  const agencyId = req.user.agencyId;
  const search = cleanCaseEasySearch(req.query.search);
  const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, Number.parseInt(req.query.limit, 10) || 25));
  if (req.query.recordType && !RECORD_TYPES.has(req.query.recordType)) {
    throw createHttpError(400, "recordType is invalid.", "VALIDATION_ERROR");
  }
  if (
    req.query.importStatus &&
    !CONTACT_IMPORT_STATUSES.has(req.query.importStatus)
  ) {
    throw createHttpError(400, "importStatus is invalid.", "VALIDATION_ERROR");
  }
  const where = {
    agencyId,
    ...(req.query.recordType
      ? {
          recordType:
            req.query.recordType === "undetermined"
              ? null
              : req.query.recordType,
        }
      : {}),
    ...(req.query.importStatus ? { importStatus: req.query.importStatus } : {}),
    ...(search ? buildCaseEasyContactSearchWhere(search) : {}),
  };
  const [contacts, total] = await Promise.all([
    prisma.caseEasyImportContact.findMany({
      where,
      include: {
        convertedClient: { select: { id: true, clientNumber: true } },
        linkedCases: { include: caseInclude, orderBy: { createdAt: "asc" } },
      },
      orderBy: [{ importedAt: "desc" }],
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.caseEasyImportContact.count({ where }),
  ]);
  res.json({ data: contacts, pagination: { page, limit, total, pages: Math.max(1, Math.ceil(total / limit)) } });
}

export async function listUnlinkedCaseEasyImportCases(req, res) {
  const search = cleanCaseEasySearch(req.query.search);
  const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, Number.parseInt(req.query.limit, 10) || 25));
  const terms = search.split(" ").filter(Boolean).slice(0, 8);
  const where = {
    agencyId: req.user.agencyId,
    linkedContactId: null,
    importStatus: { not: "converted" },
    ...(terms.length
      ? {
          AND: terms.map((term) => ({
            OR: [
              { caseNumber: { contains: term, mode: "insensitive" } },
              { clientIdentifier: { contains: term, mode: "insensitive" } },
              { firstName: { contains: term, mode: "insensitive" } },
              { lastName: { contains: term, mode: "insensitive" } },
              { email: { contains: term, mode: "insensitive" } },
              { phone: { contains: term, mode: "insensitive" } },
              { otherEmails: { contains: term, mode: "insensitive" } },
              { companyName: { contains: term, mode: "insensitive" } },
            ],
          })),
        }
      : {}),
  };
  const [cases, total] = await Promise.all([
    prisma.caseEasyImportCase.findMany({
      where,
      include: caseInclude,
      orderBy: [{ importedAt: "desc" }, { createdAt: "desc" }],
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.caseEasyImportCase.count({ where }),
  ]);
  res.json({ data: cases, pagination: { page, limit, total, pages: Math.max(1, Math.ceil(total / limit)) } });
}

// Every real CaseDesk case ever produced by a Case Easy conversion, across
// every contact and upload — the one place to confirm none of this
// historical data quietly ended up active, and to find/reopen a specific
// one if a client turns out to need it worked again.
export async function listImportedCases(req, res) {
  const agencyId = req.user.agencyId;
  const search = cleanCaseEasySearch(req.query.search);
  const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, Number.parseInt(req.query.limit, 10) || 25));
  const terms = search.split(" ").filter(Boolean).slice(0, 8);
  const where = {
    agencyId,
    deletedAt: null,
    caseEasyImportCases: { some: {} },
    ...(terms.length
      ? {
          AND: terms.map((term) => ({
            OR: [
              { caseType: { contains: term, mode: "insensitive" } },
              { client: { fullName: { contains: term, mode: "insensitive" } } },
              { client: { clientNumber: { contains: term, mode: "insensitive" } } },
            ],
          })),
        }
      : {}),
  };
  const [cases, total] = await Promise.all([
    prisma.case.findMany({
      where,
      select: {
        id: true,
        caseType: true,
        stage: true,
        status: true,
        archivedAt: true,
        updatedAt: true,
        client: { select: { id: true, fullName: true, clientNumber: true } },
        caseEasyImportCases: { select: { caseNumber: true, status: true }, take: 1 },
      },
      orderBy: { updatedAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.case.count({ where }),
  ]);
  res.json({ data: cases, pagination: { page, limit, total, pages: Math.max(1, Math.ceil(total / limit)) } });
}

async function readReportSheet(file) {
  if (!file) {
    throw createHttpError(
      400,
      "Choose a Case Easy report file.",
      "VALIDATION_ERROR",
    );
  }
  if (file.originalname.toLowerCase().endsWith(".csv")) {
    const parsed = parseCsv(file.buffer.toString("utf8"));
    return {
      headers: parsed.headers,
      rows: parsed.rows.map((raw, index) => ({
        rowNumber: index + 2,
        raw,
      })),
    };
  }
  const workbook = await loadWorkbook(file);
  return readSheetRowsFromWorkbook(workbook, file.originalname);
}

async function runReportImport(req, apply) {
  const reportType =
    String(req.body.reportType || "").trim() ||
    inferCaseEasyReportTypeFromFileName(req.file?.originalname) ||
    undefined;
  if (reportType && !CASE_EASY_REPORT_DEFINITIONS[reportType]) {
    throw createHttpError(400, "reportType is invalid.", "VALIDATION_ERROR");
  }
  try {
    const sheet = await readReportSheet(req.file);
    if (sheet.rows.length > 100_000) {
      throw createHttpError(
        400,
        "Case Easy report imports are limited to 100,000 rows per file.",
        "REPORT_TOO_LARGE",
      );
    }
    return await importCaseEasyReport({
      agencyId: req.user.agencyId,
      sheet,
      reportType,
      apply,
    });
  } catch (error) {
    if (["REPORT_TYPE_REQUIRED", "REPORT_COLUMNS_INVALID", "REPORT_EMPTY"].includes(error.code)) {
      throw createHttpError(422, error.message, error.code);
    }
    if (error.code === "REPORT_INCOMPLETE") {
      throw createHttpError(503, error.message, error.code);
    }
    throw error;
  }
}

export async function previewCaseEasyReportUpload(req, res) {
  res.json({ data: await runReportImport(req, false) });
}

export async function confirmCaseEasyReportUpload(req, res) {
  const result = await runReportImport(req, true);
  // Always attempted, not gated to reportType === "activity_tracker" — an
  // unrelated upload (e.g. a fresh Client Listing) can newly link
  // previously-unlinked activity_tracker rows too via the identifier
  // backfill this same import triggers, and materializeCaseEasyActivityNotes
  // is idempotent/cheap when there's nothing new to do.
  const noteStats = await materializeCaseEasyActivityNotes(req.user.agencyId);
  await recordActivity({
    agencyId: req.user.agencyId,
    userId: req.user.id,
    action: "case_easy_report.uploaded",
    details: `Imported ${result.rowCount} ${result.reportLabel} row(s) from Case Easy${noteStats.created ? ` — ${noteStats.created} note(s) added from Activity Tracker` : ""}`,
  });
  res.status(201).json({ data: { ...result, notesCreated: noteStats.created } });
}

// Manual, explicitly-triggered action — deliberately not run automatically
// against already-converted cases (only new conversions and new Activity
// Tracker uploads trigger note creation on their own). Lets an admin decide
// when to backfill notes for cases that were converted before this existed,
// or re-run after fixing a linking issue, rather than it happening as a
// surprise side effect of something else.
export async function syncCaseEasyNotes(req, res) {
  const agencyId = req.user.agencyId;
  const [lastNoteStats, activityStats] = await Promise.all([
    materializeCaseEasyLastNotes(agencyId),
    materializeCaseEasyActivityNotes(agencyId),
  ]);
  const created = lastNoteStats.created + activityStats.created;
  if (created) {
    await recordActivity({
      agencyId,
      userId: req.user.id,
      action: "case_easy_import.notes_synced",
      details: `${created} note(s) synced from Case Easy import data (${lastNoteStats.created} from converted cases' last note, ${activityStats.created} from Activity Tracker)`,
    });
  }
  res.json({ data: { lastNoteStats, activityStats, created } });
}

export async function listCaseEasyReportRows(req, res) {
  const reportType = String(req.query.reportType || "").trim();
  const linkStatus = String(req.query.linkStatus || "").trim();
  if (reportType && !CASE_EASY_REPORT_DEFINITIONS[reportType]) {
    throw createHttpError(400, "reportType is invalid.", "VALIDATION_ERROR");
  }
  if (linkStatus && !REPORT_LINK_STATUSES.has(linkStatus)) {
    throw createHttpError(400, "linkStatus is invalid.", "VALIDATION_ERROR");
  }
  const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
  const limit = Math.min(
    100,
    Math.max(1, Number.parseInt(req.query.limit, 10) || 25),
  );
  const where = {
    agencyId: req.user.agencyId,
    ...(reportType ? { reportType } : {}),
    ...(linkStatus === "standalone"
      ? { linkStatus: "unlinked", importStatus: "reviewed" }
      : linkStatus === "unlinked"
        ? { linkStatus: "unlinked", importStatus: "imported" }
        : linkStatus
          ? { linkStatus }
          : {}),
  };
  const [rows, total] = await Promise.all([
    prisma.caseEasyImportReportRow.findMany({
      where,
      include: {
        linkedContact: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            convertedClientId: true,
          },
        },
        linkedImportCase: {
          select: { id: true, caseNumber: true, convertedCaseId: true },
        },
      },
      orderBy: [{ importedAt: "desc" }, { createdAt: "desc" }],
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.caseEasyImportReportRow.count({ where }),
  ]);
  res.json({
    data: {
      rows,
      pagination: {
        page,
        limit,
        total,
        pages: Math.max(1, Math.ceil(total / limit)),
      },
    },
  });
}

export async function getCaseEasyReportSummary(req, res) {
  const [byType, byLinkStatus] = await Promise.all([
    prisma.caseEasyImportReportRow.groupBy({
      by: ["reportType"],
      where: { agencyId: req.user.agencyId },
      _count: { _all: true },
    }),
    prisma.caseEasyImportReportRow.groupBy({
      by: ["linkStatus", "importStatus"],
      where: { agencyId: req.user.agencyId },
      _count: { _all: true },
    }),
  ]);
  res.json({
    data: {
      reportTypes: Object.entries(CASE_EASY_REPORT_DEFINITIONS).map(
        ([type, definition]) => ({
          type,
          label: definition.label,
          count:
            byType.find((entry) => entry.reportType === type)?._count._all || 0,
        }),
      ),
      linkStatuses: {
        linked: byLinkStatus
          .filter((entry) => entry.linkStatus === "linked")
          .reduce((sum, entry) => sum + entry._count._all, 0),
        ambiguous: byLinkStatus
          .filter((entry) => entry.linkStatus === "ambiguous")
          .reduce((sum, entry) => sum + entry._count._all, 0),
        unlinked: byLinkStatus
          .filter(
            (entry) =>
              entry.linkStatus === "unlinked" &&
              entry.importStatus !== "reviewed",
          )
          .reduce((sum, entry) => sum + entry._count._all, 0),
        standalone: byLinkStatus
          .filter(
            (entry) =>
              entry.linkStatus === "unlinked" &&
              entry.importStatus === "reviewed",
          )
          .reduce((sum, entry) => sum + entry._count._all, 0),
        aggregate: byLinkStatus
          .filter((entry) => entry.linkStatus === "aggregate")
          .reduce((sum, entry) => sum + entry._count._all, 0),
        sourceOnly: byLinkStatus
          .filter((entry) => entry.linkStatus === "source_only")
          .reduce((sum, entry) => sum + entry._count._all, 0),
      },
    },
  });
}

export async function getCaseEasyReportsForClient(req, res) {
  const client = await prisma.client.findFirst({
    where: { id: req.params.clientId, agencyId: req.user.agencyId },
    select: { id: true },
  });
  if (!client) throw createHttpError(404, "Client not found.");
  const rows = await prisma.caseEasyImportReportRow.findMany({
    where: {
      agencyId: req.user.agencyId,
      OR: [
        { linkedClientId: client.id },
        {
          linkedClientId: null,
          linkedContact: { convertedClientId: client.id },
        },
      ],
    },
    orderBy: [{ reportType: "asc" }, { importedAt: "desc" }],
    take: 250,
  });
  res.json({ data: rows });
}

export async function getCaseEasyReportsForCase(req, res) {
  const caseRecord = await prisma.case.findFirst({
    where: { id: req.params.caseId, agencyId: req.user.agencyId },
    select: { id: true },
  });
  if (!caseRecord) throw createHttpError(404, "Case not found.");
  const rows = await prisma.caseEasyImportReportRow.findMany({
    where: {
      agencyId: req.user.agencyId,
      OR: [
        { linkedCaseId: caseRecord.id },
        { linkedCaseId: null, linkedImportCase: { convertedCaseId: caseRecord.id } },
      ],
    },
    orderBy: [{ reportType: "asc" }, { importedAt: "desc" }],
    take: 250,
  });
  res.json({ data: rows });
}

export async function getCaseEasyImportContact(req, res) {
  const agencyId = req.user.agencyId;
  const contact = await prisma.caseEasyImportContact.findFirst({
    where: { id: req.params.id, agencyId },
    include: { linkedCases: { include: caseDetailInclude, orderBy: { createdAt: "asc" } } },
  });
  if (!contact) throw createHttpError(404, "Import contact not found.");

  const suggestedCases = contact.linkedCases.map((kase) => ({
    caseEasyImportCaseId: kase.id,
    ...mapCaseEasyStatus(kase.status),
  }));

  res.json({ data: { contact, suggestedCases } });
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function resolveImportedCaseType(caseInputType, stagingCaseType) {
  const selected = isUsableCaseEasyCaseType(caseInputType)
    ? String(caseInputType).trim()
    : "";
  const imported = isUsableCaseEasyCaseType(stagingCaseType)
    ? String(stagingCaseType).trim()
    : "";
  return canonicalCaseType(selected || imported);
}

// Deliberately more lenient than contactDuplicateService.js's
// normalizeContact(), which is meant for staff typing in a *new* lead and
// should reject a malformed number outright. Case Easy's historical data
// can include phone numbers that don't pass strict NANP validation (e.g.
// exchange codes like "123" that were never a real assignable exchange —
// likely old placeholder/test entries) — that shouldn't block converting
// an otherwise legitimate client. The raw value is always kept on the
// client record; only the normalized/dedup-matching value is dropped when
// it doesn't validate.
function normalizeContactForConversion({ phone, email }) {
  const cleanPhone = phone === undefined || phone === null ? null : String(phone).trim() || null;
  const cleanEmail = email === undefined || email === null ? null : String(email).trim() || null;

  let phoneNormalized = null;
  if (cleanPhone) {
    try { phoneNormalized = normalizePhone(cleanPhone); } catch { /* keep the raw phone, see comment above */ }
  }
  let emailNormalized = null;
  if (cleanEmail) {
    try { emailNormalized = normalizeEmail(cleanEmail); } catch { /* keep the raw email */ }
  }

  return { phone: cleanPhone, phoneNormalized, email: cleanEmail, emailNormalized };
}

export async function convertCaseEasyImportContact(req, res) {
  const agencyId = req.user.agencyId;
  const contact = await prisma.caseEasyImportContact.findFirst({
    where: { id: req.params.id, agencyId },
    include: { linkedCases: { include: { reportRows: { where: { uci: { not: null } }, select: { uci: true }, orderBy: { importedAt: "desc" }, take: 1 } } } },
  });
  if (!contact) throw createHttpError(404, "Import contact not found.");

  const casesInput = Array.isArray(req.body.cases) ? req.body.cases : [];
  const linkedCaseById = new Map(contact.linkedCases.map((kase) => [kase.id, kase]));

  // A contact can already be a real client while still having *new* cases
  // — e.g. a Cases export uploaded after the contact was converted. See
  // resolveLinks in caseEasyImportService.js: it links newly-imported cases
  // to already-converted contacts on every run (so the match still shows up
  // here), but nothing had previously created the real Case for them. So an
  // already-converted contact isn't blocked outright — only blocked once
  // there's genuinely nothing new to attach to the existing client.
  const alreadyConverted = contact.importStatus === "converted";
  const hasConvertibleCases = casesInput.some((caseInput) => {
    const stagingCase = linkedCaseById.get(caseInput.caseEasyImportCaseId);
    return stagingCase && stagingCase.importStatus !== "converted";
  });
  if (alreadyConverted && !hasConvertibleCases) {
    throw createHttpError(409, "This contact has already been converted.", "ALREADY_CONVERTED");
  }

  for (const caseInput of casesInput) {
    const stagingCase = linkedCaseById.get(caseInput.caseEasyImportCaseId);
    if (!stagingCase || stagingCase.importStatus === "converted") continue;
    const suggested = mapCaseEasyStatus(stagingCase.status);
    const caseType = resolveImportedCaseType(
      caseInput.caseType,
      stagingCase.caseType,
    );
    if (!caseType) {
      throw createHttpError(
        400,
        "Case type is required for every selected imported case.",
        "VALIDATION_ERROR",
      );
    }
    const stage = caseInput.stage || suggested.stage;
    const status = caseInput.status || suggested.status;
    if (!CASE_STAGES.includes(stage)) {
      throw createHttpError(400, "A selected case stage is invalid.", "VALIDATION_ERROR");
    }
    // A case can't be created directly at Decision Received — that stage
    // requires a real case_decisions record (outcome, permit expiry or
    // refusal resolution), enforced by a DB trigger, which imported Case
    // Easy data never captured. Use Closed instead; it's already this
    // case's final status/stage regardless.
    if (stage === "Decision Received") {
      throw createHttpError(
        400,
        "Decision Received isn't available for imported cases — Case Easy's export has no decision-outcome details to record. Choose Closed instead.",
        "VALIDATION_ERROR",
      );
    }
    if (!isCaseStageAllowedForType(caseType, stage)) {
      throw createHttpError(
        400,
        "A selected case stage does not apply to that case type.",
        "VALIDATION_ERROR",
      );
    }
    if (!CASE_STATUSES.has(status)) {
      throw createHttpError(400, "A selected case status is invalid.", "VALIDATION_ERROR");
    }
    if (
      !TERMINAL_CASE_STATUSES.has(status) &&
      !String(caseInput.nextAction || "").trim()
    ) {
      throw createHttpError(
        400,
        "Next action is required for every open imported case.",
        "VALIDATION_ERROR",
      );
    }
    for (const field of ["submittedAt", "decisionAt"]) {
      if (
        caseInput[field] &&
        Number.isNaN(new Date(caseInput[field]).getTime())
      ) {
        throw createHttpError(
          400,
          `${field} is invalid.`,
          "VALIDATION_ERROR",
        );
      }
    }
  }

  let fullName, givenNames, familyName, dateOfBirth, contactNormalized;
  let clientInput = {};
  if (!alreadyConverted) {
    clientInput = isPlainObject(req.body.client) ? req.body.client : {};
    const structuredNameProvided = Object.hasOwn(clientInput, "givenNames") || Object.hasOwn(clientInput, "familyName");
    const explicitFullName = String(clientInput.fullName || "").trim();
    givenNames = structuredNameProvided ? String(clientInput.givenNames || "").trim() || null : explicitFullName ? null : String(contact.firstName || "").trim() || null;
    familyName = structuredNameProvided ? String(clientInput.familyName || "").trim() || null : explicitFullName ? null : String(contact.lastName || "").trim() || null;
    fullName = structuredNameProvided
      ? [givenNames, familyName].filter(Boolean).join(" ")
      : explicitFullName || [givenNames, familyName].filter(Boolean).join(" ");
    if (!fullName) throw createHttpError(400, "Client full name is required.", "VALIDATION_ERROR");

    dateOfBirth = clientInput.dateOfBirth ? new Date(clientInput.dateOfBirth) : contact.dateOfBirth;
    if (dateOfBirth && Number.isNaN(dateOfBirth.getTime())) throw createHttpError(400, "Date of birth is invalid.", "VALIDATION_ERROR");
    contactNormalized = normalizeContactForConversion({
      phone: clientInput.phone ?? contact.phone,
      email: clientInput.email ?? contact.email,
    });
  }
  const importedMaritalStatusValue =
    clientInput.maritalStatus ??
    casesInput.find((caseInput) => caseInput.maritalStatus)?.maritalStatus ??
    contact.maritalStatus;
  const importedMaritalStatus = normalizeMaritalStatus(
    importedMaritalStatusValue,
  );
  if (
    String(importedMaritalStatusValue || "").trim() &&
    !importedMaritalStatus
  ) {
    throw createHttpError(400, "Marital status is invalid.", "VALIDATION_ERROR");
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`
        SELECT "id"
        FROM "case_easy_import_contacts"
        WHERE "id" = ${contact.id} AND "agency_id" = ${agencyId}
        FOR UPDATE
      `;
      const lockedContact = await tx.caseEasyImportContact.findUnique({
        where: { id: contact.id },
        select: { importStatus: true, convertedClientId: true },
      });
      if (!lockedContact) {
        throw createHttpError(404, "Import contact not found.");
      }
      if (!alreadyConverted && lockedContact.importStatus === "converted") {
        throw createHttpError(
          409,
          "This contact has already been converted.",
          "ALREADY_CONVERTED",
        );
      }

      let client;
      if (alreadyConverted) {
        client = await tx.client.findUnique({ where: { id: lockedContact.convertedClientId } });
        if (!client) throw createHttpError(409, "The client this contact was converted to no longer exists.", "CLIENT_NOT_FOUND");
      } else {
        await lockAgencyContactIntake(tx, agencyId);
        // Converting a Case Easy contact previously had no duplicate check
        // at all against Clients (only an incidental P2002 catch on the DB
        // unique constraint, after the insert already failed) and none
        // whatsoever against Leads. Run the same phone/email dedup every
        // other client-creation path in the app already runs, so converting
        // at volume doesn't multiply the duplicates CD-002/CD-013 already
        // flagged elsewhere.
        await assertNoContactDuplicate(tx, {
          agencyId,
          phoneNormalized: contactNormalized.phoneNormalized,
          emailNormalized: contactNormalized.emailNormalized,
        });
        const clientNumber = await nextClientNumber(tx, agencyId);
        client = await tx.client.create({
          data: {
            agencyId,
            clientNumber,
            fullName,
            givenNames,
            familyName,
            ...contactNormalized,
            dateOfBirth,
            maritalStatus: importedMaritalStatus,
            address: clientInput.address || null,
            preferredLanguage: clientInput.preferredLanguage || null,
            status: "Active",
          },
        });
      }
      if (!client.maritalStatus && importedMaritalStatus) {
        client = await tx.client.update({
          where: { id: client.id },
          data: { maritalStatus: importedMaritalStatus },
        });
      }

      const createdCases = [];
      for (const caseInput of casesInput) {
        const stagingCase = linkedCaseById.get(caseInput.caseEasyImportCaseId);
        // Only ever convert cases this contact is actually linked to — a
        // request can't smuggle in an unrelated staging case id.
        if (!stagingCase || stagingCase.importStatus === "converted") continue;
        const lockedStagingCase = await tx.caseEasyImportCase.findUnique({
          where: { id: stagingCase.id },
          select: { importStatus: true },
        });
        if (lockedStagingCase?.importStatus === "converted") continue;
        const caseType = resolveImportedCaseType(caseInput.caseType, stagingCase.caseType);
        if (!caseType) continue;

        const suggested = mapCaseEasyStatus(stagingCase.status);
        // Deliberately never assigned to anyone — imported cases land
        // archived/view-only, and a real RCIC/case worker only ever gets
        // attached later as a separate, manual decision from the normal
        // case UI, not as part of the import. Case Easy's own "Assignees"
        // text stays visible as reference only (resolvedAssigneeUserId on
        // the staging row, shown next to the raw text in the review UI).
        const newCase = await tx.case.create({
          data: {
            agencyId,
            clientId: client.id,
            caseType,
            stage: caseInput.stage || suggested.stage,
            status: caseInput.status || suggested.status,
            priority: caseInput.priority || "Normal",
            assignedUserId: null,
            additionalAssignedUserIds: [],
            nextAction: caseInput.nextAction || null,
            submittedAt: caseInput.submittedAt ? new Date(caseInput.submittedAt) : stagingCase.submitted,
            decisionAt: caseInput.decisionAt ? new Date(caseInput.decisionAt) : stagingCase.approved || stagingCase.refused || null,
            openedAt: stagingCase.opened || null,
            archivedAt: (caseInput.archived ?? suggested.archived) ? new Date() : null,
          },
        });
        // Case Easy's Cases export only ever carries a single "last note" per
        // case (no author, no history) — this is the one piece of narrative
        // note content recoverable from that export, so it's copied over
        // honestly: real historical date, no fabricated author. userId stays
        // null (Note.userId is nullable) rather than crediting whoever
        // happens to run the conversion — the UI already shows "Team note"
        // for an author-less note.
        // materializeCaseEasyLastNotes may already have attached this exact
        // note to the client (it doesn't wait on case conversion — see that
        // function) before this specific case ever got converted. Re-link
        // that existing note onto the new case instead of creating a
        // second, duplicate copy of the same text.
        let importedNoteId = stagingCase.materializedNoteId;
        if (importedNoteId) {
          await tx.note.updateMany({ where: { id: importedNoteId, caseId: null }, data: { caseId: newCase.id } });
        } else if (String(stagingCase.lastNote || "").trim()) {
          const importedNote = await tx.note.create({
            data: {
              agencyId,
              clientId: client.id,
              caseId: newCase.id,
              content: `Imported from Case Easy — last recorded note, dated ${(stagingCase.lastNoteDate || stagingCase.modified || newCase.createdAt).toISOString().slice(0, 10)}:\n\n${stagingCase.lastNote.trim()}`,
              createdAt: stagingCase.lastNoteDate || stagingCase.modified || newCase.createdAt,
              userId: null,
              clientVisible: false,
            },
          });
          importedNoteId = importedNote.id;
        }

        // UCI remains case-scoped. Marital status is copied from the
        // canonical client profile into each case assessment so official
        // forms and questionnaires reuse the same answer.
        const uci =
          caseInput.uci ??
          stagingCase.reportRows?.[0]?.uci ??
          contact.uci;
        const maritalStatus = client.maritalStatus || importedMaritalStatus;
        const formData = {};
        if (uci) formData.profileQuestionnaires = { canadianStatus: { uci } };
        if (maritalStatus) formData.profile = { maritalStatus };
        const { score, breakdown } = calculateCrsScore(formData);
        await tx.caseAssessment.create({
          data: { agencyId, clientId: client.id, caseId: newCase.id, formData, crsScore: score, crsBreakdown: breakdown },
        });
        await assignDefaultWorkflowToCase(tx, {
          agencyId,
          caseId: newCase.id,
          caseType: newCase.caseType,
        });

        await tx.caseEasyImportCase.update({ where: { id: stagingCase.id }, data: { importStatus: "converted", convertedCaseId: newCase.id, materializedNoteId: importedNoteId } });
        await tx.caseEasyImportReportRow.updateMany({
          where: { agencyId, linkedImportCaseId: stagingCase.id },
          data: { linkedCaseId: newCase.id, linkedClientId: client.id },
        });
        createdCases.push(newCase);
      }

      if (!alreadyConverted) {
        await tx.caseEasyImportContact.update({ where: { id: contact.id }, data: { importStatus: "converted", convertedClientId: client.id } });
      }

      await tx.caseEasyImportReportRow.updateMany({
        where: { agencyId, linkedContactId: contact.id },
        data: { linkedClientId: client.id },
      });

      return { client, cases: createdCases };
    });

    await recordActivity({
      agencyId,
      userId: req.user.id,
      clientId: result.client.id,
      action: "case_easy_import.converted",
      details: alreadyConverted
        ? `${result.cases.length} additional case${result.cases.length === 1 ? "" : "s"} imported from Case Easy for ${result.client.fullName}`
        : `${result.client.fullName} converted from Case Easy import data (${result.cases.length} case${result.cases.length === 1 ? "" : "s"})`,
    });

    await Promise.all(result.cases.map((caseItem) => notifyCaseAssignment({
      agencyId,
      caseItem,
      clientName: result.client.fullName,
      actorUserId: req.auth.userId,
      source: "Imported from Case Easy",
    })));

    res.status(201).json({ data: result });
  } catch (error) {
    if (error.code === "P2002") throw createHttpError(409, "A client with this phone or email already exists in CaseDesk.", "DUPLICATE_CONTACT");
    throw error;
  }
}

function caseEasyContactDisplayName(contact) {
  return [contact.firstName, contact.lastName].filter(Boolean).join(" ") || contact.email || contact.phone || contact.id;
}

// One-at-a-time-only conversion was the largest gap the QA report flagged
// (3,793 legacy records, no bulk path). This is deliberately NOT a shared
// refactor of convertCaseEasyImportContact above — it's a separate,
// fully-automatic path that always takes CaseDesk's suggested stage/status
// (mapCaseEasyStatus) for every unconverted linked case rather than
// per-case manual overrides, since a human isn't reviewing each one. Every
// contact converts (or fails) independently inside its own transaction, so
// one bad record in a batch never blocks the rest — the response is a
// results summary, not a single pass/fail.
export async function bulkConvertCaseEasyImportContacts(req, res) {
  const agencyId = req.user.agencyId;
  const contactIds = [...new Set(Array.isArray(req.body.contactIds) ? req.body.contactIds.map(String).filter(Boolean) : [])].slice(0, 200);
  if (!contactIds.length) throw createHttpError(400, "Select at least one contact to convert.", "VALIDATION_ERROR");

  const contacts = await prisma.caseEasyImportContact.findMany({
    where: { id: { in: contactIds }, agencyId },
    include: {
      linkedCases: {
        include: { reportRows: { where: { uci: { not: null } }, select: { uci: true }, orderBy: { importedAt: "desc" }, take: 1 } },
      },
    },
  });
  const foundIds = new Set(contacts.map((contact) => contact.id));

  const results = [];
  for (const contactId of contactIds) {
    if (!foundIds.has(contactId)) {
      results.push({ contactId, name: contactId, status: "failed", message: "Import contact not found." });
    }
  }

  for (const contact of contacts) {
    const name = caseEasyContactDisplayName(contact);
    if (contact.importStatus === "converted") {
      results.push({ contactId: contact.id, name, status: "already_converted" });
      continue;
    }

    const unconvertedCases = contact.linkedCases.filter((stagingCase) => stagingCase.importStatus !== "converted");
    const plannedCases = unconvertedCases
      .map((stagingCase) => {
        const caseType = resolveImportedCaseType(null, stagingCase.caseType);
        const suggested = mapCaseEasyStatus(stagingCase.status);
        return { stagingCase, caseType, stage: suggested.stage, status: suggested.status, archived: suggested.archived };
      })
      .filter((planned) => planned.caseType && CASE_STAGES.includes(planned.stage) && isCaseStageAllowedForType(planned.caseType, planned.stage) && CASE_STATUSES.has(planned.status));
    const skippedCaseCount = unconvertedCases.length - plannedCases.length;

    if (unconvertedCases.length > 0 && plannedCases.length === 0) {
      results.push({
        contactId: contact.id,
        name,
        status: "failed",
        message: "No imported cases have a valid case type — review this contact and choose the correct type manually.",
      });
      continue;
    }

    if (!name.trim()) {
      results.push({ contactId: contact.id, name, status: "failed", message: "No name on file — needs manual review before conversion." });
      continue;
    }

    const contactNormalized = normalizeContactForConversion({ phone: contact.phone, email: contact.email });
    const maritalStatus = normalizeMaritalStatus(contact.maritalStatus) || null;

    try {
      const result = await prisma.$transaction(async (tx) => {
        await tx.$queryRaw`
          SELECT "id"
          FROM "case_easy_import_contacts"
          WHERE "id" = ${contact.id} AND "agency_id" = ${agencyId}
          FOR UPDATE
        `;
        const lockedContact = await tx.caseEasyImportContact.findUnique({ where: { id: contact.id }, select: { importStatus: true } });
        if (!lockedContact) throw createHttpError(404, "Import contact not found.", "NOT_FOUND");
        if (lockedContact.importStatus === "converted") throw createHttpError(409, "This contact has already been converted.", "ALREADY_CONVERTED");

        await lockAgencyContactIntake(tx, agencyId);
        await assertNoContactDuplicate(tx, {
          agencyId,
          phoneNormalized: contactNormalized.phoneNormalized,
          emailNormalized: contactNormalized.emailNormalized,
        });

        const clientNumber = await nextClientNumber(tx, agencyId);
        const client = await tx.client.create({
          data: {
            agencyId,
            clientNumber,
            fullName: name,
            givenNames: contact.firstName || null,
            familyName: contact.lastName || null,
            ...contactNormalized,
            dateOfBirth: contact.dateOfBirth,
            maritalStatus,
            status: "Active",
          },
        });

        const createdCases = [];
        for (const planned of plannedCases) {
          const lockedStagingCase = await tx.caseEasyImportCase.findUnique({ where: { id: planned.stagingCase.id }, select: { importStatus: true } });
          if (lockedStagingCase?.importStatus === "converted") continue;

          // Deliberately never assigned — see the identical note in
          // convertCaseEasyImportContact above.
          const newCase = await tx.case.create({
            data: {
              agencyId,
              clientId: client.id,
              caseType: planned.caseType,
              stage: planned.stage,
              status: planned.status,
              priority: "Normal",
              assignedUserId: null,
              additionalAssignedUserIds: [],
              nextAction: TERMINAL_CASE_STATUSES.has(planned.status) ? null : "Review imported case",
              submittedAt: planned.stagingCase.submitted,
              decisionAt: planned.stagingCase.approved || planned.stagingCase.refused || null,
              openedAt: planned.stagingCase.opened || null,
              archivedAt: planned.archived ? new Date() : null,
            },
          });
          // Same re-link-instead-of-duplicate handling as
          // convertCaseEasyImportContact above — materializeCaseEasyLastNotes
          // may already have attached this note to the client.
          let bulkImportedNoteId = planned.stagingCase.materializedNoteId;
          if (bulkImportedNoteId) {
            await tx.note.updateMany({ where: { id: bulkImportedNoteId, caseId: null }, data: { caseId: newCase.id } });
          } else if (String(planned.stagingCase.lastNote || "").trim()) {
            const importedNote = await tx.note.create({
              data: {
                agencyId,
                clientId: client.id,
                caseId: newCase.id,
                content: `Imported from Case Easy — last recorded note, dated ${(planned.stagingCase.lastNoteDate || planned.stagingCase.modified || newCase.createdAt).toISOString().slice(0, 10)}:\n\n${planned.stagingCase.lastNote.trim()}`,
                createdAt: planned.stagingCase.lastNoteDate || planned.stagingCase.modified || newCase.createdAt,
                userId: null,
                clientVisible: false,
              },
            });
            bulkImportedNoteId = importedNote.id;
          }

          const uci = planned.stagingCase.reportRows?.[0]?.uci || contact.uci;
          const formData = {};
          if (uci) formData.profileQuestionnaires = { canadianStatus: { uci } };
          if (maritalStatus) formData.profile = { maritalStatus };
          const { score, breakdown } = calculateCrsScore(formData);
          await tx.caseAssessment.create({ data: { agencyId, clientId: client.id, caseId: newCase.id, formData, crsScore: score, crsBreakdown: breakdown } });
          await assignDefaultWorkflowToCase(tx, {
            agencyId,
            caseId: newCase.id,
            caseType: newCase.caseType,
          });

          await tx.caseEasyImportCase.update({ where: { id: planned.stagingCase.id }, data: { importStatus: "converted", convertedCaseId: newCase.id, materializedNoteId: bulkImportedNoteId } });
          await tx.caseEasyImportReportRow.updateMany({
            where: { agencyId, linkedImportCaseId: planned.stagingCase.id },
            data: { linkedCaseId: newCase.id, linkedClientId: client.id },
          });
          createdCases.push(newCase);
        }

        await tx.caseEasyImportContact.update({ where: { id: contact.id }, data: { importStatus: "converted", convertedClientId: client.id } });
        await tx.caseEasyImportReportRow.updateMany({ where: { agencyId, linkedContactId: contact.id }, data: { linkedClientId: client.id } });

        return { client, cases: createdCases };
      });

      await recordActivity({
        agencyId,
        userId: req.user.id,
        clientId: result.client.id,
        action: "case_easy_import.converted",
        details: `${result.client.fullName} converted from Case Easy import data (bulk, ${result.cases.length} case${result.cases.length === 1 ? "" : "s"})`,
      });

      await Promise.all(result.cases.map((caseItem) => notifyCaseAssignment({
        agencyId,
        caseItem,
        clientName: result.client.fullName,
        actorUserId: req.auth.userId,
        source: "Imported from Case Easy",
      })));

      results.push({
        contactId: contact.id,
        name,
        status: "converted",
        clientId: result.client.id,
        casesConverted: result.cases.length,
        casesSkipped: skippedCaseCount,
      });
    } catch (error) {
      const duplicate = error.code === "DUPLICATE_CLIENT" || error.code === "DUPLICATE_LEAD" || error.code === "P2002";
      results.push({
        contactId: contact.id,
        name,
        status: duplicate ? "skipped_duplicate" : "failed",
        message: error.message || "Conversion failed.",
      });
    }
  }

  res.json({
    data: {
      requested: contactIds.length,
      converted: results.filter((row) => row.status === "converted").length,
      skippedDuplicate: results.filter((row) => row.status === "skipped_duplicate").length,
      alreadyConverted: results.filter((row) => row.status === "already_converted").length,
      failed: results.filter((row) => row.status === "failed").length,
      results,
    },
  });
}
