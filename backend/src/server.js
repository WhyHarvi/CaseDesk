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
import globalSearchRoutes from "./routes/globalSearchRoutes.js";
import paymentsOverviewRoutes from "./routes/paymentsOverviewRoutes.js";
import documentTemplateRoutes from "./routes/documentTemplateRoutes.js";
import followUpRoutes from "./routes/followUpRoutes.js";
import requireAuth from "./middleware/authMiddleware.js";
import { requireRole } from "./middleware/authorization.js";
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
import quickbooksRoutes from "./routes/quickbooksRoutes.js";
import quickbooksWebhookRoutes from "./routes/quickbooksWebhookRoutes.js";
import paymentScheduleRoutes from "./routes/paymentScheduleRoutes.js";
import caseEasyImportRoutes from "./routes/caseEasyImportRoutes.js";
import { startBookingReminderWorker, stopBookingReminderWorker } from "./services/bookingNotificationService.js";
import { startPaymentScheduleWorker, stopPaymentScheduleWorker } from "./services/paymentScheduleService.js";
import { startPaymentHoldExpiryWorker, stopPaymentHoldExpiryWorker } from "./services/bookingPaymentHoldService.js";
import { startQuickBooksWebhookWorker, stopQuickBooksWebhookWorker } from "./services/quickbooksWebhookService.js";
import { startCaseInformationDriftDetector, stopCaseInformationDriftDetector } from "./services/caseInformationDriftDetector.js";
import communicationRoutes from "./routes/communicationRoutes.js";
import communicationWebhookRoutes from "./routes/communicationWebhookRoutes.js";
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
import { startLeadIntakeWorker, stopLeadIntakeWorker } from "./modules/leads/lead.intake.worker.js";
import portalRoutes from "./routes/portalRoutes.js";
import clientPortalRoutes from "./routes/clientPortalRoutes.js";
import notificationRoutes from "./routes/notificationRoutes.js";
import { startNotificationScheduler, stopNotificationScheduler } from "./services/notificationScheduler.js";
import { startNotificationDeliveryWorker, stopNotificationDeliveryWorker } from "./services/notificationDeliveryService.js";
import { startAutomatedReminderWorker, stopAutomatedReminderWorker } from "./services/automatedReminderService.js";
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
import { requestContext, secureHeaders } from "./middleware/productionSecurity.js";
import { logger } from "./services/logger.js";

dotenv.config();

const app = express();
const port = Number(process.env.PORT) || 5000;
app.set("trust proxy", Number(process.env.TRUST_PROXY_HOPS) || 1);
app.disable("x-powered-by");
app.use(requestContext);
app.use(secureHeaders);

app.use(
  cors({
    origin: String(process.env.FRONTEND_URL || "http://localhost:5173").split(",").map((item) => item.trim()),
    // Let browsers reuse the preflight response instead of sending OPTIONS
    // before every request (Chrome caps this at 2h, Firefox at 24h).
    maxAge: 86400,
  }),
);
app.use(express.json({ limit: process.env.JSON_BODY_LIMIT || "1mb", verify: (req, _res, buffer) => { req.rawBody = Buffer.from(buffer); } }));

app.use((req, res, next) => {
  if (!["POST", "PUT", "PATCH", "DELETE"].includes(req.method)) return next();
  res.on("finish", () => {
    if (res.statusCode < 400 && req.auth?.agencyId) invalidateDashboardCache(req.auth.agencyId);
  });
  return next();
});

app.get("/api/health/live", (_req, res) => res.json({ status: "ok" }));
app.get("/api/health", async (req, res, next) => {
  try { await prisma.$queryRaw`SELECT 1`; res.json({ status: "ok", database: "connected", requestId: req.requestId }); }
  catch (error) { next(Object.assign(error, { statusCode: 503, code: "DATABASE_UNAVAILABLE" })); }
});

app.use("/api/auth", authRoutes);
app.use("/api/account", requireAuth, accountSettingsRoutes);
app.use("/api/onboarding", onboardingRoutes);
app.use("/api/communications/webhooks", communicationWebhookRoutes);
app.use("/api/client-communication", clientCommunicationRoutes);
app.use("/api/public/lead-intake", leadPublicRoutes);
app.use("/api/public/booking", publicBookingRoutes);
app.use("/api/quickbooks", quickbooksRoutes);
app.use("/api/quickbooks/webhook", quickbooksWebhookRoutes);
app.use("/api/mailboxes", personalMailboxRoutes);
app.use("/api/lead-connectors/website", leadWebsiteRoutes);
app.use("/api/lead-connectors", leadProviderRoutes);
app.use("/api/portal", requireAuth, portalRoutes);
app.use("/api/client-portal", requireAuth, clientPortalRoutes);
app.use("/api/notifications", requireAuth, notificationRoutes);
app.use("/api/admin", requireAuth, adminRoutes);
app.use("/api/consultants", requireAuth, consultantRoutes);
const internalUser = requireRole("admin", "consultant");
const leadUser = requireRole("admin", "consultant", "frontdesk");
app.use("/api/search", requireAuth, leadUser, globalSearchRoutes);
app.use("/api/dashboard", requireAuth, internalUser, dashboardRoutes);
// Distinct path — /api/payments belongs to the legacy Payment CRUD below,
// which Cases.jsx/CaseProfile.jsx still consume with an array response.
app.use("/api/payments-overview", requireAuth, paymentsOverviewRoutes);
app.use("/api/leads", requireAuth, leadUser, leadRoutes);
app.use("/api/clients", requireAuth, internalUser, clientRoutes);
app.use("/api/cases", requireAuth, internalUser, caseRoutes);
app.use("/api/payment-schedules", requireAuth, internalUser, paymentScheduleRoutes);
app.use("/api/case-easy-import", requireAuth, leadUser, caseEasyImportRoutes);
app.use("/api/follow-ups", requireAuth, internalUser, followUpRoutes);
app.use("/api/users", requireAuth, requireRole("admin"), userRoutes);
app.use("/api/notes", requireAuth, internalUser, noteRoutes);
app.use("/api/payments", requireAuth, internalUser, paymentRoutes);
app.use("/api/client-documents", requireAuth, internalUser, clientDocumentRoutes);
app.use("/api/document-templates", requireAuth, internalUser, documentTemplateRoutes);
app.use("/api/workflow-templates", requireAuth, internalUser, workflowTemplateRoutes);
app.use("/api/activity-logs", requireAuth, internalUser, activityLogRoutes);
app.use("/api/shared-library", requireAuth, internalUser, sharedLibraryRoutes);
app.use("/api/written-documents", requireAuth, internalUser, writtenDocumentRoutes);
app.use("/api/case-forms", requireAuth, internalUser, caseFormRoutes);
app.use("/api/form-templates", requireAuth, internalUser, agencyFormTemplateRoutes);
app.use("/api/correspondence", requireAuth, internalUser, correspondenceRoutes);
app.use("/api/appointments", requireAuth, internalUser, appointmentRoutes);
app.use("/api/booking", requireAuth, leadUser, bookingRoutes);
app.use("/api/communications", requireAuth, internalUser, communicationRoutes);
app.use("/api/settings", requireAuth, requireRole("admin"), settingsRoutes);

app.use(notFoundHandler);
app.use(errorHandler);

const server = app.listen(port, () => {
  logger.info("server.started", { port, environment: process.env.NODE_ENV || "development" });
  if (!process.env.QBO_WEBHOOK_VERIFIER_TOKEN) {
    // Every connected agency's Intuit webhook silently rejects with 401
    // when this is unset — there's no other startup-time signal, so this
    // is the only chance to notice before a payment/refund's confirmation
    // quietly falls back to the slower reconciliation-only path.
    logger.warn("server.qbo_webhook_verifier_token_missing", {
      detail: "QBO_WEBHOOK_VERIFIER_TOKEN is not set — all QuickBooks webhook deliveries will be rejected with 401 until it matches the token registered in the Intuit developer dashboard.",
    });
  }
  startFormRevisionMonitor();
  startCommunicationOutboxWorker();
  startInboundMailSync();
  startCommunicationMaintenance();
  startLeadIntakeWorker();
  startBookingReminderWorker();
  startPaymentScheduleWorker();
  startPaymentHoldExpiryWorker();
  startQuickBooksWebhookWorker();
  startNotificationScheduler();
  startNotificationDeliveryWorker();
  startAutomatedReminderWorker();
  startCaseInformationDriftDetector();
});

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
  stopBookingReminderWorker();
  stopPaymentScheduleWorker();
  stopPaymentHoldExpiryWorker();
  stopQuickBooksWebhookWorker();
  stopNotificationScheduler();
  stopNotificationDeliveryWorker();
  stopAutomatedReminderWorker();
  stopCaseInformationDriftDetector();
  server.close(async () => {
    await prisma.$disconnect().catch(() => {});
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));
