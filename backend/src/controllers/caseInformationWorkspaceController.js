import prisma from "../services/prisma/client.js";
import { createHttpError } from "../utils/http.js";
import { buildCaseInformationSummary } from "../modules/case-information/caseInformationWorkspace.js";
import { resolveCaseTypeKey } from "../modules/case-information/caseTypeCatalog.js";

async function findScopedCase(req) {
  const data = await prisma.case.findFirst({
    where: { id: req.params.id, agencyId: req.user.agencyId },
    select: { id: true, clientId: true, caseType: true },
  });
  if (!data) throw createHttpError(404, "Case not found");
  return data;
}

/**
 * Phase 3's aggregated read endpoint. Reads straight from
 * CaseAssessment.formData (via Phase 1's buildCaseInformationSummary), NOT
 * the Phase 2 ClientInformationProfile/CaseInformationProfile tables —
 * those are kept in sync by the backfill script and watched by
 * caseInformationDriftDetector.js but nothing keeps them live-updated on
 * every write yet, so they're not a safe read source for a real UI until a
 * later phase makes them authoritative. formData stays the single source
 * of truth here, matching Phase 2's "dual-read compatibility" non-goal.
 */
export async function getCaseInformationWorkspace(req, res) {
  const scopedCase = await findScopedCase(req);

  const [assessment, sectionStates] = await Promise.all([
    prisma.caseAssessment.findFirst({
      where: { agencyId: req.user.agencyId, caseId: scopedCase.id },
      select: { formData: true },
    }),
    prisma.caseInformationSectionState.findMany({
      where: { agencyId: req.user.agencyId, caseId: scopedCase.id },
      select: { sectionKey: true, enabled: true, notApplicable: true, notApplicableReason: true, verifiedAt: true, verifiedById: true },
    }),
  ]);

  const enabledSectionKeys = new Set(sectionStates.filter((state) => state.enabled).map((state) => state.sectionKey));
  const summary = buildCaseInformationSummary({ caseType: scopedCase.caseType, formData: assessment?.formData || {}, enabledSectionKeys });
  const stateBySectionKey = new Map(sectionStates.map((state) => [state.sectionKey, state]));

  const sections = summary.sections.map((section) => {
    const state = stateBySectionKey.get(section.sectionKey);
    return {
      ...section,
      notApplicable: state?.notApplicable ?? false,
      notApplicableReason: state?.notApplicableReason ?? null,
      verifiedAt: state?.verifiedAt ?? null,
      verifiedById: state?.verifiedById ?? null,
    };
  });

  res.json({
    data: {
      caseId: scopedCase.id,
      clientId: scopedCase.clientId,
      caseType: scopedCase.caseType,
      sections,
      needsAttention: summary.needsAttention,
      summary: summary.summary,
      // Phase 4 (review workflow / ProfileChangeSet) territory — kept as an
      // explicit empty placeholder now so this response shape doesn't need
      // to change shape again once that phase lands.
      recentSubmissions: [],
    },
  });
}

/**
 * Lets the questionnaire-assignment picker warn a consultant when the
 * application type they're about to assign doesn't match the case's own
 * caseType — e.g. assigning a "Study Permit" questionnaire on a case
 * classified as "Spousal Sponsorship". Reuses resolveCaseTypeKey (the same
 * alias resolution caseRequirementResolver.js already relies on) instead of
 * duplicating that matching logic in the frontend. Fails open (matches:
 * true) whenever either side can't be confidently classified, since a
 * possibly-wrong nudge is worse than no nudge.
 */
export async function getCaseTypeMatch(req, res) {
  const scopedCase = await findScopedCase(req);
  const applicationType = String(req.query.applicationType || "");

  const caseKey = resolveCaseTypeKey(scopedCase.caseType);
  const applicationKey = resolveCaseTypeKey(applicationType);
  const matches = !caseKey || !applicationKey || caseKey === applicationKey;

  res.json({ data: { matches, caseType: scopedCase.caseType } });
}
