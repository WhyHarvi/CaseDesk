import { portalDataScope } from "../../services/portalAccessService.js";

// Leads bulk-imported from the Aug 2026 Admissions spreadsheet cleanup have
// widespread data-quality problems (missing contact info, missing payment
// records) and are hidden from every lead-facing surface — list, dashboard,
// reports, search, and direct lookups — until that batch is reviewed.
// LeadImportRow.createdLeadId covers everything that went through the
// CSV/Excel pipeline; the ~5 "confirmed student" placeholder leads (zero
// contact info anywhere in the source file) were created directly by a
// one-off script instead, so they carry no import-row link — every lead from
// that batch does carry an "Admissions detail (imported)" activity though,
// so that closes the gap. Both are exact provenance matches, not heuristics.
// Remove this clause once the batch has been cleaned up.
const HIDE_IMPORTED_LEADS = {
  importedRows: { none: {} },
  activities: { none: { title: "Admissions detail (imported)" } },
};

export function leadAccessWhere(req) {
  // Frontdesk works the incoming lead queue for the whole agency, not just
  // whichever single user a website/intake connection happened to name as
  // "owner" — an agency can have leads landing on an admin's or a
  // consultant's queue that frontdesk still needs to triage. Scoping them
  // like a consultant (owned leads only) left frontdesk staff seeing an
  // empty list whenever they weren't the configured connection owner.
  const scope = portalDataScope(req, "leads");
  if (req.auth.role === "admin" || scope === "all") return { ...HIDE_IMPORTED_LEADS };
  if (
    ["consultant", "frontdesk"].includes(req.auth.role) &&
    scope === "assigned"
  )
    return { ownerUserId: req.auth.userId, ...HIDE_IMPORTED_LEADS };
  return { id: "__denied__" };
}

export function canCreateLead(req) {
  return ["admin", "consultant", "frontdesk"].includes(req.auth.role);
}
