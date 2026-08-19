import { Router } from "express";
import { getActiveTimelines, getLedger, getPipeline, getSummary, getTeamSummary } from "../controllers/incentiveLedgerController.js";
import { requireRole } from "../middleware/authorization.js";
import { asyncHandler } from "../utils/http.js";

const router = Router();

router.get("/ledger", asyncHandler(getLedger));
router.get("/summary", asyncHandler(getSummary));
router.get("/summary/team", requireRole("admin"), asyncHandler(getTeamSummary));
router.get("/pipeline", asyncHandler(getPipeline));
router.get("/timelines", asyncHandler(getActiveTimelines));

export default router;
