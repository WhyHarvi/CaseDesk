/* One-time fix (approved): re-freeze the incentive snapshots of every open,
 * never-credited invoice in an agency with the CURRENT case-team holders,
 * closing the "RCIC share froze empty" gap for invoices created before the
 * required RCIC/Case Worker team was assigned. Mirrors refreshOpenInvoiceSnapshots
 * per case. Run: node scripts/refresh-incentive-snapshots.js <agencyId> [--dry-run]
 */
import prisma from "../src/services/prisma/client.js";
import { refreshOpenInvoiceSnapshots } from "../src/services/incentiveCreditingService.js";

const agencyId = process.argv[2];
const dryRun = process.argv.includes("--dry-run");
if (!agencyId) {
  console.error("usage: node scripts/refresh-incentive-snapshots.js <agencyId> [--dry-run]");
  process.exit(1);
}

async function main() {
  const agency = await prisma.agency.findUnique({ where: { id: agencyId }, select: { name: true } });
  if (!agency) {
    console.error("agency not found:", agencyId);
    process.exit(1);
  }
  console.log(`AGENCY: ${agency.name}`);

  const invoices = await prisma.caseInvoice.findMany({
    where: {
      agencyId,
      balance: { gt: 0 },
      status: { notIn: ["Void", "Voided"] },
      incentiveLedgerEntries: { none: {} },
    },
    select: { id: true, invoiceNumber: true, caseId: true, balance: true, incentiveSnapshot: { select: { planName: true } } },
    orderBy: { createdAt: "asc" },
  });
  const byCase = new Map();
  for (const inv of invoices) {
    const bucket = byCase.get(inv.caseId) || [];
    bucket.push(inv);
    byCase.set(inv.caseId, bucket);
  }
  console.log(`open uncredited invoices: ${invoices.length} across ${byCase.size} cases`);

  let refreshedInvoices = 0;
  let changedInvoices = 0;
  for (const [caseId, caseInvoices] of byCase) {
    const before = new Map(caseInvoices.map((inv) => [inv.id, inv.incentiveSnapshot?.planName || null]));
    const count = dryRun ? 0 : await refreshOpenInvoiceSnapshots(agencyId, caseId);
    refreshedInvoices += caseInvoices.length;
    if (!dryRun) {
      for (const inv of caseInvoices) {
        const fresh = await prisma.caseInvoiceIncentiveSnapshot.findUnique({ where: { caseInvoiceId: inv.id } });
        if (fresh?.incentivePlanId && !before.get(inv.id)) changedInvoices += 1;
      }
    }
    console.log(`  case ${caseId.slice(0, 8)}… — ${caseInvoices.length} invoice(s)${dryRun ? " (dry run)" : ` refreshed, ${count} snapshot(s) written`}`);
  }
  console.log(dryRun
    ? `DRY RUN — would touch ${refreshedInvoices} invoice(s); nothing written.`
    : `done: ${changedInvoices} invoice(s) gained a plan snapshot.`);
}

main()
  .catch((error) => {
    console.error("FAILED:", error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
