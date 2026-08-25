import { AlertCircle } from "lucide-react";
import { useEffect, useRef } from "react";

export default function InlineActionError({ id, message, className = "" }) {
  const errorRef = useRef(null);

  useEffect(() => {
    if (!message) return undefined;
    const frame = window.requestAnimationFrame(() => {
      const element = errorRef.current;
      if (!element) return;
      const bounds = element.getBoundingClientRect();
      if (bounds.top < 0 || bounds.bottom > window.innerHeight) {
        const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
        element.scrollIntoView({ behavior: reducedMotion ? "auto" : "smooth", block: "nearest" });
      }
    });
    return () => window.cancelAnimationFrame(frame);
  }, [message]);

  if (!message) return null;

  return (
    <div
      ref={errorRef}
      id={id}
      role="alert"
      className={`flex min-w-0 items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-left text-[13px] font-medium leading-5 text-rose-800 ${className}`}
    >
      <AlertCircle aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
      <span className="min-w-0 [overflow-wrap:anywhere]">{message}</span>
    </div>
  );
}
