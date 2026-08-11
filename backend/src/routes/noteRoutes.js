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
import { requirePortalCapability } from "../services/portalAccessService.js";

const router = Router();
// This router previously relied on relatedRecordAccessWhere (client/case
// data access) as its only real gate — harmless while frontdesk had zero
// client/case access, but frontdesk's data scope now covers every client
// and case for viewing purposes (see portalAccessService.js), which would
// otherwise newly expose note read/write to them too. Notes are their own
// capability (internalNotes), separate from client/case visibility.
router.use(requireRole("admin", "consultant", "frontdesk"));
router.use(requirePortalCapability("internalNotes"));

router.get("/", asyncHandler(listNotes));
router.get("/:id", asyncHandler(getNoteById));
router.post("/", asyncHandler(createNote));
router.patch("/:id", asyncHandler(updateNote));
router.delete("/:id", asyncHandler(deleteNote));

export default router;
