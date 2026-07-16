import { useState } from "react";
import Header from "../components/layout/Header";
import Sidebar from "../components/layout/Sidebar";

export default function MainLayout({ children, hideTopBar = false, lockContentScroll = false, flushContent = false }) {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(true);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);

  return (
    <div className="h-screen overflow-hidden bg-transparent text-slate-900">
      <div className="mx-auto flex h-screen max-w-[1680px]">
        <Sidebar collapsed={sidebarCollapsed} />
        <Sidebar
          mobile
          mobileOpen={mobileSidebarOpen}
          onCloseMobile={() => setMobileSidebarOpen(false)}
        />
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          {!hideTopBar ? (
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
            className={`min-h-0 min-w-0 flex-1 ${flushContent ? "" : "px-6 py-8"} ${
              lockContentScroll ? "overflow-hidden" : "overflow-y-auto"
            }`}
          >
            <div
              className={`${flushContent ? "h-full max-w-none" : "w-full max-w-7xl"} min-w-0 ${
                lockContentScroll ? "flex h-full min-h-0 flex-col" : ""
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
