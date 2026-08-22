import { AnimatePresence, motion, useMotionValue, useSpring, useTransform } from "framer-motion";
import { ArrowLeft, Award, HandCoins, Search, Settings2, Sparkles, TrendingUp, Users, Wallet } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { getActiveTimelines, getIncentiveLedger, getIncentivePipeline, getIncentiveSummary, getIncentiveTeamSummary } from "../api/incentivesApi";
import TimelineProgressStrip from "../components/incentives/TimelineProgressStrip";
import { computeLegProgress } from "../components/incentives/timelineProgressUtils";
import InfoDrawer from "../components/ui/InfoDrawer";
import useNow from "../hooks/useNow";

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
function PipelineCard({ rows, onSelectCase, delay = 0 }) {
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
          <p className="text-[12px] text-slate-500">What you'd earn if these in-flight cases got fully paid right now. Click a case to see how.</p>
        </div>
      </div>
      <div className="mt-4 space-y-2">
        {rows?.length ? rows.map((row, index) => (
          <motion.button
            key={row.caseId}
            type="button"
            onClick={() => onSelectCase?.(row.caseId)}
            initial={{ opacity: 0, x: -8 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ ...spring, delay: delay + 0.04 * index }}
            className="flex w-full items-center justify-between gap-3 rounded-2xl border border-white bg-white/80 px-3.5 py-2.5 text-left transition hover:border-amber-200 hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300"
          >
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-slate-900">{row.client?.fullName}</p>
              <p className="truncate text-xs text-slate-500">{row.caseType} · {row.stage} · {money.format(row.outstandingBalance)} outstanding</p>
            </div>
            <span className="shrink-0 text-sm font-semibold text-amber-700 tabular-nums">+{money.format(row.estimatedAmount)}</span>
          </motion.button>
        )) : <EmptyRow>No in-flight cases with a projected payout right now.</EmptyRow>}
      </div>
    </motion.section>
  );
}

// The forward-looking counterpart to PipelineCard, for timeline bonuses
// specifically — "here's what's still in motion, and how much time is
// left to lock in the best tier." Same amber "not guaranteed" framing.
function ActiveTimelinesCard({ rows, onSelectCase, delay = 0 }) {
  const now = useNow();
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
          <h2 className="text-[15px] font-semibold tracking-[-0.015em] text-slate-950">Active timelines</h2>
          <p className="text-[12px] text-slate-500">Milestone bonuses still in motion — keep them moving before a tier drops. Click a case to see how.</p>
        </div>
      </div>
      <div className="mt-4 space-y-3">
        {rows?.length ? rows.map((row, index) => (
          <motion.button
            key={row.caseId}
            type="button"
            onClick={() => onSelectCase?.(row.caseId)}
            initial={{ opacity: 0, x: -8 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ ...spring, delay: delay + 0.04 * index }}
            className="block w-full rounded-2xl border border-white bg-white/80 px-3.5 py-3 text-left transition hover:border-amber-200 hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300"
          >
            <p className="truncate text-sm font-semibold text-slate-900">{row.client?.fullName}</p>
            <p className="truncate text-xs text-slate-500">{row.caseType} · {row.stage}</p>
            <div className="mt-2">
              <TimelineProgressStrip legs={row.legs} now={now} />
            </div>
          </motion.button>
        )) : <EmptyRow>No active timeline bonuses right now.</EmptyRow>}
      </div>
    </motion.section>
  );
}

function LedgerTable({ rows, showPerson = false, approvalStatus, onApprovalStatusChange, delay = 0 }) {
  return (
    <ChartCard
      title="Recent activity"
      subtitle="Every payment that credited you, most recent first"
      delay={delay}
      action={(
        <label className="flex items-center gap-2 text-xs font-semibold text-slate-500">
          <span className="hidden sm:inline">Approval</span>
          <select value={approvalStatus} onChange={(event) => onApprovalStatusChange?.(event.target.value)} className="h-9 rounded-full border border-slate-200 bg-white/80 px-3 text-xs font-semibold text-slate-700 outline-none transition focus:border-sky-300 focus:ring-4 focus:ring-sky-100">
            <option value="ALL">All statuses</option>
            <option value="APPROVED">Approved</option>
            <option value="RECALCULATED">Recalculated</option>
            <option value="AUTOMATIC">Automatic</option>
            <option value="REVERSED">Reversed</option>
          </select>
        </label>
      )}
    >
      <div className="space-y-2">
        {rows?.length ? rows.map((row) => {
          const date = new Intl.DateTimeFormat("en-CA", { dateStyle: "medium" }).format(new Date(row.creditedAt));
          const isTimelineBonus = row.entryType === "TIMELINE_BONUS";
          const context = isTimelineBonus
            ? `${row.timelineLegEvaluation?.legNameSnapshot || "Timeline"} milestone${row.timelineLegEvaluation?.multiplierPercent != null ? ` · ${Number(row.timelineLegEvaluation.multiplierPercent)}%` : ""}`
            : `${row.incentivePlan?.name}${row.entryType === "REVERSAL" ? " · Refund adjustment" : ""}`;
          return (
            <div key={row.id} className="flex items-center justify-between gap-3 rounded-2xl border border-slate-100 bg-white/60 px-3.5 py-2.5">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-slate-900">{row.case?.client?.fullName} · {row.case?.caseType}</p>
                <p className="truncate text-xs text-slate-500">
                  {showPerson ? `${row.user?.fullName} · ` : ""}{row.roleNameSnapshot} · {context} · {row.approvalStatus || "AUTOMATIC"} · {date}
                </p>
              </div>
              <span className={`shrink-0 text-sm font-semibold tabular-nums ${Number(row.creditedAmount) < 0 ? "text-rose-600" : "text-emerald-600"}`}>
                {Number(row.creditedAmount) > 0 ? "+" : ""}{money.format(row.creditedAmount)}
              </span>
            </div>
          );
        }) : <EmptyRow>Nothing credited yet — earnings appear here the moment a payment comes in.</EmptyRow>}
      </div>
    </ChartCard>
  );
}

function formulaLabel(invoice) {
  if (invoice.formulaType === "FLAT_PER_PAYMENT") return `Flat ${money.format(invoice.flatAmount ?? 0)} per payment`;
  if (invoice.formulaType === "PERCENT_OF_PAYMENT") return `${invoice.percentRate ?? 0}% of payment`;
  if (invoice.formulaType === "TIERED_PERCENT_OF_REVENUE") {
    return invoice.matchedRate != null ? `Tiered by revenue — currently ${invoice.matchedRate}%` : "Tiered by revenue";
  }
  return invoice.planName || "Plan";
}

/** Opened by clicking a case in PipelineCard or ActiveTimelinesCard — explains exactly how that case's
 * potential amount is computed, using only data already loaded by PersonView (no extra fetch). */
function CaseIncentiveBreakdownDrawer({ caseId, pipeline, activeTimelines, onClose }) {
  const now = useNow();
  const pipelineRow = pipeline?.find((row) => row.caseId === caseId);
  const timelineRow = activeTimelines?.find((row) => row.caseId === caseId);
  if (!pipelineRow && !timelineRow) return null;
  const client = pipelineRow?.client || timelineRow?.client;
  const caseType = pipelineRow?.caseType || timelineRow?.caseType;

  return (
    <InfoDrawer eyebrow="Incentive breakdown" title={client?.fullName || "Case"} onClose={onClose}>
      <p className="text-xs font-medium text-slate-400">{caseType}</p>

      {pipelineRow ? (
        <section>
          <h3 className="text-[13px] font-semibold text-slate-800">From outstanding payments</h3>
          <div className="mt-2 space-y-2">
            {pipelineRow.invoices.map((invoice) => (
              <div key={invoice.caseInvoiceId} className="rounded-2xl border border-slate-100 bg-white/60 p-3.5">
                <p className="text-xs font-semibold text-slate-700">{invoice.invoiceNumber || "Invoice"}{invoice.description ? ` · ${invoice.description}` : ""}</p>
                <p className="mt-1 text-xs text-slate-500">{formulaLabel(invoice)} · {invoice.planName}</p>
                <div className="mt-2 space-y-1">
                  {invoice.myShares.map((share, index) => (
                    <div key={index} className="flex items-center justify-between text-xs">
                      <span className="text-slate-600">{share.roleNameSnapshot} · {share.sharePercentApplied}% share</span>
                      <span className="font-semibold text-amber-700 tabular-nums">{money.format(share.amount)}</span>
                    </div>
                  ))}
                </div>
                <div className="mt-2 flex items-center justify-between border-t border-slate-100 pt-2 text-xs">
                  <span className="text-slate-500">Outstanding balance</span>
                  <span className="font-medium text-slate-700 tabular-nums">{money.format(invoice.outstandingBalance)}</span>
                </div>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {timelineRow ? (
        <section>
          <h3 className="text-[13px] font-semibold text-slate-800">From timeline bonuses</h3>
          <div className="mt-2 space-y-2">
            {timelineRow.legs.map((leg) => {
              const progress = leg.state === "IN_PROGRESS"
                ? computeLegProgress({ fromCheckpointAt: new Date(leg.fromCheckpointAt), tiers: leg.tiers, now })
                : null;
              return (
                <div key={leg.legId} className="rounded-2xl border border-slate-100 bg-white/60 p-3.5">
                  <p className="text-xs font-semibold text-slate-700">{leg.name}</p>
                  {progress?.state === "IN_PROGRESS" && leg.potentialAmount ? (
                    <>
                      <p className="mt-1 text-xs text-slate-500">
                        {leg.myRoleName} · {leg.mySharePercent}% share of the {leg.currentMultiplierPercent}% tier
                      </p>
                      <div className="mt-2 flex items-center justify-between text-xs">
                        <span className="text-slate-500">{Math.floor(progress.elapsedDays)} day(s) in · tier holds until {progress.deadlineAt.toLocaleDateString()}</span>
                        <span className="font-semibold text-amber-700 tabular-nums">{money.format(leg.potentialAmount)}</span>
                      </div>
                    </>
                  ) : (
                    <p className="mt-1 text-xs text-slate-500">Not yet earning a tier — nothing credits here right now.</p>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      ) : null}
    </InfoDrawer>
  );
}

function PersonView({ userId, fullName, onBack }) {
  const [summary, setSummary] = useState(null);
  const [pipeline, setPipeline] = useState(null);
  const [activeTimelines, setActiveTimelines] = useState(null);
  const [ledger, setLedger] = useState(null);
  const [approvalStatus, setApprovalStatus] = useState("ALL");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [openCaseId, setOpenCaseId] = useState(null);

  const totalPotential = useMemo(() => {
    const fromPipeline = (pipeline || []).reduce((sum, row) => sum + row.estimatedAmount, 0);
    const fromTimelines = (activeTimelines || []).reduce(
      (sum, row) => sum + row.legs.filter((leg) => leg.state === "IN_PROGRESS" && leg.potentialAmount).reduce((legSum, leg) => legSum + leg.potentialAmount, 0),
      0,
    );
    return { total: fromPipeline + fromTimelines, fromPipeline, fromTimelines };
  }, [pipeline, activeTimelines]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    Promise.all([
      getIncentiveSummary({ userId }),
      getIncentivePipeline({ userId }),
      getActiveTimelines({ userId }),
      getIncentiveLedger({ userId, pageSize: 20, approvalStatus }),
    ])
      .then(([summaryData, pipelineData, activeTimelinesData, ledgerData]) => {
        if (!active) return;
        setSummary(summaryData);
        setPipeline(pipelineData);
        setActiveTimelines(activeTimelinesData);
        setLedger(ledgerData.data);
        setError("");
      })
      .catch((reason) => active && setError(reason.response?.data?.message || "Incentives could not be loaded."))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [userId, approvalStatus]);

  if (error) return <p className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</p>;

  if (loading) {
    return (
      <div className="grid gap-4">
        <div className="grid gap-4 sm:grid-cols-3">
          {[0, 1, 2].map((i) => <div key={i} className={cx(glass, "h-24 animate-pulse")} />)}
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

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <KpiCard label="Earned this month" value={summary?.monthTotal ?? 0} icon={TrendingUp} tint="bg-emerald-50 text-emerald-500 ring-emerald-100" delay={0.05} />
        <KpiCard label="Earned lifetime" value={summary?.lifetimeTotal ?? 0} icon={Wallet} tint="bg-sky-50 text-sky-500 ring-sky-100" delay={0.1} />
        <KpiCard
          label="Potential right now"
          value={totalPotential.total}
          icon={Sparkles}
          tint="bg-amber-50 text-amber-500 ring-amber-100"
          delay={0.15}
          footnote={`${money.format(totalPotential.fromPipeline)} pipeline + ${money.format(totalPotential.fromTimelines)} timelines`}
        />
      </div>

      <RoleBreakdown byRole={summary?.byRole} delay={0.12} />
      <PipelineCard rows={pipeline} onSelectCase={setOpenCaseId} delay={0.16} />
      <ActiveTimelinesCard rows={activeTimelines} onSelectCase={setOpenCaseId} delay={0.18} />
      <LedgerTable rows={ledger} approvalStatus={approvalStatus} onApprovalStatusChange={setApprovalStatus} delay={0.2} />

      <AnimatePresence>
        {openCaseId ? (
          <CaseIncentiveBreakdownDrawer caseId={openCaseId} pipeline={pipeline} activeTimelines={activeTimelines} onClose={() => setOpenCaseId(null)} />
        ) : null}
      </AnimatePresence>
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
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-600 ring-1 ring-emerald-100"><HandCoins className="h-5 w-5" /></span>
              <div className="min-w-0">
                <h1 className="text-3xl font-semibold tracking-tight text-slate-950 sm:text-4xl">Incentives</h1>
                <p className="mt-1 max-w-2xl text-sm text-slate-500 sm:text-base">
                  {isAdmin ? "See what everyone is earning, and what's still in the pipeline." : "What you've earned, and what's still coming."}
                </p>
              </div>
            </div>
            {isAdmin ? (
              <Link to="/app/settings?section=incentive-plans" className="inline-flex h-10 shrink-0 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3.5 text-sm font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-500">
                <Settings2 className="h-4 w-4" /> Incentive plans
              </Link>
            ) : null}
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
