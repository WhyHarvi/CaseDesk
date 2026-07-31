import { X } from "lucide-react";
import { useEffect } from "react";

export default function DashboardDrawer({ open, onClose, title, subtitle, icon, children }) {
  useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = (event) => event.key === "Escape" && onClose();
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!open) return null;
  const Icon = icon;

  return (
    <div className="fixed inset-0 z-[80] flex justify-end bg-slate-950/20 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="dashboard-drawer-title">
      <button type="button" className="absolute inset-0" onClick={onClose} aria-label="Close panel" />
      <aside className="relative flex h-full w-full max-w-md flex-col border-l border-white/80 bg-gradient-to-b from-[#f9fbfd] to-[#eef3f8] shadow-2xl">
        <header className="flex items-start justify-between gap-3 border-b border-slate-200/80 bg-white/90 px-6 py-5 backdrop-blur-xl">
          <div className="min-w-0">
            {Icon ? (
              <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-brand-600 text-white shadow-[0_8px_20px_rgba(73,104,149,0.24)]">
                <Icon className="h-5 w-5" />
              </div>
            ) : null}
            <h2 id="dashboard-drawer-title" className="text-xl font-semibold tracking-tight text-slate-950">{title}</h2>
            {subtitle ? <p className="mt-1 text-sm text-slate-500">{subtitle}</p> : null}
          </div>
          <button type="button" onClick={onClose} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-500 transition hover:bg-slate-200 hover:text-slate-900" aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-6 py-5">
          {children}
        </div>
      </aside>
    </div>
  );
}
