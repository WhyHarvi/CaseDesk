import { CalendarClock, CircleAlert, ListChecks } from "lucide-react";
import { Link } from "react-router-dom";
import DashboardDrawer from "./DashboardDrawer";

function formatDate(value, timezone) {
  if (!value) return "No date";
  return new Intl.DateTimeFormat("en-CA", { timeZone: timezone, month: "short", day: "numeric" }).format(new Date(value));
}

function formatTime(value, timezone) {
  if (!value) return "No time set";
  return new Intl.DateTimeFormat("en-CA", { timeZone: timezone, hour: "numeric", minute: "2-digit" }).format(new Date(value));
}

// Only standalone tasks (added via the Tasks tab's "+ Task" button) render
// as individual, highlightable rows there — the case's template/checklist
// workflow steps (e.g. "Document Request", "Submit to IRCC") aren't listed
// per-item anywhere in the case workspace yet, so those just open the case
// itself rather than linking to a highlight target that will never exist.
function taskLink(task) {
  return task.isStandaloneTask
    ? `/app/cases/${task.case.id}?tab=tasks&highlight=${task.id}`
    : `/app/cases/${task.case.id}`;
}

const KIND_CONFIG = {
  tasksToday: {
    title: "Tasks due today",
    subtitle: "Workflow actions due today across your cases.",
    icon: ListChecks,
    empty: "No tasks are due today.",
    getItems: (dashboard) => dashboard?.todayTasks || [],
    getTo: taskLink,
    getPrimary: (task) => task.case?.client?.fullName || task.case?.caseType || "Task",
    getSecondary: (task) => task.title,
    getMeta: (task, timezone) => formatTime(task.dueAt, timezone),
  },
  tasksOverdue: {
    title: "Overdue tasks",
    subtitle: "Workflow actions past their due date.",
    icon: CircleAlert,
    empty: "Nothing is overdue right now.",
    getItems: (dashboard) => dashboard?.overdueTasks || [],
    getTo: taskLink,
    getPrimary: (task) => task.case?.client?.fullName || task.case?.caseType || "Task",
    getSecondary: (task) => task.title,
    getMeta: (task, timezone) => `Due ${formatDate(task.dueAt, timezone)}`,
  },
  followUpsToday: {
    title: "Follow-ups due today",
    subtitle: "Client follow-ups scheduled for today.",
    icon: CalendarClock,
    empty: "No follow-ups are due today.",
    getItems: (dashboard) => dashboard?.followUpsDueTodayList || [],
    getTo: (item) => item.openUrl || (item.case ? `/app/cases/${item.case.id}?tab=reminders&highlight=${item.id}` : `/app/follow-ups?highlight=${item.id}`),
    getPrimary: (item) => item.client?.fullName || item.case?.caseType || "Follow-up",
    getSecondary: (item) => item.title,
    getMeta: (item, timezone) => formatTime(item.dueDate, timezone),
  },
};

export default function DashboardListDrawer({ open, onClose, kind, dashboard }) {
  const config = kind ? KIND_CONFIG[kind] : null;
  const timezone = dashboard?.timezone || "America/Toronto";
  const items = config ? config.getItems(dashboard) : [];

  return (
    <DashboardDrawer open={open} onClose={onClose} title={config?.title || ""} subtitle={config?.subtitle} icon={config?.icon}>
      {items.length ? (
        <div className="space-y-2">
          {items.map((item) => (
            <Link
              key={item.id}
              to={config.getTo(item)}
              onClick={onClose}
              className="block rounded-2xl border border-slate-100 bg-white/80 p-3 transition hover:border-sky-200 hover:bg-sky-50/40"
            >
              <div className="flex items-start justify-between gap-3">
                <p className="min-w-0 truncate text-sm font-semibold text-slate-900">{config.getPrimary(item)}</p>
                <span className="whitespace-nowrap text-[11px] text-slate-400">{config.getMeta(item, timezone)}</span>
              </div>
              <p className="mt-1 truncate text-xs text-slate-500">{config.getSecondary(item)}</p>
            </Link>
          ))}
        </div>
      ) : (
        <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50/60 p-4 text-sm text-slate-500">{config?.empty}</div>
      )}
    </DashboardDrawer>
  );
}
