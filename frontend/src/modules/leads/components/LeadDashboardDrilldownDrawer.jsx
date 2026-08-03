import { CalendarClock, Clock3, Gauge, Video } from "lucide-react";
import DashboardDrawer from "../../../components/dashboard/DashboardDrawer";
import { formatDueDate, leadName } from "../leadPresentation";

const METRIC_CONFIG = {
  followUpsDueToday: { title: "Follow-ups due today", subtitle: "Pending follow-ups due within today.", icon: CalendarClock, empty: "No follow-ups are due today." },
  overdueFollowUps: { title: "Overdue follow-ups", subtitle: "Pending follow-ups past their due time.", icon: Clock3, empty: "Nothing is overdue right now." },
  slaMissed: { title: "SLA missed", subtitle: "Open leads whose first-response deadline has passed.", icon: Gauge, empty: "No leads have missed their first-response deadline." },
  consultationsToday: { title: "Consultations today", subtitle: "Scheduled or confirmed consultations today.", icon: Video, empty: "No consultations are scheduled for today." },
};

function itemMeta(item) {
  if (item.kind === "followUp") return formatDueDate(item.dueAt).label;
  if (item.kind === "consultation") return formatDueDate(item.startAt).label;
  return formatDueDate(item.firstContactDueAt).label;
}

function itemSecondary(item) {
  if (item.kind === "followUp") return item.description || item.type;
  if (item.kind === "consultation") return item.appointmentType || item.location || "Consultation";
  return "First response overdue";
}

export default function LeadDashboardDrilldownDrawer({ metric, items, loading, error, onClose, onSelectLead }) {
  const config = metric ? METRIC_CONFIG[metric] : null;

  return (
    <DashboardDrawer open={Boolean(metric)} onClose={onClose} title={config?.title || ""} subtitle={config?.subtitle} icon={config?.icon}>
      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, index) => <div key={index} className="h-16 animate-pulse rounded-2xl bg-slate-100" />)}
        </div>
      ) : error ? (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">{error}</div>
      ) : items.length ? (
        <div className="space-y-2">
          {items.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => onSelectLead(item.lead)}
              className="block w-full rounded-2xl border border-slate-100 bg-white/80 p-3 text-left transition hover:border-sky-200 hover:bg-sky-50/40"
            >
              <div className="flex items-start justify-between gap-3">
                <p className="min-w-0 truncate text-sm font-semibold text-slate-900">{leadName(item.lead)}</p>
                <span className="whitespace-nowrap text-[11px] text-slate-400">{itemMeta(item)}</span>
              </div>
              <p className="mt-1 truncate text-xs text-slate-500">{itemSecondary(item)}</p>
              <p className="mt-0.5 truncate text-[11px] text-slate-400">{item.lead?.leadNumber}</p>
            </button>
          ))}
        </div>
      ) : (
        <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50/60 p-4 text-sm text-slate-500">{config?.empty}</div>
      )}
    </DashboardDrawer>
  );
}
