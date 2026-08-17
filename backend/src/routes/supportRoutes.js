import { Router } from "express";
import { diagnoseSupportIssue, listSupportTickets, submitSupportTicket } from "../controllers/supportController.js";
import { receiveSupportScreenshot } from "../middleware/supportScreenshotUpload.js";
import { rateLimit } from "../middleware/rateLimit.js";
import { asyncHandler } from "../utils/http.js";

const router = Router();

router.get("/tickets", asyncHandler(listSupportTickets));
router.post("/diagnose", rateLimit({ windowMs: 60_000, max: 10 }), asyncHandler(diagnoseSupportIssue));
router.post("/tickets", rateLimit({ windowMs: 60_000, max: 5 }), receiveSupportScreenshot, asyncHandler(submitSupportTicket));

export default router;
