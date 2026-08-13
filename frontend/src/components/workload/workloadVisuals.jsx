import { useEffect, useMemo, useRef, useState } from "react";
import gsap from "gsap";

// Small, fixed palette reused everywhere a person needs a consistent color
// — avatar background, radar/line series, bar fills. Picking by a hash of
// the user id (not array index) means a person's color stays the same
// across renders and across which other people happen to be selected.
const PALETTE = [
  { solid: "#0EA5E9", tint: "rgba(14,165,233,0.16)", text: "text-sky-700", bg: "bg-sky-50", ring: "ring-sky-100" },
  { solid: "#8B5CF6", tint: "rgba(139,92,246,0.16)", text: "text-violet-700", bg: "bg-violet-50", ring: "ring-violet-100" },
  { solid: "#F59E0B", tint: "rgba(245,158,11,0.16)", text: "text-amber-700", bg: "bg-amber-50", ring: "ring-amber-100" },
  { solid: "#10B981", tint: "rgba(16,185,129,0.16)", text: "text-emerald-700", bg: "bg-emerald-50", ring: "ring-emerald-100" },
  { solid: "#F43F5E", tint: "rgba(244,63,94,0.16)", text: "text-rose-700", bg: "bg-rose-50", ring: "ring-rose-100" },
  { solid: "#6366F1", tint: "rgba(99,102,241,0.16)", text: "text-indigo-700", bg: "bg-indigo-50", ring: "ring-indigo-100" },
];

function hashString(value) {
  let hash = 0;
  const text = String(value || "");
  for (let index = 0; index < text.length; index += 1) {
    hash = (hash * 31 + text.charCodeAt(index)) >>> 0;
  }
  return hash;
}

export function colorForId(id) {
  return PALETTE[hashString(id) % PALETTE.length];
}

export function initialsFor(fullName) {
  const parts = String(fullName || "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

const ONLINE_WITHIN_MS = 5 * 60_000;
const AWAY_WITHIN_MS = 30 * 60_000;

/** online (pinged <5m ago) / away (<30m) / offline (has activity history but stale) / null (never pinged, don't show a dot). */
export function presenceFromLastActive(lastActiveAt, now = Date.now()) {
  if (!lastActiveAt) return null;
  const ageMs = now - new Date(lastActiveAt).getTime();
  if (ageMs < ONLINE_WITHIN_MS) return "online";
  if (ageMs < AWAY_WITHIN_MS) return "away";
  return "offline";
}

const PRESENCE_DOT = { online: "bg-emerald-500", away: "bg-amber-400", offline: "bg-slate-300" };

/** Colored initials avatar — the visual anchor for a person across the roster, drawer, and compare view. Pass `presence` ("online"/"away"/"offline") to show a corner status dot. */
export function Avatar({ id, fullName, size = 40, presence }) {
  const color = colorForId(id);
  return (
    <span className="relative inline-flex shrink-0" style={{ width: size, height: size }}>
      <span
        className={`flex h-full w-full items-center justify-center rounded-2xl font-semibold ${color.bg} ${color.text} ring-1 ${color.ring}`}
        style={{ fontSize: Math.max(11, size * 0.36) }}
      >
        {initialsFor(fullName)}
      </span>
      {presence ? (
        <span
          title={presence === "online" ? "Active now" : presence === "away" ? "Active recently" : "Offline"}
          className={`absolute -bottom-0.5 -right-0.5 rounded-full ring-2 ring-white ${PRESENCE_DOT[presence]}`}
          style={{ width: Math.max(8, size * 0.28), height: Math.max(8, size * 0.28) }}
        />
      ) : null}
    </span>
  );
}

/** Animated count-up — GSAP tweens a plain number, formatted fresh on every tick. */
export function GsapCount({ value, format = (v) => String(Math.round(v)), className }) {
  const ref = useRef(null);
  const prev = useRef(0);

  useEffect(() => {
    const node = ref.current;
    if (!node) return undefined;
    const state = { val: prev.current };
    const tween = gsap.to(state, {
      val: Number(value) || 0,
      duration: 0.9,
      ease: "power2.out",
      onUpdate: () => { node.textContent = format(state.val); },
    });
    prev.current = Number(value) || 0;
    return () => tween.kill();
  }, [value, format]);

  return <span ref={ref} className={className}>{format(0)}</span>;
}

/**
 * Radar/spider chart comparing 2-4 people across a shared set of metrics.
 * Each axis is normalized against the max value for that metric across the
 * *entire* roster (passed in as `axisMax`), not just the selected people —
 * otherwise switching who's compared would silently rescale the chart and
 * make two genuinely different weeks look identical. `invert` axes (lower
 * is better, e.g. overdue deadlines) are flipped so "further out" always
 * reads as "better" on every axis, everywhere on the chart.
 */
export function RadarChart({ axes, series, axisMax }) {
  const size = 320;
  const center = size / 2;
  const radius = center - 56;
  const angleFor = (index) => (Math.PI * 2 * index) / axes.length - Math.PI / 2;
  const pathRef = useRef(null);

  const pointsFor = (values) =>
    axes.map((axis, index) => {
      const raw = Math.max(0, Number(values[axis.key]) || 0);
      const max = Math.max(1, axisMax[axis.key] || 1);
      let fraction = Math.min(1, raw / max);
      if (axis.invert) fraction = 1 - fraction;
      const r = radius * fraction;
      const angle = angleFor(index);
      return { x: center + r * Math.cos(angle), y: center + r * Math.sin(angle), fraction, raw };
    });

  const ringLevels = [0.25, 0.5, 0.75, 1];

  useEffect(() => {
    const polygons = pathRef.current?.querySelectorAll("[data-radar-series]");
    if (!polygons?.length) return undefined;
    const tween = gsap.from(polygons, {
      scale: 0,
      opacity: 0,
      transformOrigin: `${center}px ${center}px`,
      duration: 0.6,
      stagger: 0.08,
      ease: "back.out(1.5)",
    });
    return () => tween.kill();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [series.map((item) => item.id).join(",")]);

  return (
    <div className="flex flex-col items-center">
      <svg viewBox={`0 0 ${size} ${size}`} className="h-[300px] w-[300px]" role="img" aria-label="Performance comparison radar chart">
        <g ref={pathRef}>
          {ringLevels.map((level) => (
            <polygon
              key={level}
              points={axes.map((_, index) => {
                const angle = angleFor(index);
                const r = radius * level;
                return `${center + r * Math.cos(angle)},${center + r * Math.sin(angle)}`;
              }).join(" ")}
              fill="none"
              stroke="#E2E8F0"
              strokeDasharray={level === 1 ? "0" : "3 4"}
            />
          ))}
          {axes.map((axis, index) => {
            const angle = angleFor(index);
            const labelR = radius + 30;
            return (
              <g key={axis.key}>
                <line x1={center} y1={center} x2={center + radius * Math.cos(angle)} y2={center + radius * Math.sin(angle)} stroke="#E2E8F0" />
                <text
                  x={center + labelR * Math.cos(angle)}
                  y={center + labelR * Math.sin(angle)}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  className="fill-slate-500 text-[10px] font-semibold"
                >
                  {axis.label}
                </text>
              </g>
            );
          })}
          {series.map((person) => {
            const points = pointsFor(person.values);
            const color = colorForId(person.id);
            return (
              <polygon
                key={person.id}
                data-radar-series
                points={points.map((p) => `${p.x},${p.y}`).join(" ")}
                fill={color.solid}
                fillOpacity={0.16}
                stroke={color.solid}
                strokeWidth={2}
              />
            );
          })}
          {series.map((person) => {
            const points = pointsFor(person.values);
            const color = colorForId(person.id);
            return points.map((p, index) => (
              <circle key={`${person.id}-${index}`} cx={p.x} cy={p.y} r={3} fill="#fff" stroke={color.solid} strokeWidth={2} />
            ));
          })}
        </g>
      </svg>
      <div className="mt-2 flex flex-wrap items-center justify-center gap-3">
        {series.map((person) => {
          const color = colorForId(person.id);
          return (
            <span key={person.id} className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-600">
              <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: color.solid }} />
              {person.fullName}
            </span>
          );
        })}
      </div>
    </div>
  );
}

/**
 * The radar's mandatory precise-reading fallback: one horizontal bar group
 * per metric, exact values always visible as text (never hover-only), so
 * nobody has to eyeball polygon area to know who's actually ahead.
 */
export function ComparisonBarList({ axes, series, format }) {
  return (
    <div className="space-y-4">
      {axes.map((axis) => {
        const values = series.map((person) => Number(person.values[axis.key]) || 0);
        const max = Math.max(1, ...values);
        return (
          <div key={axis.key}>
            <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400">{axis.label}</p>
            <div className="space-y-1.5">
              {series.map((person) => {
                const value = Number(person.values[axis.key]) || 0;
                const color = colorForId(person.id);
                const pct = Math.max(2, Math.round((value / max) * 100));
                return (
                  <div key={person.id} className="flex items-center gap-2.5">
                    <span className="w-28 shrink-0 truncate text-[12px] font-medium text-slate-600">{person.fullName}</span>
                    <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-slate-100">
                      <div className="h-full rounded-full transition-[width] duration-700 ease-out" style={{ width: `${pct}%`, backgroundColor: color.solid }} />
                    </div>
                    <span className="w-16 shrink-0 text-right text-[12px] font-semibold tabular-nums text-slate-800">
                      {(axis.format || format || ((v) => String(Math.round(v))))(value)}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/**
 * Multi-series line chart for the daily trend — one line per selected
 * person, same visual language as the Payments page's TrendChart (area +
 * line + hover crosshair), extended to N series with a per-metric picker.
 */
export function MultiLineTrend({ series, metricKey, formatValue }) {
  const [hover, setHover] = useState(null);
  const width = 640;
  const height = 220;
  const pad = { top: 16, bottom: 26, left: 8, right: 8 };
  const innerW = width - pad.left - pad.right;
  const innerH = height - pad.top - pad.bottom;
  const days = series[0]?.days || [];
  const maxValue = Math.max(1, ...series.flatMap((person) => person.days.map((d) => Number(d[metricKey]) || 0)));
  const niceMax = maxValue * 1.15;

  const pointsFor = (person) =>
    person.days.map((point, index) => ({
      x: pad.left + (index / Math.max(1, days.length - 1)) * innerW,
      y: pad.top + innerH - ((Number(point[metricKey]) || 0) / niceMax) * innerH,
      value: Number(point[metricKey]) || 0,
      day: point.day,
    }));

  const linePath = (points) => points.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(" ");
  const ticks = [0, 0.5, 1].map((f) => ({ y: pad.top + innerH - f * innerH, value: f * niceMax }));

  function onMove(event) {
    const rect = event.currentTarget.getBoundingClientRect();
    const relX = ((event.clientX - rect.left) / rect.width) * width;
    const step = innerW / Math.max(1, days.length - 1);
    const index = Math.round((relX - pad.left) / step);
    setHover(Math.min(days.length - 1, Math.max(0, index)));
  }

  const dayLabel = (value) => {
    if (!value) return "";
    const date = new Date(`${value}T00:00:00Z`);
    return date.toLocaleDateString("en-CA", { month: "short", day: "numeric", timeZone: "UTC" });
  };

  return (
    <div className="min-w-0">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="h-[220px] w-full overflow-visible"
        onMouseMove={onMove}
        onMouseLeave={() => setHover(null)}
        role="img"
        aria-label="Daily activity trend by team member"
      >
        {ticks.map((tick) => (
          <g key={tick.y}>
            <line x1={pad.left} y1={tick.y} x2={width - pad.right} y2={tick.y} stroke="#E2E8F0" strokeDasharray="4 7" />
          </g>
        ))}
        {hover != null ? (
          <line
            x1={pad.left + (hover / Math.max(1, days.length - 1)) * innerW}
            y1={pad.top}
            x2={pad.left + (hover / Math.max(1, days.length - 1)) * innerW}
            y2={pad.top + innerH}
            stroke="#94A3B8"
            strokeDasharray="3 4"
          />
        ) : null}
        {series.map((person) => {
          const points = pointsFor(person);
          const color = colorForId(person.id);
          return (
            <g key={person.id}>
              <path d={linePath(points)} fill="none" stroke={color.solid} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
              {hover != null && points[hover] ? (
                <circle cx={points[hover].x} cy={points[hover].y} r="4.5" fill="#fff" stroke={color.solid} strokeWidth="2.4" />
              ) : null}
            </g>
          );
        })}
        {days.map((point, index) => {
          const step = Math.max(1, Math.ceil(days.length / 8));
          if (days.length > 10 && index % step !== 0 && index !== days.length - 1) return null;
          return (
            <text key={point.day} x={pad.left + (index / Math.max(1, days.length - 1)) * innerW} y={height - 8} textAnchor="middle" className="fill-slate-400 text-[9.5px] font-medium">
              {dayLabel(point.day)}
            </text>
          );
        })}
      </svg>
      <div className="mt-1 flex flex-wrap items-center justify-center gap-4 text-[11px] font-semibold">
        {series.map((person) => {
          const color = colorForId(person.id);
          const value = hover != null ? Number(person.days[hover]?.[metricKey]) || 0 : null;
          return (
            <span key={person.id} className="flex items-center gap-1.5" style={{ color: color.solid }}>
              <span className="h-2 w-2 rounded-full" style={{ backgroundColor: color.solid }} />
              {person.fullName}{value != null ? ` · ${formatValue(value)}` : ""}
            </span>
          );
        })}
        {hover != null && days[hover] ? <span className="text-slate-400">{dayLabel(days[hover].day)}</span> : null}
      </div>
    </div>
  );
}

/** Compact single-person daily strip for the member drawer — one bar per day, values on hover. */
export function DailyBars({ days, metricKey, formatValue, color }) {
  const max = Math.max(1, ...days.map((d) => Number(d[metricKey]) || 0));
  const [hover, setHover] = useState(null);
  const dayLabel = (value) => {
    const date = new Date(`${value}T00:00:00Z`);
    return date.toLocaleDateString("en-CA", { month: "short", day: "numeric", timeZone: "UTC" });
  };
  return (
    <div>
      <div className="flex h-16 items-end gap-1">
        {days.map((point, index) => {
          const value = Number(point[metricKey]) || 0;
          const pct = Math.max(3, Math.round((value / max) * 100));
          return (
            <div
              key={point.day}
              className="group relative flex-1 cursor-default"
              onMouseEnter={() => setHover(index)}
              onMouseLeave={() => setHover(null)}
            >
              <div
                className="w-full rounded-t-sm transition-[height] duration-500 ease-out"
                style={{ height: `${pct}%`, backgroundColor: hover === index ? color : `${color}66` }}
              />
            </div>
          );
        })}
      </div>
      <div className="mt-1.5 flex items-center justify-between text-[10px] text-slate-400">
        <span>{dayLabel(days[0]?.day)}</span>
        <span className="font-semibold text-slate-600">
          {hover != null ? `${dayLabel(days[hover].day)} · ${formatValue(Number(days[hover][metricKey]) || 0)}` : `Last ${days.length} days`}
        </span>
        <span>{dayLabel(days[days.length - 1]?.day)}</span>
      </div>
    </div>
  );
}

export function useStaggerReveal(dependency) {
  const ref = useRef(null);
  useEffect(() => {
    if (!ref.current) return undefined;
    const ctx = gsap.context(() => {
      gsap.from("[data-stagger]", {
        opacity: 0,
        y: 14,
        duration: 0.4,
        stagger: 0.045,
        ease: "power2.out",
        clearProps: "opacity,transform",
      });
    }, ref);
    return () => ctx.revert();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dependency]);
  return ref;
}

export function useAnimatedWidth(targetRef, percentage) {
  useEffect(() => {
    if (!targetRef.current) return undefined;
    const tween = gsap.fromTo(
      targetRef.current,
      { width: "0%" },
      { width: `${Math.min(100, Math.max(0, percentage))}%`, duration: 0.8, ease: "power2.out" },
    );
    return () => tween.kill();
  }, [targetRef, percentage]);
}
