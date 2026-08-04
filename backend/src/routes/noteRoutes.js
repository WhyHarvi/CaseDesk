import { Router } from "express";
import {
  createNote,
  deleteNote,
  getNoteById,
  listNotes,
  updateNote,
} from "../controllers/noteController.js";
import { asyncHandler } from "../utils/http.js";
import { requireRole } from "../middleware/authorization.js";

const router = Router();
router.use(requireRole("admin", "consultant", "frontdesk"));

router.get("/", asyncHandler(listNotes));
router.get("/:id", asyncHandler(getNoteById));
router.post("/", asyncHandler(createNote));
router.patch("/:id", asyncHandler(updateNote));
router.delete("/:id", asyncHandler(deleteNote));

export default router;
