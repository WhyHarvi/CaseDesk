import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { AuthShell, fieldClass, FormField, FormMessage } from "../components/auth/AuthShell";
import { establishAuthLinkSession } from "../services/authLinkSession";
import { requireSupabase } from "../services/supabase";

export default function ResetPassword() {
  const navigate = useNavigate();
  const { refreshIdentity } = useAuth();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [checkingLink, setCheckingLink] = useState(true);
  const [ready, setReady] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    establishAuthLinkSession()
      .then(() => { if (active) setReady(true); })
      .catch((reason) => { if (active) setError(reason.message || "This recovery link is invalid or expired."); })
      .finally(() => { if (active) setCheckingLink(false); });
    return () => { active = false; };
  }, []);

  async function submit(event) {
    event.preventDefault(); setError("");
    if (password !== confirm) return setError("Passwords do not match.");
    if (password.length < 10) return setError("Password must be at least 10 characters.");
    setLoading(true);
    try {
      const { error: authError } = await requireSupabase().auth.updateUser({ password });
      if (authError) throw authError;
      const identity = await refreshIdentity();
      navigate(identity?.membership?.role === "client" ? "/client-portal" : "/app/dashboard", { replace: true });
    } catch (reason) {
      setError(reason.message || "We could not update your password. Request a new reset link and try again.");
    }
    finally { setLoading(false); }
  }

  if (checkingLink) return <AuthShell title="Opening your reset link" description="Verifying your secure password link…" compact><div className="mx-auto mt-10 h-8 w-8 animate-spin rounded-full border-4 border-sky-100 border-t-sky-600" /></AuthShell>;
  if (!ready) return <AuthShell title="Reset link unavailable" description="This password link could not be opened." backTo="/login" compact><div className="mt-8 space-y-4"><FormMessage error>{error}</FormMessage><Link to="/login?forgot=1" className="block w-full rounded-2xl bg-slate-950 px-5 py-3.5 text-center text-sm font-semibold text-white transition hover:bg-slate-800">Request a new reset link</Link></div></AuthShell>;

  return <AuthShell title="Choose a new password" description="Use at least 10 characters and avoid passwords used on other services." backTo="/login" compact><form onSubmit={submit} className="mt-8 space-y-5"><FormField label="New password"><input className={fieldClass} type="password" autoComplete="new-password" minLength={10} value={password} onChange={(event) => setPassword(event.target.value)} required /></FormField><FormField label="Confirm password"><input className={fieldClass} type="password" autoComplete="new-password" minLength={10} value={confirm} onChange={(event) => setConfirm(event.target.value)} required /></FormField>{error && <FormMessage error>{error}</FormMessage>}<button disabled={loading} className="w-full rounded-2xl bg-slate-950 px-5 py-3.5 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:opacity-60">{loading ? "Updating…" : "Update password"}</button></form></AuthShell>;
}
