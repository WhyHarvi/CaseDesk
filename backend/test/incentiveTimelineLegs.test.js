import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { validateTimelineLegs } from "../src/services/incentivePlanService.js";

const source = (relativePath) => readFile(new URL(relativePath, import.meta.url), "utf8");

function validLeg(overrides = {}) {
  return {
    name: "Lead to Qualified",
    fromCheckpointType: "LEAD_CREATED",
    toCheckpointType: "LEAD_STAGE_REACHED",
    toCheckpointValue: "QUALIFIED",
    baseBonusAmount: 25,
    tiers: [{ thresholdDays: 1, multiplierPercent: 100 }],
    ...overrides,
  };
}

test("timeline legs are optional — a plan with none behaves exactly as it did before this feature existed", () => {
  assert.deepEqual(validateTimelineLegs(null, undefined), []);
  assert.deepEqual(validateTimelineLegs(null, []), []);
});

test("checkpoint values are required exactly for the two stage-based checkpoint types, not the other two", () => {
  assert.throws(() => validateTimelineLegs(null, [validLeg({ toCheckpointValue: "" })]), /Choose a stage for the ending checkpoint/);
  assert.throws(
    () => validateTimelineLegs(null, [validLeg({ fromCheckpointType: "LEAD_CREATED", fromCheckpointValue: "QUALIFIED" })]),
    /The starting checkpoint doesn't take a stage/,
  );
  // FIRST_PAYMENT_COLLECTED and LEAD_CREATED never need a value.
  assert.doesNotThrow(() => validateTimelineLegs(null, [validLeg({ toCheckpointType: "FIRST_PAYMENT_COLLECTED", toCheckpointValue: "" })]));
});

test("stage values are validated against the real lead/case stage vocabularies, case stages gated by the plan's case type", () => {
  assert.throws(() => validateTimelineLegs(null, [validLeg({ toCheckpointValue: "NOT_A_REAL_STAGE" })]), /isn't a valid lead stage/);
  assert.throws(
    () => validateTimelineLegs(null, [validLeg({ toCheckpointType: "CASE_STAGE_REACHED", toCheckpointValue: "Not A Stage" })]),
    /isn't a valid case stage/,
  );
  // A study-permit-only case stage is rejected for a differently-typed plan.
  assert.throws(
    () => validateTimelineLegs("Visitor Visa", [validLeg({ toCheckpointType: "CASE_STAGE_REACHED", toCheckpointValue: "Offer Letter Received" })]),
    /isn't a valid stage for this plan's case type/,
  );
  // The same stage is fine for a plan actually scoped to that case type, and
  // for the agency-wide fallback plan (caseType null).
  assert.doesNotThrow(() => validateTimelineLegs("Study Permit", [validLeg({ toCheckpointType: "CASE_STAGE_REACHED", toCheckpointValue: "Offer Letter Received" })]));
  assert.doesNotThrow(() => validateTimelineLegs(null, [validLeg({ toCheckpointType: "CASE_STAGE_REACHED", toCheckpointValue: "Offer Letter Received" })]));
});

test("a leg needs different starting and ending checkpoints, and no two legs on one plan may share the same checkpoint pair", () => {
  assert.throws(
    () => validateTimelineLegs(null, [validLeg({ fromCheckpointType: "LEAD_STAGE_REACHED", fromCheckpointValue: "QUALIFIED", toCheckpointType: "LEAD_STAGE_REACHED", toCheckpointValue: "QUALIFIED" })]),
    /needs different starting and ending checkpoints/,
  );
  assert.throws(
    () => validateTimelineLegs(null, [validLeg({ name: "First" }), validLeg({ name: "Second" })]),
    /Two timeline legs can't share the exact same start and end checkpoints/,
  );
});

test("each leg needs a name, a positive base bonus, and at least one tier", () => {
  assert.throws(() => validateTimelineLegs(null, [validLeg({ name: "" })]), /Enter a name for each timeline leg/);
  assert.throws(() => validateTimelineLegs(null, [validLeg({ baseBonusAmount: 0 })]), /base bonus amount greater than zero/);
  assert.throws(() => validateTimelineLegs(null, [validLeg({ tiers: [] })]), /Add at least one tier/);
});

test("tier thresholds must be positive, unique per leg, and multipliers stay within 0-100 — tiers are sorted ascending by day threshold", () => {
  assert.throws(() => validateTimelineLegs(null, [validLeg({ tiers: [{ thresholdDays: 0, multiplierPercent: 100 }] })]), /number of days greater than zero/);
  assert.throws(() => validateTimelineLegs(null, [validLeg({ tiers: [{ thresholdDays: 1, multiplierPercent: 150 }] })]), /bonus multiplier between 0 and 100/);
  assert.throws(
    () => validateTimelineLegs(null, [validLeg({ tiers: [{ thresholdDays: 3, multiplierPercent: 50 }, { thresholdDays: 3, multiplierPercent: 100 }] })]),
    /must use different day thresholds/,
  );

  const [leg] = validateTimelineLegs(null, [
    validLeg({ tiers: [{ thresholdDays: 7, multiplierPercent: 0.01 }, { thresholdDays: 1, multiplierPercent: 100 }, { thresholdDays: 3, multiplierPercent: 50 }] }),
  ]);
  assert.deepEqual(leg.tiers.map((tier) => tier.thresholdDays), [1, 3, 7]);
});

test("createIncentivePlan and updateIncentivePlan both wire timelineLegs through with the exact delete-and-recreate lifecycle tiers/roleShares already use", async () => {
  const service = await source("../src/services/incentivePlanService.js");

  assert.match(service, /const timelineLegs = validateTimelineLegs\(caseType, values\?\.timelineLegs\);/);
  assert.match(service, /timelineLegs: \{\s*\n\s*create: timelineLegs\.map\(\(leg, index\) => \(\{ \.\.\.leg, sortOrder: index, tiers: \{ create: leg\.tiers \} \}\)\),\s*\n\s*\},/);

  assert.match(service, /let timelineLegs = null;/);
  assert.match(service, /const effectiveCaseType = data\.caseType !== undefined \? data\.caseType : current\.caseType;/);
  assert.match(service, /await tx\.incentivePlanTimelineLeg\.deleteMany\(\{ where: \{ planId: id \} \}\);/);
  assert.match(service, /for \(const \[index, leg\] of timelineLegs\.entries\(\)\) \{/);

  // planInclude must fetch legs ordered for stable display, tiers ordered
  // ascending by threshold so the evaluation engine (and the UI) never has
  // to re-sort them.
  assert.match(service, /timelineLegs: \{ orderBy: \{ sortOrder: "asc" \}, include: \{ tiers: \{ orderBy: \{ thresholdDays: "asc" \} \} \} \}/);
});
