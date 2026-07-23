import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { Outlet, useLocation } from "react-router-dom";
import { getPortalOverview, portalErrorMessage } from "../../api/clientPortalApi";
import ClientPortalBottomNav from "./ClientPortalBottomNav";
import ClientPortalSidebar from "./ClientPortalSidebar";
import { ClientPortalToastProvider } from "./ClientPortalToast";

const PortalDataContext = createContext(null);

export function usePortalData() {
  const value = useContext(PortalDataContext);
  if (!value) throw new Error("usePortalData must be used inside ClientPortalLayout");
  return value;
}

export default function ClientPortalLayout() {
  const location = useLocation();
  const isChat = location.pathname === "/client-portal/chat";
  const [overview, setOverview] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const refresh = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setLoading(true);
    try {
      const data = await getPortalOverview();
      setOverview(data);
      setError("");
    } catch (reason) {
      setError(portalErrorMessage(reason, "Your portal could not be loaded. Please try again."));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const value = useMemo(() => ({ overview, loading, error, refresh }), [overview, loading, error, refresh]);

  return (
    <ClientPortalToastProvider>
      <PortalDataContext.Provider value={value}>
        <div className="relative min-h-screen bg-[#eef3fa] text-slate-900">
          <div className="pointer-events-none fixed inset-0 overflow-hidden" aria-hidden="true">
            <div className="absolute inset-x-0 top-0 h-72 bg-gradient-to-b from-sky-100/90 via-sky-50/40 to-transparent" />
            <div className="absolute -left-24 top-16 h-72 w-72 rounded-full bg-sky-200/40 blur-3xl" />
            <div className="absolute -right-28 top-64 h-80 w-80 rounded-full bg-indigo-200/35 blur-3xl" />
            <div className="absolute -bottom-40 left-1/3 h-80 w-80 rounded-full bg-cyan-100/40 blur-3xl" />
          </div>

          <div className="relative flex min-h-screen w-full">
            <ClientPortalSidebar />

            <div className="flex min-w-0 flex-1 flex-col">
              {isChat ? (
                <main className="relative mx-auto w-full max-w-[520px] flex-1 lg:mx-0 lg:max-w-none lg:px-10 lg:py-8">
                  <Outlet />
                </main>
              ) : (
                <>
                  <main className="relative mx-auto w-full max-w-[520px] flex-1 px-4 pb-32 pt-[max(env(safe-area-inset-top),1rem)] lg:mx-0 lg:max-w-none lg:px-10 lg:py-8 lg:pb-10">
                    <Outlet />
                  </main>
                  <div className="lg:hidden">
                    <ClientPortalBottomNav />
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </PortalDataContext.Provider>
    </ClientPortalToastProvider>
  );
}
