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

const router = Router();
router.get("/overview", asyncHandler(getDeveloperOverview));
router.get("/agencies", asyncHandler(listDeveloperAgencies));
router.get("/agencies/:id", asyncHandler(getDeveloperAgency));
router.get("/support-tickets", asyncHandler(listDeveloperSupportTickets));
router.patch("/support-tickets/:id/status", asyncHandler(updateDeveloperSupportTicketStatus));
router.get("/activity", asyncHandler(listDeveloperActivity));
router.get("/feature-flags", asyncHandler(getDeveloperFeatureFlags));
router.patch("/feature-flags/:key", asyncHandler(updateDeveloperFeatureFlag));
export default router;
