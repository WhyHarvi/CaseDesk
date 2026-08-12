import { useMemo } from "react";
import { PhoneCall, X } from "lucide-react";
import { WorkDetails } from "../../pages/Workload.jsx";
import { formatDuration, moneyFormatter } from "./workloadFormat";

const ROLE_LABEL = { admin: "Admin", consultant: "Consultant", frontdesk: "Front Desk" };

function Stat({ label, value }) {
  return (
    <div className="rounded-2xl bg-slate-50 px-4 py-3">
      <p className="text-xs text-slate-500">{label}</p>
      <p className="mt-1 text-lg font-semibold text-slate-900">{value}</p>
    </div>
  );
}

// The period metrics here come straight off the roster row already held by
// the page — no extra request. The item lists below (leads, cases, tasks…)
// reuse the same WorkDetails/ViewAllDrawer pair the personal workload view
// and the Unassigned callout already use, since the roster payload carries
// each person's items at the same default slice the old per-consultant
// card did.
export default function TeamMemberDrawer({ member, currency, onClose, onOpenAppointment }) {
  const money = useMemo(() => moneyFormatter(currency), [currency]);

  return (
    <div className="fixed inset-0 z-50 flex items-stretch justify-end bg-slate-900/40" onClick={onClose}>
      <div className="flex h-full w-full max-w-3xl flex-col bg-white shadow-2xl" onClick={(event) => event.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-slate-100 p-5">
          <div>
            <h2 className="font-semibold text-slate-950">{member.consultant.fullName}</h2>
            <p className="text-sm text-slate-500">{ROLE_LABEL[member.role] || member.role} · {member.consultant.email}</p>
          </div>
          <button type="button" onClick={onClose} className="flex h-9 w-9 items-center justify-center rounded-full text-slate-500 hover:bg-slate-100" aria-label="Close">
            <X className="h-4.5 w-4.5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="Appointments booked" value={member.appointmentsBooked} />
            <Stat
              label="Leads called"
              value={
                <span className="flex items-center gap-1.5">
                  {member.callsHandled}
                  {member.callSeconds ? <span className="flex items-center gap-1 text-xs font-normal text-slate-500"><PhoneCall className="h-3 w-3" />{formatDuration(member.callSeconds)}</span> : null}
                </span>
              }
            />
            <Stat label="Cases worked on" value={member.casesWorkedOn} />
            <Stat label="Collected" value={member.moneyCollected ? money.format(member.moneyCollected) : "—"} />
            <Stat label="Portal time" value={member.portalActiveSeconds ? formatDuration(member.portalActiveSeconds) : "—"} />
            <Stat label="Overdue" value={member.deadlinesOverdue} />
            <Stat label="Due soon" value={member.deadlinesDueSoon} />
            {member.capacity != null ? <Stat label="Case capacity" value={`${member.activeCases} / ${member.capacity} (${member.caseCapacityPercentage}%)`} /> : null}
          </div>

          <div className="mt-6">
            <WorkDetails workload={member} onOpenAppointment={onOpenAppointment} consultantKey={member.consultant.id} />
          </div>
        </div>
      </div>
    </div>
  );
}
