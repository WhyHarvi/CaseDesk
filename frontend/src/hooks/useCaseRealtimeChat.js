import { useEffect, useRef } from "react";

const TOKEN_REFRESH_MS = 10 * 60_000; // 10 min, inside the 15-min realtime JWT TTL

// A thin wrapper around a per-case Supabase Realtime broadcast
// subscription, shared by all three chat surfaces (staff drawer,
// authenticated portal, token-link portal). Deliberately minimal: it only
// tells the caller "something changed, go re-fetch" — the broadcast
// payload itself is too thin to merge directly into message state, and
// every surface already has its own re-fetch function to call. A
// lower-frequency safety-net poll (kept by each caller, not this hook)
// covers the case where a broadcast is dropped — the backend already
// catches and swallows broadcast failures on every send path, so that's a
// real, not hypothetical, failure mode.
//
// `fetchConfig` must be a stable (useCallback'd) function that resolves to
// { configured, url, anonKey, token, topic }. The hook re-subscribes
// whenever its identity changes (e.g. the selected case changes).
export function useCaseRealtimeChat({ fetchConfig, enabled = true, onMessage }) {
  const onMessageRef = useRef(onMessage);
  onMessageRef.current = onMessage;

  useEffect(() => {
    if (!enabled) return undefined;
    let active = true;
    let client = null;
    let channel = null;
    let refreshTimer = null;

    (async () => {
      const config = await fetchConfig().catch(() => null);
      if (!active || !config?.configured) return;
      const { createClient } = await import("@supabase/supabase-js");
      if (!active) return;
      // A dedicated, disposable client — never the app's shared auth
      // client from services/supabase.js. This case-scoped realtime token
      // is a 15-minute credential with nothing to do with the user's own
      // Supabase session, and mirrors the one place in this codebase that
      // already talks to Realtime (the token-link chat page).
      client = createClient(config.url, config.anonKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      client.realtime.setAuth(config.token);
      channel = client
        .channel(config.topic, { config: { private: true } })
        .on("broadcast", { event: "message" }, () => onMessageRef.current?.())
        .subscribe();

      refreshTimer = window.setInterval(async () => {
        if (!active || !client) return;
        const fresh = await fetchConfig().catch(() => null);
        if (active && client && fresh?.token) client.realtime.setAuth(fresh.token);
      }, TOKEN_REFRESH_MS);
    })();

    return () => {
      active = false;
      if (refreshTimer) window.clearInterval(refreshTimer);
      if (client && channel) void client.removeChannel(channel);
    };
  }, [enabled, fetchConfig]);
}
