import { CheckCircle2, Clock3, KeyRound, Loader2, LogOut, MailCheck, ShieldCheck, Smartphone, UserRound } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../auth/AuthContext";
import api from "../../services/api";

function formatDate(value, includeTime = true) {
  if (!value) return "Not recorded";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Not recorded";
  return new Intl.DateTimeFormat("en-CA", {
    month: "short",
    day: "numeric",
    year: "numeric",
    ...(includeTime ? { hour: "numeric", minute: "2-digit" } : {}),
  }).format(date);
}

function roleLabel(role) {
  return role === "frontdesk" ? "Front Desk" : String(role || "Member").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function SecurityRow({ icon: Icon, title, detail, status, action }) {
  return (
    <div className="flex flex-col gap-3 border-b border-slate-100 py-4 last:border-b-0 sm:flex-row sm:items-center">
      <div className="flex min-w-0 flex-1 items-start gap-3">
        <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl bg-slate-50 text-slate-500"><Icon className="h-4 w-4" /></span>
        <div className="min-w-0"><p className="text-[14px] font-semibold text-slate-900">{title}</p><p className="mt-0.5 text-[12px] leading-5 text-slate-500">{detail}</p></div>
      </div>
      <div className="flex items-center gap-3 pl-12 sm:pl-0">
        {status ? <span className="text-[12px] font-semibold text-slate-600">{status}</span> : null}
        {action}
      </div>
    </div>
  );
}

export default function SecuritySettingsPanel({ compact = false }) {
  const navigate = useNavigate();
  const { session, signOut } = useAuth();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    api.getFresh("/account/security")
      .then((response) => { if (active) setData(response.data.data); })
      .catch((reason) => { if (active) setError(reason.response?.data?.message || "Security information could not be loaded."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  const sessionExpiresAt = useMemo(() => session?.expires_at ? new Date(session.expires_at * 1000) : null, [session?.expires_at]);

  if (loading) return <div className="flex min-h-52 items-center justify-center gap-2 text-[13px] text-slate-400"><Loader2 className="h-4 w-4 animate-spin" /> Loading account security…</div>;
  if (!data) return <p className="rounded-2xl bg-rose-50 px-4 py-3 text-[13px] text-rose-700">{error || "Security information is unavailable."}</p>;

  return (
    <div className={compact ? "pb-6" : "pb-10"}>
      <header className="flex items-start gap-3 border-b border-slate-100 pb-6">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-700"><ShieldCheck className="h-5 w-5" /></span>
        <div><h2 className="text-[24px] font-semibold tracking-[-0.035em] text-slate-950">Security</h2><p className="mt-1 max-w-2xl text-[14px] leading-6 text-slate-500">Your sign-in, password, session, and workspace access in one place.</p></div>
      </header>

      <section className="pt-5">
        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">Account access</p>
        <div className="mt-2">
          <SecurityRow icon={UserRound} title={data.account.fullName} detail={`${data.account.email} · ${data.account.workspaceName}`} status={roleLabel(data.account.role)} />
          <SecurityRow icon={MailCheck} title="Sign-in email" detail={data.account.email} status={data.account.emailConfirmedAt ? "Verified" : "Verification pending"} />
          <SecurityRow icon={ShieldCheck} title="Workspace access" detail={`Your ${roleLabel(data.account.role)} membership controls which CaseDesk records you can open.`} status={data.account.workspaceAccess === "active" ? "Active" : data.account.workspaceAccess} />
        </div>
      </section>

      <section className="pt-6">
        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">Authentication</p>
        <div className="mt-2">
          <SecurityRow
            icon={KeyRound}
            title="Password"
            detail={data.account.lastPasswordChangedAt ? `Last changed ${formatDate(data.account.lastPasswordChangedAt)}` : `Use at least ${data.authentication.minimumPasswordLength} characters and a password unique to CaseDesk.`}
            status={data.account.mustChangePassword ? "Change required" : "Protected"}
            action={<button type="button" onClick={() => navigate("/change-password")} className="rounded-full bg-slate-950 px-3.5 py-2 text-[12px] font-semibold text-white transition hover:bg-slate-800">Change password</button>}
          />
          <SecurityRow icon={Smartphone} title="Two-step verification" detail="Additional verification factors connected to your authentication account." status={data.authentication.mfaEnabled ? `${data.authentication.verifiedFactorCount} verified` : "Not enabled"} />
        </div>
      </section>

      <section className="pt-6">
        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">Current session</p>
        <div className="mt-2">
          <SecurityRow
            icon={Clock3}
            title="This device"
            detail={`Signed in${data.account.lastSignInAt ? ` ${formatDate(data.account.lastSignInAt)}` : ""}${sessionExpiresAt ? ` · session refresh due ${formatDate(sessionExpiresAt)}` : ""}.`}
            status="Active now"
            action={<button type="button" onClick={signOut} className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 px-3.5 py-2 text-[12px] font-semibold text-slate-600 transition hover:border-rose-200 hover:text-rose-600"><LogOut className="h-3.5 w-3.5" /> Sign out</button>}
          />
        </div>
      </section>

      {data.recentSecurity?.length ? (
        <section className="pt-6">
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">Recent security activity</p>
          <div className="mt-3 divide-y divide-slate-100 border-y border-slate-100">
            {data.recentSecurity.map((item) => <div key={item.id} className="flex items-center gap-3 py-3"><CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" /><p className="min-w-0 flex-1 truncate text-[13px] font-medium text-slate-700">{item.label}</p><time className="shrink-0 text-[11px] text-slate-400">{formatDate(item.createdAt)}</time></div>)}
          </div>
        </section>
      ) : null}
      {error ? <p className="mt-4 rounded-xl bg-rose-50 px-4 py-3 text-[13px] text-rose-700">{error}</p> : null}
    </div>
  );
}
