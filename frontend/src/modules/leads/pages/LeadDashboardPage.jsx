import { Activity, AlertTriangle, ArrowRight, CalendarCheck2, Clock3, ContactRound, Gauge, PhoneOff, TrendingUp, UserRoundCheck, Video } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import api from "../../../services/api";
import LeadDetailSheet from "../components/LeadDetailSheet";
import LeadDashboardDrilldownDrawer from "../components/LeadDashboardDrilldownDrawer";
import { formatDueDate, humanize, leadName } from "../leadPresentation";

function MetricCard({ label, value, detail, icon: Icon, tone = "brand", onClick }) {
  const tones = {
    brand: "bg-brand-50 text-brand-700",
    rose: "bg-rose-50 text-rose-700",
    amber: "bg-amber-50 text-amber-700",
    violet: "bg-violet-50 text-violet-700",
  };
  const Tag = onClick ? "button" : "article";
  return (
    <Tag
      type={onClick ? "button" : undefined}
      onClick={onClick}
      className={`rounded-2xl border border-slate-200/70 bg-white p-5 text-left ${onClick ? "transition hover:border-slate-300 hover:shadow-sm" : ""}`}
    >
      <div className="flex items-start justify-between">
        <div><p className="text-sm font-medium text-slate-500">{label}</p><p className="mt-2 text-3xl font-semibold tracking-[-0.04em] text-slate-950">{value}</p></div>
        <div className={`flex h-10 w-10 items-center justify-center rounded-xl ${tones[tone]}`}><Icon className="h-5 w-5" /></div>
      </div>
      <p className="mt-3 text-xs text-slate-400">{detail}</p>
    </Tag>
  );
}

function DashboardSkeleton() {
  return <div className="space-y-5"><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{Array.from({ length: 4 }).map((_, index) => <div key={index} className="h-36 animate-pulse rounded-2xl bg-slate-100" />)}</div><div className="h-20 animate-pulse rounded-2xl bg-slate-100" /><div className="h-80 animate-pulse rounded-3xl bg-slate-100" /></div>;
}

const operationalLabels = {
  AWAITING_FIRST_CONTACT: "Awaiting first contact",
  NEXT_ACTION_MISSING: "Next action missing",
  INACTIVE: "Inactive",
  CONSULTATION_NO_SHOW: "Consultation no-show",
  RETAINER_PENDING: "Retainer pending",
  PAYMENT_PENDING: "Payment pending",
};

export default function LeadDashboardPage() {
  const [dashboard, setDashboard] = useState(null);
  const [staff, setStaff] = useState([]);
  const [selectedLead, setSelectedLead] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [operationalFilter, setOperationalFilter] = useState("ALL");
  const [drilldown, setDrilldown] = useState(null);
  const [drilldownItems, setDrilldownItems] = useState([]);
  const [drilldownLoading, setDrilldownLoading] = useState(false);
  const [drilldownError, setDrilldownError] = useState("");

  const openDrilldown = useCallback(async (metric) => {
    setDrilldown(metric);
    setDrilldownLoading(true);
    setDrilldownError("");
    try {
      const response = await api.get(`/leads/dashboard/drilldown?metric=${metric}`);
      setDrilldownItems(response.data.data);
    } catch (requestError) {
      setDrilldownError(requestError.response?.data?.message || "This list could not be loaded.");
    } finally {
      setDrilldownLoading(false);
    }
  }, []);

  const closeDrilldown = useCallback(() => {
    setDrilldown(null);
    setDrilldownItems([]);
    setDrilldownError("");
  }, []);

  const loadDashboard = useCallback(async () => {
    try {
      setLoading(true);
      const [dashboardResponse, staffResponse] = await Promise.all([api.get("/leads/dashboard"), api.get("/leads/staff")]);
      setDashboard(dashboardResponse.data.data);
      setStaff(staffResponse.data.data);
      setError("");
    } catch (requestError) {
      setError(requestError.response?.data?.message || "The lead dashboard could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadDashboard(); }, [loadDashboard]);

  const summary = dashboard?.summary;
  const operational = dashboard?.operational;
  const watchlist = operational?.watchlist?.filter((lead) => operationalFilter === "ALL" || lead.issues.includes(operationalFilter)) || [];
  const money = new Intl.NumberFormat("en-CA", { style: "currency", currency: dashboard?.currency || "CAD", maximumFractionDigits: 0 });

  return (
    <section className="space-y-6 pb-8">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div><p className="text-xs font-semibold uppercase tracking-[0.18em] text-brand-600">Lead command centre</p><h1 className="mt-2 text-3xl font-semibold tracking-[-0.03em] text-slate-950">Lead dashboard</h1><p className="mt-1.5 text-sm text-slate-500">Today’s priorities and the health of your lead pipeline.</p></div>
        <div className="flex gap-2"><Link to="/lead-reports" className="inline-flex h-10 items-center justify-center rounded-full border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 shadow-sm hover:bg-slate-50">Reports</Link><Link to="/leads" className="inline-flex h-10 items-center justify-center gap-2 rounded-full border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 shadow-sm hover:bg-slate-50">View all leads<ArrowRight className="h-4 w-4" /></Link></div>
      </header>

      {error ? <div className="rounded-2xl border border-rose-200 bg-rose-50 px-5 py-4 text-sm text-rose-700"><p>{error}</p><button type="button" onClick={loadDashboard} className="mt-2 font-semibold">Try again</button></div> : null}
      {loading ? <DashboardSkeleton /> : dashboard ? <>
        <section aria-label="Today's lead priorities" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <MetricCard label="Follow-ups today" value={summary.followUpsDueToday} detail="Pending within today" icon={CalendarCheck2} onClick={() => openDrilldown("followUpsDueToday")} />
          <MetricCard label="Overdue work" value={summary.overdueFollowUps} detail="Pending past its due time" icon={Clock3} tone="rose" onClick={() => openDrilldown("overdueFollowUps")} />
          <MetricCard label="SLA missed" value={summary.slaMissed} detail="First response deadline passed" icon={Gauge} tone="amber" onClick={() => openDrilldown("slaMissed")} />
          <MetricCard label="Consultations today" value={summary.consultationsToday} detail="Scheduled or confirmed" icon={Video} tone="violet" onClick={() => openDrilldown("consultationsToday")} />
        </section>

        <section aria-label="Lead pipeline signals" className="grid grid-cols-2 overflow-hidden rounded-2xl border border-slate-200/70 bg-white sm:grid-cols-3 xl:grid-cols-6">
          {[
            ["New today", summary.newToday, ContactRound, "/leads?createdToday=true"],
            ["Uncontacted", summary.uncontacted, PhoneOff, "/leads?status=OPEN&uncontacted=true"],
            ["Converted this week", summary.convertedThisWeek, UserRoundCheck, "/leads?status=CONVERTED&convertedThisWeek=true"],
            ["Lost this week", summary.lostThisWeek, AlertTriangle, "/leads?status=LOST&lostThisWeek=true"],
            ["Open pipeline", money.format(summary.openPipelineValue), TrendingUp, "/leads?status=OPEN"],
            ["Conversion", `${summary.overallConversionRate}%`, Gauge, "/lead-reports"],
          ].map(([label, value, Icon, to], index) => (
            <Link key={label} to={to} className={`px-4 py-4 transition hover:bg-slate-50 ${index % 2 ? "border-l" : ""} border-slate-100 sm:border-l sm:first:border-l-0`}>
              <div className="flex items-center gap-2 text-xs font-medium text-slate-400"><Icon className="h-3.5 w-3.5" />{label}</div>
              <p className="mt-2 text-lg font-semibold text-slate-900">{value}</p>
            </Link>
          ))}
        </section>

        <section className="overflow-hidden rounded-3xl border border-white/80 bg-white shadow-[0_18px_55px_rgba(28,45,74,0.08)]">
          <div className="flex items-center justify-between border-b border-slate-200/70 px-5 py-4"><div><h2 className="text-base font-semibold text-slate-950">Today’s work</h2><p className="mt-1 text-xs text-slate-500">Overdue items appear first. Open a lead to take action.</p></div><span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">{dashboard.todayWork.length} items</span></div>
          {!dashboard.todayWork.length ? <div className="flex min-h-64 flex-col items-center justify-center px-6 text-center"><div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-600"><CalendarCheck2 className="h-5 w-5" /></div><h3 className="mt-4 text-base font-semibold text-slate-900">Today’s queue is clear</h3><p className="mt-1 text-sm text-slate-500">There are no overdue or due-today lead actions.</p></div> : <div className="overflow-x-auto"><table className="w-full min-w-[820px] text-left"><thead><tr className="border-b border-slate-200 bg-slate-50/70 text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500"><th className="px-5 py-3">Lead and source</th><th className="px-4 py-3">Current issue</th><th className="px-4 py-3">Owner</th><th className="px-4 py-3">Due</th><th className="px-4 py-3">Next action</th><th className="px-5 py-3" /></tr></thead><tbody>{dashboard.todayWork.map((lead) => { const due = formatDueDate(lead.nextActionAt || lead.firstContactDueAt); return <tr key={lead.id} className="border-b border-slate-100 last:border-0"><td className="px-5 py-4"><p className="text-sm font-semibold text-slate-900">{leadName(lead)}</p><p className="mt-0.5 text-xs text-slate-400">{lead.originalSource?.name || "Unknown source"} · {lead.leadNumber}</p></td><td className="px-4 py-4"><p className={`text-sm font-semibold ${lead.currentIssue.includes("overdue") ? "text-rose-600" : "text-slate-700"}`}>{lead.currentIssue}</p><p className="mt-0.5 text-xs text-slate-400">{humanize(lead.stage)}</p></td><td className="px-4 py-4 text-sm text-slate-600">{lead.owner?.fullName || "Unassigned"}</td><td className={`px-4 py-4 text-sm ${due.overdue ? "font-semibold text-rose-600" : "text-slate-600"}`}>{due.label}</td><td className="px-4 py-4"><p className="max-w-[220px] truncate text-sm text-slate-700">{lead.nextActionDescription || "Set the next action"}</p></td><td className="px-5 py-4 text-right"><button type="button" onClick={() => setSelectedLead(lead)} className="h-9 rounded-full bg-slate-900 px-4 text-xs font-semibold text-white hover:bg-slate-700">Open</button></td></tr>; })}</tbody></table></div>}
        </section>

        {operational ? <section className="overflow-hidden rounded-3xl border border-white/80 bg-white shadow-[0_18px_55px_rgba(28,45,74,0.08)]">
          <div className="border-b border-slate-200/70 px-5 py-4"><div className="flex items-start gap-3"><div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-amber-50 text-amber-700"><Activity className="h-4 w-4" /></div><div><h2 className="text-base font-semibold text-slate-950">Operational watchlist</h2><p className="mt-1 text-xs text-slate-500">Open leads that need attention beyond today’s scheduled queue. Inactive means no update for {operational.inactiveThresholdDays} days.</p></div></div>
            <div className="mt-4 flex gap-2 overflow-x-auto pb-1">
              {[
                ["ALL", "All issues", operational.watchlist.length],
                ["AWAITING_FIRST_CONTACT", "Awaiting contact", operational.counts.awaitingFirstContact],
                ["NEXT_ACTION_MISSING", "Missing action", operational.counts.withoutNextAction],
                ["INACTIVE", "Inactive", operational.counts.inactive],
                ["CONSULTATION_NO_SHOW", "No-shows", operational.counts.consultationNoShows],
                ["RETAINER_PENDING", "Retainer", operational.counts.retainerPending],
                ["PAYMENT_PENDING", "Payment", operational.counts.paymentPending],
              ].map(([id, label, count]) => <button key={id} type="button" onClick={() => setOperationalFilter(id)} className={`inline-flex h-9 shrink-0 items-center gap-2 rounded-full px-3.5 text-xs font-semibold transition ${operationalFilter === id ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}>{label}<span className={`rounded-full px-1.5 py-0.5 text-[10px] ${operationalFilter === id ? "bg-white/15 text-white" : "bg-white text-slate-500"}`}>{count}</span></button>)}
            </div>
          </div>
          {!watchlist.length ? <div className="px-6 py-12 text-center"><p className="text-sm font-semibold text-slate-800">No leads in this category</p><p className="mt-1 text-xs text-slate-500">Select another issue to review the operational queue.</p></div> : <div>{watchlist.map((lead, index) => <div key={lead.id} className={`flex flex-col gap-4 px-5 py-4 sm:flex-row sm:items-center ${index ? "border-t border-slate-100" : ""}`}><div className="min-w-0 sm:w-52"><p className="truncate text-sm font-semibold text-slate-900">{leadName(lead)}</p><p className="mt-0.5 text-xs text-slate-400">{lead.leadNumber} · {lead.originalSource?.name || "Unknown source"}</p></div><div className="flex min-w-0 flex-1 flex-wrap gap-1.5">{lead.issues.map((issue) => <span key={issue} className={`rounded-full px-2.5 py-1 text-[10px] font-semibold ${issue === "INACTIVE" || issue === "CONSULTATION_NO_SHOW" ? "bg-rose-50 text-rose-700" : "bg-amber-50 text-amber-700"}`}>{operationalLabels[issue]}</span>)}</div><div className="shrink-0 sm:w-40"><p className="text-xs text-slate-400">Owner</p><p className="mt-0.5 truncate text-sm text-slate-600">{lead.owner?.fullName || "Unassigned"}</p></div><button type="button" onClick={() => setSelectedLead(lead)} className="h-9 shrink-0 rounded-full border border-slate-200 px-4 text-xs font-semibold text-slate-700 hover:bg-slate-50">Review</button></div>)}</div>}
        </section> : null}
      </> : null}

      <LeadDashboardDrilldownDrawer
        metric={drilldown}
        items={drilldownItems}
        loading={drilldownLoading}
        error={drilldownError}
        onClose={closeDrilldown}
        onSelectLead={(lead) => { closeDrilldown(); setSelectedLead(lead); }}
      />

      {selectedLead ? <LeadDetailSheet lead={selectedLead} staff={staff} onClose={() => setSelectedLead(null)} onChanged={loadDashboard} /> : null}
    </section>
  );
}
