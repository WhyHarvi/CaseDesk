import { Suspense } from "react";
import { Navigate, Outlet, Route, Routes } from "react-router-dom";
import {
  AdminRoute,
  HomeRedirect,
  InternalRoute,
  PortalAccessRoute,
  PortalRoute,
} from "../auth/AuthRoutes";
import MainLayout from "../layouts/MainLayout";
import Login from "../pages/Login";
import ClientPortalLayout from "../components/client-portal/ClientPortalLayout";
import ChangePassword from "../pages/ChangePassword";
import AcceptInvite from "../pages/AcceptInvite";
import ResetPassword from "../pages/ResetPassword";
import { lazyWithRetry } from "../services/lazyWithRetry";

const CaseProfile = lazyWithRetry(
  () => import("../pages/CaseProfile"),
  "case-profile",
);
const Cases = lazyWithRetry(() => import("../pages/Cases"), "cases");
const ClientChatPortal = lazyWithRetry(
  () => import("../pages/ClientChatPortal"),
  "client-chat",
);
const ClientProfile = lazyWithRetry(
  () => import("../pages/ClientProfile"),
  "client-profile",
);
const Clients = lazyWithRetry(() => import("../pages/Clients"), "clients");
const TeamMembers = lazyWithRetry(
  () => import("../pages/TeamMembers"),
  "team-members",
);
const CaseEasyImport = lazyWithRetry(
  () => import("../pages/CaseEasyImport"),
  "case-easy-import",
);
const Dashboard = lazyWithRetry(
  () => import("../pages/Dashboard"),
  "dashboard",
);
const Documents = lazyWithRetry(
  () => import("../pages/Documents"),
  "documents",
);
const FollowUps = lazyWithRetry(
  () => import("../pages/FollowUps"),
  "follow-ups",
);
const Payments = lazyWithRetry(() => import("../pages/Payments"), "payments");
const Incentives = lazyWithRetry(() => import("../pages/Incentives"), "incentives");
const Settings = lazyWithRetry(() => import("../pages/Settings"), "settings");
const ClientPortalHome = lazyWithRetry(
  () => import("../pages/client-portal/ClientPortalHome"),
  "portal-home",
);
const ClientPortalDocuments = lazyWithRetry(
  () => import("../pages/client-portal/ClientPortalDocuments"),
  "portal-documents",
);
const ClientPortalQuestionnaires = lazyWithRetry(
  () => import("../pages/client-portal/ClientPortalQuestionnaires"),
  "portal-questionnaires",
);
const ClientPortalChat = lazyWithRetry(
  () => import("../pages/client-portal/ClientPortalChat"),
  "portal-chat",
);
const ClientPortalPayments = lazyWithRetry(
  () => import("../pages/client-portal/ClientPortalPayments"),
  "portal-payments",
);
const ClientPortalAppointments = lazyWithRetry(
  () => import("../pages/client-portal/ClientPortalAppointments"),
  "portal-appointments",
);
const ClientPortalProfile = lazyWithRetry(
  () => import("../pages/client-portal/ClientPortalProfile"),
  "portal-profile",
);
const ClientPortalHelp = lazyWithRetry(
  () => import("../pages/client-portal/ClientPortalHelp"),
  "portal-help",
);
const ClientPortalAccountSettings = lazyWithRetry(
  () => import("../pages/client-portal/ClientPortalAccountSettings"),
  "portal-settings",
);
const Workload = lazyWithRetry(() => import("../pages/Workload"), "workload");
const CalendarPage = lazyWithRetry(
  () => import("../pages/CalendarPage"),
  "calendar",
);
const PublicBookingPage = lazyWithRetry(
  () => import("../pages/PublicBookingPage"),
  "public-booking",
);
const ManageBookingPage = lazyWithRetry(
  () => import("../pages/ManageBookingPage"),
  "manage-booking",
);
const PublicRetainerSignPage = lazyWithRetry(
  () => import("../pages/PublicRetainerSignPage"),
  "public-retainer-sign",
);
const LeadsPage = lazyWithRetry(
  () => import("../modules/leads/pages/LeadsPage"),
  "leads",
);
const LeadDashboardPage = lazyWithRetry(
  () => import("../modules/leads/pages/LeadDashboardPage"),
  "lead-dashboard",
);
const LeadReportsPage = lazyWithRetry(
  () => import("../modules/leads/pages/LeadReportsPage"),
  "lead-reports",
);
const LeadIntakePage = lazyWithRetry(
  () => import("../modules/leads/pages/LeadIntakePage"),
  "lead-intake",
);
const PublicLeadIntakePage = lazyWithRetry(
  () => import("../modules/leads/pages/PublicLeadIntakePage"),
  "public-lead-intake",
);
const DocumentComposer = lazyWithRetry(
  () => import("../pages/DocumentComposer"),
  "document-composer",
);
const PrivacyPolicy = lazyWithRetry(
  () => import("../pages/legal/PrivacyPolicy"),
  "privacy-policy",
);
const TermsOfService = lazyWithRetry(
  () => import("../pages/legal/TermsOfService"),
  "terms-of-service",
);

function RouteFallback() {
  return (
    <div className="flex min-h-56 items-center justify-center">
      <div className="text-center">
        <div className="mx-auto h-8 w-8 animate-spin rounded-full border-4 border-sky-100 border-t-sky-600" />
        <p className="mt-3 text-sm font-medium text-slate-500">
          Opening workspace…
        </p>
      </div>
    </div>
  );
}
function Deferred({ children }) {
  return <Suspense fallback={<RouteFallback />}>{children}</Suspense>;
}
function WriterPage() {
  return (
    <Suspense
      fallback={
        <div className="flex h-screen items-center justify-center text-sm text-slate-500">
          Opening CaseDesk Writer…
        </div>
      }
    >
      <DocumentComposer />
    </Suspense>
  );
}
function AppLayout() {
  return (
    <InternalRoute allowFrontdesk>
      <MainLayout>
        <Suspense fallback={<RouteFallback />}>
          <Outlet />
        </Suspense>
      </MainLayout>
    </InternalRoute>
  );
}
function Access({ page, children }) {
  return <PortalAccessRoute page={page}>{children}</PortalAccessRoute>;
}
function Internal({ children, allowFrontdesk = false }) {
  return (
    <InternalRoute allowFrontdesk={allowFrontdesk}>{children}</InternalRoute>
  );
}
function Legacy({ path }) {
  return (
    <InternalRoute allowFrontdesk>
      <Navigate to={`/app${path}`} replace />
    </InternalRoute>
  );
}

export default function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<HomeRedirect />} />
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Navigate to="/login" replace />} />
      <Route path="/auth/accept-invite" element={<AcceptInvite />} />
      <Route
        path="/auth/forgot-password"
        element={<Navigate to="/login?forgot=1" replace />}
      />
      <Route path="/auth/reset-password" element={<ResetPassword />} />
      <Route path="/change-password" element={<ChangePassword />} />
      <Route
        path="/legal/privacy"
        element={
          <Deferred>
            <PrivacyPolicy />
          </Deferred>
        }
      />
      <Route
        path="/legal/terms"
        element={
          <Deferred>
            <TermsOfService />
          </Deferred>
        }
      />
      <Route
        path="/client-chat/:token"
        element={
          <Deferred>
            <ClientChatPortal />
          </Deferred>
        }
      />
      <Route
        path="/public/intake/:publicToken"
        element={
          <Deferred>
            <PublicLeadIntakePage />
          </Deferred>
        }
      />
      <Route
        path="/book/manage/:manageToken"
        element={
          <Deferred>
            <ManageBookingPage />
          </Deferred>
        }
      />
      <Route
        path="/b/:token/manage/:manageToken"
        element={
          <Deferred>
            <ManageBookingPage />
          </Deferred>
        }
      />
      <Route
        path="/retainer/:manageToken"
        element={
          <Deferred>
            <PublicRetainerSignPage />
          </Deferred>
        }
      />
      <Route
        path="/b/:token"
        element={
          <Deferred>
            <PublicBookingPage />
          </Deferred>
        }
      />
      <Route
        path="/book/:token"
        element={
          <Deferred>
            <PublicBookingPage />
          </Deferred>
        }
      />
      <Route
        path="/portal/*"
        element={<Navigate to="/client-portal" replace />}
      />
      <Route
        path="/client-portal"
        element={
          <PortalRoute>
            <ClientPortalLayout />
          </PortalRoute>
        }
      >
        <Route
          index
          element={
            <Deferred>
              <ClientPortalHome />
            </Deferred>
          }
        />
        <Route
          path="documents"
          element={
            <Deferred>
              <ClientPortalDocuments />
            </Deferred>
          }
        />
        <Route
          path="questionnaires"
          element={
            <Deferred>
              <ClientPortalQuestionnaires />
            </Deferred>
          }
        />
        <Route
          path="chat"
          element={
            <Deferred>
              <ClientPortalChat />
            </Deferred>
          }
        />
        <Route
          path="appointments"
          element={
            <Deferred>
              <ClientPortalAppointments />
            </Deferred>
          }
        />
        <Route
          path="payments"
          element={
            <Deferred>
              <ClientPortalPayments />
            </Deferred>
          }
        />
        <Route
          path="profile"
          element={
            <Deferred>
              <ClientPortalProfile />
            </Deferred>
          }
        />
        <Route
          path="help"
          element={
            <Deferred>
              <ClientPortalHelp />
            </Deferred>
          }
        />
        <Route
          path="settings"
          element={
            <Deferred>
              <ClientPortalAccountSettings />
            </Deferred>
          }
        />
      </Route>
      <Route element={<AppLayout />}>
        <Route
          path="/app/dashboard"
          element={
            <Access page="dashboard">
              <Dashboard />
            </Access>
          }
        />
        <Route
          path="/leads"
          element={
            <Access page="leads">
              <LeadsPage />
            </Access>
          }
        />
        <Route
          path="/leads/review"
          element={
            <Access page="leads">
              <LeadsPage segment="IMPORT_REVIEW" />
            </Access>
          }
        />
        <Route
          path="/lead-dashboard"
          element={
            <AdminRoute>
              <LeadDashboardPage />
            </AdminRoute>
          }
        />
        <Route
          path="/lead-reports"
          element={
            <AdminRoute>
              <LeadReportsPage />
            </AdminRoute>
          }
        />
        <Route
          path="/lead-intake"
          element={
            <Access page="leadIntake">
              <LeadIntakePage />
            </Access>
          }
        />
        <Route path="/app/leads" element={<Navigate to="/leads" replace />} />
        <Route
          path="/app/clients"
          element={
            <Access page="clients">
              <Clients />
            </Access>
          }
        />
        <Route
          path="/app/clients/:id"
          element={
            <Access page="clients">
              <ClientProfile />
            </Access>
          }
        />
        <Route
          path="/app/cases"
          element={
            <Access page="cases">
              <Cases />
            </Access>
          }
        />
        <Route
          path="/app/cases/:id"
          element={
            <Access page="cases">
              <CaseProfile />
            </Access>
          }
        />
        <Route
          path="/app/cases/:id/documents/new"
          element={
            <Access page="cases">
              <WriterPage />
            </Access>
          }
        />
        <Route
          path="/app/cases/:id/documents/:writtenDocumentId/edit"
          element={
            <Access page="cases">
              <WriterPage />
            </Access>
          }
        />
        <Route
          path="/app/follow-ups"
          element={
            <Access page="followUps">
              <FollowUps />
            </Access>
          }
        />
        <Route
          path="/app/calendar"
          element={
            <Access page="calendar">
              <CalendarPage />
            </Access>
          }
        />
        <Route
          path="/app/documents"
          element={
            <Access page="documents">
              <Documents />
            </Access>
          }
        />
        <Route
          path="/app/payments"
          element={
            <Access page="payments">
              <Payments />
            </Access>
          }
        />
        <Route
          path="/app/incentives"
          element={
            <Access page="incentives">
              <Incentives />
            </Access>
          }
        />
        <Route
          path="/app/team-members"
          element={
            <AdminRoute>
              <TeamMembers />
            </AdminRoute>
          }
        />
        <Route
          path="/app/case-easy-import"
          element={
            <Access page="caseEasyImport">
              <CaseEasyImport />
            </Access>
          }
        />
        <Route
          path="/app/consultants"
          element={<Navigate to="/app/team-members" replace />}
        />
        <Route
          path="/app/workload"
          element={
            <Access page="workload">
              <Workload />
            </Access>
          }
        />
        <Route
          path="/app/settings"
          element={
            <Internal allowFrontdesk>
              <Settings />
            </Internal>
          }
        />
        <Route
          path="/clients/:id"
          element={
            <Access page="clients">
              <ClientProfile />
            </Access>
          }
        />
        <Route
          path="/cases/:id"
          element={
            <Access page="cases">
              <CaseProfile />
            </Access>
          }
        />
        <Route
          path="/cases/:id/documents/new"
          element={
            <Access page="cases">
              <WriterPage />
            </Access>
          }
        />
        <Route
          path="/cases/:id/documents/:writtenDocumentId/edit"
          element={
            <Access page="cases">
              <WriterPage />
            </Access>
          }
        />
      </Route>
      {[
        "/dashboard",
        "/clients",
        "/cases",
        "/follow-ups",
        "/documents",
        "/payments",
        "/settings",
      ].map((path) => (
        <Route key={path} path={`${path}/*`} element={<Legacy path={path} />} />
      ))}
      <Route path="*" element={<HomeRedirect />} />
    </Routes>
  );
}
