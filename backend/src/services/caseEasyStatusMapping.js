// Case Easy's single "Status" field conflates CaseDesk's two independent
// dimensions — stage (pipeline position) and status (activity state) — see
// docs/production/case-easy-import-prompt.md. This is a pure lookup, no DB
// access, so both the review-step preview and the actual conversion write
// path can share one definition instead of drifting apart.
//
// `stage: null` entries have no confident pipeline-position signal in Case
// Easy's vocabulary — left for the reviewer to set explicitly rather than
// guessed, per the import prompt's "flag back rather than guess" rule.
const STATUS_MAP = {
  "prospect": { stage: "Lead", status: "Open", archived: false },
  "active": { stage: null, status: "Active", archived: false },
  "follow up": { stage: null, status: "Active", archived: false },
  "in progress": { stage: null, status: "Active", archived: false },
  "submitted": { stage: "Submitted", status: "Active", archived: false },
  "ita received": { stage: null, status: "Active", archived: false },
  "approved": { stage: "Decision Received", status: "Completed", archived: false },
  "denied": { stage: "Decision Received", status: "Closed", archived: false },
  "cancelled": { stage: null, status: "Cancelled", archived: false },
  "closed": { stage: "Closed", status: "Closed", archived: false },
  "archived": { stage: "Closed", status: "Closed", archived: true },
};

const DEFAULT_STAGE = "Lead";

export function mapCaseEasyStatus(rawStatus) {
  const key = String(rawStatus || "").trim().toLowerCase();
  const match = STATUS_MAP[key];
  if (!match) {
    return { stage: DEFAULT_STAGE, status: "Open", archived: false, recognized: false };
  }
  return { stage: match.stage || DEFAULT_STAGE, status: match.status, archived: match.archived, recognized: true };
}
