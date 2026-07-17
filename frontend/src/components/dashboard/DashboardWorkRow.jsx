import {
  ArrowRight,
  CalendarDays,
  CircleAlert,
  FolderKanban,
  ListChecks,
} from "lucide-react";
import { Link } from "react-router-dom";

const toneStyles = {
  info: "border-sky-100 bg-sky-50 text-sky-700",
  success: "border-emerald-100 bg-emerald-50 text-emerald-700",
  warning: "border-amber-100 bg-amber-50 text-amber-700",
  urgent: "border-rose-100 bg-rose-50 text-rose-700",
};

const pipelineColors = ["bg-sky-400", "bg-emerald-400", "bg-violet-400", "bg-amber-400", "bg-rose-400"];

function formatDate(value, timezone, options) {
  if (!value) return "Not scheduled";
  return new Intl.DateTimeFormat("en-CA", { timeZone: timezone, ...options }).format(new Date(value));
}

function initials(name) {
  return String(name || "Case")
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
}

function taskItem(task, tone, badge) {
  return {
    id: `task-${task.id}`,
    to: `/app/cases/${task.case.id}`,
    client: task.case.client.fullName,
    caseType: task.case.caseType,
    title: task.title,
    detail: task.description || `${task.priority} priority task`,
    dueAt: task.dueAt,
    initials: initials(task.case.client.fullName),
    tone,
    badge,
  };
}

function buildWorkItems(dashboard) {
  const overdue = (dashboard?.overdueTasks || []).map((task) => taskItem(task, "urgent", "Overdue"));
  const today = (dashboard?.todayTasks || []).map((task) => taskItem(task, "info", "Due today"));
  const documents = (dashboard?.documentActions || []).map((document) => ({
    id: `document-${document.id}`,
    to: document.case ? `/app/cases/${document.case.id}` : `/app/clients/${document.client.id}`,
    client: document.client.fullName,
    caseType: document.case?.caseType || "Client document",
    title: document.documentName,
    detail: `Document status: ${document.status.replace(/([a-z])([A-Z])/g, "$1 $2")}`,
    dueAt: document.updatedAt,
    initials: initials(document.client.fullName),
    tone: "warning",
    badge: "Document",
  }));
  const waiting = (dashboard?.casesWaitingUpdate || []).map((caseRecord) => ({
    id: `case-${caseRecord.id}`,
    to: `/app/cases/${caseRecord.id}`,
    client: caseRecord.client.fullName,
    caseType: caseRecord.caseType,
    title: "Case needs a next action",
    detail: caseRecord.nextAction || "No pending workflow step or next action is recorded.",
    dueAt: caseRecord.updatedAt,
    initials: initials(caseRecord.client.fullName),
    tone: "warning",
    badge: "Needs update",
  }));
  return {
    overdue: overdue.slice(0, 4),
    current: [...today, ...documents, ...waiting].slice(0, 5),
  };
}

function SectionHeader({ icon: Icon, iconClass, title, subtitle, chip, chipClass }) {
  return (
    <div className="mb-4 flex items-start justify-between gap-3">
      <div className="flex items-start gap-3">
        <div className={["flex h-10 w-10 items-center justify-center rounded-2xl", iconClass].join(" ")}>
          <Icon className="h-5 w-5" />
        </div>
        <div>
          <h2 className="text-base font-semibold text-slate-950">{title}</h2>
          <p className="mt-0.5 text-xs text-slate-500">{subtitle}</p>
        </div>
      </div>
      <span className={chipClass}>{chip}</span>
    </div>
  );
}

function EmptyState({ loading, children }) {
  return <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50/60 p-4 text-sm text-slate-500">{loading ? "Loading…" : children}</div>;
}

function WorkItemRow({ item, timezone }) {
  return (
    <Link to={item.to} className="flex items-start gap-3 rounded-2xl border border-slate-100 bg-white/70 p-3.5 transition hover:border-sky-200 hover:bg-slate-50/80">
      <div className={["flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl text-xs font-bold", toneStyles[item.tone]].join(" ")}>{item.initials}</div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-slate-900">{item.client}</p>
        <p className="truncate text-xs text-slate-500">{item.caseType}</p>
        <p className="mt-1 text-sm font-medium text-slate-800">{item.title}</p>
        <p className="mt-0.5 line-clamp-1 text-xs text-slate-500">{item.detail}</p>
      </div>
      <div className="shrink-0 text-right">
        <span className={["rounded-full border px-2.5 py-1 text-[11px] font-semibold", toneStyles[item.tone]].join(" ")}>{item.badge}</span>
        <p className="mt-1 text-[11px] text-slate-400">{formatDate(item.dueAt, timezone, { month: "short", day: "numeric" })}</p>
      </div>
    </Link>
  );
}

export default function DashboardWorkRow({ dashboard, loading, role }) {
  const isAdmin = role === "admin";
  const timezone = dashboard?.timezone || "America/Toronto";
  const appointments = dashboard?.upcomingAppointments || [];
  const workItems = buildWorkItems(dashboard);
  const pipelineStages = dashboard?.casePipeline || [];
  const pipelineMax = Math.max(...pipelineStages.map((stage) => stage.count), 1);
  const workCount = (dashboard?.stats?.tasksDueToday || 0)
    + (dashboard?.stats?.overdueTasks || 0)
    + (dashboard?.stats?.pendingDocuments || 0)
    + (dashboard?.stats?.casesWaitingUpdate || 0);

  return (
    <section aria-label="Dashboard work overview" className="mb-6 grid grid-cols-1 items-stretch gap-4 xl:grid-cols-12">
      <article className="flex h-full flex-col rounded-3xl border border-slate-200/70 bg-white/80 p-5 shadow-sm xl:col-span-3">
        <SectionHeader
          icon={CalendarDays}
          iconClass="bg-sky-50 text-sky-600"
          title="Upcoming Appointments"
          subtitle="Your next scheduled calls and meetings"
          chip={`${dashboard?.stats?.appointmentsToday || 0} today`}
          chipClass="rounded-full bg-sky-50 px-2.5 py-1 text-xs font-semibold text-sky-700"
        />
        <div className="flex-1 space-y-3">
          {appointments.length ? appointments.map((item) => (
            <Link key={item.id} to={`/app/cases/${item.case.id}`} className="flex items-start gap-3 rounded-2xl border border-slate-100 bg-slate-50/60 p-3 transition hover:border-sky-200 hover:bg-sky-50/60">
              <div className="w-16 shrink-0 pt-0.5 text-xs font-semibold text-slate-950">
                {formatDate(item.startsAt, timezone, { month: "short", day: "numeric" })}
                <span className="mt-0.5 block font-normal text-slate-500">{formatDate(item.startsAt, timezone, { hour: "numeric", minute: "2-digit" })}</span>
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-slate-800">{item.case.client.fullName}</p>
                <p className="mt-0.5 line-clamp-2 text-xs text-slate-500">{item.subject}</p>
              </div>
            </Link>
          )) : <EmptyState loading={loading}>No upcoming appointments.</EmptyState>}
        </div>
        <div className="mt-4 border-t border-slate-100 pt-4">
          <Link to="/app/cases" className="inline-flex items-center gap-1 text-xs font-semibold text-sky-700 hover:text-sky-800">Open cases <ArrowRight className="h-3.5 w-3.5" /></Link>
        </div>
      </article>

      <article className="flex h-full flex-col rounded-3xl border border-slate-200/70 bg-white/80 p-5 shadow-sm xl:col-span-5">
        <SectionHeader
          icon={ListChecks}
          iconClass="bg-sky-50 text-sky-600"
          title="Priority Work"
          subtitle={isAdmin ? "Overdue and current actions across your workspace" : "Overdue and current actions on your cases"}
          chip={`${workCount} open`}
          chipClass="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600"
        />
        <div className="flex-1 space-y-3">
          {workItems.overdue.length ? <p className="px-1 text-[11px] font-bold uppercase tracking-[0.14em] text-rose-600">Overdue work</p> : null}
          {workItems.overdue.map((item) => <WorkItemRow key={item.id} item={item} timezone={timezone} />)}
          {workItems.current.length ? <p className="px-1 pt-1 text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500">Today and queued actions</p> : null}
          {workItems.current.map((item) => <WorkItemRow key={item.id} item={item} timezone={timezone} />)}
          {!workItems.overdue.length && !workItems.current.length ? <EmptyState loading={loading}>You have no open work items.</EmptyState> : null}
        </div>
        <div className="mt-4 border-t border-slate-100 pt-4">
          <Link to="/app/workload" className="inline-flex items-center gap-1 text-xs font-semibold text-sky-700 hover:text-sky-800">{isAdmin ? "View team workload" : "View all my work"} <ArrowRight className="h-3.5 w-3.5" /></Link>
        </div>
      </article>

      <article className="flex h-full flex-col rounded-3xl border border-slate-200/70 bg-white/80 p-5 shadow-sm xl:col-span-4">
        <SectionHeader
          icon={FolderKanban}
          iconClass="bg-emerald-50 text-emerald-600"
          title="Case Pipeline"
          subtitle="Current stage of your open cases"
          chip={`${dashboard?.stats?.openCases || 0} cases`}
          chipClass="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700"
        />
        <div className="flex-1 space-y-3">
          {pipelineStages.length ? pipelineStages.map((stage, index) => (
            <div key={stage.stage}>
              <div className="mb-1.5 flex items-center justify-between text-xs"><span className="font-medium text-slate-600">{stage.stage}</span><span className="font-semibold text-slate-900">{stage.count}</span></div>
              <div className="h-2 rounded-full bg-slate-100"><div className={["h-2 rounded-full", pipelineColors[index % pipelineColors.length]].join(" ")} style={{ width: `${(stage.count / pipelineMax) * 100}%` }} /></div>
            </div>
          )) : <EmptyState loading={loading}>No open cases in the pipeline.</EmptyState>}
          {(dashboard?.stats?.casesWaitingUpdate || 0) > 0 ? (
            <div className="mt-4 flex items-center gap-2 rounded-2xl border border-amber-100 bg-amber-50 p-3 text-xs font-medium text-amber-800">
              <CircleAlert className="h-4 w-4" />{dashboard.stats.casesWaitingUpdate} cases need a next action.
            </div>
          ) : null}
        </div>
        <div className="mt-4 border-t border-slate-100 pt-4">
          <Link to="/app/cases" className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700 hover:text-emerald-800">View full pipeline <ArrowRight className="h-3.5 w-3.5" /></Link>
        </div>
      </article>
    </section>
  );
}
