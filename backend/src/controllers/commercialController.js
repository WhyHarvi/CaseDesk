import prisma from "../services/prisma/client.js";
import { refreshWorkspaceEntitlementSnapshot, resolveWorkspaceEntitlements } from "../services/entitlementService.js";
import { trialWindowForPlan } from "../services/commercialSubscriptionService.js";
import { createHttpError } from "../utils/http.js";

const SUBSCRIPTION_STATUSES = new Set([
  "trialing",
  "active",
  "past_due",
  "grace_period",
  "suspended",
  "cancelled",
  "read_only",
]);
const BILLING_INTERVALS = new Set(["monthly", "annual", "custom"]);
const BILLING_PROVIDERS = new Set(["quickbooks", "manual", "stripe", "paddle", "other"]);
const PLAN_VISIBILITIES = new Set(["public", "private", "internal"]);
const STAFF_ROLES = ["admin", "consultant", "frontdesk", "manager", "accountant"];
const CUSTOMER_AGENCY = {
  OR: [{ slug: null }, { slug: { not: "casedesk-developer" } }],
};

function requiredReason(value) {
  const reason = String(value || "").trim();
  if (reason.length < 3 || reason.length > 500) {
    throw createHttpError(400, "Provide a change reason between 3 and 500 characters.", "VALIDATION_ERROR");
  }
  return reason;
}

function optionalDate(value, field) {
  if (value === undefined || value === null || value === "") return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw createHttpError(400, `${field} must be a valid date.`, "VALIDATION_ERROR");
  }
  return parsed;
}

function optionalMoney(value) {
  if (value === undefined || value === null || value === "") return null;
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 0) {
    throw createHttpError(400, "Negotiated amount must be zero or greater.", "VALIDATION_ERROR");
  }
  return amount.toFixed(2);
}

function normalizedTrialDays(value) {
  if (value === undefined || value === null || value === "") return 0;
  const days = Number(value);
  if (!Number.isInteger(days) || days < 0 || days > 365) {
    throw createHttpError(400, "Trial duration must be a whole number from 0 to 365 days.", "VALIDATION_ERROR");
  }
  return days;
}

function jsonValue(value) {
  return value === undefined ? null : JSON.parse(JSON.stringify(value));
}

function requiredText(value, field, maxLength) {
  const result = String(value || "").trim();
  if (!result || result.length > maxLength) {
    throw createHttpError(400, `${field} is required and must be ${maxLength} characters or fewer.`, "VALIDATION_ERROR");
  }
  return result;
}

function optionalText(value, maxLength) {
  const result = String(value || "").trim();
  if (result.length > maxLength) {
    throw createHttpError(400, `Description must be ${maxLength} characters or fewer.`, "VALIDATION_ERROR");
  }
  return result || null;
}

export function normalizeCommercialPlanPayload(body, { creating = false } = {}) {
  const key = creating ? requiredText(body?.key, "Plan key", 80) : undefined;
  if (creating && !/^[a-z][a-z0-9_]*$/.test(key)) {
    throw createHttpError(400, "Plan key must start with a letter and contain only lowercase letters, numbers, and underscores.", "VALIDATION_ERROR");
  }
  const visibility = String(body?.visibility || "public").trim();
  if (!PLAN_VISIBILITIES.has(visibility)) {
    throw createHttpError(400, "Select a valid plan visibility.", "VALIDATION_ERROR");
  }
  const isActive = body?.isActive !== false;
  const isDefaultForNewWorkspaces = body?.isDefaultForNewWorkspaces === true;
  if (isDefaultForNewWorkspaces && !isActive) {
    throw createHttpError(400, "The default plan for new workspaces must remain active.", "VALIDATION_ERROR");
  }

  const prices = Array.isArray(body?.prices) ? body.prices : [];
  const seenPrices = new Set();
  const normalizedPrices = prices.map((item) => {
    const currency = String(item?.currency || "").trim().toUpperCase();
    const billingInterval = String(item?.billingInterval || "").trim();
    if (item?.amount === "" || item?.amount === null || item?.amount === undefined) {
      throw createHttpError(400, "Every plan price needs an amount.", "VALIDATION_ERROR");
    }
    const amount = Number(item.amount);
    if (!/^[A-Z]{3}$/.test(currency) || !BILLING_INTERVALS.has(billingInterval)) {
      throw createHttpError(400, "Every price needs a three-letter currency and valid billing interval.", "VALIDATION_ERROR");
    }
    if (!Number.isFinite(amount) || amount < 0) {
      throw createHttpError(400, "Plan prices must be zero or greater.", "VALIDATION_ERROR");
    }
    const identity = `${currency}:${billingInterval}`;
    if (seenPrices.has(identity)) {
      throw createHttpError(400, `Duplicate price for ${currency} ${billingInterval}.`, "VALIDATION_ERROR");
    }
    seenPrices.add(identity);
    return { currency, billingInterval, amount: amount.toFixed(2), isActive: item?.isActive !== false };
  });

  const featureKeys = [...new Set((Array.isArray(body?.featureKeys) ? body.featureKeys : []).map((value) => String(value).trim()).filter(Boolean))];
  const seenLimits = new Set();
  const limits = (Array.isArray(body?.limits) ? body.limits : []).map((item) => {
    const limitKey = String(item?.key || "").trim();
    if (!limitKey || seenLimits.has(limitKey)) {
      throw createHttpError(400, limitKey ? `Duplicate limit ${limitKey}.` : "Every plan limit needs a key.", "VALIDATION_ERROR");
    }
    seenLimits.add(limitKey);
    const isUnlimited = item?.isUnlimited === true;
    if (!isUnlimited && (item?.value === "" || item?.value === null || item?.value === undefined)) {
      throw createHttpError(400, `Limit ${limitKey} needs a value, or must be unlimited.`, "VALIDATION_ERROR");
    }
    const value = isUnlimited ? null : Number(item.value);
    if (!isUnlimited && (!Number.isFinite(value) || value < 0)) {
      throw createHttpError(400, `Limit ${limitKey} must be zero or greater, or unlimited.`, "VALIDATION_ERROR");
    }
    return { key: limitKey, value: isUnlimited ? null : value, isUnlimited };
  });

  return {
    ...(creating ? { key } : {}),
    name: requiredText(body?.name, "Plan name", 120),
    description: optionalText(body?.description, 500),
    visibility,
    isActive,
    trialDays: normalizedTrialDays(body?.trialDays),
    isDefaultForNewWorkspaces,
    prices: normalizedPrices,
    featureKeys,
    limits,
    reason: requiredReason(body?.reason),
  };
}

function catalogPlanInclude() {
  return {
    prices: { where: { isActive: true }, orderBy: [{ currency: "asc" }, { billingInterval: "asc" }] },
    features: { include: { feature: { select: { key: true } } } },
    limits: { include: { limit: { select: { key: true } } } },
    _count: { select: { subscriptions: true } },
  };
}

function serializeCatalogPlan(plan) {
  return {
    ...plan,
    prices: plan.prices.map((price) => ({ ...price, amount: Number(price.amount) })),
    featureKeys: plan.features.filter((item) => item.enabled).map((item) => item.feature.key),
    limits: plan.limits.map((item) => ({
      key: item.limit.key,
      value: item.value === null ? null : Number(item.value),
      isUnlimited: item.isUnlimited,
    })),
    features: undefined,
  };
}

async function validateCatalogReferences(tx, input) {
  const [features, limits] = await Promise.all([
    tx.commercialFeature.findMany({ where: { key: { in: input.featureKeys }, isActive: true }, select: { id: true, key: true } }),
    tx.commercialLimit.findMany({ where: { key: { in: input.limits.map((item) => item.key) }, isActive: true }, select: { id: true, key: true, valueType: true } }),
  ]);
  if (features.length !== input.featureKeys.length) {
    throw createHttpError(400, "One or more selected commercial features are unavailable.", "VALIDATION_ERROR");
  }
  if (limits.length !== input.limits.length) {
    throw createHttpError(400, "One or more selected commercial limits are unavailable.", "VALIDATION_ERROR");
  }
  for (const configured of input.limits) {
    const definition = limits.find((item) => item.key === configured.key);
    if (definition?.valueType === "integer" && !configured.isUnlimited && !Number.isInteger(configured.value)) {
      throw createHttpError(400, `Limit ${configured.key} must be a whole number.`, "VALIDATION_ERROR");
    }
  }
  return { features, limits };
}

async function replacePlanConfiguration(tx, planId, input, references) {
  await tx.subscriptionPlanPrice.deleteMany({ where: { planId } });
  await tx.planFeature.deleteMany({ where: { planId } });
  await tx.planLimit.deleteMany({ where: { planId } });
  if (input.prices.length) {
    await tx.subscriptionPlanPrice.createMany({ data: input.prices.map((price) => ({ planId, ...price })) });
  }
  if (references.features.length) {
    await tx.planFeature.createMany({ data: references.features.map((feature) => ({ planId, featureId: feature.id, enabled: true })) });
  }
  if (references.limits.length) {
    const configuredByKey = new Map(input.limits.map((item) => [item.key, item]));
    await tx.planLimit.createMany({
      data: references.limits.map((limit) => {
        const configured = configuredByKey.get(limit.key);
        return {
          planId,
          limitId: limit.id,
          value: configured.value,
          isUnlimited: configured.isUnlimited,
        };
      }),
    });
  }
}

async function auditCatalogChange(tx, { actorUserId, action, planId, before, after, reason }) {
  await tx.subscriptionAuditLog.create({
    data: {
      agencyId: null,
      actorUserId,
      action,
      entityType: "SubscriptionPlan",
      entityId: planId,
      before: jsonValue(before),
      after: jsonValue(after),
      reason,
    },
  });
}

async function assertCustomerAgency(db, agencyId) {
  const agency = await db.agency.findFirst({
    where: { id: agencyId, ...CUSTOMER_AGENCY },
    select: { id: true, name: true },
  });
  if (!agency) throw createHttpError(404, "Workspace not found.", "NOT_FOUND");
  return agency;
}

async function auditChange(db, { agencyId, actorUserId, action, entityType, entityId, before, after, reason }) {
  return db.subscriptionAuditLog.create({
    data: {
      agencyId,
      actorUserId,
      action,
      entityType,
      entityId,
      before: jsonValue(before),
      after: jsonValue(after),
      reason,
    },
  });
}

export async function listCommercialCatalog(req, res) {
  const [modules, plans] = await Promise.all([
    prisma.commercialModule.findMany({
      where: { isActive: true },
      orderBy: { sortOrder: "asc" },
      include: {
        features: { where: { isActive: true }, orderBy: { sortOrder: "asc" } },
        limits: { where: { isActive: true }, orderBy: { sortOrder: "asc" } },
      },
    }),
    prisma.subscriptionPlan.findMany({
      orderBy: { sortOrder: "asc" },
      include: catalogPlanInclude(),
    }),
  ]);

  res.json({
    data: {
      modules,
      plans: plans.map(serializeCatalogPlan),
    },
  });
}

export async function createSubscriptionPlan(req, res) {
  const input = normalizeCommercialPlanPayload(req.body, { creating: true });
  const plan = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtext('commercial:catalog'))`;
    const duplicate = await tx.subscriptionPlan.findUnique({ where: { key: input.key }, select: { id: true } });
    if (duplicate) throw createHttpError(409, "A subscription plan already uses that key.", "CONFLICT");
    const references = await validateCatalogReferences(tx, input);
    if (input.isDefaultForNewWorkspaces) {
      await tx.subscriptionPlan.updateMany({
        where: { isDefaultForNewWorkspaces: true },
        data: { isDefaultForNewWorkspaces: false },
      });
    }
    const highest = await tx.subscriptionPlan.aggregate({ _max: { sortOrder: true } });
    const created = await tx.subscriptionPlan.create({
      data: {
        key: input.key,
        name: input.name,
        description: input.description,
        visibility: input.visibility,
        isActive: input.isActive,
        trialDays: input.trialDays,
        isDefaultForNewWorkspaces: input.isDefaultForNewWorkspaces,
        sortOrder: (highest._max.sortOrder || 0) + 10,
      },
    });
    await replacePlanConfiguration(tx, created.id, input, references);
    const after = await tx.subscriptionPlan.findUnique({ where: { id: created.id }, include: catalogPlanInclude() });
    await auditCatalogChange(tx, {
      actorUserId: req.auth.userId,
      action: "plan.created",
      planId: created.id,
      before: null,
      after: serializeCatalogPlan(after),
      reason: input.reason,
    });
    return after;
  });
  res.status(201).json({ data: serializeCatalogPlan(plan) });
}

export async function updateSubscriptionPlan(req, res) {
  const input = normalizeCommercialPlanPayload(req.body);
  const planId = req.params.planId;
  const plan = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtext('commercial:catalog'))`;
    const before = await tx.subscriptionPlan.findUnique({ where: { id: planId }, include: catalogPlanInclude() });
    if (!before) throw createHttpError(404, "Subscription plan not found.", "NOT_FOUND");
    if (before.isLegacy) throw createHttpError(409, "The Legacy Full Access plan is protected and cannot be edited.", "CONFLICT");
    if (before.isDefaultForNewWorkspaces && !input.isDefaultForNewWorkspaces) {
      throw createHttpError(409, "Set another active plan as the new-workspace default before removing this default.", "CONFLICT");
    }
    const references = await validateCatalogReferences(tx, input);
    if (input.isDefaultForNewWorkspaces) {
      await tx.subscriptionPlan.updateMany({
        where: { id: { not: planId }, isDefaultForNewWorkspaces: true },
        data: { isDefaultForNewWorkspaces: false },
      });
    }
    await tx.subscriptionPlan.update({
      where: { id: planId },
      data: {
        name: input.name,
        description: input.description,
        visibility: input.visibility,
        isActive: input.isActive,
        trialDays: input.trialDays,
        isDefaultForNewWorkspaces: input.isDefaultForNewWorkspaces,
      },
    });
    await replacePlanConfiguration(tx, planId, input, references);
    const subscribers = await tx.workspaceSubscription.findMany({ where: { planId }, select: { agencyId: true } });
    await tx.workspaceEntitlementSnapshot.deleteMany({
      where: { agencyId: { in: subscribers.map((subscription) => subscription.agencyId) } },
    });
    const after = await tx.subscriptionPlan.findUnique({ where: { id: planId }, include: catalogPlanInclude() });
    await auditCatalogChange(tx, {
      actorUserId: req.auth.userId,
      action: "plan.updated",
      planId,
      before: serializeCatalogPlan(before),
      after: serializeCatalogPlan(after),
      reason: input.reason,
    });
    return after;
  });
  res.json({ data: serializeCatalogPlan(plan) });
}

export async function listCommercialWorkspaces(req, res) {
  const agencies = await prisma.agency.findMany({
    where: CUSTOMER_AGENCY,
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      slug: true,
      status: true,
      accessStatus: true,
      defaultCurrency: true,
      commercialSubscription: {
        include: { plan: { select: { id: true, key: true, name: true, isLegacy: true } } },
      },
      _count: {
        select: {
          memberships: { where: { isActive: true, role: { in: STAFF_ROLES } } },
          commercialFeatureOverrides: true,
        },
      },
    },
  });

  res.json({
    data: agencies.map((agency) => ({
      ...agency,
      staffSeats: agency._count.memberships,
      featureOverrides: agency._count.commercialFeatureOverrides,
      _count: undefined,
    })),
  });
}

export async function getCommercialWorkspace(req, res) {
  const agency = await assertCustomerAgency(prisma, req.params.agencyId);
  const [entitlements, overrides, limitOverrides, audit] = await Promise.all([
    resolveWorkspaceEntitlements(agency.id),
    prisma.workspaceFeatureOverride.findMany({
      where: { agencyId: agency.id },
      orderBy: { updatedAt: "desc" },
      include: { feature: { select: { key: true, name: true } }, createdBy: { select: { fullName: true } } },
    }),
    prisma.workspaceLimitOverride.findMany({
      where: { agencyId: agency.id },
      orderBy: { updatedAt: "desc" },
      include: { limit: { select: { key: true, name: true, unit: true } }, createdBy: { select: { fullName: true } } },
    }),
    prisma.subscriptionAuditLog.findMany({
      where: { agencyId: agency.id },
      orderBy: { createdAt: "desc" },
      take: 25,
      include: { actorUser: { select: { fullName: true } } },
    }),
  ]);
  const staffSeats = await prisma.agencyMember.count({
    where: { agencyId: agency.id, isActive: true, role: { in: STAFF_ROLES } },
  });

  res.json({ data: { agency, staffSeats, entitlements, overrides, limitOverrides, audit } });
}

export async function updateWorkspaceSubscription(req, res) {
  const reason = requiredReason(req.body?.reason);
  const planId = String(req.body?.planId || "").trim();
  const status = String(req.body?.status || "").trim();
  const billingInterval = String(req.body?.billingInterval || "").trim();
  const billingProvider = String(req.body?.billingProvider || "quickbooks").trim();
  const currency = String(req.body?.currency || "CAD").trim().toUpperCase();
  const negotiatedAmount = optionalMoney(req.body?.negotiatedAmount);

  if (!planId) throw createHttpError(400, "Select a subscription plan.", "VALIDATION_ERROR");
  if (!SUBSCRIPTION_STATUSES.has(status)) throw createHttpError(400, "Select a valid subscription status.", "VALIDATION_ERROR");
  if (!BILLING_INTERVALS.has(billingInterval)) throw createHttpError(400, "Select a valid billing interval.", "VALIDATION_ERROR");
  if (!BILLING_PROVIDERS.has(billingProvider)) throw createHttpError(400, "Select a valid billing provider.", "VALIDATION_ERROR");
  if (!/^[A-Z]{3}$/.test(currency)) throw createHttpError(400, "Currency must use a three-letter code.", "VALIDATION_ERROR");

  const agencyId = req.params.agencyId;
  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtext(${`commercial:${agencyId}`}))`;
    await assertCustomerAgency(tx, agencyId);
    const plan = await tx.subscriptionPlan.findFirst({ where: { id: planId, isActive: true } });
    if (!plan) throw createHttpError(404, "Subscription plan not found.", "NOT_FOUND");
    const before = await tx.workspaceSubscription.findUnique({ where: { agencyId } });
    const trialWindow = trialWindowForPlan({
      status,
      plan,
      currentSubscription: before,
    });
    const after = await tx.workspaceSubscription.upsert({
      where: { agencyId },
      create: { agencyId, planId, status, billingInterval, billingProvider, currency, negotiatedAmount, ...trialWindow },
      update: { planId, status, billingInterval, billingProvider, currency, negotiatedAmount, ...trialWindow },
    });
    await auditChange(tx, {
      agencyId,
      actorUserId: req.auth.userId,
      action: before ? "subscription.updated" : "subscription.created",
      entityType: "WorkspaceSubscription",
      entityId: after.id,
      before,
      after,
      reason,
    });
  });

  res.json({ data: await refreshWorkspaceEntitlementSnapshot(agencyId) });
}

export async function upsertWorkspaceFeatureOverride(req, res) {
  const agencyId = req.params.agencyId;
  const featureKey = String(req.params.featureKey || "").trim();
  const enabled = req.body?.enabled;
  const reason = requiredReason(req.body?.reason);
  const startsAt = optionalDate(req.body?.startsAt, "startsAt");
  const expiresAt = optionalDate(req.body?.expiresAt, "expiresAt");
  if (typeof enabled !== "boolean") throw createHttpError(400, "enabled must be true or false.", "VALIDATION_ERROR");
  if (startsAt && expiresAt && expiresAt <= startsAt) {
    throw createHttpError(400, "Override expiry must be after its start.", "VALIDATION_ERROR");
  }

  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtext(${`commercial:${agencyId}`}))`;
    await assertCustomerAgency(tx, agencyId);
    const feature = await tx.commercialFeature.findUnique({ where: { key: featureKey } });
    if (!feature || !feature.isActive) throw createHttpError(404, "Commercial feature not found.", "NOT_FOUND");
    const unique = { agencyId_featureId: { agencyId, featureId: feature.id } };
    const before = await tx.workspaceFeatureOverride.findUnique({ where: unique });
    const after = await tx.workspaceFeatureOverride.upsert({
      where: unique,
      create: { agencyId, featureId: feature.id, enabled, reason, startsAt, expiresAt, createdById: req.auth.userId },
      update: { enabled, reason, startsAt, expiresAt, createdById: req.auth.userId },
    });
    await auditChange(tx, {
      agencyId,
      actorUserId: req.auth.userId,
      action: before ? "feature_override.updated" : "feature_override.created",
      entityType: "WorkspaceFeatureOverride",
      entityId: after.id,
      before,
      after,
      reason,
    });
  });

  res.json({ data: await refreshWorkspaceEntitlementSnapshot(agencyId) });
}

export async function deleteWorkspaceFeatureOverride(req, res) {
  const agencyId = req.params.agencyId;
  const featureKey = String(req.params.featureKey || "").trim();
  const reason = requiredReason(req.body?.reason);

  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtext(${`commercial:${agencyId}`}))`;
    await assertCustomerAgency(tx, agencyId);
    const feature = await tx.commercialFeature.findUnique({ where: { key: featureKey } });
    if (!feature) throw createHttpError(404, "Commercial feature not found.", "NOT_FOUND");
    const before = await tx.workspaceFeatureOverride.findUnique({
      where: { agencyId_featureId: { agencyId, featureId: feature.id } },
    });
    if (!before) throw createHttpError(404, "Feature override not found.", "NOT_FOUND");
    await tx.workspaceFeatureOverride.delete({ where: { id: before.id } });
    await auditChange(tx, {
      agencyId,
      actorUserId: req.auth.userId,
      action: "feature_override.removed",
      entityType: "WorkspaceFeatureOverride",
      entityId: before.id,
      before,
      after: null,
      reason,
    });
  });

  res.json({ data: await refreshWorkspaceEntitlementSnapshot(agencyId) });
}

export default {
  createSubscriptionPlan,
  deleteWorkspaceFeatureOverride,
  getCommercialWorkspace,
  listCommercialCatalog,
  listCommercialWorkspaces,
  updateSubscriptionPlan,
  updateWorkspaceSubscription,
  upsertWorkspaceFeatureOverride,
};
