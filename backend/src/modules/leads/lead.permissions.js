import { portalDataScope } from "../../services/portalAccessService.js";

export function leadAccessWhere(req) {
  // Frontdesk works the incoming lead queue for the whole agency, not just
  // whichever single user a website/intake connection happened to name as
  // "owner" — an agency can have leads landing on an admin's or a
  // consultant's queue that frontdesk still needs to triage. Scoping them
  // like a consultant (owned leads only) left frontdesk staff seeing an
  // empty list whenever they weren't the configured connection owner.
  const scope = portalDataScope(req, "leads");
  if (req.auth.role === "admin" || scope === "all") return {};
  if (
    ["consultant", "frontdesk"].includes(req.auth.role) &&
    scope === "assigned"
  )
    return { ownerUserId: req.auth.userId };
  return { id: "__denied__" };
}

export function canCreateLead(req) {
  return ["admin", "consultant", "frontdesk"].includes(req.auth.role);
}
