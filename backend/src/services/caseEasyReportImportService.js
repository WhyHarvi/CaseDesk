import { createHash } from "node:crypto";
import prisma from "./prisma/client.js";
import {
  normalizeKey,
  resolveCaseEasyLinks,
} from "./caseEasyImportService.js";

// Case Easy lets users deselect report columns, so detection uses the
// report-specific columns rather than requiring the complete default set.
// A caller may also provide reportType explicitly when a deliberately
// reduced export is too sparse to identify unambiguously.
export const CASE_EASY_REPORT_DEFINITIONS = {
  payment_requests: {
    label: "Payment Requests",
    signatures: ["Taxable Amount", "Tax Exempt Amount", "Expense", "Invoice Date", "Read"],
    naturalKey: ["Case Number", "Number", "Invoice Date", "Created"],
  },
  invoices: {
    label: "Invoices",
    signatures: ["Surcharges", "Paid Date", "Invoice Date", "Read"],
    naturalKey: ["Case Number", "Number", "Invoice Date"],
  },
  payments: {
    label: "Payments",
    signatures: ["Transaction Number", "Payment Date", "Method", "Amount"],
    naturalKey: ["Case Number", "Transaction Number", "Number", "Payment Date"],
  },
  receipts: {
    label: "Receipts",
    signatures: ["Method", "Amount", "Created"],
    naturalKey: ["Case Number", "Number", "Created"],
  },
  account_receivables: {
    label: "Account Receivables",
    signatures: ["Days Past Due", "Balance", "Number"],
    naturalKey: ["Case Number", "Number", "Currency"],
  },
  retainer_balances: {
    label: "Retainer Balances",
    signatures: ["Office Location", "Tax", "Paid", "Balance"],
    naturalKey: ["Case Number", "Client Identifier", "Currency"],
  },
  client_listing: {
    label: "Client Listing",
    signatures: ["Trust Balance", "Trust Account", "Created Date", "Client Identifier"],
    naturalKey: ["Case Number", "Client Identifier"],
  },
  trust_balances: {
    label: "Trust Balances",
    signatures: ["Last Updated", "Bank", "Total Cases", "Case Number(s)"],
    naturalKey: ["Client Identifier", "Currency", "Bank"],
  },
  reminders: {
    label: "Reminders",
    signatures: ["Reminder", "Expiry", "Last Reminder", "Total Cases"],
    naturalKey: ["Client Identifier", "Reminder", "Expiry"],
  },
  time_entries: {
    label: "Time Entries",
    signatures: ["Hours"],
    naturalKey: ["Case Number", "Client Identifier", "Hours"],
  },
  trust_account_entries: {
    label: "Trust Account Entries",
    signatures: ["Transaction Description", "Entry Date", "Grand Total", "Entry By"],
    naturalKey: ["Client Identifier", "Reference Number", "Transaction Date", "Amount"],
  },
  activity_tracker: {
    label: "Activity Tracker",
    signatures: ["Activity Type", "Activity Date", "Topic/Subject", "Duration"],
    naturalKey: ["Client Identifier", "Activity Type", "Activity Date", "Topic/Subject"],
  },
  case_information: {
    label: "Case Information Report",
    signatures: ["Foreign national arrival date", "Resubmission date", "Extension submission date", "Deferral received date"],
    naturalKey: ["Case Number"],
  },
  employers_applications: {
    label: "Employers Applications",
    signatures: ["Employer", "Employee", "Job Status", "Days Submitted", "Expiration Date"],
    naturalKey: ["Case Number", "Employer", "Employee", "Created"],
  },
  e_signatures: {
    label: "E-Signatures",
    signatures: ["Document", "Type", "Signed Date"],
    naturalKey: ["Case Number", "Document", "Created"],
  },
};

const IDENTITY_FIELDS = {
  caseNumber: ["Case Number"],
  uci: ["Unique Client Identifier (UCI)", "Unique Client Identifier", "UCI"],
  clientIdentifier: ["Client Identifier"],
  fullName: ["Full Name"],
  email: ["Email"],
  caseType: ["Case Type"],
  caseStatus: ["Case Status"],
  firstName: ["First Name"],
  lastName: ["Last Name"],
  companyName: ["Company Name"],
};

const CASE_INFORMATION_DATES = {
  "Opened date": "opened",
  "Submitted date": "submitted",
  "Approved date": "approved",
  "Refusal date": "refused",
  "Foreign national arrival date": "foreignNationalArrivalDate",
  "Resubmission date": "resubmissionDate",
  "Extension submission date": "extensionSubmissionDate",
  "Instructions sent": "instructionsSentDate",
  "Returned date": "returnedDate",
  "Deferral received date": "deferralReceivedDate",
};

function valueAt(raw, candidates) {
  const keyByNormalized = new Map(
    Object.keys(raw).map((key) => [normalizeKey(key), key]),
  );
  for (const candidate of candidates) {
    const sourceKey = keyByNormalized.get(normalizeKey(candidate));
    if (!sourceKey) continue;
    const value = raw[sourceKey];
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return null;
}

function jsonValue(value) {
  if (value === undefined || value === null || value === "") return null;
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(jsonValue);
  if (typeof value === "object") {
    if ("result" in value) return jsonValue(value.result);
    if ("text" in value) return String(value.text);
    return Object.fromEntries(
      Object.entries(value).map(([key, nested]) => [key, jsonValue(nested)]),
    );
  }
  if (typeof value === "bigint") return value.toString();
  return value;
}

function normalizeRawData(raw) {
  return Object.fromEntries(
    Object.entries(raw).map(([key, value]) => [key, jsonValue(value)]),
  );
}

function stringValue(value) {
  const normalized = jsonValue(value);
  if (normalized === null || normalized === undefined) return null;
  return String(normalized).trim() || null;
}

function parseOptionalDate(value, field, rowNumber, errors) {
  if (value === null || value === undefined || value === "") return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    errors.push({
      row: rowNumber,
      field,
      message: `Could not parse date value: ${JSON.stringify(value)}`,
    });
    return null;
  }
  return date;
}

function sourceRowKey(reportType, raw) {
  const definition = CASE_EASY_REPORT_DEFINITIONS[reportType];
  const naturalValues = definition.naturalKey
    .map((header) => stringValue(valueAt(raw, [header])))
    .filter(Boolean);
  const source =
    naturalValues.length >= 2 || (definition.naturalKey.length === 1 && naturalValues.length)
      ? naturalValues.join("|")
      : JSON.stringify(normalizeRawData(raw), Object.keys(raw).sort());
  return createHash("sha256")
    .update(`${reportType}|${source}`)
    .digest("hex");
}

export function detectCaseEasyReportType(headers) {
  const normalized = new Set(headers.map(normalizeKey));
  const scored = Object.entries(CASE_EASY_REPORT_DEFINITIONS)
    .map(([type, definition]) => ({
      type,
      score: definition.signatures.filter((header) =>
        normalized.has(normalizeKey(header)),
      ).length,
    }))
    .sort((left, right) => right.score - left.score);
  const best = scored[0];
  const tied = scored.filter((entry) => entry.score === best.score);
  if (!best || best.score === 0) return { type: null, confidence: "unknown", matches: [] };
  if (tied.length > 1) {
    return {
      type: null,
      confidence: "ambiguous",
      matches: tied.map((entry) => entry.type),
    };
  }
  return { type: best.type, confidence: "detected", matches: [best.type] };
}

export function mapCaseEasyReportRows({ headers, rows }, requestedReportType) {
  if (!rows.length) {
    const error = new Error("The Case Easy report contains no data rows.");
    error.code = "REPORT_EMPTY";
    throw error;
  }
  const detected = detectCaseEasyReportType(headers);
  const reportType = requestedReportType || detected.type;
  if (!CASE_EASY_REPORT_DEFINITIONS[reportType]) {
    const error = new Error(
      detected.confidence === "ambiguous"
        ? `This export could match multiple report types: ${detected.matches.join(", ")}. Select the report type explicitly.`
        : "This file does not match a supported Case Easy report.",
    );
    error.code = "REPORT_TYPE_REQUIRED";
    throw error;
  }
  if (
    requestedReportType &&
    detected.confidence === "detected" &&
    detected.type !== requestedReportType
  ) {
    const error = new Error(
      `This file looks like ${CASE_EASY_REPORT_DEFINITIONS[detected.type].label}, not ${CASE_EASY_REPORT_DEFINITIONS[requestedReportType].label}.`,
    );
    error.code = "REPORT_COLUMNS_INVALID";
    throw error;
  }

  const signatureCount = CASE_EASY_REPORT_DEFINITIONS[
    reportType
  ].signatures.filter((header) =>
    headers.some(
      (candidate) => normalizeKey(candidate) === normalizeKey(header),
    ),
  ).length;
  if (signatureCount === 0) {
    const error = new Error(
      `The uploaded columns do not match the ${CASE_EASY_REPORT_DEFINITIONS[reportType].label} export.`,
    );
    error.code = "REPORT_COLUMNS_INVALID";
    throw error;
  }

  return {
    reportType,
    detected,
    rows: rows.map((entry, index) => {
      const raw = entry.raw || entry;
      const identity = Object.fromEntries(
        Object.entries(IDENTITY_FIELDS).map(([field, candidates]) => [
          field,
          stringValue(valueAt(raw, candidates)),
        ]),
      );
      if (!identity.fullName) {
        identity.fullName =
          [identity.firstName, identity.lastName].filter(Boolean).join(" ") ||
          null;
      }
      return {
        rowNumber: entry.rowNumber || index + 2,
        sourceRowKey: sourceRowKey(reportType, raw),
        ...identity,
        rawData: normalizeRawData(raw),
      };
    }),
  };
}

function addToMap(map, value, record) {
  if (!value) return;
  const key = normalizeKey(value);
  if (!map.has(key)) map.set(key, []);
  map.get(key).push(record);
}

function uniqueMatch(map, value) {
  if (!value) return { record: null, ambiguous: false };
  const matches = map.get(normalizeKey(value)) || [];
  return {
    record: matches.length === 1 ? matches[0] : null,
    ambiguous: matches.length > 1,
  };
}

async function backfillClientIdentifiers(agencyId, rows) {
  const [contacts, cases] = await Promise.all([
    prisma.caseEasyImportContact.findMany({ where: { agencyId } }),
    prisma.caseEasyImportCase.findMany({
      where: { agencyId },
      select: { id: true, caseNumber: true, linkedContactId: true },
    }),
  ]);
  const contactsByEmail = new Map();
  const casesByNumber = new Map();
  const contactUpdates = new Map();
  const caseUpdates = new Map();
  for (const contact of contacts) {
    addToMap(contactsByEmail, contact.email, contact);
  }
  for (const caseItem of cases) {
    addToMap(casesByNumber, caseItem.caseNumber, caseItem);
  }

  for (const row of rows) {
    if (!row.clientIdentifier) continue;
    let contactId = null;
    if (row.caseNumber) {
      const matchingCases =
        casesByNumber.get(normalizeKey(row.caseNumber)) || [];
      if (matchingCases.length === 1) {
        caseUpdates.set(matchingCases[0].id, row.clientIdentifier);
        contactId = matchingCases[0].linkedContactId;
      }
    }
    if (!contactId) {
      const emailMatch = uniqueMatch(contactsByEmail, row.email);
      contactId = emailMatch.record?.id || null;
    }
    if (contactId) {
      contactUpdates.set(contactId, row.clientIdentifier);
    }
  }
  const operations = [
    ...[...caseUpdates].map(([id, clientIdentifier]) =>
      prisma.caseEasyImportCase.update({
        where: { id },
        data: { clientIdentifier },
      }),
    ),
    ...[...contactUpdates].map(([id, clientIdentifier]) =>
      prisma.caseEasyImportContact.update({
        where: { id },
        data: { clientIdentifier },
      }),
    ),
  ];
  for (let offset = 0; offset < operations.length; offset += 100) {
    await prisma.$transaction(operations.slice(offset, offset + 100));
  }
  return {
    contactsBackfilled: contactUpdates.size,
    casesBackfilled: caseUpdates.size,
  };
}

async function applyCaseInformationMilestones(agencyId, rows, errors) {
  const cases = await prisma.caseEasyImportCase.findMany({
    where: { agencyId },
    select: { id: true, caseNumber: true },
  });
  const casesByNumber = new Map();
  for (const caseItem of cases) {
    addToMap(casesByNumber, caseItem.caseNumber, caseItem);
  }
  const updates = new Map();
  for (const row of rows) {
    if (!row.caseNumber) continue;
    const matchingCases =
      casesByNumber.get(normalizeKey(row.caseNumber)) || [];
    if (matchingCases.length !== 1) continue;
    const data = {};
    for (const [header, field] of Object.entries(CASE_INFORMATION_DATES)) {
      const rawValue = valueAt(row.rawData, [header]);
      if (rawValue === null) continue;
      data[field] = parseOptionalDate(rawValue, header, row.rowNumber, errors);
    }
    if (row.clientIdentifier) data.clientIdentifier = row.clientIdentifier;
    if (Object.keys(data).length) {
      updates.set(matchingCases[0].id, data);
    }
  }
  const operations = [...updates].map(([id, data]) =>
    prisma.caseEasyImportCase.update({ where: { id }, data }),
  );
  for (let offset = 0; offset < operations.length; offset += 100) {
    await prisma.$transaction(operations.slice(offset, offset + 100));
  }
}

export async function resolveCaseEasyReportLinks(agencyId, rowWhere = {}) {
  const [contacts, cases, liveClients, reportRows] = await Promise.all([
    prisma.caseEasyImportContact.findMany({ where: { agencyId } }),
    prisma.caseEasyImportCase.findMany({ where: { agencyId } }),
    prisma.client.findMany({
      where: { agencyId },
      select: { id: true, email: true },
    }),
    prisma.caseEasyImportReportRow.findMany({
      where: { agencyId, ...rowWhere },
    }),
  ]);

  const contactsByIdentifier = new Map();
  const contactsByEmail = new Map();
  const casesByNumber = new Map();
  const casesByIdentifier = new Map();
  const liveClientsByEmail = new Map();
  for (const contact of contacts) {
    addToMap(contactsByIdentifier, contact.clientIdentifier, contact);
    addToMap(contactsByEmail, contact.email, contact);
  }
  for (const caseItem of cases) {
    addToMap(casesByNumber, caseItem.caseNumber, caseItem);
    addToMap(casesByIdentifier, caseItem.clientIdentifier, caseItem);
  }
  for (const client of liveClients) {
    addToMap(liveClientsByEmail, client.email, client);
  }

  const stats = { linked: 0, unlinked: 0, ambiguous: 0 };
  const updates = [];
  for (const row of reportRows) {
    const caseNumberMatch = uniqueMatch(casesByNumber, row.caseNumber);
    const identifierContactMatch = uniqueMatch(
      contactsByIdentifier,
      row.clientIdentifier,
    );
    const identifierCases = row.clientIdentifier
      ? casesByIdentifier.get(normalizeKey(row.clientIdentifier)) || []
      : [];
    const emailMatch = uniqueMatch(contactsByEmail, row.email);
    const liveClientEmailMatch = uniqueMatch(liveClientsByEmail, row.email);

    const linkedImportCase =
      caseNumberMatch.record ||
      (identifierCases.length === 1 ? identifierCases[0] : null);
    const linkedContact =
      contacts.find((contact) => contact.id === linkedImportCase?.linkedContactId) ||
      identifierContactMatch.record ||
      emailMatch.record ||
      null;
    const linkedClientId =
      linkedContact?.convertedClientId ||
      liveClientEmailMatch.record?.id ||
      null;
    const ambiguous =
      caseNumberMatch.ambiguous ||
      identifierContactMatch.ambiguous ||
      (identifierCases.length > 1 &&
        !caseNumberMatch.record &&
        !identifierContactMatch.record) ||
      (!linkedContact && emailMatch.ambiguous);
    const productionAmbiguous =
      !linkedClientId && liveClientEmailMatch.ambiguous;
    const linkStatus = ambiguous || productionAmbiguous
      ? "ambiguous"
      : linkedContact || linkedImportCase || linkedClientId
        ? "linked"
        : "unlinked";
    const linkReason =
      linkStatus === "linked"
        ? null
        : linkStatus === "ambiguous"
          ? "More than one staging record matched this report row."
          : "No staging contact or case matched this report row.";

    updates.push(
      prisma.caseEasyImportReportRow.update({
        where: { id: row.id },
        data: {
          linkStatus,
          linkReason,
          linkedContactId: linkedContact?.id || null,
          linkedImportCaseId: linkedImportCase?.id || null,
          linkedClientId,
          linkedCaseId: linkedImportCase?.convertedCaseId || null,
        },
      }),
    );
    stats[linkStatus] += 1;
  }
  for (let offset = 0; offset < updates.length; offset += 100) {
    await prisma.$transaction(updates.slice(offset, offset + 100));
  }
  return stats;
}

export async function refreshCaseEasyReportProductionLinks(agencyId) {
  const clientListingRows = await prisma.caseEasyImportReportRow.findMany({
    where: { agencyId, reportType: "client_listing" },
    select: {
      caseNumber: true,
      clientIdentifier: true,
      email: true,
      fullName: true,
    },
  });
  if (clientListingRows.length) {
    await backfillClientIdentifiers(agencyId, clientListingRows);
    await resolveCaseEasyLinks(agencyId);
  }
  return resolveCaseEasyReportLinks(agencyId);
}

export async function importCaseEasyReport({
  agencyId,
  sheet,
  reportType: requestedReportType,
  apply,
}) {
  const mapped = mapCaseEasyReportRows(sheet, requestedReportType);
  const errors = [];
  const importBatchId = `case-easy-report-${new Date()
    .toISOString()
    .replace(/[:.]/g, "-")}`;
  const stats = {
    created: 0,
    updated: 0,
    linked: 0,
    unlinked: 0,
    ambiguous: 0,
    contactsBackfilled: 0,
    casesBackfilled: 0,
  };

  if (apply) {
    const existingRows = await prisma.caseEasyImportReportRow.findMany({
      where: {
        agencyId,
        reportType: mapped.reportType,
        sourceRowKey: { in: mapped.rows.map((row) => row.sourceRowKey) },
      },
      select: { sourceRowKey: true },
    });
    const existingKeys = new Set(
      existingRows.map((row) => row.sourceRowKey),
    );
    stats.updated = mapped.rows.filter((row) =>
      existingKeys.has(row.sourceRowKey),
    ).length;
    stats.created = mapped.rows.length - stats.updated;

    for (let offset = 0; offset < mapped.rows.length; offset += 100) {
      const batch = mapped.rows.slice(offset, offset + 100);
      await prisma.$transaction(
        batch.map((row) => {
          const data = {
            caseNumber: row.caseNumber,
            uci: row.uci,
            clientIdentifier: row.clientIdentifier,
            fullName: row.fullName,
            email: row.email,
            caseType: row.caseType,
            caseStatus: row.caseStatus,
            firstName: row.firstName,
            lastName: row.lastName,
            companyName: row.companyName,
            rawData: row.rawData,
            importBatchId,
            importedAt: new Date(),
          };
          return prisma.caseEasyImportReportRow.upsert({
            where: {
              agencyId_reportType_sourceRowKey: {
                agencyId,
                reportType: mapped.reportType,
                sourceRowKey: row.sourceRowKey,
              },
            },
            update: data,
            create: {
              agencyId,
              reportType: mapped.reportType,
              sourceRowKey: row.sourceRowKey,
              ...data,
            },
          });
        }),
      );
    }

    if (mapped.reportType === "client_listing") {
      Object.assign(
        stats,
        await backfillClientIdentifiers(agencyId, mapped.rows),
      );
    }
    if (mapped.reportType === "case_information") {
      await applyCaseInformationMilestones(agencyId, mapped.rows, errors);
    }
    await resolveCaseEasyLinks(agencyId);
    await resolveCaseEasyReportLinks(
      agencyId,
      mapped.reportType === "client_listing" ? {} : { importBatchId },
    );
    const currentBatchLinks = await prisma.caseEasyImportReportRow.groupBy({
      by: ["linkStatus"],
      where: { agencyId, importBatchId },
      _count: { _all: true },
    });
    for (const entry of currentBatchLinks) {
      stats[entry.linkStatus] = entry._count._all;
    }
  }

  return {
    reportType: mapped.reportType,
    reportLabel: CASE_EASY_REPORT_DEFINITIONS[mapped.reportType].label,
    detected: mapped.detected,
    importBatchId,
    rowCount: mapped.rows.length,
    preview: mapped.rows.slice(0, 5),
    errors,
    stats: apply ? stats : null,
  };
}
