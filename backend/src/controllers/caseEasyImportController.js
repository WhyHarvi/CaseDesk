import ExcelJS from "exceljs";
import prisma from "../services/prisma/client.js";
import { createHttpError } from "../utils/http.js";
import { recordActivity } from "../utils/prismaCrud.js";
import { lockAgencyContactIntake } from "../services/contactDuplicateService.js";
import { normalizeEmail, normalizePhone } from "../modules/leads/lead.validation.js";
import { parseCsv } from "../modules/leads/lead.csv.js";
import { CASE_STAGES } from "../constants/caseStages.js";
import { nextClientNumber } from "../services/clientNumberService.js";
import { mapCaseEasyStatus } from "../services/caseEasyStatusMapping.js";
import { classifyWorkbookHeaders, importCaseEasyExports, readSheetRowsFromWorkbook } from "../services/caseEasyImportService.js";
import {
  CASE_EASY_REPORT_DEFINITIONS,
  importCaseEasyReport,
  refreshCaseEasyReportProductionLinks,
} from "../services/caseEasyReportImportService.js";
import { calculateCrsScore } from "./caseAssessmentController.js";
import { normalizeMaritalStatus } from "../services/clientProfileSyncService.js";

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
const REPORT_LINK_STATUSES = new Set(["linked", "unlinked", "ambiguous"]);
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
  };
  const contacts = await prisma.caseEasyImportContact.findMany({
    where,
    include: { linkedCases: { include: caseInclude, orderBy: { createdAt: "asc" } } },
    orderBy: [{ importedAt: "desc" }],
  });
  res.json({ data: contacts });
}

export async function listUnlinkedCaseEasyImportCases(req, res) {
  const cases = await prisma.caseEasyImportCase.findMany({
    where: {
      agencyId: req.user.agencyId,
      linkedContactId: null,
      importStatus: { not: "converted" },
    },
    include: caseInclude,
    orderBy: [{ importedAt: "desc" }, { createdAt: "desc" }],
  });
  res.json({ data: cases });
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
  const reportType = String(req.body.reportType || "").trim() || undefined;
  if (reportType && !CASE_EASY_REPORT_DEFINITIONS[reportType]) {
    throw createHttpError(400, "reportType is invalid.", "VALIDATION_ERROR");
  }
  try {
    const sheet = await readReportSheet(req.file);
    if (sheet.rows.length > 10_000) {
      throw createHttpError(
        400,
        "Case Easy report imports are limited to 10,000 rows per file.",
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
    throw error;
  }
}

export async function previewCaseEasyReportUpload(req, res) {
  res.json({ data: await runReportImport(req, false) });
}

export async function confirmCaseEasyReportUpload(req, res) {
  const result = await runReportImport(req, true);
  await recordActivity({
    agencyId: req.user.agencyId,
    userId: req.user.id,
    action: "case_easy_report.uploaded",
    details: `Imported ${result.rowCount} ${result.reportLabel} row(s) from Case Easy`,
  });
  res.status(201).json({ data: result });
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
    ...(linkStatus ? { linkStatus } : {}),
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
      by: ["linkStatus"],
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
      linkStatuses: Object.fromEntries(
        byLinkStatus.map((entry) => [entry.linkStatus, entry._count._all]),
      ),
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
    where: { agencyId: req.user.agencyId, linkedClientId: client.id },
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

  const requestedAssigneeIds = [
    ...new Set(
      casesInput
        .map((caseInput) => caseInput.assignedUserId)
        .filter(Boolean),
    ),
  ];
  if (requestedAssigneeIds.length) {
    const validAssigneeCount = await prisma.user.count({
      where: {
        id: { in: requestedAssigneeIds },
        agencyId,
        status: "active",
        role: { in: ["admin", "consultant"] },
      },
    });
    if (validAssigneeCount !== requestedAssigneeIds.length) {
      throw createHttpError(
        400,
        "One or more selected assignees are not active staff in this agency.",
        "VALIDATION_ERROR",
      );
    }
  }

  for (const caseInput of casesInput) {
    const stagingCase = linkedCaseById.get(caseInput.caseEasyImportCaseId);
    if (!stagingCase || stagingCase.importStatus === "converted") continue;
    const suggested = mapCaseEasyStatus(stagingCase.status);
    if (!String(caseInput.caseType || stagingCase.caseType || "").trim()) {
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

  let fullName, dateOfBirth, contactNormalized;
  let clientInput = {};
  if (!alreadyConverted) {
    clientInput = isPlainObject(req.body.client) ? req.body.client : {};
    fullName = String(clientInput.fullName || `${contact.firstName || ""} ${contact.lastName || ""}`).trim();
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
        const clientNumber = await nextClientNumber(tx, agencyId);
        client = await tx.client.create({
          data: {
            agencyId,
            clientNumber,
            fullName,
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
        const caseType = String(caseInput.caseType || stagingCase.caseType || "").trim();
        if (!caseType) continue;

        const suggested = mapCaseEasyStatus(stagingCase.status);
        const newCase = await tx.case.create({
          data: {
            agencyId,
            clientId: client.id,
            caseType,
            stage: caseInput.stage || suggested.stage,
            status: caseInput.status || suggested.status,
            priority: caseInput.priority || "Normal",
            assignedUserId: caseInput.assignedUserId || stagingCase.resolvedAssigneeUserId || null,
            nextAction: caseInput.nextAction || null,
            submittedAt: caseInput.submittedAt ? new Date(caseInput.submittedAt) : stagingCase.submitted,
            decisionAt: caseInput.decisionAt ? new Date(caseInput.decisionAt) : stagingCase.approved || stagingCase.refused || null,
            archivedAt: (caseInput.archived ?? suggested.archived) ? new Date() : null,
          },
        });

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

        await tx.caseEasyImportCase.update({ where: { id: stagingCase.id }, data: { importStatus: "converted", convertedCaseId: newCase.id } });
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

    res.status(201).json({ data: result });
  } catch (error) {
    if (error.code === "P2002") throw createHttpError(409, "A client with this phone or email already exists in CaseDesk.", "DUPLICATE_CONTACT");
    throw error;
  }
}
