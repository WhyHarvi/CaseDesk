import { ArrowRight, CalendarClock, CheckCircle2, ClipboardList, Clock4, CreditCard, FileUp, PenLine, Sparkles } from "lucide-react";
import { Link } from "react-router-dom";
import { formatPortalDate } from "./ClientStatusCard";

const ACTION_META = {
  document: { icon: FileUp, label: "Upload now" },
  agreement: { icon: PenLine, label: "Review & sign" },
  questionnaire: { icon: ClipboardList, label: "Start now" },
  payment: { icon: CreditCard, label: "View payments" },
  waiting: { icon: Clock4, label: null },
  submitted: { icon: CheckCircle2, label: null },
  decision: { icon: Sparkles, label: "Contact agency" },
  closed: { icon: CheckCircle2, label: null },
  none: { icon: CheckCircle2, label: null },
};

export default function ClientNextActionCard({ nextAction }) {
  if (!nextAction) return null;
  const meta = ACTION_META[nextAction.type] || ACTION_META.none;
  const Icon = meta.icon;
  const showButton = Boolean(meta.label && nextAction.actionUrl);

  return (
    <section className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-sky-600 via-sky-600 to-indigo-600 p-5 text-white shadow-[0_22px_55px_rgba(37,99,235,0.35)]">
      <div className="pointer-events-none absolute -right-10 -top-12 h-40 w-40 rounded-full bg-white/15 blur-2xl" aria-hidden="true" />
      <div className="pointer-events-none absolute -bottom-14 -left-8 h-36 w-36 rounded-full bg-indigo-300/25 blur-2xl" aria-hidden="true" />

      <div className="relative">
        <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-sky-100">
          <Icon className="h-4 w-4" />
          What you need to do next
        </div>
        <h2 className="mt-2.5 text-xl font-semibold leading-7 tracking-tight">{nextAction.title}</h2>
        {nextAction.reason ? <p className="mt-1.5 text-sm leading-6 text-sky-50/90">{nextAction.reason}</p> : null}

        {nextAction.dueDate ? (
          <p className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-1 text-xs font-medium text-white">
            <CalendarClock className="h-3.5 w-3.5" />
            Due {formatPortalDate(nextAction.dueDate)}
          </p>
        ) : null}

        {showButton ? (
          <Link
            to={nextAction.actionUrl}
            className="mt-4 inline-flex h-11 w-full items-center justify-center gap-2 rounded-2xl bg-white text-sm font-semibold text-sky-700 shadow-sm transition-all duration-200 hover:bg-sky-50 active:scale-[0.98]"
          >
            {meta.label}
            <ArrowRight className="h-4 w-4" />
          </Link>
        ) : null}
      </div>
    </section>
  );
}
