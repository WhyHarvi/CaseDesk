import { Router } from "express";
import {
  confirmCaseEasyImportUpload,
  confirmCaseEasyReportUpload,
  convertCaseEasyImportContact,
  getCaseEasyReportsForClient,
  getCaseEasyReportSummary,
  getCaseEasyImportContact,
  listCaseEasyReportRows,
  listCaseEasyImportContacts,
  listUnlinkedCaseEasyImportCases,
  previewCaseEasyImportUpload,
  previewCaseEasyReportUpload,
} from "../controllers/caseEasyImportController.js";
import { requireRole } from "../middleware/authorization.js";
import {
  receiveCaseEasyImportFiles,
  receiveCaseEasyReportFile,
} from "../middleware/caseEasyImportUpload.js";
import rateLimit from "../middleware/rateLimit.js";
import { asyncHandler } from "../utils/http.js";

const router = Router();

// Case Easy migration is an explicit staff workspace. Every request remains
// tenant-scoped in the controller and database policies.
router.use(requireRole("admin", "consultant", "frontdesk"));

const uploadLimiter = rateLimit({ windowMs: 60_000, max: 10 });

router.post("/preview", uploadLimiter, receiveCaseEasyImportFiles, asyncHandler(previewCaseEasyImportUpload));
router.post("/upload", uploadLimiter, receiveCaseEasyImportFiles, asyncHandler(confirmCaseEasyImportUpload));
router.post("/reports/preview", uploadLimiter, receiveCaseEasyReportFile, asyncHandler(previewCaseEasyReportUpload));
router.post("/reports/upload", uploadLimiter, receiveCaseEasyReportFile, asyncHandler(confirmCaseEasyReportUpload));

router.get("/contacts", asyncHandler(listCaseEasyImportContacts));
router.get("/unlinked-cases", asyncHandler(listUnlinkedCaseEasyImportCases));
router.get("/reports/summary", asyncHandler(getCaseEasyReportSummary));
router.get("/reports", asyncHandler(listCaseEasyReportRows));
router.get("/clients/:clientId/reports", asyncHandler(getCaseEasyReportsForClient));
router.get("/contacts/:id", asyncHandler(getCaseEasyImportContact));
router.post("/contacts/:id/convert", rateLimit({ windowMs: 60_000, max: 20 }), asyncHandler(convertCaseEasyImportContact));

export default router;
