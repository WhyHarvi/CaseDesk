import { BriefcaseBusiness } from "lucide-react";
import { GlassCard } from "./ClientPortalSkeleton";

const STAGE_LABELS = {
  Lead: "Getting started",
  Consultation: "Consultation",
  "Retainer Pending": "Agreement pending",
  "Documents Pending": "Documents needed",
  "Reviewing Documents": "Reviewing documents",
  "Application Preparing": "Preparing application",
  Submitted: "Submitted",
  "Decision Received": "Decision received",
  Closed: "Closed",
};

export function formatPortalDate(value) {
  if (!value) return null;
  return new Intl.DateTimeFormat("en-CA", { month: "short", day: "numeric", year: "numeric" }).format(new Date(value));
}

export default function ClientStatusCard({ caseInfo }) {
  if (!caseInfo) {
    return (
      <GlassCard className="p-5">
        <p className="text-sm font-semibold text-slate-900">No active application yet</p>
        <p className="mt-1.5 text-sm leading-6 text-slate-500">Your consultant will open your application file soon. Everything about it will appear here.</p>
      </GlassCard>
    );
  }

  const progress = Math.max(0, Math.min(100, caseInfo.progressPercent ?? 0));

  return (
    <GlassCard className="overflow-hidden">
      <div className="p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">Your application status</p>
            <h2 className="mt-1.5 truncate text-lg font-semibold tracking-tight text-slate-950">{caseInfo.caseType}</h2>
          </div>
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-sky-500 to-indigo-500 text-white shadow-[0_10px_22px_rgba(56,130,246,0.3)]">
            <BriefcaseBusiness className="h-[18px] w-[18px]" />
          </div>
        </div>

        <div className="mt-4 flex items-center gap-2">
          <span className="inline-flex rounded-full bg-sky-100/90 px-3 py-1 text-xs font-semibold text-sky-800">
            {STAGE_LABELS[caseInfo.stage] || caseInfo.stage}
          </span>
          <span className="text-xs text-slate-400">Updated {formatPortalDate(caseInfo.lastUpdatedAt)}</span>
        </div>

        <div className="mt-4">
          <div className="flex items-center justify-between text-xs font-medium text-slate-500">
            <span>Progress</span>
            <span className="font-semibold text-slate-800">{progress}%</span>
          </div>
          <div className="mt-2 h-2.5 overflow-hidden rounded-full bg-slate-200/70">
            <div
              className="h-full rounded-full bg-gradient-to-r from-sky-500 to-indigo-500 transition-[width] duration-700 ease-out"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>

        {caseInfo.consultantName ? (
          <p className="mt-4 text-sm text-slate-500">
            Your consultant: <span className="font-semibold text-slate-800">{caseInfo.consultantName}</span>
          </p>
        ) : null}
      </div>
    </GlassCard>
  );
}
