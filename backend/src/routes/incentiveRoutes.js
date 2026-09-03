import { Router } from "express";
import { getActiveTimelines, getLedger, getPipeline, getSummary, getTeamSummary } from "../controllers/incentiveLedgerController.js";
import { closeCurrentPeriod, contest, createCycle, finalizeContest, getBreakdown, getCurrentPeriod, simulate } from "../controllers/incentiveExpansionController.js";
import { requireRole } from "../middleware/authorization.js";
import { asyncHandler } from "../utils/http.js";

const router = Router();

router.get("/ledger", asyncHandler(getLedger));
router.get("/summary", asyncHandler(getSummary));
router.get("/summary/team", requireRole("admin"), asyncHandler(getTeamSummary));
router.get("/pipeline", asyncHandler(getPipeline));
router.get("/timelines", asyncHandler(getActiveTimelines));
router.get("/breakdown", asyncHandler(getBreakdown));
router.get("/period/current", asyncHandler(getCurrentPeriod));
router.get("/contest", asyncHandler(contest));
router.post("/period/close", requireRole("admin"), asyncHandler(closeCurrentPeriod));
router.post("/cycles/:caseId/reapplication", requireRole("admin"), asyncHandler(createCycle));
router.post("/simulate", requireRole("admin"), asyncHandler(simulate));
router.post("/contest/finalize", requireRole("admin"), asyncHandler(finalizeContest));

export default router;
