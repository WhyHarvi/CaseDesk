import prisma from "./prisma/client.js";
import { calculateCrsScore } from "../controllers/caseAssessmentController.js";
import { buildSectionMutationPlan } from "../modules/case-information/sectionMutationPlan.js";
import { getSection } from "../modules/case-information/informationSectionCatalog.js";
import { resolveSectionRequirement } from "../modules/case-information/caseRequirementResolver.js";
import { calculateSectionStatus } from "../modules/case-information/sectionCompletionService.js";

// Real optimistic concurrency, not an audit counter (see Lead.version,
// which nothing ever compares before writing) — this session's own
// atomic-claim idiom (updateMany on a condition, check count === 1),
// applied to `version` instead of `status`. expectedVersion 0 means "I
// believe this section has never been written to the canonical table
// before"; any other number must match the row's current version exactly.
export class SectionVersionConflictError extends Error {
  constructor(current) {
    super("This section was changed by someone else since it was last loaded.");
    this.name = "SectionVersionConflictError";
    this.current = current;
  }
}

function modelForScope(tx, scope) {
  return scope === "client" ? tx.clientInformationProfile : tx.caseInformationProfile;
}

async function upsertVersionChecked({ tx, scope, identityFields, uniqueWhere, data, expectedVersion, updatedById }) {
  const model = modelForScope(tx, scope);

  if (expectedVersion === 0) {
    try {
      return await model.create({ data: { ...identityFields, data, version: 1, updatedById } });
    } catch (error) {
      if (error.code === "P2002") {
        const current = await model.findUnique({ where: uniqueWhere });
        throw new SectionVersionConflictError(current);
      }
      throw error;
    }
  }

  const result = await model.updateMany({
    where: { ...identityFields, version: expectedVersion },
    data: { data, version: { increment: 1 }, updatedById },
  });
  if (result.count !== 1) {
    const current = await model.findUnique({ where: uniqueWhere });
    throw new SectionVersionConflictError(current);
  }
  return model.findUnique({ where: uniqueWhere });
}

function toSectionResponse({ sectionKey, caseType, row }) {
  const sectionMeta = getSection(sectionKey);
  const requirementLevel = resolveSectionRequirement(caseType, sectionKey)?.level || "optional";
  const status = calculateSectionStatus({
    sectionKey,
    adaptedSection: row.data,
    knownFields: sectionMeta.knownFields,
    requirementLevel,
  });
  return {
    sectionKey,
    label: sectionMeta.label,
    group: sectionMeta.group,
    requirementLevel,
    status: status.status,
    filledCount: status.filledCount,
    totalCount: status.totalCount,
    version: row.version,
    updatedAt: row.updatedAt,
  };
}

/**
 * Writes one section's data. Both the canonical table (version-checked,
 * the real concurrency guard) and CaseAssessment.formData (kept in sync so
 * every existing legacy-reading code path — Phase 3's aggregated API, CRS
 * scoring, CaseWorkspaceTabs.jsx — sees the change immediately, no
 * dependency on the periodic backfill script) are written in one
 * transaction: either both succeed or neither does. If the version check
 * fails, the transaction throws before formData is touched.
 */
export async function updateCaseInformationSection({ agencyId, caseId, clientId, caseType, sectionKey, rawValue, expectedVersion, userId }) {
  const section = getSection(sectionKey);
  if (!section) throw new Error(`Unknown information section "${sectionKey}"`);

  return prisma.$transaction(async (tx) => {
    const assessment = await tx.caseAssessment.findFirst({ where: { agencyId, caseId } });
    const plan = buildSectionMutationPlan({ sectionKey, formData: assessment?.formData || {}, rawValue });

    const identityFields = plan.scope === "client"
      ? { agencyId, clientId, sectionKey }
      : { agencyId, caseId, sectionKey };
    const uniqueWhere = plan.scope === "client"
      ? { agencyId_clientId_sectionKey: identityFields }
      : { agencyId_caseId_sectionKey: identityFields };

    const row = await upsertVersionChecked({
      tx,
      scope: plan.scope,
      identityFields: plan.scope === "case" ? { ...identityFields, clientId } : identityFields,
      uniqueWhere,
      data: plan.canonicalData,
      expectedVersion,
      updatedById: userId,
    });

    // Section-scoped writes never touch formData.questionnaireAssignments
    // (no INFORMATION_SECTIONS entry maps to that key), so there is nothing
    // for syncQuestionnaireAssignments to do here — only the whole-assessment
    // PATCH /:id/assessment path needs to call it.
    const { score, breakdown } = calculateCrsScore(plan.newFormData);
    await tx.caseAssessment.upsert({
      where: { agencyId_caseId: { agencyId, caseId } },
      create: { agencyId, clientId, caseId, userId, formData: plan.newFormData, crsScore: score, crsBreakdown: breakdown },
      update: { userId, formData: plan.newFormData, crsScore: score, crsBreakdown: breakdown },
    });

    return toSectionResponse({ sectionKey, caseType, row });
  });
}
