/* Assign a user as Frontdesk (per-case) on every case with open invoices,
 * then re-freeze those cases' incentive snapshots so the 15% Frontdesk
 * share pays them. Approved one-off data fix.
 * Run: node scripts/assign-frontdesk.js <agencyId> <userId> [--dry-run]
 */
import prisma from "../src/services/prisma/client.js";
import { refreshOpenInvoiceSnapshots } from "../src/services/incentiveCreditingService.js";

const [agencyId, userId] = process.argv.slice(2);
const dryRun = process.argv.includes("--dry-run");
if (!agencyId || !userId) {
  console.error("usage: node scripts/assign-frontdesk.js <agencyId> <userId> [--dry-run]");
  process.exit(1);
}

const [user, role] = await Promise.all([
  prisma.user.findFirst({ where: { id: userId, agencyId }, select: { id: true, fullName: true, role: true, status: true, memberships: { where: { agencyId, isActive: true }, select: { id: true } } } }),
  prisma.agencyCaseRole.findFirst({ where: { agencyId, code: "frontdesk" }, select: { id: true, name: true } }),
]);
if (!user) {
  console.error("user not found in agency");
  process.exit(1);
}
if (!role) {
  console.error("no Frontdesk case role configured for this agency");
  process.exit(1);
}
const hasGrant = await prisma.teamIncentiveRoleAssignment.findFirst({ where: { agencyId, userId, caseRoleId: role.id }, select: { id: true } });
if (!hasGrant) {
  console.error(`${user.fullName} does not hold the Frontdesk case role at team level — grant it in Team Members first`);
  process.exit(1);
}

const invoices = await prisma.caseInvoice.findMany({
  where: { agencyId, balance: { gt: 0 }, status: { notIn: ["Void", "Voided"] }, case: { deletedAt: null } },
  select: { caseId: true, id: true, invoiceNumber: true },
  orderBy: [{ case: { createdAt: "asc" } }, { createdAt: "asc" }],
});
const caseIds = [...new Set(invoices.map((inv) => inv.caseId))];
console.log(`user: ${user.fullName} (${user.role}), membership active: ${Boolean(user.memberships?.length)}`);
console.log(`role: ${role.name}, grant: yes`);
console.log(`targeting ${caseIds.length} case(s) with ${invoices.length} open invoice(s)${dryRun ? " [DRY RUN]" : ""}`);

let assigned = 0;
for (const caseId of caseIds) {
  if (dryRun) {
    console.log(`  would assign Frontdesk on ${caseId}`);
    continue;
  }
  await prisma.caseRoleAssignment.upsert({
    where: { agencyId_caseId_caseRoleId_userId: { agencyId, caseId, caseRoleId: role.id, userId } },
    create: { agencyId, caseId, caseRoleId: role.id, userId, assignedById: null, status: "active" },
    update: { status: "active" },
  });
  const client = await prisma.case.findFirst({ where: { id: caseId, agencyId }, select: { clientId: true } });
  await prisma.activityLog.create({
    data: {
      agencyId,
      userId,
      clientId: client?.clientId || null,
      caseId,
      action: "incentive.frontdesk_assigned",
      details: `${user.fullName} assigned as ${role.name} for incentive attribution on all open-invoice cases (bulk data fix).`,
    },
  }).catch(() => {});
  const count = await refreshOpenInvoiceSnapshots(agencyId, caseId);
  assigned += 1;
  console.log(`  assigned + refreshed ${caseId} (${count} invoice snapshot(s))`);
}

if (dryRun) {
  console.log("DRY RUN — nothing written.");
} else {
  console.log(`done: Frontdesk assigned on ${assigned} case(s), snapshots refreshed.`);
}
await prisma.$disconnect();
