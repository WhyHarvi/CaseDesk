import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "./AuthContext";

export function AuthLoading() {
  return <div className="flex min-h-screen items-center justify-center bg-slate-50"><div className="text-center"><div className="mx-auto h-9 w-9 animate-spin rounded-full border-4 border-sky-100 border-t-sky-600" /><p className="mt-4 text-sm font-medium text-slate-500">Opening CaseDesk…</p></div></div>;
}

export function homePathForRole(role) {
  if (role === "client") return "/client-portal";
  if (role === "frontdesk") return "/leads";
  return "/app/dashboard";
}

export function HomeRedirect() {
  const { loading, isAuthenticated, role, appUser } = useAuth();
  if (loading) return <AuthLoading />;
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  if (appUser?.mustChangePassword) return <Navigate to="/change-password" replace />;
  return <Navigate to={homePathForRole(role)} replace />;
}

export function InternalRoute({ children, allowFrontdesk = false }) {
  const { loading, isAuthenticated, role, appUser } = useAuth();
  const location = useLocation();
  if (loading) return <AuthLoading />;
  if (!isAuthenticated) return <Navigate to="/login" state={{ from: location }} replace />;
  if (appUser?.mustChangePassword) return <Navigate to="/change-password" replace />;
  if (role === "client") return <Navigate to="/client-portal" replace />;
  if (role === "frontdesk" && !allowFrontdesk) return <Navigate to="/leads" replace />;
  return children;
}

export function PortalRoute({ children }) {
  const { loading, isAuthenticated, role, appUser } = useAuth();
  const location = useLocation();
  if (loading) return <AuthLoading />;
  if (!isAuthenticated) return <Navigate to="/login" state={{ from: location }} replace />;
  if (appUser?.mustChangePassword) return <Navigate to="/change-password" replace />;
  if (role !== "client") return <Navigate to={homePathForRole(role)} replace />;
  return children;
}

export function AdminRoute({ children }) {
  const { loading, isAuthenticated, role } = useAuth();
  if (loading) return <AuthLoading />;
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  if (role !== "admin") return <Navigate to={homePathForRole(role)} replace />;
  return children;
}
