import { AnimatePresence, motion, useMotionValue, useSpring, useTransform } from "framer-motion";
import { ArrowLeft, Award, HandCoins, Search, Sparkles, TrendingUp, Users, Wallet } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "../auth/AuthContext";
import { getIncentiveLedger, getIncentivePipeline, getIncentiveSummary, getIncentiveTeamSummary } from "../api/incentivesApi";

const money = new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD", minimumFractionDigits: 2 });
const moneyWhole = new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD", maximumFractionDigits: 0 });

function cx(...classes) {
  return classes.filter(Boolean).join(" ");
}

// Same glass/spring language as the Payments page — Incentives is a sibling
// money surface, not a separate visual world.
const glass = "rounded-[1.6rem] border border-white/70 bg-white/70 shadow-[0_18px_50px_rgba(15,23,42,0.08)] backdrop-blur-2xl";
const spring = { type: "spring", stiffness: 320, damping: 30 };

/** Animated number that springs from its previous value to the next one. */
function CountUp({ value, format = (v) => moneyWhole.format(v) }) {
  const raw = useMotionValue(0);
  const sprung = useSpring(raw, { stiffness: 90, damping: 24 });
  const text = useTransform(sprung, (latest) => format(latest));
  useEffect(() => { raw.set(value); }, [value, raw]);
  return <motion.span>{text}</motion.span>;
}

function KpiCard({ label, value, format, icon: Icon, tint, delay = 0, footnote }) {
  return (
    <motion.article
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ ...spring, delay }}
      whileHover={{ y: -3, boxShadow: "0 26px 60px rgba(15,23,42,0.12)" }}
      className={cx(glass, "min-w-0 cursor-default p-5")}
    >
      <div className="flex min-w-0 items-center gap-4">
        <motion.div whileHover={{ scale: 1.08, rotate: -4 }} transition={spring} className={cx("flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl ring-1", tint)}>
          <Icon className="h-5 w-5" />
        </motion.div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[12px] font-semibold text-slate-500">{label}</p>
          <p className="mt-1 truncate text-[22px] font-semibold tracking-[-0.03em] text-slate-950 tabular-nums">
            <CountUp value={value} format={format} />
          </p>
          {footnote ? <p className="mt-0.5 truncate text-[11px] font-medium text-slate-400">{footnote}</p> : null}
        </div>
      </div>
    </motion.article>
  );
}

function ChartCard({ title, subtitle, children, className, delay = 0, action }) {
  return (
    <motion.section
      initial={{ opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ ...spring, delay }}
      className={cx(glass, "min-w-0 p-5", className)}
    >
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-[15px] font-semibold tracking-[-0.015em] text-slate-950">{title}</h2>
          {subtitle ? <p className="mt-0.5 text-[12px] text-slate-400">{subtitle}</p> : null}
        </div>
        {action}
      </div>
      {children}
    </motion.section>
  );
}

function EmptyRow({ children }) {
  return <p className="rounded-2xl border border-dashed border-slate-200 bg-slate-50/70 p-4 text-sm text-slate-500">{children}</p>;
}

function RoleBreakdown({ byRole, delay = 0 }) {
  if (!byRole?.length) return null;
  return (
    <ChartCard title="By role" subtitle="How your credit splits across your attribution points" delay={delay}>
      <div className="space-y-2">
        {byRole.map((row) => (
          <div key={row.role} className="flex items-center justify-between rounded-2xl border border-slate-100 bg-white/60 px-3.5 py-2.5">
            <span className="text-sm font-medium text-slate-700">{row.role}</span>
            <span className="text-sm font-semibold text-slate-900 tabular-nums">{money.format(row.total)}</span>
          </div>
        ))}
      </div>
    </ChartCard>
  );
}

// A read-only estimate, never money already earned — kept visually distinct
// (amber, not emerald) and placed below the earned totals so it reads as
// upside, not a promise.
function PipelineCard({ rows, delay = 0 }) {
  return (
    <motion.section
      initial={{ opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ ...spring, delay }}
      className="min-w-0 rounded-[1.6rem] border border-amber-200/80 bg-amber-50/80 p-5 shadow-[0_18px_50px_rgba(245,158,11,0.10)] backdrop-blur-2xl"
    >
      <div className="flex items-center gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-amber-100 text-amber-600 ring-1 ring-amber-200"><Sparkles className="h-5 w-5" /></span>
        <div className="min-w-0">
          <h2 className="text-[15px] font-semibold tracking-[-0.015em] text-slate-950">Potential — not guaranteed</h2>
          <p className="text-[12px] text-slate-500">What you'd earn if these in-flight cases got fully paid right now.</p>
        </div>
      </div>
      <div className="mt-4 space-y-2">
        {rows?.length ? rows.map((row, index) => (
          <motion.div
            key={row.caseId}
            initial={{ opacity: 0, x: -8 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ ...spring, delay: delay + 0.04 * index }}
            className="flex items-center justify-between gap-3 rounded-2xl border border-white bg-white/80 px-3.5 py-2.5"
          >
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-slate-900">{row.client?.fullName}</p>
              <p className="truncate text-xs text-slate-500">{row.caseType} · {row.stage} · {money.format(row.outstandingBalance)} outstanding</p>
            </div>
            <span className="shrink-0 text-sm font-semibold text-amber-700 tabular-nums">+{money.format(row.estimatedAmount)}</span>
          </motion.div>
        )) : <EmptyRow>No in-flight cases with a projected payout right now.</EmptyRow>}
      </div>
    </motion.section>
  );
}

function LedgerTable({ rows, showPerson = false, delay = 0 }) {
  return (
    <ChartCard title="Recent activity" subtitle="Every payment that credited you, most recent first" delay={delay}>
      <div className="space-y-2">
        {rows?.length ? rows.map((row) => (
          <div key={row.id} className="flex items-center justify-between gap-3 rounded-2xl border border-slate-100 bg-white/60 px-3.5 py-2.5">
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-slate-900">{row.case?.client?.fullName} · {row.case?.caseType}</p>
              <p className="truncate text-xs text-slate-500">
                {showPerson ? `${row.user?.fullName} · ` : ""}{row.roleNameSnapshot} · {row.incentivePlan?.name} · {new Intl.DateTimeFormat("en-CA", { dateStyle: "medium" }).format(new Date(row.creditedAt))}
              </p>
            </div>
            <span className="shrink-0 text-sm font-semibold text-emerald-600 tabular-nums">+{money.format(row.creditedAmount)}</span>
          </div>
        )) : <EmptyRow>Nothing credited yet — earnings appear here the moment a payment comes in.</EmptyRow>}
      </div>
    </ChartCard>
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

  if (error) return <p className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</p>;

  if (loading) {
    return (
      <div className="grid gap-4">
        <div className="grid gap-4 sm:grid-cols-2">
          {[0, 1].map((i) => <div key={i} className={cx(glass, "h-24 animate-pulse")} />)}
        </div>
        <div className={cx(glass, "h-40 animate-pulse")} />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      {onBack ? (
        <div className="flex items-center gap-3">
          <button type="button" onClick={onBack} className="inline-flex h-9 items-center gap-1.5 rounded-full border border-slate-200 bg-white/80 px-3.5 text-sm font-semibold text-slate-600 shadow-sm transition hover:border-slate-300 hover:text-slate-900">
            <ArrowLeft className="h-4 w-4" /> Back to team
          </button>
          {fullName ? <h2 className="text-lg font-semibold tracking-tight text-slate-950">{fullName}</h2> : null}
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <KpiCard label="Earned this month" value={summary?.monthTotal ?? 0} icon={TrendingUp} tint="bg-emerald-50 text-emerald-500 ring-emerald-100" delay={0.05} />
        <KpiCard label="Earned lifetime" value={summary?.lifetimeTotal ?? 0} icon={Wallet} tint="bg-sky-50 text-sky-500 ring-sky-100" delay={0.1} />
      </div>

      <RoleBreakdown byRole={summary?.byRole} delay={0.12} />
      <PipelineCard rows={pipeline} delay={0.16} />
      <LedgerTable rows={ledger} delay={0.2} />
    </div>
  );
}

function TeamTable({ rows, onSelect, delay = 0 }) {
  const [query, setQuery] = useState("");
  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return (rows || []).filter((row) => !needle || row.fullName.toLowerCase().includes(needle));
  }, [rows, query]);

  return (
    <ChartCard
      title="Everyone"
      subtitle="Click a person to see their breakdown"
      delay={delay}
      action={
        <label className="relative hidden w-56 sm:block">
          <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search staff" className="h-9 w-full rounded-full border border-slate-200 bg-white/80 pl-9 pr-3 text-sm outline-none transition focus:border-sky-300 focus:ring-4 focus:ring-sky-100" />
        </label>
      }
    >
      <div className="space-y-2">
        {visible.length ? visible.map((row) => (
          <button
            key={row.userId}
            type="button"
            onClick={() => onSelect(row)}
            className="flex w-full items-center justify-between gap-3 rounded-2xl border border-slate-100 bg-white/60 px-3.5 py-2.5 text-left transition hover:border-sky-200 hover:bg-sky-50/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300"
          >
            <div className="flex min-w-0 items-center gap-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-100 text-xs font-bold text-slate-500">{row.fullName.slice(0, 1).toUpperCase()}</span>
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-slate-900">{row.fullName}</p>
                <p className="truncate text-xs capitalize text-slate-500">{row.role}</p>
              </div>
            </div>
            <div className="shrink-0 text-right">
              <p className="text-sm font-semibold text-emerald-600 tabular-nums">{money.format(row.monthTotal)} <span className="text-xs font-normal text-slate-400">this month</span></p>
              <p className="text-xs text-slate-500 tabular-nums">{money.format(row.lifetimeTotal)} lifetime</p>
            </div>
          </button>
        )) : <EmptyRow>{query ? "No one matches this search." : "No incentive activity yet."}</EmptyRow>}
      </div>
    </ChartCard>
  );
}

function AdminOverview({ team, error, onSelect }) {
  const topEarner = useMemo(() => (team?.length ? [...team].sort((a, b) => b.monthTotal - a.monthTotal)[0] : null), [team]);
  const activeEarners = useMemo(() => team?.filter((row) => row.lifetimeTotal > 0).length ?? 0, [team]);

  if (error) return <p className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</p>;

  if (!team) {
    return (
      <div className="grid gap-4">
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {[0, 1, 2, 3].map((i) => <div key={i} className={cx(glass, "h-24 animate-pulse")} />)}
        </div>
        <div className={cx(glass, "h-40 animate-pulse")} />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Team earned this month" value={team.reduce((sum, row) => sum + row.monthTotal, 0)} icon={TrendingUp} tint="bg-emerald-50 text-emerald-500 ring-emerald-100" delay={0.05} />
        <KpiCard label="Team earned lifetime" value={team.reduce((sum, row) => sum + row.lifetimeTotal, 0)} icon={Wallet} tint="bg-sky-50 text-sky-500 ring-sky-100" delay={0.1} />
        <KpiCard label="People earning" value={activeEarners} format={(v) => String(Math.round(v))} icon={Users} tint="bg-violet-50 text-violet-500 ring-violet-100" delay={0.15} />
        <KpiCard label="Top earner this month" value={topEarner?.monthTotal ?? 0} footnote={topEarner?.fullName} icon={Award} tint="bg-amber-50 text-amber-500 ring-amber-100" delay={0.2} />
      </div>
      <TeamTable rows={team} onSelect={onSelect} delay={0.15} />
    </div>
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
    <main className="min-w-0 bg-[radial-gradient(circle_at_12%_-4%,rgba(16,185,129,0.08),transparent_36%),radial-gradient(circle_at_92%_16%,rgba(56,130,246,0.08),transparent_38%)] px-3 py-4 sm:px-5 lg:px-6">
      <div className="mx-auto flex w-full max-w-[1680px] min-w-0 flex-col gap-5">
        <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={spring} className={cx(glass, "overflow-hidden p-5 sm:p-7 lg:p-8")}>
          <div className="flex items-center gap-3">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-600 ring-1 ring-emerald-100"><HandCoins className="h-5 w-5" /></span>
            <div>
              <h1 className="text-3xl font-semibold tracking-tight text-slate-950 sm:text-4xl">Incentives</h1>
              <p className="mt-1 max-w-2xl text-sm text-slate-500 sm:text-base">
                {isAdmin ? "See what everyone is earning, and what's still in the pipeline." : "What you've earned, and what's still coming."}
              </p>
            </div>
          </div>
        </motion.div>

        <AnimatePresence mode="wait">
          {isAdmin ? (
            selected ? (
              <motion.div key="person" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }}>
                <PersonView userId={selected.userId} fullName={selected.fullName} onBack={() => setSelected(null)} />
              </motion.div>
            ) : (
              <motion.div key="team" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }}>
                <AdminOverview team={team} error={teamError} onSelect={(row) => setSelected({ userId: row.userId, fullName: row.fullName })} />
              </motion.div>
            )
          ) : (
            <PersonView userId={appUser?.id} />
          )}
        </AnimatePresence>
      </div>
    </main>
  );
}
