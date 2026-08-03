import { CalendarDays, ClipboardList, CreditCard, FileText, House, LogOut, MessagesSquare, Settings2, UserRound } from "lucide-react";
import { NavLink } from "react-router-dom";
import { useAuth } from "../../auth/AuthContext";
import { usePortalData } from "./ClientPortalLayout";

const items = [
  { label: "Home", to: "/client-portal", icon: House, end: true },
  { label: "Documents", to: "/client-portal/documents", icon: FileText },
  { label: "Forms", to: "/client-portal/questionnaires", icon: ClipboardList },
  { label: "Appointments", to: "/client-portal/appointments", icon: CalendarDays },
  { label: "Payments", to: "/client-portal/payments", icon: CreditCard },
  { label: "Chat", to: "/client-portal/chat", icon: MessagesSquare },
];

// Desktop-only companion to ClientPortalBottomNav.jsx (mobile keeps the
// bottom nav untouched — this only renders at the lg breakpoint and up).
// Styled to match the admin Sidebar.jsx's visual language (white panel,
// rounded active pill, icon + label) so the portal reads as the same
// product family, not a bolted-on second design.
export default function ClientPortalSidebar() {
  const { signOut } = useAuth();
  const { overview } = usePortalData();
  const initials = (overview?.client?.fullName || overview?.client?.firstName || "You")
    .split(" ")
    .filter(Boolean)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return (
    <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col border-r border-white/70 bg-white/70 px-3 py-6 backdrop-blur-xl lg:flex">
      <div className="px-2">
        {overview?.agency?.name ? (
          <p className="truncate text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">{overview.agency.name}</p>
        ) : null}
        <p className="mt-0.5 text-lg font-semibold tracking-[-0.02em] text-slate-950">Client Portal</p>
      </div>

      <nav className="mt-8 flex-1 space-y-1" aria-label="Portal navigation">
        {items.map((item) => {
          const Icon = item.icon;
          return (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                [
                  "flex items-center gap-3 rounded-2xl px-3 py-2.5 text-sm font-semibold transition-all duration-200",
                  isActive ? "bg-sky-100 text-sky-700" : "text-slate-500 hover:bg-white hover:text-slate-800",
                ].join(" ")
              }
            >
              <Icon className="h-[18px] w-[18px] shrink-0" />
              <span className="truncate">{item.label}</span>
            </NavLink>
          );
        })}
      </nav>

      <div className="space-y-1 border-t border-slate-200/70 pt-3">
        <NavLink
          to="/client-portal/settings"
          className={({ isActive }) =>
            [
              "flex items-center gap-3 rounded-2xl px-3 py-2.5 text-sm font-semibold transition-all duration-200",
              isActive ? "bg-sky-100 text-sky-700" : "text-slate-500 hover:bg-white hover:text-slate-800",
            ].join(" ")
          }
        >
          <Settings2 className="h-[18px] w-[18px] shrink-0" />
          <span className="truncate">Settings</span>
        </NavLink>
        <NavLink
          to="/client-portal/profile"
          className={({ isActive }) =>
            [
              "flex items-center gap-3 rounded-2xl px-3 py-2.5 text-sm font-semibold transition-all duration-200",
              isActive ? "bg-sky-100 text-sky-700" : "text-slate-500 hover:bg-white hover:text-slate-800",
            ].join(" ")
          }
        >
          <span className="flex h-[18px] w-[18px] shrink-0 items-center justify-center overflow-hidden rounded-full bg-gradient-to-br from-sky-500 to-indigo-500 text-[9px] font-semibold text-white">
            {initials || <UserRound className="h-3 w-3" />}
          </span>
          <span className="truncate">Profile</span>
        </NavLink>
        <button
          type="button"
          onClick={signOut}
          className="flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-sm font-semibold text-slate-500 transition-all duration-200 hover:bg-rose-50 hover:text-rose-700"
        >
          <LogOut className="h-[18px] w-[18px] shrink-0" />
          <span className="truncate">Sign out</span>
        </button>
      </div>
    </aside>
  );
}
