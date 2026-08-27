import { createHash } from "node:crypto";
import prisma from "./prisma/client.js";
import {
  caseEasyAssigneeNameMatches,
  normalizeKey,
  resolveCaseEasyLinks,
} from "./caseEasyImportService.js";

// Case Easy lets users deselect report columns, so detection uses the
// report-specific columns rather than requiring the complete default set.
// A caller may also provide reportType explicitly when a deliberately
// reduced export is too sparse to identify unambiguously.
export const CASE_EASY_REPORT_DEFINITIONS = {
  case_types: {
    label: "Case Types",
    signatures: [
      "Location(s)",
      "Retainers On File",
      "No Retainers",
      "Total",
      "Month(Year)",
    ],
    naturalKey: ["Case Type", "Location(s)", "Month(Year)"],
    aggregate: true,
  },
  payment_requests: {
    label: "Payment Requests",
    signatures: ["Taxable Amount", "Tax Exempt Amount", "Expense", "Invoice Date", "Read"],
    naturalKey: ["Case Number", "Number", "Invoice Date", "Created"],
  },
  invoices: {
    label: "Invoices",
    signatures: ["Surcharges", "Paid Date", "Invoice Date", "Read"],
    // Case Easy's invoice and payment-request exports otherwise share nearly
    // every financial column. Paid Date is the stable invoice-only header in
    // the real exports; without treating it as decisive, the three tax and
    // expense columns make genuine invoices score as Payment Requests.
    discriminator: "Paid Date",
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

const CASE_INFORMATION_IDENTITY_HEADERS = [
  "Case Number",
  "Case Type",
  "Case Status",
];

export function inferCaseEasyReportTypeFromFileName(fileName) {
  const normalized = String(fileName || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
  if (normalized.includes("caseinformationreport")) {
    return "case_information";
  }
  if (normalized.includes("casetypesexport")) return "case_types";
  if (normalized.includes("paymentrequest")) return "payment_requests";
  if (normalized.includes("invoice")) return "invoices";
  return null;
}

function isIdentityOnlyCaseInformationExport(headers, reportType) {
  if (reportType !== "case_information") return false;
  const normalized = new Set(headers.map(normalizeKey));
  const hasRequiredIdentity = CASE_INFORMATION_IDENTITY_HEADERS.every(
    (header) => normalized.has(normalizeKey(header)),
  );
  const hasPersonOrCompany = [
    "Full Name",
    "First Name",
    "Last Name",
    "Company Name",
  ].some((header) => normalized.has(normalizeKey(header)));
  return hasRequiredIdentity && hasPersonOrCompany;
}

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

function duplicateSourceRowKey(baseKey, occurrence) {
  if (occurrence === 1) return baseKey;
  return createHash("sha256")
    .update(`${baseKey}|occurrence:${occurrence}`)
    .digest("hex");
}

// DATABASE_URL pins connection_limit=1 — Prisma holds one dedicated
// connection for a $transaction's entire batch, so running these with any
// concurrency > 1 buys no real parallelism (everything still serializes
// through the same single connection) while adding queuing delay that can
// exceed Prisma's pool_timeout (P2024) on a large report. Fully serial
// avoids that risk outright; non-transactional calls (plain createMany)
// don't hold a connection the same way and are left at their own limits.
const TRANSACTION_CONCURRENCY = 1;

async function runWithConcurrency(items, concurrency, task) {
  let index = 0;
  async function worker() {
    while (index < items.length) {
      const item = items[index++];
      await task(item);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, worker),
  );
}

function chunksOf(items, size) {
  const chunks = [];
  for (let offset = 0; offset < items.length; offset += size) {
    chunks.push(items.slice(offset, offset + size));
  }
  return chunks;
}

export function detectCaseEasyReportType(headers) {
  const normalized = new Set(headers.map(normalizeKey));
  const discriminated = Object.entries(CASE_EASY_REPORT_DEFINITIONS)
    .filter(([, definition]) => definition.discriminator)
    .filter(([, definition]) =>
      normalized.has(normalizeKey(definition.discriminator)),
    );
  if (discriminated.length === 1) {
    return {
      type: discriminated[0][0],
      confidence: "detected",
      matches: [discriminated[0][0]],
    };
  }
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
  const identityOnlyCaseInformation =
    signatureCount === 0 &&
    isIdentityOnlyCaseInformationExport(headers, reportType);
  if (signatureCount === 0 && !identityOnlyCaseInformation) {
    const error = new Error(
      `The uploaded columns do not match the ${CASE_EASY_REPORT_DEFINITIONS[reportType].label} export.`,
    );
    error.code = "REPORT_COLUMNS_INVALID";
    throw error;
  }

  const sourceKeyOccurrences = new Map();
  return {
    reportType,
    detected,
    identityOnlyCaseInformation,
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
      const baseSourceRowKey = sourceRowKey(reportType, raw);
      const occurrence = (sourceKeyOccurrences.get(baseSourceRowKey) || 0) + 1;
      sourceKeyOccurrences.set(baseSourceRowKey, occurrence);
      return {
        rowNumber: entry.rowNumber || index + 2,
        // Case Easy reports can legitimately contain duplicate source rows.
        // Preserve every occurrence while keeping keys stable across a
        // re-upload of the same file in the same row order.
        sourceRowKey: duplicateSourceRowKey(baseSourceRowKey, occurrence),
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

function normalizeIdentityValue(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function rowFullName(row) {
  return (
    row.fullName ||
    [row.firstName, row.lastName].filter(Boolean).join(" ") ||
    null
  );
}

function uniqueIdentityRow(rows) {
  if (!rows.length) return null;
  const identities = new Set(
    rows.map((row) =>
      [
        normalizeKey(row.clientIdentifier),
        normalizeKey(row.email),
        normalizeIdentityValue(rowFullName(row)),
        normalizeIdentityValue(row.companyName),
      ].join("|"),
    ),
  );
  return identities.size === 1 ? rows[0] : null;
}

// Case Easy has reused a small number of Case Numbers for different people.
// A Case Number therefore narrows the search, but email/name/company identity
// must select the person inside that group. Returning ambiguity instead of an
// arbitrary row prevents one person's identifier from being written onto a
// different person's staging contact or case.
export function selectCaseEasyClientListingIdentity(subject, listingRows) {
  const caseNumber = normalizeKey(subject?.caseNumber);
  if (!caseNumber) return { record: null, ambiguous: false };
  const candidates = listingRows instanceof Map
    ? listingRows.get(caseNumber) || []
    : listingRows.filter(
        (row) => normalizeKey(row.caseNumber) === caseNumber,
      );
  if (!candidates.length) return { record: null, ambiguous: false };

  const selectors = [
    ["email", normalizeKey],
    ["fullName", normalizeIdentityValue],
    ["companyName", normalizeIdentityValue],
    ["clientIdentifier", normalizeKey],
  ];
  const subjectValues = {
    clientIdentifier: subject.clientIdentifier,
    email: subject.email,
    fullName: rowFullName(subject),
    companyName: subject.companyName,
  };
  let sawAmbiguousIdentity = false;
  for (const [field, normalize] of selectors) {
    const value = normalize(subjectValues[field]);
    if (!value) continue;
    const matches = candidates.filter((candidate) => {
      const candidateValue =
        field === "fullName" ? rowFullName(candidate) : candidate[field];
      return normalize(candidateValue) === value;
    });
    const match = uniqueIdentityRow(matches);
    if (match) return { record: match, ambiguous: false };
    if (matches.length > 1) sawAmbiguousIdentity = true;
  }

  // A few Case Easy financial exports dropped the leading letter from a
  // company identifier (for example A-18612 became -18612). Inside an exact
  // Case Number group, a unique suffix match safely restores that identifier.
  const truncatedIdentifier = normalizeKey(subject.clientIdentifier);
  if (truncatedIdentifier.startsWith("-") && truncatedIdentifier.length > 1) {
    const suffixMatches = candidates.filter((candidate) =>
      normalizeKey(candidate.clientIdentifier).endsWith(truncatedIdentifier),
    );
    const suffixMatch = uniqueIdentityRow(suffixMatches);
    if (suffixMatch) return { record: suffixMatch, ambiguous: false };
    if (suffixMatches.length > 1) sawAmbiguousIdentity = true;
  }

  // Case Number alone is safe only when the Client Listing contains exactly
  // one identity for that number. If identity fields were supplied but
  // conflict with that sole row, leave it unresolved rather than guessing.
  const soleCandidate = uniqueIdentityRow(candidates);
  const suppliedIdentity = Object.values(subjectValues).some(Boolean);
  const candidateHasIdentity = candidates.some((candidate) =>
    [
      candidate.clientIdentifier,
      candidate.email,
      rowFullName(candidate),
      candidate.companyName,
    ].some(Boolean),
  );
  if (
    soleCandidate &&
    candidates.length === 1 &&
    (!suppliedIdentity || !candidateHasIdentity)
  ) {
    return { record: soleCandidate, ambiguous: false };
  }
  return {
    record: null,
    ambiguous: sawAmbiguousIdentity || candidates.length > 1,
  };
}

function indexClientListingRows(rows) {
  const rowsByCaseNumber = new Map();
  for (const row of rows) {
    addToMap(rowsByCaseNumber, row.caseNumber, row);
  }
  return rowsByCaseNumber;
}

function hasCaseEasyLinkableIdentity(row) {
  const clientIdentifier = normalizeKey(row.clientIdentifier);
  const hasUsableClientIdentifier =
    Boolean(clientIdentifier) && !/^-?0+$/.test(clientIdentifier);
  return Boolean(
    row.caseNumber ||
      row.uci ||
      hasUsableClientIdentifier ||
      row.fullName ||
      row.email ||
      row.firstName ||
      row.lastName ||
      row.companyName,
  );
}

async function backfillClientIdentifiers(agencyId, rows) {
  const [contacts, cases] = await Promise.all([
    prisma.caseEasyImportContact.findMany({ where: { agencyId } }),
    prisma.caseEasyImportCase.findMany({
      where: { agencyId },
      select: {
        id: true,
        caseNumber: true,
        clientIdentifier: true,
        email: true,
        firstName: true,
        lastName: true,
        companyName: true,
        linkedContactId: true,
      },
    }),
  ]);
  const contactsByEmail = new Map();
  const contactsById = new Map();
  const listingRowsByCaseNumber = indexClientListingRows(rows);
  const listingRowsByEmail = new Map();
  const contactUpdates = new Map();
  const caseUpdates = new Map();
  for (const contact of contacts) {
    contactsById.set(contact.id, contact);
    addToMap(contactsByEmail, contact.email, contact);
  }
  for (const row of rows) {
    addToMap(listingRowsByEmail, row.email, row);
  }

  for (const [emailKey, emailRows] of listingRowsByEmail) {
    const row = uniqueIdentityRow(emailRows);
    if (!row?.clientIdentifier) continue;
    // Email identifies the exported person independently of a reused case
    // number. Do this before changing cases so stale case links cannot move an
    // identifier onto the wrong contact.
    const emailMatch = uniqueMatch(contactsByEmail, emailKey);
    const contactId = emailMatch.record?.id || null;
    if (contactId) {
      contactUpdates.set(contactId, row.clientIdentifier);
    }
  }

  for (const caseItem of cases) {
    const identityMatch = selectCaseEasyClientListingIdentity(
      caseItem,
      listingRowsByCaseNumber,
    );
    if (identityMatch.record?.clientIdentifier) {
      caseUpdates.set(caseItem.id, identityMatch.record.clientIdentifier);
      if (!contactUpdates.has(caseItem.linkedContactId)) {
        const linkedContact = contactsById.get(caseItem.linkedContactId);
        if (
          linkedContact &&
          normalizeKey(linkedContact.email) ===
            normalizeKey(identityMatch.record.email)
        ) {
          contactUpdates.set(
            linkedContact.id,
            identityMatch.record.clientIdentifier,
          );
        }
      }
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
  await runWithConcurrency(chunksOf(operations, 100), TRANSACTION_CONCURRENCY, (batch) =>
    prisma.$transaction(batch),
  );
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
  await runWithConcurrency(chunksOf(operations, 100), TRANSACTION_CONCURRENCY, (batch) =>
    prisma.$transaction(batch),
  );
}

export async function resolveCaseEasyReportLinks(agencyId, rowWhere = {}) {
  const [contacts, cases, liveClients, reportRows, clientListingRows] =
    await Promise.all([
      prisma.caseEasyImportContact.findMany({ where: { agencyId } }),
      prisma.caseEasyImportCase.findMany({ where: { agencyId } }),
      prisma.client.findMany({
        where: { agencyId },
        select: { id: true, email: true },
      }),
      prisma.caseEasyImportReportRow.findMany({
        where: { agencyId, ...rowWhere },
      }),
      prisma.caseEasyImportReportRow.findMany({
        where: { agencyId, reportType: "client_listing" },
      }),
    ]);

  const contactsByIdentifier = new Map();
  const contactsByEmail = new Map();
  const contactsById = new Map();
  const casesByNumber = new Map();
  const casesByIdentifier = new Map();
  const liveClientsByEmail = new Map();
  for (const contact of contacts) {
    contactsById.set(contact.id, contact);
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
  const clientListingRowsByCaseNumber =
    indexClientListingRows(clientListingRows);

  const stats = {
    linked: 0,
    unlinked: 0,
    ambiguous: 0,
    standalone: 0,
    aggregate: 0,
    source_only: 0,
  };
  const updates = [];
  for (const row of reportRows) {
    if (CASE_EASY_REPORT_DEFINITIONS[row.reportType]?.aggregate) {
      updates.push(
        prisma.caseEasyImportReportRow.update({
          where: { id: row.id },
          data: {
            linkStatus: "aggregate",
            linkReason: null,
            linkedContactId: null,
            linkedImportCaseId: null,
            linkedClientId: null,
            linkedCaseId: null,
          },
        }),
      );
      stats.aggregate += 1;
      continue;
    }
    // Some Case Easy reports omit every client/case identity field. Examples
    // are an Employer Application whose employee is explicitly "Not Assigned"
    // and an E-Signature row containing only a document filename. There is
    // nothing deterministic for staff or the resolver to match, so retain the
    // source row without presenting it as actionable matching work.
    if (!hasCaseEasyLinkableIdentity(row)) {
      updates.push(
        prisma.caseEasyImportReportRow.update({
          where: { id: row.id },
          data: {
            linkStatus: "source_only",
            linkReason:
              "Case Easy did not export a client or case identity for this source row.",
            linkedContactId: null,
            linkedImportCaseId: null,
            linkedClientId: null,
            linkedCaseId: null,
          },
        }),
      );
      stats.source_only += 1;
      continue;
    }
    const inheritedListingMatch =
      row.reportType === "client_listing"
        ? { record: row, ambiguous: false }
        : selectCaseEasyClientListingIdentity(
            row,
            clientListingRowsByCaseNumber,
          );
    const inheritedListing = inheritedListingMatch.record;
    const effectiveClientIdentifier =
      inheritedListing?.clientIdentifier || row.clientIdentifier || null;
    const effectiveCompanyName =
      row.companyName || inheritedListing?.companyName || null;
    const caseNumberCandidates = row.caseNumber
      ? casesByNumber.get(normalizeKey(row.caseNumber)) || []
      : [];
    const identifierContactMatch = uniqueMatch(
      contactsByIdentifier,
      effectiveClientIdentifier,
    );
    const identifierCases = effectiveClientIdentifier
      ? casesByIdentifier.get(normalizeKey(effectiveClientIdentifier)) || []
      : [];
    const emailMatch = uniqueMatch(contactsByEmail, row.email);
    const liveClientEmailMatch = uniqueMatch(liveClientsByEmail, row.email);

    const identityContactCandidates = [
      identifierContactMatch.record,
      emailMatch.record,
    ].filter(Boolean);
    const identityContactIds = new Set(
      identityContactCandidates.map((contact) => contact.id),
    );
    const identityContact = identityContactIds.size === 1
      ? identityContactCandidates[0]
      : null;
    const identityContactConflict = identityContactIds.size > 1;

    // Case Easy has reused a case number for different people. When that
    // happens, the report's unique Client Identifier/email can safely narrow
    // the duplicate case-number candidates to the case linked to that person.
    const narrowedCaseNumberCandidates = identityContact
      ? caseNumberCandidates.filter(
          (caseItem) =>
            !caseItem.linkedContactId ||
            caseItem.linkedContactId === identityContact.id,
        )
      : caseNumberCandidates;
    const caseNumberMatch = {
      record:
        narrowedCaseNumberCandidates.length === 1
          ? narrowedCaseNumberCandidates[0]
          : null,
      ambiguous: narrowedCaseNumberCandidates.length > 1,
    };

    const linkedImportCase =
      caseNumberMatch.record ||
      (identifierCases.length === 1 ? identifierCases[0] : null);
    const linkedCaseContact = contactsById.get(
      linkedImportCase?.linkedContactId,
    );
    const resolvedContactCandidates = [
      linkedCaseContact,
      ...identityContactCandidates,
    ].filter(Boolean);
    const resolvedContactIds = new Set(
      resolvedContactCandidates.map((contact) => contact.id),
    );
    const linkedContact = resolvedContactIds.size === 1
      ? resolvedContactCandidates[0]
      : null;
    const resolvedContactConflict = resolvedContactIds.size > 1;
    const linkedClientId =
      linkedContact?.convertedClientId ||
      liveClientEmailMatch.record?.id ||
      null;
    const ambiguous =
      inheritedListingMatch.ambiguous ||
      identityContactConflict ||
      resolvedContactConflict ||
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
    const standaloneCompany =
      linkStatus === "unlinked" &&
      ((Boolean(effectiveCompanyName && effectiveClientIdentifier) &&
        !row.fullName &&
        !row.firstName &&
        !row.lastName &&
        row.reportType === "client_listing") ||
        (inheritedListing?.linkStatus === "unlinked" &&
          inheritedListing?.importStatus === "reviewed"));
    const linkReason =
      linkStatus === "linked"
        ? null
        : standaloneCompany
          ? "Standalone Case Easy company record; no corresponding Contacts, Cases, or CaseDesk record was included."
        : linkStatus === "ambiguous"
          ? "More than one staging record matched this report row."
          : "No staging contact or case matched this report row.";

    updates.push(
      prisma.caseEasyImportReportRow.update({
        where: { id: row.id },
        data: {
          clientIdentifier: effectiveClientIdentifier,
          companyName: effectiveCompanyName,
          linkStatus,
          linkReason,
          linkedContactId: linkedContact?.id || null,
          linkedImportCaseId: linkedImportCase?.id || null,
          linkedClientId,
          linkedCaseId: linkedImportCase?.convertedCaseId || null,
          ...(standaloneCompany ? { importStatus: "reviewed" } : {}),
        },
      }),
    );
    stats[standaloneCompany ? "standalone" : linkStatus] += 1;
  }
  await runWithConcurrency(chunksOf(updates, 100), TRANSACTION_CONCURRENCY, (batch) =>
    prisma.$transaction(batch),
  );
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

// Turns linked Activity Tracker rows into real Notes — the one report type
// that carries genuine narrative case-note content (Case Easy's Cases
// export only ever has a single "last note", no history; see
// convertCaseEasyImportContact for that path). Idempotent via
// materializedNoteId, so it's always safe to re-run: already-materialized
// rows are skipped, so calling this again after a fresh upload only
// processes what's newly linked. Rows with no real description are skipped
// rather than creating an empty/noise note.
export async function materializeCaseEasyActivityNotes(agencyId) {
  const rows = await prisma.caseEasyImportReportRow.findMany({
    where: {
      agencyId,
      reportType: "activity_tracker",
      linkStatus: "linked",
      materializedNoteId: null,
      OR: [{ linkedClientId: { not: null } }, { linkedCaseId: { not: null } }],
    },
  });
  const stats = { created: 0, skipped: 0 };
  if (!rows.length) return stats;

  // Same fail-safe as case assignee resolution: an unrecognized or
  // ambiguous "Created By" name is left unattributed (userId: null) rather
  // than guessed — the exact format Case Easy uses for this column isn't
  // confirmed yet (no real Activity Tracker data has been imported), so
  // this deliberately never trusts a loose match.
  const users = await prisma.user.findMany({
    where: { agencyId, status: "active", role: { in: ["admin", "consultant"] } },
    select: { id: true, fullName: true },
  });

  for (const row of rows) {
    const raw = row.rawData || {};
    const description = String(raw["Description"] ?? "").trim();
    if (!description) {
      stats.skipped += 1;
      continue;
    }
    const activityType = String(raw["Activity Type"] ?? "").trim();
    const activityDateRaw = raw["Activity Date"];
    const parsedActivityDate = activityDateRaw ? new Date(activityDateRaw) : null;
    const noteDate = parsedActivityDate && !Number.isNaN(parsedActivityDate.getTime()) ? parsedActivityDate : row.importedAt;
    const createdBy = String(raw["Created By"] ?? "").trim();
    const matchedAuthor = createdBy
      ? users.find((user) => caseEasyAssigneeNameMatches(createdBy, user.fullName))
      : null;

    const note = await prisma.note.create({
      data: {
        agencyId,
        clientId: row.linkedClientId,
        caseId: row.linkedCaseId,
        content: `Imported from Case Easy Activity Tracker${activityType ? ` (${activityType})` : ""}, dated ${noteDate.toISOString().slice(0, 10)}:\n\n${description}`,
        createdAt: noteDate,
        userId: matchedAuthor?.id || null,
        clientVisible: false,
      },
    });
    await prisma.caseEasyImportReportRow.update({ where: { id: row.id }, data: { materializedNoteId: note.id } });
    stats.created += 1;
  }
  return stats;
}

export async function importCaseEasyReport({
  agencyId,
  sheet,
  reportType: requestedReportType,
  apply,
}) {
  const mapped = mapCaseEasyReportRows(sheet, requestedReportType);
  const errors = [];
  const warnings = [];
  if (mapped.identityOnlyCaseInformation) {
    warnings.push({
      code: "CASE_INFORMATION_IDENTITY_ONLY",
      message:
        "Case Easy exported this Case Information Report without milestone columns. Case identity and status rows will be stored and linked, but no milestone dates can be updated from this file.",
    });
  }
  const importBatchId = `case-easy-report-${new Date()
    .toISOString()
    .replace(/[:.]/g, "-")}`;
  const stats = {
    created: 0,
    updated: 0,
    linked: 0,
    unlinked: 0,
    ambiguous: 0,
    standalone: 0,
    aggregate: 0,
    source_only: 0,
    contactsBackfilled: 0,
    casesBackfilled: 0,
    stored: 0,
  };

  if (apply) {
    const sourceRowKeys = mapped.rows.map((row) => row.sourceRowKey);
    const existingRows = (
      await Promise.all(
        chunksOf(sourceRowKeys, 2_000).map((sourceRowKeyBatch) =>
          prisma.caseEasyImportReportRow.findMany({
            where: {
              agencyId,
              reportType: mapped.reportType,
              sourceRowKey: { in: sourceRowKeyBatch },
            },
            select: { id: true, sourceRowKey: true },
          }),
        ),
      )
    ).flat();
    const existingByKey = new Map(
      existingRows.map((row) => [row.sourceRowKey, row]),
    );
    const existingKeys = new Set(
      existingRows.map((row) => row.sourceRowKey),
    );
    stats.updated = mapped.rows.filter((row) =>
      existingKeys.has(row.sourceRowKey),
    ).length;
    stats.created = mapped.rows.length - stats.updated;

    const importedAt = new Date();
    const rowData = mapped.rows.map((row) => ({
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
      importedAt,
      sourceRowKey: row.sourceRowKey,
    }));
    const rowsToCreate = rowData.filter(
      (row) => !existingByKey.has(row.sourceRowKey),
    );
    const rowsToUpdate = rowData.filter((row) =>
      existingByKey.has(row.sourceRowKey),
    );

    // New rows can be inserted in bulk. Existing rows still update in
    // bounded transactions so re-uploading a report remains idempotent.
    await runWithConcurrency(chunksOf(rowsToCreate, 500), 4, (batch) =>
      prisma.caseEasyImportReportRow.createMany({
        data: batch.map((row) => ({
          agencyId,
          reportType: mapped.reportType,
          ...row,
        })),
        skipDuplicates: true,
      }),
    );
    await runWithConcurrency(chunksOf(rowsToUpdate, 100), TRANSACTION_CONCURRENCY, (batch) =>
      prisma.$transaction(
        batch.map(({ sourceRowKey: _sourceRowKey, ...data }) =>
          prisma.caseEasyImportReportRow.update({
            where: { id: existingByKey.get(_sourceRowKey).id },
            data,
          }),
        ),
      ),
    );

    const storedCounts = await Promise.all(
      chunksOf(sourceRowKeys, 2_000).map((sourceRowKeyBatch) =>
        prisma.caseEasyImportReportRow.count({
          where: {
            agencyId,
            reportType: mapped.reportType,
            sourceRowKey: { in: sourceRowKeyBatch },
          },
        }),
      ),
    );
    stats.stored = storedCounts.reduce((sum, count) => sum + count, 0);
    if (stats.stored !== mapped.rows.length) {
      const error = new Error(
        `Only ${stats.stored} of ${mapped.rows.length} report rows were stored. Retry the same file to resume safely.`,
      );
      error.code = "REPORT_INCOMPLETE";
      throw error;
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
    // Only Client Listing backfills identifiers into contact/case staging.
    // Other report types do not change those links, so re-resolving every
    // staged contact and case would add many seconds without changing data.
    if (mapped.reportType === "client_listing") {
      await resolveCaseEasyLinks(agencyId);
    }
    await resolveCaseEasyReportLinks(
      agencyId,
      mapped.reportType === "client_listing"
        ? {
            OR: [
              { importBatchId },
              { linkStatus: { in: ["unlinked", "ambiguous"] } },
            ],
          }
        : { importBatchId },
    );
    const currentBatchLinks = await prisma.caseEasyImportReportRow.groupBy({
      by: ["linkStatus", "importStatus"],
      where: { agencyId, importBatchId },
      _count: { _all: true },
    });
    for (const entry of currentBatchLinks) {
      const key =
        entry.linkStatus === "aggregate"
          ? "aggregate"
          : entry.linkStatus === "unlinked" &&
              entry.importStatus === "reviewed"
          ? "standalone"
          : entry.linkStatus;
      stats[key] += entry._count._all;
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
    warnings,
    stats: apply ? stats : null,
  };
}
