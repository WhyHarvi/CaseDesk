import { useEffect, useState } from "react";
import {
  BriefcaseBusiness,
  CalendarClock,
  CalendarDays,
  CreditCard,
  FileCheck2,
  HandCoins,
  LayoutDashboard,
  Settings,
  Users,
  Gauge,
  LogOut,
  ContactRound,
  BarChart3,
  DatabaseZap,
  Inbox,
  PhoneCall,
  MessagesSquare,
} from "lucide-react";
import { NavLink, useLocation } from "react-router-dom";
import logo from "../../assets/logo.png";
import { useAuth } from "../../auth/AuthContext";
import { prefetchRoute } from "../../services/routePrefetch";
import { getPortalAccess } from "../../auth/portalAccess";
import { useNotifications } from "../notifications/NotificationProvider";
import api from "../../services/api";
import StaffAvatar from "../staff/StaffAvatar";

function AdminWorkspaceAvatar({ agency, className = "h-10 w-10" }) {
  const [url, setUrl] = useState("");

  useEffect(() => {
    if (agency?.hasAvatar === false) {
      setUrl("");
      return undefined;
    }
    let active = true;
    let objectUrl = "";
    api.get("/settings/agency-profile/avatar", { responseType: "blob", skipCache: true })
      .then((response) => {
        if (!active) return;
        objectUrl = URL.createObjectURL(response.data);
        setUrl(objectUrl);
      })
      .catch(() => { if (active) setUrl(""); });
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [agency?.hasAvatar, agency?.avatarUpdatedAt]);

  return <img src={url || logo} alt={`${agency?.name || "Workspace"} profile`} className={`${className} rounded-full border border-slate-200 bg-white object-cover`} />;
}

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
    label: "Leads",
    to: "/leads",
    icon: ContactRound,
    description: "Inquiry pipeline",
    disabled: false,
    badgeKey: "leads",
    // This badge is an unread-notification count, not the size of the lead
    // pipeline — worth spelling out since "Leads" reads like it could be
    // either. See CD-027.
    badgeNoun: "unread lead notification",
  },
  {
    label: "Calls",
    to: "/calls",
    icon: PhoneCall,
    description: "Ooma call inbox",
    disabled: false,
    badgeKey: "calls",
  },
  {
    label: "Chats",
    to: "/app/chats",
    icon: MessagesSquare,
    description: "Every conversation — clients and colleagues",
    disabled: false,
    badgeKey: "chats",
  },
  {
    label: "Import Review",
    to: "/leads/review",
    icon: Inbox,
    description: "Bulk-imported leads awaiting cleanup",
    disabled: false,
    badgeKey: "importReview",
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
    badgeKey: "workload",
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
    label: "Incentives",
    to: "/app/incentives",
    icon: HandCoins,
    description: "Everyone's earnings and pipeline",
    disabled: false,
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
  { label: "Leads", to: "/leads", icon: ContactRound, accessKey: "leads", badgeKey: "leads", badgeNoun: "unread lead notification" },
  { label: "Calls", to: "/calls", icon: PhoneCall, accessKey: "leads", badgeKey: "calls" },
  { label: "Chats", to: "/app/chats", icon: MessagesSquare, badgeKey: "chats" },
  { label: "Import Review", to: "/leads/review", icon: Inbox, accessKey: "leads", badgeKey: "importReview" },
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
    badgeKey: "workload",
  },
  {
    label: "Payments",
    to: "/app/payments",
    icon: CreditCard,
    accessKey: "payments",
    badgeKey: "payments",
  },
  {
    label: "Incentives",
    to: "/app/incentives",
    icon: HandCoins,
    accessKey: "incentives",
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

function UpdateBadge({ count, collapsed = false, noun = "unread item" }) {
  if (!count?.total) return null;
  const needsAction = count.actions > 0;
  const value = count.total > 99 ? "99+" : count.total;
  const title = `${count.total} ${count.total === 1 ? noun : `${noun}s`}${count.actions ? ` · ${count.actions} require action` : ""}${count.focus?.title ? ` · Latest: ${count.focus.title}` : ""}`;
  return (
    <span
      title={title}
      aria-label={title}
      className={[
        "inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[10px] font-bold tabular-nums leading-none text-white shadow-sm",
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
      to={item.to}
      onClick={() => onNavigate?.()}
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
            {collapsed ? <UpdateBadge count={item.badge} collapsed noun={item.badgeNoun} /> : null}
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
            {!collapsed ? <UpdateBadge count={item.badge} noun={item.badgeNoun} /> : null}
            </div>
          </div>
        </>
      )}
    </NavLink>
  );
}

function SidebarContent({ collapsed, onCloseMobile, mobile = false }) {
  const { role, appUser, agency, membership, signOut } = useAuth();
  const access = getPortalAccess(role, membership?.permissions);
  const { sidebarCounts, acknowledgeDestination } = useNotifications();
  const location = useLocation();
  const navigation = (
    role === "admin" ? adminNavigation : memberNavigation
  ).filter((item) => !item.accessKey || access.pages[item.accessKey]);

  // Import Review isn't a notification stream (no read/unread state), just a
  // backlog size — so it rides on its own lightweight count instead of the
  // notification system, refreshed whenever the user leaves that page since
  // that's when a promotion (the only thing that changes the count) happens.
  const [importReviewCount, setImportReviewCount] = useState(0);
  useEffect(() => {
    if (!access.pages.leads) return;
    let active = true;
    api.get("/leads?segment=IMPORT_REVIEW&limit=1")
      .then((response) => { if (active) setImportReviewCount(response.data.meta?.total || 0); })
      .catch(() => {});
    return () => { active = false; };
  }, [access.pages.leads, location.pathname]);
  const badgeCounts = { ...sidebarCounts, importReview: { total: importReviewCount, actions: importReviewCount } };
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
            item={{ ...item, badge: item.badgeKey ? badgeCounts[item.badgeKey] : null }}
            collapsed={collapsed}
            onNavigate={() => {
              if (item.badgeKey) {
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
            "group/account flex items-center transition-all duration-300 ease-out",
            collapsed
              ? "justify-center border-transparent bg-transparent px-0 py-0"
              : "gap-3 rounded-[20px] border border-slate-200/80 bg-gradient-to-br from-white to-slate-50/80 px-3 py-3 shadow-sm shadow-slate-200/50 hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-lg hover:shadow-slate-200/60",
          ].join(" ")}
        >
          <div className="relative shrink-0 transition-transform duration-300 group-hover/account:scale-105">
            {role === "admin" ? (
              <AdminWorkspaceAvatar agency={agency} className="h-10 w-10 shadow-sm ring-2 ring-white" />
            ) : (
              <StaffAvatar
                user={appUser}
                alt={`${appUser?.fullName || "Staff"} profile`}
                className="h-10 w-10 shadow-sm ring-2 ring-white"
              />
            )}
            <span className="absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full border-2 border-white bg-emerald-500 shadow-sm" aria-label="Online" />
          </div>
          <div
            className={[
              "min-w-0 flex-1 transition-[width,transform,opacity] duration-300 ease-out",
              collapsed
                ? "w-0 -translate-x-3 opacity-0"
                : "w-full translate-x-0 opacity-100",
            ].join(" ")}
          >
            <p className="truncate text-sm font-semibold text-slate-900">
              {appUser?.fullName}
            </p>
            <p className="mt-0.5 flex items-center gap-1.5 truncate text-[11px] font-medium capitalize tracking-wide text-slate-500">
              <span className="h-1 w-1 rounded-full bg-slate-400" />
              {role}
            </p>
          </div>
          <button
            type="button"
            onClick={signOut}
            className={
              collapsed
                ? "hidden"
                : "group/logout relative flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-transparent text-slate-400 transition-all duration-300 ease-out hover:border-rose-100 hover:bg-rose-50 hover:text-rose-600 hover:shadow-sm active:scale-90"
            }
            aria-label="Sign out"
            title="Sign out"
          >
            <span className="absolute inset-y-1.5 left-0 w-0.5 -translate-x-full rounded-full bg-rose-500 transition-transform duration-300 group-hover/logout:translate-x-0" />
            <LogOut className="h-4 w-4 transition-transform duration-300 ease-out group-hover/logout:translate-x-0.5 group-hover/logout:rotate-[-6deg]" />
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
