import { Router } from "express";
import { receiveQuickBooksWebhook } from "../controllers/quickbooksWebhookController.js";
import { asyncHandler } from "../utils/http.js";

const router = Router();

// Fully unauthenticated — Intuit calls this directly. Trust comes only
// from the HMAC signature verified inside the controller.
router.post("/", asyncHandler(receiveQuickBooksWebhook));

export default router;
