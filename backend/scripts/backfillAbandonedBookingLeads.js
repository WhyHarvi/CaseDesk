import "dotenv/config";
import prisma from "../src/services/prisma/client.js";
import { captureAbandonedPublicBookingLead } from "../src/modules/leads/lead.booking.js";

const apply = process.argv.includes("--apply");

async function main() {
  const holds = await prisma.bookingPaymentHold.findMany({
    where: { source: "Public", appointmentId: null, leadId: null, status: { in: ["Expired", "Voided"] } },
    select: { id: true, agencyId: true, guestName: true, guestEmail: true },
    orderBy: { createdAt: "asc" },
  });

  let created = 0;
  let linked = 0;
  let skipped = 0;
  for (const hold of holds) {
    if (!apply) {
      console.log("would process", hold.id, hold.guestName, hold.guestEmail);
      continue;
    }
    const result = await captureAbandonedPublicBookingLead(hold.agencyId, hold.id);
    if (result?.created) created += 1;
    else if (result?.leadId) linked += 1;
    else skipped += 1;
  }

  console.log(JSON.stringify({ mode: apply ? "apply" : "dry-run", candidates: holds.length, created, linked, skipped }, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
