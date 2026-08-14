import {
  BriefcaseBusiness,
  CalendarClock,
  CalendarDays,
  CircleAlert,
  FileClock,
  ListChecks,
  UsersRound,
  Users,
} from "lucide-react";
import { Link } from "react-router-dom";

function getStats(dashboard, { onOpenDrawer, onFocusScheduling }) {
  const caseEasyImportPending = dashboard?.stats?.caseEasyImportPending ?? 0;
  return [
    {
      label: "Total Clients",
      value: dashboard ? String(dashboard.stats.totalClients ?? 0) : "0",
      icon: Users,
      iconClass: "bg-sky-50 text-sky-600",
      badge: "Live",
      badgeClass: "bg-slate-100 text-slate-700",
      helper: "current records in the system",
      to: "/app/clients",
    },
    {
      label: "Active Cases",
      value: dashboard ? String(dashboard.stats.openCases ?? 0) : "0",
      icon: BriefcaseBusiness,
      iconClass: "bg-emerald-50 text-emerald-600",
      badge: "Live",
      badgeClass: "bg-slate-100 text-slate-700",
      helper: "currently open cases",
      to: "/app/cases",
    },
    {
      label: "Pending Documents",
      value: dashboard ? String(dashboard.stats.pendingDocuments ?? 0) : "0",
      icon: FileClock,
      iconClass: "bg-amber-50 text-amber-600",
      badge: "Live",
      badgeClass: "bg-slate-100 text-slate-700",
      helper: "documents awaiting action",
      onClick: () => onOpenDrawer("documents"),
    },
    {
      label: "Tasks Due Today",
      value: dashboard ? String(dashboard.stats.tasksDueToday ?? 0) : "0",
      icon: ListChecks,
      iconClass: "bg-sky-50 text-sky-600",
      badge: "Live",
      badgeClass: "bg-slate-100 text-slate-700",
      helper: "workflow actions due today",
      onClick: () => onOpenDrawer("tasksToday"),
    },
    {
      label: "Overdue Tasks",
      value: dashboard ? String(dashboard.stats.overdueTasks ?? 0) : "0",
      icon: CircleAlert,
      iconClass: "bg-rose-50 text-rose-600",
      badge: "Live",
      badgeClass: "bg-slate-100 text-slate-700",
      helper: "workflow actions past due",
      onClick: () => onOpenDrawer("tasksOverdue"),
    },
    {
      label: "Follow-ups Today",
      value: dashboard ? String(dashboard.stats.followUpsDueToday ?? 0) : "0",
      icon: CalendarClock,
      iconClass: "bg-sky-50 text-sky-600",
      badge: "Live",
      badgeClass: "bg-slate-100 text-slate-700",
      helper: "client follow-ups scheduled today",
      onClick: () => onOpenDrawer("followUpsToday"),
    },
    {
      label: "Appointments Today",
      value: dashboard ? String(dashboard.stats.appointmentsToday ?? 0) : "0",
      icon: CalendarDays,
      iconClass: "bg-violet-50 text-violet-600",
      badge: "Live",
      badgeClass: "bg-slate-100 text-slate-700",
      helper: "scheduled calls and meetings",
      onClick: onFocusScheduling,
    },
    // Previously invisible anywhere outside /app/case-easy-import itself —
    // only rendered once there's actually an unconverted queue, so an
    // agency with nothing to migrate doesn't carry a permanent empty tile.
    ...(caseEasyImportPending > 0
      ? [
          {
            label: "Case Easy Records Pending",
            value: String(caseEasyImportPending),
            icon: UsersRound,
            iconClass: "bg-rose-50 text-rose-600",
            badge: "Legacy",
            badgeClass: "bg-rose-100 text-rose-700",
            helper: dashboard?.stats?.caseEasyImportNeedsReview
              ? `${dashboard.stats.caseEasyImportNeedsReview} need manual review`
              : "not yet converted to clients",
            to: "/app/case-easy-import",
          },
        ]
      : []),
  ];
}

function DashboardStatsSkeleton() {
  return (
    <section aria-label="Dashboard overview" className="mb-6 w-full">
      <div className="grid w-full grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
        {Array.from({ length: 7 }).map((_, index) => (
          <article
            key={`dashboard-stat-skeleton-${index}`}
            className="min-w-0 rounded-2xl border border-slate-200/70 bg-white/80 p-3 shadow-sm backdrop-blur-xl"
          >
            <div className="flex items-start justify-between gap-2 animate-pulse">
              <div className="flex h-9 w-9 rounded-xl bg-slate-100" />
              <div className="h-5 w-14 rounded-full bg-slate-100" />
            </div>
            <div className="mt-3 animate-pulse space-y-2">
              <div className="h-3 w-24 rounded bg-slate-100" />
              <div className="h-7 w-20 rounded bg-slate-100" />
            </div>
            <div className="mt-2 h-3 w-20 animate-pulse rounded bg-slate-100" />
          </article>
        ))}
      </div>
    </section>
  );
}

export default function DashboardStats({ dashboard, loading, onOpenDrawer, onFocusScheduling }) {
  if (loading) {
    return <DashboardStatsSkeleton />;
  }

  const stats = getStats(dashboard, { onOpenDrawer, onFocusScheduling });

  return (
    <section aria-label="Dashboard overview" className="mb-6 w-full">
      <div className="grid w-full grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
        {stats.map((stat) => {
          const Icon = stat.icon;
          const Tag = stat.to ? Link : "button";
          return (
            <Tag
              key={stat.label}
              type={stat.to ? undefined : "button"}
              to={stat.to}
              onClick={stat.onClick}
              className={[
                "min-w-0 rounded-2xl border border-slate-200/70 bg-white/80 p-3 text-left shadow-sm backdrop-blur-xl transition-all duration-200 hover:-translate-y-0.5 hover:border-sky-200 hover:shadow-md",
                stat.cardClass ?? "",
              ].join(" ")}
            >
              <div className="flex items-start justify-between gap-2">
                <div className={["flex h-9 w-9 items-center justify-center rounded-xl", stat.iconClass].join(" ")}>
                  <Icon className="h-4 w-4" />
                </div>
                <span className={["rounded-full px-2 py-0.5 text-[10px] font-semibold", stat.badgeClass].join(" ")}>
                  {stat.badge}
                </span>
              </div>

              <div className="mt-3 min-w-0">
                <p className="truncate text-xs font-medium text-slate-500">{stat.label}</p>
                <p
                  className={[
                    "mt-1 text-xl font-semibold tracking-tight text-slate-950",
                    "",
                  ].join(" ")}
                >
                  {stat.value}
                </p>
              </div>

              <p className="mt-2 text-[11px] text-slate-400">{stat.helper}</p>
            </Tag>
          );
        })}
      </div>
    </section>
  );
}
