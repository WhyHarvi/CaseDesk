const MS_PER_DAY = 86_400_000;

function clamp01(value) {
  if (Number.isNaN(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

// The one piece of this widget with no existing precedent in the codebase.
// Contract: fromCheckpointAt/now are Date objects (callers must `new
// Date(...)` an ISO string before calling); tiers must already be sorted
// ascending by thresholdDays (the API always returns them that way). Never
// throws — every input is defensively coerced/clamped.
export function computeLegProgress({ fromCheckpointAt, tiers, now }) {
  if (!fromCheckpointAt) return { state: "NOT_STARTED" };

  const normalizedTiers = (Array.isArray(tiers) ? tiers : []).map((tier) => ({
    id: tier.id,
    thresholdDays: Number(tier.thresholdDays),
    multiplierPercent: Number(tier.multiplierPercent),
  }));
  if (!normalizedTiers.length) return { state: "MISSED", elapsedDays: 0 };

  // Clamped, never negative — clock skew or a fromCheckpointAt observed
  // slightly ahead of a stale client clock must never produce a negative
  // ratio or crash.
  const elapsedDays = Math.max(0, (now.getTime() - fromCheckpointAt.getTime()) / MS_PER_DAY);

  // Same >= rule as the backend's tierMultiplierFor — the smallest
  // thresholdDays that still covers elapsed time wins. The live projection
  // must never disagree with what will actually get credited later.
  let currentTier = null;
  let tierIndex = -1;
  for (let i = 0; i < normalizedTiers.length; i += 1) {
    if (normalizedTiers[i].thresholdDays >= elapsedDays) {
      currentTier = normalizedTiers[i];
      tierIndex = i;
      break;
    }
  }

  if (!currentTier) return { state: "MISSED", elapsedDays };

  const windowStart = tierIndex > 0 ? normalizedTiers[tierIndex - 1].thresholdDays : 0;
  const windowEnd = currentTier.thresholdDays;
  const ratio = windowEnd > windowStart ? clamp01((elapsedDays - windowStart) / (windowEnd - windowStart)) : 1;
  const lastTier = normalizedTiers[normalizedTiers.length - 1];

  return {
    state: "IN_PROGRESS",
    elapsedDays,
    ratio,
    currentTier,
    nextTier: normalizedTiers[tierIndex + 1] || null,
    deadlineAt: new Date(fromCheckpointAt.getTime() + windowEnd * MS_PER_DAY),
    finalDeadlineAt: new Date(fromCheckpointAt.getTime() + lastTier.thresholdDays * MS_PER_DAY),
    isFinalTier: currentTier.thresholdDays === lastTier.thresholdDays,
  };
}

const EMERALD = [16, 185, 129];
const AMBER = [245, 158, 11];
const ROSE = [244, 63, 94];
const SLATE = [148, 163, 184];

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function lerpColor(colorA, colorB, t) {
  return [0, 1, 2].map((i) => Math.round(lerp(colorA[i], colorB[i], t)));
}

function toRgb([r, g, b]) {
  return `rgb(${r}, ${g}, ${b})`;
}

// Presentational only — kept separate from computeLegProgress's math.
// Green -> amber -> rose across ratio 0->1 (this app's existing good->bad
// vocabulary, not a new hue set), then blended toward neutral gray by how
// little the current tier is actually worth — a tier only paying 50%
// should read visibly muted even early in its window, so a 100% tier
// clearly stands out as the one worth chasing.
export function progressColor(ratio, currentTier) {
  const clamped = clamp01(ratio);
  const base = clamped <= 0.5 ? lerpColor(EMERALD, AMBER, clamped / 0.5) : lerpColor(AMBER, ROSE, (clamped - 0.5) / 0.5);
  const multiplierPercent = currentTier?.multiplierPercent ?? 100;
  const muteAmount = clamp01(1 - multiplierPercent / 100) * 0.6;
  return toRgb(lerpColor(base, SLATE, muteAmount));
}
