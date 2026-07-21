import "dotenv/config";
import prisma from "../src/services/prisma/client.js";
import { adaptLegacyFormData } from "../src/modules/case-information/legacyFormDataAdapter.js";
import { INFORMATION_SECTIONS } from "../src/modules/case-information/informationSectionCatalog.js";

const apply = process.argv.includes("--apply");

// Copies today's CaseAssessment.formData into the new section-granular
// ClientInformationProfile / CaseInformationProfile tables (Phase 2). Purely
// additive: never reads or writes formData itself, so the legacy path stays
// fully intact and this can be re-run any number of times (upsert-based) as
// formData keeps changing under it, right up until Phase 7 decides to cut
// over. `data` stores the exact object legacyFormDataAdapter.js already
// produces per section (kind/raw/entries/pairs/complete/gate) — the same
// shape sectionCompletionService.js consumes today — rather than a
// reshaped copy, so the new tables can be read by the existing domain
// layer with zero translation and compared byte-for-byte in the drift
// detector.
// Plain JSON.stringify equality is unreliable here for two reasons: (1) the
// stored side comes back from Postgres jsonb, which normalizes (does not
// preserve) object key order; (2) legacyFormDataAdapter.js's adapted objects
// can carry explicit `complete: undefined` / `gate: undefined` keys
// (Object.keys sees them; JSON serialization on the jsonb write silently
// drops them), so a freshly-adapted object can have more Object.keys() than
// the same data read back from storage even when nothing meaningfully
// differs. Round-tripping both sides through JSON first normalizes both of
// those away before the structural (key-order-independent) comparison.
function normalize(value) {
  return JSON.parse(JSON.stringify(value));
}

function deepEqual(a, b) {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) {
    if (a.length !== b.length) return false;
    return a.every((value, index) => deepEqual(value, b[index]));
  }
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) return false;
  return aKeys.every((key) => Object.prototype.hasOwnProperty.call(b, key) && deepEqual(a[key], b[key]));
}

function jsonEqual(a, b) {
  return deepEqual(normalize(a), normalize(b));
}

async function upsertProfile({ model, uniqueWhere, identityFields, createData, updateData, dryRunLabel, stats }) {
  const existing = await model.findUnique({ where: uniqueWhere });
  if (!existing) {
    stats.wouldCreate += 1;
    if (apply) {
      await model.create({ data: { ...identityFields, ...createData } });
      stats.created += 1;
    } else {
      console.log(`[dry-run] create ${dryRunLabel}`);
    }
    return;
  }
  if (jsonEqual(existing.data, updateData.data)) {
    stats.unchanged += 1;
    return;
  }
  stats.wouldUpdate += 1;
  if (apply) {
    await model.update({ where: { id: existing.id }, data: updateData });
    stats.updated += 1;
  } else {
    console.log(`[dry-run] update ${dryRunLabel}`);
  }
}

async function backfillCase(caseAssessment) {
  const { agencyId, caseId, clientId, formData } = caseAssessment;
  const adapted = adaptLegacyFormData(formData);

  const clientStats = { wouldCreate: 0, wouldUpdate: 0, unchanged: 0, created: 0, updated: 0 };
  const caseStats = { wouldCreate: 0, wouldUpdate: 0, unchanged: 0, created: 0, updated: 0 };

  for (const section of INFORMATION_SECTIONS) {
    const data = adapted[section.key];
    if (section.scope === "client") {
      await upsertProfile({
        model: prisma.clientInformationProfile,
        uniqueWhere: { agencyId_clientId_sectionKey: { agencyId, clientId, sectionKey: section.key } },
        identityFields: { agencyId, clientId, sectionKey: section.key },
        createData: { data },
        updateData: { data },
        dryRunLabel: `client_information_profiles client=${clientId} section=${section.key}`,
        stats: clientStats,
      });
    } else {
      await upsertProfile({
        model: prisma.caseInformationProfile,
        uniqueWhere: { agencyId_caseId_sectionKey: { agencyId, caseId, sectionKey: section.key } },
        identityFields: { agencyId, caseId, clientId, sectionKey: section.key },
        createData: { data },
        updateData: { data },
        dryRunLabel: `case_information_profiles case=${caseId} section=${section.key}`,
        stats: caseStats,
      });
    }
  }

  return { caseId, clientStats, caseStats };
}

function mergeStats(target, source) {
  for (const key of Object.keys(source)) target[key] += source[key];
}

async function run() {
  const assessments = await prisma.caseAssessment.findMany({
    select: { agencyId: true, caseId: true, clientId: true, formData: true },
  });

  const totals = {
    client: { wouldCreate: 0, wouldUpdate: 0, unchanged: 0, created: 0, updated: 0 },
    case: { wouldCreate: 0, wouldUpdate: 0, unchanged: 0, created: 0, updated: 0 },
  };

  for (const assessment of assessments) {
    const { caseId, clientStats, caseStats } = await backfillCase(assessment);
    mergeStats(totals.client, clientStats);
    mergeStats(totals.case, caseStats);
    const changed = clientStats.wouldCreate + clientStats.wouldUpdate + caseStats.wouldCreate + caseStats.wouldUpdate;
    if (changed > 0) console.log(`case ${caseId}: ${changed} section row(s) ${apply ? "written" : "pending"}`);
  }

  console.log(`\nCases scanned: ${assessments.length}`);
  console.log(`client_information_profiles: ${apply ? `${totals.client.created} created, ${totals.client.updated} updated` : `${totals.client.wouldCreate} would create, ${totals.client.wouldUpdate} would update`}, ${totals.client.unchanged} unchanged`);
  console.log(`case_information_profiles: ${apply ? `${totals.case.created} created, ${totals.case.updated} updated` : `${totals.case.wouldCreate} would create, ${totals.case.wouldUpdate} would update`}, ${totals.case.unchanged} unchanged`);
  console.log(apply ? "Backfill complete." : "Dry run complete. Re-run with --apply to write.");
}

await run();
await prisma.$disconnect();
