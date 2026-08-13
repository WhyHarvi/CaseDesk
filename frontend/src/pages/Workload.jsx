import { useCallback, useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  AlertTriangle,
  ArrowRight,
  BriefcaseBusiness,
  CalendarClock,
  CalendarDays,
  ChevronDown,
  FileClock,
  Layers,
  ListChecks,
  RefreshCw,
  Users,
  UserRoundSearch,
} from "lucide-react";
import { Link } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import AppointmentProfileOverlay from "../components/appointments/AppointmentProfileOverlay";
import TeamRosterTable from "../components/workload/TeamRosterTable";
import TeamMemberDrawer from "../components/workload/TeamMemberDrawer";
import ConsultantCompare from "../components/workload/ConsultantCompare";
import CollaborationRequests from "../components/workload/CollaborationRequests";
import CollaborationQueue from "../components/workload/CollaborationQueue";
import AddCollaboratorButton from "../components/workload/AddCollaboratorButton";
import { Avatar, GsapCount, useStaggerReveal } from "../components/workload/workloadVisuals";
import { moneyFormatter } from "../components/workload/workloadFormat";
import api from "../services/api";

const glass = "rounded-[1.6rem] border border-white/70 bg-white/70 shadow-[0_18px_50px_rgba(15,23,42,0.08)] backdrop-blur-2xl";
const spring = { type: "spring", stiffness: 320, damping: 30 };
function cx(...classes) { return classes.filter(Boolean).join(" "); }

function formatDate(value) {
  if (!value) return "No due date";
  return new Intl.DateTimeFormat("en-CA", { month: "short", day: "numeric", year: "numeric" }).format(new Date(value));
}

const KPI_TINT = {
  sky: "bg-sky-50 text-sky-500 ring-sky-100",
  violet: "bg-violet-50 text-violet-500 ring-violet-100",
  amber: "bg-amber-50 text-amber-500 ring-amber-100",
  rose: "bg-rose-50 text-rose-500 ring-rose-100",
  emerald: "bg-emerald-50 text-emerald-500 ring-emerald-100",
};

function Kpi({ icon: Icon, label, value, format, tone = "sky", footnote, delay = 0 }) {
  return (
    <motion.article
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ ...spring, delay }}
      whileHover={{ y: -3, boxShadow: "0 26px 60px rgba(15,23,42,0.12)" }}
      className={cx(glass, "min-w-0 p-5")}
    >
      <div className="flex min-w-0 items-center gap-4">
        <span className={cx("flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl ring-1", KPI_TINT[tone])}>
          <Icon className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[12px] font-semibold text-slate-500">{label}</p>
          <p className="mt-1 truncate text-[22px] font-semibold tracking-[-0.03em] text-slate-950 tabular-nums">
            <GsapCount value={value} format={format} />
          </p>
          {footnote ? <p className="mt-0.5 truncate text-[11px] font-medium text-slate-400">{footnote}</p> : null}
        </div>
      </div>
    </motion.article>
  );
}

const SHOWN_LIMIT = 10; // matches the backend's default finalizeBucket sliceLimit
const REVIEW_OVERDUE_DAYS_LABEL = 3; // matches the backend's REVIEW_OVERDUE_DAYS

function EmptyState({ text }) {
  return <p className="rounded-2xl border border-dashed border-slate-200 bg-slate-50/70 p-4 text-sm text-slate-500">{text}</p>;
}

// A group with one item renders exactly like a normal row always did. A
// group with several collapses behind one line — "Jashandeep Dhaliwal ·
// 4 tasks" — instead of repeating the same client/case name four times;
// expanding it reveals the individual rows, each still its own deep link.
function CaseGroupRow({ group, renderItem }) {
  const [open, setOpen] = useState(false);
  if (group.items.length <= 1) return renderItem(group.items[0]);
  return (
    <div className="overflow-hidden rounded-2xl border border-slate-100">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center justify-between gap-3 p-3 text-left transition hover:bg-slate-50/80"
      >
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-slate-900">{group.clientName}</p>
          <p className="mt-0.5 truncate text-xs text-slate-500">{group.caseType || "General"}</p>
        </div>
        <span className="flex shrink-0 items-center gap-2">
          <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-semibold text-slate-600">{group.count} items</span>
          <ChevronDown className={cx("h-4 w-4 text-slate-400 transition-transform", open && "rotate-180")} />
        </span>
      </button>
      <AnimatePresence initial={false}>
        {open ? (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden border-t border-slate-100 bg-slate-50/50"
          >
            <div className="space-y-2 p-2">{group.items.map((item) => renderItem(item))}</div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

// Task-aging bucket — how long a task has sat pending, independent of its
// due date (a task due next month that's still sat untouched for 3 weeks
// is a different problem than one due tomorrow that was just created).
function taskAgeBucket(createdAt) {
  if (!createdAt) return null;
  const days = Math.floor((Date.now() - new Date(createdAt).getTime()) / 86_400_000);
  if (days <= 2) return null; // fresh — no badge needed
  if (days <= 7) return { label: `${days}d old`, tone: "bg-amber-50 text-amber-700 ring-amber-100" };
  return { label: `${days}d old`, tone: "bg-rose-50 text-rose-700 ring-rose-100" };
}

function TaskRow({ item, overdue = false }) {
  const inherited = ["case_owner", "case_assignment"].includes(item.assignmentSource);
  const ageBadge = taskAgeBucket(item.createdAt);
  return (
    <Link to={`/app/cases/${item.case.id}?tab=tasks&highlight=${encodeURIComponent(item.id)}`} className="flex items-start justify-between gap-3 rounded-2xl border border-slate-100 p-3 transition hover:border-sky-200 hover:bg-sky-50/30">
      <div className="min-w-0">
        <p className="flex items-center gap-1.5 truncate text-sm font-semibold text-slate-900">
          {item.title}
          {ageBadge ? <span className={cx("shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-semibold ring-1", ageBadge.tone)}>{ageBadge.label}</span> : null}
        </p>
        <p className="mt-0.5 truncate text-xs text-slate-500">{item.case.client.fullName} · {item.case.caseType}</p>
        {inherited ? <p className="mt-1 text-[10px] font-semibold uppercase tracking-wide text-sky-600">Inherited from case owner</p> : null}
      </div>
      <div className="shrink-0 text-right"><p className={overdue ? "text-xs font-semibold text-rose-700" : "text-xs font-medium text-slate-600"}>{formatDate(item.dueAt)}</p><p className="mt-0.5 text-[11px] text-slate-400">{item.priority}</p></div>
    </Link>
  );
}

function CollaboratorStack({ collaborators }) {
  if (!collaborators?.length) return null;
  return (
    <span className="ml-2 inline-flex -space-x-1.5 align-middle">
      {collaborators.slice(0, 3).map((person) => (
        <span key={person.id} title={`${person.fullName} · ${person.assignmentType}`} className="ring-2 ring-white rounded-full">
          <Avatar id={person.id} fullName={person.fullName} size={18} />
        </span>
      ))}
      {collaborators.length > 3 ? <span className="flex h-[18px] w-[18px] items-center justify-center rounded-full bg-slate-200 text-[8px] font-bold text-slate-600 ring-2 ring-white">+{collaborators.length - 3}</span> : null}
    </span>
  );
}

const STALE_DAYS = 7;

function staleDaysFor(lastActivityAt) {
  if (!lastActivityAt) return null;
  return Math.floor((Date.now() - new Date(lastActivityAt).getTime()) / 86_400_000);
}

function CaseRow({ item, canManageCollaborators, onChanged }) {
  const staleDays = staleDaysFor(item.lastActivityAt);
  const isStale = staleDays != null && staleDays >= STALE_DAYS;
  return (
    <Link to={`/app/cases/${item.id}`} className="flex items-center justify-between gap-3 rounded-2xl border border-slate-100 p-3 transition hover:border-sky-200 hover:bg-sky-50/30">
      <div className="min-w-0">
        <div className="flex min-w-0 items-center">
          <p className="truncate text-sm font-semibold text-slate-900">{item.client.fullName}</p>
          <CollaboratorStack collaborators={(item.collaborators || []).filter((person) => person.assignmentType !== "primary")} />
          {canManageCollaborators ? (
            <span className="ml-1.5 shrink-0">
              <AddCollaboratorButton caseId={item.id} onChanged={onChanged} />
            </span>
          ) : null}
        </div>
        <p className="truncate text-xs text-slate-500">
          {item.caseType} · {item.stage}{item.assignmentSource && item.assignmentSource !== "primary" ? ` · ${item.assignmentSource}` : ""}
          {isStale ? <span className="ml-1.5 font-semibold text-amber-600">· No activity in {staleDays}d</span> : null}
        </p>
      </div>
      <ArrowRight className="h-4 w-4 shrink-0 text-slate-400" />
    </Link>
  );
}

function DocumentRow({ item }) {
  const target = item.case
    ? `/app/cases/${item.case.id}?tab=documents&highlight=${encodeURIComponent(item.id)}`
    : `/app/clients/${item.client.id}?tab=documents&highlight=${encodeURIComponent(item.id)}`;
  return <Link to={target} className="flex items-center justify-between gap-3 rounded-2xl border border-slate-100 p-3 transition hover:border-amber-200 hover:bg-amber-50/30"><div className="min-w-0"><p className="truncate text-sm font-semibold text-slate-900">{item.documentName}</p><p className="truncate text-xs text-slate-500">{item.client.fullName}{item.case ? ` · ${item.case.caseType}` : ""}</p>{item.reviewOverdue ? <p className="mt-1 text-[10px] font-semibold uppercase tracking-wide text-rose-600">Review overdue</p> : null}</div><ArrowRight className="h-4 w-4 shrink-0 text-slate-400" /></Link>;
}

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

function pillClass(active) {
  return cx("h-7 shrink-0 rounded-full px-3 text-[11px] font-semibold transition", active ? "bg-white text-slate-900 shadow-sm" : "text-slate-500");
}

// Grouped section: renders nothing when empty unless alwaysShow is set
// (kept visible at zero for Overdue Tasks/Follow-ups — a clean "0 overdue"
// is reassurance worth showing, not clutter to hide).
function WorkSection({ icon: Icon, title, count, groups, renderItem, empty, tone = "sky", caption, onViewAll, alwaysShow = false }) {
  if (!count && !alwaysShow) return null;
  const iconTone = tone === "rose" ? "bg-rose-50 text-rose-700" : tone === "amber" ? "bg-amber-50 text-amber-700" : tone === "emerald" ? "bg-emerald-50 text-emerald-700" : "bg-sky-50 text-sky-700";
  return (
    <article data-stagger className="rounded-3xl border border-slate-200/70 bg-white/80 p-5 shadow-sm">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3"><div className={cx("flex h-10 w-10 items-center justify-center rounded-2xl", iconTone)}><Icon className="h-5 w-5" /></div><h2 className="font-semibold text-slate-950">{title}</h2></div>
        <span className={cx("rounded-full px-2.5 py-1 text-xs font-semibold", count ? "bg-slate-100 text-slate-600" : "bg-emerald-50 text-emerald-700")}>{count}</span>
      </div>
      {caption ? <p className="mb-3 text-[11px] text-slate-400">{caption}</p> : null}
      <div className="space-y-2">
        {count ? groups.map((group) => <CaseGroupRow key={group.key} group={group} renderItem={renderItem} />) : <EmptyState text={empty} />}
      </div>
      {onViewAll && count > SHOWN_LIMIT ? <button type="button" onClick={onViewAll} className="mt-3 text-xs font-semibold text-sky-700 hover:underline">View all {count} →</button> : null}
    </article>
  );
}

// One merged Documents section instead of two cards that were rarely both
// populated at once — a small tab switch between "ready for review" and
// "waiting on client" replaces a permanently-empty placeholder card with a
// control that's only there when there's something to switch between.
function DocumentsSection({ workload, onViewAll }) {
  const reviewCount = workload.documentsReadyForReview;
  const waitingCount = workload.documentsWaitingOnClient;
  const [tab, setTab] = useState(reviewCount ? "review" : "waiting");
  if (!reviewCount && !waitingCount) return null;
  const isReview = tab === "review";
  const count = isReview ? reviewCount : waitingCount;
  const groups = isReview ? workload.documentReviewGroups : workload.documentWaitingGroups;

  return (
    <article data-stagger className="rounded-3xl border border-slate-200/70 bg-white/80 p-5 shadow-sm">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3"><div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-amber-50 text-amber-700"><FileClock className="h-5 w-5" /></div><h2 className="font-semibold text-slate-950">Documents</h2></div>
        {reviewCount && waitingCount ? (
          <div className="flex gap-1 rounded-full bg-slate-100 p-1">
            <button type="button" onClick={() => setTab("review")} className={pillClass(isReview)}>Ready for review ({reviewCount})</button>
            <button type="button" onClick={() => setTab("waiting")} className={pillClass(!isReview)}>Waiting on client ({waitingCount})</button>
          </div>
        ) : (
          <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600">{count} {isReview ? "ready for review" : "waiting on client"}</span>
        )}
      </div>
      {isReview && workload.documentsReviewOverdue ? <p className="mb-3 text-[11px] font-semibold text-rose-600">{workload.documentsReviewOverdue} review overdue ({REVIEW_OVERDUE_DAYS_LABEL}+ days)</p> : null}
      <div className="space-y-2">
        {count ? groups.map((group) => <CaseGroupRow key={group.key} group={group} renderItem={(item) => <DocumentRow key={item.id} item={item} />} />) : <EmptyState text={isReview ? "No documents waiting on staff review." : "No documents waiting on the client."} />}
      </div>
      {onViewAll && count > SHOWN_LIMIT ? <button type="button" onClick={() => onViewAll(isReview ? "document" : "documentWaiting")} className="mt-3 text-xs font-semibold text-sky-700 hover:underline">View all {count} →</button> : null}
    </article>
  );
}

// A quick-scan strip of every nonzero count, so an admin can tell at a
// glance whether a person's week is worth expanding before scrolling
// through individual cards.
function SummaryStrip({ workload }) {
  const chips = [
    workload.activeLeads ? [`${workload.activeLeads} open leads`, "sky"] : null,
    workload.overdueTasks ? [`${workload.overdueTasks} overdue tasks`, "rose"] : null,
    workload.pendingTasksExcludingOverdue ? [`${workload.pendingTasksExcludingOverdue} pending tasks`, "sky"] : null,
    workload.documentsReadyForReview ? [`${workload.documentsReadyForReview} docs to review`, "amber"] : null,
    workload.overdueFollowUps ? [`${workload.overdueFollowUps} overdue follow-ups`, "rose"] : null,
    workload.pendingFollowUps ? [`${workload.pendingFollowUps} open follow-ups`, "violet"] : null,
    workload.upcomingAppointments ? [`${workload.upcomingAppointments} upcoming appointments`, "emerald"] : null,
  ].filter(Boolean);
  if (!chips.length) return (
    <p className="text-sm font-medium text-emerald-700">Nothing outstanding right now.</p>
  );
  const tone = { sky: "bg-sky-50 text-sky-700", rose: "bg-rose-50 text-rose-700", amber: "bg-amber-50 text-amber-700", violet: "bg-violet-50 text-violet-700", emerald: "bg-emerald-50 text-emerald-700" };
  return (
    <div className="flex flex-wrap gap-1.5">
      {chips.map(([text, color]) => <span key={text} className={cx("rounded-full px-2.5 py-1 text-[11px] font-semibold", tone[color])}>{text}</span>)}
    </div>
  );
}

export function WorkDetails({ workload, onOpenAppointment, consultantKey, consultantOptions, onReassign, canManageCollaborators, onCollaboratorsChanged }) {
  const [viewAllCategory, setViewAllCategory] = useState(null);
  const viewAll = consultantKey ? (category) => setViewAllCategory(category) : undefined;

  return (
    <div className="space-y-4">
      <SummaryStrip workload={workload} />
      <div className="grid gap-4 xl:grid-cols-2">
        {workload.activeLeads ? (
          <article data-stagger className="rounded-3xl border border-slate-200/70 bg-white/80 p-5 shadow-sm">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div className="flex items-center gap-3"><div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-sky-50 text-sky-700"><UserRoundSearch className="h-5 w-5" /></div><h2 className="font-semibold text-slate-950">Open Leads</h2></div>
              <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600">{workload.activeLeads}</span>
            </div>
            <p className="mb-3 text-[11px] text-slate-400">Import Review leads aren't included — see Settings → Lead Intake.</p>
            <div className="space-y-2">{workload.activeLeadItems.map((item) => <LeadRow key={item.id} item={item} consultantOptions={consultantOptions} onReassign={onReassign} />)}</div>
            {viewAll && workload.activeLeads > SHOWN_LIMIT ? <button type="button" onClick={() => viewAll("lead")} className="mt-3 text-xs font-semibold text-sky-700 hover:underline">View all {workload.activeLeads} →</button> : null}
          </article>
        ) : null}

        <WorkSection
          icon={AlertTriangle}
          title="Overdue Tasks"
          count={workload.overdueTasks}
          groups={workload.overdueTaskGroups || []}
          renderItem={(item) => <TaskRow key={item.id} item={item} overdue />}
          empty="No overdue tasks."
          tone="rose"
          alwaysShow
          onViewAll={viewAll && (() => viewAll("overdueTask"))}
        />
        <WorkSection
          icon={ListChecks}
          title="Pending Tasks"
          count={workload.pendingTasksExcludingOverdue}
          groups={workload.pendingTaskGroups || []}
          renderItem={(item) => <TaskRow key={item.id} item={item} />}
          empty="No upcoming tasks."
          onViewAll={viewAll && (() => viewAll("pendingTask"))}
        />
        <DocumentsSection workload={workload} onViewAll={viewAll} />
        <WorkSection
          icon={BriefcaseBusiness}
          title="Active Cases"
          count={workload.activeCases}
          groups={workload.activeCaseItems.map((item) => ({ key: item.id, items: [item] }))}
          renderItem={(item) => <CaseRow key={item.id} item={item} canManageCollaborators={canManageCollaborators} onChanged={onCollaboratorsChanged} />}
          empty="No active cases."
          onViewAll={viewAll && (() => viewAll("case"))}
        />
        <WorkSection
          icon={Users}
          title="Collaborating On"
          count={workload.collaboratingCases}
          groups={(workload.collaboratingCaseItems || []).map((item) => ({ key: `${item.id}-${item.assignmentSource}`, items: [item] }))}
          renderItem={(item) => <CaseRow key={`${item.id}-${item.assignmentSource}`} item={item} canManageCollaborators={canManageCollaborators} onChanged={onCollaboratorsChanged} />}
          empty="Not a supporting or reviewing consultant on any case."
          onViewAll={viewAll && (() => viewAll("collaboratingCase"))}
        />
        <WorkSection
          icon={AlertTriangle}
          title="Overdue Follow-ups"
          count={workload.overdueFollowUps}
          groups={workload.overdueFollowUpGroups || []}
          renderItem={(item) => <FollowUpRow key={item.id} item={item} consultantOptions={consultantOptions} onReassign={onReassign} />}
          empty="No overdue follow-ups."
          tone="rose"
          alwaysShow
          caption={workload.highPriorityOverdueFollowUps ? `${workload.highPriorityOverdueFollowUps} high priority` : null}
          onViewAll={viewAll && (() => viewAll("overdueFollowUp"))}
        />
        <WorkSection
          icon={CalendarClock}
          title="Open Follow-ups"
          count={workload.pendingFollowUps}
          groups={workload.followUpGroups || []}
          renderItem={(item) => <FollowUpRow key={item.id} item={item} consultantOptions={consultantOptions} onReassign={onReassign} />}
          empty="No open follow-ups."
          caption={workload.followUpsDueToday ? `${workload.followUpsDueToday} due today` : null}
          onViewAll={viewAll && (() => viewAll("followUp"))}
        />
        <WorkSection
          icon={CalendarDays}
          title="Upcoming Appointments"
          count={workload.upcomingAppointments}
          groups={workload.appointmentItems.map((item) => ({ key: item.id, items: [item] }))}
          renderItem={(item) => <AppointmentRow key={item.id} item={item} onOpen={onOpenAppointment} />}
          empty="No upcoming appointments."
          tone="emerald"
          caption={`${workload.appointmentsToday} today · ${workload.appointmentsThisWeek} this week · next 30 days`}
          onViewAll={viewAll && (() => viewAll("appointment"))}
        />
      </div>
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

function TeamWorkload({ data, period, onPeriodChange, onOpenAppointment, onReassign, onWorkloadChanged }) {
  const [selectedMemberId, setSelectedMemberId] = useState(null);
  const [compareIds, setCompareIds] = useState([]);
  const consultantOptions = useMemo(() => data.members.map((item) => item.consultant), [data.members]);
  const money = useMemo(() => moneyFormatter(data.currency), [data.currency]);
  const selectedMember = selectedMemberId ? data.members.find((item) => item.consultant.id === selectedMemberId) : null;
  const stageRef = useStaggerReveal(data);

  function toggleCompare(id) {
    setCompareIds((current) => {
      if (current.includes(id)) return current.filter((value) => value !== id);
      if (current.length >= 4) return current; // radar chart guidance: 2-4 datasets is the readable ceiling
      return [...current, id];
    });
  }

  return (
    <div ref={stageRef} className="space-y-5">
      <div className="inline-flex w-fit rounded-full bg-slate-100 p-1">
        {PERIODS.map(([value, label]) => (
          <button
            key={value}
            type="button"
            onClick={() => onPeriodChange(value)}
            className={cx("h-9 shrink-0 rounded-full px-4 text-sm font-semibold transition", period === value ? "bg-white text-slate-900 shadow-sm" : "text-slate-500")}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
        <Kpi icon={Users} label="Active staff" value={data.summary.activeStaff} tone="sky" delay={0.02} />
        <Kpi icon={BriefcaseBusiness} label="Active cases" value={data.summary.activeCases} delay={0.04} />
        <Kpi icon={CalendarDays} label="Appointments booked" value={data.summary.appointmentsBooked} delay={0.06} />
        <Kpi icon={CalendarClock} label="Calls handled" value={data.summary.callsHandled} delay={0.08} />
        <Kpi icon={Layers} label="Collected" value={data.summary.moneyCollected} format={(v) => (v ? money.format(v) : "—")} tone="emerald" delay={0.1} />
        <Kpi icon={AlertTriangle} label="Unassigned work" value={data.summary.unassignedWork} tone={data.summary.unassignedWork ? "rose" : "emerald"} delay={0.12} />
      </div>

      <CollaborationQueue onGranted={onWorkloadChanged} />

      {data.summary.unassignedWork ? (
        <motion.section initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="rounded-3xl border border-rose-200 bg-rose-50/70 p-5">
          <div className="mb-4 flex items-start gap-3"><div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-white text-rose-700"><AlertTriangle className="h-5 w-5" /></div><div><h2 className="font-semibold text-rose-950">Unassigned work needs an owner</h2><p className="mt-1 text-sm text-rose-700">These items have neither an active direct assignee nor an active inherited case or client owner.</p></div></div>
          <WorkDetails workload={data.unassigned} onOpenAppointment={onOpenAppointment} consultantKey="unassigned" consultantOptions={consultantOptions} onReassign={onReassign} canManageCollaborators onCollaboratorsChanged={onWorkloadChanged} />
        </motion.section>
      ) : null}

      <div data-stagger>
        <TeamRosterTable members={data.members} currency={data.currency} onSelect={(member) => setSelectedMemberId(member.consultant.id)} compareIds={compareIds} onToggleCompare={toggleCompare} />
      </div>

      <AnimatePresence>
        {compareIds.length >= 2 ? (
          <ConsultantCompare members={data.members} selectedIds={compareIds} onRemove={(id) => setCompareIds((c) => c.filter((v) => v !== id))} onClear={() => setCompareIds([])} currency={data.currency} />
        ) : null}
      </AnimatePresence>

      <AnimatePresence>
        {selectedMember ? (
          <TeamMemberDrawer key={selectedMember.consultant.id} member={selectedMember} currency={data.currency} onClose={() => setSelectedMemberId(null)} onOpenAppointment={onOpenAppointment} onWorkloadChanged={onWorkloadChanged} />
        ) : null}
      </AnimatePresence>
    </div>
  );
}

function PersonalWorkload({ data, onOpenAppointment }) {
  const stageRef = useStaggerReveal(data);
  return (
    <div ref={stageRef} className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-9">
        <Kpi icon={UserRoundSearch} label="Open leads" value={data.activeLeads} tone="sky" delay={0.02} />
        <Kpi icon={AlertTriangle} label="Overdue lead actions" value={data.overdueLeadActions} tone={data.overdueLeadActions ? "rose" : "emerald"} delay={0.04} />
        <Kpi icon={BriefcaseBusiness} label="Active cases" value={data.activeCases} tone="sky" delay={0.06} />
        <Kpi icon={ListChecks} label="Pending tasks" value={data.pendingTasks} delay={0.08} />
        <Kpi icon={AlertTriangle} label="Overdue tasks" value={data.overdueTasks} tone={data.overdueTasks ? "rose" : "emerald"} delay={0.1} />
        <Kpi icon={AlertTriangle} label="Overdue follow-ups" value={data.overdueFollowUps} tone={data.overdueFollowUps ? "rose" : "emerald"} delay={0.12} />
        <Kpi icon={FileClock} label="Documents needing action" value={data.documentsWaitingReview} tone={data.documentsWaitingReview ? "amber" : "emerald"} delay={0.14} />
        <Kpi icon={Layers} label="Case capacity" value={data.capacity ?? 0} format={(v) => (data.capacity == null ? "—" : String(Math.round(v)))} delay={0.16} />
        <Kpi icon={Layers} label="Capacity used" value={data.caseCapacityPercentage ?? 0} format={(v) => (data.capacity == null ? "—" : `${Math.round(v)}%`)} tone={data.caseCapacityPercentage >= 90 ? "rose" : data.caseCapacityPercentage >= 70 ? "amber" : "emerald"} delay={0.18} />
      </div>
      <CollaborationRequests />
      <WorkDetails workload={data} onOpenAppointment={onOpenAppointment} />
    </div>
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
    <main className="min-w-0 bg-[radial-gradient(circle_at_12%_-4%,rgba(139,92,246,0.09),transparent_36%),radial-gradient(circle_at_92%_16%,rgba(56,130,246,0.08),transparent_38%)] px-3 py-4 sm:px-5 lg:px-6">
      <div className="mx-auto flex w-full max-w-[1680px] min-w-0 flex-col gap-5">
        <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={spring} className={cx(glass, "p-5 sm:p-7 lg:p-8")}>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h1 className="text-3xl font-semibold tracking-tight text-slate-950 sm:text-4xl">{isAdmin ? "Team Workload" : "My Workload"}</h1>
              <p className="mt-2 max-w-2xl text-sm text-slate-500 sm:text-base">
                {isAdmin
                  ? "Every admin, consultant, and front-desk teammate — what they're carrying, what they've gotten done, and how close they are to their deadlines."
                  : "Your assigned leads, cases, deadlines, and documents requiring review."}
              </p>
            </div>
            <button
              type="button"
              onClick={() => loadWorkload({ fresh: true })}
              disabled={loading}
              className="inline-flex h-10 shrink-0 items-center gap-2 rounded-full border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
            >
              <RefreshCw className={cx("h-4 w-4", loading ? "animate-spin" : "")} />
              Refresh
            </button>
          </div>
        </motion.div>

        {error ? (
          <div className="flex items-center justify-between gap-4 rounded-3xl border border-rose-200 bg-rose-50 px-5 py-4 text-sm text-rose-700">
            <span className="flex items-center gap-2"><AlertTriangle className="h-4 w-4" />{error}</span>
            <button type="button" onClick={() => loadWorkload()} className="font-semibold underline">Try again</button>
          </div>
        ) : null}
        {loading && !data ? (
          <div className={cx(glass, "flex items-center justify-center p-16 text-sm text-slate-500")}>
            Loading {isAdmin ? "team" : "your"} workload…
          </div>
        ) : null}
        {data ? (isAdmin ? <TeamWorkload data={data} period={period} onPeriodChange={setPeriod} onOpenAppointment={setOpenAppointmentId} onReassign={reassign} onWorkloadChanged={() => loadWorkload({ fresh: true })} /> : <PersonalWorkload data={data} onOpenAppointment={setOpenAppointmentId} />) : null}
        {openAppointmentId ? (
          <AppointmentProfileOverlay
            appointmentId={openAppointmentId}
            onClose={() => setOpenAppointmentId(null)}
            onChanged={() => loadWorkload({ fresh: true })}
          />
        ) : null}
      </div>
    </main>
  );
}
