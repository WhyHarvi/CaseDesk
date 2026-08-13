import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { CalendarClock, HandCoins, ListChecks, PhoneCall, Timer, X } from "lucide-react";
import { WorkDetails } from "../../pages/Workload.jsx";
import { formatDuration, moneyFormatter } from "./workloadFormat";
import { Avatar, DailyBars, colorForId, presenceFromLastActive } from "./workloadVisuals";
import api from "../../services/api";

const spring = { type: "spring", stiffness: 320, damping: 30 };
const ROLE_LABEL = { admin: "Admin", consultant: "Consultant", frontdesk: "Front Desk" };

const DAILY_METRICS = [
  ["activeSeconds", "Active time"],
  ["activityCount", "Actions"],
  ["appointmentsBooked", "Appointments"],
];

const PRESENCE_LABEL = { online: "Active now", away: "Active recently", offline: "Offline" };
const PRESENCE_TEXT_TONE = { online: "text-emerald-600", away: "text-amber-600", offline: "text-slate-400" };

function relativeTime(value) {
  if (!value) return "";
  const diffMs = Date.now() - new Date(value).getTime();
  const minutes = Math.round(diffMs / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

function Stat({ icon: Icon, label, value }) {
  return (
    <div className="rounded-2xl border border-slate-100 bg-slate-50/70 px-4 py-3">
      <div className="flex items-center gap-1.5 text-slate-400"><Icon className="h-3.5 w-3.5" /><p className="text-[11px] font-semibold uppercase tracking-wide">{label}</p></div>
      <p className="mt-1.5 text-lg font-semibold text-slate-900">{value}</p>
    </div>
  );
}

// The period metrics here come straight off the roster row already held by
// the page — no extra request. The item lists below (leads, cases, tasks…)
// reuse the same WorkDetails/ViewAllDrawer pair the personal workload view
// and the Unassigned callout already use, since the roster payload carries
// each person's items at the same default slice the old per-consultant
// card did. Daily activity is the one thing that genuinely needs its own
// request — nothing else on the page has ever asked for day-level detail.
export default function TeamMemberDrawer({ member, currency, onClose, onOpenAppointment, onWorkloadChanged }) {
  const money = useMemo(() => moneyFormatter(currency), [currency]);
  const color = colorForId(member.consultant.id);
  const presence = presenceFromLastActive(member.lastActiveAt);
  const [daily, setDaily] = useState(null);
  const [dailyMetric, setDailyMetric] = useState("activeSeconds");

  useEffect(() => {
    let active = true;
    api.get("/workload/team/daily-trend", { params: { days: 14, userIds: member.consultant.id } })
      .then((response) => { if (active) setDaily(response.data.data?.members?.[0]?.days || []); });
    return () => { active = false; };
  }, [member.consultant.id]);

  const dailyFormat = dailyMetric === "activeSeconds" ? formatDuration : (v) => String(Math.round(v));

  return (
    <div className="fixed inset-0 z-[420] flex justify-end bg-slate-950/25 backdrop-blur-[2px]" onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <motion.aside
        initial={{ x: 70, opacity: 0 }}
        animate={{ x: 0, opacity: 1 }}
        exit={{ x: 70, opacity: 0 }}
        transition={spring}
        className="flex h-full w-full max-w-3xl flex-col border-l border-white/70 bg-white/95 shadow-[-30px_0_90px_rgba(15,23,42,0.2)] backdrop-blur-2xl"
      >
        <div className="flex items-center justify-between border-b border-slate-100 p-5">
          <div className="flex items-center gap-3">
            <Avatar id={member.consultant.id} fullName={member.consultant.fullName} size={44} presence={presence} />
            <div>
              <h2 className="font-semibold text-slate-950">{member.consultant.fullName}</h2>
              <p className="text-sm text-slate-500">{ROLE_LABEL[member.role] || member.role} · {member.consultant.email}</p>
              {presence ? (
                <p className={`mt-0.5 text-xs font-semibold ${PRESENCE_TEXT_TONE[presence]}`}>
                  {presence === "online" ? PRESENCE_LABEL.online : `${PRESENCE_LABEL[presence]} · ${relativeTime(member.lastActiveAt)}`}
                </p>
              ) : null}
            </div>
          </div>
          <button type="button" onClick={onClose} className="flex h-9 w-9 items-center justify-center rounded-full text-slate-500 hover:bg-slate-100" aria-label="Close">
            <X className="h-4.5 w-4.5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat icon={CalendarClock} label="Appointments booked" value={member.appointmentsBooked} />
            <Stat
              icon={PhoneCall}
              label="Leads called"
              value={
                <span className="flex items-center gap-1.5">
                  {member.callsHandled}
                  {member.callSeconds ? <span className="text-xs font-normal text-slate-500">{formatDuration(member.callSeconds)}</span> : null}
                </span>
              }
            />
            <Stat icon={ListChecks} label="Cases worked on" value={member.casesWorkedOn} />
            <Stat icon={HandCoins} label="Collected" value={member.moneyCollected ? money.format(member.moneyCollected) : "—"} />
            <Stat icon={Timer} label="Portal time" value={member.portalActiveSeconds ? formatDuration(member.portalActiveSeconds) : "—"} />
            <Stat icon={CalendarClock} label="Overdue" value={member.deadlinesOverdue} />
            <Stat icon={CalendarClock} label="Due soon" value={member.deadlinesDueSoon} />
            {member.capacity != null ? <Stat icon={ListChecks} label="Case capacity" value={`${member.activeCases} / ${member.capacity} (${member.caseCapacityPercentage}%)`} /> : null}
          </div>

          <div className="mt-5 rounded-2xl border border-slate-100 bg-white/70 p-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Last 14 days</p>
              <div className="flex gap-1 rounded-full bg-slate-100 p-1">
                {DAILY_METRICS.map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setDailyMetric(value)}
                    className={`h-6 shrink-0 rounded-full px-2.5 text-[10px] font-semibold transition ${dailyMetric === value ? "bg-white text-slate-900 shadow-sm" : "text-slate-500"}`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
            {daily ? (
              daily.some((day) => Number(day[dailyMetric]) > 0) ? (
                <DailyBars days={daily} metricKey={dailyMetric} formatValue={dailyFormat} color={color.solid} />
              ) : (
                <p className="py-4 text-center text-xs text-slate-400">No activity recorded in the last 14 days.</p>
              )
            ) : (
              <div className="flex h-16 items-center justify-center text-xs text-slate-400">Loading…</div>
            )}
          </div>

          <div className="mt-6">
            <WorkDetails workload={member} onOpenAppointment={onOpenAppointment} consultantKey={member.consultant.id} canManageCollaborators onCollaboratorsChanged={onWorkloadChanged} />
          </div>
        </div>
      </motion.aside>
    </div>
  );
}
