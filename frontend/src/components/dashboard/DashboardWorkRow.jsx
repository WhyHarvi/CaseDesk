import {
  ArrowRight,
  CalendarDays,
  ChevronRight,
  CircleAlert,
  FolderKanban,
  ListChecks,
  X,
} from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { useState } from "react";
import { createPortal } from "react-dom";
import { Link, useNavigate } from "react-router-dom";
import { convertAppointmentToClient } from "../../api/bookingApi";

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
    <Link to={item.to} className="flex items-start justify-between gap-3 rounded-xl border border-slate-100 bg-white/80 p-3 transition hover:border-sky-200 hover:bg-slate-50/80">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-slate-800">{item.title}</p>
        <p className="mt-0.5 line-clamp-1 text-xs text-slate-500">{item.caseType} · {item.detail}</p>
      </div>
      <div className="shrink-0 text-right">
        <span className={["rounded-full border px-2.5 py-1 text-[11px] font-semibold", toneStyles[item.tone]].join(" ")}>{item.badge}</span>
        <p className="mt-1 text-[11px] text-slate-400">{formatDate(item.dueAt, timezone, { month: "short", day: "numeric" })}</p>
      </div>
    </Link>
  );
}

const PRIORITY_CLIENT_VISIBLE = 4;

function ClientWorkCard({ entry, onOpen }) {
  const { client, overdueCount, totalCount } = entry;
  const tone = overdueCount > 0 ? "urgent" : "warning";
  return (
    <button type="button" onClick={onOpen} className="flex w-full items-center gap-3 rounded-2xl border border-slate-100 bg-white/70 p-3.5 text-left transition hover:border-sky-200 hover:bg-slate-50/80">
      <div className={["flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl text-xs font-bold", toneStyles[tone]].join(" ")}>{initials(client.fullName)}</div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-slate-900">{client.fullName}</p>
        <p className="mt-0.5 truncate text-xs text-slate-500">
          {totalCount} thing{totalCount === 1 ? "" : "s"} need{totalCount === 1 ? "s" : ""} to be done
          {overdueCount > 0 ? ` · ${overdueCount} overdue` : ""}
        </p>
      </div>
      <span className={["shrink-0 rounded-full border px-2.5 py-1 text-[11px] font-semibold", toneStyles[tone]].join(" ")}>{totalCount} open</span>
      <ChevronRight className="h-4 w-4 shrink-0 text-slate-400" />
    </button>
  );
}

function ClientWorkDrawer({ entry, timezone, onClose }) {
  if (typeof document === "undefined") return null;
  const open = Boolean(entry);
  return createPortal(
    <AnimatePresence>
      {open ? (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[400] flex justify-end bg-slate-950/25 backdrop-blur-[2px]"
          onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}
        >
          <motion.aside
            initial={{ x: 60, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: 60, opacity: 0 }}
            transition={{ type: "spring", stiffness: 380, damping: 34 }}
            className="flex h-full w-full max-w-[440px] flex-col overflow-hidden border-l border-white/70 bg-white/95 shadow-[-30px_0_90px_rgba(15,23,42,0.2)] backdrop-blur-2xl"
          >
            <header className="flex items-start justify-between gap-4 border-b border-slate-100 px-5 py-4">
              <div className="min-w-0">
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Priority work</p>
                <h2 className="mt-1 truncate text-lg font-semibold text-slate-950">{entry?.client.fullName}</h2>
                <p className="mt-0.5 text-xs text-slate-500">
                  {entry?.totalCount} open{entry?.overdueCount ? ` · ${entry.overdueCount} overdue` : ""}
                </p>
              </div>
              <button type="button" onClick={onClose} aria-label="Close" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-slate-500 transition hover:bg-slate-100">
                <X className="h-4 w-4" />
              </button>
            </header>
            <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-5 py-4">
              {entry?.items.map((item) => <WorkItemRow key={item.id} item={item} timezone={timezone} />)}
            </div>
          </motion.aside>
        </motion.div>
      ) : null}
    </AnimatePresence>,
    document.body,
  );
}

export default function DashboardWorkRow({ dashboard, loading, role, onDashboardChanged }) {
  const navigate = useNavigate();
  const isAdmin = role === "admin";
  const timezone = dashboard?.timezone || "America/Toronto";
  const appointments = dashboard?.upcomingAppointments || [];
  const priorityClients = dashboard?.priorityWork || [];
  const visibleClients = priorityClients.slice(0, PRIORITY_CLIENT_VISIBLE);
  const [selectedClientId, setSelectedClientId] = useState(null);
  const [savingAppointmentId, setSavingAppointmentId] = useState(null);
  const [appointmentSaveError, setAppointmentSaveError] = useState(null);
  const selectedEntry = visibleClients.find((entry) => entry.client.id === selectedClientId) || null;
  const pipelineStages = dashboard?.casePipeline || [];
  const pipelineMax = Math.max(...pipelineStages.map((stage) => stage.count), 1);
  const workCount = (dashboard?.stats?.tasksDueToday || 0)
    + (dashboard?.stats?.overdueTasks || 0)
    + (dashboard?.stats?.pendingDocuments || 0)
    + (dashboard?.stats?.casesWaitingUpdate || 0);
  const visibleWorkCount = visibleClients.reduce((sum, entry) => sum + entry.totalCount, 0);
  const hiddenWorkCount = Math.max(0, workCount - visibleWorkCount);

  async function saveAppointmentVisitor(item) {
    setSavingAppointmentId(item.id);
    setAppointmentSaveError(null);
    try {
      const result = await convertAppointmentToClient(item.id);
      onDashboardChanged?.();
      navigate(`/app/clients/${result.clientId}`);
    } catch (error) {
      setAppointmentSaveError({ id: item.id, message: error.response?.data?.message || "This visitor could not be saved as a client." });
    } finally {
      setSavingAppointmentId(null);
    }
  }

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
          {appointments.length ? appointments.map((item) => {
            const client = item.client || item.case?.client || null;
            const content = <>
              <div className="w-16 shrink-0 pt-0.5 text-xs font-semibold text-slate-950">
                {formatDate(item.startsAt, timezone, { month: "short", day: "numeric" })}
                <span className="mt-0.5 block font-normal text-slate-500">{formatDate(item.startsAt, timezone, { hour: "numeric", minute: "2-digit" })}</span>
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-slate-800">{client?.fullName || item.guestName || "Appointment"}</p>
                <p className="mt-0.5 line-clamp-2 text-xs text-slate-500">{item.subject}{isAdmin && item.isMine ? " · Your appointment" : ""}</p>
                {item.description ? <p className="mt-1 line-clamp-2 text-xs text-slate-400">{item.description}</p> : null}
                {!client ? <button type="button" disabled={savingAppointmentId === item.id} onClick={() => saveAppointmentVisitor(item)} className="mt-2 inline-flex h-8 items-center rounded-full bg-emerald-600 px-3 text-[11px] font-semibold text-white transition hover:bg-emerald-700 disabled:opacity-50">{savingAppointmentId === item.id ? "Saving…" : "Save as client"}</button> : null}
                {appointmentSaveError?.id === item.id ? <p className="mt-2 text-xs leading-5 text-rose-600">{appointmentSaveError.message}</p> : null}
              </div>
            </>;
            return client ? (
              <Link key={item.id} to={`/app/clients/${client.id}`} className="flex w-full items-start gap-3 rounded-2xl border border-slate-100 bg-slate-50/60 p-3 text-left transition hover:border-sky-200 hover:bg-sky-50/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-400">{content}</Link>
            ) : (
              <div key={item.id} className="flex w-full items-start gap-3 rounded-2xl border border-slate-100 bg-slate-50/60 p-3 text-left">{content}</div>
            );
          }) : <EmptyState loading={loading}>No upcoming appointments.</EmptyState>}
        </div>
        <div className="mt-4 border-t border-slate-100 pt-4">
          <Link to="/app/calendar" className="inline-flex items-center gap-1 text-xs font-semibold text-sky-700 hover:text-sky-800">Open calendar <ArrowRight className="h-3.5 w-3.5" /></Link>
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
        <div className="flex-1 space-y-2.5">
          {visibleClients.map((entry) => (
            <ClientWorkCard key={entry.client.id} entry={entry} onOpen={() => setSelectedClientId(entry.client.id)} />
          ))}
          {!visibleClients.length ? <EmptyState loading={loading}>You have no open work items.</EmptyState> : null}
        </div>
        <div className="mt-4 border-t border-slate-100 pt-4">
          <Link to="/app/workload" className="inline-flex items-center gap-1 text-xs font-semibold text-sky-700 hover:text-sky-800">{hiddenWorkCount > 0 ? `View ${hiddenWorkCount} more` : isAdmin ? "View team workload" : "View all my work"} <ArrowRight className="h-3.5 w-3.5" /></Link>
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
            <Link
              key={stage.stage}
              to={`/app/cases?stage=${encodeURIComponent(stage.stage)}`}
              className="block rounded-lg p-1 -m-1 transition hover:bg-emerald-50/60"
            >
              <div className="mb-1.5 flex items-center justify-between text-xs"><span className="font-medium text-slate-600">{stage.stage}</span><span className="font-semibold text-slate-900">{stage.count}</span></div>
              <div className="h-2 rounded-full bg-slate-100"><div className={["h-2 rounded-full", pipelineColors[index % pipelineColors.length]].join(" ")} style={{ width: `${(stage.count / pipelineMax) * 100}%` }} /></div>
            </Link>
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

      <ClientWorkDrawer entry={selectedEntry} timezone={timezone} onClose={() => setSelectedClientId(null)} />
    </section>
  );
}
