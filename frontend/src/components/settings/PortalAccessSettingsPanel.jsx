import {
  Check,
  ChevronRight,
  Eye,
  FolderLock,
  Loader2,
  Save,
  Search,
  ShieldCheck,
  UserRound,
  Users,
} from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { useCallback, useEffect, useMemo, useState } from "react";
import api from "../../services/api";

const pageOptions = [
  ["dashboard", "Dashboard", "Work summary and upcoming priorities"],
  ["leads", "Leads", "Lead pipeline and inquiry records"],
  ["leadIntake", "Lead intake settings", "Intake forms and incoming lead tools inside Settings"],
  ["clients", "Clients", "Client list and profile pages"],
  ["cases", "Cases", "Case list and case workspaces"],
  ["followUps", "Follow-ups", "Tasks and follow-up queue"],
  ["calendar", "Calendar", "Appointments and scheduling"],
  ["documents", "Documents", "Agency-wide document workspace"],
  ["payments", "Payments", "Agency-wide billing and transaction report"],
  ["workload", "Workload", "Team capacity and assignments"],
  ["caseEasyImport", "Case Easy Import", "Import and review migrated records"],
  ["incentives", "Incentives", "Earnings, incentive ledger, and pipeline"],
];

const caseTabOptions = [
  ["profile", "Profile"],
  ["reminders", "Reminders"],
  ["questionnaires", "Questionnaires"],
  ["documents", "Documents"],
  ["forms", "Forms"],
  ["tasks", "Tasks"],
  ["agreementsLetters", "Agreements & Letters"],
  ["appointments", "Appointments"],
  ["communication", "Communication"],
  ["billing", "Billing"],
];

const dataOptions = [
  ["leads", "Lead records", "Controls which inquiries appear"],
  [
    "clients",
    "Client access",
    "Assigned includes direct profile assignments and clients connected to an assigned case",
  ],
  ["cases", "Case records", "Controls which case files appear"],
];

const capabilityOptions = [
  ["internalNotes", "Internal notes", "View and add private staff notes"],
  [
    "financialData",
    "Financial information",
    "View client billing, invoices, and payment totals",
  ],
  [
    "manageClientPortal",
    "Client portal invitations",
    "Create and manage client portal access",
  ],
];

const clone = (value) => JSON.parse(JSON.stringify(value));
const initials = (name) =>
  String(name || "TM")
    .split(/\s+/)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

function Switch({ checked, onChange, label }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={`relative h-7 w-12 shrink-0 rounded-full p-0.5 transition ${checked ? "bg-slate-950" : "bg-slate-200"}`}
    >
      <motion.span
        layout
        transition={{ type: "spring", stiffness: 560, damping: 36 }}
        className={`block h-6 w-6 rounded-full bg-white shadow-sm ${checked ? "ml-5" : "ml-0"}`}
      />
    </button>
  );
}

function Section({ icon: Icon, title, detail, children }) {
  return (
    <section className="overflow-hidden rounded-[1.6rem] border border-slate-200/80 bg-white shadow-[0_12px_35px_rgba(15,23,42,0.05)]">
      <div className="flex items-start gap-3 border-b border-slate-100 px-5 py-4">
        <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-slate-100 text-slate-600">
          <Icon className="h-4.5 w-4.5" />
        </span>
        <div>
          <h3 className="text-sm font-semibold text-slate-950">{title}</h3>
          <p className="mt-1 text-xs leading-5 text-slate-500">{detail}</p>
        </div>
      </div>
      {children}
    </section>
  );
}

export default function PortalAccessSettingsPanel() {
  const [members, setMembers] = useState([]);
  const [selectedId, setSelectedId] = useState("");
  const [draft, setDraft] = useState(null);
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const response = await api.get("/admin/portal-access");
      const next = response.data.data || [];
      setMembers(next);
      setSelectedId((current) =>
        next.some((item) => item.id === current) ? current : next[0]?.id || "",
      );
      setError("");
    } catch (requestError) {
      setError(
        requestError.response?.data?.message ||
          "Team access could not be loaded.",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);
  const selected = members.find((item) => item.id === selectedId) || null;
  useEffect(() => {
    const member = members.find((item) => item.id === selectedId);
    setDraft(member ? clone(member.portalAccess) : null);
    setNotice("");
  }, [selectedId]);

  const filtered = useMemo(
    () =>
      members.filter((item) => {
        if (filter !== "all" && item.role !== filter) return false;
        const query = search.trim().toLowerCase();
        return (
          !query ||
          `${item.fullName} ${item.email} ${item.jobTitle || ""}`
            .toLowerCase()
            .includes(query)
        );
      }),
    [filter, members, search],
  );

  const dirty = Boolean(
    selected &&
    draft &&
    JSON.stringify(selected.portalAccess) !== JSON.stringify(draft),
  );
  const setBoolean = (group, key, value) =>
    setDraft((current) => ({
      ...current,
      [group]: { ...current[group], [key]: value },
    }));
  const setData = (key, value) =>
    setDraft((current) => ({
      ...current,
      data: { ...current.data, [key]: value },
    }));

  async function save() {
    if (!selected || !draft || !dirty) return;
    try {
      setSaving(true);
      setError("");
      setNotice("");
      const response = await api.put(
        `/admin/team-members/${selected.id}/portal-access`,
        { portalAccess: draft },
      );
      const saved = response.data.data.portalAccess;
      setMembers((current) =>
        current.map((item) =>
          item.id === selected.id ? { ...item, portalAccess: saved } : item,
        ),
      );
      setDraft(clone(saved));
      setNotice(response.data.message || "Access saved.");
    } catch (requestError) {
      setError(
        requestError.response?.data?.message || "Access could not be saved.",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-indigo-50 text-indigo-600">
            <ShieldCheck className="h-5 w-5" />
          </span>
          <div>
            <h2 className="text-2xl font-semibold tracking-tight text-slate-950">
              Portal Access
            </h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500">
              Choose exactly which workspace areas, case tabs, and client
              information each consultant or front-desk member can access.
            </p>
          </div>
        </div>
        {dirty ? (
          <button
            type="button"
            disabled={saving}
            onClick={save}
            className="inline-flex h-11 items-center gap-2 rounded-full bg-slate-950 px-5 text-sm font-semibold text-white shadow-[0_12px_28px_rgba(15,23,42,0.18)] disabled:opacity-50"
          >
            {saving ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Save className="h-4 w-4" />
            )}
            Save access
          </button>
        ) : null}
      </div>
      {notice ? (
        <p className="rounded-2xl bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-700">
          <Check className="mr-2 inline h-4 w-4" />
          {notice}
        </p>
      ) : null}
      {error ? (
        <p className="rounded-2xl bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {error}
        </p>
      ) : null}
      <div className="grid min-h-[650px] overflow-hidden rounded-[2rem] border border-slate-200/80 bg-slate-50/70 shadow-[0_20px_60px_rgba(15,23,42,0.07)] lg:grid-cols-[300px_minmax(0,1fr)]">
        <aside className="border-b border-slate-200/80 bg-white/80 p-4 lg:border-b-0 lg:border-r">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Find team member"
              className="h-11 w-full rounded-2xl border border-slate-200 bg-slate-50 pl-10 pr-3 text-sm outline-none focus:border-sky-300"
            />
          </div>
          <div className="mt-3 grid grid-cols-3 rounded-xl bg-slate-100 p-1">
            {[
              ["all", "All"],
              ["consultant", "Consultants"],
              ["frontdesk", "Front desk"],
            ].map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => setFilter(id)}
                className={`rounded-lg px-2 py-2 text-[11px] font-semibold transition ${filter === id ? "bg-white text-slate-950 shadow-sm" : "text-slate-500"}`}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="scrollbar-hidden mt-4 max-h-[540px] space-y-1 overflow-y-auto">
            {loading ? (
              <div className="flex justify-center py-16">
                <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
              </div>
            ) : (
              filtered.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setSelectedId(item.id)}
                  className={`flex w-full items-center gap-3 rounded-2xl p-3 text-left transition ${selectedId === item.id ? "bg-slate-950 text-white shadow-lg" : "hover:bg-slate-100"}`}
                >
                  <span
                    className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-xs font-bold ${selectedId === item.id ? "bg-white/15 text-white" : "bg-slate-200 text-slate-600"}`}
                  >
                    {initials(item.fullName)}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold">
                      {item.fullName}
                    </span>
                    <span
                      className={`mt-0.5 block truncate text-xs capitalize ${selectedId === item.id ? "text-slate-300" : "text-slate-400"}`}
                    >
                      {item.role} · {item.status}
                    </span>
                  </span>
                  <ChevronRight className="h-4 w-4 shrink-0 opacity-50" />
                </button>
              ))
            )}
          </div>
        </aside>
        <main className="scrollbar-hidden min-w-0 overflow-y-auto p-4 sm:p-6">
          <AnimatePresence mode="wait">
            {selected && draft ? (
              <motion.div
                key={selected.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                className="space-y-5"
              >
                <div className="flex items-center gap-3 rounded-[1.5rem] border border-white bg-white/90 p-4 shadow-sm">
                  <span className="flex h-12 w-12 items-center justify-center rounded-full bg-indigo-100 text-sm font-bold text-indigo-700">
                    {initials(selected.fullName)}
                  </span>
                  <div className="min-w-0">
                    <h3 className="truncate text-base font-semibold text-slate-950">
                      {selected.fullName}
                    </h3>
                    <p className="mt-1 truncate text-xs text-slate-500">
                      {selected.email} ·{" "}
                      <span className="capitalize">{selected.role}</span>
                    </p>
                  </div>
                  <span
                    className={`ml-auto rounded-full px-2.5 py-1 text-[10px] font-semibold ${selected.isActive ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"}`}
                  >
                    {selected.isActive ? "Active" : "Inactive"}
                  </span>
                </div>
                <Section
                  icon={Eye}
                  title="Workspace pages"
                  detail="These controls change both the sidebar and direct page access."
                >
                  <div className="divide-y divide-slate-100">
                    {pageOptions.map(([key, label, detail]) => (
                      <div
                        key={key}
                        className="flex items-center justify-between gap-4 px-5 py-3.5"
                      >
                        <div>
                          <p className="text-sm font-semibold text-slate-800">
                            {label}
                          </p>
                          <p className="mt-0.5 text-xs text-slate-400">
                            {detail}
                          </p>
                        </div>
                        <Switch
                          label={label}
                          checked={draft.pages[key] === true}
                          onChange={(value) => setBoolean("pages", key, value)}
                        />
                      </div>
                    ))}
                  </div>
                </Section>
                <Section
                  icon={FolderLock}
                  title="Case workspace tabs"
                  detail="Only selected tabs appear after the team member opens an allowed case."
                >
                  <div className="grid gap-2 p-4 sm:grid-cols-2">
                    {caseTabOptions.map(([key, label]) => (
                      <button
                        key={key}
                        type="button"
                        onClick={() =>
                          setBoolean("caseTabs", key, !draft.caseTabs[key])
                        }
                        className={`flex items-center justify-between rounded-2xl border px-4 py-3 text-left text-sm font-semibold transition ${draft.caseTabs[key] ? "border-sky-200 bg-sky-50 text-sky-800" : "border-slate-200 bg-white text-slate-500"}`}
                      >
                        <span>{label}</span>
                        <span
                          className={`flex h-5 w-5 items-center justify-center rounded-full ${draft.caseTabs[key] ? "bg-sky-600 text-white" : "bg-slate-100"}`}
                        >
                          {draft.caseTabs[key] ? (
                            <Check className="h-3 w-3" />
                          ) : null}
                        </span>
                      </button>
                    ))}
                  </div>
                </Section>
                <Section
                  icon={Users}
                  title="Client and record access"
                  detail="Assigned clients are inherited from case access or an intentional direct profile assignment. A client without either stays private to administrators."
                >
                  <div className="divide-y divide-slate-100">
                    {dataOptions.map(([key, label, detail]) => (
                      <div
                        key={key}
                        className="px-5 py-4 sm:flex sm:items-center sm:justify-between sm:gap-4"
                      >
                        <div>
                          <p className="text-sm font-semibold text-slate-800">
                            {label}
                          </p>
                          <p className="mt-0.5 text-xs text-slate-400">
                            {detail}
                          </p>
                        </div>
                        <div className="mt-3 grid grid-cols-3 rounded-xl bg-slate-100 p-1 sm:mt-0">
                          {[
                            ["none", "None"],
                            ["assigned", "Assigned"],
                            ["all", "All"],
                          ].map(([value, labelText]) => (
                            <button
                              key={value}
                              type="button"
                              onClick={() => setData(key, value)}
                              className={`rounded-lg px-3 py-2 text-[11px] font-semibold transition ${draft.data[key] === value ? "bg-white text-slate-950 shadow-sm" : "text-slate-500"}`}
                            >
                              {labelText}
                            </button>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </Section>
                <Section
                  icon={UserRound}
                  title="Sensitive access"
                  detail="Extra controls for private or higher-risk information."
                >
                  <div className="divide-y divide-slate-100">
                    {capabilityOptions.map(([key, label, detail]) => (
                      <div
                        key={key}
                        className="flex items-center justify-between gap-4 px-5 py-3.5"
                      >
                        <div>
                          <p className="text-sm font-semibold text-slate-800">
                            {label}
                          </p>
                          <p className="mt-0.5 text-xs text-slate-400">
                            {detail}
                          </p>
                        </div>
                        <Switch
                          label={label}
                          checked={draft.capabilities[key] === true}
                          onChange={(value) =>
                            setBoolean("capabilities", key, value)
                          }
                        />
                      </div>
                    ))}
                  </div>
                </Section>
                <div className="sticky bottom-0 flex items-center justify-between gap-4 rounded-[1.4rem] border border-white/80 bg-white/90 p-3 shadow-[0_16px_50px_rgba(15,23,42,0.14)] backdrop-blur-xl">
                  <p className="pl-2 text-xs text-slate-500">
                    {dirty
                      ? "You have unsaved access changes."
                      : "Access is up to date."}
                  </p>
                  <button
                    type="button"
                    disabled={!dirty || saving}
                    onClick={save}
                    className="inline-flex h-10 items-center gap-2 rounded-full bg-slate-950 px-4 text-xs font-semibold text-white disabled:bg-slate-200 disabled:text-slate-400"
                  >
                    {saving ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Save className="h-4 w-4" />
                    )}
                    Save changes
                  </button>
                </div>
              </motion.div>
            ) : !loading ? (
              <div className="flex min-h-[500px] items-center justify-center text-center">
                <div>
                  <UserRound className="mx-auto h-7 w-7 text-slate-300" />
                  <p className="mt-3 text-sm font-semibold text-slate-700">
                    Select a team member
                  </p>
                  <p className="mt-1 text-xs text-slate-400">
                    Their access controls will appear here.
                  </p>
                </div>
              </div>
            ) : null}
          </AnimatePresence>
        </main>
      </div>
    </div>
  );
}
