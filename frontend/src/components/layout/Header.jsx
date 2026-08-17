import { Menu, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import DashboardTopBar from "../dashboard/DashboardTopBar";
import { lazy, Suspense, useState } from "react";

const QuickCreateCurtains = lazy(() => import("./QuickCreateCurtains"));

export default function Header({ sidebarCollapsed, onToggleSidebar, onOpenMobileSidebar }) {
  const [createCurtain, setCreateCurtain] = useState(null);
  const sidebarControls = (
    <>
      <button
        type="button"
        onClick={onOpenMobileSidebar}
        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-white/70 bg-white/80 text-slate-500 shadow-sm transition-all duration-300 hover:-translate-y-0.5 hover:text-slate-900 lg:hidden"
        aria-label="Open sidebar"
      >
        <Menu className="h-5 w-5" />
      </button>
      <button
        type="button"
        onClick={onToggleSidebar}
        className="hidden h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-white/70 bg-white/80 text-slate-500 shadow-sm transition-all duration-300 hover:-translate-y-0.5 hover:text-slate-900 lg:flex"
        aria-label={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
      >
        {sidebarCollapsed ? <PanelLeftOpen className="h-5 w-5" /> : <PanelLeftClose className="h-5 w-5" />}
      </button>
    </>
  );

  return (
    <>
      <header className="sticky top-0 z-10 border-b border-slate-200 bg-slate-50/85 px-6 py-4 backdrop-blur">
        <DashboardTopBar
          leading={sidebarControls}
          onAddClient={() => setCreateCurtain("client")}
          onAddCase={() => setCreateCurtain("case")}
        />
      </header>
      {createCurtain ? (
        <Suspense fallback={null}>
          <QuickCreateCurtains kind={createCurtain} onClose={() => setCreateCurtain(null)} />
        </Suspense>
      ) : null}
    </>
  );
}
