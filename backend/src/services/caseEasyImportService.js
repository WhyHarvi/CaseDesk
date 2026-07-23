import prisma from "./prisma/client.js";

// Shared by both the CLI script (scripts/importCaseEasyData.js) and the
// Settings upload flow (caseEasyImportController.js) so parsing/mapping/
// upsert logic never drifts between the two entry points. See
// docs/production/case-easy-import-prompt.md for the source-of-truth spec.

export const CONTACT_HEADER_MAP = {
  "UCI": "uci",
  "First Name": "firstName",
  "Last Name": "lastName",
  "Marital Status": "maritalStatus",
  "Date of Birth": "dateOfBirth",
  "Email": "email",
  "Phone": "phone",
  "Country Of Residence": "countryOfResidence",
  "NOC/TEER": "nocTeer",
  "Referral Source": "referralSource",
  "Created": "sourceCreated",
  "Client Identifier": "clientIdentifier",
};
export const CONTACT_DATE_FIELDS = new Set(["dateOfBirth", "sourceCreated"]);

export const CASE_HEADER_MAP = {
  "Applicant I D Key": "applicantIdKey",
  "Case Number": "caseNumber",
  "Company Name": "companyName",
  "Status": "status",
  "Case Type": "caseType",
  "NOC/TEER": "nocTeer",
  "Job Title": "jobTitle",
  "Assignees": "assignees",
  "Referral Source": "referralSource",
  "Category": "category",
  "Tags": "tags",
  "Office Location": "officeLocation",
  "Opened": "opened",
  "Approved": "approved",
  "Submitted": "submitted",
  "Refused": "refused",
  "Created": "sourceCreated",
  "Other Contacts": "otherContacts",
  "Primary Address": "primaryAddress",
  "Phone": "phone",
  "Other Emails": "otherEmails",
  "Email": "email",
  "First Name": "firstName",
  "Last Name": "lastName",
  "Modified": "modified",
  "Last Note": "lastNote",
  "Last Note Date": "lastNoteDate",
  "Client Identifier": "clientIdentifier",
};
export const CASE_DATE_FIELDS = new Set(["opened", "approved", "submitted", "refused", "sourceCreated", "modified", "lastNoteDate"]);
export const TOGGLE_HEADER_CANDIDATES = ["prospect/client", "prospect / client", "type", "record type", "client type"];

export function normalizeKey(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizePhoneKey(value) {
  return String(value || "").replace(/\D/g, "");
}

function parseDateValue(value) {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? undefined : value;
  if (value === null || value === undefined || value === "") return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

export function readSheetRowsFromWorkbook(workbook, sourceLabel) {
  const worksheet = workbook.worksheets[0];
  if (!worksheet) throw new Error(`${sourceLabel}: no worksheet found`);

  const headerRow = worksheet.getRow(1);
  const headers = [];
  headerRow.eachCell({ includeEmpty: false }, (cell, colNumber) => {
    headers[colNumber] = String(cell.value ?? "").trim();
  });

  const rows = [];
  worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber === 1) return;
    const raw = {};
    row.eachCell({ includeEmpty: false }, (cell, colNumber) => {
      const header = headers[colNumber];
      if (header) raw[header] = cell.value && typeof cell.value === "object" && "result" in cell.value ? cell.value.result : cell.value;
    });
    if (Object.keys(raw).length) rows.push({ rowNumber, raw });
  });

  return { headers: headers.filter(Boolean), rows };
}

export function mapRow({ raw, rowNumber }, headerMap, dateFields, sheetLabel, errors) {
  const mapped = {};
  for (const [header, field] of Object.entries(headerMap)) {
    const value = raw[header];
    if (value === undefined || value === null || value === "") {
      mapped[field] = null;
      continue;
    }
    if (dateFields.has(field)) {
      const parsed = parseDateValue(value);
      if (parsed === undefined) {
        errors.push({ sheet: sheetLabel, row: rowNumber, field, message: `Could not parse date value: ${JSON.stringify(value)}` });
        mapped[field] = null;
      } else {
        mapped[field] = parsed;
      }
    } else {
      mapped[field] = String(value).trim() || null;
    }
  }
  return mapped;
}

export function detectToggleHeader(headers) {
  return headers.find((header) => TOGGLE_HEADER_CANDIDATES.includes(normalizeKey(header)));
}

const CONTACT_HEADER_KEYS = new Set(Object.keys(CONTACT_HEADER_MAP).map(normalizeKey));
const CASE_HEADER_KEYS = new Set(Object.keys(CASE_HEADER_MAP).map(normalizeKey));

/**
 * Identifies whether a sheet is Case Easy's Contacts or Cases export by
 * how many of each export's known column headers it actually contains —
 * the two exports share several column names (Email, Phone, First/Last
 * Name, NOC/TEER, Referral Source, Created), but each also has headers
 * the other doesn't (Contacts: UCI, Marital Status, Date of Birth, Country
 * Of Residence; Cases: Case Number, Case Type, Status, and 15+ more), so a
 * real export always scores decisively higher on its own side. Lets the
 * upload UI accept files without the caller having to label which is
 * which.
 */
export function classifyWorkbookHeaders(headers) {
  const normalized = new Set(headers.map(normalizeKey));
  const contactScore = [...CONTACT_HEADER_KEYS].filter((key) => normalized.has(key)).length;
  const caseScore = [...CASE_HEADER_KEYS].filter((key) => normalized.has(key)).length;
  if (contactScore === 0 && caseScore === 0) return { type: "unknown", contactScore, caseScore };
  if (contactScore === caseScore) return { type: "ambiguous", contactScore, caseScore };
  return { type: contactScore > caseScore ? "contacts" : "cases", contactScore, caseScore };
}

async function upsertContact(agencyId, mapped, importBatchId, stats) {
  const where = mapped.email
    ? { agencyId, email: mapped.email, sourceCreated: mapped.sourceCreated }
    : { agencyId, firstName: mapped.firstName, lastName: mapped.lastName, sourceCreated: mapped.sourceCreated };
  const existing = await prisma.caseEasyImportContact.findFirst({ where });
  if (existing) {
    if (existing.importStatus === "converted") {
      stats.contactsSkippedConverted = (stats.contactsSkippedConverted || 0) + 1;
      return existing; // never overwrite a converted row — see upsertCase's identical guard
    }
    const updated = await prisma.caseEasyImportContact.update({ where: { id: existing.id }, data: { ...mapped, importBatchId } });
    stats.contactsUpdated += 1;
    return updated;
  }
  const created = await prisma.caseEasyImportContact.create({ data: { ...mapped, agencyId, importBatchId } });
  stats.contactsCreated += 1;
  return created;
}

async function upsertCase(agencyId, mapped, importBatchId, prospectOrClient, stats) {
  const data = { ...mapped, prospectOrClient };
  const where = mapped.caseNumber
    ? { agencyId, caseNumber: mapped.caseNumber }
    : { agencyId, email: mapped.email, caseType: mapped.caseType, sourceCreated: mapped.sourceCreated };
  const existing = await prisma.caseEasyImportCase.findFirst({ where });
  if (existing) {
    if (existing.importStatus === "converted") {
      stats.casesSkippedConverted = (stats.casesSkippedConverted || 0) + 1;
      return existing; // never overwrite a converted row
    }
    const updated = await prisma.caseEasyImportCase.update({ where: { id: existing.id }, data: { ...data, importBatchId } });
    stats.casesUpdated += 1;
    return updated;
  }
  const created = await prisma.caseEasyImportCase.create({ data: { ...data, agencyId, importBatchId } });
  stats.casesCreated += 1;
  return created;
}

function normalizeToggle(raw) {
  const value = normalizeKey(raw);
  if (value.includes("client")) return "client";
  if (value.includes("prospect")) return "prospect";
  return null;
}

// Priority when a case qualifies for more than one review reason at once,
// since the schema stores a single needsReviewReason: an unresolved contact
// link is the most fundamental problem, so it's surfaced first.
const REVIEW_REASON_PRIORITY = ["unlinked_contact", "conflicting_toggle", "assignee_mismatch"];

export async function resolveCaseEasyLinks(agencyId, stats = { casesLinked: 0, needsReview: {} }) {
  const [contacts, cases, users] = await Promise.all([
    prisma.caseEasyImportContact.findMany({ where: { agencyId } }),
    prisma.caseEasyImportCase.findMany({ where: { agencyId } }),
    prisma.user.findMany({ where: { agencyId }, select: { id: true, fullName: true } }),
  ]);

  const contactsByEmail = new Map();
  const contactsByIdentifier = new Map();
  const contactsByNamePhone = new Map();
  const caseUpdates = new Map();
  const contactRecordTypes = new Map();
  for (const contact of contacts) {
    if (contact.clientIdentifier) {
      const key = normalizeKey(contact.clientIdentifier);
      if (!contactsByIdentifier.has(key)) contactsByIdentifier.set(key, []);
      contactsByIdentifier.get(key).push(contact);
    }
    if (contact.email) {
      const key = normalizeKey(contact.email);
      if (!contactsByEmail.has(key)) contactsByEmail.set(key, []);
      contactsByEmail.get(key).push(contact);
    }
    if (contact.firstName && contact.lastName && contact.phone) {
      const key = `${normalizeKey(contact.firstName)}|${normalizeKey(contact.lastName)}|${normalizePhoneKey(contact.phone)}`;
      if (!contactsByNamePhone.has(key)) contactsByNamePhone.set(key, []);
      contactsByNamePhone.get(key).push(contact);
    }
  }

  for (const kase of cases) {
    if (kase.importStatus === "converted") continue;

    let linkedContactId = null;
    if (kase.clientIdentifier) {
      const matches = contactsByIdentifier.get(normalizeKey(kase.clientIdentifier)) || [];
      if (matches.length === 1) linkedContactId = matches[0].id;
    }
    if (kase.email) {
      const matches = contactsByEmail.get(normalizeKey(kase.email)) || [];
      if (!linkedContactId && matches.length === 1) linkedContactId = matches[0].id;
    }
    if (!linkedContactId && kase.firstName && kase.lastName && kase.phone) {
      const key = `${normalizeKey(kase.firstName)}|${normalizeKey(kase.lastName)}|${normalizePhoneKey(kase.phone)}`;
      const matches = contactsByNamePhone.get(key) || [];
      if (matches.length === 1) linkedContactId = matches[0].id;
    }

    let resolvedAssigneeUserId = null;
    const assigneeNames = (kase.assignees || "").split(/[,;]/).map((name) => name.trim()).filter(Boolean);
    if (assigneeNames.length === 1) {
      const matches = users.filter((user) => normalizeKey(user.fullName) === normalizeKey(assigneeNames[0]));
      if (matches.length === 1) resolvedAssigneeUserId = matches[0].id;
    }

    const reasons = [];
    if (!linkedContactId) reasons.push("unlinked_contact");
    if (assigneeNames.length > 0 && !resolvedAssigneeUserId) reasons.push("assignee_mismatch");
    const reason = REVIEW_REASON_PRIORITY.find((candidate) => reasons.includes(candidate)) || null;

    kase.linkedContactId = linkedContactId;
    kase.resolvedAssigneeUserId = resolvedAssigneeUserId;
    kase.needsReviewReason = reason;
    kase.needsReviewReasons = reasons;
    kase.importStatus = reason ? "needs_review" : kase.importStatus === "reviewed" ? "reviewed" : "imported";

    if (linkedContactId) stats.casesLinked += 1;
    for (const reviewReason of reasons) {
      stats.needsReview[reviewReason] =
        (stats.needsReview[reviewReason] || 0) + 1;
    }

    caseUpdates.set(kase.id, {
      linkedContactId,
      resolvedAssigneeUserId,
      needsReviewReason: reason,
      needsReviewReasons: reasons,
      importStatus: kase.importStatus,
    });
  }

  for (const contact of contacts) {
    if (contact.importStatus === "converted") continue;
    const linkedCases = cases.filter((kase) => kase.linkedContactId === contact.id);
    let recordType;
    if (linkedCases.length === 0) {
      recordType = "prospect";
    } else {
      const toggles = new Set(linkedCases.map((kase) => normalizeToggle(kase.prospectOrClient)).filter(Boolean));
      recordType = toggles.size === 1 ? [...toggles][0] : null;
      if (toggles.size !== 1) {
        for (const kase of linkedCases) {
          kase.needsReviewReasons = [
            ...new Set([...(kase.needsReviewReasons || []), "conflicting_toggle"]),
          ];
          kase.needsReviewReason =
            REVIEW_REASON_PRIORITY.find((candidate) =>
              kase.needsReviewReasons.includes(candidate),
            ) || "conflicting_toggle";
          kase.importStatus = "needs_review";
          stats.needsReview.conflicting_toggle = (stats.needsReview.conflicting_toggle || 0) + 1;
          caseUpdates.set(kase.id, {
            ...(caseUpdates.get(kase.id) || {}),
            needsReviewReason: kase.needsReviewReason,
            needsReviewReasons: kase.needsReviewReasons,
            importStatus: "needs_review",
          });
        }
      }
    }
    contactRecordTypes.set(contact.id, recordType);
  }

  const operations = [
    ...[...caseUpdates].map(([id, data]) =>
      prisma.caseEasyImportCase.update({ where: { id }, data }),
    ),
    ...[...contactRecordTypes].map(([id, recordType]) =>
      prisma.caseEasyImportContact.update({
        where: { id },
        data: { recordType },
      }),
    ),
  ];
  for (let offset = 0; offset < operations.length; offset += 100) {
    await prisma.$transaction(operations.slice(offset, offset + 100));
  }
}

/**
 * Parses whichever sheet(s) are given — a Contacts export, a Cases export,
 * or both — and, if apply is true, commits to the staging tables and
 * re-runs the join/assignee/record-type resolution pass over the agency's
 * *entire* staging set (not just this batch), so a Cases-only import today
 * still gets correctly linked once the matching Contacts file is imported
 * later, and vice versa — the two files never had to arrive together. If
 * apply is false, only parsing happens (errors + row previews) — no DB
 * writes at all, safe to call as a preview before anything is stored.
 */
export async function importCaseEasyExports({ agencyId, contactsWorkbook, casesWorkbook, prospectOrClientOverride, apply }) {
  if (!contactsWorkbook && !casesWorkbook) {
    throw new Error("At least one of contactsWorkbook or casesWorkbook is required.");
  }

  const errors = [];
  const stats = { contactsCreated: 0, contactsUpdated: 0, casesCreated: 0, casesUpdated: 0, casesLinked: 0, needsReview: {} };

  const contactsSheet = contactsWorkbook ? readSheetRowsFromWorkbook(contactsWorkbook, "contacts") : null;
  const casesSheet = casesWorkbook ? readSheetRowsFromWorkbook(casesWorkbook, "cases") : null;
  if ((contactsSheet?.rows.length || 0) > 10_000 || (casesSheet?.rows.length || 0) > 10_000) {
    const error = new Error(
      "Case Easy Contacts and Cases imports are limited to 10,000 rows per file.",
    );
    error.code = "IMPORT_TOO_LARGE";
    throw error;
  }

  const toggleHeader = casesSheet ? detectToggleHeader(casesSheet.headers) : null;
  if (casesSheet && !toggleHeader && !prospectOrClientOverride) {
    const error = new Error(
      `No Prospect/Client toggle column found in the Cases file (checked for: ${TOGGLE_HEADER_CANDIDATES.join(", ")}). ` +
      `Specify which Case Easy tab this file came from instead.`,
    );
    error.code = "TOGGLE_COLUMN_NOT_FOUND";
    throw error;
  }

  const mappedContacts = contactsSheet
    ? contactsSheet.rows.map((row) => {
        const mapped = mapRow(
          row,
          CONTACT_HEADER_MAP,
          CONTACT_DATE_FIELDS,
          "contacts",
          errors,
        );
        if (
          !mapped.email &&
          !mapped.phone &&
          !mapped.firstName &&
          !mapped.lastName
        ) {
          errors.push({
            sheet: "contacts",
            row: row.rowNumber,
            field: "identity",
            message: "Contact has no name, email, or phone.",
          });
        }
        return mapped;
      })
    : [];
  const mappedCases = casesSheet
    ? casesSheet.rows.map((row) => {
        const mapped = mapRow(
          row,
          CASE_HEADER_MAP,
          CASE_DATE_FIELDS,
          "cases",
          errors,
        );
        if (!mapped.caseNumber) {
          errors.push({
            sheet: "cases",
            row: row.rowNumber,
            field: "caseNumber",
            message: "Case Number is missing; fallback deduplication will be used.",
          });
        }
        if (!mapped.caseType) {
          errors.push({
            sheet: "cases",
            row: row.rowNumber,
            field: "caseType",
            message: "Case Type is missing and must be supplied during conversion.",
          });
        }
        return {
          mapped,
          prospectOrClient: toggleHeader
            ? row.raw[toggleHeader] ?? null
            : prospectOrClientOverride,
        };
      })
    : [];

  const importBatchId = `case-easy-${new Date().toISOString().replace(/[:.]/g, "-")}`;

  if (apply) {
    for (const mapped of mappedContacts) await upsertContact(agencyId, mapped, importBatchId, stats);
    for (const { mapped, prospectOrClient } of mappedCases) await upsertCase(agencyId, mapped, importBatchId, prospectOrClient, stats);
    await resolveCaseEasyLinks(agencyId, stats);
  }

  return {
    importBatchId,
    toggleHeaderFound: Boolean(toggleHeader),
    contactRowCount: contactsSheet ? contactsSheet.rows.length : null,
    caseRowCount: casesSheet ? casesSheet.rows.length : null,
    contactPreview: mappedContacts.slice(0, 5),
    casePreview: mappedCases.slice(0, 5).map((entry) => ({ ...entry.mapped, prospectOrClient: entry.prospectOrClient })),
    errors,
    stats: apply ? stats : null,
  };
}
