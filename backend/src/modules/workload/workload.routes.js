import { Router } from "express";
import { asyncHandler } from "../../utils/http.js";
import { requirePortalCapability } from "../../services/portalAccessService.js";
import { getTeamWorkload, pingPortalActivity, getDailyTrend } from "./workload.controller.js";

const router = Router();

// Any active staff member (admin/consultant/frontdesk) pings their own
// activity — this router is mounted behind staffUser in server.js.
router.post("/activity-ping", asyncHandler(pingPortalActivity));
// requirePortalCapability already auto-passes for admins (see
// portalAccessService.js's defaultPortalAccess), so this both keeps admin
// access working and lets a specific staff member be granted the same
// team-wide view from Settings > Portal Access without becoming an admin.
router.get("/team", requirePortalCapability("teamWorkload"), asyncHandler(getTeamWorkload));
router.get("/team/daily-trend", requirePortalCapability("teamWorkload"), asyncHandler(getDailyTrend));

export default router;
