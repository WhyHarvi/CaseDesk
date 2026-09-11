import prisma from "../services/prisma/client.js";

function compareCatalogItems(left, right) {
  return (left.sortOrder || 0) - (right.sortOrder || 0) || left.name.localeCompare(right.name);
}

export function serializePublicSubscriptionPlan(plan) {
  const modulesByKey = new Map();
  const moduleFor = (definition) => {
    const module = definition.module;
    if (!modulesByKey.has(module.key)) {
      modulesByKey.set(module.key, {
        key: module.key,
        name: module.name,
        description: module.description || null,
        sortOrder: module.sortOrder,
        features: [],
        limits: [],
      });
    }
    return modulesByKey.get(module.key);
  };

  for (const grant of plan.features || []) {
    const feature = grant.feature;
    moduleFor(feature).features.push({
      key: feature.key,
      name: feature.name,
      description: feature.description || null,
      sortOrder: feature.sortOrder,
    });
  }
  for (const grant of plan.limits || []) {
    const limit = grant.limit;
    moduleFor(limit).limits.push({
      key: limit.key,
      name: limit.name,
      description: limit.description || null,
      unit: limit.unit || null,
      valueType: limit.valueType,
      value: grant.value === null ? null : Number(grant.value),
      isUnlimited: grant.isUnlimited,
      sortOrder: limit.sortOrder,
    });
  }

  const modules = [...modulesByKey.values()]
    .sort(compareCatalogItems)
    .map((module) => ({
      key: module.key,
      name: module.name,
      description: module.description,
      features: module.features.sort(compareCatalogItems).map(({ sortOrder: _sortOrder, ...feature }) => feature),
      limits: module.limits.sort(compareCatalogItems).map(({ sortOrder: _sortOrder, ...limit }) => limit),
    }));

  return {
    key: plan.key,
    name: plan.name,
    description: plan.description || null,
    trialDays: plan.trialDays,
    isDefaultForNewWorkspaces: plan.isDefaultForNewWorkspaces,
    prices: (plan.prices || []).map((price) => ({
      currency: price.currency,
      billingInterval: price.billingInterval,
      amount: Number(price.amount),
    })),
    modules,
  };
}

export async function listPublicSubscriptionPlans(_req, res) {
  const plans = await prisma.subscriptionPlan.findMany({
    where: {
      visibility: "public",
      isActive: true,
      isLegacy: false,
    },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    select: {
      key: true,
      name: true,
      description: true,
      trialDays: true,
      isDefaultForNewWorkspaces: true,
      prices: {
        where: { isActive: true },
        orderBy: [{ currency: "asc" }, { billingInterval: "asc" }],
        select: { currency: true, billingInterval: true, amount: true },
      },
      features: {
        where: {
          enabled: true,
          feature: { isActive: true, module: { isActive: true } },
        },
        select: {
          feature: {
            select: {
              key: true,
              name: true,
              description: true,
              sortOrder: true,
              module: {
                select: { key: true, name: true, description: true, sortOrder: true },
              },
            },
          },
        },
      },
      limits: {
        where: {
          limit: { isActive: true, module: { isActive: true } },
        },
        select: {
          value: true,
          isUnlimited: true,
          limit: {
            select: {
              key: true,
              name: true,
              description: true,
              unit: true,
              valueType: true,
              sortOrder: true,
              module: {
                select: { key: true, name: true, description: true, sortOrder: true },
              },
            },
          },
        },
      },
    },
  });

  res.set({
    "Cache-Control": "public, max-age=60, s-maxage=300, stale-while-revalidate=3600",
    "Cross-Origin-Resource-Policy": "cross-origin",
  });
  res.json({ data: { plans: plans.map(serializePublicSubscriptionPlan) } });
}
