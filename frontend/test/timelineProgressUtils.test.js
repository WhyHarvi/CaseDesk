import assert from "node:assert/strict";
import test from "node:test";
import { computeLegProgress, progressColor } from "../src/components/incentives/timelineProgressUtils.js";

const TIERS = [
  { id: "t1", thresholdDays: 1, multiplierPercent: 100 },
  { id: "t2", thresholdDays: 3, multiplierPercent: 50 },
];

function daysAfter(base, days) {
  return new Date(base.getTime() + days * 86_400_000);
}

test("no fromCheckpointAt means the leg hasn't started yet, regardless of tiers/now", () => {
  const result = computeLegProgress({ fromCheckpointAt: null, tiers: TIERS, now: new Date() });
  assert.deepEqual(result, { state: "NOT_STARTED" });
});

test("elapsed exactly at a tier's threshold matches that tier (inclusive >=, same rule as the backend's tierMultiplierFor) with ratio 1", () => {
  const from = new Date("2026-01-01T00:00:00.000Z");
  const result = computeLegProgress({ fromCheckpointAt: from, tiers: TIERS, now: daysAfter(from, 1) });
  assert.equal(result.state, "IN_PROGRESS");
  assert.equal(result.currentTier.thresholdDays, 1);
  assert.equal(result.ratio, 1);
});

test("crossing a tier boundary resets the ratio toward 0 against the NEW window — the sawtooth", () => {
  const from = new Date("2026-01-01T00:00:00.000Z");
  const mid = computeLegProgress({ fromCheckpointAt: from, tiers: TIERS, now: daysAfter(from, 0.5) });
  assert.equal(mid.currentTier.thresholdDays, 1);
  assert.equal(mid.ratio, 0.5);

  const justAfter = computeLegProgress({ fromCheckpointAt: from, tiers: TIERS, now: daysAfter(from, 1.01) });
  assert.equal(justAfter.currentTier.thresholdDays, 3);
  // Window is (1, 3]; at elapsed=1.01 that's barely into it, not ~0.5 like
  // cumulative elapsed/3 would naively suggest.
  assert.ok(justAfter.ratio < 0.02, `expected ratio to reset near 0, got ${justAfter.ratio}`);
});

test("elapsed beyond every tier's threshold is a MISSED projection, not a crash or a clamp to the last tier", () => {
  const from = new Date("2026-01-01T00:00:00.000Z");
  const result = computeLegProgress({ fromCheckpointAt: from, tiers: TIERS, now: daysAfter(from, 10) });
  assert.equal(result.state, "MISSED");
  assert.ok(result.elapsedDays > 3);
  assert.equal(result.currentTier, undefined);
  assert.equal(result.ratio, undefined);
});

test("now before fromCheckpointAt (clock skew) clamps elapsed to 0 instead of going negative", () => {
  const from = new Date("2026-01-01T00:00:00.000Z");
  const result = computeLegProgress({ fromCheckpointAt: from, tiers: TIERS, now: daysAfter(from, -1) });
  assert.equal(result.state, "IN_PROGRESS");
  assert.equal(result.elapsedDays, 0);
  assert.equal(result.ratio, 0);
  assert.equal(result.currentTier.thresholdDays, 1);
});

test("an empty tier list resolves as MISSED rather than throwing", () => {
  const result = computeLegProgress({ fromCheckpointAt: new Date(), tiers: [], now: new Date() });
  assert.equal(result.state, "MISSED");
});

test("isFinalTier is only true on the last tier, and deadlineAt/finalDeadlineAt diverge until then", () => {
  const from = new Date("2026-01-01T00:00:00.000Z");
  const early = computeLegProgress({ fromCheckpointAt: from, tiers: TIERS, now: daysAfter(from, 0.5) });
  assert.equal(early.isFinalTier, false);
  assert.notEqual(early.deadlineAt.getTime(), early.finalDeadlineAt.getTime());

  const late = computeLegProgress({ fromCheckpointAt: from, tiers: TIERS, now: daysAfter(from, 2) });
  assert.equal(late.isFinalTier, true);
  assert.equal(late.deadlineAt.getTime(), late.finalDeadlineAt.getTime());
});

test("progressColor renders a lower-multiplier tier visibly dimmer (closer to neutral gray) than a full-value tier at the same ratio", () => {
  const fullValue = progressColor(0.1, { multiplierPercent: 100 });
  const halfValue = progressColor(0.1, { multiplierPercent: 50 });
  assert.notEqual(fullValue, halfValue);
});

test("progressColor never throws with no currentTier (defaults to full-value styling)", () => {
  assert.doesNotThrow(() => progressColor(0.5, null));
});
