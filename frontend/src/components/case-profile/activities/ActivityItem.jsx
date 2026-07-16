import { formatDateTime } from "../caseProfileUtils";
import { getActivityPresentation, humanizeAction } from "./activityPresentation";

export default function ActivityItem({ activity, isLast }) {
  const presentation = getActivityPresentation(activity.action);
  const Icon = presentation.icon;

  return (
    <div className="relative flex gap-3.5">
      {!isLast ? <span className="absolute left-[18px] top-10 h-[calc(100%-1.25rem)] w-px bg-slate-200" /> : null}
      <div className={`relative z-10 flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl ${presentation.tone}`}><Icon className="h-4 w-4" /></div>
      <div className="min-w-0 flex-1 pb-5">
        <p className="text-sm font-semibold text-slate-900">{activity.details || humanizeAction(activity.action)}</p>
        {activity.details ? <p className="mt-1 text-xs text-slate-400">{humanizeAction(activity.action)}</p> : null}
        <p className="mt-1.5 text-xs text-slate-400">{activity.user?.fullName || "CaseDesk team"} · {formatDateTime(activity.createdAt)}</p>
      </div>
    </div>
  );
}
