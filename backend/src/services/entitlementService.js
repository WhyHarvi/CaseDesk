import prisma from "./prisma/client.js";

const FULL_ACCESS_STATUSES = new Set(["trialing", "active", "past_due", "grace_period"]);

function dateValue(value) {
  if (!value) return null;
  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function activeWindow(item, at) {
  const startsAt = dateValue(item.startsAt);
  const expiresAt = dateValue(item.expiresAt);
  return (!startsAt || startsAt <= at) && (!expiresAt || expiresAt > at);
}

function decimalValue(value) {
  if (value === null || value === undefined) return null;
  return Number(value);
}

function nextBoundary(items, at) {
  const candidates = items
    .flatMap((item) => [dateValue(item.startsAt), dateValue(item.expiresAt)])
    .filter((value) => value && value > at)
    .sort((left, right) => left - right);
  return candidates[0] || null;
}

export function subscriptionAccessMode(subscription, at = new Date()) {
  if (!subscription) return "unconfigured";
  if (subscription.status === "trialing") {
    const trialEndsAt = dateValue(subscription.trialEndsAt);
    if (!trialEndsAt || trialEndsAt <= at) return "read_only";
  }
  if (subscription.status === "grace_period") {
    const graceEndsAt = dateValue(subscription.graceEndsAt);
    if (graceEndsAt && graceEndsAt <= at) return "read_only";
  }
  return FULL_ACCESS_STATUSES.has(subscription.status) ? "full" : "read_only";
}

export async function resolveWorkspaceEntitlements(
  agencyId,
  { db = prisma, at = new Date() } = {},
) {
  const [features, limits, subscription, featureOverrides, limitOverrides] = await Promise.all([
    db.commercialFeature.findMany({
      where: { isActive: true },
      orderBy: [{ module: { sortOrder: "asc" } }, { sortOrder: "asc" }],
      include: { module: { select: { key: true, name: true, sortOrder: true } } },
    }),
    db.commercialLimit.findMany({
      where: { isActive: true },
      orderBy: [{ module: { sortOrder: "asc" } }, { sortOrder: "asc" }],
      include: { module: { select: { key: true, name: true, sortOrder: true } } },
    }),
    db.workspaceSubscription.findUnique({
      where: { agencyId },
      include: {
        plan: {
          include: {
            prices: { where: { isActive: true } },
            features: { include: { feature: true } },
            limits: { include: { limit: true } },
          },
        },
      },
    }),
    db.workspaceFeatureOverride.findMany({ where: { agencyId }, include: { feature: true } }),
    db.workspaceLimitOverride.findMany({ where: { agencyId }, include: { limit: true } }),
  ]);

  const featureValues = Object.fromEntries(features.map((feature) => [feature.key, false]));
  const limitValues = Object.fromEntries(limits.map((limit) => [limit.key, null]));
  const sources = {
    features: Object.fromEntries(features.map((feature) => [feature.key, "not_included"])),
    limits: Object.fromEntries(limits.map((limit) => [limit.key, "not_included"])),
  };

  for (const grant of subscription?.plan?.features || []) {
    if (!grant.feature.isActive) continue;
    featureValues[grant.feature.key] = grant.enabled;
    sources.features[grant.feature.key] = `plan:${subscription.plan.key}`;
  }
  for (const planLimit of subscription?.plan?.limits || []) {
    if (!planLimit.limit.isActive) continue;
    limitValues[planLimit.limit.key] = planLimit.isUnlimited
      ? { unlimited: true, value: null }
      : { unlimited: false, value: decimalValue(planLimit.value) };
    sources.limits[planLimit.limit.key] = `plan:${subscription.plan.key}`;
  }

  for (const override of featureOverrides.filter((item) => activeWindow(item, at))) {
    if (!override.feature.isActive) continue;
    featureValues[override.feature.key] = override.enabled;
    sources.features[override.feature.key] = `override:${override.id}`;
  }
  for (const override of limitOverrides.filter((item) => activeWindow(item, at))) {
    if (!override.limit.isActive) continue;
    limitValues[override.limit.key] = override.isUnlimited
      ? { unlimited: true, value: null }
      : { unlimited: false, value: decimalValue(override.value) };
    sources.limits[override.limit.key] = `override:${override.id}`;
  }

  const boundaries = [...featureOverrides, ...limitOverrides];
  if (subscription?.status === "grace_period" && subscription.graceEndsAt) {
    boundaries.push({ expiresAt: subscription.graceEndsAt });
  }
  if (subscription?.status === "trialing" && subscription.trialEndsAt) {
    boundaries.push({ expiresAt: subscription.trialEndsAt });
  }

  return {
    agencyId,
    accessMode: subscriptionAccessMode(subscription, at),
    subscription: subscription
      ? {
          id: subscription.id,
          status: subscription.status,
          billingInterval: subscription.billingInterval,
          billingProvider: subscription.billingProvider,
          currency: subscription.currency,
          negotiatedAmount: decimalValue(subscription.negotiatedAmount),
          nextBillingAt: subscription.nextBillingAt,
          trialEndsAt: subscription.trialEndsAt,
          graceEndsAt: subscription.graceEndsAt,
          plan: {
            id: subscription.plan.id,
            key: subscription.plan.key,
            name: subscription.plan.name,
            isLegacy: subscription.plan.isLegacy,
            trialDays: subscription.plan.trialDays,
            prices: subscription.plan.prices.map((price) => ({
              currency: price.currency,
              billingInterval: price.billingInterval,
              amount: decimalValue(price.amount),
            })),
          },
        }
      : null,
    features: featureValues,
    limits: limitValues,
    sources,
    catalog: {
      features: features.map((feature) => ({
        key: feature.key,
        name: feature.name,
        description: feature.description,
        module: feature.module,
      })),
      limits: limits.map((limit) => ({
        key: limit.key,
        name: limit.name,
        description: limit.description,
        unit: limit.unit,
        isMetered: limit.isMetered,
        module: limit.module,
      })),
    },
    validUntil: nextBoundary(boundaries, at),
    computedAt: at,
  };
}

export async function refreshWorkspaceEntitlementSnapshot(
  agencyId,
  { db = prisma, at = new Date() } = {},
) {
  const result = await resolveWorkspaceEntitlements(agencyId, { db, at });
  const snapshot = await db.workspaceEntitlementSnapshot.upsert({
    where: { agencyId },
    create: {
      agencyId,
      accessMode: result.accessMode,
      features: result.features,
      limits: result.limits,
      sources: result.sources,
      computedAt: at,
      validUntil: result.validUntil,
    },
    update: {
      revision: { increment: 1 },
      accessMode: result.accessMode,
      features: result.features,
      limits: result.limits,
      sources: result.sources,
      computedAt: at,
      validUntil: result.validUntil,
    },
  });
  return { ...result, revision: snapshot.revision };
}

export async function hasFeature(agencyId, featureKey, options) {
  const entitlements = await resolveWorkspaceEntitlements(agencyId, options);
  return entitlements.accessMode === "full" && entitlements.features[featureKey] === true;
}

export async function getLimit(agencyId, limitKey, options) {
  const entitlements = await resolveWorkspaceEntitlements(agencyId, options);
  return entitlements.limits[limitKey] ?? null;
}

export default {
  getLimit,
  hasFeature,
  refreshWorkspaceEntitlementSnapshot,
  resolveWorkspaceEntitlements,
  subscriptionAccessMode,
};
