import { Router } from "express";
import { getUserById, listUsers } from "../controllers/userController.js";
import { asyncHandler } from "../utils/http.js";

const router = Router();

router.get("/", asyncHandler(listUsers));
router.get("/:id", asyncHandler(getUserById));

export default router;
