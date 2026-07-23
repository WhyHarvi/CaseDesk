import { lazy, Suspense } from "react";
import { Navigate, Outlet, Route, Routes } from "react-router-dom";
import { AdminRoute, HomeRedirect, InternalRoute, PortalRoute } from "../auth/AuthRoutes";
import MainLayout from "../layouts/MainLayout";
import Login from "../pages/Login";
import ClientPortalLayout from "../components/client-portal/ClientPortalLayout";
import ChangePassword from "../pages/ChangePassword";
import AcceptInvite from "../pages/AcceptInvite";
import ResetPassword from "../pages/ResetPassword";

const CaseProfile = lazy(() => import("../pages/CaseProfile"));
const Cases = lazy(() => import("../pages/Cases"));
const ClientChatPortal = lazy(() => import("../pages/ClientChatPortal"));
const ClientProfile = lazy(() => import("../pages/ClientProfile"));
const Clients = lazy(() => import("../pages/Clients"));
const TeamMembers = lazy(() => import("../pages/TeamMembers"));
const CaseEasyImport = lazy(() => import("../pages/CaseEasyImport"));
const Dashboard = lazy(() => import("../pages/Dashboard"));
const Documents = lazy(() => import("../pages/Documents"));
const FollowUps = lazy(() => import("../pages/FollowUps"));
const Payments = lazy(() => import("../pages/Payments"));
const Settings = lazy(() => import("../pages/Settings"));
const ClientPortalHome = lazy(() => import("../pages/client-portal/ClientPortalHome"));
const ClientPortalDocuments = lazy(() => import("../pages/client-portal/ClientPortalDocuments"));
const ClientPortalQuestionnaires = lazy(() => import("../pages/client-portal/ClientPortalQuestionnaires"));
const ClientPortalChat = lazy(() => import("../pages/client-portal/ClientPortalChat"));
const ClientPortalPayments = lazy(() => import("../pages/client-portal/ClientPortalPayments"));
const ClientPortalProfile = lazy(() => import("../pages/client-portal/ClientPortalProfile"));
const ClientPortalHelp = lazy(() => import("../pages/client-portal/ClientPortalHelp"));
const ClientPortalAccountSettings = lazy(() => import("../pages/client-portal/ClientPortalAccountSettings"));
const Workload = lazy(() => import("../pages/Workload"));
const CalendarPage = lazy(() => import("../pages/CalendarPage"));
const PublicBookingPage = lazy(() => import("../pages/PublicBookingPage"));
const ManageBookingPage = lazy(() => import("../pages/ManageBookingPage"));
const LeadsPage = lazy(() => import("../modules/leads/pages/LeadsPage"));
const LeadDashboardPage = lazy(() => import("../modules/leads/pages/LeadDashboardPage"));
const LeadReportsPage = lazy(() => import("../modules/leads/pages/LeadReportsPage"));
const LeadIntakePage = lazy(() => import("../modules/leads/pages/LeadIntakePage"));
const PublicLeadIntakePage = lazy(() => import("../modules/leads/pages/PublicLeadIntakePage"));
const DocumentComposer = lazy(() => import("../pages/DocumentComposer"));
const PrivacyPolicy = lazy(() => import("../pages/legal/PrivacyPolicy"));
const TermsOfService = lazy(() => import("../pages/legal/TermsOfService"));

function RouteFallback() { return <div className="flex min-h-56 items-center justify-center"><div className="text-center"><div className="mx-auto h-8 w-8 animate-spin rounded-full border-4 border-sky-100 border-t-sky-600" /><p className="mt-3 text-sm font-medium text-slate-500">Opening workspace…</p></div></div>; }
function Deferred({ children }) { return <Suspense fallback={<RouteFallback />}>{children}</Suspense>; }
function WriterPage() { return <Suspense fallback={<div className="flex h-screen items-center justify-center text-sm text-slate-500">Opening CaseDesk Writer…</div>}><DocumentComposer /></Suspense>; }
function AppLayout() { return <InternalRoute allowFrontdesk><MainLayout><Suspense fallback={<RouteFallback />}><Outlet /></Suspense></MainLayout></InternalRoute>; }
function StaffOnly({ children }) { return <InternalRoute>{children}</InternalRoute>; }
function Internal({ children, allowFrontdesk = false }) { return <InternalRoute allowFrontdesk={allowFrontdesk}>{children}</InternalRoute>; }
function Legacy({ path }) { return <InternalRoute><Navigate to={`/app${path}`} replace /></InternalRoute>; }

export default function AppRoutes() {
  return <Routes>
    <Route path="/" element={<HomeRedirect />} />
    <Route path="/login" element={<Login />} />
    <Route path="/register" element={<Navigate to="/login" replace />} />
    <Route path="/auth/accept-invite" element={<AcceptInvite />} />
    <Route path="/auth/forgot-password" element={<Navigate to="/login?forgot=1" replace />} />
    <Route path="/auth/reset-password" element={<ResetPassword />} />
    <Route path="/change-password" element={<ChangePassword />} />
    <Route path="/legal/privacy" element={<Deferred><PrivacyPolicy /></Deferred>} />
    <Route path="/legal/terms" element={<Deferred><TermsOfService /></Deferred>} />
    <Route path="/client-chat/:token" element={<Deferred><ClientChatPortal /></Deferred>} />
    <Route path="/public/intake/:publicToken" element={<Deferred><PublicLeadIntakePage /></Deferred>} />
    <Route path="/book/manage/:manageToken" element={<Deferred><ManageBookingPage /></Deferred>} />
    <Route path="/b/:token" element={<Deferred><PublicBookingPage /></Deferred>} />
    <Route path="/book/:token" element={<Deferred><PublicBookingPage /></Deferred>} />
    <Route path="/portal/*" element={<Navigate to="/client-portal" replace />} />
    <Route path="/client-portal" element={<PortalRoute><ClientPortalLayout /></PortalRoute>}>
      <Route index element={<Deferred><ClientPortalHome /></Deferred>} />
      <Route path="documents" element={<Deferred><ClientPortalDocuments /></Deferred>} />
      <Route path="questionnaires" element={<Deferred><ClientPortalQuestionnaires /></Deferred>} />
      <Route path="chat" element={<Deferred><ClientPortalChat /></Deferred>} />
      <Route path="payments" element={<Deferred><ClientPortalPayments /></Deferred>} />
      <Route path="profile" element={<Deferred><ClientPortalProfile /></Deferred>} />
      <Route path="help" element={<Deferred><ClientPortalHelp /></Deferred>} />
      <Route path="settings" element={<Deferred><ClientPortalAccountSettings /></Deferred>} />
    </Route>
    <Route element={<AppLayout />}>
      <Route path="/app/dashboard" element={<StaffOnly><Dashboard /></StaffOnly>} />
      <Route path="/leads" element={<LeadsPage />} />
      <Route path="/lead-dashboard" element={<AdminRoute><LeadDashboardPage /></AdminRoute>} />
      <Route path="/lead-reports" element={<AdminRoute><LeadReportsPage /></AdminRoute>} />
      <Route path="/lead-intake" element={<LeadIntakePage />} />
      <Route path="/app/leads" element={<Navigate to="/leads" replace />} />
      <Route path="/app/clients" element={<StaffOnly><Clients /></StaffOnly>} />
      <Route path="/app/clients/:id" element={<StaffOnly><ClientProfile /></StaffOnly>} />
      <Route path="/app/cases" element={<StaffOnly><Cases /></StaffOnly>} />
      <Route path="/app/cases/:id" element={<StaffOnly><CaseProfile /></StaffOnly>} />
      <Route path="/app/cases/:id/documents/new" element={<StaffOnly><WriterPage /></StaffOnly>} />
      <Route path="/app/cases/:id/documents/:writtenDocumentId/edit" element={<StaffOnly><WriterPage /></StaffOnly>} />
      <Route path="/app/follow-ups" element={<StaffOnly><FollowUps /></StaffOnly>} />
      <Route path="/app/calendar" element={<CalendarPage />} />
      <Route path="/app/documents" element={<StaffOnly><Documents /></StaffOnly>} />
      <Route path="/app/payments" element={<AdminRoute><Payments /></AdminRoute>} />
      <Route path="/app/team-members" element={<AdminRoute><TeamMembers /></AdminRoute>} />
      <Route path="/app/case-easy-import" element={<Internal allowFrontdesk><CaseEasyImport /></Internal>} />
      <Route path="/app/consultants" element={<Navigate to="/app/team-members" replace />} />
      <Route path="/app/workload" element={<StaffOnly><Workload /></StaffOnly>} />
      <Route path="/app/settings" element={<Internal allowFrontdesk><Settings /></Internal>} />
      <Route path="/clients/:id" element={<StaffOnly><ClientProfile /></StaffOnly>} />
      <Route path="/cases/:id" element={<StaffOnly><CaseProfile /></StaffOnly>} />
      <Route path="/cases/:id/documents/new" element={<StaffOnly><WriterPage /></StaffOnly>} />
      <Route path="/cases/:id/documents/:writtenDocumentId/edit" element={<StaffOnly><WriterPage /></StaffOnly>} />
    </Route>
    {['/dashboard','/clients','/cases','/follow-ups','/documents','/payments','/settings'].map((path) => <Route key={path} path={`${path}/*`} element={<Legacy path={path} />} />)}
    <Route path="*" element={<HomeRedirect />} />
  </Routes>;
}
