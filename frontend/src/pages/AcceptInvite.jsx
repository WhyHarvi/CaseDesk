import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { AuthShell, fieldClass, FormField, FormMessage } from "../components/auth/AuthShell";
import api from "../services/api";
import { requireSupabase } from "../services/supabase";

export default function AcceptInvite() {
  const navigate = useNavigate();
  const { refreshIdentity } = useAuth();
  const [context, setContext] = useState(null);
  const [form, setForm] = useState({ password: "", confirmPassword: "", agencyName: "", agencyEmail: "", phone: "", address: "", city: "", province: "", country: "Canada", postalCode: "" });
  const [loading, setLoading] = useState(true); const [saving, setSaving] = useState(false); const [error, setError] = useState("");
  const update = (key) => (event) => setForm((current) => ({ ...current, [key]: event.target.value }));

  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const client = requireSupabase();
        const { data } = await client.auth.getSession();
        if (!data.session) throw new Error("Open the secure link from your invitation email to continue.");
        const invitation = (await api.get("/auth/invitation")).data.data;
        let agency = {};
        if (invitation.requiresAgencySetup) agency = (await api.get("/onboarding/status")).data.data.agency;
        if (!active) return;
        setContext(invitation);
        setForm((current) => ({ ...current, agencyName: agency.name || invitation.agencyName || "", agencyEmail: agency.email || invitation.email || "", phone: agency.phone || "", address: agency.address || "", city: agency.city || "", province: agency.province || "", country: agency.country || "Canada", postalCode: agency.postalCode || "" }));
      } catch (reason) { if (active) setError(reason.response?.data?.message || reason.message || "This invitation is invalid or expired."); }
      finally { if (active) setLoading(false); }
    }
    load(); return () => { active = false; };
  }, []);

  async function submit(event) {
    event.preventDefault(); setError("");
    if (form.password !== form.confirmPassword) return setError("Passwords do not match.");
    setSaving(true);
    try {
      if (context.requiresAgencySetup) await api.post("/onboarding/complete", form);
      else await api.post("/auth/accept-invitation", { password: form.password });
      const identity = await refreshIdentity();
      navigate(identity.membership.role === "client" ? "/client-portal" : "/app/dashboard", { replace: true });
    } catch (reason) { setError(reason.response?.data?.message || reason.message || "We could not activate your account."); }
    finally { setSaving(false); }
  }

  if (loading) return <AuthShell title="Opening your invitation" description="Verifying your secure setup link…" compact><div className="mx-auto mt-10 h-8 w-8 animate-spin rounded-full border-4 border-sky-100 border-t-sky-600" /></AuthShell>;
  if (!context) return <AuthShell title="Invitation unavailable" description="The setup link could not be opened." backTo="/login" compact><div className="mt-8"><FormMessage error>{error}</FormMessage></div></AuthShell>;

  return <AuthShell title={context.requiresAgencySetup ? "Set up your workspace" : "Finish your account"} description={context.requiresAgencySetup ? "Choose a password and confirm the workspace details CaseDesk will use in your templates." : `You’re joining ${context.agencyName}. Choose a secure password to continue.`} backTo="/login">
    <form onSubmit={submit} className="mt-8 grid gap-5 sm:grid-cols-2">
      {context.requiresAgencySetup && <>
        <FormField label="Workspace name"><input className={fieldClass} value={form.agencyName} onChange={update("agencyName")} required /></FormField>
        <FormField label="Workspace email"><input className={fieldClass} type="email" value={form.agencyEmail} onChange={update("agencyEmail")} required /></FormField>
        <FormField label="Phone"><input className={fieldClass} value={form.phone} onChange={update("phone")} autoComplete="tel" required /></FormField>
        <FormField label="Street address"><input className={fieldClass} value={form.address} onChange={update("address")} autoComplete="street-address" required /></FormField>
        <FormField label="City"><input className={fieldClass} value={form.city} onChange={update("city")} autoComplete="address-level2" required /></FormField>
        <FormField label="Province or state"><input className={fieldClass} value={form.province} onChange={update("province")} autoComplete="address-level1" required /></FormField>
        <FormField label="Country"><input className={fieldClass} value={form.country} onChange={update("country")} autoComplete="country-name" required /></FormField>
        <FormField label="Postal code"><input className={fieldClass} value={form.postalCode} onChange={update("postalCode")} autoComplete="postal-code" required /></FormField>
      </>}
      <FormField label="Create password" hint="Use at least 10 characters"><input className={fieldClass} type="password" value={form.password} onChange={update("password")} autoComplete="new-password" minLength={10} required /></FormField>
      <FormField label="Confirm password"><input className={fieldClass} type="password" value={form.confirmPassword} onChange={update("confirmPassword")} autoComplete="new-password" minLength={10} required /></FormField>
      {error && <div className="sm:col-span-2"><FormMessage error>{error}</FormMessage></div>}
      <button disabled={saving} className="rounded-2xl bg-slate-950 px-5 py-3.5 text-sm font-semibold text-white shadow-lg shadow-slate-300 transition hover:-translate-y-0.5 hover:bg-slate-800 disabled:translate-y-0 disabled:cursor-wait disabled:opacity-60 sm:col-span-2">{saving ? "Preparing your workspace…" : "Open CaseDesk"}</button>
    </form>
  </AuthShell>;
}
