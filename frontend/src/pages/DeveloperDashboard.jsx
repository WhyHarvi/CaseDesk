import { Activity, Building2, BriefcaseBusiness, CircleAlert, Flag, LayoutDashboard, LogOut, RefreshCw, Ticket, UsersRound, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useAuth } from "../auth/AuthContext";
import api from "../services/api";

const cards = [
  ["Active agencies", "activeAgencies", Building2],
  ["Active staff", "staff", UsersRound],
  ["Active cases", "activeCases", BriefcaseBusiness],
  ["Open leads", "openLeads", Activity],
];

const SECTIONS = [
  { key: "overview", label: "Overview", icon: LayoutDashboard },
  { key: "agencies", label: "Agencies", icon: Building2 },
  { key: "support", label: "Support tickets", icon: Ticket },
  { key: "activity", label: "Activity", icon: Activity },
  { key: "flags", label: "Feature flags", icon: Flag },
];

function formatDate(value) {
  return value ? new Date(value).toLocaleString() : "-";
}

function OverviewSection({ data, loading }) {
  return <>
    <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">{cards.map(([label, key, Icon]) => <article key={key} className="border border-slate-200 bg-white p-5"><Icon className="h-5 w-5 text-sky-600" /><p className="mt-5 text-3xl font-semibold">{data?.adoption?.[key] ?? (loading ? "…" : "-")}</p><p className="mt-1 text-sm text-slate-500">{label}</p></article>)}</section>
    <section className="mt-8 grid gap-6 md:grid-cols-2">
      <div className="border-t border-slate-300 pt-4"><h2 className="text-sm font-semibold">Usage</h2><dl className="mt-4 divide-y divide-slate-200"><div className="flex justify-between py-3 text-sm"><dt>Activity events, last 24 hours</dt><dd className="font-semibold">{data?.usage?.activity24h ?? "-"}</dd></div><div className="flex justify-between py-3 text-sm"><dt>Active users, last 7 days</dt><dd className="font-semibold">{data?.usage?.activeUsers7d ?? "-"}</dd></div></dl></div>
      <div className="border-t border-slate-300 pt-4"><h2 className="text-sm font-semibold">Support</h2><dl className="mt-4 divide-y divide-slate-200"><div className="flex justify-between py-3 text-sm"><dt>Open reports</dt><dd className="font-semibold">{data?.support?.open ?? "-"}</dd></div><div className="flex justify-between py-3 text-sm"><dt>Email delivery pending</dt><dd className="font-semibold">{data?.support?.deliveryPending ?? "-"}</dd></div></dl></div>
    </section>
    {data?.generatedAt ? <p className="mt-8 text-xs text-slate-400">Updated {formatDate(data.generatedAt)}</p> : null}
  </>;
}

function AgenciesSection({ agencies, loading, onSelect }) {
  if (loading && !agencies.length) return <p className="text-sm text-slate-500">Loading agencies…</p>;
  if (!agencies.length) return <p className="text-sm text-slate-500">No customer agencies yet.</p>;
  return <div className="overflow-x-auto border border-slate-200 bg-white">
    <table className="min-w-full divide-y divide-slate-200 text-sm">
      <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
        <tr><th className="px-4 py-3">Agency</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">Staff</th><th className="px-4 py-3">Clients</th><th className="px-4 py-3">Active cases</th><th className="px-4 py-3">Open leads</th><th className="px-4 py-3">Created</th></tr>
      </thead>
      <tbody className="divide-y divide-slate-100">
        {agencies.map((agency) => <tr key={agency.id} className="cursor-pointer hover:bg-slate-50" onClick={() => onSelect(agency.id)}>
          <td className="px-4 py-3 font-medium text-slate-900">{agency.name}<div className="text-xs text-slate-400">{agency.slug}</div></td>
          <td className="px-4 py-3">{agency.status}{agency.accessStatus !== "active" ? <span className="ml-1 text-rose-600">({agency.accessStatus})</span> : null}</td>
          <td className="px-4 py-3">{agency.staff}</td>
          <td className="px-4 py-3">{agency.clients}</td>
          <td className="px-4 py-3">{agency.activeCases}</td>
          <td className="px-4 py-3">{agency.openLeads}</td>
          <td className="px-4 py-3 text-slate-500">{formatDate(agency.createdAt)}</td>
        </tr>)}
      </tbody>
    </table>
  </div>;
}

function AgencyDetailPanel({ detail, onClose }) {
  if (!detail) return null;
  const { agency, staff, clients, activeCases, openLeads, recentActivity, openSupportTickets } = detail;
  return <div className="fixed inset-0 z-20 flex justify-end bg-slate-950/30">
    <div className="h-full w-full max-w-lg overflow-y-auto border-l border-slate-200 bg-white p-6">
      <div className="flex items-start justify-between"><div><h2 className="text-lg font-semibold">{agency.name}</h2><p className="text-xs text-slate-400">{agency.slug}</p></div><button type="button" onClick={onClose} aria-label="Close" className="flex h-8 w-8 items-center justify-center text-slate-500 hover:bg-slate-100"><X className="h-4 w-4" /></button></div>
      <dl className="mt-6 grid grid-cols-2 gap-4 text-sm">
        <div><dt className="text-slate-500">Clients</dt><dd className="font-semibold">{clients}</dd></div>
        <div><dt className="text-slate-500">Active cases</dt><dd className="font-semibold">{activeCases}</dd></div>
        <div><dt className="text-slate-500">Open leads</dt><dd className="font-semibold">{openLeads}</dd></div>
        <div><dt className="text-slate-500">Open support tickets</dt><dd className="font-semibold">{openSupportTickets}</dd></div>
      </dl>
      <h3 className="mt-6 text-sm font-semibold">Staff</h3>
      <ul className="mt-2 divide-y divide-slate-100 text-sm">{staff.map((member) => <li key={member.id} className="py-2"><span className="font-medium">{member.fullName}</span> <span className="text-slate-400">— {member.role}</span><div className="text-xs text-slate-400">{member.email}</div></li>)}</ul>
      <h3 className="mt-6 text-sm font-semibold">Recent activity</h3>
      <ul className="mt-2 divide-y divide-slate-100 text-sm">{recentActivity.length ? recentActivity.map((entry) => <li key={entry.id} className="py-2"><span className="font-medium">{entry.user?.fullName || "System"}</span> <span className="text-slate-500">{entry.action}</span><div className="text-xs text-slate-400">{formatDate(entry.createdAt)}</div></li>) : <li className="py-2 text-slate-400">No recent activity.</li>}</ul>
    </div>
  </div>;
}

const TICKET_STATUSES = ["Submitted", "Investigating", "Resolved", "Closed"];

function SupportTicketsSection({ tickets, loading, statusFilter, onFilterChange, onStatusUpdate }) {
  return <div>
    <div className="mb-4 flex flex-wrap gap-2">
      <button type="button" onClick={() => onFilterChange("")} className={`border px-3 py-1.5 text-xs font-medium ${statusFilter === "" ? "border-sky-600 bg-sky-50 text-sky-700" : "border-slate-200 text-slate-600 hover:bg-slate-50"}`}>All</button>
      {TICKET_STATUSES.map((status) => <button key={status} type="button" onClick={() => onFilterChange(status)} className={`border px-3 py-1.5 text-xs font-medium ${statusFilter === status ? "border-sky-600 bg-sky-50 text-sky-700" : "border-slate-200 text-slate-600 hover:bg-slate-50"}`}>{status}</button>)}
    </div>
    {loading && !tickets.length ? <p className="text-sm text-slate-500">Loading support tickets…</p> : null}
    {!loading && !tickets.length ? <p className="text-sm text-slate-500">No support tickets found.</p> : null}
    <div className="divide-y divide-slate-200 border border-slate-200 bg-white">
      {tickets.map((ticket) => <div key={ticket.id} className="p-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div><p className="text-sm font-semibold">{ticket.ticketNumber} · {ticket.agency?.name}</p><p className="text-xs text-slate-400">{ticket.reportedBy?.fullName} ({ticket.reportedBy?.email}) — {formatDate(ticket.createdAt)}</p></div>
          <select value={ticket.status} onChange={(event) => onStatusUpdate(ticket.id, event.target.value)} className="border border-slate-200 px-2 py-1 text-xs">
            {TICKET_STATUSES.map((status) => <option key={status} value={status}>{status}</option>)}
          </select>
        </div>
        <p className="mt-2 text-sm text-slate-700">{ticket.description}</p>
        {ticket.novaSummary ? <p className="mt-1 text-xs text-slate-500">Summary: {ticket.novaSummary}</p> : null}
        <p className="mt-2 text-xs text-slate-400">Delivery: {ticket.deliveryStatus}{ticket.deliveryError ? ` — ${ticket.deliveryError}` : ""}</p>
      </div>)}
    </div>
  </div>;
}

function ActivitySection({ activity, loading }) {
  if (loading && !activity.length) return <p className="text-sm text-slate-500">Loading activity…</p>;
  if (!activity.length) return <p className="text-sm text-slate-500">No activity yet.</p>;
  return <div className="divide-y divide-slate-200 border border-slate-200 bg-white">
    {activity.map((entry) => <div key={entry.id} className="flex items-start justify-between gap-4 p-3 text-sm">
      <div><span className="font-medium">{entry.agency?.name}</span> — <span className="text-slate-600">{entry.user?.fullName || "System"}</span><div className="text-slate-500">{entry.action}</div></div>
      <span className="whitespace-nowrap text-xs text-slate-400">{formatDate(entry.createdAt)}</span>
    </div>)}
  </div>;
}

function FeatureFlagsSection({ flags, loading, onToggle }) {
  if (loading && !flags.length) return <p className="text-sm text-slate-500">Loading feature flags…</p>;
  return <div className="divide-y divide-slate-200 border border-slate-200 bg-white">
    {flags.map((flag) => <div key={flag.key} className="flex items-start justify-between gap-4 p-4">
      <div><p className="text-sm font-semibold">{flag.label}</p><p className="mt-1 text-sm text-slate-500">{flag.description}</p><p className="mt-1 text-xs text-slate-400">{flag.updatedAt ? `Last changed ${formatDate(flag.updatedAt)}${flag.updatedByName ? ` by ${flag.updatedByName}` : ""}` : "Using default value — never changed."}</p></div>
      <button
        type="button"
        onClick={() => onToggle(flag.key, !flag.enabled)}
        className={`shrink-0 border px-3 py-1.5 text-xs font-semibold ${flag.enabled ? "border-emerald-600 bg-emerald-50 text-emerald-700" : "border-slate-300 bg-slate-50 text-slate-600"}`}
      >
        {flag.enabled ? "Enabled" : "Disabled"}
      </button>
    </div>)}
  </div>;
}

export default function DeveloperDashboard() {
  const { signOut } = useAuth();
  const [section, setSection] = useState("overview");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const [overview, setOverview] = useState(null);
  const [agencies, setAgencies] = useState([]);
  const [agencyDetail, setAgencyDetail] = useState(null);
  const [tickets, setTickets] = useState([]);
  const [ticketStatusFilter, setTicketStatusFilter] = useState("");
  const [activity, setActivity] = useState([]);
  const [flags, setFlags] = useState([]);

  const loadSection = useCallback(async (key, extra) => {
    setLoading(true);
    setError("");
    try {
      if (key === "overview") {
        const response = await api.getFresh("/developer/overview");
        setOverview(response.data.data);
      } else if (key === "agencies") {
        const response = await api.getFresh("/developer/agencies");
        setAgencies(response.data.data);
      } else if (key === "support") {
        const status = extra?.status ?? ticketStatusFilter;
        const response = await api.getFresh(`/developer/support-tickets${status ? `?status=${encodeURIComponent(status)}` : ""}`);
        setTickets(response.data.data);
      } else if (key === "activity") {
        const response = await api.getFresh("/developer/activity");
        setActivity(response.data.data);
      } else if (key === "flags") {
        const response = await api.getFresh("/developer/feature-flags");
        setFlags(response.data.data);
      }
    } catch (reason) {
      setError(reason.response?.data?.message || "That data could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, [ticketStatusFilter]);

  useEffect(() => { void loadSection(section); }, [section, loadSection]);

  async function openAgency(id) {
    try {
      const response = await api.getFresh(`/developer/agencies/${id}`);
      setAgencyDetail(response.data.data);
    } catch (reason) {
      setError(reason.response?.data?.message || "That agency could not be loaded.");
    }
  }

  function changeTicketFilter(status) {
    setTicketStatusFilter(status);
    void loadSection("support", { status });
  }

  async function updateTicketStatus(id, status) {
    const previous = tickets;
    setTickets((current) => current.map((ticket) => (ticket.id === id ? { ...ticket, status } : ticket)));
    try {
      await api.patch(`/developer/support-tickets/${id}/status`, { status });
    } catch (reason) {
      setTickets(previous);
      setError(reason.response?.data?.message || "That ticket could not be updated.");
    }
  }

  async function toggleFlag(key, enabled) {
    const previous = flags;
    setFlags((current) => current.map((flag) => (flag.key === key ? { ...flag, enabled } : flag)));
    try {
      const response = await api.patch(`/developer/feature-flags/${key}`, { enabled });
      setFlags(response.data.data);
    } catch (reason) {
      setFlags(previous);
      setError(reason.response?.data?.message || "That flag could not be updated.");
    }
  }

  return <main className="min-h-screen bg-slate-50 text-slate-950">
    <header className="border-b border-slate-200 bg-white">
      <div className="mx-auto flex max-w-6xl items-center gap-3 px-5 py-4">
        <div className="min-w-0 flex-1"><h1 className="text-lg font-semibold">CaseDesk Developer</h1><p className="text-xs text-slate-500">Aggregate platform telemetry only</p></div>
        <button type="button" onClick={() => loadSection(section)} disabled={loading} aria-label="Refresh" title="Refresh" className="flex h-10 w-10 items-center justify-center text-slate-500 hover:bg-slate-100"><RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /></button>
        <button type="button" onClick={signOut} aria-label="Sign out" title="Sign out" className="flex h-10 w-10 items-center justify-center text-slate-500 hover:bg-slate-100"><LogOut className="h-4 w-4" /></button>
      </div>
      <nav className="mx-auto flex max-w-6xl gap-1 overflow-x-auto px-5">
        {SECTIONS.map(({ key, label, icon: Icon }) => <button
          key={key}
          type="button"
          onClick={() => setSection(key)}
          className={`flex items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2.5 text-sm font-medium ${section === key ? "border-sky-600 text-sky-700" : "border-transparent text-slate-500 hover:text-slate-800"}`}
        ><Icon className="h-4 w-4" />{label}</button>)}
      </nav>
    </header>
    <div className="mx-auto max-w-6xl px-5 py-8">
      {error ? <div className="mb-6 flex items-center gap-2 border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700"><CircleAlert className="h-4 w-4" />{error}</div> : null}
      {section === "overview" ? <OverviewSection data={overview} loading={loading} /> : null}
      {section === "agencies" ? <AgenciesSection agencies={agencies} loading={loading} onSelect={openAgency} /> : null}
      {section === "support" ? <SupportTicketsSection tickets={tickets} loading={loading} statusFilter={ticketStatusFilter} onFilterChange={changeTicketFilter} onStatusUpdate={updateTicketStatus} /> : null}
      {section === "activity" ? <ActivitySection activity={activity} loading={loading} /> : null}
      {section === "flags" ? <FeatureFlagsSection flags={flags} loading={loading} onToggle={toggleFlag} /> : null}
    </div>
    <AgencyDetailPanel detail={agencyDetail} onClose={() => setAgencyDetail(null)} />
  </main>;
}
