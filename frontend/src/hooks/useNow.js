import { useEffect, useState } from "react";

// A ticking "now" for live countdowns. 60s by default — the ratio/color a
// timeline-progress widget derives from this only meaningfully changes over
// hours, so a faster tick would just be wasted re-renders; the "animated"
// feel comes from a continuous CSS/framer-motion pulse on the node itself,
// not from ticking this value every second.
export default function useNow(intervalMs = 60000) {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);

  return now;
}
