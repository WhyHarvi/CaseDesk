import { useEffect, useRef } from "react";
import api from "../services/api";

// Mirrors AuthContext.jsx's refreshWhenVisible cadence (60s, visibility/
// focus-gated) so this rides the same rhythm as the rest of the app's
// polling rather than introducing a new one.
const PING_INTERVAL_MS = 60_000;
const IDLE_THRESHOLD_MS = 5 * 60_000;
const ACTIVITY_EVENTS = ["mousemove", "keydown", "scroll", "click", "touchstart"];

// Feeds the team workload dashboard's portal-usage-time metric. No cross-
// tab coordination is needed: the backend increments active time by the
// gap since that day's row was last pinged (capped), so a second tab
// pinging moments later just adds close to nothing on its own.
export default function usePortalHeartbeat() {
  const lastActivityAt = useRef(Date.now());

  useEffect(() => {
    const markActive = () => {
      lastActivityAt.current = Date.now();
    };
    ACTIVITY_EVENTS.forEach((event) => window.addEventListener(event, markActive, { passive: true }));

    const sendPing = () => {
      if (document.visibilityState === "hidden") return;
      if (Date.now() - lastActivityAt.current > IDLE_THRESHOLD_MS) return;
      api.post("/workload/activity-ping").catch(() => {});
    };

    sendPing();
    const interval = window.setInterval(sendPing, PING_INTERVAL_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") sendPing();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);

    return () => {
      window.clearInterval(interval);
      ACTIVITY_EVENTS.forEach((event) => window.removeEventListener(event, markActive));
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, []);
}
