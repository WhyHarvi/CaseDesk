import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, ArrowRight, BriefcaseBusiness, CalendarClock, CalendarDays, FileClock, ListChecks, RefreshCw, UserRoundSearch } from "lucide-react";
import { Link } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import PageContainer from "../components/layout/PageContainer";
import AppointmentProfileOverlay from "../components/appointments/AppointmentProfileOverlay";
import TeamRosterTable from "../components/workload/TeamRosterTable";
import TeamMemberDrawer from "../components/workload/TeamMemberDrawer";
import { moneyFormatter } from "../components/workload/workloadFormat";
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

const SHOWN_LIMIT = 10; // matches the backend's default finalizeBucket sliceLimit
const REVIEW_OVERDUE_DAYS_LABEL = 3; // matches the backend's REVIEW_OVERDUE_DAYS

function WorkSection({ icon: Icon, title, count, empty, children, tone = "sky", caption, onViewAll }) {
  const iconTone = tone === "rose" ? "bg-rose-50 text-rose-700" : tone === "amber" ? "bg-amber-50 text-amber-700" : "bg-sky-50 text-sky-700";
  return (
    <article className="rounded-3xl border border-slate-200/70 bg-white/80 p-5 shadow-sm">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3"><div className={["flex h-10 w-10 items-center justify-center rounded-2xl", iconTone].join(" ")}><Icon className="h-5 w-5" /></div><h2 className="font-semibold text-slate-950">{title}</h2></div>
        <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600">{count}</span>
      </div>
      {caption ? <p className="mb-3 text-[11px] text-slate-400">{caption}</p> : null}
      <div className="space-y-2">{count ? children : <p className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-4 text-sm text-slate-500">{empty}</p>}</div>
      {onViewAll && count > SHOWN_LIMIT ? <button type="button" onClick={onViewAll} className="mt-3 text-xs font-semibold text-sky-700 hover:underline">View all {count} →</button> : null}
    </article>
  );
}

function TaskRow({ item, overdue = false }) {
  const inherited = ["case_owner", "case_assignment"].includes(item.assignmentSource);
  return (
    <Link to={`/app/cases/${item.case.id}?tab=tasks&highlight=${encodeURIComponent(item.id)}`} className="flex items-start justify-between gap-3 rounded-2xl border border-slate-100 p-3 transition hover:border-sky-200 hover:bg-sky-50/30">
      <div className="min-w-0"><p className="truncate text-sm font-semibold text-slate-900">{item.title}</p><p className="mt-0.5 truncate text-xs text-slate-500">{item.case.client.fullName} · {item.case.caseType}</p>{inherited ? <p className="mt-1 text-[10px] font-semibold uppercase tracking-wide text-sky-600">Inherited from case owner</p> : null}</div>
      <div className="shrink-0 text-right"><p className={overdue ? "text-xs font-semibold text-rose-700" : "text-xs font-medium text-slate-600"}>{formatDate(item.dueAt)}</p><p className="mt-0.5 text-[11px] text-slate-400">{item.priority}</p></div>
    </Link>
  );
}

function CaseRow({ item }) {
  return <Link to={`/app/cases/${item.id}`} className="flex items-center justify-between gap-3 rounded-2xl border border-slate-100 p-3 transition hover:border-sky-200 hover:bg-sky-50/30"><div className="min-w-0"><p className="truncate text-sm font-semibold text-slate-900">{item.client.fullName}</p><p className="truncate text-xs text-slate-500">{item.caseType} · {item.stage}{item.assignmentSource && item.assignmentSource !== "primary" ? ` · ${item.assignmentSource}` : ""}</p></div><ArrowRight className="h-4 w-4 shrink-0 text-slate-400" /></Link>;
}

function DocumentRow({ item }) {
  const target = item.case
    ? `/app/cases/${item.case.id}?tab=documents&highlight=${encodeURIComponent(item.id)}`
    : `/app/clients/${item.client.id}?tab=documents&highlight=${encodeURIComponent(item.id)}`;
  return <Link to={target} className="flex items-center justify-between gap-3 rounded-2xl border border-slate-100 p-3 transition hover:border-amber-200 hover:bg-amber-50/30"><div className="min-w-0"><p className="truncate text-sm font-semibold text-slate-900">{item.documentName}</p><p className="truncate text-xs text-slate-500">{item.client.fullName}{item.case ? ` · ${item.case.caseType}` : ""}</p>{item.reviewOverdue ? <p className="mt-1 text-[10px] font-semibold uppercase tracking-wide text-rose-600">Review overdue</p> : null}</div><ArrowRight className="h-4 w-4 shrink-0 text-slate-400" /></Link>;
}

function FollowUpRow({ item, consultantOptions, onReassign }) {
  const isLeadSourced = item.source === "lead" && item.leadId;
  const target = isLeadSourced
    ? `/leads?lead=${encodeURIComponent(item.leadId)}`
    : item.case
      ? `/app/cases/${item.case.id}?tab=reminders&highlight=${encodeURIComponent(item.id)}`
      : `/app/follow-ups?highlight=${encodeURIComponent(item.id)}`;
  return <Link to={target} className="flex items-start justify-between gap-3 rounded-2xl border border-slate-100 p-3 transition hover:border-violet-200 hover:bg-violet-50/30"><div className="min-w-0"><p className="truncate text-sm font-semibold text-slate-900">{item.title}</p><p className="truncate text-xs text-slate-500">{item.client?.fullName || item.case?.client?.fullName || "General follow-up"}</p>{isLeadSourced ? null : <ReassignControl category="followUp" itemId={item.id} consultantOptions={consultantOptions} onReassign={onReassign} />}</div><p className="shrink-0 text-xs font-medium text-slate-600">{formatDate(item.dueDate)}</p></Link>;
}

function AppointmentRow({ item, onOpen }) {
  const subtitle = item.case ? `${item.client?.fullName || ""} · ${item.case.caseType}` : item.client?.fullName || (item.lead ? [item.lead.firstName, item.lead.lastName].filter(Boolean).join(" ") || item.lead.leadNumber : item.guestName || "Guest appointment");
  return (
    <button type="button" onClick={() => onOpen?.(item.id)} className="flex w-full items-start justify-between gap-3 rounded-2xl border border-slate-100 p-3 text-left transition hover:border-emerald-200 hover:bg-emerald-50/30">
      <div className="min-w-0"><p className="truncate text-sm font-semibold text-slate-900">{item.subject}</p><p className="truncate text-xs text-slate-500">{subtitle}</p></div>
      <div className="shrink-0 text-right"><p className="text-xs font-medium text-slate-600">{formatDate(item.startsAt)}</p>{item.window ? <p className="mt-0.5 text-[11px] uppercase tracking-wide text-slate-400">{item.window === "today" ? "Today" : item.window === "week" ? "This week" : "This month"}</p> : null}</div>
    </button>
  );
}

// Inline reassign control — kept deliberately small (a dropdown + confirm),
// used on rows in the Unassigned section where resolving the item is the
// most valuable single action an admin can take from this page.
function ReassignControl({ category, itemId, consultantOptions, onReassign }) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  if (!onReassign || !consultantOptions?.length) return null;
  if (!open) {
    return (
      <button type="button" onClick={(event) => { event.preventDefault(); event.stopPropagation(); setOpen(true); }} className="mt-1 text-[11px] font-semibold text-sky-700 hover:underline">
        Reassign
      </button>
    );
  }
  return (
    <div className="mt-2 flex items-center gap-2" onClick={(event) => { event.preventDefault(); event.stopPropagation(); }}>
      <select value={selected} onChange={(event) => setSelected(event.target.value)} className="rounded-lg border border-slate-200 px-2 py-1 text-xs">
        <option value="">Assign to…</option>
        {consultantOptions.map((option) => <option key={option.id} value={option.id}>{option.fullName}</option>)}
      </select>
      <button
        type="button"
        disabled={!selected || busy}
        onClick={async () => {
          setBusy(true);
          setError("");
          try {
            await onReassign(category, itemId, selected);
            setOpen(false);
          } catch (requestError) {
            setError(requestError.response?.data?.message || "Couldn't reassign.");
          } finally {
            setBusy(false);
          }
        }}
        className="rounded-lg bg-sky-600 px-2 py-1 text-xs font-semibold text-white disabled:opacity-50"
      >
        {busy ? "Saving…" : "Confirm"}
      </button>
      <button type="button" onClick={() => setOpen(false)} className="text-xs text-slate-400 hover:text-slate-600">Cancel</button>
      {error ? <span className="text-[11px] text-rose-600">{error}</span> : null}
    </div>
  );
}

function LeadRow({ item, consultantOptions, onReassign }) {
  const name = [item.firstName, item.lastName].filter(Boolean).join(" ") || item.leadNumber;
  const overdue = item.nextActionAt && new Date(item.nextActionAt) < new Date();
  return <Link to={`/leads?lead=${encodeURIComponent(item.id)}`} className="flex items-start justify-between gap-3 rounded-2xl border border-slate-100 p-3 transition hover:border-indigo-200 hover:bg-indigo-50/30"><div className="min-w-0"><p className="truncate text-sm font-semibold text-slate-900">{name}</p><p className="truncate text-xs text-slate-500">{item.leadNumber} · {item.stage.replaceAll("_", " ")}</p>{item.nextActionDescription ? <p className="mt-1 truncate text-xs text-slate-500">{item.nextActionDescription}</p> : null}<ReassignControl category="lead" itemId={item.id} consultantOptions={consultantOptions} onReassign={onReassign} /></div><div className="shrink-0 text-right"><p className={overdue ? "text-xs font-semibold text-rose-700" : "text-xs font-medium text-slate-600"}>{formatDate(item.nextActionAt)}</p><p className="mt-0.5 text-[11px] text-slate-400">{item.priority}</p></div></Link>;
}

const CATEGORY_META = {
  lead: { title: "Open Leads", render: (item) => <LeadRow key={item.id} item={item} /> },
  overdueTask: { title: "Overdue Tasks", render: (item) => <TaskRow key={item.id} item={item} overdue /> },
  pendingTask: { title: "Pending Tasks", render: (item) => <TaskRow key={item.id} item={item} /> },
  document: { title: "Ready for Staff Review", render: (item) => <DocumentRow key={item.id} item={item} /> },
  documentWaiting: { title: "Waiting on Client", render: (item) => <DocumentRow key={item.id} item={item} /> },
  case: { title: "Active Cases", render: (item) => <CaseRow key={item.id} item={item} /> },
  collaboratingCase: { title: "Collaborating On", render: (item) => <CaseRow key={item.id} item={item} /> },
  overdueFollowUp: { title: "Overdue Follow-ups", render: (item) => <FollowUpRow key={item.id} item={item} /> },
  followUp: { title: "Open Follow-ups", render: (item) => <FollowUpRow key={item.id} item={item} /> },
  appointment: { title: "Upcoming Appointments", render: (item, onOpenAppointment) => <AppointmentRow key={item.id} item={item} onOpen={onOpenAppointment} /> },
};

function ViewAllDrawer({ consultantKey, category, onClose, onOpenAppointment }) {
  const meta = CATEGORY_META[category];
  const [page, setPage] = useState(1);
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(true);
  const limit = 20;

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api.get(`/admin/consultants/workload/${encodeURIComponent(consultantKey)}/${encodeURIComponent(category)}`, { params: { page, limit } })
      .then((response) => { if (!cancelled) setResult(response.data.data); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [consultantKey, category, page]);

  const totalPages = result ? Math.max(1, Math.ceil(result.total / limit)) : 1;

  return (
    <div className="fixed inset-0 z-50 flex items-stretch justify-end bg-slate-900/40" onClick={onClose}>
      <div className="flex h-full w-full max-w-lg flex-col bg-white shadow-2xl" onClick={(event) => event.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-slate-100 p-5"><h2 className="font-semibold text-slate-950">{meta?.title || "All items"} {result ? `(${result.total})` : ""}</h2><button type="button" onClick={onClose} className="rounded-full px-3 py-1 text-sm font-semibold text-slate-500 hover:bg-slate-50">Close</button></div>
        <div className="flex-1 space-y-2 overflow-y-auto p-5">
          {loading ? <p className="text-sm text-slate-500">Loading…</p> : null}
          {!loading && result?.items?.length ? result.items.map((item) => meta.render(item, onOpenAppointment)) : null}
          {!loading && result && !result.items.length ? <p className="text-sm text-slate-500">Nothing here.</p> : null}
        </div>
        {result && totalPages > 1 ? (
          <div className="flex items-center justify-between border-t border-slate-100 p-4 text-sm">
            <button type="button" disabled={page <= 1} onClick={() => setPage((current) => current - 1)} className="rounded-full border border-slate-200 px-3 py-1.5 font-semibold text-slate-600 disabled:opacity-40">Previous</button>
            <span className="text-slate-500">Page {page} of {totalPages}</span>
            <button type="button" disabled={page >= totalPages} onClick={() => setPage((current) => current + 1)} className="rounded-full border border-slate-200 px-3 py-1.5 font-semibold text-slate-600 disabled:opacity-40">Next</button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function WorkDetails({ workload, onOpenAppointment, consultantKey, consultantOptions, onReassign }) {
  const [viewAllCategory, setViewAllCategory] = useState(null);
  const viewAll = consultantKey ? (category) => setViewAllCategory(category) : undefined;
  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <WorkSection icon={UserRoundSearch} title="Open Leads" count={workload.activeLeads} empty="No open leads." caption="Import Review leads aren't included — see Settings → Lead Intake." onViewAll={viewAll && (() => viewAll("lead"))}>
        {workload.activeLeadItems.map((item) => <LeadRow key={item.id} item={item} consultantOptions={consultantOptions} onReassign={onReassign} />)}
      </WorkSection>
      <WorkSection icon={AlertTriangle} title="Overdue Tasks" count={workload.overdueTasks} empty="No overdue tasks." tone="rose" onViewAll={viewAll && (() => viewAll("overdueTask"))}>
        {workload.overdueTaskItems.map((item) => <TaskRow key={item.id} item={item} overdue />)}
      </WorkSection>
      <WorkSection icon={ListChecks} title="Pending Tasks" count={workload.pendingTasksExcludingOverdue} empty="No upcoming tasks." onViewAll={viewAll && (() => viewAll("pendingTask"))}>
        {workload.pendingTaskItems.map((item) => <TaskRow key={item.id} item={item} />)}
      </WorkSection>
      <WorkSection icon={FileClock} title="Ready for Staff Review" count={workload.documentsReadyForReview} empty="No documents waiting on staff review." tone="amber" caption={workload.documentsReviewOverdue ? `${workload.documentsReviewOverdue} review overdue (${REVIEW_OVERDUE_DAYS_LABEL}+ days)` : null} onViewAll={viewAll && (() => viewAll("document"))}>
        {workload.documentReviewItems.map((item) => <DocumentRow key={item.id} item={item} />)}
      </WorkSection>
      <WorkSection icon={FileClock} title="Waiting on Client" count={workload.documentsWaitingOnClient} empty="No documents waiting on the client." onViewAll={viewAll && (() => viewAll("documentWaiting"))}>
        {(workload.documentWaitingItems || []).map((item) => <DocumentRow key={item.id} item={item} />)}
      </WorkSection>
      <WorkSection icon={BriefcaseBusiness} title="Active Cases" count={workload.activeCases} empty="No active cases." onViewAll={viewAll && (() => viewAll("case"))}>
        {workload.activeCaseItems.map((item) => <CaseRow key={item.id} item={item} />)}
      </WorkSection>
      <WorkSection icon={BriefcaseBusiness} title="Collaborating On" count={workload.collaboratingCases} empty="Not a supporting or reviewing consultant on any case." onViewAll={viewAll && (() => viewAll("collaboratingCase"))}>
        {(workload.collaboratingCaseItems || []).map((item) => <CaseRow key={`${item.id}-${item.assignmentSource}`} item={item} />)}
      </WorkSection>
      <WorkSection icon={AlertTriangle} title="Overdue Follow-ups" count={workload.overdueFollowUps} empty="No overdue follow-ups." tone="rose" caption={workload.highPriorityOverdueFollowUps ? `${workload.highPriorityOverdueFollowUps} high priority` : null} onViewAll={viewAll && (() => viewAll("overdueFollowUp"))}>
        {workload.overdueFollowUpItems.map((item) => <FollowUpRow key={item.id} item={item} consultantOptions={consultantOptions} onReassign={onReassign} />)}
      </WorkSection>
      <WorkSection icon={CalendarClock} title="Open Follow-ups" count={workload.pendingFollowUps} empty="No open follow-ups." caption={workload.followUpsDueToday ? `${workload.followUpsDueToday} due today` : null} onViewAll={viewAll && (() => viewAll("followUp"))}>
        {workload.followUpItems.map((item) => <FollowUpRow key={item.id} item={item} consultantOptions={consultantOptions} onReassign={onReassign} />)}
      </WorkSection>
      <WorkSection icon={CalendarDays} title="Upcoming Appointments" count={workload.upcomingAppointments} empty="No upcoming appointments." tone="amber" caption={`${workload.appointmentsToday} today · ${workload.appointmentsThisWeek} this week · next 30 days`} onViewAll={viewAll && (() => viewAll("appointment"))}>
        {workload.appointmentItems.map((item) => <AppointmentRow key={item.id} item={item} onOpen={onOpenAppointment} />)}
      </WorkSection>
      {viewAllCategory ? (
        <ViewAllDrawer
          consultantKey={consultantKey}
          category={viewAllCategory}
          onClose={() => setViewAllCategory(null)}
          onOpenAppointment={onOpenAppointment}
        />
      ) : null}
    </div>
  );
}

const PERIODS = [
  ["day", "Day"],
  ["week", "Week"],
  ["month", "Month"],
];

function TeamWorkload({ data, period, onPeriodChange, onOpenAppointment, onReassign }) {
  const [selectedMemberId, setSelectedMemberId] = useState(null);
  const consultantOptions = useMemo(() => data.members.map((item) => item.consultant), [data.members]);
  const money = useMemo(() => moneyFormatter(data.currency), [data.currency]);
  const selectedMember = selectedMemberId ? data.members.find((item) => item.consultant.id === selectedMemberId) : null;

  return (
    <>
      <div className="inline-flex w-fit rounded-full bg-slate-100 p-1">
        {PERIODS.map(([value, label]) => (
          <button
            key={value}
            type="button"
            onClick={() => onPeriodChange(value)}
            className={`h-9 shrink-0 rounded-full px-4 text-sm font-semibold transition ${period === value ? "bg-white text-slate-900 shadow-sm" : "text-slate-500"}`}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
        <Metric label="Active staff" value={data.summary.activeStaff} tone="sky" />
        <Metric label="Active cases" value={data.summary.activeCases} />
        <Metric label="Appointments booked" value={data.summary.appointmentsBooked} />
        <Metric label="Calls handled" value={data.summary.callsHandled} />
        <Metric label="Collected" value={data.summary.moneyCollected ? money.format(data.summary.moneyCollected) : "—"} tone="emerald" />
        <Metric label="Unassigned work" value={data.summary.unassignedWork} tone={data.summary.unassignedWork ? "rose" : "emerald"} />
      </div>

      {data.summary.unassignedWork ? (
        <section className="rounded-3xl border border-rose-200 bg-rose-50/70 p-5">
          <div className="mb-4 flex items-start gap-3"><div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-white text-rose-700"><AlertTriangle className="h-5 w-5" /></div><div><h2 className="font-semibold text-rose-950">Unassigned work needs an owner</h2><p className="mt-1 text-sm text-rose-700">These items have neither an active direct assignee nor an active inherited case or client owner.</p></div></div>
          <WorkDetails workload={data.unassigned} onOpenAppointment={onOpenAppointment} consultantKey="unassigned" consultantOptions={consultantOptions} onReassign={onReassign} />
        </section>
      ) : null}

      <TeamRosterTable members={data.members} currency={data.currency} onSelect={(member) => setSelectedMemberId(member.consultant.id)} />

      {selectedMember ? (
        <TeamMemberDrawer member={selectedMember} currency={data.currency} onClose={() => setSelectedMemberId(null)} onOpenAppointment={onOpenAppointment} />
      ) : null}
    </>
  );
}

function PersonalWorkload({ data, onOpenAppointment }) {
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-9">
        <Metric label="Open leads" value={data.activeLeads} tone="sky" />
        <Metric label="Overdue lead actions" value={data.overdueLeadActions} tone={data.overdueLeadActions ? "rose" : "slate"} />
        <Metric label="Active cases" value={data.activeCases} tone="sky" />
        <Metric label="Pending tasks" value={data.pendingTasks} />
        <Metric label="Overdue tasks" value={data.overdueTasks} tone={data.overdueTasks ? "rose" : "slate"} />
        <Metric label="Overdue follow-ups" value={data.overdueFollowUps} tone={data.overdueFollowUps ? "rose" : "slate"} />
        <Metric label="Documents needing action" value={data.documentsWaitingReview} tone={data.documentsWaitingReview ? "amber" : "slate"} />
        <Metric label="Case capacity" value={data.capacity} />
        <Metric label="Case capacity used" value={`${data.caseCapacityPercentage}%`} tone={data.caseCapacityPercentage >= 90 ? "rose" : data.caseCapacityPercentage >= 70 ? "amber" : "emerald"} />
      </div>
      <WorkDetails workload={data} onOpenAppointment={onOpenAppointment} />
    </>
  );
}

export default function Workload() {
  const { role } = useAuth();
  const isAdmin = role === "admin";
  const [openAppointmentId, setOpenAppointmentId] = useState(null);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [period, setPeriod] = useState("week");

  const loadWorkload = useCallback(async ({ fresh = false } = {}) => {
    setLoading(true);
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      try {
        const url = isAdmin ? `/workload/team?period=${period}` : "/consultants/me/workload";
        const response = await (fresh ? api.getFresh : api.get)(url);
        setData(response.data.data);
        setError("");
        setLoading(false);
        return;
      } catch (requestError) {
        // Retry once, silently, on transient failures (network drop, 5xx)
        const transient = !requestError.response || requestError.response.status >= 500;
        if (attempt === 1 && transient) {
          await new Promise((resolve) => setTimeout(resolve, 1200));
          continue;
        }
        setError(requestError.response?.data?.message || (isAdmin ? "Unable to load the team workload." : "Unable to load your workload."));
      }
    }
    setLoading(false);
  }, [isAdmin, period]);

  useEffect(() => { loadWorkload(); }, [loadWorkload]);

  const reassign = useCallback(async (category, itemId, newOwnerUserId) => {
    await api.post("/admin/consultants/workload/reassign", { category, itemId, newOwnerUserId });
    await loadWorkload({ fresh: true });
  }, [loadWorkload]);

  return (
    <PageContainer
      title={isAdmin ? "Team Workload" : "My Workload"}
      description={isAdmin ? "Every admin, consultant, and front-desk teammate — what they're carrying, what they've gotten done, and how close they are to their deadlines." : "Your assigned leads, cases, deadlines, and documents requiring review."}
      actions={<button type="button" onClick={() => loadWorkload({ fresh: true })} disabled={loading} className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"><RefreshCw className={["h-4 w-4", loading ? "animate-spin" : ""].join(" ")} />Refresh</button>}
    >
      {error ? <div className="flex items-center justify-between gap-4 rounded-3xl border border-rose-200 bg-rose-50 px-5 py-4 text-sm text-rose-700"><span className="flex items-center gap-2"><AlertTriangle className="h-4 w-4" />{error}</span><button type="button" onClick={loadWorkload} className="font-semibold underline">Try again</button></div> : null}
      {loading && !data ? <div className="rounded-3xl border border-slate-200 bg-white p-8 text-sm text-slate-500">Loading {isAdmin ? "team" : "your"} workload…</div> : null}
      {data ? (isAdmin ? <TeamWorkload data={data} period={period} onPeriodChange={setPeriod} onOpenAppointment={setOpenAppointmentId} onReassign={reassign} /> : <PersonalWorkload data={data} onOpenAppointment={setOpenAppointmentId} />) : null}
      {openAppointmentId ? (
        <AppointmentProfileOverlay
          appointmentId={openAppointmentId}
          onClose={() => setOpenAppointmentId(null)}
          onChanged={() => loadWorkload({ fresh: true })}
        />
      ) : null}
    </PageContainer>
  );
}
