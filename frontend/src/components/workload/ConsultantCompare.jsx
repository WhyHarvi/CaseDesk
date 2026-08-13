import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { BarChart3, Radar as RadarIcon, X } from "lucide-react";
import api from "../../services/api";
import { Avatar, ComparisonBarList, MultiLineTrend, RadarChart, colorForId } from "./workloadVisuals";
import { formatDuration, moneyFormatter } from "./workloadFormat";

const glass = "rounded-[1.6rem] border border-white/70 bg-white/70 shadow-[0_18px_50px_rgba(15,23,42,0.08)] backdrop-blur-2xl";
const spring = { type: "spring", stiffness: 320, damping: 30 };

const TREND_METRICS = [
  ["activeSeconds", "Active time"],
  ["activityCount", "Actions taken"],
  ["moneyCollected", "Collected"],
  ["appointmentsBooked", "Appointments"],
  ["callsHandled", "Calls handled"],
];

function buildAxes(money) {
  return [
    { key: "activeCases", label: "Active cases", format: (v) => String(Math.round(v)) },
    { key: "appointmentsBooked", label: "Appointments", format: (v) => String(Math.round(v)) },
    { key: "callsHandled", label: "Calls handled", format: (v) => String(Math.round(v)) },
    { key: "casesWorkedOn", label: "Cases worked", format: (v) => String(Math.round(v)) },
    { key: "moneyCollected", label: "Collected", format: money.format },
    { key: "portalActiveSeconds", label: "Active time", format: formatDuration },
    { key: "deadlinesOverdue", label: "On track", invert: true, format: (v) => `${Math.round(v)} overdue` },
  ];
}

// Comparing 2-4 people at once — the explicit "who's actually ahead" view
// nothing else on this page answers. Radar gives the at-a-glance shape,
// the bar list underneath gives the exact numbers behind it (mandatory
// per the radar-chart accessibility guidance: never let shape alone carry
// the comparison), and the trend chart shows whether that shape is a
// one-day blip or a real pattern.
export default function ConsultantCompare({ members, selectedIds, onRemove, onClear, currency }) {
  const [trend, setTrend] = useState(null);
  const [trendLoading, setTrendLoading] = useState(true);
  const [trendMetric, setTrendMetric] = useState("activeSeconds");
  const money = useMemo(() => moneyFormatter(currency), [currency]);
  const axes = useMemo(() => buildAxes(money), [money]);

  const selected = useMemo(
    () => selectedIds.map((id) => members.find((item) => item.consultant.id === id)).filter(Boolean),
    [members, selectedIds],
  );

  useEffect(() => {
    if (!selectedIds.length) return undefined;
    let active = true;
    setTrendLoading(true);
    api.get("/workload/team/daily-trend", { params: { days: 14, userIds: selectedIds.join(",") } })
      .then((response) => { if (active) setTrend(response.data.data); })
      .finally(() => { if (active) setTrendLoading(false); });
    return () => { active = false; };
  }, [selectedIds.join(",")]);

  const axisMax = useMemo(() => {
    const max = {};
    axes.forEach((axis) => {
      max[axis.key] = Math.max(1, ...members.map((member) => Number(member[axis.key]) || 0));
    });
    return max;
  }, [axes, members]);

  const radarSeries = selected.map((member) => ({
    id: member.consultant.id,
    fullName: member.consultant.fullName,
    values: axes.reduce((acc, axis) => ({ ...acc, [axis.key]: member[axis.key] }), {}),
  }));

  const trendSeries = (trend?.members || [])
    .filter((person) => selectedIds.includes(person.userId))
    .map((person) => ({ id: person.userId, fullName: person.fullName, days: person.days }));

  const trendFormat = trendMetric === "moneyCollected" ? money.format : trendMetric === "activeSeconds" ? formatDuration : (v) => String(Math.round(v));

  if (selected.length < 2) return null;

  return (
    <motion.section
      initial={{ opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
      transition={spring}
      className={`${glass} min-w-0 overflow-hidden p-5 sm:p-6`}
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-center gap-2.5">
          <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-violet-50 text-violet-600 ring-1 ring-violet-100">
            <RadarIcon className="h-5 w-5" />
          </span>
          <div>
            <h2 className="text-base font-semibold text-slate-950">Compare performance</h2>
            <p className="text-xs text-slate-500">{selected.length} team members · last 14 days of daily activity</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {selected.map((member) => {
            const color = colorForId(member.consultant.id);
            return (
              <span key={member.consultant.id} className={`flex items-center gap-1.5 rounded-full py-1 pl-1.5 pr-2.5 text-xs font-semibold ${color.bg} ${color.text} ring-1 ${color.ring}`}>
                <Avatar id={member.consultant.id} fullName={member.consultant.fullName} size={20} />
                {member.consultant.fullName.split(" ")[0]}
                <button type="button" onClick={() => onRemove(member.consultant.id)} className="rounded-full p-0.5 hover:bg-white/60" aria-label={`Remove ${member.consultant.fullName} from comparison`}>
                  <X className="h-3 w-3" />
                </button>
              </span>
            );
          })}
          <button type="button" onClick={onClear} className="text-xs font-semibold text-slate-400 hover:text-slate-600">
            Clear all
          </button>
        </div>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-12">
        <div className="lg:col-span-5">
          <RadarChart axes={axes} series={radarSeries} axisMax={axisMax} />
        </div>
        <div className="lg:col-span-7">
          <div className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
            <BarChart3 className="h-3.5 w-3.5" /> Exact numbers
          </div>
          <ComparisonBarList axes={axes} series={radarSeries} />
        </div>
      </div>

      <div className="mt-7 border-t border-slate-100 pt-6">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-slate-900">Daily trend</h3>
          <div className="flex flex-wrap gap-1 rounded-full bg-slate-100 p-1">
            {TREND_METRICS.map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => setTrendMetric(value)}
                className={`h-7 shrink-0 rounded-full px-3 text-[11px] font-semibold transition ${trendMetric === value ? "bg-white text-slate-900 shadow-sm" : "text-slate-500"}`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        {trendLoading ? (
          <div className="flex h-[220px] items-center justify-center text-sm text-slate-400">Loading trend…</div>
        ) : trendSeries.length ? (
          <MultiLineTrend series={trendSeries} metricKey={trendMetric} formatValue={trendFormat} />
        ) : (
          <div className="flex h-[220px] items-center justify-center text-sm text-slate-400">No activity in this window yet.</div>
        )}
      </div>
    </motion.section>
  );
}
