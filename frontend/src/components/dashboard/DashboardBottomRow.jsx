import {
  Activity,
  ArrowRight,
  CalendarClock,
  CircleAlert,
  FileClock,
  FolderClock,
} from "lucide-react";
import { Link } from "react-router-dom";

function formatDate(value, timezone, includeTime = false) {
  if (!value) return "No date";
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    month: "short",
    day: "numeric",
    ...(includeTime ? { hour: "numeric", minute: "2-digit" } : {}),
  }).format(new Date(value));
}

function dayKey(value, timezone) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(value));
}

function isBeforeToday(dueDate, timezone) {
  return Boolean(dueDate) && dayKey(dueDate, timezone) < dayKey(new Date(), timezone);
}

function followUpTone(dueDate, timezone) {
  if (!dueDate) return "border-slate-200 bg-slate-50 text-slate-600";
  return isBeforeToday(dueDate, timezone)
    ? "border-rose-100 bg-rose-50 text-rose-700"
    : "border-sky-100 bg-sky-50 text-sky-700";
}

function SectionHeader({ icon: Icon, iconClass, title, subtitle, chip, chipClass }) {
  return (
    <div className="mb-4 flex items-start justify-between gap-3">
      <div className="flex items-start gap-3">
        <div className={["flex h-10 w-10 items-center justify-center rounded-2xl", iconClass].join(" ")}><Icon className="h-5 w-5" /></div>
        <div><h2 className="text-base font-semibold text-slate-950">{title}</h2><p className="mt-0.5 text-xs text-slate-500">{subtitle}</p></div>
      </div>
      <span className={chipClass}>{chip}</span>
    </div>
  );
}

function EmptyState({ loading, children }) {
  return <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50/60 p-4 text-sm text-slate-500">{loading ? "Loading…" : children}</div>;
}

function followUpLink(item) {
  return item.case ? `/app/cases/${item.case.id}?tab=reminders&highlight=${item.id}` : `/app/follow-ups?highlight=${item.id}`;
}

function FollowUpRow({ item, timezone, overdue }) {
  return (
    <Link to={followUpLink(item)} className="grid grid-cols-1 gap-3 rounded-2xl border border-slate-100 bg-white/70 p-3 transition hover:border-sky-200 hover:bg-slate-50/80 md:grid-cols-12 md:items-center">
      <div className="md:col-span-3"><p className="text-xs font-semibold text-slate-800">{formatDate(item.dueDate, timezone, true)}</p><p className="text-[11px] text-slate-400">{item.status}</p></div>
      <div className="min-w-0 md:col-span-6"><p className="truncate text-sm font-semibold text-slate-900">{item.client?.fullName || item.case?.caseType || "General follow-up"}</p><p className="mt-0.5 truncate text-xs text-slate-500">{item.title}</p></div>
      <div className="md:col-span-3 md:text-right"><span className={["rounded-full border px-2.5 py-1 text-[11px] font-semibold", followUpTone(item.dueDate, timezone)].join(" ")}>{overdue ? "Overdue" : "Upcoming"}</span></div>
    </Link>
  );
}

export default function DashboardBottomRow({ dashboard, loading }) {
  const timezone = dashboard?.timezone || "America/Toronto";
  const casesWaiting = dashboard?.casesWaitingUpdate || [];
  const followUps = dashboard?.upcomingFollowUps || [];
  const overdueFollowUps = followUps.filter((item) => isBeforeToday(item.dueDate, timezone));
  const currentFollowUps = followUps.filter((item) => !isBeforeToday(item.dueDate, timezone));
  const activityItems = dashboard?.recentActivity || [];

  return (
    <section aria-label="Dashboard action overview" className="mb-6 grid grid-cols-1 items-stretch gap-4 xl:grid-cols-12">
      <article className="flex h-full flex-col rounded-3xl border border-slate-200/70 bg-white/80 p-5 shadow-sm xl:col-span-4">
        <SectionHeader
          icon={FolderClock}
          iconClass="bg-amber-50 text-amber-600"
          title="Cases Waiting for Update"
          subtitle="Open files without a clear next action"
          chip={`${dashboard?.stats?.casesWaitingUpdate || 0} cases`}
          chipClass="rounded-full bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-700"
        />
        <div className="flex-1 space-y-3">
          {casesWaiting.length ? casesWaiting.map((item) => (
            <Link key={item.id} to={`/app/cases/${item.id}`} className="block rounded-2xl border border-slate-100 bg-white/70 p-3 transition hover:border-amber-200 hover:bg-amber-50/40">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0"><p className="truncate text-sm font-semibold text-slate-900">{item.client.fullName}</p><p className="truncate text-xs text-slate-500">{item.caseType} · {item.stage}</p></div>
                <span className="whitespace-nowrap text-[11px] text-slate-400">Updated {formatDate(item.updatedAt, timezone)}</span>
              </div>
              <p className="mt-2 flex items-center gap-1.5 text-xs font-medium text-amber-700"><CircleAlert className="h-3.5 w-3.5" />Set a next action or task</p>
            </Link>
          )) : <EmptyState loading={loading}>Every open case has a next action.</EmptyState>}
        </div>
        <div className="mt-4 border-t border-slate-100 pt-4"><Link to="/app/cases" className="inline-flex items-center gap-1 text-xs font-semibold text-amber-700 hover:text-amber-800">Review cases <ArrowRight className="h-3.5 w-3.5" /></Link></div>
      </article>

      <article className="flex h-full flex-col rounded-3xl border border-slate-200/70 bg-white/80 p-5 shadow-sm xl:col-span-5">
        <SectionHeader
          icon={CalendarClock}
          iconClass="bg-sky-50 text-sky-600"
          title="Upcoming / Overdue Follow-ups"
          subtitle="Client follow-ups that need attention"
          chip={`${dashboard?.stats?.overdueFollowUps || 0} overdue`}
          chipClass={(dashboard?.stats?.overdueFollowUps || 0) > 0 ? "rounded-full bg-rose-50 px-2.5 py-1 text-xs font-semibold text-rose-700" : "rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-700"}
        />
        <div className="flex-1 space-y-3">
          {overdueFollowUps.length ? <p className="px-1 text-[11px] font-bold uppercase tracking-[0.14em] text-rose-600">Overdue</p> : null}
          {overdueFollowUps.map((item) => <FollowUpRow key={item.id} item={item} timezone={timezone} overdue />)}
          {currentFollowUps.length ? <p className="px-1 pt-1 text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500">Today and upcoming</p> : null}
          {currentFollowUps.map((item) => <FollowUpRow key={item.id} item={item} timezone={timezone} overdue={false} />)}
          {!followUps.length ? <EmptyState loading={loading}>No open follow-ups.</EmptyState> : null}
        </div>
        <div className="mt-4 border-t border-slate-100 pt-4"><Link to="/app/follow-ups" className="inline-flex items-center gap-1 text-xs font-semibold text-sky-700 hover:text-sky-800">View all follow-ups <ArrowRight className="h-3.5 w-3.5" /></Link></div>
      </article>

      <article className="flex h-full flex-col rounded-3xl border border-slate-200/70 bg-white/80 p-5 shadow-sm xl:col-span-3">
        <SectionHeader
          icon={Activity}
          iconClass="bg-violet-50 text-violet-600"
          title="Recent Activity"
          subtitle="Updates on your clients and cases"
          chip="Live"
          chipClass="rounded-full bg-violet-50 px-2.5 py-1 text-xs font-semibold text-violet-700"
        />
        <div className="flex-1 space-y-3">
          {activityItems.length ? activityItems.map((item) => {
            const target = item.case ? `/app/cases/${item.case.id}` : item.client ? `/app/clients/${item.client.id}` : "/app/dashboard";
            return (
              <Link key={item.id} to={target} className="flex items-start gap-3 rounded-2xl border border-slate-100 bg-white/70 p-3 transition hover:border-violet-200 hover:bg-violet-50/30">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl bg-violet-50 text-violet-700">{item.action.includes("DOCUMENT") ? <FileClock className="h-4 w-4" /> : <Activity className="h-4 w-4" />}</div>
                <div className="min-w-0"><p className="line-clamp-2 text-sm font-medium text-slate-800">{item.details || item.action.replaceAll("_", " ")}</p><p className="mt-0.5 truncate text-xs text-slate-500">{item.user?.fullName || "System"} · {formatDate(item.createdAt, timezone, true)}</p></div>
              </Link>
            );
          }) : <EmptyState loading={loading}>No recent case activity.</EmptyState>}
        </div>
      </article>
    </section>
  );
}
