import { ArrowUpRight, CheckCircle2, Circle } from "lucide-react";
import { useEffect, useRef } from "react";
import { getWorkflowPriorityStyles, getWorkflowProgress } from "./caseProfileUtils";

export default function WorkflowTimeline({ steps, loadError, onToggleStep, savingStepId, onOpen }) {
  const { activeSteps, completedCount, totalCount, percent } = getWorkflowProgress(steps);
  const scrollerRef = useRef(null);

  // A trackpad can already pan this sideways, but a plain mouse wheel only
  // ever fires vertical deltaY — without this, mouse users have no way to
  // move the strip at all. Needs a native (non-passive) listener because
  // React 18 registers onWheel as passive, which silently no-ops
  // preventDefault.
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

  return (
    <article className="rounded-[1.9rem] border border-white/80 bg-white/88 px-5 py-4 shadow-[0_18px_55px_rgba(15,23,42,0.08)] backdrop-blur-xl">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Workflow</p>
          <h3 className="mt-1 text-base font-semibold text-slate-950">
            {loadError ? "Workflow unavailable" : `${completedCount}/${totalCount || 0} milestones complete`}
          </h3>
        </div>
        <div className="flex items-center gap-3">
          <div className="h-2 w-28 overflow-hidden rounded-full bg-slate-100">
            <div className="h-full rounded-full bg-slate-950 transition-all" style={{ width: `${percent}%` }} />
          </div>
          <button
            type="button"
            onClick={onOpen}
            className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3.5 py-2 text-sm font-medium text-slate-700 transition hover:border-slate-300 hover:text-slate-950"
          >
            Edit
            <ArrowUpRight className="h-4 w-4" />
          </button>
        </div>
      </div>

      {loadError ? (
        <div className="mt-5 rounded-2xl border border-rose-100 bg-rose-50 px-4 py-5 text-sm text-rose-700">
          {loadError}
        </div>
      ) : activeSteps.length ? (
        <div ref={scrollerRef} className="scrollbar-hidden mt-5 overflow-x-auto pb-1">
          <div className="flex min-w-max items-start">
            {activeSteps.map((step, index) => {
              const isComplete = step.status === "Completed";

              return (
                <div key={step.id} className="relative flex min-w-[170px] flex-col pr-4">
                  {index < activeSteps.length - 1 ? (
                    <div className={`absolute left-8 top-4 h-px w-[calc(100%-2rem)] ${isComplete ? "bg-slate-900" : "bg-slate-200"}`} />
                  ) : null}
                  <button
                    type="button"
                    disabled={savingStepId === step.id}
                    onClick={() => onToggleStep(step)}
                    className={`relative z-10 flex h-8 w-8 items-center justify-center rounded-full border transition ${
                      isComplete
                        ? "border-slate-950 bg-slate-950 text-white shadow-[0_8px_18px_rgba(15,23,42,0.18)]"
                        : "border-slate-200 bg-white text-slate-400 hover:border-slate-400 hover:text-slate-700"
                    }`}
                    aria-label={`${isComplete ? "Reopen" : "Complete"} ${step.title}`}
                  >
                    {isComplete ? <CheckCircle2 className="h-4 w-4" /> : <Circle className="h-4 w-4" />}
                  </button>
                  <p className={`mt-3 max-w-[145px] text-sm font-medium ${isComplete ? "text-slate-950" : "text-slate-600"}`}>
                    {step.title}
                  </p>
                  {step.priority === "High" || step.priority === "Urgent" ? (
                    <span className={`mt-2 w-fit rounded-full px-2 py-1 text-[10px] font-semibold ${getWorkflowPriorityStyles(step.priority)}`}>
                      {step.priority}
                    </span>
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="mt-5 rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-5 text-sm text-slate-500">
          No workflow assigned yet.
        </div>
      )}
    </article>
  );
}
