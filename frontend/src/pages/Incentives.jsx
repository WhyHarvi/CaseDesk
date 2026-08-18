import { ArrowLeft, Loader2, Sparkles, Users } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useAuth } from "../auth/AuthContext";
import PageContainer from "../components/layout/PageContainer";
import { getIncentiveLedger, getIncentivePipeline, getIncentiveSummary, getIncentiveTeamSummary } from "../api/incentivesApi";

const currency = new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD" });

function Metric({ label, value, tone = "slate" }) {
  const tones = {
    slate: "bg-slate-50 text-slate-900",
    emerald: "bg-emerald-50 text-emerald-800",
  };
  return (
    <div className={["rounded-3xl border border-white p-5 shadow-sm", tones[tone]].join(" ")}>
      <p className="text-sm opacity-70">{label}</p>
      <p className="mt-2 text-3xl font-semibold">{currency.format(value || 0)}</p>
    </div>
  );
}

function RoleBreakdown({ byRole }) {
  if (!byRole?.length) return null;
  return (
    <article className="rounded-3xl border border-slate-200/70 bg-white/80 p-5 shadow-sm">
      <h2 className="font-semibold text-slate-950">By role</h2>
      <div className="mt-4 space-y-2">
        {byRole.map((row) => (
          <div key={row.role} className="flex items-center justify-between rounded-2xl border border-slate-100 px-3.5 py-2.5">
            <span className="text-sm font-medium text-slate-700">{row.role}</span>
            <span className="text-sm font-semibold text-slate-900">{currency.format(row.total)}</span>
          </div>
        ))}
      </div>
    </article>
  );
}

// Deliberately placed below the earned totals, not the headline — this is
// an estimate from in-flight cases, not money already earned, so it should
// read as upside, not a promise.
function PipelineCard({ rows }) {
  return (
    <article className="rounded-3xl border border-amber-200/70 bg-amber-50/60 p-5 shadow-sm">
      <div className="flex items-center gap-2.5">
        <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-amber-100 text-amber-700"><Sparkles className="h-4 w-4" /></span>
        <div>
          <h2 className="font-semibold text-slate-950">Potential — not guaranteed</h2>
          <p className="text-xs text-slate-500">What you'd earn if these in-flight cases got fully paid right now.</p>
        </div>
      </div>
      <div className="mt-4 space-y-2">
        {rows?.length ? rows.map((row) => (
          <div key={row.caseId} className="flex items-center justify-between gap-3 rounded-2xl border border-white bg-white/70 px-3.5 py-2.5">
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-slate-900">{row.client?.fullName}</p>
              <p className="truncate text-xs text-slate-500">{row.caseType} · {row.stage} · {currency.format(row.outstandingBalance)} outstanding</p>
            </div>
            <span className="shrink-0 text-sm font-semibold text-amber-700">+{currency.format(row.estimatedAmount)}</span>
          </div>
        )) : <p className="rounded-2xl border border-dashed border-amber-200 bg-white/50 p-4 text-sm text-slate-500">No in-flight cases with a projected payout right now.</p>}
      </div>
    </article>
  );
}

function LedgerTable({ rows, showPerson = false }) {
  return (
    <article className="rounded-3xl border border-slate-200/70 bg-white/80 p-5 shadow-sm">
      <h2 className="font-semibold text-slate-950">Recent activity</h2>
      <div className="mt-4 space-y-2">
        {rows?.length ? rows.map((row) => (
          <div key={row.id} className="flex items-center justify-between gap-3 rounded-2xl border border-slate-100 px-3.5 py-2.5">
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-slate-900">{row.case?.client?.fullName} · {row.case?.caseType}</p>
              <p className="truncate text-xs text-slate-500">
                {showPerson ? `${row.user?.fullName} · ` : ""}{row.roleNameSnapshot} · {row.incentivePlan?.name} · {new Intl.DateTimeFormat("en-CA", { dateStyle: "medium" }).format(new Date(row.creditedAt))}
              </p>
            </div>
            <span className="shrink-0 text-sm font-semibold text-emerald-700">+{currency.format(row.creditedAmount)}</span>
          </div>
        )) : <p className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-4 text-sm text-slate-500">Nothing credited yet.</p>}
      </div>
    </article>
  );
}

function PersonView({ userId, fullName, onBack }) {
  const [summary, setSummary] = useState(null);
  const [pipeline, setPipeline] = useState(null);
  const [ledger, setLedger] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    setLoading(true);
    Promise.all([
      getIncentiveSummary({ userId }),
      getIncentivePipeline({ userId }),
      getIncentiveLedger({ userId, pageSize: 20 }),
    ])
      .then(([summaryData, pipelineData, ledgerData]) => {
        if (!active) return;
        setSummary(summaryData);
        setPipeline(pipelineData);
        setLedger(ledgerData.data);
        setError("");
      })
      .catch((reason) => active && setError(reason.response?.data?.message || "Incentives could not be loaded."))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [userId]);

  return (
    <div className="space-y-4">
      {onBack ? (
        <button type="button" onClick={onBack} className="inline-flex items-center gap-1.5 text-sm font-semibold text-slate-600 hover:text-slate-900">
          <ArrowLeft className="h-4 w-4" /> Back to team
        </button>
      ) : null}
      {fullName ? <h2 className="text-lg font-semibold text-slate-950">{fullName}</h2> : null}
      {error ? <p className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</p> : null}
      {loading ? (
        <div className="flex min-h-40 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-slate-400" /></div>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            <Metric label="Earned this month" value={summary?.monthTotal} tone="emerald" />
            <Metric label="Earned lifetime" value={summary?.lifetimeTotal} />
          </div>
          <RoleBreakdown byRole={summary?.byRole} />
          <PipelineCard rows={pipeline} />
          <LedgerTable rows={ledger} />
        </>
      )}
    </div>
  );
}

function TeamTable({ rows, onSelect }) {
  return (
    <article className="rounded-3xl border border-slate-200/70 bg-white/80 p-5 shadow-sm">
      <div className="flex items-center gap-2.5">
        <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-sky-50 text-sky-700"><Users className="h-4 w-4" /></span>
        <h2 className="font-semibold text-slate-950">Everyone</h2>
      </div>
      <div className="mt-4 space-y-2">
        {rows?.length ? rows.map((row) => (
          <button key={row.userId} type="button" onClick={() => onSelect(row)} className="flex w-full items-center justify-between gap-3 rounded-2xl border border-slate-100 px-3.5 py-2.5 text-left transition hover:border-sky-200 hover:bg-sky-50/30">
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-slate-900">{row.fullName}</p>
              <p className="truncate text-xs capitalize text-slate-500">{row.role}</p>
            </div>
            <div className="shrink-0 text-right">
              <p className="text-sm font-semibold text-emerald-700">{currency.format(row.monthTotal)} <span className="text-xs font-normal text-slate-400">this month</span></p>
              <p className="text-xs text-slate-500">{currency.format(row.lifetimeTotal)} lifetime</p>
            </div>
          </button>
        )) : <p className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-4 text-sm text-slate-500">No incentive activity yet.</p>}
      </div>
    </article>
  );
}

export default function Incentives() {
  const { role, appUser } = useAuth();
  const isAdmin = role === "admin";
  const [selected, setSelected] = useState(null); // {userId, fullName} — admin drill-down
  const [team, setTeam] = useState(null);
  const [teamError, setTeamError] = useState("");

  const loadTeam = useCallback(() => {
    if (!isAdmin) return;
    getIncentiveTeamSummary()
      .then(setTeam)
      .catch((reason) => setTeamError(reason.response?.data?.message || "Team incentives could not be loaded."));
  }, [isAdmin]);

  useEffect(() => { loadTeam(); }, [loadTeam]);

  return (
    <PageContainer
      title="Incentives"
      description={isAdmin ? "See what everyone is earning, and what's still in the pipeline." : "See what you've earned, and what's still in the pipeline."}
    >
      {isAdmin ? (
        selected ? (
          <PersonView userId={selected.userId} fullName={selected.fullName} onBack={() => setSelected(null)} />
        ) : (
          <div className="space-y-4">
            {teamError ? <p className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{teamError}</p> : null}
            {team ? (
              <div className="grid gap-4 sm:grid-cols-2">
                <Metric label="Team earned this month" value={team.reduce((sum, row) => sum + row.monthTotal, 0)} tone="emerald" />
                <Metric label="Team earned lifetime" value={team.reduce((sum, row) => sum + row.lifetimeTotal, 0)} />
              </div>
            ) : (
              <div className="flex min-h-40 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-slate-400" /></div>
            )}
            <TeamTable rows={team} onSelect={(row) => setSelected({ userId: row.userId, fullName: row.fullName })} />
          </div>
        )
      ) : (
        <PersonView userId={appUser?.id} />
      )}
    </PageContainer>
  );
}
