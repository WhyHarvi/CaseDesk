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
  BarChart3,
  Waypoints,
  DatabaseZap,
} from "lucide-react";
import { NavLink } from "react-router-dom";
import logo from "../../assets/logo.png";
import { useAuth } from "../../auth/AuthContext";
import { prefetchRoute } from "../../services/routePrefetch";
import { getPortalAccess } from "../../auth/portalAccess";
import { useNotifications } from "../notifications/NotificationProvider";

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
    badgeKey: "clients",
  },
  {
    label: "Lead Intake",
    to: "/lead-intake",
    icon: Waypoints,
    description: "Forms and imports",
    disabled: false,
    badgeKey: "leadIntake",
  },
  {
    label: "Leads",
    to: "/leads",
    icon: ContactRound,
    description: "Inquiry pipeline",
    disabled: false,
    badgeKey: "leads",
  },
  {
    label: "Cases",
    to: "/app/cases",
    icon: BriefcaseBusiness,
    description: "Active casework",
    disabled: false,
    badgeKey: "cases",
  },
  {
    label: "Documents",
    to: "/app/documents",
    icon: FileCheck2,
    description: "Uploads and document review",
    disabled: false,
    badgeKey: "documents",
  },
  {
    label: "Follow-ups",
    to: "/app/follow-ups",
    icon: CalendarClock,
    disabled: false,
    badgeKey: "followUps",
  },
  {
    label: "Calendar",
    to: "/app/calendar",
    icon: CalendarDays,
    description: "Appointments and booking",
    disabled: false,
    badgeKey: "calendar",
  },
  {
    label: "Team Workload",
    to: "/app/workload",
    icon: Gauge,
    description: "Capacity and assignments",
    disabled: false,
  },
  {
    label: "Payments",
    to: "/app/payments",
    icon: CreditCard,
    description: "Agency-wide payment history",
    disabled: false,
    badgeKey: "payments",
  },
  {
    label: "Case Easy Import",
    to: "/app/case-easy-import",
    icon: DatabaseZap,
    description: "Import and review Case Easy data",
    disabled: false,
    badgeKey: "caseEasyImport",
  },
  {
    label: "Settings",
    to: "/app/settings",
    icon: Settings,
    description: "Workspace controls",
    disabled: false,
    badgeKey: "settings",
  },
];

const memberNavigation = [
  {
    label: "Dashboard",
    to: "/app/dashboard",
    icon: LayoutDashboard,
    accessKey: "dashboard",
  },
  { label: "Leads", to: "/leads", icon: ContactRound, accessKey: "leads", badgeKey: "leads" },
  {
    label: "Lead Intake",
    to: "/lead-intake",
    icon: Waypoints,
    accessKey: "leadIntake",
    badgeKey: "leadIntake",
  },
  { label: "Clients", to: "/app/clients", icon: Users, accessKey: "clients", badgeKey: "clients" },
  {
    label: "Cases",
    to: "/app/cases",
    icon: BriefcaseBusiness,
    accessKey: "cases",
    badgeKey: "cases",
  },
  {
    label: "Follow-ups",
    to: "/app/follow-ups",
    icon: CalendarClock,
    accessKey: "followUps",
    badgeKey: "followUps",
  },
  {
    label: "Calendar",
    to: "/app/calendar",
    icon: CalendarDays,
    accessKey: "calendar",
    badgeKey: "calendar",
  },
  {
    label: "Documents",
    to: "/app/documents",
    icon: FileCheck2,
    accessKey: "documents",
    badgeKey: "documents",
  },
  {
    label: "Workload",
    to: "/app/workload",
    icon: Gauge,
    accessKey: "workload",
  },
  {
    label: "Payments",
    to: "/app/payments",
    icon: CreditCard,
    accessKey: "payments",
    badgeKey: "payments",
  },
  {
    label: "Case Easy Import",
    to: "/app/case-easy-import",
    icon: DatabaseZap,
    accessKey: "caseEasyImport",
    badgeKey: "caseEasyImport",
  },
  { label: "Settings", to: "/app/settings", icon: Settings, badgeKey: "settings" },
];

function UpdateBadge({ count, collapsed = false }) {
  if (!count?.total) return null;
  const needsAction = count.actions > 0;
  const value = count.total > 99 ? "99+" : count.total;
  const title = `${count.total} unread ${count.total === 1 ? "item" : "items"}${count.actions ? ` · ${count.actions} require action` : ""}${count.focus?.title ? ` · Latest: ${count.focus.title}` : ""}`;
  return (
    <span
      title={title}
      aria-label={title}
      className={[
        "inline-flex min-h-[20px] min-w-[20px] items-center justify-center rounded-full px-1.5 text-[10px] font-bold leading-none text-white shadow-sm transition-all duration-200",
        needsAction ? "bg-rose-500 shadow-rose-200" : "bg-sky-500 shadow-sky-200",
        collapsed ? "absolute -right-1 -top-1 ring-2 ring-slate-50" : "ml-auto",
      ].join(" ")}
    >
      {value}
    </span>
  );
}

function NavItem({ item, collapsed, onNavigate, role }) {
  const Icon = item.icon;
  const focusUrl = String(item.badge?.focus?.actionUrl || "");
  let target = item.to;
  if (item.badge?.total && focusUrl.startsWith("/") && !focusUrl.startsWith("//")) {
    try {
      const focusPath = new URL(focusUrl, window.location.origin).pathname;
      if (focusPath === item.to || focusPath.startsWith(`${item.to}/`)) target = focusUrl;
    } catch { /* keep the module route */ }
  }

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
            collapsed
              ? "w-0 -translate-x-3 opacity-0"
              : "w-full translate-x-0 opacity-100",
          ].join(" ")}
        >
          <div className="flex items-center gap-2">
            <span className="truncate font-medium text-slate-400">
              {item.label}
            </span>
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
      to={target}
      onClick={(event) => onNavigate?.({ hasDirectFocus: target !== item.to, anchorRect: event.currentTarget.getBoundingClientRect() })}
      onMouseEnter={() => prefetchRoute(item.to, role)}
      onFocus={() => prefetchRoute(item.to, role)}
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
              "relative flex h-10 w-10 shrink-0 items-center justify-center rounded-full transition-all duration-200",
              isActive
                ? "bg-sky-200 text-sky-700"
                : "border border-slate-200 bg-white text-slate-500 group-hover:border-sky-100 group-hover:bg-sky-50 group-hover:text-sky-700",
            ].join(" ")}
          >
            <Icon className="h-5 w-5" />
            {collapsed ? <UpdateBadge count={item.badge} collapsed /> : null}
          </div>
          <div
            className={[
              "min-w-0 transition-[width,transform,opacity] duration-300 ease-out",
              collapsed
                ? "w-0 -translate-x-3 opacity-0"
                : "w-full translate-x-0 opacity-100",
            ].join(" ")}
          >
            <div className="flex min-w-0 items-center gap-2">
            <p
              className={[
                "truncate text-sm font-medium",
                isActive ? "text-slate-900" : "text-slate-600",
              ].join(" ")}
            >
              {item.label}
            </p>
            {!collapsed ? <UpdateBadge count={item.badge} /> : null}
            </div>
          </div>
        </>
      )}
    </NavLink>
  );
}

function SidebarContent({ collapsed, onCloseMobile, mobile = false }) {
  const { role, appUser, membership, signOut } = useAuth();
  const access = getPortalAccess(role, membership?.permissions);
  const { sidebarCounts, acknowledgeDestination, focusDestination } = useNotifications();
  const navigation = (
    role === "admin" ? adminNavigation : memberNavigation
  ).filter((item) => !item.accessKey || access.pages[item.accessKey]);
  const initials =
    appUser?.fullName
      ?.split(" ")
      .map((part) => part[0])
      .join("")
      .slice(0, 2)
      .toUpperCase() || "CD";
  return (
    <>
      <div
        className={[
          "border-b border-slate-200 pb-4",
          collapsed ? "px-0" : "px-1",
        ].join(" ")}
      >
        <div
          className={[
            "flex items-center gap-3",
            collapsed ? "justify-center" : "justify-start",
          ].join(" ")}
        >
          <div className="flex items-center gap-3 overflow-hidden">
            <div className="relative flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-full border border-slate-200 bg-white">
              <img
                src={logo}
                alt="CaseDesk logo"
                className="h-full w-full rounded-full object-cover"
              />
            </div>
            <div
              className={[
                "min-w-0 transition-[width,transform,opacity] duration-300 ease-out",
                collapsed
                  ? "w-0 -translate-x-3 opacity-0"
                  : "w-full translate-x-0 opacity-100",
              ].join(" ")}
            >
              <h1 className="truncate text-lg font-semibold text-slate-900">
                CaseDesk
              </h1>
              <p className="truncate text-sm text-slate-500">
                Client operations
              </p>
            </div>
          </div>
        </div>
      </div>
      <nav className="mt-5 flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto overscroll-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {navigation.map((item) => (
          <NavItem
            key={item.label}
            item={{ ...item, badge: item.badgeKey ? sidebarCounts[item.badgeKey] : null }}
            collapsed={collapsed}
            onNavigate={({ hasDirectFocus, anchorRect }) => {
              if (item.badgeKey) {
                focusDestination(item.badgeKey, item.label, { hasDirectFocus, anchorRect });
                void acknowledgeDestination(item.badgeKey);
              }
              if (mobile) onCloseMobile?.();
            }}
            role={role}
          />
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
              collapsed
                ? "w-0 -translate-x-3 opacity-0"
                : "w-full translate-x-0 opacity-100",
            ].join(" ")}
          >
            <p className="truncate text-sm font-semibold text-slate-900">
              {appUser?.fullName}
            </p>
            <p className="truncate text-xs capitalize text-slate-500">{role}</p>
          </div>
          <button
            type="button"
            onClick={signOut}
            className={
              collapsed
                ? "hidden"
                : "rounded-full p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
            }
            aria-label="Sign out"
          >
            <LogOut className="h-4 w-4" />
          </button>
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
          mobileOpen
            ? "pointer-events-auto opacity-100"
            : "pointer-events-none opacity-0",
        ].join(" ")}
      >
        <button
          type="button"
          aria-label="Close sidebar overlay"
          className="absolute inset-0"
          onClick={onCloseMobile}
        />
        <aside
          className={[
            "relative flex h-full w-[22rem] max-w-[88vw] flex-col border-r border-slate-200 bg-slate-50 px-5 py-6 shadow-2xl transition-transform duration-300 ease-out",
            mobileOpen ? "translate-x-0" : "-translate-x-full",
          ].join(" ")}
        >
          <SidebarContent
            collapsed={false}
            onCloseMobile={onCloseMobile}
            mobile
          />
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
        if (!event.currentTarget.contains(event.relatedTarget))
          setHovered(false);
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
