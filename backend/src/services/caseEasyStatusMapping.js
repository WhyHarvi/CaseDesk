// Case Easy's single "Status" field conflates CaseDesk's two independent
// dimensions — stage (pipeline position) and status (activity state) — see
// docs/production/case-easy-import-prompt.md. This is a pure lookup, no DB
// access, so both the review-step preview and the actual conversion write
// path can share one definition instead of drifting apart.
//
// Imported cases are historical reference data, not live work handed to a
// consultant today — every one lands Closed and archived by default,
// regardless of what Case Easy's own status said, so the import never
// silently drops old records into someone's active pipeline. Stage is kept
// as a purely informational marker of where the case last sat; the
// reviewer can still override status/stage/archived per case before
// confirming the import.
//
// `stage: null` entries have no confident pipeline-position signal in Case
// Easy's vocabulary — left for the reviewer to set explicitly rather than
// guessed, per the import prompt's "flag back rather than guess" rule.
//
// "approved"/"denied" map to Closed, not Decision Received. The Decision
// Received stage now requires a real case_decisions record (decision
// outcome, permit expiry or refusal resolution) enforced by a DB trigger —
// Case Easy's export never captured that detail, only a bare date, so
// there's no way to satisfy it from import data. Closed is already this
// case's final status/stage regardless, and decisionAt still gets recorded
// on the case as an informational date.
const STAGE_MAP = {
  "prospect": "Lead",
  "active": null,
  "follow up": null,
  "in progress": null,
  "submitted": "Submitted",
  "ita received": null,
  "approved": "Closed",
  "denied": "Closed",
  "cancelled": null,
  "closed": "Closed",
  "archived": "Closed",
};

const DEFAULT_STAGE = "Lead";

export function mapCaseEasyStatus(rawStatus) {
  const key = String(rawStatus || "").trim().toLowerCase();
  const recognized = Object.prototype.hasOwnProperty.call(STAGE_MAP, key);
  return { stage: (recognized && STAGE_MAP[key]) || DEFAULT_STAGE, status: "Closed", archived: true, recognized };
}
