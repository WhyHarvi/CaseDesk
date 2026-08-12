import { useMemo, useState } from "react";
import { PhoneCall, Search, UserRound } from "lucide-react";
import { formatDuration, moneyFormatter } from "./workloadFormat";

const ROLE_LABEL = { admin: "Admin", consultant: "Consultant", frontdesk: "Front Desk" };
const ROLE_TONE = {
  admin: "bg-violet-50 text-violet-700",
  consultant: "bg-sky-50 text-sky-700",
  frontdesk: "bg-amber-50 text-amber-700",
};

function RoleBadge({ role }) {
  return <span className={`inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[10px] font-semibold ${ROLE_TONE[role] || "bg-slate-100 text-slate-600"}`}>{ROLE_LABEL[role] || role}</span>;
}

function CasesCell({ member }) {
  if (member.capacity == null) {
    // Admins/front desk don't carry a case-capacity target — show the raw
    // count, no bar implying a limit they were never assigned.
    return <span className="text-sm font-semibold text-slate-800">{member.activeCases}</span>;
  }
  const pct = member.caseCapacityPercentage;
  const barTone = pct >= 100 ? "bg-rose-500" : pct >= 75 ? "bg-amber-400" : "bg-emerald-500";
  return (
    <div>
      <p className="text-sm font-semibold text-slate-800">
        {member.activeCases} / {member.capacity} <span className="text-xs font-normal text-slate-500">({pct}%)</span>
      </p>
      <div className="mt-1.5 h-1.5 w-24 overflow-hidden rounded-full bg-slate-100">
        <div className={`h-full rounded-full ${barTone}`} style={{ width: `${Math.min(pct, 100)}%` }} />
      </div>
    </div>
  );
}

function DeadlinesCell({ member }) {
  if (!member.deadlinesOverdue && !member.deadlinesDueSoon) return <span className="text-sm text-slate-400">—</span>;
  return (
    <div className="space-y-0.5">
      {member.deadlinesOverdue ? <p className="text-sm font-semibold text-rose-700">{member.deadlinesOverdue} overdue</p> : null}
      {member.deadlinesDueSoon ? <p className="text-xs text-amber-700">{member.deadlinesDueSoon} due soon</p> : null}
    </div>
  );
}

export default function TeamRosterTable({ members, currency, onSelect }) {
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
          left.consultant.fullName.localeCompare(right.consultant.fullName),
      );
  }, [members, query]);

  return (
    <section className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-xl font-semibold text-slate-950">Your team</h2>
          <p className="mt-1 text-sm text-slate-500">Open a row to see everything that person owns.</p>
        </div>
        <label className="relative block w-full sm:w-80">
          <Search className="absolute left-3.5 top-3 h-4 w-4 text-slate-400" />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search your team" className="h-10 w-full rounded-full border border-slate-200 bg-white pl-10 pr-4 text-sm outline-none focus:border-sky-300 focus:ring-4 focus:ring-sky-100" />
        </label>
      </div>

      {!visible.length ? (
        <div className="rounded-3xl border border-dashed border-slate-200 bg-white/60 p-10 text-center text-sm text-slate-500">{query ? "No one matches your search." : "No active team members found."}</div>
      ) : (
        <div className="overflow-hidden rounded-3xl border border-slate-200/70 bg-white/85 shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1040px] text-left text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-xs font-semibold uppercase tracking-wide text-slate-400">
                  <th className="px-5 py-3 font-semibold">Team member</th>
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
                {visible.map((member) => (
                  <tr
                    key={member.consultant.id}
                    onClick={() => onSelect(member)}
                    className="cursor-pointer border-b border-slate-50 transition last:border-0 hover:bg-sky-50/40"
                  >
                    <td className="px-5 py-4">
                      <div className="flex min-w-0 items-center gap-3">
                        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-sky-50 text-sky-700"><UserRound className="h-5 w-5" /></span>
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <p className="truncate font-semibold text-slate-950">{member.consultant.fullName}</p>
                            <RoleBadge role={member.role} />
                          </div>
                          <p className="truncate text-xs text-slate-500">{member.profile?.masteryLevel || member.consultant.email}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-4"><CasesCell member={member} /></td>
                    <td className="px-3 py-4 text-sm font-semibold text-slate-800">{member.appointmentsBooked}</td>
                    <td className="px-3 py-4">
                      <p className="text-sm font-semibold text-slate-800">{member.callsHandled}</p>
                      {member.callSeconds ? (
                        <p className="mt-0.5 flex items-center gap-1 text-xs text-slate-500"><PhoneCall className="h-3 w-3" />{formatDuration(member.callSeconds)}</p>
                      ) : null}
                    </td>
                    <td className="px-3 py-4 text-sm font-semibold text-slate-800">{member.casesWorkedOn}</td>
                    <td className="px-3 py-4 text-sm font-semibold text-emerald-700">{member.moneyCollected ? money.format(member.moneyCollected) : "—"}</td>
                    <td className="px-3 py-4 text-sm font-semibold text-slate-800">{member.portalActiveSeconds ? formatDuration(member.portalActiveSeconds) : "—"}</td>
                    <td className="px-5 py-4"><DeadlinesCell member={member} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  );
}
