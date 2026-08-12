import { Router } from "express";
import { asyncHandler } from "../../utils/http.js";
import { requireRole } from "../../middleware/authorization.js";
import { getTeamWorkload, pingPortalActivity } from "./workload.controller.js";

const router = Router();

// Any active staff member (admin/consultant/frontdesk) pings their own
// activity — this router is mounted behind staffUser in server.js.
router.post("/activity-ping", asyncHandler(pingPortalActivity));
router.get("/team", requireRole("admin"), asyncHandler(getTeamWorkload));

export default router;
