import { Activity, BriefcaseBusiness, ClipboardList, CreditCard, FileText, PenLine } from "lucide-react";
import ClientPortalEmptyState from "./ClientPortalEmptyState";

const TYPE_META = {
  case: { icon: BriefcaseBusiness, tone: "bg-sky-100 text-sky-700" },
  document: { icon: FileText, tone: "bg-indigo-100 text-indigo-700" },
  payment: { icon: CreditCard, tone: "bg-emerald-100 text-emerald-700" },
  questionnaire: { icon: ClipboardList, tone: "bg-violet-100 text-violet-700" },
  agreement: { icon: PenLine, tone: "bg-amber-100 text-amber-700" },
};

function formatEventDate(value) {
  return new Intl.DateTimeFormat("en-CA", { month: "short", day: "numeric" }).format(new Date(value));
}

export default function ClientTimeline({ timeline = [], limit = null }) {
  const events = limit ? timeline.slice(0, limit) : timeline;

  if (!events.length) {
    return <ClientPortalEmptyState icon={Activity} title="No updates yet" copy="Updates about your documents, payments, and application will appear here." />;
  }

  return (
    <ol className="space-y-0">
      {events.map((event, index) => {
        const meta = TYPE_META[event.type] || TYPE_META.case;
        const Icon = meta.icon;
        const last = index === events.length - 1;
        return (
          <li key={event.id} className="relative flex gap-3.5 pb-5 last:pb-0">
            {!last ? <span className="absolute left-[17px] top-9 h-[calc(100%-2rem)] w-px bg-slate-200/90" aria-hidden="true" /> : null}
            <span className={["mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full ring-4 ring-white/70", meta.tone].join(" ")}>
              <Icon className="h-4 w-4" />
            </span>
            <div className="min-w-0 flex-1 pt-1">
              <div className="flex items-start justify-between gap-3">
                <p className="text-sm font-semibold leading-5 text-slate-900">{event.title}</p>
                <time className="shrink-0 text-[11px] font-medium text-slate-400">{formatEventDate(event.createdAt)}</time>
              </div>
              {event.description ? <p className="mt-0.5 text-[13px] leading-5 text-slate-500">{event.description}</p> : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
