import { useState } from "react";
import {
  BriefcaseBusiness,
  CalendarClock,
  CalendarDays,
  CreditCard,
  FileCheck2,
  LayoutDashboard,
  Settings,
  Users,
  Gauge,
  LogOut,
  ContactRound,
  UserRound,
  BarChart3,
  Waypoints,
} from "lucide-react";
import { NavLink } from "react-router-dom";
import logo from "../../assets/logo.png";
import { useAuth } from "../../auth/AuthContext";

const adminNavigation = [
  {
    label: "Dashboard",
    to: "/app/dashboard",
    icon: LayoutDashboard,
    description: "Command center",
    disabled: false,
  },
  {
    label: "Lead Dashboard",
    to: "/lead-dashboard",
    icon: BarChart3,
    description: "Lead priorities",
    disabled: false,
  },
  {
    label: "Team Members",
    to: "/app/team-members",
    icon: Users,
    description: "Consultants and staff",
    disabled: false,
  },
  {
    label: "Clients",
    to: "/app/clients",
    icon: Users,
    description: "Profiles and intake",
    disabled: false,
  },
  {
    label: "Lead Intake",
    to: "/lead-intake",
    icon: Waypoints,
    description: "Forms and imports",
    disabled: false,
  },
  {
    label: "Leads",
    to: "/leads",
    icon: ContactRound,
    description: "Inquiry pipeline",
    disabled: false,
  },
  {
    label: "Cases",
    to: "/app/cases",
    icon: BriefcaseBusiness,
    description: "Active casework",
    disabled: false,
  },
  {
    label: "Follow-ups",
    to: "/app/follow-ups",
    icon: CalendarClock,
    disabled: false,
  },
  {
    label: "Calendar",
    to: "/app/calendar",
    icon: CalendarDays,
    description: "Appointments and booking",
    disabled: false,
  },
  {
    label: "Team Workload",
    to: "/app/workload",
    icon: Gauge,
    description: "Capacity and assignments",
    disabled: false,
  },
  {
    label: "Settings",
    to: "/app/settings",
    icon: Settings,
    description: "Workspace controls",
    disabled: false,
  },
];

const consultantNavigation = [
  { label: "Dashboard", to: "/app/dashboard", icon: LayoutDashboard },
  { label: "Leads", to: "/leads", icon: ContactRound },
  { label: "Lead Intake", to: "/lead-intake", icon: Waypoints },
  { label: "My Clients", to: "/app/clients", icon: Users },
  { label: "My Cases", to: "/app/cases", icon: BriefcaseBusiness },
  { label: "Follow-ups", to: "/app/follow-ups", icon: CalendarClock },
  { label: "Calendar", to: "/app/calendar", icon: CalendarDays },
  { label: "My Workload", to: "/app/workload", icon: Gauge },
  { label: "Settings", to: "/app/settings", icon: Settings },
];

const frontdeskNavigation = [
  { label: "Leads", to: "/leads", icon: ContactRound, description: "Assigned inquiries" },
  { label: "Calendar", to: "/app/calendar", icon: CalendarDays, description: "Book walk-ins" },
  { label: "My Profile", to: "/app/settings?section=personal-profile", icon: UserRound },
  { label: "Settings", to: "/app/settings", icon: Settings },
];

function NavItem({ item, collapsed, onNavigate }) {
  const Icon = item.icon;

  if (item.disabled) {
    return (
      <div
        className={[
          "flex cursor-not-allowed items-center gap-3 rounded-2xl px-3 py-2.5 text-sm",
          collapsed ? "justify-center" : "text-slate-400",
        ].join(" ")}
      >
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-400">
          <Icon className="h-5 w-5" />
        </div>
        <div
          className={[
            "min-w-0 transition-[width,transform,opacity] duration-300 ease-out",
            collapsed ? "w-0 -translate-x-3 opacity-0" : "w-full translate-x-0 opacity-100",
          ].join(" ")}
        >
          <div className="flex items-center gap-2">
            <span className="truncate font-medium text-slate-400">{item.label}</span>
            <span className="ml-auto rounded-full bg-slate-200 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.22em] text-slate-500">
              Soon
            </span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <NavLink
      to={item.to}
      onClick={onNavigate}
      className={({ isActive }) =>
        [
          "group flex items-center gap-3 rounded-2xl px-3 py-2.5 transition-all duration-200",
          collapsed ? "justify-center px-2.5" : "",
          isActive
            ? collapsed
              ? "text-slate-900"
              : "bg-sky-100 text-slate-900"
            : "text-slate-500 hover:bg-sky-50 hover:text-slate-700",
        ].join(" ")
      }
    >
      {({ isActive }) => (
        <>
          <div
            className={[
              "flex h-10 w-10 shrink-0 items-center justify-center rounded-full transition-all duration-200",
              isActive
                ? "bg-sky-200 text-sky-700"
                : "border border-slate-200 bg-white text-slate-500 group-hover:border-sky-100 group-hover:bg-sky-50 group-hover:text-sky-700",
            ].join(" ")}
          >
            <Icon className="h-5 w-5" />
          </div>
          <div
            className={[
              "min-w-0 transition-[width,transform,opacity] duration-300 ease-out",
              collapsed ? "w-0 -translate-x-3 opacity-0" : "w-full translate-x-0 opacity-100",
            ].join(" ")}
          >
            <p className={["truncate text-sm font-medium", isActive ? "text-slate-900" : "text-slate-600"].join(" ")}>
              {item.label}
            </p>
          </div>
        </>
      )}
    </NavLink>
  );
}

function SidebarContent({ collapsed, onCloseMobile, mobile = false }) {
  const { role, appUser, signOut } = useAuth();
  const navigation = role === "admin" ? adminNavigation : role === "frontdesk" ? frontdeskNavigation : consultantNavigation;
  const initials = appUser?.fullName?.split(" ").map((part) => part[0]).join("").slice(0, 2).toUpperCase() || "CD";
  return (
    <>
      <div className={["border-b border-slate-200 pb-4", collapsed ? "px-0" : "px-1"].join(" ")}>
        <div className={["flex items-center gap-3", collapsed ? "justify-center" : "justify-start"].join(" ")}>
          <div className="flex items-center gap-3 overflow-hidden">
            <div className="relative flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-full border border-slate-200 bg-white">
              <img src={logo} alt="CaseDesk logo" className="h-full w-full rounded-full object-cover" />
            </div>
            <div
              className={[
                "min-w-0 transition-[width,transform,opacity] duration-300 ease-out",
                collapsed ? "w-0 -translate-x-3 opacity-0" : "w-full translate-x-0 opacity-100",
              ].join(" ")}
            >
              <h1 className="truncate text-lg font-semibold text-slate-900">CaseDesk</h1>
              <p className="truncate text-sm text-slate-500">Client operations</p>
            </div>
          </div>
        </div>
      </div>
      <nav className="mt-5 flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto overscroll-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {navigation.map((item) => (
          <NavItem key={item.label} item={item} collapsed={collapsed} onNavigate={mobile ? onCloseMobile : undefined} />
        ))}
      </nav>
      <div
        className={[
          "mt-4 shrink-0 border-t border-slate-200 pt-4 transition-all duration-200",
          collapsed ? "px-0" : "px-1",
        ].join(" ")}
      >
        <div
          className={[
            "flex items-center transition-all duration-200",
            collapsed
              ? "justify-center border-transparent bg-transparent px-0 py-0"
              : "gap-3 rounded-2xl border border-slate-200 bg-white px-3 py-3",
          ].join(" ")}
        >
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand-100 text-sm font-semibold text-brand-700">
            {initials}
          </div>
          <div
            className={[
              "min-w-0 transition-[width,transform,opacity] duration-300 ease-out",
              collapsed ? "w-0 -translate-x-3 opacity-0" : "w-full translate-x-0 opacity-100",
            ].join(" ")}
          >
            <p className="truncate text-sm font-semibold text-slate-900">{appUser?.fullName}</p>
            <p className="truncate text-xs capitalize text-slate-500">{role}</p>
          </div>
          <button type="button" onClick={signOut} className={collapsed ? "hidden" : "rounded-full p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700"} aria-label="Sign out"><LogOut className="h-4 w-4" /></button>
        </div>
      </div>
    </>
  );
}

export default function Sidebar({
  collapsed = false,
  mobile = false,
  mobileOpen = false,
  onCloseMobile,
}) {
  const [hovered, setHovered] = useState(false);

  if (mobile) {
    return (
      <div
        className={[
          "fixed inset-0 z-40 bg-slate-950/35 backdrop-blur-sm transition-all duration-300 lg:hidden",
          mobileOpen ? "pointer-events-auto opacity-100" : "pointer-events-none opacity-0",
        ].join(" ")}
      >
        <button type="button" aria-label="Close sidebar overlay" className="absolute inset-0" onClick={onCloseMobile} />
        <aside
          className={[
            "relative flex h-full w-[22rem] max-w-[88vw] flex-col border-r border-slate-200 bg-slate-50 px-5 py-6 shadow-2xl transition-transform duration-300 ease-out",
            mobileOpen ? "translate-x-0" : "-translate-x-full",
          ].join(" ")}
        >
          <SidebarContent collapsed={false} onCloseMobile={onCloseMobile} mobile />
        </aside>
      </div>
    );
  }

  const expanded = !collapsed || hovered;

  return (
    <aside
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocusCapture={() => setHovered(true)}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setHovered(false);
      }}
      className={[
        "sticky top-0 hidden h-screen shrink-0 flex-col overflow-hidden border-r border-slate-200 bg-slate-50 py-6 transition-[width,padding] duration-300 ease-out lg:flex",
        expanded ? "w-80 px-5" : "w-24 px-4",
      ].join(" ")}
    >
      <SidebarContent collapsed={!expanded} />
    </aside>
  );
}
