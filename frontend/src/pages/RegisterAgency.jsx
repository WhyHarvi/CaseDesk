import { useState } from "react";
import api from "../services/api";
import { AuthShell, fieldClass, FormField, FormMessage } from "../components/auth/AuthShell";

const initial = { fullName: "", workEmail: "", agencyName: "", phone: "", country: "Canada", acceptTerms: false };

export default function RegisterAgency() {
  const [form, setForm] = useState(initial);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);
  const update = (key) => (event) => setForm((current) => ({ ...current, [key]: event.target.type === "checkbox" ? event.target.checked : event.target.value }));

  async function submit(event) {
    event.preventDefault(); setLoading(true); setError("");
    try { await api.post("/onboarding/register-agency", form); setSent(true); }
    catch (reason) { setError(reason.response?.data?.message || "We could not create your invitation. Please try again."); }
    finally { setLoading(false); }
  }

  return <AuthShell title={sent ? "Check your inbox" : "Create your workspace"} description={sent ? `We sent setup instructions to ${form.workEmail}. The secure link will let you choose your password and finish your agency profile.` : "Start with the essentials. These agency details are reused in CaseDesk templates and correspondence."} backTo="/login">
    {sent ? <div className="mt-8"><FormMessage>Your invitation is on its way. If it does not arrive, check your spam folder or contact CaseDesk support.</FormMessage></div> : <form onSubmit={submit} className="mt-8 grid gap-5 sm:grid-cols-2">
      <FormField label="Your name"><input className={fieldClass} value={form.fullName} onChange={update("fullName")} autoComplete="name" required placeholder="Alex Morgan" /></FormField>
      <FormField label="Work email"><input className={fieldClass} value={form.workEmail} onChange={update("workEmail")} autoComplete="email" type="email" required placeholder="alex@agency.ca" /></FormField>
      <FormField label="Agency name"><input className={fieldClass} value={form.agencyName} onChange={update("agencyName")} autoComplete="organization" required placeholder="North Star Immigration" /></FormField>
      <FormField label="Phone" hint="Optional at this stage"><input className={fieldClass} value={form.phone} onChange={update("phone")} autoComplete="tel" placeholder="+1 416 555 0123" /></FormField>
      <FormField label="Country"><input className={fieldClass} value={form.country} onChange={update("country")} autoComplete="country-name" required /></FormField>
      <div className="flex items-end sm:pb-3"><label className="flex cursor-pointer items-start gap-3 text-sm leading-5 text-slate-600"><input type="checkbox" className="mt-0.5 h-4 w-4 rounded border-slate-300 text-sky-600 focus:ring-sky-500" checked={form.acceptTerms} onChange={update("acceptTerms")} required /><span>I agree to the CaseDesk terms and privacy policy.</span></label></div>
      {error && <div className="sm:col-span-2"><FormMessage error>{error}</FormMessage></div>}
      <button disabled={loading} className="rounded-2xl bg-slate-950 px-5 py-3.5 text-sm font-semibold text-white shadow-lg shadow-slate-300 transition hover:-translate-y-0.5 hover:bg-slate-800 disabled:translate-y-0 disabled:cursor-wait disabled:opacity-60 sm:col-span-2">{loading ? "Creating invitation…" : "Continue with email"}</button>
    </form>}
  </AuthShell>;
}
