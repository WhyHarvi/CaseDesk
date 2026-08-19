import { motion } from "framer-motion";
import { CheckCircle2, Circle, XCircle } from "lucide-react";
import { useEffect, useRef } from "react";
import { computeLegProgress, progressColor } from "./timelineProgressUtils";

function formatCountdown(deadlineAt, now) {
  const ms = deadlineAt.getTime() - now.getTime();
  if (ms <= 0) return "due now";
  const totalMinutes = Math.round(ms / 60000);
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  if (days > 0) return `${days}d ${hours}h left`;
  if (hours > 0) return `${hours}h ${minutes}m left`;
  return `${minutes}m left`;
}

function money(amount) {
  return new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD" }).format(amount);
}

function LegNode({ leg, now, isLast }) {
  const progress = leg.state === "IN_PROGRESS" ? computeLegProgress({ fromCheckpointAt: new Date(leg.fromCheckpointAt), tiers: leg.tiers, now }) : null;
  const state = leg.state === "IN_PROGRESS" ? progress.state : leg.state;

  const isCredited = leg.state === "RESOLVED" && leg.outcome === "CREDITED";
  const isMissedResolved = leg.state === "RESOLVED" && leg.outcome !== "CREDITED";
  const isMissedProjection = state === "MISSED";

  const ringColor = state === "IN_PROGRESS" ? progressColor(progress.ratio, progress.currentTier) : null;

  return (
    <div className="relative flex min-w-[190px] flex-col pr-4">
      {!isLast ? (
        <div
          className={`absolute left-8 top-4 h-px w-[calc(100%-2rem)] ${isCredited || isMissedResolved ? "bg-slate-900" : "bg-slate-200"}`}
        />
      ) : null}

      <div className="relative z-10 flex h-8 w-8 items-center justify-center">
        {state === "IN_PROGRESS" ? (
          <motion.span
            className="absolute inset-0 rounded-full"
            style={{ backgroundColor: ringColor, opacity: 0.35 }}
            animate={{ scale: [1, 1.35, 1], opacity: [0.35, 0.05, 0.35] }}
            transition={{ duration: 2.2, repeat: Infinity, ease: "easeInOut" }}
          />
        ) : null}
        <div
          className={`relative flex h-8 w-8 items-center justify-center rounded-full border-2 transition ${
            isCredited
              ? "border-slate-950 bg-slate-950 text-white shadow-[0_8px_18px_rgba(15,23,42,0.18)]"
              : isMissedResolved || isMissedProjection
                ? "border-rose-200 bg-rose-50 text-rose-500"
                : state === "NOT_STARTED"
                  ? "border-slate-200 bg-white text-slate-300"
                  : "bg-white text-slate-700"
          }`}
          style={state === "IN_PROGRESS" ? { borderColor: ringColor } : undefined}
        >
          {isCredited ? <CheckCircle2 className="h-4 w-4" /> : isMissedResolved || isMissedProjection ? <XCircle className="h-4 w-4" /> : <Circle className="h-4 w-4" />}
        </div>
      </div>

      <p className={`mt-3 max-w-[175px] text-sm font-medium ${isCredited ? "text-slate-950" : "text-slate-600"}`}>{leg.name}</p>

      {isCredited ? (
        <p className="mt-1 text-xs font-semibold text-emerald-700">
          +{money(leg.creditedTotal)} · {leg.recipients?.map((r) => r.fullName).join(", ") || "credited"}
        </p>
      ) : isMissedResolved ? (
        <p className="mt-1 text-xs font-medium text-rose-600">Missed — no bonus</p>
      ) : isMissedProjection ? (
        <p className="mt-1 text-xs font-medium text-rose-600">Timeline missed — up to {money(leg.baseBonusAmount)} unclaimed</p>
      ) : state === "NOT_STARTED" ? (
        <p className="mt-1 text-xs text-slate-400">Upcoming — up to {money(leg.baseBonusAmount)}</p>
      ) : (
        <div className="mt-1 space-y-0.5">
          <p className="text-xs font-semibold" style={{ color: ringColor }}>
            {progress.currentTier.multiplierPercent}% tier · {formatCountdown(progress.deadlineAt, now)}
          </p>
          <p className="text-[11px] text-slate-400">up to {money((leg.baseBonusAmount * progress.currentTier.multiplierPercent) / 100)}</p>
        </div>
      )}
    </div>
  );
}

// Purely leg-list-driven — no case awareness, so this same component works
// for a single case's strip (Case Profile) or one row inside a
// multi-case list (Incentives page). Callers own their own card chrome and
// header; this renders only the horizontal node strip itself.
export default function TimelineProgressStrip({ legs, now }) {
  const scrollerRef = useRef(null);

  // Mirrors WorkflowTimeline.jsx's wheel-to-scroll handling — a plain mouse
  // wheel only ever fires vertical deltaY, so without this, mouse users
  // have no way to pan a wide strip. Needs a native (non-passive) listener
  // since React registers onWheel as passive.
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return undefined;
    function handleWheel(event) {
      if (event.deltaY === 0 || event.deltaX !== 0) return;
      if (el.scrollWidth <= el.clientWidth) return;
      event.preventDefault();
      el.scrollLeft += event.deltaY;
    }
    el.addEventListener("wheel", handleWheel, { passive: false });
    return () => el.removeEventListener("wheel", handleWheel);
  }, []);

  if (!legs?.length) return null;

  return (
    <div ref={scrollerRef} className="scrollbar-hidden overflow-x-auto pb-1">
      <div className="flex min-w-max items-start">
        {legs.map((leg, index) => (
          <LegNode key={leg.legId} leg={leg} now={now} isLast={index === legs.length - 1} />
        ))}
      </div>
    </div>
  );
}
