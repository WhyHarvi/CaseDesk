import { useState } from "react";
import { useLocation } from "react-router-dom";
import Header from "../components/layout/Header";
import Sidebar from "../components/layout/Sidebar";

export default function MainLayout({ children, hideTopBar = false, lockContentScroll = false, flushContent = false }) {
  const location = useLocation();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(true);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const isSettings = location.pathname === "/app/settings";
  const isWriter = /\/documents\/(new|[^/]+\/edit)$/.test(location.pathname);
  const useFocusedWorkspace = isSettings || isWriter;
  const effectiveHideTopBar = hideTopBar || useFocusedWorkspace;
  const effectiveLockContentScroll = lockContentScroll || useFocusedWorkspace;
  const effectiveFlushContent = flushContent || useFocusedWorkspace;

  return (
    <div className="h-screen overflow-hidden bg-transparent text-slate-900">
      <div className="flex h-screen w-full">
        <Sidebar collapsed={sidebarCollapsed} />
        <Sidebar
          mobile
          mobileOpen={mobileSidebarOpen}
          onCloseMobile={() => setMobileSidebarOpen(false)}
        />
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          {!effectiveHideTopBar ? (
            <>
              <div className="border-b border-white/60 bg-white/60 px-6 py-4 lg:hidden">
                <p className="text-xl font-semibold text-slate-900">CaseDesk</p>
                <p className="text-sm text-slate-500">Client and case tracking</p>
              </div>
              <Header
                sidebarCollapsed={sidebarCollapsed}
                onToggleSidebar={() => setSidebarCollapsed((value) => !value)}
                onOpenMobileSidebar={() => setMobileSidebarOpen(true)}
              />
            </>
          ) : null}
          <main
            className={`min-h-0 min-w-0 flex-1 ${effectiveFlushContent ? "" : "px-6 py-8"} ${
              effectiveLockContentScroll ? "overflow-hidden" : "overflow-y-auto"
            }`}
          >
            <div
              className={`${effectiveFlushContent ? "h-full" : "w-full"} min-w-0 ${
                effectiveLockContentScroll ? "flex h-full min-h-0 flex-col" : ""
              }`}
            >
              {children}
            </div>
          </main>
        </div>
      </div>
    </div>
  );
}
