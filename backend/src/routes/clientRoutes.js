import { Router } from "express";
import {
  createClient,
  archiveClient,
  closeClient,
  getClientArchiveImpact,
  getClientById,
  findClientContactMatches,
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
  sendPortalTemporaryPassword,
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
import { getClientPortalPolicy, putClientPortalPolicy } from "../controllers/clientPortalPolicyController.js";

const router = Router();

router.get("/", asyncHandler(listClients));
router.get(
  "/contact-matches",
  rateLimit({ windowMs: 60_000, max: 120 }),
  asyncHandler(findClientContactMatches),
);
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
router.post(
  "/:clientId/portal-account/temporary-password",
  requirePortalCapability("manageClientPortal"),
  rateLimit({ windowMs: 15 * 60_000, max: 20 }),
  asyncHandler(sendPortalTemporaryPassword),
);
router.get("/:clientId/portal-policy", requirePortalCapability("manageClientPortal"), requireClientAccess("clientId"), asyncHandler(getClientPortalPolicy));
router.put("/:clientId/portal-policy", requirePortalCapability("manageClientPortal"), requireClientAccess("clientId"), rateLimit({ windowMs: 60_000, max: 30 }), asyncHandler(putClientPortalPolicy));
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
// Frontdesk can create, edit, archive, and close clients — the same as
// consultant/admin. Case editing and internal notes stay locked down
// separately (see caseRoutes.js / noteRoutes.js); this guard is
// client-record-specific.
router.post("/", asyncHandler(createClient));
router.patch("/:id", requireRole("admin", "consultant", "frontdesk"), asyncHandler(updateClient));
router.get("/:id/archive-impact", asyncHandler(getClientArchiveImpact));
router.patch("/:id/archive", requireRole("admin", "consultant", "frontdesk"), asyncHandler(archiveClient));
router.patch("/:id/close", requireRole("admin", "consultant", "frontdesk"), asyncHandler(closeClient));
router.post(
  "/:id/quickbooks-sync",
  requireRole("admin", "consultant"),
  rateLimit({ windowMs: 60_000, max: 10 }),
  asyncHandler(syncClientQuickBooks),
);

export default router;
