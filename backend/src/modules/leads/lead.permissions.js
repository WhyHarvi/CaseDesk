import { portalDataScope } from "../../services/portalAccessService.js";
import { createHttpError } from "../../utils/http.js";

// Role-based visibility only — deliberately NOT scoped by pipelineSegment.
// A lead's segment (STANDARD vs IMPORT_REVIEW) only matters for list/report
// surfaces, which merge in leadSegmentWhere() below explicitly; a single
// record (getLead/requireLead and every action built on it — edit, activity,
// follow-up, qualify, ledger) stays reachable regardless of segment once you
// already have its id, e.g. from the Import Review list.
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
    return {
      AND: [
        {
          OR: [
            { ownerUserId: req.auth.userId },
            { collaborators: { some: { userId: req.auth.userId } } },
            { followUps: { some: { assignedUserId: req.auth.userId, status: "PENDING" } } },
          ],
        },
      ],
    };
  return { id: "__denied__" };
}

export function leadFollowUpAccessWhere(req) {
  const scope = portalDataScope(req, "leads");
  if (req.auth.role === "admin" || scope === "all") return {};
  if (["consultant", "frontdesk"].includes(req.auth.role) && scope === "assigned") {
    return { assignedUserId: req.auth.userId };
  }
  return { id: "__denied__" };
}

// Which working queue a list/report query should draw from. Defaults to the
// normal staff-worked pipeline; the Import Review page explicitly passes
// "IMPORT_REVIEW" to see the bulk-imported batch instead. See the
// LeadPipelineSegment comment in schema.prisma for the full rationale.
export function leadSegmentWhere(segment = "STANDARD") {
  return { pipelineSegment: segment };
}

export function canCreateLead(req) {
  return ["admin", "consultant", "frontdesk"].includes(req.auth.role);
}

// Workflow fields (stage, priority) an admin can always edit; a consultant
// only on leads they currently own. Frontdesk never — they triage the queue,
// they don't drive the pipeline. Ownership reassignment is stricter still
// (admin only, see lead.routes.js) since it's the one workflow edit that
// changes who else can act on the lead at all.
export function assertLeadWorkflowEditable(req, lead) {
  if (req.auth.role === "admin") return;
  if (req.auth.role === "consultant" && lead.ownerUserId === req.auth.userId) return;
  throw createHttpError(403, "Only an admin or this lead's assigned consultant can change that.", "FORBIDDEN");
}
