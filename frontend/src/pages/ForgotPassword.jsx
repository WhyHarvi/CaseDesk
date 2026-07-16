import { useState } from "react";
import { AuthShell, fieldClass, FormField, FormMessage } from "../components/auth/AuthShell";
import { requireSupabase } from "../services/supabase";

export default function ForgotPassword() {
  const [email, setEmail] = useState(""); const [loading, setLoading] = useState(false); const [sent, setSent] = useState(false); const [error, setError] = useState("");
  async function submit(event) {
    event.preventDefault(); setLoading(true); setError("");
    try {
      const redirectTo = `${window.location.origin}/auth/reset-password`;
      const { error: authError } = await requireSupabase().auth.resetPasswordForEmail(email.trim(), { redirectTo });
      if (authError) throw authError;
      setSent(true);
    } catch { setError("Password recovery is temporarily unavailable. Please try again."); }
    finally { setLoading(false); }
  }
  return <AuthShell title={sent ? "Check your inbox" : "Reset your password"} description={sent ? "If an account matches that email, a secure recovery link will arrive shortly." : "Enter the email used for your CaseDesk account."} backTo="/login" compact>
    {!sent && <form onSubmit={submit} className="mt-8 space-y-5"><FormField label="Email"><input className={fieldClass} type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} required /></FormField>{error && <FormMessage error>{error}</FormMessage>}<button disabled={loading} className="w-full rounded-2xl bg-slate-950 px-5 py-3.5 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:opacity-60">{loading ? "Sending…" : "Send recovery link"}</button></form>}
  </AuthShell>;
}
