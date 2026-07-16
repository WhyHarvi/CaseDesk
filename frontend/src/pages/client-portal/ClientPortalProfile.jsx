import { ChevronRight, CircleHelp, Loader2, LogOut, Mail, MapPin, Phone, UserRound } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { updatePortalProfile, portalErrorMessage } from "../../api/clientPortalApi";
import { useAuth } from "../../auth/AuthContext";
import ClientPortalHeader from "../../components/client-portal/ClientPortalHeader";
import ClientPortalSkeleton, { GlassCard } from "../../components/client-portal/ClientPortalSkeleton";
import ClientPortalEmptyState from "../../components/client-portal/ClientPortalEmptyState";
import { usePortalData } from "../../components/client-portal/ClientPortalLayout";
import { usePortalToast } from "../../components/client-portal/ClientPortalToast";

const inputClass = "mt-2 h-12 w-full rounded-2xl border border-slate-200 bg-white/90 px-4 text-base text-slate-900 outline-none transition focus:border-sky-300 focus:ring-4 focus:ring-sky-100";

export default function ClientPortalProfile() {
  const { overview, loading, error, refresh } = usePortalData();
  const { signOut } = useAuth();
  const { showToast } = usePortalToast();
  const [form, setForm] = useState({ phone: "", address: "" });
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");

  useEffect(() => {
    if (overview?.client) setForm({ phone: overview.client.phone || "", address: overview.client.address || "" });
  }, [overview?.client]);

  if (loading) return <ClientPortalSkeleton rows={3} />;
  if (error || !overview) {
    return (
      <div className="pt-16">
        <ClientPortalEmptyState icon={UserRound} title="We couldn't load your profile" copy={error || "Something went wrong."} />
      </div>
    );
  }

  const { client, agency } = overview;
  const dirty = form.phone !== (client.phone || "") || form.address !== (client.address || "");

  async function save(event) {
    event.preventDefault();
    setSaving(true);
    setSaveError("");
    try {
      await updatePortalProfile(form);
      showToast("Your details were updated.");
      await refresh({ silent: true });
    } catch (reason) {
      setSaveError(portalErrorMessage(reason, "Your details could not be updated."));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      <ClientPortalHeader title="Profile" subtitle="Your account and contact details" client={client} agency={agency} />

      <GlassCard className="p-5">
        <div className="flex items-center gap-4">
          <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-sky-500 to-indigo-500 text-lg font-semibold text-white shadow-[0_10px_25px_rgba(56,130,246,0.3)]">
            {(client.fullName || "You").split(" ").filter(Boolean).map((part) => part[0]).join("").slice(0, 2).toUpperCase()}
          </div>
          <div className="min-w-0">
            <h2 className="truncate text-lg font-semibold tracking-tight text-slate-950">{client.fullName}</h2>
            <p className="mt-0.5 flex items-center gap-1.5 truncate text-sm text-slate-500">
              <Mail className="h-3.5 w-3.5 shrink-0" />
              {client.email || "No email on file"}
            </p>
          </div>
        </div>
        <p className="mt-4 rounded-2xl bg-slate-50/90 px-4 py-3 text-[12px] leading-5 text-slate-500">
          Your name and email are managed by {agency.name}. Contact them from the Help tab if these need to change.
        </p>
      </GlassCard>

      <form onSubmit={save}>
        <GlassCard className="p-5">
          <h2 className="text-[15px] font-semibold text-slate-900">Contact details</h2>
          <p className="mt-0.5 text-[13px] text-slate-500">Keep these up to date so your agency can reach you.</p>

          <label className="mt-4 block text-sm font-medium text-slate-700">
            <span className="flex items-center gap-1.5"><Phone className="h-3.5 w-3.5 text-slate-400" />Phone</span>
            <input value={form.phone} maxLength={40} onChange={(event) => setForm((current) => ({ ...current, phone: event.target.value }))} placeholder="+1 416 555 0123" className={inputClass} />
          </label>
          <label className="mt-4 block text-sm font-medium text-slate-700">
            <span className="flex items-center gap-1.5"><MapPin className="h-3.5 w-3.5 text-slate-400" />Address</span>
            <textarea value={form.address} maxLength={300} rows={3} onChange={(event) => setForm((current) => ({ ...current, address: event.target.value }))} placeholder="Your current address" className="mt-2 w-full resize-none rounded-2xl border border-slate-200 bg-white/90 px-4 py-3 text-base text-slate-900 outline-none transition focus:border-sky-300 focus:ring-4 focus:ring-sky-100" />
          </label>

          {saveError ? <p className="mt-3 rounded-xl bg-rose-50 px-3.5 py-2.5 text-sm text-rose-700">{saveError}</p> : null}

          <button
            disabled={saving || !dirty}
            className="mt-4 inline-flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-slate-950 text-sm font-semibold text-white shadow-[0_10px_24px_rgba(15,23,42,0.2)] transition-all duration-200 hover:bg-slate-800 active:scale-[0.98] disabled:opacity-40"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {saving ? "Saving…" : "Save changes"}
          </button>
        </GlassCard>
      </form>

      <Link
        to="/client-portal/help"
        className="flex items-center gap-3.5 rounded-3xl border border-white/70 bg-white/75 px-5 py-4 shadow-[0_10px_30px_rgba(28,45,74,0.06)] backdrop-blur-xl transition-all duration-200 hover:-translate-y-0.5 active:scale-[0.99]"
      >
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-sky-100 text-sky-700"><CircleHelp className="h-[18px] w-[18px]" /></div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-slate-900">Help & contact</p>
          <p className="mt-0.5 text-[13px] text-slate-500">Agency contact details and common questions</p>
        </div>
        <ChevronRight className="h-4 w-4 shrink-0 text-slate-300" />
      </Link>

      <button
        type="button"
        onClick={signOut}
        className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white/70 text-sm font-semibold text-slate-600 backdrop-blur transition-all duration-200 hover:border-rose-200 hover:text-rose-600 active:scale-[0.98]"
      >
        <LogOut className="h-4 w-4" />
        Sign out
      </button>
    </div>
  );
}
