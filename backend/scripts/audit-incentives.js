/* Read-only audit of the whole incentive system:
 *  - every agency with incentive plans (active or not)
 *  - for agencies with an ACTIVE plan: every open invoice's frozen snapshot
 *    vs the holders that exist TODAY, flagging any role share that is empty
 *    in the snapshot but could be filled (stale) or genuinely has no holder
 *  - ledger credits (are people actually being paid?)
 *  - timeline-leg evaluations (are milestone bonuses being evaluated?)
 * Run: node scripts/audit-incentives.js [--refresh-stale] [agencyId]
 */
import prisma from "../src/services/prisma/client.js";
import { refreshOpenInvoiceSnapshots } from "../src/services/incentiveCreditingService.js";

const agencyFilter = process.argv.slice(2).find((arg) => !arg.startsWith("--"));
const refreshStale = process.argv.includes("--refresh-stale");

const ROLES_BY_AGENCY = new Map();

async function roles(agencyId) {
  if (!ROLES_BY_AGENCY.has(agencyId)) {
    const list = await prisma.agencyCaseRole.findMany({ where: { agencyId }, select: { id: true, code: true, name: true } });
    ROLES_BY_AGENCY.set(agencyId, new Map(list.map((r) => [r.id, r])));
  }
  return ROLES_BY_AGENCY.get(agencyId);
}

async function main() {
  const agencies = await prisma.agency.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } });
  const plans = await prisma.incentivePlan.findMany({
    include: {
      roleShares: { include: { caseRole: true } },
      agency: { select: { name: true } },
    },
    orderBy: [{ agencyId: "asc" }, { createdAt: "asc" }],
  });

  console.log("========== INCENTIVE PLAN CONFIGURATION ==========");
  for (const p of plans) {
    const shares = p.roleShares.map((s) => `${s.attributionKind}${s.caseRole ? `:${s.caseRole.code}` : ""}=${Number(s.sharePercent)}%`).join(", ");
    const total = p.roleShares.reduce((sum, s) => sum + Number(s.sharePercent), 0);
    console.log(`${p.agency.name} | ${p.name} | type=${p.caseType || "ALL"} | ${p.formulaType} | active=${p.isActive} | shares=[${shares}] sum=${total}%`);
  }

  const activeAgencies = new Set(plans.filter((p) => p.isActive).map((p) => p.agencyId));
  const agencyId = agencyFilter && agencyFilter !== "--refresh-stale" ? agencyFilter : null;

  for (const agency of agencies) {
    if (agencyId && agency.id !== agencyId) continue;
    if (!activeAgencies.has(agency.id) && !agencyId) {
      console.log(`\n${agency.name}: NO ACTIVE PLAN — skipping invoice audit`);
      continue;
    }

    const roleMap = await roles(agency.id);
    const invoices = await prisma.caseInvoice.findMany({
      where: {
        agencyId: agency.id,
        balance: { gt: 0 },
        status: { notIn: ["Void", "Voided"] },
        case: { deletedAt: null },
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: {
        id: true,
        invoiceNumber: true,
        caseId: true,
        balance: true,
        createdAt: true,
        incentiveSnapshot: { select: { planName: true, recipients: true } },
        incentiveLedgerEntries: { select: { id: true } },
        case: {
          select: {
            caseType: true,
            client: { select: { fullName: true } },
            assignedUserId: true,
            assignments: { where: { status: "active" }, select: { consultantUserId: true } },
            roleAssignments: { where: { status: "active" }, select: { caseRoleId: true, userId: true } },
          },
        },
      },
    });

    console.log(`\n========== ${agency.name} — ${invoices.length} open invoice(s) ==========`);
    if (!invoices.length) continue;

    let staleTotal = 0;
    let noHolderTotal = 0;
    const casesToRefresh = new Set();
    const byCase = new Map();

    for (const inv of invoices) {
      const recipients = Array.isArray(inv.incentiveSnapshot?.recipients) ? inv.incentiveSnapshot.recipients : [];
      const caseTeam = new Set([
        inv.case?.assignedUserId,
        ...(inv.case?.assignments || []).map((a) => a.consultantUserId),
      ].filter(Boolean));
      const caseRoleHolders = new Map(); // caseRoleId -> Set(userIds)
      for (const row of inv.case?.roleAssignments || []) {
        const set = caseRoleHolders.get(row.caseRoleId) || new Set();
        set.add(row.userId);
        caseRoleHolders.set(row.caseRoleId, set);
      }
      // Global team-level role assignments intersected with the case team
      // (the fallback when no per-case overlay exists).
      const globalByRole = new Map();
      const globalRows = await prisma.teamIncentiveRoleAssignment.findMany({
        where: { agencyId: agency.id, user: { status: "active" } },
        select: { caseRoleId: true, userId: true },
      });
      for (const row of globalRows) {
        if (!caseTeam.has(row.userId)) continue;
        const set = globalByRole.get(row.caseRoleId) || new Set();
        set.add(row.userId);
        globalByRole.set(row.caseRoleId, set);
      }

      const issues = [];
      const shareTotals = new Map();
      for (const share of recipients) {
        const roleName = share.roleName || "Case role";
        const frozenUsers = new Set(share.userIds || []);
        shareTotals.set(roleName, (shareTotals.get(roleName) || 0) + Number(share.sharePercent || 0));
        if (share.attributionKind !== "CASE_ROLE") continue;
        const overlay = caseRoleHolders.get(share.caseRoleId);
        const global = globalByRole.get(share.caseRoleId);
        const currentHolders = overlay && overlay.size ? overlay : global;
        const role = roleMap.get(share.caseRoleId);
        const label = role ? `${role.name} (${role.code})` : share.caseRoleId;
        if (!frozenUsers.size && currentHolders && currentHolders.size) {
          issues.push(`  ⚠ STALE: ${label} share empty in snapshot, but ${[...currentHolders].length} holder(s) exist now`);
          staleTotal += 1;
          casesToRefresh.add(inv.caseId);
        } else if (!frozenUsers.size) {
          issues.push(`  ✗ NO HOLDER: ${label} — case genuinely has no eligible holder`);
          noHolderTotal += 1;
        } else if (currentHolders && currentHolders.size) {
          const missing = [...currentHolders].filter((id) => !frozenUsers.has(id));
          if (missing.length) {
            issues.push(`  ⚠ PARTIAL: ${label} snapshot has ${frozenUsers.size} holder(s), missing ${missing.length} current one(s)`);
            staleTotal += 1;
            casesToRefresh.add(inv.caseId);
          }
        }
      }
      const bucket = byCase.get(inv.caseId) || { client: inv.case?.client?.fullName, invoices: [] };
      bucket.invoices.push(inv.invoiceNumber);
      byCase.set(inv.caseId, bucket);

      if (issues.length) {
        console.log(`\n  ${inv.invoiceNumber} (${inv.case?.client?.fullName}, ${inv.case?.caseType}) $${Number(inv.balance)} plan=${inv.incentiveSnapshot?.planName || "NONE"} ledgerCredits=${inv.incentiveLedgerEntries.length}`);
        issues.forEach((line) => console.log(line));
      }
    }

    if (refreshStale && casesToRefresh.size) {
      console.log(`\n  >>> REFRESHING ${casesToRefresh.size} case(s) with stale snapshots...`);
      for (const caseId of casesToRefresh) {
        const count = await refreshOpenInvoiceSnapshots(agency.id, caseId);
        console.log(`      case ${caseId.slice(0, 8)}… refreshed ${count} invoice snapshot(s)`);
      }
    } else if (casesToRefresh.size) {
      console.log(`\n  SUMMARY: ${staleTotal} stale share(s) across ${casesToRefresh.size} case(s) — run with --refresh-stale to fix`);
    }
    console.log(`  SUMMARY: ${noHolderTotal} genuinely-holderless share(s); ${byCase.size} case(s) with open invoices`);
  }

  // ---- Ledger / timeline health
  console.log(`\n========== LEDGER + TIMELINE HEALTH ==========`);
  const [ledgerCount, ledgerByAgency, evaluationCount, evaluationByAgency] = await Promise.all([
    prisma.incentiveLedgerEntry.count(),
    prisma.incentiveLedgerEntry.groupBy({ by: ["agencyId"], _count: { _all: true } }),
    prisma.incentiveTimelineLegEvaluation.count(),
    prisma.incentiveTimelineLegEvaluation.groupBy({ by: ["agencyId"], _count: { _all: true } }),
  ]);
  console.log(`ledger entries total: ${ledgerCount}`);
  for (const row of ledgerByAgency) {
    const agency = agencies.find((a) => a.id === row.agencyId);
    console.log(`  ${agency?.name || row.agencyId}: ${row._count._all}`);
  }
  console.log(`timeline-leg evaluations total: ${evaluationCount}`);
  for (const row of evaluationByAgency) {
    const agency = agencies.find((a) => a.id === row.agencyId);
    console.log(`  ${agency?.name || row.agencyId}: ${row._count._all}`);
  }
}

main()
  .catch((error) => {
    console.error("AUDIT FAILED:", error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
