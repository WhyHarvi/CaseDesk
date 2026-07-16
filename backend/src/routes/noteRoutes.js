import { Router } from "express";
import {
  createNote,
  deleteNote,
  getNoteById,
  listNotes,
  updateNote,
} from "../controllers/noteController.js";
import { asyncHandler } from "../utils/http.js";

const router = Router();

router.get("/", asyncHandler(listNotes));
router.get("/:id", asyncHandler(getNoteById));
router.post("/", asyncHandler(createNote));
router.patch("/:id", asyncHandler(updateNote));
router.delete("/:id", asyncHandler(deleteNote));

export default router;

