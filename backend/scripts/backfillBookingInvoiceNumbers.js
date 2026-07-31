import "dotenv/config";
import prisma from "../src/services/prisma/client.js";
import { getQuickBooksInvoicesByIds } from "../src/services/quickbooksService.js";

const apply = process.argv.includes("--apply");
const BATCH_SIZE = 100;

async function main() {
  const holds = await prisma.bookingPaymentHold.findMany({
    where: { qbInvoiceId: { not: null }, qbInvoiceNumber: null },
    select: { id: true, agencyId: true, qbInvoiceId: true },
    orderBy: { createdAt: "asc" },
  });
  const byAgency = new Map();
  for (const hold of holds) {
    const rows = byAgency.get(hold.agencyId) || [];
    rows.push(hold);
    byAgency.set(hold.agencyId, rows);
  }

  let found = 0;
  let updated = 0;
  for (const [agencyId, rows] of byAgency) {
    for (let start = 0; start < rows.length; start += BATCH_SIZE) {
      const batch = rows.slice(start, start + BATCH_SIZE);
      const invoices = await getQuickBooksInvoicesByIds(agencyId, batch.map((row) => row.qbInvoiceId));
      const invoiceById = new Map(invoices.map((invoice) => [invoice.id, invoice]));
      for (const hold of batch) {
        const invoice = invoiceById.get(hold.qbInvoiceId);
        if (!invoice?.docNumber) continue;
        found += 1;
        if (!apply) continue;
        await prisma.bookingPaymentHold.update({
          where: { id: hold.id },
          data: { qbInvoiceNumber: invoice.docNumber, qbSyncToken: invoice.syncToken },
        });
        updated += 1;
      }
    }
  }

  console.log(JSON.stringify({ mode: apply ? "apply" : "dry-run", candidates: holds.length, found, updated }, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

