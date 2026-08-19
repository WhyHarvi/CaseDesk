// The shared checkpoint vocabulary for incentive timeline legs — plain
// validated strings (not a DB enum), same convention as formulaType and
// attributionKind, so a new checkpoint type never needs a migration.
// Used by both the plan editor's validation (incentivePlanService.js) and
// the evaluation engine that resolves these into real timestamps
// (incentiveTimelineService.js).
export const CHECKPOINT_TYPES = ["LEAD_CREATED", "LEAD_STAGE_REACHED", "CASE_STAGE_REACHED", "FIRST_PAYMENT_COLLECTED"];

export const CHECKPOINT_TYPES_REQUIRING_VALUE = new Set(["LEAD_STAGE_REACHED", "CASE_STAGE_REACHED"]);
