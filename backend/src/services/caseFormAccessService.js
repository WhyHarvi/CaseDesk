import { caseAccessWhere } from "../middleware/authorization.js";

// Case forms are always attached to a case. Keep their authorization
// predicate in one place so every form, version, comment, and file endpoint
// follows the same assigned/all/none rules as the main Cases API.
export function caseFormAccessWhere(req, where = {}) {
  return {
    ...where,
    agencyId: req.auth.agencyId,
    case: {
      agencyId: req.auth.agencyId,
      ...caseAccessWhere(req),
    },
  };
}

// For records whose parent is a CaseForm (versions, review comments, etc.).
export function caseFormChildAccessWhere(req, where = {}) {
  return {
    ...where,
    agencyId: req.auth.agencyId,
    caseForm: {
      agencyId: req.auth.agencyId,
      case: {
        agencyId: req.auth.agencyId,
        ...caseAccessWhere(req),
      },
    },
  };
}
