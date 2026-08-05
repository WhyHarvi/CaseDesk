import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "./AuthContext";
import { canAccessPage, homePathForAccess } from "./portalAccess";

export function AuthLoading() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50">
      <div className="text-center">
        <div className="mx-auto h-9 w-9 animate-spin rounded-full border-4 border-sky-100 border-t-sky-600" />
        <p className="mt-4 text-sm font-medium text-slate-500">
          Opening CaseDesk…
        </p>
      </div>
    </div>
  );
}

export function homePathForRole(role, permissions = {}) {
  return homePathForAccess(role, permissions);
}

export function HomeRedirect() {
  const { loading, accessReady, isAuthenticated, role, appUser, membership } = useAuth();
  if (loading || (isAuthenticated && !accessReady)) return <AuthLoading />;
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  if (appUser?.mustChangePassword)
    return <Navigate to="/change-password" replace />;
  return (
    <Navigate to={homePathForRole(role, membership?.permissions)} replace />
  );
}

export function InternalRoute({ children, allowFrontdesk = false }) {
  const { loading, isAuthenticated, role, appUser } = useAuth();
  const location = useLocation();
  if (loading) return <AuthLoading />;
  if (!isAuthenticated)
    return <Navigate to="/login" state={{ from: location }} replace />;
  if (appUser?.mustChangePassword)
    return <Navigate to="/change-password" replace />;
  if (role === "client") return <Navigate to="/client-portal" replace />;
  if (role === "frontdesk" && !allowFrontdesk)
    return <Navigate to="/leads" replace />;
  return children;
}

export function PortalRoute({ children }) {
  const { loading, isAuthenticated, role, appUser, membership } = useAuth();
  const location = useLocation();
  if (loading) return <AuthLoading />;
  if (!isAuthenticated)
    return <Navigate to="/login" state={{ from: location }} replace />;
  if (appUser?.mustChangePassword)
    return <Navigate to="/change-password" replace />;
  if (role !== "client")
    return (
      <Navigate to={homePathForRole(role, membership?.permissions)} replace />
    );
  return children;
}

export function AdminRoute({ children }) {
  const { loading, isAuthenticated, role, membership } = useAuth();
  if (loading) return <AuthLoading />;
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  if (role !== "admin")
    return (
      <Navigate to={homePathForRole(role, membership?.permissions)} replace />
    );
  return children;
}

export function PortalAccessRoute({ page, children }) {
  const { loading, accessReady, isAuthenticated, role, appUser, membership } = useAuth();
  const location = useLocation();
  if (loading) return <AuthLoading />;
  if (!isAuthenticated)
    return <Navigate to="/login" state={{ from: location }} replace />;
  if (!accessReady) return <AuthLoading />;
  if (appUser?.mustChangePassword)
    return <Navigate to="/change-password" replace />;
  if (role === "client") return <Navigate to="/client-portal" replace />;
  if (!canAccessPage(role, membership?.permissions, page)) {
    return (
      <Navigate to={homePathForRole(role, membership?.permissions)} replace />
    );
  }
  return children;
}
