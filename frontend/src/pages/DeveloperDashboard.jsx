import { Activity, Building2, BriefcaseBusiness, Check, CircleAlert, CreditCard, Flag, LayoutDashboard, LockKeyhole, LogOut, RefreshCw, Ticket, UsersRound, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import logo from "../assets/logo.png";
import { useAuth } from "../auth/AuthContext";
import StaffAvatar from "../components/staff/StaffAvatar";
import CommercialPlanManager from "../components/developer/CommercialPlanManager";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Card, CardContent } from "../components/ui/card";
import api from "../services/api";

const cards = [
  ["Active agencies", "activeAgencies", Building2],
  ["Active staff", "staff", UsersRound],
  ["Active cases", "activeCases", BriefcaseBusiness],
  ["Open leads", "openLeads", Activity],
];

const SECTIONS = [
  { key: "overview", label: "Overview", description: "Platform health", icon: LayoutDashboard },
  { key: "agencies", label: "Agency directory", description: "Customer accounts", icon: Building2 },
  { key: "subscriptions", label: "Subscriptions", description: "Plans and pricing", icon: CreditCard, folio: "01" },
  { key: "workspaces", label: "Customer workspaces", description: "Access and entitlements", icon: LockKeyhole, folio: "02" },
  { key: "support", label: "Support tickets", description: "Customer requests", icon: Ticket },
  { key: "activity", label: "Activity", description: "Recent operations", icon: Activity },
  { key: "flags", label: "Feature flags", description: "Platform releases", icon: Flag },
];
const SECTION_KEYS = new Set(SECTIONS.map((item) => item.key));

function formatDate(value) {
  return value ? new Date(value).toLocaleString() : "-";
}

function isCanceledRequest(error) {
  return error?.code === "ERR_CANCELED" || error?.name === "CanceledError";
}

function PlatformSidebar({ section, onSelect, loading, onRefresh, onSignOut, appUser }) {
  const [hovered, setHovered] = useState(false);
  const expanded = hovered;

  return (
    <aside
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocusCapture={() => setHovered(true)}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setHovered(false);
      }}
      className={`sticky top-0 hidden h-screen shrink-0 flex-col overflow-hidden border-r border-white/80 bg-white/75 py-6 shadow-[12px_0_50px_rgba(15,23,42,0.04)] backdrop-blur-2xl transition-[width,padding] duration-300 ease-out lg:flex ${expanded ? "w-80 px-5" : "w-24 px-4"}`}
    >
      <div className={`flex items-center border-b border-slate-200/70 pb-5 ${expanded ? "gap-3 px-1" : "justify-center"}`}>
        <div className="flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200/80">
          <img src={logo} alt="CaseDesk" className="size-full object-cover" />
        </div>
        <div className={`min-w-0 transition-[width,transform,opacity] duration-300 ${expanded ? "w-full translate-x-0 opacity-100" : "w-0 -translate-x-3 opacity-0"}`}>
          <p className="truncate text-base font-semibold tracking-tight text-slate-950">CaseDesk</p>
          <p className="truncate text-xs text-slate-500">Platform Admin</p>
        </div>
      </div>

      <nav className="mt-5 flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto" aria-label="Platform administration">
        {SECTIONS.map(({ key, label, description, icon: Icon }) => {
          const active = section === key;
          return (
            <button
              key={key}
              type="button"
              onClick={() => onSelect(key)}
              aria-current={active ? "page" : undefined}
              title={expanded ? undefined : label}
              className={`group flex min-h-14 w-full cursor-pointer items-center rounded-2xl transition-all duration-200 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-sky-100 ${expanded ? "gap-3 px-3" : "justify-center px-2"} ${active ? "bg-sky-100/90 text-sky-800" : "text-slate-500 hover:bg-slate-100/80 hover:text-slate-800"}`}
            >
              <span className={`flex size-10 shrink-0 items-center justify-center rounded-full transition-colors ${active ? "bg-white text-sky-700 shadow-sm" : "bg-white/80 text-slate-500 ring-1 ring-slate-200/80 group-hover:text-sky-700"}`}>
                <Icon className="size-5" aria-hidden="true" />
              </span>
              <span className={`min-w-0 text-left transition-[width,transform,opacity] duration-300 ${expanded ? "w-full translate-x-0 opacity-100" : "w-0 -translate-x-3 opacity-0"}`}>
                <span className="block truncate text-sm font-semibold">{label}</span>
                <span className="mt-0.5 block truncate text-[11px] text-slate-500">{description}</span>
              </span>
            </button>
          );
        })}
      </nav>

      <div className="mt-5 border-t border-slate-200/70 pt-5">
        <div className={`flex items-center rounded-[22px] transition-all ${expanded ? "gap-3 bg-white p-3 shadow-sm ring-1 ring-slate-200/70" : "justify-center"}`}>
          <StaffAvatar user={appUser} alt={`${appUser?.fullName || "Platform owner"} profile`} className="size-10 shrink-0 ring-2 ring-white" />
          <div className={`min-w-0 flex-1 transition-[width,opacity] duration-300 ${expanded ? "w-full opacity-100" : "w-0 opacity-0"}`}>
            <p className="truncate text-sm font-semibold text-slate-900">{appUser?.fullName || "Platform owner"}</p>
            <p className="truncate text-[11px] text-slate-500">Developer access</p>
          </div>
          <button type="button" onClick={onSignOut} aria-label="Sign out" title="Sign out" className={`${expanded ? "flex" : "hidden"} size-10 shrink-0 cursor-pointer items-center justify-center rounded-xl text-slate-400 transition hover:bg-rose-50 hover:text-rose-600 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-rose-100`}>
            <LogOut className="size-4" aria-hidden="true" />
          </button>
        </div>
        <button type="button" onClick={onRefresh} disabled={loading} className={`mt-3 min-h-11 w-full cursor-pointer items-center rounded-2xl text-sm font-medium text-slate-500 transition hover:bg-slate-100 hover:text-slate-800 disabled:cursor-not-allowed disabled:opacity-50 ${expanded ? "flex gap-2 px-4" : "flex justify-center"}`}>
          <RefreshCw className={`size-4 ${loading ? "animate-spin" : ""}`} aria-hidden="true" />
          {expanded ? "Refresh data" : <span className="sr-only">Refresh data</span>}
        </button>
      </div>
    </aside>
  );
}

function OverviewSection({ data, loading }) {
  return <>
    <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{cards.map(([label, key, Icon]) => <Card key={key} className="relative overflow-hidden bg-white/85 shadow-[0_18px_50px_rgba(15,23,42,0.06)] ring-white/90"><CardContent className="relative"><div className="flex size-11 items-center justify-center rounded-2xl bg-sky-50 text-sky-700"><Icon className="size-5" /></div><p className="mt-7 text-4xl font-semibold tracking-[-0.04em] text-slate-950">{data?.adoption?.[key] ?? (loading ? "…" : "-")}</p><p className="mt-1 text-sm font-medium text-slate-500">{label}</p></CardContent></Card>)}</section>
    <section className="mt-5 grid gap-5 md:grid-cols-2">
      <Card className="bg-white/85 shadow-[0_18px_50px_rgba(15,23,42,0.05)]"><CardContent><h2 className="text-sm font-semibold text-slate-950">Usage</h2><dl className="mt-4 flex flex-col gap-2"><div className="flex items-center justify-between rounded-2xl bg-slate-50/90 px-4 py-3 text-sm"><dt className="text-slate-600">Activity events, last 24 hours</dt><dd className="font-semibold tabular-nums text-slate-950">{data?.usage?.activity24h ?? "-"}</dd></div><div className="flex items-center justify-between rounded-2xl bg-slate-50/90 px-4 py-3 text-sm"><dt className="text-slate-600">Active users, last 7 days</dt><dd className="font-semibold tabular-nums text-slate-950">{data?.usage?.activeUsers7d ?? "-"}</dd></div></dl></CardContent></Card>
      <Card className="bg-white/85 shadow-[0_18px_50px_rgba(15,23,42,0.05)]"><CardContent><h2 className="text-sm font-semibold text-slate-950">Support</h2><dl className="mt-4 flex flex-col gap-2"><div className="flex items-center justify-between rounded-2xl bg-slate-50/90 px-4 py-3 text-sm"><dt className="text-slate-600">Open reports</dt><dd className="font-semibold tabular-nums text-slate-950">{data?.support?.open ?? "-"}</dd></div><div className="flex items-center justify-between rounded-2xl bg-slate-50/90 px-4 py-3 text-sm"><dt className="text-slate-600">Email delivery pending</dt><dd className="font-semibold tabular-nums text-slate-950">{data?.support?.deliveryPending ?? "-"}</dd></div></dl></CardContent></Card>
    </section>
    {data?.generatedAt ? <p className="mt-8 text-xs text-slate-400">Updated {formatDate(data.generatedAt)}</p> : null}
  </>;
}

function AgenciesSection({ agencies, loading, onSelect }) {
  if (loading && !agencies.length) return <p className="text-sm text-slate-500">Loading agencies…</p>;
  if (!agencies.length) return <p className="text-sm text-slate-500">No customer agencies yet.</p>;
  return <div className="overflow-hidden rounded-3xl bg-white/90 shadow-[0_18px_60px_rgba(15,23,42,0.06)] ring-1 ring-slate-200/70"><div className="overflow-x-auto">
    <table className="min-w-full divide-y divide-slate-200 text-sm">
      <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
        <tr><th className="px-4 py-3">Agency</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">Staff</th><th className="px-4 py-3">Clients</th><th className="px-4 py-3">Active cases</th><th className="px-4 py-3">Open leads</th><th className="px-4 py-3">Created</th></tr>
      </thead>
      <tbody className="divide-y divide-slate-100">
        {agencies.map((agency) => <tr key={agency.id} tabIndex={0} role="button" className="cursor-pointer transition-colors hover:bg-sky-50/60 focus-visible:bg-sky-50 focus-visible:outline-none" onClick={() => onSelect(agency.id)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onSelect(agency.id); } }}>
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
  </div></div>;
}

function AgencyDetailPanel({ detail, onClose }) {
  if (!detail) return null;
  const { agency, staff, clients, activeCases, openLeads, recentActivity, openSupportTickets } = detail;
  return <div className="fixed inset-0 z-20 flex justify-end bg-slate-950/25 backdrop-blur-sm">
    <div className="m-2 h-[calc(100%-1rem)] w-full max-w-lg overflow-y-auto rounded-[28px] bg-white p-6 shadow-[-20px_20px_80px_rgba(15,23,42,0.18)] ring-1 ring-white/80">
      <div className="flex items-start justify-between"><div><h2 className="text-lg font-semibold">{agency.name}</h2><p className="text-xs text-slate-400">{agency.slug}</p></div><button type="button" onClick={onClose} aria-label="Close" className="flex size-10 items-center justify-center rounded-full bg-slate-100 text-slate-500 transition hover:bg-slate-200"><X className="size-4" /></button></div>
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
    <div className="mb-5 flex w-fit max-w-full gap-1 overflow-x-auto rounded-2xl bg-white/80 p-1.5 shadow-sm ring-1 ring-slate-200/70">
      <button type="button" onClick={() => onFilterChange("")} className={`min-h-9 shrink-0 cursor-pointer rounded-xl px-3 text-xs font-medium transition ${statusFilter === "" ? "bg-slate-950 text-white shadow-sm" : "text-slate-600 hover:bg-slate-100"}`}>All</button>
      {TICKET_STATUSES.map((status) => <button key={status} type="button" onClick={() => onFilterChange(status)} className={`min-h-9 shrink-0 cursor-pointer rounded-xl px-3 text-xs font-medium transition ${statusFilter === status ? "bg-slate-950 text-white shadow-sm" : "text-slate-600 hover:bg-slate-100"}`}>{status}</button>)}
    </div>
    {loading && !tickets.length ? <p className="text-sm text-slate-500">Loading support tickets…</p> : null}
    {!loading && !tickets.length ? <p className="text-sm text-slate-500">No support tickets found.</p> : null}
    <div className="divide-y divide-slate-100 overflow-hidden rounded-3xl bg-white/90 shadow-[0_18px_60px_rgba(15,23,42,0.06)] ring-1 ring-slate-200/70">
      {tickets.map((ticket) => <div key={ticket.id} className="p-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div><p className="text-sm font-semibold">{ticket.ticketNumber} · {ticket.agency?.name}</p><p className="text-xs text-slate-400">{ticket.reportedBy?.fullName} ({ticket.reportedBy?.email}) — {formatDate(ticket.createdAt)}</p></div>
          <select value={ticket.status} onChange={(event) => onStatusUpdate(ticket.id, event.target.value)} className="select-field min-h-9 py-1 text-xs">
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
  return <div className="divide-y divide-slate-100 overflow-hidden rounded-3xl bg-white/90 shadow-[0_18px_60px_rgba(15,23,42,0.06)] ring-1 ring-slate-200/70">
    {activity.map((entry) => <div key={entry.id} className="flex items-start justify-between gap-4 p-4 text-sm transition-colors hover:bg-slate-50/70">
      <div><span className="font-medium">{entry.agency?.name}</span> — <span className="text-slate-600">{entry.user?.fullName || "System"}</span><div className="text-slate-500">{entry.action}</div></div>
      <span className="whitespace-nowrap text-xs text-slate-400">{formatDate(entry.createdAt)}</span>
    </div>)}
  </div>;
}

const SUBSCRIPTION_STATUSES = ["trialing", "active", "past_due", "grace_period", "suspended", "cancelled", "read_only"];
const BILLING_INTERVALS = ["monthly", "annual", "custom"];
const BILLING_PROVIDERS = ["quickbooks", "manual"];

function titleCase(value) {
  return String(value || "").replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function SubscriptionsSection({ catalog, busy, onPlanSave }) {
  return <CommercialPlanManager catalog={catalog} busy={busy} onSave={onPlanSave} />;
}

function CustomerWorkspacesSection({
  workspaces,
  catalog,
  detail,
  loading,
  busy,
  reason,
  startsAt,
  expiresAt,
  onReasonChange,
  onStartsAtChange,
  onExpiresAtChange,
  onSelect,
  onSubscriptionSave,
  onFeatureChange,
}) {
  const subscription = detail?.entitlements?.subscription;
  const [draft, setDraft] = useState({
    planId: "",
    status: "active",
    billingInterval: "monthly",
    billingProvider: "quickbooks",
    currency: "CAD",
    negotiatedAmount: "",
  });

  useEffect(() => {
    const defaultPlan = catalog?.plans?.find((plan) => plan.isActive);
    setDraft({
      planId: subscription?.plan?.id || defaultPlan?.id || "",
      status: subscription?.status || (defaultPlan?.trialDays > 0 ? "trialing" : "active"),
      billingInterval: subscription?.billingInterval || "monthly",
      billingProvider: subscription?.billingProvider || (defaultPlan?.trialDays > 0 ? "manual" : "quickbooks"),
      currency: subscription?.currency || "CAD",
      negotiatedAmount: subscription?.negotiatedAmount ?? "",
    });
  }, [catalog?.plans, detail?.agency?.id, subscription]);

  const overridesByKey = useMemo(
    () => new Map((detail?.overrides || []).map((item) => [item.feature.key, item])),
    [detail?.overrides],
  );
  const modules = useMemo(() => {
    const grouped = new Map();
    for (const feature of detail?.entitlements?.catalog?.features || []) {
      const key = feature.module.key;
      if (!grouped.has(key)) grouped.set(key, { ...feature.module, features: [] });
      grouped.get(key).features.push(feature);
    }
    return [...grouped.values()];
  }, [detail?.entitlements?.catalog?.features]);
  const reasonReady = reason.trim().length >= 3;

  return (
    <div>
      <div className="grid min-h-[620px] gap-5 xl:grid-cols-[300px_minmax(0,1fr)]">
      <aside className="h-fit overflow-hidden rounded-3xl bg-white/90 shadow-[0_18px_60px_rgba(15,23,42,0.06)] ring-1 ring-slate-200/70 xl:sticky xl:top-6">
        <div className="border-b border-slate-200 p-4">
          <h2 className="text-sm font-semibold text-slate-950">Customer workspaces</h2>
          <p className="mt-1 text-xs leading-5 text-slate-500">Choose an agency to control its commercial access.</p>
        </div>
        <div className="max-h-[720px] overflow-y-auto p-2">
          {workspaces.map((workspace) => {
            const selected = detail?.agency?.id === workspace.id;
            return (
              <button
                key={workspace.id}
                type="button"
                onClick={() => onSelect(workspace.id)}
                className={`mb-1 flex min-h-14 w-full cursor-pointer items-center justify-between gap-3 rounded-2xl px-3 py-2 text-left transition focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-sky-100 ${selected ? "bg-sky-100/80 text-sky-950" : "text-slate-700 hover:bg-slate-50"}`}
              >
                <span className="min-w-0">
                  <span className="block truncate text-sm font-semibold">{workspace.name}</span>
                  <span className="block text-xs text-slate-500">{workspace.commercialSubscription?.plan?.name || "Not configured"} · {workspace.staffSeats} seats</span>
                </span>
                {workspace.commercialSubscription?.status === "active" ? <Check className="h-4 w-4 shrink-0 text-emerald-600" aria-label="Active subscription" /> : <LockKeyhole className="h-4 w-4 shrink-0 text-amber-600" aria-label="Subscription needs attention" />}
              </button>
            );
          })}
          {!loading && !workspaces.length ? <p className="p-3 text-sm text-slate-500">No customer workspaces found.</p> : null}
        </div>
      </aside>

      <section className="min-w-0">
        {!detail ? <div className="flex min-h-80 items-center justify-center rounded-3xl bg-white/90 text-sm text-slate-500 shadow-sm ring-1 ring-slate-200/70">{loading ? "Loading subscriptions…" : "Select a workspace."}</div> : (
          <div className="flex flex-col gap-5">
            <header className="flex flex-wrap items-start justify-between gap-4 rounded-3xl bg-white/90 p-6 shadow-[0_18px_60px_rgba(15,23,42,0.06)] ring-1 ring-slate-200/70">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-sky-700">Workspace subscription</p>
                <h2 className="mt-1 text-xl font-semibold text-slate-950">{detail.agency.name}</h2>
                <p className="mt-1 text-sm text-slate-500">{detail.staffSeats} active staff seat{detail.staffSeats === 1 ? "" : "s"} · {subscription?.plan?.name || "No plan"}</p>
                {subscription?.status === "trialing" && subscription.trialEndsAt ? <p className="mt-1 text-xs font-semibold text-amber-700">Trial ends {new Date(subscription.trialEndsAt).toLocaleDateString()}</p> : null}
              </div>
              <Badge variant={detail.entitlements.accessMode === "full" ? "secondary" : "outline"} className={detail.entitlements.accessMode === "full" ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-800"}>
                {titleCase(detail.entitlements.accessMode)}
              </Badge>
            </header>

            <form
              className="rounded-3xl bg-white/90 p-6 shadow-[0_18px_60px_rgba(15,23,42,0.05)] ring-1 ring-slate-200/70"
              onSubmit={(event) => {
                event.preventDefault();
                onSubscriptionSave(draft);
              }}
            >
              <div className="flex flex-wrap items-end gap-3">
                <label className="min-w-48 flex-1 text-xs font-semibold text-slate-600">Plan
                  <select value={draft.planId} onChange={(event) => {
                    const planId = event.target.value;
                    const selectedPlan = (catalog?.plans || []).find((plan) => plan.id === planId);
                    setDraft((current) => ({
                      ...current,
                      planId,
                      status: selectedPlan?.trialDays > 0 ? "trialing" : current.status === "trialing" ? "active" : current.status,
                      billingProvider: selectedPlan?.trialDays > 0 ? "manual" : current.billingProvider,
                    }));
                  }} className="select-field mt-1 min-h-11 w-full">
                    {(catalog?.plans || []).filter((plan) => plan.isActive).map((plan) => <option key={plan.id} value={plan.id}>{plan.name}</option>)}
                  </select>
                </label>
                <label className="min-w-40 flex-1 text-xs font-semibold text-slate-600">Status
                  <select value={draft.status} onChange={(event) => setDraft((current) => ({ ...current, status: event.target.value }))} className="select-field mt-1 min-h-11 w-full">
                    {SUBSCRIPTION_STATUSES.map((status) => <option key={status} value={status}>{titleCase(status)}</option>)}
                  </select>
                </label>
                <label className="min-w-36 flex-1 text-xs font-semibold text-slate-600">Billing cycle
                  <select value={draft.billingInterval} onChange={(event) => setDraft((current) => ({ ...current, billingInterval: event.target.value }))} className="select-field mt-1 min-h-11 w-full">
                    {BILLING_INTERVALS.map((interval) => <option key={interval} value={interval}>{titleCase(interval)}</option>)}
                  </select>
                </label>
                <label className="min-w-36 flex-1 text-xs font-semibold text-slate-600">Provider
                  <select value={draft.billingProvider} onChange={(event) => setDraft((current) => ({ ...current, billingProvider: event.target.value }))} className="select-field mt-1 min-h-11 w-full">
                    {BILLING_PROVIDERS.map((provider) => <option key={provider} value={provider}>{titleCase(provider)}</option>)}
                  </select>
                </label>
                <button type="submit" disabled={busy || !reasonReady || !draft.planId} className="min-h-11 cursor-pointer rounded-2xl bg-slate-950 px-5 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-800 active:translate-y-px disabled:cursor-not-allowed disabled:opacity-40">
                  {busy ? "Saving…" : "Save subscription"}
                </button>
              </div>
            </form>

            <section className="rounded-3xl bg-white/90 p-6 shadow-[0_18px_60px_rgba(15,23,42,0.05)] ring-1 ring-slate-200/70">
              <h3 className="text-sm font-semibold text-slate-950">Change controls</h3>
              <p className="mt-1 text-xs leading-5 text-slate-500">A reason is required for every subscription or feature change. Dates apply to new feature overrides.</p>
              <div className="mt-4 grid gap-3 md:grid-cols-3">
                <label className="text-xs font-semibold text-slate-600 md:col-span-1">Change reason
                  <input value={reason} onChange={(event) => onReasonChange(event.target.value)} maxLength={500} placeholder="Customer agreement or promotion" className="mt-1 min-h-11 w-full rounded-2xl border border-slate-200 bg-slate-50/70 px-3 text-sm font-normal text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-sky-400 focus:bg-white focus:ring-4 focus:ring-sky-100" />
                </label>
                <label className="text-xs font-semibold text-slate-600">Starts
                  <input type="date" value={startsAt} onChange={(event) => onStartsAtChange(event.target.value)} className="mt-1 min-h-11 w-full rounded-2xl border border-slate-200 bg-slate-50/70 px-3 text-sm font-normal text-slate-900 outline-none transition focus:border-sky-400 focus:bg-white focus:ring-4 focus:ring-sky-100" />
                </label>
                <label className="text-xs font-semibold text-slate-600">Expires
                  <input type="date" value={expiresAt} onChange={(event) => onExpiresAtChange(event.target.value)} className="mt-1 min-h-11 w-full rounded-2xl border border-slate-200 bg-slate-50/70 px-3 text-sm font-normal text-slate-900 outline-none transition focus:border-sky-400 focus:bg-white focus:ring-4 focus:ring-sky-100" />
                </label>
              </div>
            </section>

            <section className="flex flex-col gap-4">
              {modules.map((module) => (
                <article key={module.key} className="overflow-hidden rounded-3xl bg-white/90 shadow-[0_18px_60px_rgba(15,23,42,0.05)] ring-1 ring-slate-200/70">
                  <div className="border-b border-slate-200 px-5 py-3">
                    <h3 className="text-sm font-semibold text-slate-950">{module.name}</h3>
                  </div>
                  <div className="divide-y divide-slate-100">
                    {module.features.map((feature) => {
                      const enabled = detail.entitlements.features[feature.key] === true;
                      const override = overridesByKey.get(feature.key);
                      return (
                        <div key={feature.key} className="flex flex-wrap items-center gap-3 px-5 py-3">
                          <div className="min-w-52 flex-1">
                            <p className="text-sm font-medium text-slate-900">{feature.name}</p>
                            <p className="mt-0.5 text-xs text-slate-500">{override ? `Override · ${override.reason}` : `From ${subscription?.plan?.name || "no plan"}`}</p>
                          </div>
                          <span className={`min-w-20 text-xs font-semibold ${enabled ? "text-emerald-700" : "text-slate-500"}`}>{enabled ? "Enabled" : "Disabled"}</span>
                          {override ? (
                            <button type="button" disabled={busy || !reasonReady} onClick={() => onFeatureChange(feature.key, null)} className="min-h-10 cursor-pointer rounded-xl border border-slate-200 px-3 text-xs font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40">Use plan</button>
                          ) : null}
                          <button type="button" aria-pressed={enabled} disabled={busy || !reasonReady} onClick={() => onFeatureChange(feature.key, !enabled)} className={`min-h-10 min-w-24 cursor-pointer rounded-xl border px-3 text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-40 ${enabled ? "border-rose-200 text-rose-700 hover:bg-rose-50" : "border-emerald-200 text-emerald-700 hover:bg-emerald-50"}`}>
                            {enabled ? "Disable" : "Enable"}
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </article>
              ))}
            </section>
          </div>
        )}
      </section>
      </div>
    </div>
  );
}

function FeatureFlagsSection({ flags, loading, onToggle }) {
  if (loading && !flags.length) return <p className="text-sm text-slate-500">Loading feature flags…</p>;
  return <div className="divide-y divide-slate-100 overflow-hidden rounded-3xl bg-white/90 shadow-[0_18px_60px_rgba(15,23,42,0.06)] ring-1 ring-slate-200/70">
    {flags.map((flag) => <div key={flag.key} className="flex items-start justify-between gap-4 p-4">
      <div><p className="text-sm font-semibold">{flag.label}</p><p className="mt-1 text-sm text-slate-500">{flag.description}</p><p className="mt-1 text-xs text-slate-400">{flag.updatedAt ? `Last changed ${formatDate(flag.updatedAt)}${flag.updatedByName ? ` by ${flag.updatedByName}` : ""}` : "Using default value — never changed."}</p></div>
      <button
        type="button"
        onClick={() => onToggle(flag.key, !flag.enabled)}
        className={`min-h-10 shrink-0 cursor-pointer rounded-xl px-3 text-xs font-semibold transition ${flag.enabled ? "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200" : "bg-slate-100 text-slate-600 ring-1 ring-slate-200"}`}
      >
        {flag.enabled ? "Enabled" : "Disabled"}
      </button>
    </div>)}
  </div>;
}

export default function DeveloperDashboard() {
  const { appUser, signOut } = useAuth();
  const navigate = useNavigate();
  const { section: sectionParam } = useParams();
  const section = SECTION_KEYS.has(sectionParam) ? sectionParam : "overview";
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const [overview, setOverview] = useState(null);
  const [agencies, setAgencies] = useState([]);
  const [agencyDetail, setAgencyDetail] = useState(null);
  const [tickets, setTickets] = useState([]);
  const [ticketStatusFilter, setTicketStatusFilter] = useState("");
  const [activity, setActivity] = useState([]);
  const [flags, setFlags] = useState([]);
  const [commercialWorkspaces, setCommercialWorkspaces] = useState([]);
  const [commercialCatalog, setCommercialCatalog] = useState(null);
  const [commercialDetail, setCommercialDetail] = useState(null);
  const [commercialReason, setCommercialReason] = useState("");
  const [commercialStartsAt, setCommercialStartsAt] = useState("");
  const [commercialExpiresAt, setCommercialExpiresAt] = useState("");
  const [commercialBusy, setCommercialBusy] = useState(false);
  const commercialWorkspaceIdRef = useRef(null);

  const selectSection = useCallback((key) => {
    if (!SECTION_KEYS.has(key)) return;
    navigate(`/developer/${key}`);
  }, [navigate]);

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
      } else if (key === "subscriptions") {
        const response = await api.getFresh("/developer/commercial/catalog");
        setCommercialCatalog(response.data.data);
      } else if (key === "workspaces") {
        const [workspacesResponse, catalogResponse] = await Promise.all([
          api.getFresh("/developer/commercial/workspaces"),
          api.getFresh("/developer/commercial/catalog"),
        ]);
        const nextWorkspaces = workspacesResponse.data.data;
        setCommercialWorkspaces(nextWorkspaces);
        setCommercialCatalog(catalogResponse.data.data);
        const selectedId = commercialWorkspaceIdRef.current || nextWorkspaces[0]?.id;
        if (selectedId) {
          const detailResponse = await api.getFresh(`/developer/commercial/workspaces/${selectedId}`);
          commercialWorkspaceIdRef.current = selectedId;
          setCommercialDetail(detailResponse.data.data);
        } else {
          commercialWorkspaceIdRef.current = null;
          setCommercialDetail(null);
        }
      }
    } catch (reason) {
      if (isCanceledRequest(reason)) return;
      setError(reason.response?.data?.message || "That data could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, [ticketStatusFilter]);

  useEffect(() => {
    if (sectionParam !== section) navigate(`/developer/${section}`, { replace: true });
  }, [navigate, section, sectionParam]);

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

  async function openCommercialWorkspace(id) {
    commercialWorkspaceIdRef.current = id;
    setLoading(true);
    setError("");
    try {
      const response = await api.getFresh(`/developer/commercial/workspaces/${id}`);
      setCommercialDetail(response.data.data);
    } catch (reason) {
      if (isCanceledRequest(reason)) return;
      setError(reason.response?.data?.message || "That workspace subscription could not be loaded.");
    } finally {
      setLoading(false);
    }
  }

  async function refreshCommercialWorkspace(agencyId) {
    commercialWorkspaceIdRef.current = agencyId;
    const [workspacesResponse, detailResponse] = await Promise.all([
      api.getFresh("/developer/commercial/workspaces"),
      api.getFresh(`/developer/commercial/workspaces/${agencyId}`),
    ]);
    setCommercialWorkspaces(workspacesResponse.data.data);
    setCommercialDetail(detailResponse.data.data);
  }

  async function saveCommercialSubscription(values) {
    if (!commercialDetail?.agency?.id || commercialBusy) return;
    setCommercialBusy(true);
    setError("");
    try {
      await api.put(
        `/developer/commercial/workspaces/${commercialDetail.agency.id}/subscription`,
        { ...values, reason: commercialReason.trim() },
      );
      await refreshCommercialWorkspace(commercialDetail.agency.id);
      setCommercialReason("");
    } catch (reason) {
      setError(reason.response?.data?.message || "The subscription could not be saved.");
    } finally {
      setCommercialBusy(false);
    }
  }

  async function changeCommercialFeature(featureKey, enabled) {
    if (!commercialDetail?.agency?.id || commercialBusy) return;
    setCommercialBusy(true);
    setError("");
    const path = `/developer/commercial/workspaces/${commercialDetail.agency.id}/features/${encodeURIComponent(featureKey)}`;
    const payload = {
      reason: commercialReason.trim(),
      startsAt: commercialStartsAt || null,
      expiresAt: commercialExpiresAt || null,
    };
    try {
      if (enabled === null) await api.delete(path, { data: payload });
      else await api.put(path, { ...payload, enabled });
      await refreshCommercialWorkspace(commercialDetail.agency.id);
      setCommercialReason("");
    } catch (reason) {
      setError(reason.response?.data?.message || "The feature override could not be saved.");
    } finally {
      setCommercialBusy(false);
    }
  }

  async function saveCommercialPlan(planId, values) {
    if (commercialBusy) return { ok: false, message: "Another commercial change is still being saved." };
    setCommercialBusy(true);
    setError("");
    try {
      if (planId) await api.put(`/developer/commercial/plans/${planId}`, values);
      else await api.post("/developer/commercial/plans", values);
      const catalogResponse = await api.getFresh("/developer/commercial/catalog");
      setCommercialCatalog(catalogResponse.data.data);
      return { ok: true };
    } catch (reason) {
      const message = reason.response?.data?.message || "The subscription plan could not be saved. Review the fields and try again.";
      setError(message);
      return { ok: false, message };
    } finally {
      setCommercialBusy(false);
    }
  }

  const activeSection = SECTIONS.find((item) => item.key === section) || SECTIONS[0];

  return <div className="flex h-screen overflow-hidden bg-[radial-gradient(circle_at_top_right,rgba(186,230,253,0.35),transparent_30%),linear-gradient(180deg,#f8fafc_0%,#eff4f9_100%)] text-slate-950">
    <PlatformSidebar section={section} onSelect={selectSection} loading={loading} onRefresh={() => loadSection(section)} onSignOut={signOut} appUser={appUser} />

    <main className="min-w-0 flex-1 overflow-y-auto">
      <header className="sticky top-0 z-10 border-b border-white/80 bg-white/75 px-4 py-3 backdrop-blur-2xl lg:hidden">
        <div className="flex items-center gap-3">
          <div className="flex size-11 items-center justify-center overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200"><img src={logo} alt="CaseDesk" className="size-full object-cover" /></div>
          <div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold tracking-tight">CaseDesk Platform Admin</p><p className="truncate text-xs text-slate-500">{activeSection.label}</p></div>
          <Button variant="ghost" size="icon-lg" onClick={() => loadSection(section)} disabled={loading} aria-label="Refresh data"><RefreshCw data-icon className={loading ? "animate-spin" : undefined} /></Button>
          <Button variant="ghost" size="icon-lg" onClick={signOut} aria-label="Sign out"><LogOut data-icon /></Button>
        </div>
        <nav className="scrollbar-hidden mt-3 flex gap-1 overflow-x-auto" aria-label="Platform administration">
          {SECTIONS.map(({ key, label, icon: Icon }) => <button key={key} type="button" onClick={() => selectSection(key)} aria-current={section === key ? "page" : undefined} className={`flex min-h-11 shrink-0 cursor-pointer items-center gap-2 rounded-2xl px-3 text-xs font-semibold transition ${section === key ? "bg-slate-950 text-white shadow-sm" : "text-slate-500 hover:bg-slate-100"}`}><Icon className="size-4" aria-hidden="true" />{label}</button>)}
        </nav>
      </header>

      <div className="w-full px-[clamp(1rem,3vw,4rem)] py-6 lg:py-10">
        <div className="mb-7 flex flex-wrap items-end justify-between gap-4">
          <div className="flex items-end gap-4">
            {activeSection.folio ? <span aria-hidden="true" className="hidden border-r border-sky-200 pr-4 text-5xl font-semibold leading-none tracking-[-0.08em] text-sky-200 sm:block">{activeSection.folio}</span> : null}
            <div>
              <p className="text-sm font-medium text-sky-700">Operations, subscriptions, and commercial access</p>
              <h1 className="mt-1 text-3xl font-semibold tracking-[-0.04em] text-slate-950 sm:text-4xl">{activeSection.label}</h1>
              <p className="mt-2 text-sm text-slate-500">{activeSection.description}</p>
            </div>
          </div>
          <Button variant="outline" size="lg" onClick={() => loadSection(section)} disabled={loading} className="hidden bg-white/80 shadow-sm lg:inline-flex">
            <RefreshCw data-icon="inline-start" className={loading ? "animate-spin" : undefined} />
            Refresh
          </Button>
        </div>

      {error ? <div role="alert" className="mb-6 flex items-center gap-2 rounded-2xl border border-rose-200 bg-rose-50/90 p-4 text-sm text-rose-700 shadow-sm"><CircleAlert className="size-4 shrink-0" />{error}</div> : null}
      {section === "overview" ? <OverviewSection data={overview} loading={loading} /> : null}
      {section === "agencies" ? <AgenciesSection agencies={agencies} loading={loading} onSelect={openAgency} /> : null}
      {section === "support" ? <SupportTicketsSection tickets={tickets} loading={loading} statusFilter={ticketStatusFilter} onFilterChange={changeTicketFilter} onStatusUpdate={updateTicketStatus} /> : null}
      {section === "activity" ? <ActivitySection activity={activity} loading={loading} /> : null}
      {section === "flags" ? <FeatureFlagsSection flags={flags} loading={loading} onToggle={toggleFlag} /> : null}
      {section === "subscriptions" ? <SubscriptionsSection
        catalog={commercialCatalog}
        busy={commercialBusy}
        onPlanSave={saveCommercialPlan}
      /> : null}
      {section === "workspaces" ? <CustomerWorkspacesSection
        workspaces={commercialWorkspaces}
        catalog={commercialCatalog}
        detail={commercialDetail}
        loading={loading}
        busy={commercialBusy}
        reason={commercialReason}
        startsAt={commercialStartsAt}
        expiresAt={commercialExpiresAt}
        onReasonChange={setCommercialReason}
        onStartsAtChange={setCommercialStartsAt}
        onExpiresAtChange={setCommercialExpiresAt}
        onSelect={openCommercialWorkspace}
        onSubscriptionSave={saveCommercialSubscription}
        onFeatureChange={changeCommercialFeature}
      /> : null}
      </div>
      <AgencyDetailPanel detail={agencyDetail} onClose={() => setAgencyDetail(null)} />
    </main>
  </div>;
}
