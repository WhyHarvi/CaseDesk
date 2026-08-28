import {
  Check,
  ChevronRight,
  Eye,
  FolderLock,
  Loader2,
  Save,
  Search,
  ShieldAlert,
  ShieldCheck,
  UserRound,
  Users,
} from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { useCallback, useEffect, useMemo, useState } from "react";
import api from "../../services/api";
import PortalPolicyEditor from "../portal-access/PortalPolicyEditor";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

// Labels/descriptions for the page/tab/capability keys this settings screen
// exposes. The *set* of keys itself is not hardcoded here — it comes from
// the API's meta.catalog (see load() below), which is generated from the
// same portalPageKeys/portalCaseTabKeys/portalCapabilityKeys arrays the
// backend actually enforces (backend/src/services/portalAccessService.js).
// That way a key added on the backend shows up here automatically (with a
// humanized fallback label) instead of silently being uneditable from the
// UI until someone remembers to update a second, disconnected list.
const pageCopy = {
  dashboard: ["Dashboard", "Work summary and upcoming priorities"],
  leads: ["Leads", "Lead pipeline and inquiry records"],
  leadIntake: ["Lead intake settings", "Intake forms and incoming lead tools inside Settings"],
  clients: ["Clients", "Client list and profile pages"],
  cases: ["Cases", "Case list and case workspaces"],
  followUps: ["Follow-ups", "Tasks and follow-up queue"],
  calendar: ["Calendar", "Shared workspace appointments — always available to staff"],
  documents: ["Documents", "Agency-wide document workspace"],
  payments: ["Payments", "Agency-wide billing and transaction report"],
  workload: ["Workload", "Team capacity and assignments"],
  caseEasyImport: ["Case Easy Import", "Import and review migrated records"],
  incentives: ["Incentives", "Earnings, incentive ledger, and pipeline"],
};

const caseTabCopy = {
  profile: "Profile",
  reminders: "Reminders",
  questionnaires: "Questionnaires",
  documents: "Documents",
  forms: "Forms",
  tasks: "Tasks",
  agreementsLetters: "Agreements & Letters",
  appointments: "Appointments",
  communication: "Communication",
  billing: "Billing",
};

const dataCopy = {
  leads: ["Lead records", "Controls which inquiries appear"],
  clients: ["Client access", "Assigned includes direct profile assignments and clients connected to an assigned case"],
  cases: ["Case records", "Controls which case files appear"],
};

const capabilityCopy = {
  internalNotes: ["Internal notes", "View and add private staff notes"],
  financialData: ["Financial information", "View client billing, invoices, and payment totals"],
  manageClientPortal: ["Client portal invitations", "Create and manage client portal access"],
  teamWorkload: ["Team workload visibility", "See every teammate's workload, the same view an admin gets — not just their own"],
};

const humanize = (key) => key.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/^./, (c) => c.toUpperCase());

const clone = (value) => JSON.parse(JSON.stringify(value));
const initials = (name) =>
  String(name || "TM")
    .split(/\s+/)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

function Switch({ checked, onChange, label, disabled = false }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative h-6 w-11 shrink-0 rounded-full p-0.5 outline-none transition focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-60 ${checked ? "bg-primary" : "bg-muted"}`}
    >
      <motion.span
        layout
        transition={{ type: "spring", stiffness: 560, damping: 36 }}
        className={`block h-5 w-5 rounded-full bg-background shadow-sm ${checked ? "ml-5" : "ml-0"}`}
      />
    </button>
  );
}

function Section({ icon: Icon, title, detail, children }) {
  return (
    <section className="overflow-hidden rounded-2xl border border-border bg-background shadow-sm">
      <div className="flex items-start gap-3 border-b border-border px-5 py-4">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <Icon className="h-4 w-4" />
        </span>
        <div>
          <h3 className="text-sm font-semibold text-foreground">{title}</h3>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">{detail}</p>
        </div>
      </div>
      {children}
    </section>
  );
}

function StaffPortalAccessSettingsPanel() {
  const [members, setMembers] = useState([]);
  const [catalog, setCatalog] = useState(null);
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
      setCatalog(response.data.meta?.catalog || null);
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

  const pageOptions = useMemo(
    () => (catalog?.pages || Object.keys(pageCopy)).map((key) => [key, ...(pageCopy[key] || [humanize(key), ""])]),
    [catalog],
  );
  const caseTabOptions = useMemo(
    () => (catalog?.caseTabs || Object.keys(caseTabCopy)).map((key) => [key, caseTabCopy[key] || humanize(key)]),
    [catalog],
  );
  const dataOptions = useMemo(
    () => (catalog?.data || Object.keys(dataCopy)).map((key) => [key, ...(dataCopy[key] || [humanize(key), ""])]),
    [catalog],
  );
  const capabilityOptions = useMemo(
    () => (catalog?.capabilities || Object.keys(capabilityCopy)).map((key) => [key, ...(capabilityCopy[key] || [humanize(key), ""])]),
    [catalog],
  );

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
          <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-primary/10 text-primary">
            <ShieldCheck className="h-5 w-5" />
          </span>
          <div>
            <h2 className="text-2xl font-semibold tracking-tight text-foreground">
              Staff workspace access
            </h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
              Choose exactly which workspace areas, case tabs, and client
              information each consultant or front-desk member can access.
            </p>
          </div>
        </div>
        {dirty ? (
          <Button size="lg" disabled={saving} onClick={save} className="gap-2">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Save access
          </Button>
        ) : null}
      </div>
      {notice ? (
        <Alert>
          <Check aria-hidden="true" />
          <AlertTitle>Saved</AlertTitle>
          <AlertDescription>{notice}</AlertDescription>
        </Alert>
      ) : null}
      {error ? (
        <Alert variant="destructive">
          <ShieldAlert aria-hidden="true" />
          <AlertTitle>Unable to continue</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      <div className="grid min-h-[650px] overflow-hidden rounded-3xl border border-border bg-muted/40 shadow-sm lg:grid-cols-[300px_minmax(0,1fr)]">
        <aside className="border-b border-border bg-background p-4 lg:border-b-0 lg:border-r">
          <Field>
            <FieldLabel htmlFor="portal-access-search" className="sr-only">Find team member</FieldLabel>
            <div className="relative">
              <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                id="portal-access-search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Find team member"
                className="h-10 pl-9"
              />
            </div>
          </Field>
          <div className="mt-3 grid grid-cols-3 rounded-2xl bg-muted p-1">
            {[
              ["all", "All"],
              ["consultant", "Consultants"],
              ["frontdesk", "Front desk"],
            ].map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => setFilter(id)}
                className={`rounded-xl px-2 py-2 text-[11px] font-semibold outline-none transition focus-visible:ring-3 focus-visible:ring-ring/50 ${filter === id ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="scrollbar-hidden mt-4 max-h-[540px] space-y-1 overflow-y-auto">
            {loading ? (
              <div className="space-y-2 py-1">
                <Skeleton className="h-14 w-full rounded-2xl" />
                <Skeleton className="h-14 w-full rounded-2xl" />
                <Skeleton className="h-14 w-full rounded-2xl" />
              </div>
            ) : filtered.length === 0 ? (
              <p className="px-2 py-8 text-center text-xs text-muted-foreground">No team members match.</p>
            ) : (
              filtered.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setSelectedId(item.id)}
                  className={`flex w-full items-center gap-3 rounded-2xl p-3 text-left outline-none transition focus-visible:ring-3 focus-visible:ring-ring/50 ${selectedId === item.id ? "bg-primary text-primary-foreground shadow-sm" : "hover:bg-muted"}`}
                >
                  <Avatar size="lg" className={selectedId === item.id ? "ring-2 ring-primary-foreground/30" : ""}>
                    <AvatarFallback className={selectedId === item.id ? "bg-primary-foreground/15 text-primary-foreground" : ""}>
                      {initials(item.fullName)}
                    </AvatarFallback>
                  </Avatar>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold">
                      {item.fullName}
                    </span>
                    <span
                      className={`mt-0.5 block truncate text-xs capitalize ${selectedId === item.id ? "text-primary-foreground/70" : "text-muted-foreground"}`}
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
                <div className="flex items-center gap-3 rounded-2xl border border-border bg-background p-4 shadow-sm">
                  <Avatar size="lg" className="h-12 w-12">
                    <AvatarFallback className="bg-primary/10 text-sm font-bold text-primary">
                      {initials(selected.fullName)}
                    </AvatarFallback>
                  </Avatar>
                  <div className="min-w-0">
                    <h3 className="truncate text-base font-semibold text-foreground">
                      {selected.fullName}
                    </h3>
                    <p className="mt-1 truncate text-xs text-muted-foreground">
                      {selected.email} ·{" "}
                      <span className="capitalize">{selected.role}</span>
                    </p>
                  </div>
                  <Badge variant={selected.isActive ? "default" : "secondary"} className="ml-auto rounded-full">
                    {selected.isActive ? "Active" : "Inactive"}
                  </Badge>
                </div>
                <Section
                  icon={Eye}
                  title="Workspace pages"
                  detail="These controls change both the sidebar and direct page access."
                >
                  <div className="divide-y divide-border">
                    {pageOptions.map(([key, label, detail]) => (
                      <div
                        key={key}
                        className="flex items-center justify-between gap-4 px-5 py-3.5"
                      >
                        <div>
                          <p className="text-sm font-semibold text-foreground">
                            {label}
                          </p>
                          <p className="mt-0.5 text-xs text-muted-foreground">
                            {detail}
                          </p>
                        </div>
                        {key === "calendar" ? (
                          <Badge variant="secondary">Always available</Badge>
                        ) : (
                          <Switch
                            label={label}
                            checked={draft.pages[key] === true}
                            onChange={(value) => setBoolean("pages", key, value)}
                          />
                        )}
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
                        className={`flex items-center justify-between rounded-2xl border px-4 py-3 text-left text-sm font-semibold outline-none transition focus-visible:ring-3 focus-visible:ring-ring/50 ${draft.caseTabs[key] ? "border-primary/25 bg-primary/5 text-primary" : "border-border bg-background text-muted-foreground hover:bg-muted"}`}
                      >
                        <span>{label}</span>
                        <span
                          className={`flex h-5 w-5 items-center justify-center rounded-full ${draft.caseTabs[key] ? "bg-primary text-primary-foreground" : "bg-muted"}`}
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
                  <div className="divide-y divide-border">
                    {dataOptions.map(([key, label, detail]) => (
                      <div
                        key={key}
                        className="px-5 py-4 sm:flex sm:items-center sm:justify-between sm:gap-4"
                      >
                        <div>
                          <p className="text-sm font-semibold text-foreground">
                            {label}
                          </p>
                          <p className="mt-0.5 text-xs text-muted-foreground">
                            {detail}
                          </p>
                        </div>
                        <div className="mt-3 grid grid-cols-3 rounded-2xl bg-muted p-1 sm:mt-0">
                          {[
                            ["none", "None"],
                            ["assigned", "Assigned"],
                            ["all", "All"],
                          ].map(([value, labelText]) => (
                            <button
                              key={value}
                              type="button"
                              onClick={() => setData(key, value)}
                              className={`rounded-xl px-3 py-2 text-[11px] font-semibold outline-none transition focus-visible:ring-3 focus-visible:ring-ring/50 ${draft.data[key] === value ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
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
                  <div className="divide-y divide-border">
                    {capabilityOptions.map(([key, label, detail]) => (
                      <div
                        key={key}
                        className="flex items-center justify-between gap-4 px-5 py-3.5"
                      >
                        <div>
                          <p className="text-sm font-semibold text-foreground">
                            {label}
                          </p>
                          <p className="mt-0.5 text-xs text-muted-foreground">
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
                <div className="sticky bottom-0 flex items-center justify-between gap-4 rounded-2xl border border-border bg-background/95 p-3 shadow-sm backdrop-blur-xl">
                  <p className="pl-2 text-xs text-muted-foreground">
                    {dirty
                      ? "You have unsaved access changes."
                      : "Access is up to date."}
                  </p>
                  <Button size="sm" disabled={!dirty || saving} onClick={save} className="gap-2">
                    {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                    Save changes
                  </Button>
                </div>
              </motion.div>
            ) : !loading ? (
              <div className="flex min-h-[500px] items-center justify-center text-center">
                <div>
                  <UserRound className="mx-auto h-7 w-7 text-muted-foreground/60" />
                  <p className="mt-3 text-sm font-semibold text-foreground">
                    Select a team member
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
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

export default function PortalAccessSettingsPanel() {
  return (
    <Tabs defaultValue="clients" className="portal-policy-theme flex flex-col gap-6">
      <div className="border-b border-border px-1">
        <TabsList variant="line" aria-label="Portal access settings" className="grid h-auto w-full grid-cols-2 p-0 sm:w-fit">
          <TabsTrigger value="clients" className="min-h-12 px-3 sm:px-5">Client portal</TabsTrigger>
          <TabsTrigger value="staff" className="min-h-12 px-3 sm:px-5">Staff workspace</TabsTrigger>
        </TabsList>
      </div>
      <TabsContent value="clients">
        <PortalPolicyEditor
          endpoint="/admin/client-portal-policy"
          title="Agency client portal defaults"
          description="Define what client accounts can see and do. Case and individual-client policies inherit from these defaults unless an authorized override or veto applies."
          allowVeto
          allowSuspension
        />
      </TabsContent>
      <TabsContent value="staff">
        <StaffPortalAccessSettingsPanel />
      </TabsContent>
    </Tabs>
  );
}
