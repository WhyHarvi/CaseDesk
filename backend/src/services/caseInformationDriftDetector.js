import prisma from "./prisma/client.js";
import { logger } from "./logger.js";
import { adaptLegacyFormData } from "../modules/case-information/legacyFormDataAdapter.js";
import { INFORMATION_SECTIONS } from "../modules/case-information/informationSectionCatalog.js";

// Phase 2's precondition for Phase 7 ("cut over only after the drift
// detection job shows zero mismatches over a defined observation window").
// This never writes to the canonical tables — it only samples recently
// touched CaseAssessment rows, re-derives what the backfill script would
// have written, and warns if the stored ClientInformationProfile /
// CaseInformationProfile rows have drifted out of sync with formData
// (which nothing has stopped writing to — see legacyFormDataAdapter.js).
// Same connection-pool caution as quickbooksWebhookService.js: this is a
// background poll competing for the same tight DATABASE_URL connection
// pool, so it defaults to a slow cadence and floors any override.
const DRIFT_POLL_MS = Math.max(Number(process.env.CASE_INFO_DRIFT_POLL_MS) || 900_000, 60_000);
const SAMPLE_SIZE = 25;
let driftTimer = null;

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

function deepEqualStructural(a, b) {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) {
    if (a.length !== b.length) return false;
    return a.every((value, index) => deepEqualStructural(value, b[index]));
  }
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) return false;
  return aKeys.every((key) => Object.prototype.hasOwnProperty.call(b, key) && deepEqualStructural(a[key], b[key]));
}

function deepEqual(a, b) {
  return deepEqualStructural(normalize(a), normalize(b));
}

async function checkAssessment(assessment) {
  const { agencyId, caseId, clientId, formData } = assessment;
  const adapted = adaptLegacyFormData(formData);
  let mismatches = 0;

  for (const section of INFORMATION_SECTIONS) {
    const expected = adapted[section.key];
    const row = section.scope === "client"
      ? await prisma.clientInformationProfile.findUnique({
          where: { agencyId_clientId_sectionKey: { agencyId, clientId, sectionKey: section.key } },
        })
      : await prisma.caseInformationProfile.findUnique({
          where: { agencyId_caseId_sectionKey: { agencyId, caseId, sectionKey: section.key } },
        });

    if (!row) {
      mismatches += 1;
      logger.warn("case_information_drift.missing_row", { caseId, clientId, sectionKey: section.key, scope: section.scope });
      continue;
    }
    if (!deepEqual(row.data, expected)) {
      mismatches += 1;
      logger.warn("case_information_drift.stale_row", { caseId, clientId, sectionKey: section.key, scope: section.scope, storedUpdatedAt: row.updatedAt });
    }
  }

  return mismatches;
}

export async function runCaseInformationDriftCheck() {
  const assessments = await prisma.caseAssessment.findMany({
    orderBy: { updatedAt: "desc" },
    take: SAMPLE_SIZE,
    select: { agencyId: true, caseId: true, clientId: true, formData: true },
  });

  let totalMismatches = 0;
  for (const assessment of assessments) {
    totalMismatches += await checkAssessment(assessment);
  }

  if (totalMismatches > 0) {
    logger.warn("case_information_drift.pass_complete", { sampled: assessments.length, mismatches: totalMismatches });
  }
  return { sampled: assessments.length, mismatches: totalMismatches };
}

export function startCaseInformationDriftDetector() {
  if (driftTimer) return;
  driftTimer = setInterval(() => {
    runCaseInformationDriftCheck().catch((error) => logger.warn("case_information_drift.pass_failed", { reason: error.message }));
  }, DRIFT_POLL_MS);
  if (driftTimer.unref) driftTimer.unref();
}

export function stopCaseInformationDriftDetector() {
  if (driftTimer) clearInterval(driftTimer);
  driftTimer = null;
}
