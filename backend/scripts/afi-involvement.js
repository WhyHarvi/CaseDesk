/* Read-only: which of the agency's open-invoice cases did Afi actually touch?
 * Run: node scripts/afi-involvement.js <agencyId> <afiUserId>
 */
import prisma from "../src/services/prisma/client.js";

const [agencyId, afiId] = process.argv.slice(2);
if (!agencyId || !afiId) {
  console.error("usage: node scripts/afi-involvement.js <agencyId> <afiUserId>");
  process.exit(1);
}

const afi = await prisma.user.findUnique({ where: { id: afiId }, select: { id: true, fullName: true, role: true } });
console.log("AFI:", afi?.fullName, `(${afi?.role})`);

const invoices = await prisma.caseInvoice.findMany({
  where: { agencyId, balance: { gt: 0 }, status: { notIn: ["Void", "Voided"] }, case: { deletedAt: null } },
  orderBy: [{ case: { createdAt: "asc" } }, { createdAt: "asc" }],
  select: { id: true, invoiceNumber: true, caseId: true, case: { select: { caseType: true, createdAt: true } } },
});
const byCase = new Map();
for (const inv of invoices) {
  const bucket = byCase.get(inv.caseId) || { invoices: [], caseType: inv.case.caseType, createdAt: inv.case.createdAt };
  bucket.invoices.push(inv.invoiceNumber);
  byCase.set(inv.caseId, bucket);
}
const caseIds = [...byCase.keys()];

// Lead-level evidence (converted or early lead for these cases)
const leads = await prisma.lead.findMany({
  where: { agencyId, OR: [{ convertedCaseId: { in: caseIds } }, { earlyCaseId: { in: caseIds } }] },
  select: {
    id: true,
    firstName: true,
    lastName: true,
    ownerUserId: true,
    convertedCaseId: true,
    earlyCaseId: true,
    originalSource: { select: { name: true, type: true } },
    activities: { where: { performedById: afiId }, select: { id: true, activityType: true } },
  },
});
const leadByCase = new Map();
for (const lead of leads) {
  const caseId = lead.convertedCaseId || lead.earlyCaseId;
  leadByCase.set(caseId, { ...lead, caseId });
}

// Communication messages sent by Afi on these cases
const messages = await prisma.communicationMessage.findMany({
  where: { agencyId, caseId: { in: caseIds }, senderUserId: afiId },
  select: { caseId: true },
});
const msgByCase = new Set(messages.map((m) => m.caseId));

// Appointments created by Afi
const appointments = await prisma.appointment.findMany({
  where: { agencyId, caseId: { in: caseIds }, createdById: afiId },
  select: { caseId: true },
});
const apptByCase = new Set(appointments.map((a) => a.caseId));

console.log(`\n${byCase.size} case(s) with open invoices:\n`);
for (const [caseId, bucket] of byCase) {
  const lead = leadByCase.get(caseId);
  const leadFlags = [];
  if (lead) {
    if (lead.ownerUserId === afiId) leadFlags.push("LEAD-OWNER");
    if (lead.activities?.length) leadFlags.push(`LEAD-ACT(${lead.activities.length})`);
  }
  const flags = [
    ...leadFlags,
    msgByCase.has(caseId) ? "MESSAGES" : null,
    apptByCase.has(caseId) ? "APPOINTMENTS" : null,
  ].filter(Boolean);
  console.log(`${caseId}  ${bucket.caseType}  [${bucket.invoices.join(", ")}]`);
  if (lead) {
    console.log(`    lead: ${lead.firstName || ""} ${lead.lastName || ""} owner=${lead.ownerUserId?.slice(0, 8) || "none"} source=${lead.originalSource?.type || lead.originalSource?.name || "?"}`);
  }
  console.log(`    evidence: ${flags.join(", ") || "NO DIRECT EVIDENCE"}`);
}
