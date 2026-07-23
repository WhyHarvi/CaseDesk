import { Router } from "express";
import { globalSearch } from "../controllers/globalSearchController.js";
import { asyncHandler } from "../utils/http.js";

const router = Router();

router.get("/", asyncHandler(globalSearch));

export default router;

