import { resolveWorkspaceEntitlements } from "../services/entitlementService.js";

function deny(res, status, code, message, details = {}) {
  return res.status(status).json({ success: false, code, message, ...details });
}

async function entitlementsForRequest(req) {
  if (!req.entitlements) {
    req.entitlements = await resolveWorkspaceEntitlements(req.auth.agencyId);
  }
  return req.entitlements;
}

export function requireSubscriptionWriteAccess(req, res, next) {
  entitlementsForRequest(req)
    .then((entitlements) => {
      if (entitlements.accessMode === "full") return next();
      return deny(
        res,
        423,
        "SUBSCRIPTION_READ_ONLY",
        "This workspace subscription currently allows read-only access.",
        { subscriptionStatus: entitlements.subscription?.status || "unconfigured" },
      );
    })
    .catch(next);
}

export function requireFeature(featureKey) {
  return (req, res, next) => {
    entitlementsForRequest(req)
      .then((entitlements) => {
        if (entitlements.accessMode !== "full") {
          return deny(
            res,
            423,
            "SUBSCRIPTION_READ_ONLY",
            "This workspace subscription currently allows read-only access.",
            {
              feature: featureKey,
              subscriptionStatus: entitlements.subscription?.status || "unconfigured",
            },
          );
        }
        if (entitlements.features[featureKey] === true) return next();
        return deny(
          res,
          402,
          "FEATURE_NOT_INCLUDED",
          "This feature is not included in the workspace subscription.",
          { feature: featureKey },
        );
      })
      .catch(next);
  };
}

export default { requireFeature, requireSubscriptionWriteAccess };
