import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { AuthShell, fieldClass, FormField, FormMessage } from "../components/auth/AuthShell";
import { requireSupabase } from "../services/supabase";

export default function ResetPassword() {
  const navigate = useNavigate(); const [password, setPassword] = useState(""); const [confirm, setConfirm] = useState(""); const [loading, setLoading] = useState(false); const [error, setError] = useState("");
  async function submit(event) {
    event.preventDefault(); setError("");
    if (password !== confirm) return setError("Passwords do not match.");
    if (password.length < 10) return setError("Password must be at least 10 characters.");
    setLoading(true);
    try { const { error: authError } = await requireSupabase().auth.updateUser({ password }); if (authError) throw authError; navigate("/", { replace: true }); }
    catch { setError("This recovery link is invalid or expired. Request a new one."); }
    finally { setLoading(false); }
  }
  return <AuthShell title="Choose a new password" description="Use at least 10 characters and avoid passwords used on other services." backTo="/login" compact><form onSubmit={submit} className="mt-8 space-y-5"><FormField label="New password"><input className={fieldClass} type="password" autoComplete="new-password" minLength={10} value={password} onChange={(event) => setPassword(event.target.value)} required /></FormField><FormField label="Confirm password"><input className={fieldClass} type="password" autoComplete="new-password" minLength={10} value={confirm} onChange={(event) => setConfirm(event.target.value)} required /></FormField>{error && <FormMessage error>{error}</FormMessage>}<button disabled={loading} className="w-full rounded-2xl bg-slate-950 px-5 py-3.5 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:opacity-60">{loading ? "Updating…" : "Update password"}</button></form></AuthShell>;
}
