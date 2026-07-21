import prisma from "../services/prisma/client.js";
import { createHttpError } from "../utils/http.js";
import { recordActivity } from "../utils/prismaCrud.js";
import { updateCaseInformationSection, SectionVersionConflictError } from "../services/caseInformationSectionMutationService.js";
import { setCaseInformationSectionState } from "../services/caseInformationSectionStateService.js";
import { UnknownSectionError, UnsupportedSectionMutationError } from "../modules/case-information/sectionMutationPlan.js";

async function findScopedCase(req) {
  const data = await prisma.case.findFirst({
    where: { id: req.params.id, agencyId: req.user.agencyId },
    select: { id: true, clientId: true, caseType: true },
  });
  if (!data) throw createHttpError(404, "Case not found");
  return data;
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export async function patchCaseInformationSection(req, res) {
  const scopedCase = await findScopedCase(req);
  const sectionKey = req.params.sectionKey;

  if (!isPlainObject(req.body.data)) throw createHttpError(400, "data must be an object");
  if (!Number.isInteger(req.body.expectedVersion) || req.body.expectedVersion < 0) {
    throw createHttpError(400, "expectedVersion must be a non-negative integer (0 for a section with no saved data yet)");
  }

  try {
    const section = await updateCaseInformationSection({
      agencyId: req.user.agencyId,
      caseId: scopedCase.id,
      clientId: scopedCase.clientId,
      caseType: scopedCase.caseType,
      sectionKey,
      rawValue: req.body.data,
      expectedVersion: req.body.expectedVersion,
      userId: req.user.id,
    });
    await recordActivity({
      agencyId: req.user.agencyId,
      userId: req.user.id,
      clientId: scopedCase.clientId,
      caseId: scopedCase.id,
      action: "case_information.section_updated",
      details: `${section.label} updated`,
      entityType: "case_information_section",
      entityId: sectionKey,
    });
    res.json({ data: section });
  } catch (error) {
    if (error instanceof UnknownSectionError) throw createHttpError(404, error.message);
    if (error instanceof UnsupportedSectionMutationError) throw createHttpError(422, error.message);
    if (error instanceof SectionVersionConflictError) {
      return res.status(409).json({
        error: "version_conflict",
        message: error.message,
        data: error.current ? { version: error.current.version, data: error.current.data, updatedAt: error.current.updatedAt } : null,
      });
    }
    throw error;
  }
}

export async function putCaseInformationSectionState(req, res) {
  const scopedCase = await findScopedCase(req);
  const sectionKey = req.params.sectionKey;

  try {
    const state = await setCaseInformationSectionState({
      agencyId: req.user.agencyId,
      caseId: scopedCase.id,
      sectionKey,
      notApplicable: req.body.notApplicable,
      notApplicableReason: req.body.notApplicableReason,
      verified: req.body.verified,
      userId: req.user.id,
    });
    await recordActivity({
      agencyId: req.user.agencyId,
      userId: req.user.id,
      clientId: scopedCase.clientId,
      caseId: scopedCase.id,
      action: "case_information.section_state_updated",
      details: `${sectionKey}: ${req.body.verified ? "verified" : req.body.notApplicable ? "marked not applicable" : "state updated"}`,
      entityType: "case_information_section",
      entityId: sectionKey,
    });
    res.json({ data: state });
  } catch (error) {
    if (error.message?.startsWith("Unknown information section")) throw createHttpError(404, error.message);
    throw error;
  }
}
