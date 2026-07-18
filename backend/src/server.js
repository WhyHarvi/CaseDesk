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
import communicationRoutes from "./routes/communicationRoutes.js";
import communicationWebhookRoutes from "./routes/communicationWebhookRoutes.js";
import clientCommunicationRoutes from "./routes/clientCommunicationRoutes.js";
import settingsRoutes from "./routes/settingsRoutes.js";
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
  }),
);
app.use(express.json({ limit: process.env.JSON_BODY_LIMIT || "1mb", verify: (req, _res, buffer) => { req.rawBody = Buffer.from(buffer); } }));

app.get("/api/health/live", (_req, res) => res.json({ status: "ok" }));
app.get("/api/health", async (req, res, next) => {
  try { await prisma.$queryRaw`SELECT 1`; res.json({ status: "ok", database: "connected", requestId: req.requestId }); }
  catch (error) { next(Object.assign(error, { statusCode: 503, code: "DATABASE_UNAVAILABLE" })); }
});

app.use("/api/auth", authRoutes);
app.use("/api/onboarding", onboardingRoutes);
app.use("/api/communications/webhooks", communicationWebhookRoutes);
app.use("/api/client-communication", clientCommunicationRoutes);
app.use("/api/public/lead-intake", leadPublicRoutes);
app.use("/api/lead-connectors/website", leadWebsiteRoutes);
app.use("/api/lead-connectors", leadProviderRoutes);
app.use("/api/portal", requireAuth, portalRoutes);
app.use("/api/client-portal", requireAuth, clientPortalRoutes);
app.use("/api/notifications", requireAuth, notificationRoutes);
app.use("/api/admin", requireAuth, adminRoutes);
app.use("/api/consultants", requireAuth, consultantRoutes);
const internalUser = requireRole("admin", "consultant");
const leadUser = requireRole("admin", "consultant", "frontdesk");
app.use("/api/dashboard", requireAuth, internalUser, dashboardRoutes);
app.use("/api/leads", requireAuth, leadUser, leadRoutes);
app.use("/api/clients", requireAuth, internalUser, clientRoutes);
app.use("/api/cases", requireAuth, internalUser, caseRoutes);
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
  startFormRevisionMonitor();
  startCommunicationOutboxWorker();
  startInboundMailSync();
  startCommunicationMaintenance();
  startLeadIntakeWorker();
  startNotificationScheduler();
  startNotificationDeliveryWorker();
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
  stopNotificationScheduler();
  stopNotificationDeliveryWorker();
  server.close(async () => {
    await prisma.$disconnect().catch(() => {});
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));
