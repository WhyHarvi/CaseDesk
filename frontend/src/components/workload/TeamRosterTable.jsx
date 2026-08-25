import { useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import { Check, PhoneCall, Scale, Search } from "lucide-react";
import { formatDuration, moneyFormatter } from "./workloadFormat";
import { Avatar, presenceFromLastActive, useAnimatedWidth } from "./workloadVisuals";

const spring = { type: "spring", stiffness: 320, damping: 30 };
const filterControl = "rounded-2xl border border-slate-200/80 bg-white/80 px-3.5 py-2.5 text-sm font-medium text-slate-700 shadow-sm outline-none backdrop-blur transition focus:border-sky-400 focus:ring-2 focus:ring-sky-100";

const ROLE_LABEL = { admin: "Admin", consultant: "Consultant", frontdesk: "Front Desk" };
const ROLE_TONE = {
  admin: "bg-violet-50 text-violet-700 ring-violet-100",
  consultant: "bg-sky-50 text-sky-700 ring-sky-100",
  frontdesk: "bg-amber-50 text-amber-700 ring-amber-100",
};

function RoleBadge({ role }) {
  return <span className={`inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1 ${ROLE_TONE[role] || "bg-slate-100 text-slate-600 ring-slate-200"}`}>{ROLE_LABEL[role] || role}</span>;
}

function CasesCell({ member }) {
  const barRef = useRef(null);
  const hasCapacity = member.capacity != null;
  const pct = hasCapacity ? member.caseCapacityPercentage : 0;
  // Hook must run unconditionally (rules of hooks) — it's simply a no-op
  // when there's no bar to animate (barRef never attaches to the DOM).
  useAnimatedWidth(barRef, Math.min(100, pct));
  const collaborating = member.collaboratingCases || 0;

  // A Case Worker is never the accountable owner (activeCases), so this
  // column would flatly read "0" for their entire real caseload — the
  // capacity bar is an ownership concept and doesn't apply to them either.
  // Their collaboratingCases count becomes the headline number instead of
  // being buried a click away in the drawer.
  if (!member.activeCases && collaborating > 0) {
    return (
      <div>
        <p className="text-sm font-semibold text-slate-800">{collaborating}</p>
        <p className="text-xs font-medium text-sky-700">collaborating</p>
      </div>
    );
  }

  if (!hasCapacity) {
    // Admins/front desk don't carry a case-capacity target — show the raw
    // count, no bar implying a limit they were never assigned.
    return (
      <div>
        <span className="text-sm font-semibold text-slate-800">{member.activeCases}</span>
        {collaborating > 0 ? <p className="mt-0.5 text-xs text-slate-500">+{collaborating} collaborating</p> : null}
      </div>
    );
  }
  const barTone = pct >= 100 ? "bg-rose-500" : pct >= 75 ? "bg-amber-400" : "bg-emerald-500";
  return (
    <div>
      <p className="text-sm font-semibold text-slate-800">
        {member.activeCases} / {member.capacity} <span className="text-xs font-normal text-slate-500">({pct}%)</span>
      </p>
      <div className="mt-1.5 h-1.5 w-24 overflow-hidden rounded-full bg-slate-100">
        <div ref={barRef} className={`h-full rounded-full ${barTone}`} />
      </div>
      {collaborating > 0 ? <p className="mt-1 text-xs text-slate-500">+{collaborating} collaborating</p> : null}
    </div>
  );
}

function DeadlinesCell({ member }) {
  if (!member.deadlinesOverdue && !member.deadlinesDueSoon) return <span className="text-sm font-medium text-emerald-600">On track</span>;
  return (
    <div className="space-y-0.5">
      {member.deadlinesOverdue ? <p className="text-sm font-semibold text-rose-700">{member.deadlinesOverdue} overdue</p> : null}
      {member.deadlinesDueSoon ? <p className="text-xs text-amber-700">{member.deadlinesDueSoon} due soon</p> : null}
    </div>
  );
}

export default function TeamRosterTable({ members, currency, onSelect, compareIds, onToggleCompare }) {
  const [query, setQuery] = useState("");
  const money = useMemo(() => moneyFormatter(currency), [currency]);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return [...members]
      .filter((member) => !needle || [member.consultant.fullName, member.consultant.email].some((value) => String(value || "").toLowerCase().includes(needle)))
      .sort(
        (left, right) =>
          right.deadlinesOverdue - left.deadlinesOverdue ||
          right.overdueLeadActions - left.overdueLeadActions ||
          (right.caseCapacityPercentage ?? -1) - (left.caseCapacityPercentage ?? -1) ||
          right.activeCases - left.activeCases ||
          // A Case Worker never carries activeCases/capacity (they're never
          // the accountable owner), so without this tiebreak they'd always
          // sink to the bottom regardless of real collaboratingCases load.
          (right.collaboratingCases || 0) - (left.collaboratingCases || 0) ||
          left.consultant.fullName.localeCompare(right.consultant.fullName),
      );
  }, [members, query]);

  return (
    <section className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-xl font-semibold text-slate-950">Your team</h2>
          <p className="mt-1 text-sm text-slate-500">Open a row to see everything that person owns, or check a few to compare them side by side.</p>
        </div>
        <label className="relative block w-full sm:w-80">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search your team" className={`${filterControl} w-full pl-10`} />
        </label>
      </div>

      {!visible.length ? (
        <div className="rounded-3xl border border-dashed border-slate-200 bg-white/60 p-10 text-center text-sm text-slate-500">{query ? "No one matches your search." : "No active team members found."}</div>
      ) : (
        <div className="overflow-hidden rounded-[1.6rem] border border-white/70 bg-white/70 shadow-[0_18px_50px_rgba(15,23,42,0.08)] backdrop-blur-2xl">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1100px] text-left text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-xs font-semibold uppercase tracking-wide text-slate-400">
                  <th className="w-11 px-4 py-3" aria-label="Select for comparison" />
                  <th className="px-2 py-3 font-semibold">Team member</th>
                  <th className="px-3 py-3 font-semibold">Cases</th>
                  <th className="px-3 py-3 font-semibold">Appointments booked</th>
                  <th className="px-3 py-3 font-semibold">Leads called</th>
                  <th className="px-3 py-3 font-semibold">Cases worked on</th>
                  <th className="px-3 py-3 font-semibold">Collected</th>
                  <th className="px-3 py-3 font-semibold">Portal time</th>
                  <th className="px-5 py-3 font-semibold">Deadlines</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((member, index) => {
                  const checked = compareIds.includes(member.consultant.id);
                  return (
                    <motion.tr
                      key={member.consultant.id}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ ...spring, delay: Math.min(index * 0.03, 0.3) }}
                      className={`border-b border-slate-50 transition last:border-0 hover:bg-sky-50/40 ${checked ? "bg-violet-50/40" : ""}`}
                    >
                      <td className="px-4 py-4">
                        <button
                          type="button"
                          onClick={(event) => { event.stopPropagation(); onToggleCompare(member.consultant.id); }}
                          aria-pressed={checked}
                          aria-label={checked ? `Remove ${member.consultant.fullName} from comparison` : `Add ${member.consultant.fullName} to comparison`}
                          className={`flex h-5 w-5 items-center justify-center rounded-md border transition ${checked ? "border-violet-500 bg-violet-500 text-white" : "border-slate-300 bg-white text-transparent hover:border-violet-300"}`}
                        >
                          <Check className="h-3.5 w-3.5" />
                        </button>
                      </td>
                      <td className="cursor-pointer px-2 py-4" onClick={() => onSelect(member)}>
                        <div className="flex min-w-0 items-center gap-3">
                          <Avatar id={member.consultant.id} fullName={member.consultant.fullName} presence={presenceFromLastActive(member.lastActiveAt)} />
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <p className="truncate font-semibold text-slate-950">{member.consultant.fullName}</p>
                              <RoleBadge role={member.role} />
                            </div>
                            <p className="truncate text-xs text-slate-500">{member.profile?.masteryLevel || member.consultant.email}</p>
                          </div>
                        </div>
                      </td>
                      <td className="cursor-pointer px-3 py-4" onClick={() => onSelect(member)}><CasesCell member={member} /></td>
                      <td className="cursor-pointer px-3 py-4 text-sm font-semibold text-slate-800" onClick={() => onSelect(member)}>{member.appointmentsBooked}</td>
                      <td className="cursor-pointer px-3 py-4" onClick={() => onSelect(member)}>
                        <p className="text-sm font-semibold text-slate-800">{member.callsHandled}</p>
                        {member.callSeconds ? (
                          <p className="mt-0.5 flex items-center gap-1 text-xs text-slate-500"><PhoneCall className="h-3 w-3" />{formatDuration(member.callSeconds)}</p>
                        ) : null}
                      </td>
                      <td className="cursor-pointer px-3 py-4 text-sm font-semibold text-slate-800" onClick={() => onSelect(member)}>{member.casesWorkedOn}</td>
                      <td className="cursor-pointer px-3 py-4 text-sm font-semibold text-emerald-700" onClick={() => onSelect(member)}>{member.moneyCollected ? money.format(member.moneyCollected) : "—"}</td>
                      <td className="cursor-pointer px-3 py-4 text-sm font-semibold text-slate-800" onClick={() => onSelect(member)}>{member.portalActiveSeconds ? formatDuration(member.portalActiveSeconds) : "—"}</td>
                      <td className="cursor-pointer px-5 py-4" onClick={() => onSelect(member)}><DeadlinesCell member={member} /></td>
                    </motion.tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {compareIds.length ? (
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={spring}
          className="sticky bottom-4 z-20 mx-auto flex w-fit items-center gap-3 rounded-full border border-white/70 bg-slate-950/95 px-5 py-2.5 text-sm font-semibold text-white shadow-[0_18px_50px_rgba(15,23,42,0.35)] backdrop-blur"
        >
          <Scale className="h-4 w-4 text-violet-300" />
          {compareIds.length} selected{compareIds.length < 2 ? " — pick one more to compare" : " · comparison shown below"}
        </motion.div>
      ) : null}
    </section>
  );
}
