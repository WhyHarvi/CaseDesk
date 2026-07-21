import prisma from "./prisma/client.js";
import { getSection } from "../modules/case-information/informationSectionCatalog.js";

/**
 * Consultant-only review actions layered on top of a section: marking it
 * verified (reviewed and confirmed accurate) or not-applicable (with a
 * reason). Never touches formData or the canonical data tables — this is
 * pure state about a section, not the section's content, matching
 * sectionCompletionService.js's "never stores calculated status, only
 * derives it" discipline (CaseInformationSectionState comment in
 * schema.prisma).
 */
export async function setCaseInformationSectionState({ agencyId, caseId, sectionKey, notApplicable, notApplicableReason, verified, userId }) {
  if (!getSection(sectionKey)) throw new Error(`Unknown information section "${sectionKey}"`);

  const data = {};
  if (notApplicable !== undefined) {
    data.notApplicable = Boolean(notApplicable);
    data.notApplicableReason = notApplicable ? (notApplicableReason ? String(notApplicableReason).trim().slice(0, 500) : null) : null;
  }
  if (verified !== undefined) {
    data.verifiedAt = verified ? new Date() : null;
    data.verifiedById = verified ? userId : null;
  }

  return prisma.caseInformationSectionState.upsert({
    where: { agencyId_caseId_sectionKey: { agencyId, caseId, sectionKey } },
    create: { agencyId, caseId, sectionKey, notApplicable: false, ...data },
    update: data,
  });
}
