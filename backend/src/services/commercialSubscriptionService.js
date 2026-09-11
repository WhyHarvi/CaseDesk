import { createHttpError } from "../utils/http.js";

const dayMs = 24 * 60 * 60 * 1_000;

export function trialWindowForPlan({ status, plan, currentSubscription, now = new Date() }) {
  if (status !== "trialing") return { trialStartsAt: null, trialEndsAt: null };
  if (!Number.isInteger(plan?.trialDays) || plan.trialDays < 1) {
    throw createHttpError(400, "The selected plan does not include a trial period.", "VALIDATION_ERROR");
  }

  const continuingSameTrial = currentSubscription?.status === "trialing"
    && currentSubscription?.planId === plan.id;
  if (continuingSameTrial && currentSubscription.trialStartsAt && currentSubscription.trialEndsAt) {
    return {
      trialStartsAt: currentSubscription.trialStartsAt,
      trialEndsAt: currentSubscription.trialEndsAt,
    };
  }

  return {
    trialStartsAt: now,
    trialEndsAt: new Date(now.getTime() + plan.trialDays * dayMs),
  };
}

export async function provisionDefaultWorkspaceSubscription(db, { agencyId, now = new Date() }) {
  const plan = await db.subscriptionPlan.findFirst({
    where: { isDefaultForNewWorkspaces: true, isActive: true },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    select: { id: true, key: true, name: true, trialDays: true },
  });
  if (!plan) {
    throw createHttpError(
      503,
      "New workspace registration is temporarily unavailable because no default subscription plan is configured.",
      "DEFAULT_SUBSCRIPTION_REQUIRED",
    );
  }

  const status = plan.trialDays > 0 ? "trialing" : "active";
  const trialWindow = trialWindowForPlan({ status, plan, currentSubscription: null, now });
  const subscription = await db.workspaceSubscription.create({
    data: {
      agencyId,
      planId: plan.id,
      status,
      billingProvider: "manual",
      ...trialWindow,
    },
  });
  await db.subscriptionAuditLog.create({
    data: {
      agencyId,
      actorUserId: null,
      action: "subscription.auto_provisioned",
      entityType: "WorkspaceSubscription",
      entityId: subscription.id,
      before: null,
      after: JSON.parse(JSON.stringify(subscription)),
      reason: `Default plan ${plan.name} assigned during agency registration`,
    },
  });
  return { plan, subscription };
}

export default { provisionDefaultWorkspaceSubscription, trialWindowForPlan };
