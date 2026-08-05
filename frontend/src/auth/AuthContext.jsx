import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import api from "../services/api";
import { requireSupabase, supabase } from "../services/supabase";
import { clearApiCache, setApiCacheScope } from "../services/queryClient";
import { cancelAppWarmup, warmAppCache } from "../services/routePrefetch";

const AuthContext = createContext(null);

const IDENTITY_CACHE_KEY = "casedesk.identity.v1";

function readCachedIdentity(userId) {
  try {
    const raw = sessionStorage.getItem(IDENTITY_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed.userId !== userId) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeCachedIdentity(userId, data) {
  try {
    sessionStorage.setItem(IDENTITY_CACHE_KEY, JSON.stringify({ userId, user: data.user, membership: data.membership, agency: data.agency }));
  } catch { /* storage full/unavailable — cache is best-effort */ }
}

function clearCachedIdentity() {
  try { sessionStorage.removeItem(IDENTITY_CACHE_KEY); } catch { /* noop */ }
}

export function AuthProvider({ children }) {
  const [state, setState] = useState({ session: null, authUser: null, appUser: null, membership: null, agency: null, loading: true, accessReady: false, accountError: null });
  const accessRefreshInFlight = useRef(false);
  const lastAccessRefreshAt = useRef(0);

  const loadIdentity = useCallback(async (session) => {
    if (!session) {
      setApiCacheScope(null, null);
      lastAccessRefreshAt.current = 0;
      setState((current) => ({ ...current, session: null, authUser: null, appUser: null, membership: null, agency: null, loading: false, accessReady: true }));
      return null;
    }
    try {
      const { data } = await api.get("/auth/me", { headers: { Authorization: `Bearer ${session.access_token}` } });
      const next = { session, authUser: session.user, appUser: data.user, membership: data.membership, agency: data.agency, loading: false, accessReady: true, accountError: null };
      writeCachedIdentity(session.user.id, data);
      setApiCacheScope(session.user.id, data.agency?.id);
      lastAccessRefreshAt.current = Date.now();
      setState(next);
      warmAppCache(data.membership?.role);
      return next;
    } catch (error) {
      const status = error.response?.status;
      const setupRequired = error.response?.data?.code === "ACCOUNT_SETUP_REQUIRED";
      if (setupRequired) {
        const next = { session, authUser: session.user, appUser: null, membership: null, agency: null, loading: false, accessReady: true, accountError: null };
        setState(next);
        return next;
      }
      const accessDenied = status === 401 || status === 403;
      if (accessDenied) { clearCachedIdentity(); await supabase?.auth.signOut(); }
      const message = error.response?.data?.message || (accessDenied
        ? "Your CaseDesk account does not have active access."
        : "The CaseDesk server is unavailable. Please try again.");
      setState({ session: accessDenied ? null : session, authUser: accessDenied ? null : session.user, appUser: null, membership: null, agency: null, loading: false, accessReady: true, accountError: message });
      throw new Error(message);
    }
  }, []);

  const refreshAccess = useCallback(async (session, { force = false } = {}) => {
    if (!session || accessRefreshInFlight.current) return null;
    if (!force && Date.now() - lastAccessRefreshAt.current < 15_000) return null;
    accessRefreshInFlight.current = true;
    try {
      const { data } = await api.get("/auth/access", {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      const next = {
        session,
        authUser: session.user,
        appUser: data.user,
        membership: data.membership,
        agency: data.agency,
        loading: false,
        accessReady: true,
        accountError: null,
      };
      writeCachedIdentity(session.user.id, data);
      setApiCacheScope(session.user.id, data.agency?.id);
      lastAccessRefreshAt.current = Date.now();
      setState((current) =>
        current.session?.user?.id === session.user.id ? next : current,
      );
      return next;
    } catch (error) {
      const accessDenied = [401, 403].includes(error.response?.status);
      if (accessDenied) {
        clearCachedIdentity();
        cancelAppWarmup();
        clearApiCache();
        await supabase?.auth.signOut();
      }
      // A temporary network error must not remove an otherwise valid signed-in
      // identity. The next focus/interval refresh will try again.
      return null;
    } finally {
      accessRefreshInFlight.current = false;
    }
  }, []);

  useEffect(() => {
    let active = true;
    if (!supabase) {
      setState((current) => ({ ...current, loading: false, accountError: "CaseDesk authentication is not configured." }));
      return undefined;
    }
    supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      const session = data.session;
      const cached = session ? readCachedIdentity(session.user.id) : null;
      if (cached?.membership) {
        // Render immediately from the last known identity; /auth/me still runs
        // in the background and corrects state (or signs out) if anything changed.
        setApiCacheScope(session.user.id, cached.agency?.id);
        setState({ session, authUser: session.user, appUser: cached.user, membership: cached.membership, agency: cached.agency, loading: false, accessReady: false, accountError: null });
        warmAppCache(cached.membership?.role);
      }
      loadIdentity(session).catch(() => {});
    });
    const { data: listener } = supabase.auth.onAuthStateChange((event, session) => {
      if (["TOKEN_REFRESHED", "SIGNED_IN", "PASSWORD_RECOVERY"].includes(event) && active) {
        setState((current) => ({ ...current, session, authUser: session?.user || null, loading: false }));
        if (event === "TOKEN_REFRESHED" && session) {
          void refreshAccess(session, { force: true });
        }
      }
      if (event === "SIGNED_OUT" && active) {
        clearCachedIdentity();
        cancelAppWarmup();
        clearApiCache();
        setState((current) => ({ ...current, session: null, authUser: null, appUser: null, membership: null, agency: null, loading: false, accessReady: true }));
      }
    });
    const refreshWhenVisible = () => {
      if (!active || document.visibilityState === "hidden") return;
      supabase.auth.getSession().then(({ data }) => {
        if (active && data.session) void refreshAccess(data.session);
      });
    };
    window.addEventListener("focus", refreshWhenVisible);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    const interval = window.setInterval(refreshWhenVisible, 60_000);
    return () => {
      active = false;
      listener.subscription.unsubscribe();
      window.removeEventListener("focus", refreshWhenVisible);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
      window.clearInterval(interval);
    };
  }, [loadIdentity, refreshAccess]);

  const signIn = useCallback(async (email, password) => {
    setState((current) => ({ ...current, accountError: null }));
    const client = requireSupabase();
    const { data, error } = await client.auth.signInWithPassword({ email: email.trim(), password });
    if (error) throw new Error("Email or password is incorrect.");
    return loadIdentity(data.session);
  }, [loadIdentity]);

  const signOut = useCallback(async () => {
    await api.post("/auth/logout").catch(() => {});
    cancelAppWarmup();
    clearApiCache();
    await supabase?.auth.signOut();
  }, []);

  const refreshIdentity = useCallback(async () => {
    const client = requireSupabase();
    const { data } = await client.auth.getSession();
    return loadIdentity(data.session);
  }, [loadIdentity]);

  const value = useMemo(() => ({ ...state, role: state.membership?.role || null, isAuthenticated: Boolean(state.session && state.membership), signIn, signOut, refreshIdentity }), [state, signIn, signOut, refreshIdentity]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used inside AuthProvider");
  return value;
}
