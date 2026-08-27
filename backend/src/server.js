import cors from "cors";
import dotenv from "dotenv";
import express from "express";
import authRoutes from "./routes/authRoutes.js";
import onboardingRoutes from "./routes/onboardingRoutes.js";
import activityLogRoutes from "./routes/activityLogRoutes.js";
import caseRoutes from "./routes/caseRoutes.js";
import clientDocumentRoutes from "./routes/clientDocumentRoutes.js";
import clientRoutes from "./routes/clientRoutes.js";
import dashboardRoutes from "./routes/dashboardRoutes.js";
import developerRoutes from "./routes/developerRoutes.js";
import globalSearchRoutes from "./routes/globalSearchRoutes.js";
import paymentsOverviewRoutes from "./routes/paymentsOverviewRoutes.js";
import documentTemplateRoutes from "./routes/documentTemplateRoutes.js";
import followUpRoutes from "./routes/followUpRoutes.js";
import requireAuth from "./middleware/authMiddleware.js";
import { requireRole } from "./middleware/authorization.js";
import {
  requireAnyPortalPage,
  requirePortalArea,
  requirePortalCapability,
  requirePortalPage,
} from "./services/portalAccessService.js";
import errorHandler, { notFoundHandler } from "./middleware/errorHandler.js";
import noteRoutes from "./routes/noteRoutes.js";
import paymentRoutes from "./routes/paymentRoutes.js";
import userRoutes from "./routes/userRoutes.js";
import workflowTemplateRoutes from "./routes/workflowTemplateRoutes.js";
import sharedLibraryRoutes from "./routes/sharedLibraryRoutes.js";
import writtenDocumentRoutes from "./routes/writtenDocumentRoutes.js";
import caseFormRoutes from "./routes/caseFormRoutes.js";
import agencyFormTemplateRoutes from "./routes/agencyFormTemplateRoutes.js";
import correspondenceRoutes from "./routes/correspondenceRoutes.js";
import appointmentRoutes from "./routes/appointmentRoutes.js";
import bookingRoutes from "./routes/bookingRoutes.js";
import publicBookingRoutes from "./routes/publicBookingRoutes.js";
import publicAgencyRoutes from "./routes/publicAgencyRoutes.js";
import quickbooksRoutes from "./routes/quickbooksRoutes.js";
import quickbooksWebhookRoutes from "./routes/quickbooksWebhookRoutes.js";
import zoomRoutes from "./routes/zoomRoutes.js";
import paymentScheduleRoutes from "./routes/paymentScheduleRoutes.js";
import feeCategoryRoutes from "./routes/feeCategoryRoutes.js";
import caseRoleRoutes from "./routes/caseRoleRoutes.js";
import incentivePlanRoutes from "./routes/incentivePlanRoutes.js";
import incentiveRoutes from "./routes/incentiveRoutes.js";
import caseBillingRetainerRoutes from "./routes/caseBillingRetainerRoutes.js";
import agencyBillingSettingsRoutes from "./routes/agencyBillingSettingsRoutes.js";
import caseEasyImportRoutes from "./routes/caseEasyImportRoutes.js";
import {
  startBookingReminderWorker,
  stopBookingReminderWorker,
} from "./services/bookingNotificationService.js";
import {
  startPaymentScheduleWorker,
  stopPaymentScheduleWorker,
} from "./services/paymentScheduleService.js";
import {
  startPaymentHoldExpiryWorker,
  stopPaymentHoldExpiryWorker,
} from "./services/bookingPaymentHoldService.js";
import {
  startQuickBooksWebhookWorker,
  stopQuickBooksWebhookWorker,
} from "./services/quickbooksWebhookService.js";
import {
  startCaseInformationDriftDetector,
  stopCaseInformationDriftDetector,
} from "./services/caseInformationDriftDetector.js";
import {
  startAppointmentNoShowWorker,
  stopAppointmentNoShowWorker,
} from "./services/appointmentNoShowService.js";
import communicationRoutes from "./routes/communicationRoutes.js";
import communicationWebhookRoutes from "./routes/communicationWebhookRoutes.js";
import aiRoutes from "./routes/aiRoutes.js";
import supportRoutes from "./routes/supportRoutes.js";
import internalChatRoutes from "./routes/internalChatRoutes.js";
import workloadRoutes from "./modules/workload/workload.routes.js";
import callHistoryRoutes from "./routes/callHistoryRoutes.js";
import twilioCallRoutes from "./routes/twilioCallRoutes.js";
import clientCommunicationRoutes from "./routes/clientCommunicationRoutes.js";
import settingsRoutes from "./routes/settingsRoutes.js";
import accountSettingsRoutes from "./routes/accountSettingsRoutes.js";
import personalMailboxRoutes from "./routes/personalMailboxRoutes.js";
import adminRoutes from "./routes/adminRoutes.js";
import consultantRoutes from "./routes/consultantRoutes.js";
import leadRoutes from "./modules/leads/lead.routes.js";
import leadPublicRoutes from "./modules/leads/lead.public.routes.js";
import leadWebsiteRoutes from "./modules/leads/lead.website.routes.js";
import leadProviderRoutes from "./modules/leads/lead.provider.routes.js";
import {
  startLeadIntakeWorker,
  stopLeadIntakeWorker,
} from "./modules/leads/lead.intake.worker.js";
import {
  startLeadReactivationWorker,
  stopLeadReactivationWorker,
} from "./modules/leads/lead.reactivation.worker.js";
import {
  startLeadStaleOutreachWorker,
  stopLeadStaleOutreachWorker,
} from "./modules/leads/lead.staleOutreach.worker.js";
import {
  startLeadOverdueAlertWorker,
  stopLeadOverdueAlertWorker,
} from "./modules/leads/lead.overdueAlert.worker.js";
import {
  startWorkloadZeroActivityWorker,
  stopWorkloadZeroActivityWorker,
} from "./modules/workload/workload.zeroActivity.worker.js";
import portalRoutes from "./routes/portalRoutes.js";
import clientPortalRoutes from "./routes/clientPortalRoutes.js";
import notificationRoutes from "./routes/notificationRoutes.js";
import {
  startNotificationScheduler,
  stopNotificationScheduler,
} from "./services/notificationScheduler.js";
import {
  startNotificationDeliveryWorker,
  stopNotificationDeliveryWorker,
} from "./services/notificationDeliveryService.js";
import {
  startAutomatedReminderWorker,
  stopAutomatedReminderWorker,
} from "./services/automatedReminderService.js";
import { invalidateDashboardCache } from "./services/dashboardCache.js";
import {
  startFormRevisionMonitor,
  stopFormRevisionMonitor,
} from "./services/formRevisionMonitor.js";
import {
  startCommunicationOutboxWorker,
  stopCommunicationOutboxWorker,
} from "./services/communicationOutboxService.js";
import {
  startInboundMailSync,
  stopInboundMailSync,
} from "./services/inboundMailSyncService.js";
import {
  startCommunicationMaintenance,
  stopCommunicationMaintenance,
} from "./services/communicationMaintenanceService.js";
import prisma from "./services/prisma/client.js";
import {
  requestContext,
  secureHeaders,
} from "./middleware/productionSecurity.js";
import { logger } from "./services/logger.js";
import {
  startAppointmentMeetingWorker,
  stopAppointmentMeetingWorker,
} from "./services/appointmentMeetingService.js";
import {
  startZoomConnectionMaintenance,
  stopZoomConnectionMaintenance,
  zoomConfigured,
} from "./services/zoomService.js";
import { startIncentiveRetryWorker, stopIncentiveRetryWorker } from "./services/incentiveCreditingService.js";

dotenv.config();

const app = express();
const port = Number(process.env.PORT) || 5000;
app.set("trust proxy", Number(process.env.TRUST_PROXY_HOPS) || 1);
app.disable("x-powered-by");
app.use(requestContext);
app.use(secureHeaders);

app.use(
  cors({
    origin: String(process.env.FRONTEND_URL || "http://localhost:5173")
      .split(",")
      .map((item) => item.trim()),
    // Let browsers reuse the preflight response instead of sending OPTIONS
    // before every request (Chrome caps this at 2h, Firefox at 24h).
    maxAge: 86400,
  }),
);
app.use(
  express.json({
    limit: process.env.JSON_BODY_LIMIT || "1mb",
    verify: (req, _res, buffer) => {
      req.rawBody = Buffer.from(buffer);
    },
  }),
);
// Twilio's voice webhooks (TwiML fetches, status/recording callbacks) POST
// application/x-www-form-urlencoded, never JSON — with only express.json()
// mounted, req.body was always {} for every one of these requests, so every
// outbound call read `req.body.To` as undefined and immediately spoke "No
// destination number was provided" before hanging up (the ~4s call-drop
// this was added to fix). json() and urlencoded() only ever act on their
// own matching Content-Type, so mounting both is the standard, safe setup.
app.use(
  express.urlencoded({
    extended: true,
    limit: process.env.URLENCODED_BODY_LIMIT || "1mb",
    verify: (req, _res, buffer) => {
      req.rawBody = Buffer.from(buffer);
    },
  }),
);

app.use((req, res, next) => {
  if (!["POST", "PUT", "PATCH", "DELETE"].includes(req.method)) return next();
  res.on("finish", () => {
    if (res.statusCode < 400 && req.auth?.agencyId)
      invalidateDashboardCache(req.auth.agencyId);
  });
  return next();
});

app.get("/api/health/live", (_req, res) => res.json({ status: "ok" }));
app.get("/api/health", async (req, res, next) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ status: "ok", database: "connected", requestId: req.requestId });
  } catch (error) {
    next(
      Object.assign(error, { statusCode: 503, code: "DATABASE_UNAVAILABLE" }),
    );
  }
});

app.use("/api/auth", authRoutes);
app.use("/api/developer", requireAuth, requireRole("developer"), developerRoutes);
app.use("/api/account", requireAuth, accountSettingsRoutes);
app.use("/api/onboarding", onboardingRoutes);
app.use("/api/communications/webhooks", communicationWebhookRoutes);
app.use("/api/client-communication", clientCommunicationRoutes);
app.use("/api/public/lead-intake", leadPublicRoutes);
app.use("/api/public/booking", publicBookingRoutes);
app.use("/api/public/agency", publicAgencyRoutes);
app.use("/api/quickbooks", quickbooksRoutes);
app.use("/api/quickbooks/webhook", quickbooksWebhookRoutes);
app.use("/api/zoom", zoomRoutes);
app.use("/api/mailboxes", personalMailboxRoutes);
app.use("/api/lead-connectors/website", leadWebsiteRoutes);
app.use("/api/lead-connectors", leadProviderRoutes);
app.use("/api/portal", requireAuth, portalRoutes);
app.use("/api/client-portal", requireAuth, clientPortalRoutes);
app.use("/api/notifications", requireAuth, notificationRoutes);
app.use("/api/admin", requireAuth, adminRoutes);
app.use("/api/consultants", requireAuth, consultantRoutes);
const staffUser = requireRole("admin", "consultant", "frontdesk");
const leadUser = requireRole("admin", "consultant", "frontdesk");
app.use("/api/search", requireAuth, leadUser, globalSearchRoutes);
app.use(
  "/api/dashboard",
  requireAuth,
  staffUser,
  requirePortalPage("dashboard"),
  dashboardRoutes,
);
// Distinct path — /api/payments belongs to the legacy Payment CRUD below,
// which Cases.jsx/CaseProfile.jsx still consume with an array response.
app.use(
  "/api/payments-overview",
  requireAuth,
  staffUser,
  requirePortalPage("payments"),
  requirePortalCapability("financialData"),
  paymentsOverviewRoutes,
);
app.use(
  "/api/leads",
  requireAuth,
  leadUser,
  requireAnyPortalPage("leads", "leadIntake"),
  leadRoutes,
);
app.use(
  "/api/call-history",
  requireAuth,
  leadUser,
  requirePortalPage("leads"),
  callHistoryRoutes,
);
app.use(
  "/api/twilio-calls",
  requireAuth,
  leadUser,
  requirePortalPage("leads"),
  twilioCallRoutes,
);
app.use(
  "/api/clients",
  requireAuth,
  staffUser,
  requirePortalPage("clients"),
  clientRoutes,
);
app.use(
  "/api/cases",
  requireAuth,
  staffUser,
  requirePortalPage("cases"),
  caseRoutes,
);
app.use(
  "/api/case-roles",
  requireAuth,
  staffUser,
  requirePortalPage("cases"),
  caseRoleRoutes,
);
app.use(
  "/api/incentive-plans",
  requireAuth,
  staffUser,
  // Admin-only regardless (enforced inside incentivePlanRoutes) — gated on
  // "incentives" for the same reason the read APIs below are, now that page
  // exists.
  requirePortalPage("incentives"),
  incentivePlanRoutes,
);
app.use(
  "/api/incentives",
  requireAuth,
  staffUser,
  // Lets admins control per-person visibility the same way every other
  // page does, via PortalAccessSettingsPanel.
  requirePortalPage("incentives"),
  incentiveRoutes,
);
app.use(
  "/api/payment-schedules",
  requireAuth,
  staffUser,
  requirePortalArea({
    pages: ["payments"],
    caseTabs: ["billing"],
    capabilities: ["financialData"],
  }),
  paymentScheduleRoutes,
);
app.use(
  "/api/fee-categories",
  requireAuth,
  staffUser,
  requirePortalArea({
    pages: ["payments"],
    caseTabs: ["billing"],
    capabilities: ["financialData"],
  }),
  feeCategoryRoutes,
);
app.use(
  "/api/case-billing-retainer",
  requireAuth,
  staffUser,
  requirePortalArea({
    caseTabs: ["billing"],
    capabilities: ["financialData"],
  }),
  caseBillingRetainerRoutes,
);
app.use(
  "/api/billing-settings",
  requireAuth,
  staffUser,
  requirePortalArea({
    pages: ["payments"],
    caseTabs: ["billing"],
    capabilities: ["financialData"],
  }),
  agencyBillingSettingsRoutes,
);
app.use(
  "/api/case-easy-import",
  requireAuth,
  leadUser,
  requirePortalPage("caseEasyImport"),
  caseEasyImportRoutes,
);
app.use(
  "/api/follow-ups",
  requireAuth,
  staffUser,
  requireAnyPortalPage("followUps", "cases"),
  followUpRoutes,
);
app.use("/api/users", requireAuth, requireRole("admin"), userRoutes);
app.use(
  "/api/notes",
  requireAuth,
  staffUser,
  requirePortalCapability("internalNotes"),
  noteRoutes,
);
app.use(
  "/api/payments",
  requireAuth,
  staffUser,
  requirePortalArea({
    pages: ["payments"],
    caseTabs: ["billing"],
    capabilities: ["financialData"],
  }),
  paymentRoutes,
);
app.use(
  "/api/client-documents",
  requireAuth,
  staffUser,
  requirePortalArea({ pages: ["documents"], caseTabs: ["documents"] }),
  clientDocumentRoutes,
);
app.use(
  "/api/document-templates",
  requireAuth,
  staffUser,
  requirePortalArea({ pages: ["documents"], caseTabs: ["documents"] }),
  documentTemplateRoutes,
);
app.use(
  "/api/workflow-templates",
  requireAuth,
  staffUser,
  requirePortalArea({ caseTabs: ["tasks"] }),
  workflowTemplateRoutes,
);
app.use(
  "/api/activity-logs",
  requireAuth,
  staffUser,
  requirePortalPage("cases"),
  activityLogRoutes,
);
app.use(
  "/api/shared-library",
  requireAuth,
  staffUser,
  requirePortalArea({ pages: ["documents"], caseTabs: ["documents"] }),
  sharedLibraryRoutes,
);
app.use(
  "/api/written-documents",
  requireAuth,
  staffUser,
  requirePortalArea({
    pages: ["documents"],
    caseTabs: ["documents", "agreementsLetters"],
  }),
  writtenDocumentRoutes,
);
app.use(
  "/api/case-forms",
  requireAuth,
  staffUser,
  requirePortalArea({ caseTabs: ["forms"] }),
  caseFormRoutes,
);
app.use(
  "/api/form-templates",
  requireAuth,
  staffUser,
  requirePortalArea({ caseTabs: ["forms"] }),
  agencyFormTemplateRoutes,
);
app.use(
  "/api/correspondence",
  requireAuth,
  staffUser,
  requirePortalArea({ caseTabs: ["agreementsLetters"] }),
  correspondenceRoutes,
);
app.use(
  "/api/appointments",
  requireAuth,
  staffUser,
  requirePortalArea({ pages: ["calendar"], caseTabs: ["appointments"] }),
  appointmentRoutes,
);
app.use(
  "/api/booking",
  requireAuth,
  leadUser,
  requirePortalPage("calendar"),
  bookingRoutes,
);
app.use(
  "/api/communications",
  requireAuth,
  staffUser,
  requirePortalArea({ caseTabs: ["communication"] }),
  communicationRoutes,
);
app.use("/api/ai", requireAuth, staffUser, aiRoutes);
app.use("/api/support", requireAuth, staffUser, supportRoutes);
app.use("/api/internal-chat", requireAuth, staffUser, internalChatRoutes);
app.use("/api/workload", requireAuth, staffUser, workloadRoutes);
app.use("/api/settings", requireAuth, requireRole("admin"), settingsRoutes);

app.use(notFoundHandler);
app.use(errorHandler);

function onListening() {
  logger.info("server.started", {
    port,
    environment: process.env.NODE_ENV || "development",
  });
  if (!process.env.QBO_WEBHOOK_VERIFIER_TOKEN) {
    // Every connected agency's Intuit webhook silently rejects with 401
    // when this is unset — there's no other startup-time signal, so this
    // is the only chance to notice before a payment/refund's confirmation
    // quietly falls back to the slower reconciliation-only path.
    logger.warn("server.qbo_webhook_verifier_token_missing", {
      detail:
        "QBO_WEBHOOK_VERIFIER_TOKEN is not set — all QuickBooks webhook deliveries will be rejected with 401 until it matches the token registered in the Intuit developer dashboard.",
    });
  }
  if (!zoomConfigured()) {
    logger.warn("server.zoom_not_configured", {
      detail:
        "Zoom booking is unavailable until ZOOM_CLIENT_ID, ZOOM_CLIENT_SECRET, ZOOM_REDIRECT_URI, ZOOM_WEBHOOK_SECRET_TOKEN, and MAIL_SETTINGS_ENCRYPTION_KEY are all configured.",
    });
  }
  startFormRevisionMonitor();
  startCommunicationOutboxWorker();
  startInboundMailSync();
  startCommunicationMaintenance();
  startLeadIntakeWorker();
  startLeadReactivationWorker();
  startLeadStaleOutreachWorker();
  startLeadOverdueAlertWorker();
  startWorkloadZeroActivityWorker();
  startBookingReminderWorker();
  startPaymentScheduleWorker();
  startPaymentHoldExpiryWorker();
  startQuickBooksWebhookWorker();
  startAppointmentMeetingWorker();
  startZoomConnectionMaintenance();
  startNotificationScheduler();
  startNotificationDeliveryWorker();
  startAutomatedReminderWorker();
  startCaseInformationDriftDetector();
  startAppointmentNoShowWorker();
  startIncentiveRetryWorker();
}

// On a nodemon restart the outgoing process's listening socket can still be
// tearing down at the OS level for a brief moment after Node reports it has
// exited (observed on macOS), so the incoming process's first bind attempt
// can lose that race even though nothing is genuinely wrong. Rather than
// crash and leave nodemon sitting there until another file save, retry the
// bind a few times — this is almost always resolved within one tick.
let server;
function startServer(attemptsLeft = 10) {
  server = app.listen(port, onListening);
  server.on("error", (error) => {
    if (error.code === "EADDRINUSE" && attemptsLeft > 0) {
      logger.warn("server.port_in_use_retrying", { port, attemptsLeft });
      setTimeout(() => startServer(attemptsLeft - 1), 300);
    } else {
      logger.error("server.listen_failed", { port, error: error.message });
      process.exit(1);
    }
  });
}
startServer();

let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info("server.shutdown", { signal });
  stopFormRevisionMonitor();
  stopCommunicationOutboxWorker();
  stopInboundMailSync();
  stopCommunicationMaintenance();
  stopLeadIntakeWorker();
  stopLeadReactivationWorker();
  stopLeadStaleOutreachWorker();
  stopLeadOverdueAlertWorker();
  stopWorkloadZeroActivityWorker();
  stopBookingReminderWorker();
  stopPaymentScheduleWorker();
  stopPaymentHoldExpiryWorker();
  stopQuickBooksWebhookWorker();
  stopAppointmentMeetingWorker();
  stopZoomConnectionMaintenance();
  stopNotificationScheduler();
  stopNotificationDeliveryWorker();
  stopAutomatedReminderWorker();
  stopCaseInformationDriftDetector();
  stopAppointmentNoShowWorker();
  stopIncentiveRetryWorker();
  (server || { close: (cb) => cb() }).close(async () => {
    await prisma.$disconnect().catch(() => {});
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));
// nodemon's default restart signal — without a handler here the process
// still terminates (Node's default SIGUSR2 disposition), but skips worker
// cleanup and the close(port) happens implicitly rather than deterministically,
// which is what left the next restart racing the old process for the port.
process.once("SIGUSR2", () => void shutdown("SIGUSR2"));
