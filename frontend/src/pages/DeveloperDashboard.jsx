import { Activity, Building2, BriefcaseBusiness, CircleAlert, LogOut, RefreshCw, UsersRound } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useAuth } from "../auth/AuthContext";
import api from "../services/api";

const cards = [
  ["Active agencies", "activeAgencies", Building2],
  ["Active staff", "staff", UsersRound],
  ["Active cases", "activeCases", BriefcaseBusiness],
  ["Open leads", "openLeads", Activity],
];

export default function DeveloperDashboard() {
  const { signOut } = useAuth();
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await api.getFresh("/developer/overview");
      setData(response.data.data);
    } catch (reason) {
      setError(reason.response?.data?.message || "Performance data could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  return <main className="min-h-screen bg-slate-50 text-slate-950">
    <header className="border-b border-slate-200 bg-white"><div className="mx-auto flex max-w-6xl items-center gap-3 px-5 py-4"><div className="min-w-0 flex-1"><h1 className="text-lg font-semibold">CaseDesk Performance</h1><p className="text-xs text-slate-500">Aggregate platform telemetry only</p></div><button type="button" onClick={load} disabled={loading} aria-label="Refresh" title="Refresh" className="flex h-10 w-10 items-center justify-center text-slate-500 hover:bg-slate-100"><RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /></button><button type="button" onClick={signOut} aria-label="Sign out" title="Sign out" className="flex h-10 w-10 items-center justify-center text-slate-500 hover:bg-slate-100"><LogOut className="h-4 w-4" /></button></div></header>
    <div className="mx-auto max-w-6xl px-5 py-8">
      {error ? <div className="mb-6 flex items-center gap-2 border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700"><CircleAlert className="h-4 w-4" />{error}</div> : null}
      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">{cards.map(([label, key, Icon]) => <article key={key} className="border border-slate-200 bg-white p-5"><Icon className="h-5 w-5 text-sky-600" /><p className="mt-5 text-3xl font-semibold">{data?.adoption?.[key] ?? "-"}</p><p className="mt-1 text-sm text-slate-500">{label}</p></article>)}</section>
      <section className="mt-8 grid gap-6 md:grid-cols-2"><div className="border-t border-slate-300 pt-4"><h2 className="text-sm font-semibold">Usage</h2><dl className="mt-4 divide-y divide-slate-200"><div className="flex justify-between py-3 text-sm"><dt>Activity events, last 24 hours</dt><dd className="font-semibold">{data?.usage?.activity24h ?? "-"}</dd></div><div className="flex justify-between py-3 text-sm"><dt>Active users, last 7 days</dt><dd className="font-semibold">{data?.usage?.activeUsers7d ?? "-"}</dd></div></dl></div><div className="border-t border-slate-300 pt-4"><h2 className="text-sm font-semibold">Support</h2><dl className="mt-4 divide-y divide-slate-200"><div className="flex justify-between py-3 text-sm"><dt>Open reports</dt><dd className="font-semibold">{data?.support?.open ?? "-"}</dd></div><div className="flex justify-between py-3 text-sm"><dt>Email delivery pending</dt><dd className="font-semibold">{data?.support?.deliveryPending ?? "-"}</dd></div></dl></div></section>
      {data?.generatedAt ? <p className="mt-8 text-xs text-slate-400">Updated {new Date(data.generatedAt).toLocaleString()}</p> : null}
    </div>
  </main>;
}
