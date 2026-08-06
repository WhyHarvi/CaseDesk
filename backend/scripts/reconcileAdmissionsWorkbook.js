import "dotenv/config";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ExcelJS from "exceljs";
import prisma from "../src/services/prisma/client.js";
import { nextLeadNumber } from "../src/modules/leads/lead.repository.js";

const DEFAULT_AGENCY_ID = "8afe0d4e-7a0c-44d4-9163-a70ac2ed6e8e";
const agencyId = process.env.ADMISSIONS_RECONCILE_AGENCY_ID || DEFAULT_AGENCY_ID;
const apply = process.argv.includes("--apply");
const verbose = process.argv.includes("--verbose");
const RECONCILIATION_VERSION = 1;
const RECONCILIATION_ACTION = "admissions.workbook_reconciled";
const RECONCILED_ADMISSIONS_TITLE = "Admissions detail (reconciled)";
const RECONCILED_FOLLOW_UP_TITLE = "Follow-up (reconciled)";
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const workbookPath = path.resolve(scriptDir, "../../docs/production/Admissions 2026.xlsx");

const text = (value) => {
  if (value == null) return "";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "object" && typeof value.text === "string") return value.text.trim();
  if (typeof value === "object" && Array.isArray(value.richText)) {
    return value.richText.map((part) => part.text || "").join("").trim();
  }
  return String(value).trim();
};

const normalizeText = (value) => text(value)
  .normalize("NFKD")
  .replace(/[\u0300-\u036f]/g, "")
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, " ")
  .trim();

const normalizeName = (value) => normalizeText(value);

const normalizePhone = (value) => {
  const digits = text(value).replace(/\D/g, "");
  if (!digits) return "";
  if (digits.length === 11 && digits.startsWith("1")) return digits.slice(1);
  return digits;
};

const stripCategory = (value) => text(value).replace(/\s*\[Category:\s*[^\]]+\]\s*$/i, "").trim();

const fullName = (lead) => [lead?.firstName, lead?.lastName].filter(Boolean).join(" ").trim();

const repairedInvalidRows = new Map([
  [11, { phone: "+91 94649 95347", phoneNormalized: "+919464995347", inquiryDate: new Date(Date.UTC(2026, 5, 22)), confirmedPlaceholderLeadNumber: "LD-2026-000253" }],
  [155, { phone: "8860766063", phoneNormalized: null, inquiryDate: new Date(Date.UTC(2026, 6, 17)) }],
  [167, { phone: "+44 7818 931424", phoneNormalized: "+447818931424", inquiryDate: new Date(Date.UTC(2026, 6, 20)) }],
  [191, { phone: "+1 780 219 8335", phoneNormalized: "+17802198335", name: "Manpreet Singh", inquiryDate: new Date(Date.UTC(2026, 6, 25)) }],
  // The surrounding rows are July 29; the source cell's September value is
  // a spreadsheet typo, not a future inquiry.
  [218, { phone: "+44 7768 751208", phoneNormalized: "+447768751208", inquiryDate: new Date(Date.UTC(2026, 6, 29)) }],
]);

function splitName(value) {
  const parts = text(value).split(/\s+/).filter(Boolean);
  return { firstName: parts.shift() || null, lastName: parts.join(" ") || null };
}

function asUtcDate(year, month, day) {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return null;
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const result = new Date(Date.UTC(year, month - 1, day));
  return result.getUTCFullYear() === year && result.getUTCMonth() === month - 1 && result.getUTCDate() === day
    ? result
    : null;
}

// This workbook was authored day/month/year, but Excel stored several entries
// as month/day dates. A stored 2026-04-08 therefore represents 04/08/2026.
function parseWorkbookDate(value, { forceYear = 2026 } = {}) {
  if (!value) return null;
  if (value instanceof Date) {
    return asUtcDate(forceYear, value.getUTCDate(), value.getUTCMonth() + 1);
  }
  const raw = text(value);
  const dayFirst = raw.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{2,4})$/);
  if (dayFirst) return asUtcDate(forceYear || Number(dayFirst[3]), Number(dayFirst[2]), Number(dayFirst[1]));
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return asUtcDate(forceYear || Number(iso[1]), Number(iso[2]), Number(iso[3]));
  return null;
}

function latestFollowUpNote(row) {
  const notes = [text(row.note1), text(row.note2), text(row.note3)];
  const nextDates = [row.date1, row.date2, row.date3];
  let noteIndex = -1;
  for (let index = 0; index < notes.length; index += 1) if (notes[index]) noteIndex = index;
  if (noteIndex < 0) return null;
  const occurrenceSource = noteIndex === 0 ? row.date : nextDates[noteIndex - 1];
  return {
    noteIndex: noteIndex + 1,
    description: notes[noteIndex],
    occurredAt: parseWorkbookDate(occurrenceSource) || parseWorkbookDate(row.date),
    nextActionAt: parseWorkbookDate(nextDates[noteIndex]),
  };
}

function admissionActivityMatch(row, activities, orderedRows = []) {
  const wantedProgram = normalizeText(row.program);
  const wantedRemarks = normalizeText(row.remarks);
  const matches = activities.filter((activity) => {
    const description = normalizeText(activity.description);
    return description.includes(wantedProgram)
      && (!wantedRemarks || description.includes(wantedRemarks));
  });
  if (matches.length === 1) return matches[0];
  if (activities.length === orderedRows.length) {
    const index = orderedRows.findIndex((candidate) => candidate.rowNumber === row.rowNumber);
    const positional = index >= 0 ? activities[index] : null;
    const description = normalizeText(positional?.description);
    if (positional && description.includes(wantedProgram)
      && (!wantedRemarks || description.includes(wantedRemarks))) return positional;
  }
  return null;
}

function repairedInitialMessage(baseRow) {
  const remarks = text(baseRow.remarks);
  const category = text(baseRow.category);
  return [remarks, category ? `[Category: ${category}]` : ""].filter(Boolean).join(" ");
}

function cellValue(row, column) {
  return row.getCell(column).value;
}

function worksheetRows(sheet, columns) {
  const rows = [];
  for (let rowNumber = 2; rowNumber <= sheet.rowCount; rowNumber += 1) {
    const row = sheet.getRow(rowNumber);
    const record = { rowNumber };
    for (const [key, column] of Object.entries(columns)) record[key] = cellValue(row, column);
    if (Object.values(record).some((value, index) => index > 0 && text(value))) rows.push(record);
  }
  return rows;
}

function chooseImportRow(baseRow, importRows) {
  const wantedName = normalizeName(baseRow.name);
  const wantedPhone = normalizePhone(baseRow.phone);
  const wantedRemarks = normalizeText(baseRow.remarks);
  const candidates = importRows.filter((row) => {
    const raw = row.rawData || {};
    return normalizeName(raw["Full Name"]) === wantedName
      && normalizePhone(raw["Phone No"]) === wantedPhone;
  });
  if (candidates.length <= 1) return candidates[0] || null;
  return candidates.find((row) => normalizeText(stripCategory(row.rawData?.Remarks)) === wantedRemarks)
    || candidates[0];
}

function leadForImportRow(importRow) {
  if (!importRow) return null;
  if (importRow.createdLead) return importRow.createdLead;
  const candidates = importRow.incomingEvent?.duplicateCandidates || [];
  if (!candidates.length) return null;
  return [...candidates].sort((left, right) => right.score - left.score)[0].candidateLead;
}

function candidateSummary(baseRow) {
  return {
    baseRow: baseRow.rowNumber,
    name: text(baseRow.name),
    phone: text(baseRow.phone),
    remarks: text(baseRow.remarks),
    importStatus: baseRow.importRow?.status || "NOT_IMPORTED",
    leadNumber: baseRow.lead?.leadNumber || null,
    leadId: baseRow.lead?.id || null,
  };
}

function distinctLeads(rows) {
  const unique = new Map();
  for (const row of rows) if (row.lead) unique.set(row.lead.id, row.lead);
  return [...unique.values()];
}

function followUpCandidates(followUp, baseRows) {
  const phone = normalizePhone(followUp.phone);
  const name = normalizeName(followUp.name);
  const phoneMatches = phone ? baseRows.filter((row) => normalizePhone(row.phone) === phone) : [];
  if (phoneMatches.length) {
    const exactName = phoneMatches.filter((row) => normalizeName(row.name) === name);
    const candidates = exactName.length ? exactName : phoneMatches;
    const leads = distinctLeads(candidates);
    return { method: exactName.length ? "phone+name" : "phone", candidates, leads };
  }
  const exactName = baseRows.filter((row) => normalizeName(row.name) === name);
  return { method: exactName.length ? "name-only" : "unmatched", candidates: exactName, leads: distinctLeads(exactName) };
}

const confirmedBaseRowOverrides = new Map([
  [3, 15],
  [4, 65],
  [6, 41],
  [7, 18],
  [8, 90],
  [9, 101],
  [10, 89],
  // The later Follow up row uses the same 437-220-2215 contact and discusses
  // the same ESL/online-study path, resolving the duplicate Mandeep names.
  [11, 47],
  [13, 153],
  [15, 113],
  [16, 41],
  [17, 194],
  [18, 198],
  [20, 235],
]);

function confirmedCandidates(confirmed, baseRows) {
  const override = confirmedBaseRowOverrides.get(confirmed.rowNumber);
  if (override) {
    const row = baseRows.find((candidate) => candidate.rowNumber === override);
    return { method: "verified-override", candidates: row ? [row] : [], leads: row?.lead ? [row.lead] : [] };
  }
  const name = normalizeName(confirmed.name);
  const exactName = baseRows.filter((row) => normalizeName(row.name) === name);
  return {
    method: exactName.length === 1 ? "unique-name" : exactName.length > 1 ? "ambiguous-name" : "unmatched",
    candidates: exactName,
    leads: distinctLeads(exactName),
  };
}

async function refreshImportBatchCounts(tx, batchIds) {
  for (const batchId of new Set(batchIds)) {
    const [totalRows, invalidRows, processedRows, duplicateRows, failedRows] = await Promise.all([
      tx.leadImportRow.count({ where: { batchId } }),
      tx.leadImportRow.count({ where: { batchId, status: "INVALID" } }),
      tx.leadImportRow.count({ where: { batchId, status: "PROCESSED" } }),
      tx.leadImportRow.count({ where: { batchId, status: "DUPLICATE" } }),
      tx.leadImportRow.count({ where: { batchId, status: "FAILED" } }),
    ]);
    await tx.leadImportBatch.update({
      where: { id: batchId },
      data: {
        totalRows,
        validRows: totalRows - invalidRows,
        invalidRows,
        processedRows,
        duplicateRows,
        failedRows,
      },
    });
  }
}

async function repairReferencedInvalidLeadRows(tx, baseRows, onlyRowNumbers = null) {
  const repaired = [];
  const batchIds = [];
  for (const [baseRowNumber, repair] of repairedInvalidRows) {
    if (onlyRowNumbers && !onlyRowNumbers.has(baseRowNumber)) continue;
    const baseRow = baseRows.find((row) => row.rowNumber === baseRowNumber);
    if (!baseRow?.importRow) throw new Error(`Cannot find the import row for Leads!${baseRowNumber}.`);
    if (baseRow.lead) continue;
    if (baseRow.importRow.status !== "INVALID") {
      throw new Error(`Leads!${baseRowNumber} has no CRM lead but its import status is ${baseRow.importRow.status}.`);
    }
    const resolvedName = repair.name || text(baseRow.name);
    const { firstName, lastName } = splitName(resolvedName);
    const batch = baseRow.importRow.batch;
    const ownerUserId = batch?.settings?.ownerUserId;
    if (!batch?.sourceId || !ownerUserId) throw new Error(`Leads!${baseRowNumber} import settings are incomplete.`);

    let lead;
    if (repair.confirmedPlaceholderLeadNumber) {
      lead = await tx.lead.findFirst({
        where: { agencyId, leadNumber: repair.confirmedPlaceholderLeadNumber, deletedAt: null },
      });
      if (!lead) throw new Error(`Expected placeholder ${repair.confirmedPlaceholderLeadNumber} was not found.`);
      lead = await tx.lead.update({
        where: { id: lead.id },
        data: {
          firstName,
          lastName,
          phone: repair.phone,
          phoneNormalized: repair.phoneNormalized,
          country: text(baseRow.country) || null,
          inquiryDate: repair.inquiryDate || parseWorkbookDate(baseRow.date) || lead.inquiryDate,
          originalSourceId: batch.sourceId,
          initialMessage: repairedInitialMessage(baseRow),
          nextActionType: "CALL",
          nextActionDescription: "Review the confirmed-student admission and contact Mandeep Kaur",
          nextActionAt: new Date(),
          nextActionOwnerId: lead.nextActionOwnerId || lead.ownerUserId,
          version: { increment: 1 },
        },
      });
      const pendingFollowUp = await tx.leadFollowUp.findFirst({
        where: { agencyId, leadId: lead.id, status: "PENDING" },
      });
      if (!pendingFollowUp) {
        await tx.leadFollowUp.create({
          data: {
            agencyId,
            leadId: lead.id,
            assignedUserId: lead.nextActionOwnerId || lead.ownerUserId,
            type: "CALL",
            description: "Review the confirmed-student admission and contact Mandeep Kaur",
            dueAt: lead.nextActionAt,
          },
        });
      }
    } else {
      const collision = repair.phoneNormalized
        ? await tx.lead.findFirst({ where: { agencyId, phoneNormalized: repair.phoneNormalized, deletedAt: null } })
        : null;
      if (collision) {
        throw new Error(`Leads!${baseRowNumber} repaired phone already belongs to ${collision.leadNumber}.`);
      }
      const leadNumber = await nextLeadNumber(tx, agencyId);
      lead = await tx.lead.create({
        data: {
          agencyId,
          leadNumber,
          firstName,
          lastName,
          phone: repair.phone,
          phoneNormalized: repair.phoneNormalized,
          country: text(baseRow.country) || null,
          inquiryDate: repair.inquiryDate || parseWorkbookDate(baseRow.date) || new Date(),
          ownerUserId,
          originalSourceId: batch.sourceId,
          initialMessage: repairedInitialMessage(baseRow),
          status: "OPEN",
          stage: normalizeText(baseRow.status) === "contacted" ? "CONTACTING" : "NEW",
          priority: "NORMAL",
          temperature: "COLD",
          nextActionType: "CALL",
          nextActionDescription: "Review the imported follow-up and schedule the next step",
          nextActionAt: new Date(),
          nextActionOwnerId: ownerUserId,
        },
      });
      await tx.leadActivity.create({
        data: {
          agencyId,
          leadId: lead.id,
          activityType: "LEAD_CREATED",
          direction: "INTERNAL",
          channel: "OTHER",
          title: "Lead recovered from Admissions 2026 import",
          description: repairedInitialMessage(baseRow),
          metadata: { workbook: "Admissions 2026.xlsx", worksheet: "Leads", rowNumber: baseRowNumber, reconciliationVersion: RECONCILIATION_VERSION },
          occurredAt: parseWorkbookDate(baseRow.date) || new Date(),
        },
      });
      await tx.leadStageHistory.create({
        data: { agencyId, leadId: lead.id, newStage: lead.stage, reason: `Recovered from Admissions 2026 Leads row ${baseRowNumber}` },
      });
      await tx.leadAssignmentHistory.create({
        data: { agencyId, leadId: lead.id, newOwnerId: ownerUserId, assignmentType: "SYSTEM", reason: `Recovered from Admissions 2026 Leads row ${baseRowNumber}` },
      });
      await tx.leadFollowUp.create({
        data: {
          agencyId,
          leadId: lead.id,
          assignedUserId: ownerUserId,
          type: "CALL",
          description: "Review the imported follow-up and schedule the next step",
          dueAt: lead.nextActionAt,
        },
      });
    }

    const normalizedData = {
      ...(baseRow.importRow.normalizedData && typeof baseRow.importRow.normalizedData === "object" ? baseRow.importRow.normalizedData : {}),
      firstName,
      lastName,
      phone: repair.phone,
      phoneNormalized: repair.phoneNormalized,
      country: text(baseRow.country) || null,
      initialMessage: repairedInitialMessage(baseRow),
    };
    await tx.leadImportRow.update({
      where: { id: baseRow.importRow.id },
      data: { status: "PROCESSED", validationErrors: [], normalizedData, createdLeadId: lead.id },
    });
    baseRow.lead = lead;
    baseRow.importRow.status = "PROCESSED";
    baseRow.importRow.createdLead = lead;
    batchIds.push(baseRow.importRow.batchId);
    repaired.push({ baseRow: baseRowNumber, leadId: lead.id, leadNumber: lead.leadNumber, name: fullName(lead) });
  }
  await refreshImportBatchCounts(tx, batchIds);
  return repaired;
}

async function applyAdmissionsReconciliation(tx, confirmedRows, baseRows, admissionsActivities, onlyRowNumbers = null) {
  const moved = [];
  const unresolved = [];
  const stageTargets = new Map();
  for (const row of confirmedRows) {
    if (onlyRowNumbers && !onlyRowNumbers.has(row.rowNumber)) continue;
    const activity = admissionActivityMatch(row, admissionsActivities, confirmedRows);
    if (!activity) throw new Error(`Could not uniquely identify the admissions activity for Confirmed Students!${row.rowNumber}.`);
    const match = confirmedCandidates(row, baseRows);
    const target = match.leads.length === 1 ? match.leads[0] : null;
    const previousLeadId = activity.leadId;
    const metadata = {
      ...(activity.metadata && typeof activity.metadata === "object" ? activity.metadata : {}),
      workbook: "Admissions 2026.xlsx",
      worksheet: "Confirmed Students",
      rowNumber: row.rowNumber,
      reconciliationVersion: RECONCILIATION_VERSION,
      matchMethod: match.method,
      matchStatus: target ? "resolved" : "unresolved",
      candidateLeadNumbers: match.leads.map((lead) => lead.leadNumber),
      originalActivityId: activity.id,
    };
    if (!target) {
      const existing = await tx.leadActivity.findMany({
        where: { agencyId, leadId: activity.leadId, title: RECONCILED_ADMISSIONS_TITLE },
        select: { metadata: true },
      });
      if (!existing.some((item) => Number(item.metadata?.rowNumber) === row.rowNumber)) {
        await tx.leadActivity.create({
          data: {
            agencyId,
            leadId: activity.leadId,
            activityType: "INTERNAL_NOTE",
            direction: "INTERNAL",
            channel: "OTHER",
            title: RECONCILED_ADMISSIONS_TITLE,
            description: activity.description,
            occurredAt: parseWorkbookDate(row.date) || activity.occurredAt,
            metadata,
          },
        });
      }
      unresolved.push({ row: row.rowNumber, name: text(row.name), reason: match.method, currentLeadNumber: activity.lead.leadNumber });
      continue;
    }
    stageTargets.set(target.id, target);
    if (row.rowNumber === 4 && !target.lastName) {
      await tx.lead.update({ where: { id: target.id }, data: { lastName: "Davit", version: { increment: 1 } } });
      target.lastName = "Davit";
    }
    if (target.id !== previousLeadId) {
      const ledgerEntries = await tx.caseManualLedgerEntry.findMany({
        where: {
          agencyId,
          leadId: previousLeadId,
          caseId: null,
          clientId: null,
          label: { in: ["Registration Fee", "After Visa Fee"] },
        },
        select: { id: true },
      });
      if (ledgerEntries.length > 2) {
        throw new Error(`Refusing to move ${ledgerEntries.length} ledger entries from ${activity.lead.leadNumber}; expected at most two.`);
      }
      if (ledgerEntries.length) {
        await tx.caseManualLedgerEntry.updateMany({
          where: { id: { in: ledgerEntries.map((entry) => entry.id) } },
          data: { leadId: target.id, note: `Imported from Admissions 2026, Confirmed Students row ${row.rowNumber}.` },
        });
      }
      moved.push({
        row: row.rowNumber,
        name: text(row.name),
        activityId: activity.id,
        fromLeadId: previousLeadId,
        fromLeadNumber: activity.lead.leadNumber,
        toLeadId: target.id,
        toLeadNumber: target.leadNumber,
        ledgerEntryIds: ledgerEntries.map((entry) => entry.id),
      });
      const correctionActivities = await tx.leadActivity.findMany({
        where: { agencyId, leadId: previousLeadId, title: "Admissions import association corrected" },
        select: { metadata: true },
      });
      if (!correctionActivities.some((item) => Number(item.metadata?.rowNumber) === row.rowNumber)) {
        await tx.leadActivity.create({
          data: {
            agencyId,
            leadId: previousLeadId,
            activityType: "LEAD_MERGED",
            direction: "INTERNAL",
            channel: "OTHER",
            title: "Admissions import association corrected",
            description: `The imported admissions detail and ledger association belongs to ${target.leadNumber}, not this lead. The original activity is retained as immutable audit history.`,
            occurredAt: new Date(),
            metadata: { ...metadata, correctedLeadId: target.id, correctedLeadNumber: target.leadNumber },
          },
        });
      }
    }
    const existing = await tx.leadActivity.findMany({
      where: { agencyId, leadId: target.id, title: RECONCILED_ADMISSIONS_TITLE },
      select: { metadata: true },
    });
    if (!existing.some((item) => Number(item.metadata?.rowNumber) === row.rowNumber)) {
      await tx.leadActivity.create({
        data: {
          agencyId,
          leadId: target.id,
          activityType: "INTERNAL_NOTE",
          direction: "INTERNAL",
          channel: "OTHER",
          title: RECONCILED_ADMISSIONS_TITLE,
          description: activity.description,
          occurredAt: parseWorkbookDate(row.date) || activity.occurredAt,
          metadata,
        },
      });
    }
  }

  for (const target of stageTargets.values()) {
    const current = await tx.lead.findUnique({ where: { id: target.id } });
    if (current?.stage !== "READY_TO_CONVERT") {
      await tx.lead.update({ where: { id: target.id }, data: { stage: "READY_TO_CONVERT", version: { increment: 1 } } });
      await tx.leadStageHistory.create({
        data: {
          agencyId,
          leadId: target.id,
          previousStage: current.stage,
          newStage: "READY_TO_CONVERT",
          reason: "Matched to the Admissions 2026 Confirmed Students tab",
        },
      });
    }
  }

  const loveleenMove = moved.find((item) => item.row === 4 && item.fromLeadNumber === "LD-2026-000252");
  const shouldHandleLoveleen = !onlyRowNumbers || onlyRowNumbers.has(4);
  const loveleenPlaceholder = shouldHandleLoveleen
    ? await tx.lead.findFirst({ where: { agencyId, leadNumber: "LD-2026-000252", deletedAt: undefined } })
    : null;
  if (shouldHandleLoveleen && loveleenPlaceholder && !loveleenPlaceholder.deletedAt) {
    const remainingRelations = await Promise.all([
      tx.caseManualLedgerEntry.count({ where: { leadId: loveleenPlaceholder.id } }),
      tx.leadFollowUp.count({ where: { leadId: loveleenPlaceholder.id } }),
      tx.appointment.count({ where: { leadId: loveleenPlaceholder.id } }),
      tx.leadConsultation.count({ where: { leadId: loveleenPlaceholder.id } }),
    ]);
    if (remainingRelations.some(Boolean)) throw new Error("Loveleen placeholder still has related records after the merge.");
    await tx.lead.update({
      where: { id: loveleenPlaceholder.id },
      data: {
        status: "DUPLICATE",
        deletedAt: new Date(),
        nextActionType: null,
        nextActionDescription: null,
        nextActionAt: null,
        nextActionOwnerId: null,
        version: { increment: 1 },
      },
    });
  }
  return { moved, unresolved, confirmedStageLeadIds: [...stageTargets.keys()], mergedPlaceholderLeadId: loveleenPlaceholder?.id || loveleenMove?.fromLeadId || null };
}

async function applyFollowUpReconciliation(db, followUpRows, baseRows, oldFollowUpActivities) {
  const oldSnapshots = oldFollowUpActivities.map((activity) => ({
    id: activity.id,
    leadId: activity.leadId,
    leadNumber: activity.lead.leadNumber,
    description: activity.description,
    occurredAt: activity.occurredAt,
  }));
  const createdActivities = [];
  const createdFollowUps = [];
  const reviewFollowUps = [];
  const unresolved = [];
  const workItems = [];
  for (const row of followUpRows) {
    const match = followUpCandidates(row, baseRows);
    const target = match.leads.length === 1 ? match.leads[0] : null;
    if (!target) {
      unresolved.push({ row: row.rowNumber, name: text(row.name), phone: text(row.phone), reason: match.method });
      continue;
    }
    const latest = latestFollowUpNote(row);
    if (!latest) continue;
    const occurredAt = latest.occurredAt || new Date();
    const activityData = {
      agencyId,
      leadId: target.id,
      activityType: "INTERNAL_NOTE",
      direction: "INTERNAL",
      channel: "OTHER",
      title: RECONCILED_FOLLOW_UP_TITLE,
      description: latest.description,
      occurredAt,
      metadata: {
        workbook: "Admissions 2026.xlsx",
        worksheet: "Follow up",
        rowNumber: row.rowNumber,
        noteIndex: latest.noteIndex,
        reconciliationVersion: RECONCILIATION_VERSION,
        matchMethod: match.method,
      },
    };
    workItems.push({ row, target, latest, occurredAt, activityData });
    createdActivities.push({ row: row.rowNumber, leadId: target.id, leadNumber: target.leadNumber });
  }

  const existingCorrectedActivities = await db.leadActivity.findMany({
    where: { agencyId, title: RECONCILED_FOLLOW_UP_TITLE },
    select: { metadata: true },
  });
  const existingRows = new Set(existingCorrectedActivities.map((activity) => Number(activity.metadata?.rowNumber)));
  const missingActivityData = workItems
    .filter((item) => !existingRows.has(item.row.rowNumber))
    .map((item) => item.activityData);
  if (missingActivityData.length) await db.leadActivity.createMany({ data: missingActivityData });

  const processWorkItem = ({ row, target, latest, occurredAt }) => db.$transaction(async (tx) => {
    const currentLead = await tx.lead.findUnique({ where: { id: target.id } });
    if (!currentLead) throw new Error(`Lead ${target.leadNumber} disappeared during follow-up reconciliation.`);
    if (latest.nextActionAt) {
      await tx.leadFollowUp.updateMany({
        where: {
          agencyId,
          leadId: target.id,
          status: "PENDING",
          description: { in: ["Contact the new lead", "Review the imported follow-up and schedule the next step"] },
        },
        data: {
          status: "COMPLETED",
          completedAt: parseWorkbookDate(row.date) || occurredAt,
          completionOutcome: text(row.note1) || latest.description,
        },
      });
      let followUp = await tx.leadFollowUp.findFirst({
        where: {
          agencyId,
          leadId: target.id,
          status: "PENDING",
          dueAt: latest.nextActionAt,
          description: latest.description,
        },
      });
      if (!followUp) {
        followUp = await tx.leadFollowUp.create({
          data: {
            agencyId,
            leadId: target.id,
            assignedUserId: currentLead.nextActionOwnerId || currentLead.ownerUserId,
            type: "CALL",
            description: latest.description,
            dueAt: latest.nextActionAt,
          },
        });
      }
      await tx.lead.update({
        where: { id: target.id },
        data: {
          nextActionType: "CALL",
          nextActionDescription: latest.description,
          nextActionAt: latest.nextActionAt,
          nextActionOwnerId: currentLead.nextActionOwnerId || currentLead.ownerUserId,
          firstContactAt: currentLead.firstContactAt || parseWorkbookDate(row.date) || occurredAt,
          lastContactAt: !currentLead.lastContactAt || currentLead.lastContactAt < occurredAt ? occurredAt : currentLead.lastContactAt,
          version: { increment: 1 },
        },
      });
      return { kind: "scheduled", id: followUp.id, row: row.rowNumber, leadId: target.id, leadNumber: target.leadNumber, dueAt: latest.nextActionAt };
    }

    const reviewDescription = `Review follow-up: ${latest.description}`;
    const reviewDueAt = new Date();
    let review = await tx.leadFollowUp.findFirst({
      where: {
        agencyId,
        leadId: target.id,
        status: "PENDING",
        description: { in: ["Contact the new lead", "Review the imported follow-up and schedule the next step", reviewDescription] },
      },
    });
    if (review) {
      review = await tx.leadFollowUp.update({
        where: { id: review.id },
        data: { description: reviewDescription, dueAt: reviewDueAt },
      });
    } else {
      review = await tx.leadFollowUp.create({
        data: {
          agencyId,
          leadId: target.id,
          assignedUserId: currentLead.nextActionOwnerId || currentLead.ownerUserId,
          type: "CALL",
          description: reviewDescription,
          dueAt: reviewDueAt,
        },
      });
    }
    await tx.lead.update({
      where: { id: target.id },
      data: {
        nextActionType: "CALL",
        nextActionDescription: reviewDescription,
        nextActionAt: reviewDueAt,
        nextActionOwnerId: currentLead.nextActionOwnerId || currentLead.ownerUserId,
        firstContactAt: currentLead.firstContactAt || parseWorkbookDate(row.date) || occurredAt,
        lastContactAt: !currentLead.lastContactAt || currentLead.lastContactAt < occurredAt ? occurredAt : currentLead.lastContactAt,
        version: { increment: 1 },
      },
    });
    return { kind: "review", id: review.id, row: row.rowNumber, leadId: target.id, leadNumber: target.leadNumber, dueAt: reviewDueAt };
  }, { maxWait: 10_000, timeout: 30_000 });

  for (const workItem of workItems) {
    const result = await processWorkItem(workItem);
    if (result.kind === "scheduled") createdFollowUps.push(result);
    else reviewFollowUps.push(result);
  }
  return { oldSnapshots, createdActivities, createdFollowUps, reviewFollowUps, unresolved };
}

async function main() {
  const workbookBytes = await fs.readFile(workbookPath);
  const workbookSha256 = crypto.createHash("sha256").update(workbookBytes).digest("hex");
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(workbookBytes);
  const leadsSheet = workbook.getWorksheet("Leads");
  const confirmedSheet = workbook.getWorksheet("Confirmed Students");
  const followUpSheet = workbook.getWorksheet("Follow up");
  if (!leadsSheet || !confirmedSheet || !followUpSheet) throw new Error("The required workbook tabs were not found.");

  const baseRows = worksheetRows(leadsSheet, {
    date: 1,
    name: 2,
    phone: 3,
    country: 4,
    category: 5,
    status: 6,
    followUpDate: 7,
    remarks: 8,
    source: 9,
  });
  const confirmedRows = worksheetRows(confirmedSheet, {
    date: 1,
    name: 2,
    country: 3,
    program: 4,
    institution: 5,
    institutionType: 6,
    intake: 7,
    offerLetter: 8,
    fees: 11,
    deposit: 12,
    total: 13,
    remarks: 14,
  }).filter((row) => text(row.date) && text(row.program));
  const followUpRows = worksheetRows(followUpSheet, {
    date: 1,
    name: 2,
    phone: 3,
    note1: 4,
    date1: 5,
    note2: 6,
    date2: 7,
    note3: 8,
    date3: 9,
  });

  const [importRows, activities] = await Promise.all([
    prisma.leadImportRow.findMany({
      where: { agencyId, batch: { fileName: { startsWith: "admissions-2026-" } } },
      include: {
        batch: true,
        createdLead: true,
        incomingEvent: {
          include: {
            duplicateCandidates: { include: { candidateLead: true } },
          },
        },
      },
    }),
    prisma.leadActivity.findMany({
      where: { agencyId, title: { in: ["Admissions detail (imported)", "Follow-up (imported)"] } },
      include: { lead: true },
      orderBy: { createdAt: "asc" },
    }),
  ]);

  for (const row of baseRows) {
    row.importRow = chooseImportRow(row, importRows);
    row.lead = leadForImportRow(row.importRow);
  }

  const confirmedReport = confirmedRows.map((row) => {
    const match = confirmedCandidates(row, baseRows);
    return {
      row: row.rowNumber,
      name: text(row.name),
      program: text(row.program),
      remarks: text(row.remarks),
      method: match.method,
      candidates: match.candidates.map(candidateSummary),
      resolvedLead: match.leads.length === 1 ? {
        leadNumber: match.leads[0].leadNumber,
        name: fullName(match.leads[0]),
        phone: match.leads[0].phone,
      } : null,
    };
  });

  const followUpReport = followUpRows.map((row) => {
    const match = followUpCandidates(row, baseRows);
    return {
      row: row.rowNumber,
      name: text(row.name),
      phone: text(row.phone),
      method: match.method,
      candidates: match.candidates.map(candidateSummary),
      resolvedLead: match.leads.length === 1 ? {
        leadNumber: match.leads[0].leadNumber,
        name: fullName(match.leads[0]),
        phone: match.leads[0].phone,
      } : null,
    };
  });

  const summary = {
    mode: apply ? "apply" : "dry-run",
    agencyId,
    workbook: path.basename(workbookPath),
    sheetsRead: ["Leads", "Confirmed Students", "Follow up"],
    sheetsSkipped: ["Follow-ups", "Cases calling data"],
    counts: {
      leadsRows: baseRows.length,
      importedLeadRows: importRows.length,
      baseRowsResolvedToLead: baseRows.filter((row) => row.lead).length,
      confirmedRows: confirmedRows.length,
      confirmedResolved: confirmedReport.filter((row) => row.resolvedLead).length,
      confirmedUnresolved: confirmedReport.filter((row) => !row.resolvedLead).length,
      followUpRows: followUpRows.length,
      followUpResolved: followUpReport.filter((row) => row.resolvedLead).length,
      followUpUnresolved: followUpReport.filter((row) => !row.resolvedLead).length,
      importedAdmissionsActivities: activities.filter((row) => row.title === "Admissions detail (imported)").length,
      importedFollowUpActivities: activities.filter((row) => row.title === "Follow-up (imported)").length,
      admissionsActivitiesMatchedToRows: confirmedRows.filter((row) => admissionActivityMatch(
        row,
        activities.filter((activity) => activity.title === "Admissions detail (imported)"),
        confirmedRows,
      )).length,
    },
    workbookSha256,
    referencedInvalidLeadRowsToRepair: [...repairedInvalidRows.keys()].map((rowNumber) => {
      const row = baseRows.find((candidate) => candidate.rowNumber === rowNumber);
      return {
        row: rowNumber,
        name: repairedInvalidRows.get(rowNumber).name || text(row?.name),
        phone: repairedInvalidRows.get(rowNumber).phone,
        importStatus: row?.importRow?.status || "NOT_FOUND",
        action: repairedInvalidRows.get(rowNumber).confirmedPlaceholderLeadNumber ? "enrich-confirmed-placeholder" : "recover-invalid-lead",
      };
    }),
    confirmedAssociationCorrections: confirmedRows.flatMap((row) => {
      const match = confirmedCandidates(row, baseRows);
      const activity = admissionActivityMatch(row, activities.filter((candidate) => candidate.title === "Admissions detail (imported)"), confirmedRows);
      const target = match.leads.length === 1 ? match.leads[0] : null;
      if (!activity || !target || activity.leadId === target.id) return [];
      return [{ row: row.rowNumber, name: text(row.name), from: activity.lead.leadNumber, to: target.leadNumber }];
    }),
    unmatchedAdmissionsActivities: confirmedRows
      .filter((row) => !admissionActivityMatch(row, activities.filter((activity) => activity.title === "Admissions detail (imported)"), confirmedRows))
      .map((row) => ({ row: row.rowNumber, name: text(row.name), program: text(row.program), remarks: text(row.remarks) })),
    unresolvedConfirmed: confirmedReport.filter((row) => !row.resolvedLead),
    unresolvedFollowUps: followUpReport.filter((row) => !row.resolvedLead),
  };

  if (!apply) {
    console.log(JSON.stringify(verbose ? { ...summary, confirmed: confirmedReport, followUps: followUpReport } : summary, null, 2));
    return;
  }

  if (summary.counts.admissionsActivitiesMatchedToRows !== confirmedRows.length) {
    throw new Error(`Matched ${summary.counts.admissionsActivitiesMatchedToRows}/${confirmedRows.length} admissions activities; refusing to apply.`);
  }
  const previousRuns = await prisma.activityLog.findMany({
    where: { agencyId, action: RECONCILIATION_ACTION },
    select: { id: true, metadata: true, createdAt: true },
    orderBy: { createdAt: "desc" },
    take: 20,
  });
  const alreadyApplied = previousRuns.find((row) => row.metadata?.workbookSha256 === workbookSha256
    && row.metadata?.reconciliationVersion === RECONCILIATION_VERSION);
  if (alreadyApplied) {
    console.log(JSON.stringify({ mode: "apply", status: "already-applied", auditLogId: alreadyApplied.id, appliedAt: alreadyApplied.createdAt }, null, 2));
    return;
  }

  const admissionsActivities = activities.filter((activity) => activity.title === "Admissions detail (imported)");
  const previousFollowUpActivities = activities.filter((activity) => activity.title === "Follow-up (imported)");
  const startAction = `${RECONCILIATION_ACTION}.started`;
  let startAudit = await prisma.activityLog.findFirst({
    where: { agencyId, action: startAction },
    orderBy: { createdAt: "desc" },
    select: { id: true, metadata: true },
  });
  if (startAudit?.metadata?.workbookSha256 !== workbookSha256
    || startAudit?.metadata?.reconciliationVersion !== RECONCILIATION_VERSION) {
    startAudit = await prisma.activityLog.create({
      data: {
        agencyId,
        action: startAction,
        details: "Captured the pre-change recovery snapshot for the Admissions 2026 reconciliation.",
        entityType: "lead_import",
        metadata: {
          reconciliationVersion: RECONCILIATION_VERSION,
          workbook: "Admissions 2026.xlsx",
          workbookSha256,
          plannedSummary: summary,
          admissionsActivities: admissionsActivities.map((activity) => ({
            id: activity.id,
            leadId: activity.leadId,
            leadNumber: activity.lead.leadNumber,
            occurredAt: activity.occurredAt,
            metadata: activity.metadata,
          })),
          followUpActivities: previousFollowUpActivities.map((activity) => ({
            id: activity.id,
            leadId: activity.leadId,
            leadNumber: activity.lead.leadNumber,
            description: activity.description,
            occurredAt: activity.occurredAt,
            metadata: activity.metadata,
          })),
        },
      },
    });
  }

  const repairedLeadRows = [];
  for (const rowNumber of repairedInvalidRows.keys()) {
    const repaired = await prisma.$transaction(
      (tx) => repairReferencedInvalidLeadRows(tx, baseRows, new Set([rowNumber])),
      { maxWait: 10_000, timeout: 60_000 },
    );
    repairedLeadRows.push(...repaired);
  }

  const admissionsParts = [];
  for (const row of confirmedRows) {
    const part = await prisma.$transaction(
      (tx) => applyAdmissionsReconciliation(tx, confirmedRows, baseRows, admissionsActivities, new Set([row.rowNumber])),
      { maxWait: 10_000, timeout: 60_000 },
    );
    admissionsParts.push(part);
  }
  const admissions = {
    moved: admissionsParts.flatMap((part) => part.moved),
    unresolved: admissionsParts.flatMap((part) => part.unresolved),
    confirmedStageLeadIds: [...new Set(admissionsParts.flatMap((part) => part.confirmedStageLeadIds))],
    mergedPlaceholderLeadId: admissionsParts.find((part) => part.mergedPlaceholderLeadId)?.mergedPlaceholderLeadId || null,
  };
  const followUps = await applyFollowUpReconciliation(prisma, followUpRows, baseRows, previousFollowUpActivities);
  const audit = await prisma.activityLog.create({
    data: {
      agencyId,
      action: RECONCILIATION_ACTION,
      details: "Reconciled Admissions 2026 Confirmed Students and Follow up tabs to the authoritative Leads tab.",
      entityType: "lead_import",
      metadata: {
        reconciliationVersion: RECONCILIATION_VERSION,
        workbook: "Admissions 2026.xlsx",
        workbookSha256,
        recoverySnapshotId: startAudit.id,
        sheetsRead: ["Leads", "Confirmed Students", "Follow up"],
        sheetsSkipped: ["Follow-ups", "Cases calling data"],
        repairedLeadRows,
        admissions,
        followUps,
      },
    },
  });
  const result = { auditLogId: audit.id, repairedLeadRows, admissions, followUps };

  const [admissionsActivitiesAfter, legacyAdmissionsActivities, followUpActivitiesAfter, legacyFollowUpActivities, importedFollowUpsAfter, loveleenPlaceholder] = await Promise.all([
    prisma.leadActivity.count({ where: { agencyId, title: RECONCILED_ADMISSIONS_TITLE } }),
    prisma.leadActivity.count({ where: { agencyId, title: "Admissions detail (imported)" } }),
    prisma.leadActivity.count({ where: { agencyId, title: RECONCILED_FOLLOW_UP_TITLE } }),
    prisma.leadActivity.count({ where: { agencyId, title: "Follow-up (imported)" } }),
    prisma.leadFollowUp.count({
      where: {
        agencyId,
        OR: followUpRows.map((row) => {
          const latest = latestFollowUpNote(row);
          return latest?.nextActionAt ? { description: latest.description, dueAt: latest.nextActionAt } : { id: "never" };
        }),
      },
    }),
    prisma.lead.findFirst({
      where: { agencyId, leadNumber: "LD-2026-000252", deletedAt: undefined },
      select: { status: true, deletedAt: true },
    }),
  ]);

  console.log(JSON.stringify({
    mode: "apply",
    status: "applied",
    auditLogId: result.auditLogId,
    repairedLeadRows: result.repairedLeadRows,
    admissions: {
      associationMoves: result.admissions.moved,
      unresolved: result.admissions.unresolved,
      reconciledActivities: admissionsActivitiesAfter,
      immutableLegacyActivities: legacyAdmissionsActivities,
      confirmedStageLeads: result.admissions.confirmedStageLeadIds.length,
      mergedPlaceholderLeadId: result.admissions.mergedPlaceholderLeadId,
      loveleenPlaceholder,
    },
    followUps: {
      preservedLegacyActivities: legacyFollowUpActivities,
      reconciledActivities: followUpActivitiesAfter,
      pendingFollowUpsCreatedOrMatched: result.followUps.createdFollowUps.length,
      reviewFollowUpsCreatedOrUpdated: result.followUps.reviewFollowUps.length,
      pendingFollowUpsVerified: importedFollowUpsAfter,
      unresolved: result.followUps.unresolved,
    },
  }, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
