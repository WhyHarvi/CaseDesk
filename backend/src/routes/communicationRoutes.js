import { Router } from "express";
import {
  assignUnmatchedCommunication,
  bulkDeleteCommunication,
  bulkUpdateCommunicationConversations,
  createCommunicationMessage,
  createCommunicationTemplate,
  deleteCommunication,
  deleteCommunicationTemplate,
  exportCommunication,
  getCommunicationConversation,
  getCommunicationProviders,
  getClientEmailThread,
  getPortalChatStatus,
  getCommunicationRealtimeConfig,
  getCommunicationRetentionPolicy,
  getCurrentCommunicationPermissions,
  importCommunication,
  listCaseCommunication,
  listCommunicationConsents,
  listTeamCommunicationPermissions,
  listCommunicationInbox,
  listCommunicationTemplates,
  listUnmatchedCommunication,
  markCommunicationRead,
  restoreCommunication,
  retryCommunicationDelivery,
  sendCommunicationDraft,
  shortenCommunicationSubject,
  toggleCommunicationMessageReaction,
  updateCommunicationConversation,
  updateCommunicationDraft,
  updateCommunicationPermissions,
  updateCommunicationRetentionPolicy,
  updateCommunicationTemplate,
  upsertCommunicationConsent,
} from "../controllers/communicationController.js";
import { asyncHandler } from "../utils/http.js";
import { receiveDocumentFile } from "../middleware/documentUploadMiddleware.js";
import {
  deleteCommunicationAttachment,
  serveCommunicationAttachment,
  uploadCommunicationAttachment,
} from "../controllers/communicationAttachmentController.js";
import {
  createCommunicationAutomation,
  deleteCommunicationAutomation,
  getClientCommunicationPolicy,
  getCommunicationAnalytics,
  getCommunicationPreference,
  getCommunicationSlaPolicy,
  listCommunicationAudit,
  listCommunicationAutomations,
  updateCommunicationAutomation,
  updateClientCommunicationPolicy,
  updateCommunicationPreference,
  updateCommunicationSlaPolicy,
} from "../controllers/communicationOperationsController.js";
import {
  createCaseClientChatAccess,
  getCaseClientChatAccess,
  revokeCaseClientChatAccess,
} from "../controllers/clientCommunicationController.js";

const router = Router();

router.get("/providers", asyncHandler(getCommunicationProviders));
router.get(
  "/clients/:clientId/portal-chat-status",
  asyncHandler(getPortalChatStatus),
);
router.get(
  "/clients/:clientId/email-thread",
  asyncHandler(getClientEmailThread),
);
router.get(
  "/realtime/case/:caseId",
  asyncHandler(getCommunicationRealtimeConfig),
);
router.get("/permissions", asyncHandler(getCurrentCommunicationPermissions));
router.get("/permissions/team", asyncHandler(listTeamCommunicationPermissions));
router.patch(
  "/permissions/:userId",
  asyncHandler(updateCommunicationPermissions),
);
router.get("/inbox", asyncHandler(listCommunicationInbox));
router.get("/analytics", asyncHandler(getCommunicationAnalytics));
router.get("/audit", asyncHandler(listCommunicationAudit));
router.get("/automations", asyncHandler(listCommunicationAutomations));
router.post("/automations", asyncHandler(createCommunicationAutomation));
router.patch("/automations/:id", asyncHandler(updateCommunicationAutomation));
router.delete("/automations/:id", asyncHandler(deleteCommunicationAutomation));
router.get("/sla", asyncHandler(getCommunicationSlaPolicy));
router.patch("/sla", asyncHandler(updateCommunicationSlaPolicy));
router.get("/clients/policy", asyncHandler(getClientCommunicationPolicy));
router.patch("/clients/policy", asyncHandler(updateClientCommunicationPolicy));
router.get("/unmatched", asyncHandler(listUnmatchedCommunication));
router.post(
  "/unmatched/:id/assign",
  asyncHandler(assignUnmatchedCommunication),
);
router.get("/retention", asyncHandler(getCommunicationRetentionPolicy));
router.patch("/retention", asyncHandler(updateCommunicationRetentionPolicy));
router.get("/templates", asyncHandler(listCommunicationTemplates));
router.post("/templates", asyncHandler(createCommunicationTemplate));
router.patch("/templates/:id", asyncHandler(updateCommunicationTemplate));
router.delete("/templates/:id", asyncHandler(deleteCommunicationTemplate));
router.get("/case/:caseId", asyncHandler(listCaseCommunication));
router.get("/case/:caseId/consents", asyncHandler(listCommunicationConsents));
router.get(
  "/case/:caseId/preferences",
  asyncHandler(getCommunicationPreference),
);
router.put(
  "/case/:caseId/preferences",
  asyncHandler(updateCommunicationPreference),
);
router.get("/case/:caseId/chat-access", asyncHandler(getCaseClientChatAccess));
router.post(
  "/case/:caseId/chat-access",
  asyncHandler(createCaseClientChatAccess),
);
router.delete(
  "/case/:caseId/chat-access",
  asyncHandler(revokeCaseClientChatAccess),
);
router.post("/consents", asyncHandler(upsertCommunicationConsent));
router.get("/conversations/:id", asyncHandler(getCommunicationConversation));
router.post(
  "/conversations/bulk",
  asyncHandler(bulkUpdateCommunicationConversations),
);
router.patch(
  "/conversations/:id",
  asyncHandler(updateCommunicationConversation),
);
router.post("/conversations/:id/read", asyncHandler(markCommunicationRead));
router.post("/messages", asyncHandler(createCommunicationMessage));
router.patch("/messages/:id/draft", asyncHandler(updateCommunicationDraft));
router.post("/messages/:id/send", asyncHandler(sendCommunicationDraft));
router.post("/subject/shorten", asyncHandler(shortenCommunicationSubject));
router.post("/messages/:id/retry", asyncHandler(retryCommunicationDelivery));
router.post("/messages/:id/restore", asyncHandler(restoreCommunication));
router.post(
  "/messages/:id/attachments",
  receiveDocumentFile,
  asyncHandler(uploadCommunicationAttachment),
);
router.get(
  "/messages/:id/attachments/:attachmentId/file",
  asyncHandler(serveCommunicationAttachment),
);
router.delete(
  "/messages/:id/attachments/:attachmentId",
  asyncHandler(deleteCommunicationAttachment),
);
router.post("/import", asyncHandler(importCommunication));
router.post("/export", asyncHandler(exportCommunication));
router.post("/bulk-delete", asyncHandler(bulkDeleteCommunication));
router.delete("/messages/:id", asyncHandler(deleteCommunication));
router.post("/messages/:id/reactions", asyncHandler(toggleCommunicationMessageReaction));

export default router;
