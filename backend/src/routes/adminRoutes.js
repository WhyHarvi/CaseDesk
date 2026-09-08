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
  changeTeamMemberRole,
  createTeamMember,
  disableTeamMember,
  getTeamMember,
  listIncentiveRoleMembers,
  listPortalAccessMembers,
  listTeamMembers,
  resetTeamMemberPassword,
  updateMemberProfile,
  updateTeamMember,
  updateTeamMemberPortalAccess,
} from "../controllers/adminTeamMemberController.js";
import { requireRole } from "../middleware/authorization.js";
import { asyncHandler } from "../utils/http.js";
import rateLimit from "../middleware/rateLimit.js";
import { getAgencyPortalPolicy, getPortalPermissionCatalog, putAgencyPortalPolicy } from "../controllers/clientPortalPolicyController.js";

const router = Router();
// Account/security provisioning (invite, disable, reset-password, role
// changes, agency-wide portal policy) stays admin-only — a manager can run
// the team's day-to-day work but doesn't hold the tenant's security
// boundary. Team oversight (workload, collaboration requests, the
// read-only incentive-role roster) opens up to manager below; see
// docs/Decisions/Manager Role Permissions Proposal.md.
const admin = requireRole("admin");
const oversight = requireRole("admin", "manager");

router.get("/team-members", admin, asyncHandler(listTeamMembers));
router.get("/portal-access", admin, asyncHandler(listPortalAccessMembers));
router.get("/client-portal-policy/catalog", admin, getPortalPermissionCatalog);
router.get("/client-portal-policy", admin, asyncHandler(getAgencyPortalPolicy));
router.put("/client-portal-policy", admin, rateLimit({ windowMs: 60_000, max: 30 }), asyncHandler(putAgencyPortalPolicy));
router.get("/incentive-role-members", oversight, asyncHandler(listIncentiveRoleMembers));
router.patch("/incentive-role-members/:id", admin, asyncHandler(updateMemberProfile));
router.post(
  "/team-members",
  admin,
  rateLimit({ windowMs: 15 * 60_000, max: 20 }),
  asyncHandler(createTeamMember),
);
router.get("/team-members/:id", admin, asyncHandler(getTeamMember));
router.patch("/team-members/:id", admin, asyncHandler(updateTeamMember));
router.patch("/team-members/:id/role", admin, asyncHandler(changeTeamMemberRole));
router.put(
  "/team-members/:id/portal-access",
  admin,
  asyncHandler(updateTeamMemberPortalAccess),
);
router.post("/team-members/:id/disable", admin, asyncHandler(disableTeamMember));
router.post(
  "/team-members/:id/reset-password",
  admin,
  rateLimit({ windowMs: 15 * 60_000, max: 10 }),
  asyncHandler(resetTeamMemberPassword),
);
router.get("/consultants/workload", oversight, asyncHandler(agencyWorkloads));
router.post("/consultants/workload/reassign", oversight, asyncHandler(reassignWorkloadItem));
router.get(
  "/consultants/workload/:consultantKey/:category",
  oversight,
  asyncHandler(consultantWorkloadCategory),
);
router.get("/consultants/collaboration-requests", oversight, asyncHandler(listCollaborationRequestsHandler));
router.post(
  "/consultants/collaboration-requests/:id/approve",
  oversight,
  asyncHandler(approveCollaborationRequestHandler),
);
router.post(
  "/consultants/collaboration-requests/:id/decline",
  oversight,
  asyncHandler(declineCollaborationRequestHandler),
);
router.post(
  "/consultants",
  admin,
  rateLimit({ windowMs: 15 * 60_000, max: 20 }),
  asyncHandler(createConsultant),
);
router.get("/consultants", admin, asyncHandler(listConsultants));
router.get("/consultants/:id", admin, asyncHandler(getConsultant));
router.patch("/consultants/:id", admin, asyncHandler(updateConsultant));
router.post("/consultants/:id/disable", admin, asyncHandler(disableConsultant));
router.post(
  "/consultants/:id/reset-password",
  admin,
  rateLimit({ windowMs: 15 * 60_000, max: 10 }),
  asyncHandler(resetConsultantPassword),
);
export default router;
