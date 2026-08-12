import { Router } from "express";
import { approveCaseBillingRetainer, createCaseBillingRetainerDraft, getCaseBillingRetainer, previewCaseBillingRetainer, resetCaseBillingRetainer, syncCaseBillingRetainerWithSchedule } from "../controllers/caseBillingRetainerController.js";
import { asyncHandler } from "../utils/http.js";

// Billing-tab-scoped retainer endpoints (Fix 3.1/4.1) — deliberately
// separate from correspondenceRoutes.js (gated on the "agreementsLetters"
// case tab) AND mounted at its own path prefix rather than under
// "/api/cases", since that prefix is already claimed by caseRoutes.js with
// its own requirePortalPage("cases") gate — Express runs that gate for
// every request under the shared prefix before a second router mounted at
// the same path ever gets a look, which would have defeated the point of a
// separate "billing" tab gate here. Every handler also hard-scopes itself
// to correspondenceKind "Agreement", so a Billing-only staff member gets
// exactly the retainer actions this flow needs without picking up
// Letter/Agreement management access more broadly.
const router = Router();
router.get("/:caseId", asyncHandler(getCaseBillingRetainer));
router.post("/:caseId/preview", asyncHandler(previewCaseBillingRetainer));
router.post("/:caseId/draft", asyncHandler(createCaseBillingRetainerDraft));
router.post("/:caseId/sync-schedule", asyncHandler(syncCaseBillingRetainerWithSchedule));
router.post("/:caseId/reset", asyncHandler(resetCaseBillingRetainer));
router.post("/:caseId/approve", asyncHandler(approveCaseBillingRetainer));
export default router;
