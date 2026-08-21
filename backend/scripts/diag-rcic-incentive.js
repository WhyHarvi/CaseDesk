/* Read-only diagnostic: trace why an RCIC isn't credited on a case.
 * Queries only — never writes. Run: node scripts/diag-rcic-incentive.js
 */
import prisma from "../src/services/prisma/client.js";

const [agencyIdArg, caseIdArg, rcicEmailArg] = process.argv.slice(2);
if (!agencyIdArg) {
  console.error("usage: node scripts/diag-rcic-incentive.js <agencyId> [caseId] [rcicEmail]");
  process.exit(1);
}

async function main() {
  const agency = await prisma.agency.findUnique({
    where: { id: agencyIdArg },
    select: { id: true, name: true },
  });
  if (!agency) {
    console.error("agency not found:", agencyIdArg);
    process.exit(1);
  }
  console.log("AGENCY:", agency.name, agency.id);

  // ---- Users holding the RCIC role globally
  const rcicRole = await prisma.agencyCaseRole.findUnique({
    where: { agencyId_code: { agencyId: agency.id, code: "rcic" } },
    select: { id: true, name: true, code: true },
  });
  const caseWorkerRole = await prisma.agencyCaseRole.findUnique({
    where: { agencyId_code: { agencyId: agency.id, code: "case-worker" } },
    select: { id: true, name: true, code: true },
  });
  console.log("\nROLES:", JSON.stringify(rcicRole), JSON.stringify(caseWorkerRole));

  const globalAssignments = await prisma.teamIncentiveRoleAssignment.findMany({
    where: { agencyId: agency.id },
    select: {
      userId: true,
      caseRoleId: true,
      user: { select: { fullName: true, email: true, role: true, status: true, memberships: { where: { agencyId: agency.id }, select: { isActive: true, role: true } } } },
    },
  });
  const rcicUsers = globalAssignments.filter((row) => row.caseRoleId === rcicRole?.id);
  console.log(`\nGLOBAL RCIC role holders (${rcicUsers.length}):`);
  for (const row of rcicUsers) {
    const memberships = (row.user.memberships || []).map((m) => `${m.role}${m.isActive ? "" : "(inactive)"}`).join(", ") || "NONE";
    console.log(`  - ${row.user.fullName} <${row.user.email}> role=${row.user.role} status=${row.user.status} memberships=[${memberships}]`);
  }

  // ---- Pick a case
  let cases = [];
  if (caseIdArg) {
    const c = await prisma.case.findFirst({ where: { id: caseIdArg, agencyId: agency.id }, select: { id: true, caseType: true, assignedUserId: true, client: { select: { fullName: true } } } });
    if (c) cases.push(c);
  } else {
    cases = await prisma.case.findMany({
      where: { agencyId: agency.id, deletedAt: null, archivedAt: null },
      orderBy: { createdAt: "desc" },
      take: 5,
      select: { id: true, caseType: true, assignedUserId: true, client: { select: { fullName: true } } },
    });
  }

  for (const caseItem of cases) {
    console.log(`\n================ CASE ${caseItem.id} (${caseItem.client?.fullName}, ${caseItem.caseType}) assignedUserId=${caseItem.assignedUserId}`);
    const assignments = await prisma.caseAssignment.findMany({
      where: { agencyId: agency.id, caseId: caseItem.id, status: "active" },
      select: { assignmentType: true, consultantUserId: true, consultant: { select: { fullName: true, email: true } } },
    });
    console.log("  caseAssignments:", assignments.map((a) => `${a.assignmentType}=${a.consultant?.fullName} (${a.consultantUserId})`).join(", ") || "none");

    const caseRoleRows = await prisma.caseRoleAssignment.findMany({
      where: { agencyId: agency.id, caseId: caseItem.id, status: "active" },
      select: { caseRoleId: true, userId: true, user: { select: { fullName: true, status: true, memberships: { where: { agencyId: agency.id }, select: { isActive: true } } } }, caseRole: { select: { code: true } } },
    });
    console.log("  caseRoleAssignments:", caseRoleRows.map((r) => `${r.caseRole.code}=${r.user?.fullName}(${r.user?.status},membershipActive=${r.user?.memberships?.[0]?.isActive ?? false})`).join(", ") || "none");

    // ---- Invoices + snapshots
    const invoices = await prisma.caseInvoice.findMany({
      where: { agencyId: agency.id, caseId: caseItem.id },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        invoiceNumber: true,
        amount: true,
        balance: true,
        status: true,
        incentiveSnapshot: { select: { incentivePlanId: true, planName: true, recipients: true, formulaType: true } },
        creditCursor: { select: { lastCreditedBalance: true } },
      },
    });
    console.log(`  invoices: ${invoices.length}`);
    for (const inv of invoices) {
      const recipients = Array.isArray(inv.incentiveSnapshot?.recipients)
        ? inv.incentiveSnapshot.recipients.map((r) => `${r.roleName}${r.userIds?.length ? `=${r.userIds.length}holder(s)` : "=NO HOLDER"}`).join(", ")
        : "(no snapshot)";
      console.log(`    ${inv.invoiceNumber} $${Number(inv.amount)} bal=${Number(inv.balance)} status=${inv.status} plan=${inv.incentiveSnapshot?.planName ?? "none"} cursor=${inv.creditCursor?.lastCreditedBalance ?? "none"}`);
      console.log(`      recipients: ${recipients}`);
    }

    // ---- Ledger entries
    const ledger = await prisma.incentiveLedgerEntry.findMany({
      where: { agencyId: agency.id, caseId: caseItem.id },
      orderBy: { creditedAt: "desc" },
      take: 10,
      select: { userId: true, roleNameSnapshot: true, creditedAmount: true, entryType: true, triggerSource: true, creditedAt: true, user: { select: { fullName: true } } },
    });
    console.log(`  ledger entries: ${ledger.length}`);
    for (const entry of ledger) {
      console.log(`    ${entry.user?.fullName} [${entry.roleNameSnapshot}] ${entry.entryType} ${Number(entry.creditedAmount)} (${entry.triggerSource}) @ ${entry.creditedAt.toISOString()}`);
    }
  }
}

main()
  .catch((error) => {
    console.error("DIAGNOSTIC FAILED:", error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
