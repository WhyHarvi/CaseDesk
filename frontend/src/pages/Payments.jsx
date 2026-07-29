import { AnimatePresence, motion, useMotionValue, useSpring, useTransform } from "framer-motion";
import {
  Banknote,
  CalendarClock,
  ExternalLink,
  HandCoins,
  Landmark,
  Loader2,
  Search,
  ShieldAlert,
  TrendingUp,
  Wallet,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { getPaymentsOverview, getPaymentsOverviewSummary } from "../api/paymentsOverviewApi";

const money = new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD", minimumFractionDigits: 2 });
const moneyWhole = new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD", maximumFractionDigits: 0 });

function compactMoney(value) {
  if (Math.abs(value) >= 1000) return `$${(value / 1000).toFixed(value % 1000 === 0 ? 0 : 1)}K`;
  return `$${Math.round(value)}`;
}

const glass = "rounded-[1.6rem] border border-white/70 bg-white/70 shadow-[0_18px_50px_rgba(15,23,42,0.08)] backdrop-blur-2xl";
const spring = { type: "spring", stiffness: 320, damping: 30 };

function cx(...classes) {
  return classes.filter(Boolean).join(" ");
}

const STATUS_LABEL = { Open: "Open", PartiallyPaid: "Partially paid", Paid: "Paid", Refunded: "Refunded", Overdue: "Overdue", Voided: "Voided" };
const STATUS_TONE = {
  Open: "bg-slate-100 text-slate-600 ring-slate-200",
  PartiallyPaid: "bg-amber-50 text-amber-600 ring-amber-100",
  Paid: "bg-emerald-50 text-emerald-600 ring-emerald-100",
  Refunded: "bg-violet-50 text-violet-600 ring-violet-100",
  Overdue: "bg-rose-50 text-rose-600 ring-rose-100",
  Voided: "bg-slate-100 text-slate-400 ring-slate-200",
};
const STATUS_COLOR = { Paid: "#10B981", Refunded: "#8B5CF6", PartiallyPaid: "#F59E0B", Open: "#94A3B8", Overdue: "#F43F5E", Voided: "#CBD5E1" };
const SOURCE_LABEL = { case_invoice: "Case invoices", booking_payment: "Consultation bookings", legacy_payment: "Legacy retainers" };
const SOURCE_ROW_LABEL = { case_invoice: "Case invoice", booking_payment: "Consultation booking", legacy_payment: "Legacy retainer" };
const SOURCE_ICON = { case_invoice: Banknote, booking_payment: CalendarClock, legacy_payment: Landmark };
const SOURCE_COLOR = { case_invoice: "#0EA5E9", booking_payment: "#8B5CF6", legacy_payment: "#64748B" };

function formatDate(value) {
  if (!value) return "—";
  return new Date(value).toLocaleDateString("en-CA", { month: "short", day: "numeric", year: "numeric" });
}

function paymentBalanceLabel(row) {
  if (row.status === "Refunded") return <span className="font-medium text-violet-600">Refunded</span>;
  if (row.status === "Voided") return <span className="font-medium text-slate-400">Not collected</span>;
  if (row.balance > 0) return money.format(row.balance);
  return <span className="font-medium text-emerald-600">Paid in full</span>;
}

/** Animated number that springs from 0 (or the previous value) to `value`. */
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

/** Dual-series area chart (invoiced vs collected) with animated path draw and hover crosshair. */
function TrendChart({ data }) {
  const [hover, setHover] = useState(null);
  const width = 560;
  const height = 180;
  const pad = { top: 12, bottom: 24, left: 8, right: 8 };
  const innerW = width - pad.left - pad.right;
  const innerH = height - pad.top - pad.bottom;
  const maxValue = Math.max(1, ...data.map((d) => Math.max(d.collected, d.invoiced)));
  const niceMax = maxValue * 1.15;

  const pointsFor = (key) => data.map((item, index) => ({
    x: pad.left + (index / Math.max(1, data.length - 1)) * innerW,
    y: pad.top + innerH - (item[key] / niceMax) * innerH,
    value: item[key],
    label: item.label,
  }));
  const collected = pointsFor("collected");
  const invoiced = pointsFor("invoiced");
  const linePath = (points) => points.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(" ");
  const areaPath = (points) => `${linePath(points)} L ${(pad.left + innerW).toFixed(1)} ${pad.top + innerH} L ${pad.left} ${pad.top + innerH} Z`;

  const ticks = [0, 0.5, 1].map((f) => ({ y: pad.top + innerH - f * innerH, value: f * niceMax }));

  function onMove(event) {
    const rect = event.currentTarget.getBoundingClientRect();
    const relX = ((event.clientX - rect.left) / rect.width) * width;
    let nearest = 0;
    let best = Infinity;
    collected.forEach((p, i) => { const d = Math.abs(p.x - relX); if (d < best) { best = d; nearest = i; } });
    setHover(nearest);
  }

  const active = hover != null ? { collected: collected[hover], invoiced: invoiced[hover] } : null;

  return (
    <div className="min-w-0">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="h-[190px] w-full overflow-visible"
        onMouseMove={onMove}
        onMouseLeave={() => setHover(null)}
        role="img"
        aria-label="Monthly invoiced and collected amounts"
      >
        <defs>
          <linearGradient id="collectedFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#10B981" stopOpacity="0.28" />
            <stop offset="100%" stopColor="#10B981" stopOpacity="0" />
          </linearGradient>
          <linearGradient id="invoicedFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#0EA5E9" stopOpacity="0.16" />
            <stop offset="100%" stopColor="#0EA5E9" stopOpacity="0" />
          </linearGradient>
        </defs>

        {ticks.map((tick) => (
          <g key={tick.y}>
            <line x1={pad.left} y1={tick.y} x2={width - pad.right} y2={tick.y} stroke="#E2E8F0" strokeDasharray="4 7" />
            <text x={width - pad.right} y={tick.y - 4} textAnchor="end" className="fill-slate-400 text-[9px] font-medium">{compactMoney(tick.value)}</text>
          </g>
        ))}

        <motion.path d={areaPath(invoiced)} fill="url(#invoicedFill)" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.9, delay: 0.35 }} />
        <motion.path d={areaPath(collected)} fill="url(#collectedFill)" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.9, delay: 0.5 }} />
        <motion.path d={linePath(invoiced)} fill="none" stroke="#0EA5E9" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" strokeDasharray="1 0" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 1.1, ease: [0.32, 0.72, 0, 1] }} />
        <motion.path d={linePath(collected)} fill="none" stroke="#10B981" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 1.1, delay: 0.15, ease: [0.32, 0.72, 0, 1] }} />

        {active ? (
          <g>
            <line x1={active.collected.x} y1={pad.top} x2={active.collected.x} y2={pad.top + innerH} stroke="#94A3B8" strokeDasharray="3 4" />
            <circle cx={active.invoiced.x} cy={active.invoiced.y} r="4.5" fill="#fff" stroke="#0EA5E9" strokeWidth="2.4" />
            <circle cx={active.collected.x} cy={active.collected.y} r="4.5" fill="#fff" stroke="#10B981" strokeWidth="2.4" />
          </g>
        ) : (
          collected.map((p, i) => <circle key={p.label + i} cx={p.x} cy={p.y} r="3" fill="#fff" stroke="#10B981" strokeWidth="2" />)
        )}

        {data.map((item, index) => (
          <text key={item.label + index} x={pad.left + (index / Math.max(1, data.length - 1)) * innerW} y={height - 6} textAnchor="middle" className="fill-slate-400 text-[9.5px] font-medium">{item.label}</text>
        ))}
      </svg>

      <AnimatePresence>
        {active ? (
          <motion.div initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="mt-1 flex items-center justify-center gap-4 text-[11px] font-semibold">
            <span className="text-slate-500">{active.collected.label}</span>
            <span className="flex items-center gap-1.5 text-sky-600"><span className="h-2 w-2 rounded-full bg-sky-500" /> Invoiced {compactMoney(active.invoiced.value)}</span>
            <span className="flex items-center gap-1.5 text-emerald-600"><span className="h-2 w-2 rounded-full bg-emerald-500" /> Collected {compactMoney(active.collected.value)}</span>
          </motion.div>
        ) : (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="mt-1 flex items-center justify-center gap-4 text-[11px] font-medium text-slate-400">
            <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-sky-500" /> Invoiced</span>
            <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-emerald-500" /> Collected</span>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/** SVG donut with animated arc sweep + interactive legend highlighting. */
function StatusDonut({ breakdown }) {
  const [activeKey, setActiveKey] = useState(null);
  const entries = Object.entries(breakdown || {}).filter(([, v]) => v.count > 0).sort((a, b) => b[1].amount - a[1].amount);
  const totalAmount = entries.reduce((sum, [, v]) => sum + v.amount, 0);
  const totalCount = entries.reduce((sum, [, v]) => sum + v.count, 0);
  const radius = 62;
  const strokeWidth = 20;
  const circumference = 2 * Math.PI * radius;

  let offset = 0;
  const segments = entries.map(([key, value]) => {
    const fraction = totalAmount > 0 ? value.amount / totalAmount : 0;
    const segment = { key, value, fraction, start: offset };
    offset += fraction;
    return segment;
  });

  const active = activeKey ? entries.find(([key]) => key === activeKey) : null;

  return (
    <div className="flex min-w-0 flex-col items-center gap-5 sm:flex-row sm:items-center">
      <div className="relative h-[168px] w-[168px] shrink-0">
        <svg viewBox="0 0 168 168" className="h-full w-full -rotate-90">
          <circle cx="84" cy="84" r={radius} fill="none" stroke="#F1F5F9" strokeWidth={strokeWidth} />
          {segments.map((segment, index) => (
            <motion.circle
              key={segment.key}
              cx="84"
              cy="84"
              r={radius}
              fill="none"
              stroke={STATUS_COLOR[segment.key] || "#94A3B8"}
              strokeWidth={activeKey === segment.key ? strokeWidth + 5 : strokeWidth}
              strokeLinecap="butt"
              strokeDasharray={`${Math.max(0, segment.fraction * circumference - 2.5)} ${circumference}`}
              initial={{ strokeDashoffset: circumference }}
              animate={{ strokeDashoffset: -segment.start * circumference }}
              transition={{ duration: 0.9, delay: 0.25 + index * 0.1, ease: [0.32, 0.72, 0, 1] }}
              style={{ cursor: "pointer", transition: "stroke-width 0.2s ease" }}
              onMouseEnter={() => setActiveKey(segment.key)}
              onMouseLeave={() => setActiveKey(null)}
            />
          ))}
        </svg>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
          <AnimatePresence mode="wait">
            <motion.div key={activeKey || "total"} initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }} transition={{ duration: 0.15 }}>
              {active ? (
                <>
                  <p className="text-[11px] font-semibold" style={{ color: STATUS_COLOR[active[0]] }}>{STATUS_LABEL[active[0]]}</p>
                  <p className="text-[19px] font-semibold tracking-tight text-slate-950">{compactMoney(active[1].amount)}</p>
                  <p className="text-[10px] font-medium text-slate-400">{active[1].count} record{active[1].count === 1 ? "" : "s"}</p>
                </>
              ) : (
                <>
                  <p className="text-[11px] font-medium text-slate-400">Total invoiced</p>
                  <p className="text-[19px] font-semibold tracking-tight text-slate-950">{compactMoney(totalAmount)}</p>
                  <p className="text-[10px] font-medium text-slate-400">{totalCount} records</p>
                </>
              )}
            </motion.div>
          </AnimatePresence>
        </div>
      </div>

      <div className="w-full min-w-0 space-y-2">
        {segments.map((segment, index) => (
          <motion.button
            key={segment.key}
            type="button"
            initial={{ opacity: 0, x: 10 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.4 + index * 0.07 }}
            onMouseEnter={() => setActiveKey(segment.key)}
            onMouseLeave={() => setActiveKey(null)}
            className={cx(
              "flex w-full items-center justify-between gap-3 rounded-xl px-2.5 py-1.5 text-left transition-colors",
              activeKey === segment.key ? "bg-slate-100/80" : "hover:bg-slate-50/80",
            )}
          >
            <span className="flex min-w-0 items-center gap-2.5">
              <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: STATUS_COLOR[segment.key] }} />
              <span className="truncate text-[12px] font-medium text-slate-600">{STATUS_LABEL[segment.key] || segment.key}</span>
            </span>
            <span className="shrink-0 text-[12px] font-semibold tabular-nums text-slate-700">
              {compactMoney(segment.value.amount)} <span className="font-medium text-slate-400">({Math.round(segment.fraction * 100)}%)</span>
            </span>
          </motion.button>
        ))}
        {!segments.length ? <p className="rounded-xl border border-dashed border-slate-200 bg-slate-50/60 p-4 text-sm text-slate-400">No payment records yet.</p> : null}
      </div>
    </div>
  );
}

/** Horizontal collected-vs-outstanding bars per payment source. */
function TypeBars({ breakdown }) {
  const entries = Object.entries(breakdown || {}).sort((a, b) => (b[1].collected + b[1].outstanding) - (a[1].collected + a[1].outstanding));
  const maxTotal = Math.max(1, ...entries.map(([, v]) => v.collected + v.outstanding));

  return (
    <div className="space-y-4">
      {entries.map(([key, value], index) => {
        const Icon = SOURCE_ICON[key] || Banknote;
        const total = value.collected + value.outstanding;
        return (
          <motion.div key={key} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 + index * 0.1 }} className="group">
            <div className="flex items-center justify-between gap-3">
              <span className="flex min-w-0 items-center gap-2 text-[12px] font-medium text-slate-600">
                <Icon className="h-3.5 w-3.5 shrink-0" style={{ color: SOURCE_COLOR[key] }} />
                <span className="truncate">{SOURCE_LABEL[key] || key}</span>
              </span>
              <span className="shrink-0 text-[12px] font-semibold tabular-nums text-slate-700">{compactMoney(total)}</span>
            </div>
            <div className="mt-1.5 flex h-3 w-full gap-0.5 overflow-hidden rounded-full bg-slate-100">
              <motion.div
                initial={{ width: 0 }}
                animate={{ width: `${(value.collected / maxTotal) * 100}%` }}
                transition={{ duration: 0.8, delay: 0.45 + index * 0.1, ease: [0.32, 0.72, 0, 1] }}
                className="h-full rounded-l-full transition-[filter] group-hover:brightness-110"
                style={{ backgroundColor: SOURCE_COLOR[key] }}
              />
              <motion.div
                initial={{ width: 0 }}
                animate={{ width: `${(value.outstanding / maxTotal) * 100}%` }}
                transition={{ duration: 0.8, delay: 0.55 + index * 0.1, ease: [0.32, 0.72, 0, 1] }}
                className="h-full rounded-r-full opacity-30 transition-[filter] group-hover:brightness-110"
                style={{ backgroundColor: SOURCE_COLOR[key] }}
              />
            </div>
            <p className="mt-1 text-[10.5px] font-medium text-slate-400">
              {compactMoney(value.collected)} collected · {compactMoney(value.outstanding)} outstanding · {value.count} record{value.count === 1 ? "" : "s"}
            </p>
          </motion.div>
        );
      })}
      {!entries.length ? <p className="rounded-xl border border-dashed border-slate-200 bg-slate-50/60 p-4 text-sm text-slate-400">No payment records yet.</p> : null}
    </div>
  );
}

function ChartCard({ title, subtitle, children, className, delay = 0 }) {
  return (
    <motion.section
      initial={{ opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ ...spring, delay }}
      className={cx(glass, "min-w-0 p-5", className)}
    >
      <div className="mb-4">
        <h2 className="text-[15px] font-semibold tracking-[-0.015em] text-slate-950">{title}</h2>
        {subtitle ? <p className="mt-0.5 text-[12px] text-slate-400">{subtitle}</p> : null}
      </div>
      {children}
    </motion.section>
  );
}

const filterControl = "rounded-2xl border border-slate-200/80 bg-white/80 px-3.5 py-2.5 text-sm font-medium text-slate-700 shadow-sm outline-none backdrop-blur transition focus:border-sky-400 focus:ring-2 focus:ring-sky-100";

export default function Payments() {
  const [summary, setSummary] = useState(null);
  const [rows, setRows] = useState(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const pageSize = 20;
  const [status, setStatus] = useState("");
  const [source, setSource] = useState("");
  const [query, setQuery] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    getPaymentsOverviewSummary().catch(() => null).then((data) => data && setSummary(data));
  }, []);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    getPaymentsOverview({ status, source, query, from, to, page, pageSize })
      .then((data) => {
        if (!active) return;
        setRows(data.rows);
        setTotal(data.total);
      })
      .catch((reason) => active && setError(reason.response?.data?.message || "Payments could not be loaded."))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [status, source, query, from, to, page]);

  useEffect(() => { setPage(1); }, [status, source, query, from, to]);

  const pageCount = Math.max(1, Math.ceil(total / pageSize));

  const monthDelta = useMemo(() => {
    if (!summary) return null;
    if (!summary.paidLastMonth) return summary.paidThisMonth > 0 ? "First collections this month" : null;
    const change = ((summary.paidThisMonth - summary.paidLastMonth) / summary.paidLastMonth) * 100;
    return `${change >= 0 ? "+" : ""}${Math.round(change)}% vs last month`;
  }, [summary]);

  return (
    <main className="min-w-0 bg-[radial-gradient(circle_at_12%_-4%,rgba(56,130,246,0.10),transparent_36%),radial-gradient(circle_at_92%_16%,rgba(139,92,246,0.08),transparent_38%)] px-3 py-4 sm:px-5 lg:px-6">
      <div className="mx-auto flex w-full max-w-[1680px] min-w-0 flex-col gap-5">
        <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={spring} className={cx(glass, "overflow-hidden p-5 sm:p-7 lg:p-8")}>
          <h1 className="text-3xl font-semibold tracking-tight text-slate-950 sm:text-4xl">Payments</h1>
          <p className="mt-2 max-w-2xl text-sm text-slate-500 sm:text-base">
            Every case invoice, consultation booking payment, and legacy retainer across the agency — trends first, details below.
          </p>
        </motion.div>

        <div className="grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <KpiCard label="Total Collected" value={summary?.totalCollected ?? 0} icon={HandCoins} tint="bg-emerald-50 text-emerald-500 ring-emerald-100" delay={0.05} />
          <KpiCard label="Outstanding Balance" value={summary?.outstandingBalance ?? 0} icon={Wallet} tint="bg-amber-50 text-amber-500 ring-amber-100" delay={0.1} />
          <KpiCard label="Paid This Month" value={summary?.paidThisMonth ?? 0} icon={TrendingUp} tint="bg-sky-50 text-sky-500 ring-sky-100" delay={0.15} footnote={monthDelta} />
          <KpiCard label="Overdue Invoices" value={summary?.overdueCount ?? 0} format={(v) => String(Math.round(v))} icon={ShieldAlert} tint="bg-rose-50 text-rose-500 ring-rose-100" delay={0.2} />
        </div>

        <div className="grid min-w-0 grid-cols-1 gap-4 xl:grid-cols-12">
          <ChartCard title="Collections Trend" subtitle="Invoiced vs collected, last 8 months" className="xl:col-span-5" delay={0.15}>
            {summary ? <TrendChart data={summary.monthlyTrend || []} /> : <div className="flex h-[190px] items-center justify-center"><Loader2 className="h-5 w-5 animate-spin text-slate-300" /></div>}
          </ChartCard>
          <ChartCard title="Payment Status" subtitle="Share of invoiced value by status" className="xl:col-span-4" delay={0.22}>
            {summary ? <StatusDonut breakdown={summary.statusBreakdown} /> : <div className="flex h-[168px] items-center justify-center"><Loader2 className="h-5 w-5 animate-spin text-slate-300" /></div>}
          </ChartCard>
          <ChartCard title="By Payment Type" subtitle="Collected vs outstanding per source" className="xl:col-span-3" delay={0.29}>
            {summary ? <TypeBars breakdown={summary.typeBreakdown} /> : <div className="flex h-[168px] items-center justify-center"><Loader2 className="h-5 w-5 animate-spin text-slate-300" /></div>}
          </ChartCard>
        </div>

        <motion.section initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ ...spring, delay: 0.3 }} className={cx(glass, "min-w-0 overflow-hidden p-4 sm:p-5")}>
          <div className="flex flex-wrap items-center gap-2.5">
            <div className="relative min-w-[200px] flex-1">
              <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search client or invoice #…"
                className={cx(filterControl, "w-full pl-10")}
              />
            </div>
            <select value={status} onChange={(event) => setStatus(event.target.value)} className={filterControl}>
              <option value="">All statuses</option>
              {Object.entries(STATUS_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
            <select value={source} onChange={(event) => setSource(event.target.value)} className={filterControl}>
              <option value="">All types</option>
              {Object.entries(SOURCE_ROW_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
            <input type="date" value={from} onChange={(event) => setFrom(event.target.value)} className={filterControl} />
            <span className="text-xs text-slate-400">to</span>
            <input type="date" value={to} onChange={(event) => setTo(event.target.value)} className={filterControl} />
          </div>

          <div className="mt-4 overflow-x-auto rounded-[18px] border border-slate-200/70 bg-white/60">
            <table className="w-full min-w-[900px] border-separate border-spacing-0 text-left">
              <thead>
                <tr className="bg-slate-50/80 text-[11px] font-semibold uppercase tracking-[0.02em] text-slate-500">
                  <th className="px-4 py-3">Client</th>
                  <th className="px-4 py-3">Type</th>
                  <th className="px-4 py-3">Case</th>
                  <th className="px-4 py-3">Amount</th>
                  <th className="px-4 py-3">Balance</th>
                  <th className="px-4 py-3">Date</th>
                  <th className="px-4 py-3">Status</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan="7" className="border-t border-slate-100 px-4 py-10 text-center text-sm text-slate-400"><Loader2 className="mx-auto h-5 w-5 animate-spin" /></td></tr>
                ) : error ? (
                  <tr><td colSpan="7" className="border-t border-slate-100 px-4 py-8 text-center text-sm text-rose-600">{error}</td></tr>
                ) : rows?.length ? (
                  rows.map((row, index) => {
                    const Icon = SOURCE_ICON[row.source] || Banknote;
                    return (
                      <motion.tr
                        key={row.id}
                        initial={{ opacity: 0, y: 6 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: Math.min(index * 0.03, 0.3), duration: 0.25 }}
                        className="border-t border-slate-100 text-[13px] text-slate-700 transition-colors hover:bg-sky-50/40"
                      >
                        <td className="border-t border-slate-100 px-4 py-3.5">
                          <p className="font-semibold text-slate-900">{row.clientName}</p>
                          <p className="mt-0.5 truncate text-xs text-slate-400">{row.description}</p>
                        </td>
                        <td className="border-t border-slate-100 px-4 py-3.5">
                          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-500"><Icon className="h-3.5 w-3.5" style={{ color: SOURCE_COLOR[row.source] }} /> {SOURCE_ROW_LABEL[row.source] || row.type}</span>
                        </td>
                        <td className="border-t border-slate-100 px-4 py-3.5">
                          {row.caseId ? (
                            <Link to={`/app/cases/${row.caseId}`} className="inline-flex items-center gap-1 text-xs font-semibold text-sky-700 transition hover:text-sky-900">
                              {row.caseType || "View case"} <ExternalLink className="h-3 w-3" />
                            </Link>
                          ) : <span className="text-xs text-slate-400">—</span>}
                        </td>
                        <td className="border-t border-slate-100 px-4 py-3.5 font-semibold tabular-nums text-slate-900">{money.format(row.amount)}</td>
                        <td className="border-t border-slate-100 px-4 py-3.5 tabular-nums text-slate-600">{paymentBalanceLabel(row)}</td>
                        <td className="border-t border-slate-100 px-4 py-3.5 text-slate-500">{formatDate(row.createdAt)}</td>
                        <td className="border-t border-slate-100 px-4 py-3.5">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className={cx("inline-flex h-7 items-center rounded-full px-3 text-[11px] font-semibold ring-1", STATUS_TONE[row.status] || STATUS_TONE.Open)}>
                              {STATUS_LABEL[row.status] || row.status}
                            </span>
                            {row.refundOwed ? (
                              <span
                                title="The consultation was cancelled after this payment was collected — QuickBooks does not refund automatically, this needs to be actioned manually."
                                className="inline-flex h-7 items-center gap-1 rounded-full bg-rose-50 px-3 text-[11px] font-semibold text-rose-600 ring-1 ring-rose-100"
                              >
                                <ShieldAlert className="h-3 w-3" /> Refund owed
                              </span>
                            ) : null}
                            {row.needsManualBooking ? (
                              <span
                                title="This client paid, but their slot was no longer available when the payment confirmed — no appointment was created. Book them manually or refund in QuickBooks."
                                className="inline-flex h-7 items-center gap-1 rounded-full bg-amber-50 px-3 text-[11px] font-semibold text-amber-600 ring-1 ring-amber-100"
                              >
                                <ShieldAlert className="h-3 w-3" /> Needs manual booking
                              </span>
                            ) : null}
                            {row.appointmentNotCancelled ? (
                              <span
                                title="This payment was refunded in QuickBooks, but the appointment is still scheduled — decide whether to cancel it."
                                className="inline-flex h-7 items-center gap-1 rounded-full bg-violet-50 px-3 text-[11px] font-semibold text-violet-600 ring-1 ring-violet-100"
                              >
                                <ShieldAlert className="h-3 w-3" /> Still scheduled
                              </span>
                            ) : null}
                          </div>
                        </td>
                      </motion.tr>
                    );
                  })
                ) : (
                  <tr><td colSpan="7" className="border-t border-slate-100 px-4 py-10 text-center text-sm text-slate-400">No payments match these filters.</td></tr>
                )}
              </tbody>
            </table>
          </div>

          {!loading && total > 0 ? (
            <div className="mt-4 flex items-center justify-between text-xs text-slate-500">
              <span>{total} record{total === 1 ? "" : "s"} · page {page} of {pageCount}</span>
              <div className="flex gap-2">
                <motion.button whileTap={{ scale: 0.95 }} type="button" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))} className="rounded-full border border-slate-200 bg-white/80 px-3.5 py-1.5 text-xs font-semibold text-slate-600 transition hover:border-slate-300 hover:bg-white disabled:opacity-40">Previous</motion.button>
                <motion.button whileTap={{ scale: 0.95 }} type="button" disabled={page >= pageCount} onClick={() => setPage((p) => Math.min(pageCount, p + 1))} className="rounded-full border border-slate-200 bg-white/80 px-3.5 py-1.5 text-xs font-semibold text-slate-600 transition hover:border-slate-300 hover:bg-white disabled:opacity-40">Next</motion.button>
              </div>
            </div>
          ) : null}
        </motion.section>
      </div>
    </main>
  );
}
