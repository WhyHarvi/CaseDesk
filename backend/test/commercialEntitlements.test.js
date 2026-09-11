import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  resolveWorkspaceEntitlements,
  subscriptionAccessMode,
} from "../src/services/entitlementService.js";
import { normalizeCommercialPlanPayload } from "../src/controllers/commercialController.js";
import { serializePublicSubscriptionPlan } from "../src/controllers/publicCommercialController.js";
import { provisionDefaultWorkspaceSubscription, trialWindowForPlan } from "../src/services/commercialSubscriptionService.js";

const moduleRecord = { key: "calling", name: "Calling", sortOrder: 10 };
const feature = {
  id: "feature-calling",
  key: "calling",
  name: "Browser calling",
  description: null,
  isActive: true,
  module: moduleRecord,
};
const limit = {
  id: "limit-team-members",
  key: "team_members",
  name: "Staff seats",
  description: null,
  unit: "users",
  isMetered: false,
  isActive: true,
  module: moduleRecord,
};

function database({ subscription, featureOverrides = [], limitOverrides = [] }) {
  return {
    commercialFeature: { findMany: async () => [feature] },
    commercialLimit: { findMany: async () => [limit] },
    workspaceSubscription: { findUnique: async () => subscription },
    workspaceFeatureOverride: { findMany: async () => featureOverrides },
    workspaceLimitOverride: { findMany: async () => limitOverrides },
  };
}

function activeSubscription() {
  return {
    id: "subscription-1",
    status: "active",
    billingInterval: "monthly",
    billingProvider: "quickbooks",
    currency: "CAD",
    negotiatedAmount: null,
    nextBillingAt: null,
    trialEndsAt: null,
    graceEndsAt: null,
    plan: {
      id: "plan-firm",
      key: "firm",
      name: "Firm",
      isLegacy: false,
      prices: [{ currency: "CAD", billingInterval: "monthly", amount: "299.00" }],
      features: [{ enabled: true, feature }],
      limits: [{ value: "5", isUnlimited: false, limit }],
    },
  };
}

test("workspace entitlements resolve plan features and limits", async () => {
  const result = await resolveWorkspaceEntitlements("agency-1", {
    db: database({ subscription: activeSubscription() }),
    at: new Date("2026-09-11T12:00:00.000Z"),
  });
  assert.equal(result.accessMode, "full");
  assert.equal(result.features.calling, true);
  assert.deepEqual(result.limits.team_members, { unlimited: false, value: 5 });
  assert.equal(result.sources.features.calling, "plan:firm");
  assert.equal(result.subscription.billingProvider, "quickbooks");
});

test("active workspace overrides take precedence and expired overrides do not", async () => {
  const current = await resolveWorkspaceEntitlements("agency-1", {
    db: database({
      subscription: activeSubscription(),
      featureOverrides: [{
        id: "override-current",
        enabled: false,
        startsAt: new Date("2026-09-01T00:00:00.000Z"),
        expiresAt: new Date("2026-10-01T00:00:00.000Z"),
        feature,
      }],
    }),
    at: new Date("2026-09-11T12:00:00.000Z"),
  });
  assert.equal(current.features.calling, false);
  assert.equal(current.sources.features.calling, "override:override-current");
  assert.equal(current.validUntil.toISOString(), "2026-10-01T00:00:00.000Z");

  const expired = await resolveWorkspaceEntitlements("agency-1", {
    db: database({
      subscription: activeSubscription(),
      featureOverrides: [{
        id: "override-expired",
        enabled: false,
        startsAt: null,
        expiresAt: new Date("2026-09-01T00:00:00.000Z"),
        feature,
      }],
    }),
    at: new Date("2026-09-11T12:00:00.000Z"),
  });
  assert.equal(expired.features.calling, true);
  assert.equal(expired.sources.features.calling, "plan:firm");
});

test("subscription state produces a separate commercial access mode", () => {
  assert.equal(subscriptionAccessMode(null), "unconfigured");
  assert.equal(subscriptionAccessMode({ status: "past_due" }), "full");
  assert.equal(subscriptionAccessMode({ status: "trialing", trialEndsAt: new Date("2026-09-12T00:00:00.000Z") }, new Date("2026-09-11T00:00:00.000Z")), "full");
  assert.equal(subscriptionAccessMode({ status: "trialing", trialEndsAt: new Date("2026-09-10T00:00:00.000Z") }, new Date("2026-09-11T00:00:00.000Z")), "read_only");
  assert.equal(subscriptionAccessMode({ status: "trialing", trialEndsAt: null }), "read_only");
  assert.equal(subscriptionAccessMode({ status: "suspended" }), "read_only");
  assert.equal(
    subscriptionAccessMode(
      { status: "grace_period", graceEndsAt: new Date("2026-09-10T00:00:00.000Z") },
      new Date("2026-09-11T00:00:00.000Z"),
    ),
    "read_only",
  );
});

test("workspace demo assignment creates and preserves an exact seven-day trial window", () => {
  const now = new Date("2026-09-11T12:00:00.000Z");
  const plan = { id: "plan-demo", trialDays: 7 };
  const created = trialWindowForPlan({ status: "trialing", plan, currentSubscription: null, now });
  assert.equal(created.trialStartsAt.toISOString(), "2026-09-11T12:00:00.000Z");
  assert.equal(created.trialEndsAt.toISOString(), "2026-09-18T12:00:00.000Z");

  const preserved = trialWindowForPlan({
    status: "trialing",
    plan,
    currentSubscription: { status: "trialing", planId: "plan-demo", ...created },
    now: new Date("2026-09-13T12:00:00.000Z"),
  });
  assert.deepEqual(preserved, created);
  assert.deepEqual(trialWindowForPlan({ status: "active", plan: { id: "plan-solo", trialDays: 0 }, currentSubscription: null, now }), { trialStartsAt: null, trialEndsAt: null });
  assert.throws(
    () => trialWindowForPlan({ status: "trialing", plan: { id: "plan-solo", trialDays: 0 }, currentSubscription: null, now }),
    /does not include a trial period/,
  );
});

test("new agencies atomically receive the developer-selected default plan", async () => {
  const writes = [];
  const db = {
    subscriptionPlan: {
      findFirst: async (query) => {
        assert.deepEqual(query.where, { isDefaultForNewWorkspaces: true, isActive: true });
        return { id: "plan-demo", key: "demo", name: "Demo", trialDays: 7 };
      },
    },
    workspaceSubscription: {
      create: async ({ data }) => {
        writes.push(["subscription", data]);
        return { id: "subscription-new", ...data };
      },
    },
    subscriptionAuditLog: {
      create: async ({ data }) => {
        writes.push(["audit", data]);
        return data;
      },
    },
  };
  const now = new Date("2026-09-11T12:00:00.000Z");
  const result = await provisionDefaultWorkspaceSubscription(db, { agencyId: "agency-new", now });
  assert.equal(result.plan.key, "demo");
  assert.equal(writes[0][1].status, "trialing");
  assert.equal(writes[0][1].billingProvider, "manual");
  assert.equal(writes[0][1].trialEndsAt.toISOString(), "2026-09-18T12:00:00.000Z");
  assert.equal(writes[1][1].action, "subscription.auto_provisioned");
});

test("new agency provisioning fails closed when no active default plan exists", async () => {
  const db = {
    subscriptionPlan: { findFirst: async () => null },
  };
  await assert.rejects(
    provisionDefaultWorkspaceSubscription(db, { agencyId: "agency-new" }),
    (error) => error.statusCode === 503 && error.code === "DEFAULT_SUBSCRIPTION_REQUIRED",
  );
});

test("trial expiry is the entitlement snapshot's next validity boundary", async () => {
  const subscription = activeSubscription();
  subscription.status = "trialing";
  subscription.trialEndsAt = new Date("2026-09-18T12:00:00.000Z");
  const result = await resolveWorkspaceEntitlements("agency-1", {
    db: database({ subscription }),
    at: new Date("2026-09-11T12:00:00.000Z"),
  });
  assert.equal(result.accessMode, "full");
  assert.equal(result.validUntil.toISOString(), "2026-09-18T12:00:00.000Z");
});

test("commercial migration grants every existing customer Legacy Full Access", async () => {
  const migration = await readFile(
    new URL("../prisma/migrations/20260911120000_add_commercial_entitlements/migration.sql", import.meta.url),
    "utf8",
  );
  assert.match(migration, /Legacy Full Access/);
  assert.match(migration, /SELECT 'plan-feature-legacy-' \|\| "key"/);
  assert.match(migration, /FROM "agencies"/);
  assert.match(migration, /casedesk-developer/);
  assert.match(migration, /ON CONFLICT \("agency_id"\) DO NOTHING/);
});

test("commercial catalog seeds a seven-day Demo with the Solo basic bundle", async () => {
  const [migration, defaultMigration] = await Promise.all([
    readFile(new URL("../prisma/migrations/20260911170000_add_demo_trial_plan/migration.sql", import.meta.url), "utf8"),
    readFile(new URL("../prisma/migrations/20260911173000_add_default_workspace_plan/migration.sql", import.meta.url), "utf8"),
  ]);
  assert.match(migration, /'demo',\s*'Demo'/);
  assert.match(migration, /'public',\s*true,\s*false,\s*7/);
  assert.match(migration, /WHERE solo\."plan_id" = 'plan-solo'/);
  assert.match(migration, /'core_crm'/);
  assert.match(migration, /'client_portal'/);
  assert.match(defaultMigration, /WHERE "key" = 'demo'/);
  assert.match(defaultMigration, /CREATE UNIQUE INDEX "subscription_plans_one_workspace_default_key"/);
});

test("Platform Owner commercial controls are developer-only and visible in the dashboard", async () => {
  const [server, routes, controller, dashboard, planManager, catalogAuditMigration] = await Promise.all([
    readFile(new URL("../src/server.js", import.meta.url), "utf8"),
    readFile(new URL("../src/routes/developerRoutes.js", import.meta.url), "utf8"),
    readFile(new URL("../src/controllers/commercialController.js", import.meta.url), "utf8"),
    readFile(new URL("../../frontend/src/pages/DeveloperDashboard.jsx", import.meta.url), "utf8"),
    readFile(new URL("../../frontend/src/components/developer/CommercialPlanManager.jsx", import.meta.url), "utf8"),
    readFile(new URL("../prisma/migrations/20260911143000_allow_platform_commercial_audit/migration.sql", import.meta.url), "utf8"),
  ]);
  assert.match(server, /"\/api\/developer", requireAuth, requireRole\("developer"\)/);
  assert.match(routes, /commercial\/workspaces/);
  assert.match(routes, /commercial\/plans/);
  assert.match(controller, /pg_advisory_xact_lock/);
  assert.match(controller, /subscriptionAuditLog\.create/);
  assert.match(controller, /agencyId: null/);
  assert.match(controller, /before\.isLegacy/);
  assert.match(controller, /workspaceEntitlementSnapshot\.deleteMany/);
  assert.match(catalogAuditMigration, /ALTER COLUMN "agency_id" DROP NOT NULL/);
  assert.match(dashboard, /CaseDesk Platform Admin/);
  assert.match(dashboard, /key: "subscriptions", label: "Subscriptions"/);
  assert.match(dashboard, /key: "workspaces", label: "Customer workspaces"/);
  assert.doesNotMatch(dashboard, /key: "commercial"/);
  assert.match(dashboard, /key === "subscriptions"/);
  assert.match(dashboard, /key === "workspaces"/);
  assert.match(dashboard, /function SubscriptionsSection/);
  assert.match(dashboard, /function CustomerWorkspacesSection/);
  assert.match(dashboard, /Change reason/);
  assert.match(planManager, /Pricing and access/);
  assert.match(planManager, /Default for new workspaces/);
  assert.doesNotMatch(planManager, /rounded-(2xl|3xl)/);
  assert.doesNotMatch(planManager, /shadow-\[/);
});

test("public commercial catalog is rate-limited and excludes non-showcase data", async () => {
  const [server, routes, controller] = await Promise.all([
    readFile(new URL("../src/server.js", import.meta.url), "utf8"),
    readFile(new URL("../src/routes/publicCommercialRoutes.js", import.meta.url), "utf8"),
    readFile(new URL("../src/controllers/publicCommercialController.js", import.meta.url), "utf8"),
  ]);

  assert.match(server, /"\/api\/public\/commercial", publicCommercialRoutes/);
  assert.match(routes, /router\.get\("\/plans", publicCatalogLimit/);
  assert.match(routes, /cors\(\{ origin: "\*", methods: \["GET"\]/);
  assert.match(controller, /visibility: "public"/);
  assert.match(controller, /isActive: true/);
  assert.match(controller, /isLegacy: false/);
  assert.doesNotMatch(controller, /workspaceSubscription\.findMany/);

  const serialized = serializePublicSubscriptionPlan({
    id: "internal-plan-id",
    key: "growth",
    name: "Growth",
    description: "For growing practices.",
    trialDays: 14,
    isDefaultForNewWorkspaces: true,
    visibility: "public",
    isActive: true,
    _count: { subscriptions: 12 },
    prices: [{ id: "price-id", currency: "CAD", billingInterval: "monthly", amount: "249.00" }],
    features: [{
      feature: {
        id: "feature-id",
        key: "calling",
        name: "Browser calling",
        description: "Call from CaseDesk.",
        sortOrder: 20,
        module: { id: "module-id", key: "communications", name: "Communications", description: null, sortOrder: 10 },
      },
    }],
    limits: [{
      value: "8",
      isUnlimited: false,
      limit: {
        id: "limit-id",
        key: "team_members",
        name: "Staff seats",
        description: null,
        unit: "users",
        valueType: "integer",
        sortOrder: 10,
        module: { id: "module-id", key: "communications", name: "Communications", description: null, sortOrder: 10 },
      },
    }],
  });

  assert.deepEqual(serialized, {
    key: "growth",
    name: "Growth",
    description: "For growing practices.",
    trialDays: 14,
    isDefaultForNewWorkspaces: true,
    prices: [{ currency: "CAD", billingInterval: "monthly", amount: 249 }],
    modules: [{
      key: "communications",
      name: "Communications",
      description: null,
      features: [{ key: "calling", name: "Browser calling", description: "Call from CaseDesk." }],
      limits: [{
        key: "team_members",
        name: "Staff seats",
        description: null,
        unit: "users",
        valueType: "integer",
        value: 8,
        isUnlimited: false,
      }],
    }],
  });
  assert.doesNotMatch(JSON.stringify(serialized), /internal-plan-id|price-id|feature-id|module-id|limit-id|subscriptions/);
});

test("commercial plan input normalizes prices, features, and finite limits", () => {
  const result = normalizeCommercialPlanPayload({
    key: "growth_plus",
    name: "Growth Plus",
    description: "Expanded automation and communications.",
    visibility: "public",
    isActive: true,
    trialDays: 7,
    isDefaultForNewWorkspaces: true,
    reason: "Initial catalog configuration",
    prices: [{ currency: "cad", billingInterval: "monthly", amount: "349" }],
    featureKeys: ["calling", "calling", "sms"],
    limits: [{ key: "team_members", value: "8", isUnlimited: false }],
  }, { creating: true });

  assert.equal(result.key, "growth_plus");
  assert.equal(result.trialDays, 7);
  assert.equal(result.isDefaultForNewWorkspaces, true);
  assert.deepEqual(result.featureKeys, ["calling", "sms"]);
  assert.deepEqual(result.prices[0], {
    currency: "CAD",
    billingInterval: "monthly",
    amount: "349.00",
    isActive: true,
  });
  assert.deepEqual(result.limits[0], { key: "team_members", value: 8, isUnlimited: false });
});

test("commercial plan input rejects duplicate price identities and invalid limits", () => {
  assert.throws(
    () => normalizeCommercialPlanPayload({ name: "Demo", reason: "Invalid default", isActive: false, isDefaultForNewWorkspaces: true }),
    /default plan.*must remain active/i,
  );
  assert.throws(
    () => normalizeCommercialPlanPayload({ name: "Demo", reason: "Invalid trial", trialDays: 366 }),
    /Trial duration/,
  );
  assert.throws(
    () => normalizeCommercialPlanPayload({
      name: "Firm",
      reason: "Price correction",
      prices: [
        { currency: "CAD", billingInterval: "monthly", amount: 299 },
        { currency: "cad", billingInterval: "monthly", amount: 300 },
      ],
    }),
    /Duplicate price/,
  );
  assert.throws(
    () => normalizeCommercialPlanPayload({
      name: "Firm",
      reason: "Limit correction",
      limits: [{ key: "team_members", value: -1 }],
    }),
    /zero or greater/,
  );
  assert.throws(
    () => normalizeCommercialPlanPayload({
      name: "Firm",
      reason: "Missing amount check",
      prices: [{ currency: "CAD", billingInterval: "monthly", amount: null }],
    }),
    /needs an amount/,
  );
});
