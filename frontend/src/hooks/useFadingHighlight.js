import { useEffect, useRef, useState } from "react";

const DEFAULT_DURATION_MS = 2200;

// Scrolls the element `${domIdPrefix}${rawId}` into view and returns an id
// that matches it for a few seconds, then clears itself — so callers can
// compare `item.id === activeHighlightId` for a ring that actually fades
// instead of sitting there permanently for as long as the URL still has
// ?highlight= on it (which is how every one of these call sites behaved
// before: the ring was driven straight off the query param, which never
// goes away on its own).
export function useFadingHighlight(rawId, { domIdPrefix = "", ready = true, durationMs = DEFAULT_DURATION_MS, deps = [] } = {}) {
  const [activeId, setActiveId] = useState(null);
  const timeoutRef = useRef(null);

  useEffect(() => {
    if (!rawId || !ready) return undefined;
    setActiveId(rawId);
    const frame = requestAnimationFrame(() => {
      document.getElementById(`${domIdPrefix}${rawId}`)?.scrollIntoView({ block: "center", behavior: "smooth" });
    });
    window.clearTimeout(timeoutRef.current);
    timeoutRef.current = window.setTimeout(() => setActiveId(null), durationMs);
    return () => {
      cancelAnimationFrame(frame);
      window.clearTimeout(timeoutRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rawId, domIdPrefix, ready, durationMs, ...deps]);

  return activeId;
}

// Shared class string for the highlighted element itself — ring width never
// changes (no layout shift), only its color/glow fades out over `duration`,
// so toggling `active` produces an actual fade instead of a hard cut.
export const fadingHighlightClass = (active) =>
  `ring-4 transition-all duration-[1100ms] ease-out ${active ? "ring-sky-300 shadow-[0_0_0_6px_rgba(56,189,248,0.16)]" : "ring-transparent shadow-none"}`;
