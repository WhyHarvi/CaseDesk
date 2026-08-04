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

// Bounded worker pool — runs `task` over `items` with at most `concurrency`
// calls in flight at once, instead of either fully sequential (slow: each
// await pays a full DB round trip before the next starts) or fully
// parallel (risks overwhelming a small connection pool, e.g. a pooled
// Postgres connection_limit).
async function runInConcurrentBatches(items, concurrency, task) {
  let index = 0;
  async function worker() {
    while (index < items.length) {
      const current = items[index++];
      await task(current);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
}
const WRITE_CONCURRENCY = 20;

function dateKeyPart(value) {
  return value instanceof Date ? value.toISOString() : value == null ? "" : String(value);
}

// Mirrors upsertContact's old `where` clause exactly (same fields, same
// exact-match semantics) so a batch of database rows and a batch of
// mapped file rows can be matched against each other in memory instead of
// one findFirst() per row.
function contactMatchKey(record) {
  const created = dateKeyPart(record.sourceCreated);
  return record.email
    ? `email ${record.email} ${created}`
    : `name ${record.firstName ?? ""} ${record.lastName ?? ""} ${created}`;
}

function caseMatchKey(record) {
  const created = dateKeyPart(record.sourceCreated);
  return record.caseNumber
    ? `number ${record.caseNumber}`
    : `fallback ${record.email ?? ""} ${record.caseType ?? ""} ${created}`;
}

// Builds a create/update/skip plan for a whole file's worth of mapped rows
// against one upfront snapshot of existing rows, instead of a per-row
// findFirst+create/update round trip. When two mapped rows in the same
// file share a match key and neither matches an existing row, the plan
// keeps only the *last* one as the row to create — matching what the old
// sequential version did (row 2 would have found row 1's just-created
// record via findFirst and updated it in place, so only row 2's values
// survive). The one deliberate behavioral difference: stats.*Updated
// undercounts in that specific same-file-duplicate-key case, since it's
// folded into a single create — informational counts only, not worth the
// extra bookkeeping for what should be a rare edge case in a real export.
function planUpserts(existingRecords, mappedRecords, matchKey) {
  const existingByKey = new Map();
  for (const record of existingRecords) {
    const key = matchKey(record);
    if (!existingByKey.has(key)) existingByKey.set(key, record);
  }
  const plan = new Map();
  for (const mapped of mappedRecords) {
    const key = matchKey(mapped);
    const existing = existingByKey.get(key);
    if (existing) {
      if (existing.importStatus === "converted") plan.set(key, { action: "skip" });
      else plan.set(key, { action: "update", id: existing.id, mapped });
      continue;
    }
    const pending = plan.get(key);
    if (pending?.action === "update") plan.set(key, { action: "update", id: pending.id, mapped });
    else plan.set(key, { action: "create", mapped });
  }
  return [...plan.values()];
}

async function batchUpsertContacts(agencyId, mappedContacts, importBatchId, stats) {
  if (!mappedContacts.length) return;
  const existing = await prisma.caseEasyImportContact.findMany({ where: { agencyId } });
  const plan = planUpserts(existing, mappedContacts, contactMatchKey);

  const toCreate = plan.filter((entry) => entry.action === "create");
  const toUpdate = plan.filter((entry) => entry.action === "update");
  const skipped = plan.filter((entry) => entry.action === "skip");

  if (toCreate.length) {
    await prisma.caseEasyImportContact.createMany({
      data: toCreate.map((entry) => ({ ...entry.mapped, agencyId, importBatchId })),
    });
  }
  await runInConcurrentBatches(toUpdate, WRITE_CONCURRENCY, (entry) =>
    prisma.caseEasyImportContact.update({ where: { id: entry.id }, data: { ...entry.mapped, importBatchId } }),
  );

  stats.contactsCreated += toCreate.length;
  stats.contactsUpdated += toUpdate.length;
  stats.contactsSkippedConverted = (stats.contactsSkippedConverted || 0) + skipped.length;
}

async function batchUpsertCases(agencyId, mappedCases, importBatchId, stats) {
  if (!mappedCases.length) return;
  const existing = await prisma.caseEasyImportCase.findMany({ where: { agencyId } });
  const plan = planUpserts(
    existing,
    mappedCases.map(({ mapped, prospectOrClient }) => ({ ...mapped, prospectOrClient })),
    caseMatchKey,
  );

  const toCreate = plan.filter((entry) => entry.action === "create");
  const toUpdate = plan.filter((entry) => entry.action === "update");
  const skipped = plan.filter((entry) => entry.action === "skip");

  if (toCreate.length) {
    await prisma.caseEasyImportCase.createMany({
      data: toCreate.map((entry) => ({ ...entry.mapped, agencyId, importBatchId })),
    });
  }
  await runInConcurrentBatches(toUpdate, WRITE_CONCURRENCY, (entry) =>
    prisma.caseEasyImportCase.update({ where: { id: entry.id }, data: { ...entry.mapped, importBatchId } }),
  );

  stats.casesCreated += toCreate.length;
  stats.casesUpdated += toUpdate.length;
  stats.casesSkippedConverted = (stats.casesSkippedConverted || 0) + skipped.length;
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
  // Each 100-row chunk touches disjoint rows (keyed by id), so unlike the
  // per-row upsert loop above this doesn't need to stay sequential — running
  // several chunks at once cuts wall-clock time by roughly the concurrency
  // factor, since the bottleneck here is round-trip count, not statement
  // cost (each is a trivial primary-key update).
  const chunks = [];
  for (let offset = 0; offset < operations.length; offset += 100) chunks.push(operations.slice(offset, offset + 100));
  await runInConcurrentBatches(chunks, 8, (chunk) => prisma.$transaction(chunk));
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
    await batchUpsertContacts(agencyId, mappedContacts, importBatchId, stats);
    await batchUpsertCases(agencyId, mappedCases, importBatchId, stats);
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
