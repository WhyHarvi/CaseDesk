import { Router } from "express";
import {
  getDeveloperOverview,
  listDeveloperAgencies,
  getDeveloperAgency,
  listDeveloperSupportTickets,
  updateDeveloperSupportTicketStatus,
  listDeveloperActivity,
  getDeveloperFeatureFlags,
  updateDeveloperFeatureFlag,
} from "../controllers/developerController.js";
import { asyncHandler } from "../utils/http.js";
import {
  createSubscriptionPlan,
  deleteWorkspaceFeatureOverride,
  getCommercialWorkspace,
  listCommercialCatalog,
  listCommercialWorkspaces,
  updateSubscriptionPlan,
  updateWorkspaceSubscription,
  upsertWorkspaceFeatureOverride,
} from "../controllers/commercialController.js";

const router = Router();
router.get("/overview", asyncHandler(getDeveloperOverview));
router.get("/agencies", asyncHandler(listDeveloperAgencies));
router.get("/agencies/:id", asyncHandler(getDeveloperAgency));
router.get("/support-tickets", asyncHandler(listDeveloperSupportTickets));
router.patch("/support-tickets/:id/status", asyncHandler(updateDeveloperSupportTicketStatus));
router.get("/activity", asyncHandler(listDeveloperActivity));
router.get("/feature-flags", asyncHandler(getDeveloperFeatureFlags));
router.patch("/feature-flags/:key", asyncHandler(updateDeveloperFeatureFlag));
router.get("/commercial/catalog", asyncHandler(listCommercialCatalog));
router.post("/commercial/plans", asyncHandler(createSubscriptionPlan));
router.put("/commercial/plans/:planId", asyncHandler(updateSubscriptionPlan));
router.get("/commercial/workspaces", asyncHandler(listCommercialWorkspaces));
router.get("/commercial/workspaces/:agencyId", asyncHandler(getCommercialWorkspace));
router.put("/commercial/workspaces/:agencyId/subscription", asyncHandler(updateWorkspaceSubscription));
router.put("/commercial/workspaces/:agencyId/features/:featureKey", asyncHandler(upsertWorkspaceFeatureOverride));
router.delete("/commercial/workspaces/:agencyId/features/:featureKey", asyncHandler(deleteWorkspaceFeatureOverride));
export default router;
