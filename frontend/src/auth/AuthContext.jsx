import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import api from "../services/api";
import { requireSupabase, supabase } from "../services/supabase";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [state, setState] = useState({ session: null, authUser: null, appUser: null, membership: null, agency: null, loading: true, accountError: null });

  const loadIdentity = useCallback(async (session) => {
    if (!session) {
      setState((current) => ({ ...current, session: null, authUser: null, appUser: null, membership: null, agency: null, loading: false }));
      return null;
    }
    try {
      const { data } = await api.get("/auth/me", { headers: { Authorization: `Bearer ${session.access_token}` } });
      const next = { session, authUser: session.user, appUser: data.user, membership: data.membership, agency: data.agency, loading: false, accountError: null };
      setState(next);
      return next;
    } catch (error) {
      const status = error.response?.status;
      const setupRequired = error.response?.data?.code === "ACCOUNT_SETUP_REQUIRED";
      if (setupRequired) {
        const next = { session, authUser: session.user, appUser: null, membership: null, agency: null, loading: false, accountError: null };
        setState(next);
        return next;
      }
      const accessDenied = status === 401 || status === 403;
      if (accessDenied) await supabase?.auth.signOut();
      const message = error.response?.data?.message || (accessDenied
        ? "Your CaseDesk account does not have active access."
        : "The CaseDesk server is unavailable. Please try again.");
      setState({ session: accessDenied ? null : session, authUser: accessDenied ? null : session.user, appUser: null, membership: null, agency: null, loading: false, accountError: message });
      throw new Error(message);
    }
  }, []);

  useEffect(() => {
    let active = true;
    if (!supabase) {
      setState((current) => ({ ...current, loading: false, accountError: "CaseDesk authentication is not configured." }));
      return undefined;
    }
    supabase.auth.getSession().then(({ data }) => active && loadIdentity(data.session).catch(() => {}));
    const { data: listener } = supabase.auth.onAuthStateChange((event, session) => {
      if (["TOKEN_REFRESHED", "SIGNED_IN", "PASSWORD_RECOVERY"].includes(event) && active) {
        setState((current) => ({ ...current, session, authUser: session?.user || null, loading: false }));
      }
      if (event === "SIGNED_OUT" && active) setState((current) => ({ ...current, session: null, authUser: null, appUser: null, membership: null, agency: null, loading: false }));
    });
    return () => { active = false; listener.subscription.unsubscribe(); };
  }, [loadIdentity]);

  const signIn = useCallback(async (email, password) => {
    setState((current) => ({ ...current, accountError: null }));
    const client = requireSupabase();
    const { data, error } = await client.auth.signInWithPassword({ email: email.trim(), password });
    if (error) throw new Error("Email or password is incorrect.");
    return loadIdentity(data.session);
  }, [loadIdentity]);

  const signOut = useCallback(async () => {
    await api.post("/auth/logout").catch(() => {});
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
