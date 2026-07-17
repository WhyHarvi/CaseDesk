import { lazy, Suspense } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { AdminRoute, HomeRedirect, InternalRoute, PortalRoute } from "../auth/AuthRoutes";
import MainLayout from "../layouts/MainLayout";
import CaseProfile from "../pages/CaseProfile";
import Cases from "../pages/Cases";
import ClientChatPortal from "../pages/ClientChatPortal";
import ClientProfile from "../pages/ClientProfile";
import Clients from "../pages/Clients";
import TeamMembers from "../pages/TeamMembers";
import Dashboard from "../pages/Dashboard";
import Documents from "../pages/Documents";
import FollowUps from "../pages/FollowUps";
import Login from "../pages/Login";
import Payments from "../pages/Payments";
import Settings from "../pages/Settings";
import ClientPortalLayout from "../components/client-portal/ClientPortalLayout";
import ClientPortalHome from "../pages/client-portal/ClientPortalHome";
import ClientPortalDocuments from "../pages/client-portal/ClientPortalDocuments";
import ClientPortalQuestionnaires from "../pages/client-portal/ClientPortalQuestionnaires";
import ClientPortalChat from "../pages/client-portal/ClientPortalChat";
import ClientPortalPayments from "../pages/client-portal/ClientPortalPayments";
import ClientPortalProfile from "../pages/client-portal/ClientPortalProfile";
import ClientPortalHelp from "../pages/client-portal/ClientPortalHelp";
import Workload from "../pages/Workload";
import ChangePassword from "../pages/ChangePassword";
import AcceptInvite from "../pages/AcceptInvite";
import ResetPassword from "../pages/ResetPassword";
import LeadsPage from "../modules/leads/pages/LeadsPage";
import LeadDashboardPage from "../modules/leads/pages/LeadDashboardPage";
import LeadReportsPage from "../modules/leads/pages/LeadReportsPage";
import LeadIntakePage from "../modules/leads/pages/LeadIntakePage";
import PublicLeadIntakePage from "../modules/leads/pages/PublicLeadIntakePage";

const DocumentComposer = lazy(() => import("../pages/DocumentComposer"));
function WriterPage() { return <Suspense fallback={<div className="flex h-screen items-center justify-center text-sm text-slate-500">Opening CaseDesk Writer…</div>}><DocumentComposer /></Suspense>; }
function Internal({ children, allowFrontdesk = false, ...layout }) { return <InternalRoute allowFrontdesk={allowFrontdesk}><MainLayout {...layout}>{children}</MainLayout></InternalRoute>; }
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
    <Route path="/client-chat/:token" element={<ClientChatPortal />} />
    <Route path="/public/intake/:publicToken" element={<PublicLeadIntakePage />} />
    <Route path="/portal/*" element={<Navigate to="/client-portal" replace />} />
    <Route path="/client-portal" element={<PortalRoute><ClientPortalLayout /></PortalRoute>}>
      <Route index element={<ClientPortalHome />} />
      <Route path="documents" element={<ClientPortalDocuments />} />
      <Route path="questionnaires" element={<ClientPortalQuestionnaires />} />
      <Route path="chat" element={<ClientPortalChat />} />
      <Route path="payments" element={<ClientPortalPayments />} />
      <Route path="profile" element={<ClientPortalProfile />} />
      <Route path="help" element={<ClientPortalHelp />} />
    </Route>
    <Route path="/app/dashboard" element={<Internal><Dashboard /></Internal>} />
    <Route path="/leads" element={<Internal allowFrontdesk><LeadsPage /></Internal>} />
    <Route path="/lead-dashboard" element={<AdminRoute><MainLayout><LeadDashboardPage /></MainLayout></AdminRoute>} />
    <Route path="/lead-reports" element={<AdminRoute><MainLayout><LeadReportsPage /></MainLayout></AdminRoute>} />
    <Route path="/lead-intake" element={<Internal allowFrontdesk><LeadIntakePage /></Internal>} />
    <Route path="/app/leads" element={<Navigate to="/leads" replace />} />
    <Route path="/app/clients" element={<Internal><Clients /></Internal>} />
    <Route path="/app/clients/:id" element={<Internal><ClientProfile /></Internal>} />
    <Route path="/app/cases" element={<Internal><Cases /></Internal>} />
    <Route path="/app/cases/:id" element={<Internal><CaseProfile /></Internal>} />
    <Route path="/app/cases/:id/documents/new" element={<Internal hideTopBar lockContentScroll flushContent><WriterPage /></Internal>} />
    <Route path="/app/cases/:id/documents/:writtenDocumentId/edit" element={<Internal hideTopBar lockContentScroll flushContent><WriterPage /></Internal>} />
    <Route path="/app/follow-ups" element={<Internal><FollowUps /></Internal>} />
    <Route path="/app/documents" element={<Internal><Documents /></Internal>} />
    <Route path="/app/payments" element={<AdminRoute><MainLayout><Payments /></MainLayout></AdminRoute>} />
    <Route path="/app/team-members" element={<AdminRoute><MainLayout><TeamMembers /></MainLayout></AdminRoute>} />
    <Route path="/app/consultants" element={<Navigate to="/app/team-members" replace />} />
    <Route path="/app/workload" element={<Internal><Workload /></Internal>} />
    <Route path="/app/settings" element={<Internal allowFrontdesk hideTopBar lockContentScroll flushContent><Settings /></Internal>} />
    <Route path="/clients/:id" element={<Internal><ClientProfile /></Internal>} />
    <Route path="/cases/:id" element={<Internal><CaseProfile /></Internal>} />
    <Route path="/cases/:id/documents/new" element={<Internal hideTopBar lockContentScroll flushContent><WriterPage /></Internal>} />
    <Route path="/cases/:id/documents/:writtenDocumentId/edit" element={<Internal hideTopBar lockContentScroll flushContent><WriterPage /></Internal>} />
    {['/dashboard','/clients','/cases','/follow-ups','/documents','/payments','/settings'].map((path) => <Route key={path} path={`${path}/*`} element={<Legacy path={path} />} />)}
    <Route path="*" element={<HomeRedirect />} />
  </Routes>;
}
