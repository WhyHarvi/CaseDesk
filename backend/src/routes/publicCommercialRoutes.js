import cors from "cors";
import { Router } from "express";
import { listPublicSubscriptionPlans } from "../controllers/publicCommercialController.js";
import rateLimit from "../middleware/rateLimit.js";
import { asyncHandler } from "../utils/http.js";

const router = Router();
const publicCatalogLimit = rateLimit({ windowMs: 60_000, max: 300 });

// The marketing catalog contains no tenant data and is intentionally safe for
// direct browser rendering by public showcase clients.
router.use(cors({ origin: "*", methods: ["GET"], maxAge: 86_400 }));
router.get("/plans", publicCatalogLimit, asyncHandler(listPublicSubscriptionPlans));

export default router;
