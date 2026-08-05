import { AlertCircle, ArrowRight } from "lucide-react";
import { useEffect, useState } from "react";

export default function SidebarFocusNotice({ notice, onDismiss }) {
  const [settled, setSettled] = useState(false);

  useEffect(() => {
    if (!notice) return undefined;
    setSettled(false);
    const frame = window.requestAnimationFrame(() => setSettled(true));
    const timer = window.setTimeout(onDismiss, 5200);
    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(timer);
    };
  }, [notice, onDismiss]);

  if (!notice) return null;
  const focus = notice.focus || {};
  const needsAction = notice.actions > 0;
  const anchor = notice.anchorRect;
  const width = Math.min(360, Math.max(280, window.innerWidth - 24));
  const estimatedHeight = 132;
  let left = Math.max(12, (window.innerWidth - width) / 2);
  let top = 12;
  if (anchor) {
    const opensRight = anchor.right + 12 + width <= window.innerWidth - 12;
    left = opensRight ? anchor.right + 12 : Math.max(12, anchor.left - width - 12);
    top = anchor.top + estimatedHeight <= window.innerHeight - 12
      ? anchor.top
      : Math.max(12, anchor.top - estimatedHeight + (anchor.bottom - anchor.top));
  }

  return (
    <div className="pointer-events-none fixed z-[100]" style={{ left, top, width }} aria-live="polite">
      <div
        className={[
          "w-full overflow-hidden rounded-[20px] border px-4 py-3 shadow-2xl backdrop-blur-xl transition-all ease-out",
          settled ? "translate-x-0 border-slate-200/80 bg-white/95 shadow-slate-200/50 duration-[4200ms]" : "-translate-x-1 border-amber-300 bg-amber-100 shadow-amber-200 duration-150",
        ].join(" ")}
      >
        <div className="flex items-start gap-3">
          <span className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${needsAction ? "bg-rose-100 text-rose-600" : "bg-sky-100 text-sky-600"}`}>
            <AlertCircle className="h-4 w-4" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">
              {needsAction ? "Needs attention" : "New update"} · {notice.label}
            </p>
            <p className="mt-0.5 truncate text-sm font-semibold text-slate-900">{focus.title || `${notice.total} new ${notice.total === 1 ? "item" : "items"}`}</p>
            <p className="mt-0.5 line-clamp-2 text-xs leading-5 text-slate-500">
              {focus.body || `${notice.total} unread ${notice.total === 1 ? "item is" : "items are"} ready for review.`}
            </p>
          </div>
          <ArrowRight className="mt-2 h-4 w-4 shrink-0 text-slate-400" />
        </div>
      </div>
    </div>
  );
}
