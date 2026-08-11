import { Router } from "express";
import {
  createClient,
  archiveClient,
  closeClient,
  getClientArchiveImpact,
  getClientById,
  listClientAppointments,
  listClients,
  syncClientQuickBooks,
  updateClient,
} from "../controllers/clientController.js";
import { asyncHandler } from "../utils/http.js";
import {
  createPortalAccount,
  getPortalAccountStatus,
  sendPortalAccessLink,
  setPortalAccountAccess,
} from "../controllers/portalController.js";
import {
  requireClientAccess,
  requireRole,
} from "../middleware/authorization.js";
import rateLimit from "../middleware/rateLimit.js";
import { requirePortalCapability } from "../services/portalAccessService.js";
import {
  generateAccountStatement,
  getAccountStatementOptions,
  getClientBillingOverview,
  getClientManualBillingOptions,
  getGeneratedAccountStatement,
  createClientManualBillingEntry,
} from "../controllers/accountStatementController.js";

const router = Router();

router.get("/", asyncHandler(listClients));
router.post(
  "/:clientId/portal-account",
  requirePortalCapability("manageClientPortal"),
  rateLimit({ windowMs: 15 * 60_000, max: 20 }),
  asyncHandler(createPortalAccount),
);
router.get(
  "/:clientId/portal-account",
  requirePortalCapability("manageClientPortal"),
  asyncHandler(getPortalAccountStatus),
);
router.post(
  "/:clientId/portal-account/access",
  requirePortalCapability("manageClientPortal"),
  rateLimit({ windowMs: 60_000, max: 15 }),
  asyncHandler(setPortalAccountAccess),
);
router.post(
  "/:clientId/portal-account/send-link",
  requirePortalCapability("manageClientPortal"),
  rateLimit({ windowMs: 15 * 60_000, max: 20 }),
  asyncHandler(sendPortalAccessLink),
);
router.use("/:id", requireClientAccess());
router.get(
  "/:id/statements/account/options",
  requirePortalCapability("financialData"),
  asyncHandler(getAccountStatementOptions),
);
router.get(
  "/:id/billing",
  requirePortalCapability("financialData"),
  asyncHandler(getClientBillingOverview),
);
router.get(
  "/:id/billing/manual-entry-options",
  requirePortalCapability("financialData"),
  requireRole("admin", "consultant", "frontdesk"),
  asyncHandler(getClientManualBillingOptions),
);
router.post(
  "/:id/billing/manual-entry",
  requirePortalCapability("financialData"),
  requireRole("admin", "consultant", "frontdesk"),
  rateLimit({ windowMs: 60_000, max: 20 }),
  asyncHandler(createClientManualBillingEntry),
);
router.get("/:id/appointments", asyncHandler(listClientAppointments));
router.post(
  "/:id/statements/account",
  requirePortalCapability("financialData"),
  asyncHandler(generateAccountStatement),
);
router.get(
  "/:id/statements/account/:statementId",
  requirePortalCapability("financialData"),
  asyncHandler(getGeneratedAccountStatement),
);
router.get("/:id", asyncHandler(getClientById));
// Creating a client stays open to frontdesk — it's the first step of the
// front-desk walk-in intake flow. Editing, archiving, or closing an
// *existing* client is not: frontdesk's data scope now covers every
// client for lookup/view purposes, and without this guard that would
// also mean write access to every client's record.
router.post("/", asyncHandler(createClient));
router.patch("/:id", requireRole("admin", "consultant"), asyncHandler(updateClient));
router.get("/:id/archive-impact", asyncHandler(getClientArchiveImpact));
router.patch("/:id/archive", requireRole("admin", "consultant"), asyncHandler(archiveClient));
router.patch("/:id/close", requireRole("admin", "consultant"), asyncHandler(closeClient));
router.post(
  "/:id/quickbooks-sync",
  requireRole("admin", "consultant"),
  rateLimit({ windowMs: 60_000, max: 10 }),
  asyncHandler(syncClientQuickBooks),
);

export default router;
