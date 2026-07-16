import { Router } from "express";
import {
  createClient,
  archiveClient,
  closeClient,
  getClientArchiveImpact,
  getClientById,
  listClients,
  updateClient,
} from "../controllers/clientController.js";
import { asyncHandler } from "../utils/http.js";
import { createPortalAccount, getPortalAccountStatus, setPortalAccountAccess } from "../controllers/portalController.js";
import { requireClientAccess, requireRole } from "../middleware/authorization.js";
import rateLimit from "../middleware/rateLimit.js";
import {
  generateAccountStatement,
  getAccountStatementOptions,
  getGeneratedAccountStatement,
} from "../controllers/accountStatementController.js";

const router = Router();

router.get("/", asyncHandler(listClients));
router.post("/:clientId/portal-account", requireRole("admin", "consultant"), rateLimit({ windowMs: 15 * 60_000, max: 20 }), asyncHandler(createPortalAccount));
router.get("/:clientId/portal-account", requireRole("admin", "consultant"), asyncHandler(getPortalAccountStatus));
router.post("/:clientId/portal-account/access", requireRole("admin", "consultant"), rateLimit({ windowMs: 60_000, max: 15 }), asyncHandler(setPortalAccountAccess));
router.use("/:id", requireClientAccess());
router.get("/:id/statements/account/options", asyncHandler(getAccountStatementOptions));
router.post("/:id/statements/account", asyncHandler(generateAccountStatement));
router.get("/:id/statements/account/:statementId", asyncHandler(getGeneratedAccountStatement));
router.get("/:id", asyncHandler(getClientById));
router.post("/", asyncHandler(createClient));
router.patch("/:id", asyncHandler(updateClient));
router.get("/:id/archive-impact", asyncHandler(getClientArchiveImpact));
router.patch("/:id/archive", asyncHandler(archiveClient));
router.patch("/:id/close", asyncHandler(closeClient));

export default router;
