import prisma from "../services/prisma/client.js";
import { resolvePortalPermission } from "../services/clientPortalPolicyService.js";

async function caseIdForResource(req, resource) {
  if (resource === "document") {
    return (await prisma.clientDocument.findFirst({ where: { id: req.params.id, agencyId: req.auth.agencyId }, select: { caseId: true } }))?.caseId || null;
  }
  if (resource === "invoice") {
    return (await prisma.caseInvoice.findFirst({ where: { id: req.params.invoiceId, agencyId: req.auth.agencyId }, select: { caseId: true } }))?.caseId || null;
  }
  if (resource === "questionnaire") return (await prisma.questionnaireAssignment.findFirst({ where: { id: req.params.assignmentId, agencyId: req.auth.agencyId }, select: { caseId: true } }))?.caseId || null;
  if (resource === "caseFormRequest") return (await prisma.caseFormClientRequest.findFirst({ where: { id: req.params.requestId, agencyId: req.auth.agencyId }, select: { caseId: true } }))?.caseId || null;
  if (resource === "caseFormSignature") return (await prisma.caseFormSignatureRequest.findFirst({ where: { id: req.params.requestId, agencyId: req.auth.agencyId }, select: { caseId: true } }))?.caseId || null;
  if (resource === "agreement") return (await prisma.writtenDocument.findFirst({ where: { id: req.params.id, agencyId: req.auth.agencyId }, select: { caseId: true } }))?.caseId || null;
  if (resource === "conversation") return (await prisma.communicationConversation.findFirst({ where: { id: req.params.id, agencyId: req.auth.agencyId }, select: { caseId: true } }))?.caseId || null;
  return req.params.caseId || req.body?.caseId || req.query?.caseId || null;
}

export function requireClientPortalPermission(key, { resource = null } = {}) {
  return async (req, res, next) => {
    try {
      const link = await prisma.clientUser.findFirst({ where: { agencyId: req.auth.agencyId, userId: req.auth.userId }, orderBy: { isPrimary: "desc" }, select: { id: true } });
      if (!link) return res.status(403).json({ success: false, code: "PORTAL_ACCESS_DENIED", message: "Client portal access is unavailable." });
      if (resource === "allCases") {
        const clientLink = await prisma.clientUser.findFirst({ where: { id: link.id, agencyId: req.auth.agencyId }, select: { clientId: true } });
        const cases = await prisma.case.findMany({ where: { agencyId: req.auth.agencyId, clientId: clientLink.clientId, deletedAt: null }, select: { id: true } });
        const decisions = await Promise.all([resolvePortalPermission({ agencyId: req.auth.agencyId, clientUserId: link.id, key }), ...cases.map((item) => resolvePortalPermission({ agencyId: req.auth.agencyId, clientUserId: link.id, caseId: item.id, key }))]);
        const denied = decisions.find((item) => !item.allowed);
        if (denied) return res.status(403).json({ success: false, code: denied.source, message: denied.source === "PORTAL_SUSPENDED" ? "Your portal access is suspended. Contact your agency for help." : "This portal area is restricted for one or more of your cases." });
        req.portalPermission = { key, effective: "ALLOW", source: "ALL_CASES" };
        return next();
      }
      const caseId = resource ? await caseIdForResource(req, resource) : await caseIdForResource(req, null);
      if (["invoice", "questionnaire", "caseFormRequest", "caseFormSignature", "agreement"].includes(resource) && !caseId) return res.status(404).json({ success: false, code: "NOT_FOUND", message: "Portal resource not found." });
      const result = await resolvePortalPermission({ agencyId: req.auth.agencyId, clientUserId: link.id, caseId, key });
      if (!result.allowed) {
        return res.status(403).json({ success: false, code: result.source, message: result.source === "PORTAL_SUSPENDED" ? "Your portal access is suspended. Contact your agency for help." : "This portal action is not available for your account." });
      }
      req.portalPermission = { key, effective: result.effective, source: result.source };
      next();
    } catch (error) {
      next(error);
    }
  };
}
