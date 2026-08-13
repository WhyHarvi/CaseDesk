import { Router } from "express";
import {
  agencyWorkloads,
  approveCollaborationRequestHandler,
  consultantWorkloadCategory,
  createConsultant,
  declineCollaborationRequestHandler,
  disableConsultant,
  getConsultant,
  listCollaborationRequestsHandler,
  listConsultants,
  reassignWorkloadItem,
  resetConsultantPassword,
  updateConsultant,
} from "../controllers/adminConsultantController.js";
import {
  createTeamMember,
  disableTeamMember,
  getTeamMember,
  listPortalAccessMembers,
  listTeamMembers,
  resetTeamMemberPassword,
  updateTeamMember,
  updateTeamMemberPortalAccess,
} from "../controllers/adminTeamMemberController.js";
import { requireRole } from "../middleware/authorization.js";
import { asyncHandler } from "../utils/http.js";
import rateLimit from "../middleware/rateLimit.js";

const router = Router();
router.use(requireRole("admin"));
router.get("/team-members", asyncHandler(listTeamMembers));
router.get("/portal-access", asyncHandler(listPortalAccessMembers));
router.post(
  "/team-members",
  rateLimit({ windowMs: 15 * 60_000, max: 20 }),
  asyncHandler(createTeamMember),
);
router.get("/team-members/:id", asyncHandler(getTeamMember));
router.patch("/team-members/:id", asyncHandler(updateTeamMember));
router.put(
  "/team-members/:id/portal-access",
  asyncHandler(updateTeamMemberPortalAccess),
);
router.post("/team-members/:id/disable", asyncHandler(disableTeamMember));
router.post(
  "/team-members/:id/reset-password",
  rateLimit({ windowMs: 15 * 60_000, max: 10 }),
  asyncHandler(resetTeamMemberPassword),
);
router.get("/consultants/workload", asyncHandler(agencyWorkloads));
router.post("/consultants/workload/reassign", asyncHandler(reassignWorkloadItem));
router.get(
  "/consultants/workload/:consultantKey/:category",
  asyncHandler(consultantWorkloadCategory),
);
router.get("/consultants/collaboration-requests", asyncHandler(listCollaborationRequestsHandler));
router.post(
  "/consultants/collaboration-requests/:id/approve",
  asyncHandler(approveCollaborationRequestHandler),
);
router.post(
  "/consultants/collaboration-requests/:id/decline",
  asyncHandler(declineCollaborationRequestHandler),
);
router.post(
  "/consultants",
  rateLimit({ windowMs: 15 * 60_000, max: 20 }),
  asyncHandler(createConsultant),
);
router.get("/consultants", asyncHandler(listConsultants));
router.get("/consultants/:id", asyncHandler(getConsultant));
router.patch("/consultants/:id", asyncHandler(updateConsultant));
router.post("/consultants/:id/disable", asyncHandler(disableConsultant));
router.post(
  "/consultants/:id/reset-password",
  rateLimit({ windowMs: 15 * 60_000, max: 10 }),
  asyncHandler(resetConsultantPassword),
);
export default router;
