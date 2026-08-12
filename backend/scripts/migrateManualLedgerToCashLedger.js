// One-time migration: converts CaseManualLedgerEntry rows ("the lightweight
// ledger") into real CaseDesk Cash records — a CaseInvoice (accountingProvider
// CaseDeskCash) for the amount owed, plus a CashTransaction/CashAllocation for
// whatever was already paid — since these entries were confirmed to all be
// cash. This replaces the earlier plan of a multi-status classification
// review queue: there's nothing to classify, every row here is cash.
//
// Only entries with BOTH caseId and clientId are migrated — CaseInvoice
// requires a real case, and a lead-stage entry (leadId set, no case yet) has
// nowhere in the new schema to attach a cash transaction to. Those are
// listed at the end for manual handling; there should be very few, since
// most manual-ledger entries are created after a lead converts to a case.
//
// Safe to re-run: entries already migrated (migratedAt set) are skipped, and
// invoice creation is idempotency-keyed per entry so a partial/interrupted
// run never double-creates an invoice.
//
// Usage:
//   node scripts/migrateManualLedgerToCashLedger.js            # dry run — prints what would happen
//   node scripts/migrateManualLedgerToCashLedger.js --apply    # actually writes
//   node scripts/migrateManualLedgerToCashLedger.js --apply --agency <agencyId>   # scope to one agency
//
// Requires DATABASE_URL and a working Prisma Client — this sandbox has
// neither network access to the database nor a matching query-engine
// binary, so this could not be executed from here. Run it from an
// environment that already runs your other prisma/migrate commands, ideally
// as a dry run first to review the plan before passing --apply.

import "dotenv/config";
import prisma from "../src/services/prisma/client.js";
import { createCaseInvoice, recordManualPayment, ACCOUNTING_PROVIDERS } from "../src/services/caseInvoiceService.js";

const apply = process.argv.includes("--apply");
const agencyArgIndex = process.argv.indexOf("--agency");
const scopedAgencyId = agencyArgIndex >= 0 ? process.argv[agencyArgIndex + 1] : null;

function money(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

function isoDate(date) {
  return new Date(date).toISOString().slice(0, 10);
}

async function fallbackActorId(agencyId, cache) {
  if (cache.has(agencyId)) return cache.get(agencyId);
  const admin = await prisma.user.findFirst({
    where: { agencyId, role: "admin", status: "active" },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  cache.set(agencyId, admin?.id || null);
  return admin?.id || null;
}

async function main() {
  const where = {
    migratedAt: null,
    caseId: { not: null },
    clientId: { not: null },
    ...(scopedAgencyId ? { agencyId: scopedAgencyId } : {}),
  };
  const entries = await prisma.caseManualLedgerEntry.findMany({
    where,
    orderBy: { createdAt: "asc" },
    include: { client: { select: { fullName: true } }, case: { select: { caseType: true } } },
  });

  const orphanLeadOnly = await prisma.caseManualLedgerEntry.count({
    where: { migratedAt: null, caseId: null, ...(scopedAgencyId ? { agencyId: scopedAgencyId } : {}) },
  });

  console.log(`${apply ? "APPLYING" : "DRY RUN — pass --apply to actually write"}: ${entries.length} case-linked ledger entries to migrate.`);
  if (orphanLeadOnly) {
    console.log(`${orphanLeadOnly} additional entries are lead-only (no case yet) and cannot be migrated automatically — they have no case for a cash invoice to attach to. Review these manually once each lead converts, or leave them as historical record.`);
  }

  const actorCache = new Map();
  let created = 0;
  let paidCount = 0;
  let skippedZero = 0;

  for (const entry of entries) {
    const amountOwed = money(entry.amountOwed);
    const amountPaid = money(Math.min(Number(entry.amountPaid || 0), amountOwed || Number(entry.amountPaid || 0)));
    const invoiceAmount = Math.max(amountOwed, amountPaid);
    if (invoiceAmount <= 0) {
      skippedZero += 1;
      console.log(`  skip ${entry.id} (${entry.label}) — zero amount, nothing to migrate.`);
      if (apply) {
        await prisma.caseManualLedgerEntry.update({ where: { id: entry.id }, data: { migratedAt: new Date() } });
      }
      continue;
    }
    const actorUserId = entry.createdById || (await fallbackActorId(entry.agencyId, actorCache));
    const description = entry.note ? `${entry.label} — ${entry.note}` : entry.label;

    console.log(`  ${entry.id} · ${entry.client?.fullName || "client"} · ${entry.case?.caseType || ""} · owed ${amountOwed} paid ${amountPaid} · "${entry.label}"`);
    if (!apply) continue;

    const invoice = await createCaseInvoice(entry.agencyId, {
      caseId: entry.caseId,
      paymentType: "other",
      description: description.slice(0, 500),
      amount: invoiceAmount,
      dueDate: null,
      actorUserId,
      idempotencyKey: `manual-ledger-${entry.id}`,
      notifyClient: false,
      accountingProvider: ACCOUNTING_PROVIDERS.CASH,
    });
    created += 1;

    if (amountPaid > 0) {
      await recordManualPayment(entry.agencyId, {
        caseId: entry.caseId,
        invoiceId: invoice.id,
        amount: amountPaid,
        method: "Cash",
        transactionReference: null,
        paymentDate: isoDate(entry.createdAt),
        note: `Migrated from legacy ledger entry (${entry.id})`,
        idempotencyKey: `manual-ledger-payment-${entry.id}`,
        actorUserId,
      });
      paidCount += 1;
    }

    await prisma.caseManualLedgerEntry.update({
      where: { id: entry.id },
      data: { migratedInvoiceId: invoice.id, migratedAt: new Date() },
    });
  }

  console.log(apply
    ? `Done. Created ${created} cash invoices (${paidCount} with a payment applied), skipped ${skippedZero} zero-amount entries.`
    : "Dry run complete — re-run with --apply to write these changes.");
}

main()
  .then(() => prisma.$disconnect())
  .catch((error) => {
    console.error(error);
    return prisma.$disconnect().finally(() => process.exit(1));
  });
