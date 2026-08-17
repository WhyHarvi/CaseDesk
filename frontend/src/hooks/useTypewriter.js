import { useEffect, useRef, useState } from "react";

const TICK_MS = 16;
const MAX_DURATION_MS = 900;
const TOTAL_TICKS = Math.round(MAX_DURATION_MS / TICK_MS);

// Reveals `text` progressively rather than all at once. Paced by length, not
// a fixed per-character delay, so a one-line reply and a long one both
// finish in roughly the same short window instead of long answers crawling.
// `enabled` gates the effect entirely — pass false to show the full text
// immediately (already-seen history, reduced-motion, etc).
export function useTypewriter(text, enabled = true) {
  const value = String(text || "");
  const [visibleLength, setVisibleLength] = useState(enabled ? 0 : value.length);
  const doneRef = useRef(!enabled);

  useEffect(() => {
    if (!enabled || doneRef.current) {
      setVisibleLength(value.length);
      return undefined;
    }
    const charsPerTick = Math.max(1, Math.ceil(value.length / TOTAL_TICKS));
    let shown = 0;
    const timer = setInterval(() => {
      shown = Math.min(value.length, shown + charsPerTick);
      setVisibleLength(shown);
      if (shown >= value.length) {
        clearInterval(timer);
        doneRef.current = true;
      }
    }, TICK_MS);
    return () => clearInterval(timer);
    // Only re-run if the enabled message actually changes identity — intentionally not re-keying on every keystroke of `value`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);

  return value.slice(0, visibleLength);
}
