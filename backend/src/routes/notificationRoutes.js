import { Router } from "express";
import {
  dismissNotification,
  getNotificationPreferences,
  getUnreadNotificationCount,
  getSidebarNotificationCounts,
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  markDestinationUpdatesRead,
  updateNotificationPreferences,
} from "../controllers/notificationController.js";
import { asyncHandler } from "../utils/http.js";

const router = Router();
router.get("/", asyncHandler(listNotifications));
router.get("/unread-count", asyncHandler(getUnreadNotificationCount));
router.get("/sidebar-counts", asyncHandler(getSidebarNotificationCounts));
router.post("/sidebar-counts/read", asyncHandler(markDestinationUpdatesRead));
router.post("/read-all", asyncHandler(markAllNotificationsRead));
router.get("/preferences", asyncHandler(getNotificationPreferences));
router.put("/preferences/:category", asyncHandler(updateNotificationPreferences));
router.patch("/:id/read", asyncHandler(markNotificationRead));
router.patch("/:id/dismiss", asyncHandler(dismissNotification));

export default router;
