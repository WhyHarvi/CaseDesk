import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, ArrowRight, BriefcaseBusiness, CalendarClock, CalendarDays, ChevronDown, FileClock, ListChecks, RefreshCw, Search, UserRound } from "lucide-react";
import { Link } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import PageContainer from "../components/layout/PageContainer";
import api from "../services/api";

function formatDate(value) {
  if (!value) return "No due date";
  return new Intl.DateTimeFormat("en-CA", { month: "short", day: "numeric", year: "numeric" }).format(new Date(value));
}

function Metric({ label, value, tone = "slate" }) {
  const tones = {
    slate: "bg-slate-50 text-slate-900",
    sky: "bg-sky-50 text-sky-800",
    amber: "bg-amber-50 text-amber-800",
    rose: "bg-rose-50 text-rose-800",
    emerald: "bg-emerald-50 text-emerald-800",
  };
  return <div className={["rounded-3xl border border-white p-5 shadow-sm", tones[tone]].join(" ")}><p className="text-sm opacity-70">{label}</p><p className="mt-2 text-3xl font-semibold">{value}</p></div>;
}

function WorkSection({ icon: Icon, title, count, empty, children, tone = "sky" }) {
  const iconTone = tone === "rose" ? "bg-rose-50 text-rose-700" : tone === "amber" ? "bg-amber-50 text-amber-700" : "bg-sky-50 text-sky-700";
  return (
    <article className="rounded-3xl border border-slate-200/70 bg-white/80 p-5 shadow-sm">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3"><div className={["flex h-10 w-10 items-center justify-center rounded-2xl", iconTone].join(" ")}><Icon className="h-5 w-5" /></div><h2 className="font-semibold text-slate-950">{title}</h2></div>
        <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600">{count}</span>
      </div>
      <div className="space-y-2">{count ? children : <p className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-4 text-sm text-slate-500">{empty}</p>}</div>
    </article>
  );
}

function TaskRow({ item, overdue = false }) {
  const inherited = ["case_owner", "case_assignment"].includes(item.assignmentSource);
  return (
    <Link to={`/app/cases/${item.case.id}`} className="flex items-start justify-between gap-3 rounded-2xl border border-slate-100 p-3 transition hover:border-sky-200 hover:bg-sky-50/30">
      <div className="min-w-0"><p className="truncate text-sm font-semibold text-slate-900">{item.title}</p><p className="mt-0.5 truncate text-xs text-slate-500">{item.case.client.fullName} · {item.case.caseType}</p>{inherited ? <p className="mt-1 text-[10px] font-semibold uppercase tracking-wide text-sky-600">Inherited from case owner</p> : null}</div>
      <div className="shrink-0 text-right"><p className={overdue ? "text-xs font-semibold text-rose-700" : "text-xs font-medium text-slate-600"}>{formatDate(item.dueAt)}</p><p className="mt-0.5 text-[11px] text-slate-400">{item.priority}</p></div>
    </Link>
  );
}

function CaseRow({ item }) {
  return <Link to={`/app/cases/${item.id}`} className="flex items-center justify-between gap-3 rounded-2xl border border-slate-100 p-3 transition hover:border-sky-200 hover:bg-sky-50/30"><div className="min-w-0"><p className="truncate text-sm font-semibold text-slate-900">{item.client.fullName}</p><p className="truncate text-xs text-slate-500">{item.caseType} · {item.stage}</p></div><ArrowRight className="h-4 w-4 shrink-0 text-slate-400" /></Link>;
}

function DocumentRow({ item }) {
  const target = item.case ? `/app/cases/${item.case.id}` : `/app/clients/${item.client.id}`;
  return <Link to={target} className="flex items-center justify-between gap-3 rounded-2xl border border-slate-100 p-3 transition hover:border-amber-200 hover:bg-amber-50/30"><div className="min-w-0"><p className="truncate text-sm font-semibold text-slate-900">{item.documentName}</p><p className="truncate text-xs text-slate-500">{item.client.fullName}{item.case ? ` · ${item.case.caseType}` : ""}</p></div><ArrowRight className="h-4 w-4 shrink-0 text-slate-400" /></Link>;
}

function FollowUpRow({ item }) {
  const target = item.case ? `/app/cases/${item.case.id}` : "/app/follow-ups";
  return <Link to={target} className="flex items-start justify-between gap-3 rounded-2xl border border-slate-100 p-3 transition hover:border-violet-200 hover:bg-violet-50/30"><div className="min-w-0"><p className="truncate text-sm font-semibold text-slate-900">{item.title}</p><p className="truncate text-xs text-slate-500">{item.client?.fullName || item.case?.client?.fullName || "General follow-up"}</p></div><p className="shrink-0 text-xs font-medium text-slate-600">{formatDate(item.dueDate)}</p></Link>;
}

function AppointmentRow({ item }) {
  return <Link to={`/app/cases/${item.case.id}`} className="flex items-start justify-between gap-3 rounded-2xl border border-slate-100 p-3 transition hover:border-emerald-200 hover:bg-emerald-50/30"><div className="min-w-0"><p className="truncate text-sm font-semibold text-slate-900">{item.subject}</p><p className="truncate text-xs text-slate-500">{item.client.fullName} · {item.case.caseType}</p></div><p className="shrink-0 text-xs font-medium text-slate-600">{formatDate(item.startsAt)}</p></Link>;
}

function WorkDetails({ workload }) {
  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <WorkSection icon={AlertTriangle} title="Overdue Tasks" count={workload.overdueTasks} empty="No overdue tasks." tone="rose">
        {workload.overdueTaskItems.map((item) => <TaskRow key={item.id} item={item} overdue />)}
      </WorkSection>
      <WorkSection icon={ListChecks} title="Pending Tasks" count={workload.pendingTasks - workload.overdueTasks} empty="No upcoming tasks.">
        {workload.pendingTaskItems.map((item) => <TaskRow key={item.id} item={item} />)}
      </WorkSection>
      <WorkSection icon={FileClock} title="Documents Needing Action" count={workload.documentsWaitingReview} empty="No documents need attention." tone="amber">
        {workload.documentReviewItems.map((item) => <DocumentRow key={item.id} item={item} />)}
      </WorkSection>
      <WorkSection icon={BriefcaseBusiness} title="Active Cases" count={workload.activeCases} empty="No active cases.">
        {workload.activeCaseItems.map((item) => <CaseRow key={item.id} item={item} />)}
      </WorkSection>
      <WorkSection icon={CalendarClock} title="Open Follow-ups" count={workload.pendingFollowUps} empty="No open follow-ups.">
        {workload.followUpItems.map((item) => <FollowUpRow key={item.id} item={item} />)}
      </WorkSection>
      <WorkSection icon={CalendarDays} title="Upcoming Appointments" count={workload.upcomingAppointments} empty="No upcoming appointments." tone="amber">
        {workload.appointmentItems.map((item) => <AppointmentRow key={item.id} item={item} />)}
      </WorkSection>
    </div>
  );
}

function ConsultantWorkloadCard({ workload, open, onToggle }) {
  const riskTone = workload.overdueTasks > 0 ? "text-rose-700 bg-rose-50" : workload.workloadPercentage >= 90 ? "text-amber-700 bg-amber-50" : "text-emerald-700 bg-emerald-50";
  return (
    <article className="overflow-hidden rounded-3xl border border-slate-200/70 bg-white/85 shadow-sm">
      <button type="button" onClick={onToggle} className="grid w-full gap-4 p-5 text-left transition hover:bg-slate-50/70 lg:grid-cols-[minmax(220px,1.4fr)_repeat(4,minmax(90px,.55fr))_44px] lg:items-center">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-sky-50 font-semibold text-sky-700"><UserRound className="h-5 w-5" /></div>
          <div className="min-w-0"><p className="truncate font-semibold text-slate-950">{workload.consultant.fullName}</p><p className="truncate text-xs text-slate-500">{workload.profile.masteryLevel || workload.consultant.email}</p></div>
        </div>
        <div><p className="text-xs text-slate-400">Capacity</p><p className="mt-1 text-sm font-semibold text-slate-800">{workload.activeCases} / {workload.capacity}</p><div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100"><div className={workload.workloadPercentage >= 100 ? "h-full rounded-full bg-rose-500" : workload.workloadPercentage >= 75 ? "h-full rounded-full bg-amber-400" : "h-full rounded-full bg-emerald-500"} style={{ width: `${Math.min(workload.workloadPercentage, 100)}%` }} /></div></div>
        <div><p className="text-xs text-slate-400">Pending tasks</p><p className="mt-1 text-xl font-semibold text-slate-900">{workload.pendingTasks}</p></div>
        <div><p className="text-xs text-slate-400">Overdue</p><p className="mt-1 text-xl font-semibold text-rose-700">{workload.overdueTasks}</p></div>
        <div><p className="text-xs text-slate-400">Documents</p><p className="mt-1 text-xl font-semibold text-amber-700">{workload.documentsWaitingReview}</p></div>
        <div className={["flex h-10 w-10 items-center justify-center rounded-full", riskTone].join(" ")}><ChevronDown className={["h-5 w-5 transition", open ? "rotate-180" : ""].join(" ")} /></div>
      </button>
      {open ? <div className="border-t border-slate-100 bg-slate-50/45 p-5"><WorkDetails workload={workload} /></div> : null}
    </article>
  );
}

function TeamWorkload({ data }) {
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState(() => new Set());
  const totalWork = (bucket) => bucket.activeCases + bucket.pendingTasks + bucket.documentsWaitingReview + bucket.pendingFollowUps + bucket.upcomingAppointments;
  const unassignedCount = totalWork(data.unassigned);
  const outsideTeamCount = totalWork(data.outsideTeam);
  const visibleConsultants = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return [...data.consultants]
      .filter((item) => !needle || [item.consultant.fullName, item.consultant.email, item.profile.masteryLevel, ...(item.profile.specializations || [])].some((value) => String(value || "").toLowerCase().includes(needle)))
      .sort((left, right) => right.overdueTasks - left.overdueTasks || right.workloadPercentage - left.workloadPercentage || left.consultant.fullName.localeCompare(right.consultant.fullName));
  }, [data.consultants, query]);
  const toggle = (id) => setExpanded((current) => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4 2xl:grid-cols-8">
        <Metric label="Active consultants" value={data.summary.activeConsultants} tone="sky" />
        <Metric label="Case assignments" value={data.summary.activeCases} />
        <Metric label="Pending tasks" value={data.summary.pendingTasks} />
        <Metric label="Overdue tasks" value={data.summary.overdueTasks} tone={data.summary.overdueTasks ? "rose" : "slate"} />
        <Metric label="Documents needing action" value={data.summary.documentsWaitingReview} tone={data.summary.documentsWaitingReview ? "amber" : "slate"} />
        <Metric label="Open follow-ups" value={data.summary.pendingFollowUps} />
        <Metric label="Appointments" value={data.summary.upcomingAppointments} />
        <Metric label="Unassigned work" value={unassignedCount} tone={unassignedCount ? "rose" : "emerald"} />
      </div>

      {unassignedCount ? (
        <section className="rounded-3xl border border-rose-200 bg-rose-50/70 p-5">
          <div className="mb-4 flex items-start gap-3"><div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-white text-rose-700"><AlertTriangle className="h-5 w-5" /></div><div><h2 className="font-semibold text-rose-950">Unassigned work needs an owner</h2><p className="mt-1 text-sm text-rose-700">These items have neither an active direct assignee nor an active inherited case or client owner.</p></div></div>
          <WorkDetails workload={data.unassigned} />
        </section>
      ) : null}

      {outsideTeamCount ? (
        <section className="rounded-3xl border border-violet-200 bg-violet-50/70 p-5">
          <div className="mb-4"><h2 className="font-semibold text-violet-950">Work owned outside the consultant roster</h2><p className="mt-1 text-sm text-violet-700">These items belong to active internal staff who are not part of this consultant capacity view, so they are not unassigned.</p></div>
          <WorkDetails workload={data.outsideTeam} />
        </section>
      ) : null}

      <section className="space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div><h2 className="text-xl font-semibold text-slate-950">Consultant workload</h2><p className="mt-1 text-sm text-slate-500">Open a consultant to see their current cases, tasks, and review queue.</p></div>
          <label className="relative block w-full sm:w-80"><Search className="absolute left-3.5 top-3 h-4 w-4 text-slate-400" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search consultants" className="h-10 w-full rounded-full border border-slate-200 bg-white pl-10 pr-4 text-sm outline-none focus:border-sky-300 focus:ring-4 focus:ring-sky-100" /></label>
        </div>
        {visibleConsultants.map((item) => <ConsultantWorkloadCard key={item.consultant.id} workload={item} open={expanded.has(item.consultant.id)} onToggle={() => toggle(item.consultant.id)} />)}
        {!visibleConsultants.length ? <div className="rounded-3xl border border-dashed border-slate-200 bg-white/60 p-10 text-center text-sm text-slate-500">{query ? "No consultants match your search." : "No active consultants are available."}</div> : null}
      </section>
    </>
  );
}

function PersonalWorkload({ data }) {
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
        <Metric label="Active cases" value={data.activeCases} tone="sky" />
        <Metric label="Pending tasks" value={data.pendingTasks} />
        <Metric label="Overdue tasks" value={data.overdueTasks} tone={data.overdueTasks ? "rose" : "slate"} />
        <Metric label="Documents needing action" value={data.documentsWaitingReview} tone={data.documentsWaitingReview ? "amber" : "slate"} />
        <Metric label="Case capacity" value={data.capacity} />
        <Metric label="Capacity used" value={`${data.workloadPercentage}%`} tone={data.workloadPercentage >= 90 ? "rose" : data.workloadPercentage >= 70 ? "amber" : "emerald"} />
      </div>
      <WorkDetails workload={data} />
    </>
  );
}

export default function Workload() {
  const { role } = useAuth();
  const isAdmin = role === "admin";
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const loadWorkload = useCallback(async () => {
    try {
      setLoading(true);
      const response = await api.get(isAdmin ? "/admin/consultants/workload" : "/consultants/me/workload");
      setData(response.data.data);
      setError("");
    } catch (requestError) {
      setError(requestError.response?.data?.message || (isAdmin ? "Unable to load the team workload." : "Unable to load your workload."));
    } finally {
      setLoading(false);
    }
  }, [isAdmin]);

  useEffect(() => { loadWorkload(); }, [loadWorkload]);

  return (
    <PageContainer
      title={isAdmin ? "Team Workload" : "My Workload"}
      description={isAdmin ? "See who is handling each case, where capacity is tight, and what needs attention across your agency." : "Your assigned cases, deadlines, and documents requiring review."}
      actions={<button type="button" onClick={loadWorkload} disabled={loading} className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"><RefreshCw className={["h-4 w-4", loading ? "animate-spin" : ""].join(" ")} />Refresh</button>}
    >
      {error ? <div className="flex items-center justify-between gap-4 rounded-3xl border border-rose-200 bg-rose-50 px-5 py-4 text-sm text-rose-700"><span className="flex items-center gap-2"><AlertTriangle className="h-4 w-4" />{error}</span><button type="button" onClick={loadWorkload} className="font-semibold underline">Try again</button></div> : null}
      {loading && !data ? <div className="rounded-3xl border border-slate-200 bg-white p-8 text-sm text-slate-500">Loading {isAdmin ? "team" : "your"} workload…</div> : null}
      {data ? (isAdmin ? <TeamWorkload data={data} /> : <PersonalWorkload data={data} />) : null}
    </PageContainer>
  );
}
