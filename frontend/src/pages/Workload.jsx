import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, ArrowRight, BriefcaseBusiness, FileClock, ListChecks, RefreshCw } from "lucide-react";
import { Link } from "react-router-dom";
import PageContainer from "../components/layout/PageContainer";
import api from "../services/api";

function formatDate(value) {
  if (!value) return "No due date";
  return new Intl.DateTimeFormat("en-CA", { month: "short", day: "numeric", year: "numeric" }).format(new Date(value));
}

function Metric({ label, value, tone = "slate" }) {
  const tones = {
    slate: "bg-slate-50 text-slate-900",
    sky: "bg-sky-50 text-sky-800",
    amber: "bg-amber-50 text-amber-800",
    rose: "bg-rose-50 text-rose-800",
    emerald: "bg-emerald-50 text-emerald-800",
  };
  return <div className={["rounded-3xl border border-white p-5 shadow-sm", tones[tone]].join(" ")}><p className="text-sm opacity-70">{label}</p><p className="mt-2 text-3xl font-semibold">{value}</p></div>;
}

function WorkSection({ icon: Icon, title, count, empty, children, tone = "sky" }) {
  const iconTone = tone === "rose" ? "bg-rose-50 text-rose-700" : tone === "amber" ? "bg-amber-50 text-amber-700" : "bg-sky-50 text-sky-700";
  return (
    <article className="rounded-3xl border border-slate-200/70 bg-white/80 p-5 shadow-sm">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3"><div className={["flex h-10 w-10 items-center justify-center rounded-2xl", iconTone].join(" ")}><Icon className="h-5 w-5" /></div><h2 className="font-semibold text-slate-950">{title}</h2></div>
        <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600">{count}</span>
      </div>
      <div className="space-y-2">{count ? children : <p className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-4 text-sm text-slate-500">{empty}</p>}</div>
    </article>
  );
}

function TaskRow({ item, overdue = false }) {
  return (
    <Link to={`/app/cases/${item.case.id}`} className="flex items-start justify-between gap-3 rounded-2xl border border-slate-100 p-3 transition hover:border-sky-200 hover:bg-sky-50/30">
      <div className="min-w-0"><p className="truncate text-sm font-semibold text-slate-900">{item.title}</p><p className="mt-0.5 truncate text-xs text-slate-500">{item.case.client.fullName} · {item.case.caseType}</p></div>
      <div className="shrink-0 text-right"><p className={overdue ? "text-xs font-semibold text-rose-700" : "text-xs font-medium text-slate-600"}>{formatDate(item.dueAt)}</p><p className="mt-0.5 text-[11px] text-slate-400">{item.priority}</p></div>
    </Link>
  );
}

export default function Workload() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const loadWorkload = useCallback(async () => {
    try {
      setLoading(true);
      const response = await api.get("/consultants/me/workload");
      setData(response.data.data);
      setError("");
    } catch (requestError) {
      setError(requestError.response?.data?.message || "Unable to load your workload.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadWorkload(); }, [loadWorkload]);

  return (
    <PageContainer
      title="My Workload"
      description="Your assigned cases, deadlines, and documents requiring review."
      actions={<button type="button" onClick={loadWorkload} disabled={loading} className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"><RefreshCw className={["h-4 w-4", loading ? "animate-spin" : ""].join(" ")} />Refresh</button>}
    >
      {error ? (
        <div className="flex items-center justify-between gap-4 rounded-3xl border border-rose-200 bg-rose-50 px-5 py-4 text-sm text-rose-700"><span className="flex items-center gap-2"><AlertTriangle className="h-4 w-4" />{error}</span><button type="button" onClick={loadWorkload} className="font-semibold underline">Try again</button></div>
      ) : null}

      {loading && !data ? <div className="rounded-3xl border border-slate-200 bg-white p-8 text-sm text-slate-500">Loading your assigned work…</div> : null}

      {data ? (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
            <Metric label="Active cases" value={data.activeCases} tone="sky" />
            <Metric label="Pending tasks" value={data.pendingTasks} />
            <Metric label="Overdue tasks" value={data.overdueTasks} tone={data.overdueTasks ? "rose" : "slate"} />
            <Metric label="Documents waiting" value={data.documentsWaitingReview} tone={data.documentsWaitingReview ? "amber" : "slate"} />
            <Metric label="Case capacity" value={data.capacity} />
            <Metric label="Capacity used" value={`${data.workloadPercentage}%`} tone={data.workloadPercentage >= 90 ? "rose" : data.workloadPercentage >= 70 ? "amber" : "emerald"} />
          </div>

          <div className="grid gap-4 xl:grid-cols-2">
            <WorkSection icon={AlertTriangle} title="Overdue Tasks" count={data.overdueTaskItems.length} empty="No overdue tasks." tone="rose">
              {data.overdueTaskItems.map((item) => <TaskRow key={item.id} item={item} overdue />)}
            </WorkSection>
            <WorkSection icon={ListChecks} title="Pending Tasks" count={data.pendingTaskItems.length} empty="No pending tasks assigned to you.">
              {data.pendingTaskItems.map((item) => <TaskRow key={item.id} item={item} />)}
            </WorkSection>
            <WorkSection icon={FileClock} title="Documents Waiting for Review" count={data.documentReviewItems.length} empty="No documents are waiting for your review." tone="amber">
              {data.documentReviewItems.map((item) => <Link key={item.id} to={`/app/cases/${item.case.id}`} className="flex items-center justify-between gap-3 rounded-2xl border border-slate-100 p-3 transition hover:border-amber-200 hover:bg-amber-50/30"><div className="min-w-0"><p className="truncate text-sm font-semibold text-slate-900">{item.documentName}</p><p className="truncate text-xs text-slate-500">{item.client.fullName} · {item.case.caseType}</p></div><ArrowRight className="h-4 w-4 shrink-0 text-slate-400" /></Link>)}
            </WorkSection>
            <WorkSection icon={BriefcaseBusiness} title="Assigned Cases" count={data.activeCaseItems.length} empty="No active cases are assigned to you.">
              {data.activeCaseItems.map((item) => <Link key={item.id} to={`/app/cases/${item.id}`} className="flex items-center justify-between gap-3 rounded-2xl border border-slate-100 p-3 transition hover:border-sky-200 hover:bg-sky-50/30"><div className="min-w-0"><p className="truncate text-sm font-semibold text-slate-900">{item.client.fullName}</p><p className="truncate text-xs text-slate-500">{item.caseType} · {item.stage}</p></div><ArrowRight className="h-4 w-4 shrink-0 text-slate-400" /></Link>)}
            </WorkSection>
          </div>
        </>
      ) : null}
    </PageContainer>
  );
}
