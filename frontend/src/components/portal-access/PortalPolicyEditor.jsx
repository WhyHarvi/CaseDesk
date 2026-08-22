import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, ChevronDown, LockKeyhole, Search, ShieldAlert, ShieldCheck } from "lucide-react";
import api from "../../services/api";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";

const GROUP_LABELS = {
  general: "General",
  dashboard: "Dashboard",
  documents: "Documents",
  forms: "Forms",
  case_information: "Case information",
  payments: "Payments",
  appointments: "Appointments",
  communication: "Communication",
  notifications: "Notifications",
};

const PRESET_LABELS = {
  STANDARD: "Standard access",
  RESTRICTED: "Restricted access",
  DOCUMENTS_ONLY: "Documents only",
  READ_ONLY: "Read only",
  FULL: "Full portal access",
  CUSTOM: "Custom",
};

const STATUS_COPY = {
  ACTIVE: "Normal configured permissions apply.",
  RESTRICTED: "Only essential document, form, appointment, and reply actions remain available.",
  SUSPENDED: "Portal data and actions are blocked without deleting the account.",
};

const humanize = (key) => key.split(".").pop().replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
const emptyDraft = { preset: "STANDARD", status: "ACTIVE", permissions: {}, vetoes: {}, validFrom: "", validUntil: "" };

function normalizePolicy(policy) {
  if (!policy) return emptyDraft;
  return {
    preset: policy.preset || "CUSTOM",
    status: policy.status || "ACTIVE",
    permissions: policy.permissions || {},
    vetoes: policy.vetoes || {},
    validFrom: policy.validFrom ? String(policy.validFrom).slice(0, 10) : "",
    validUntil: policy.validUntil ? String(policy.validUntil).slice(0, 10) : "",
  };
}

function PolicySelect({ label, value, values, onChange, disabled = false }) {
  return (
    <div className="relative min-w-0">
      <select aria-label={label} value={value} onChange={(event) => onChange(event.target.value)} disabled={disabled} className="h-11 w-full appearance-none rounded-md border border-input bg-background px-3 pr-9 text-sm text-foreground shadow-xs outline-none transition-colors focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50">
        {values.map(([id, text]) => <option key={id} value={id}>{text}</option>)}
      </select>
      <ChevronDown aria-hidden="true" className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
    </div>
  );
}

function PermissionRow({ permissionKey, draft, effective, allowVeto, immutable, onPermission, onVeto }) {
  const override = draft.permissions[permissionKey]?.value || "INHERIT";
  const veto = draft.vetoes[permissionKey]?.value || "NONE";
  const result = effective?.[permissionKey];
  return (
    <div className="grid gap-4 border-b border-border/70 py-5 last:border-b-0 md:grid-cols-[minmax(0,1fr)_180px] md:items-center xl:grid-cols-[minmax(0,1fr)_180px_180px]">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <p className="font-medium text-foreground">{humanize(permissionKey)}</p>
          <Badge variant={result?.allowed ? "default" : "secondary"} className="rounded-full">{result?.allowed ? "Allowed" : "Denied"}</Badge>
          {immutable ? <Badge variant="destructive">Security ceiling</Badge> : null}
        </div>
        <p className="mt-1 text-sm text-muted-foreground">Currently from {result?.source || "agency default"}</p>
      </div>
      <Field>
        <FieldLabel className="md:sr-only">Access rule</FieldLabel>
        <PolicySelect label={`${humanize(permissionKey)} access rule`} value={override} values={[["INHERIT", "Use profile"], ["ALLOW", "Allow"], ["DENY", "Deny"]]} disabled={immutable} onChange={(value) => onPermission(permissionKey, value)} />
      </Field>
      {allowVeto ? <Field className="md:col-start-2 xl:col-start-auto"><FieldLabel className="xl:sr-only">Admin veto</FieldLabel><PolicySelect label={`${humanize(permissionKey)} administrative veto`} value={veto} values={[["NONE", "No admin veto"], ["FORCE_ALLOW", "Force allow"], ["FORCE_DENY", "Force deny"]]} disabled={immutable} onChange={(value) => onVeto(permissionKey, value)} /></Field> : null}
    </div>
  );
}

export default function PortalPolicyEditor({ endpoint, resetEndpoint = null, title, description, allowVeto = false, allowSuspension = false, compact = false, onSaved }) {
  const [catalog, setCatalog] = useState(null);
  const [effective, setEffective] = useState({});
  const [original, setOriginal] = useState(emptyDraft);
  const [draft, setDraft] = useState(emptyDraft);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [confirmSuspend, setConfirmSuspend] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [activeGroup, setActiveGroup] = useState("general");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await api.get(endpoint);
      const data = response.data.data || {};
      const next = normalizePolicy(data.policy);
      setCatalog(data.catalog);
      setEffective(data.effective || {});
      setOriginal(next);
      setDraft(next);
      setError("");
    } catch (requestError) {
      setError(requestError.response?.data?.message || "Portal permissions could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, [endpoint]);

  useEffect(() => { load(); }, [load]);
  const dirty = JSON.stringify(original) !== JSON.stringify(draft);
  const immutable = useMemo(() => new Set(catalog?.immutableDenied || []), [catalog]);
  const visibleGroups = useMemo(() => Object.entries(catalog?.groups || {}).map(([group, keys]) => [group, keys.filter((key) => `${GROUP_LABELS[group]} ${humanize(`${group}.${key}`)}`.toLowerCase().includes(query.trim().toLowerCase()))]).filter(([, keys]) => keys.length), [catalog, query]);
  const displayedGroups = query.trim() ? visibleGroups : visibleGroups.filter(([group]) => group === activeGroup);

  useEffect(() => {
    if (!query.trim() && visibleGroups.length && !visibleGroups.some(([group]) => group === activeGroup)) setActiveGroup(visibleGroups[0][0]);
  }, [activeGroup, query, visibleGroups]);

  function setEntry(bucket, key, value) {
    setDraft((current) => ({ ...current, preset: "CUSTOM", [bucket]: { ...current[bucket], [key]: { ...current[bucket]?.[key], value } } }));
  }

  async function save() {
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const response = await api.put(endpoint, draft);
      setNotice(response.data.message || "Portal permissions saved.");
      await load();
      onSaved?.(response.data.data);
    } catch (requestError) {
      setError(requestError.response?.data?.message || "Portal permissions could not be saved.");
    } finally {
      setSaving(false);
    }
  }

  async function resetPolicy() {
    setSaving(true);
    setError("");
    try {
      const response = await api.delete(resetEndpoint);
      setNotice(response.data.message || "Policy reset to agency defaults.");
      await load();
    } catch (requestError) {
      setError(requestError.response?.data?.message || "The policy could not be reset.");
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <div className="flex flex-col gap-3"><Skeleton className="h-24 w-full" /><Skeleton className="h-72 w-full" /></div>;

  return (
    <div className="portal-policy-theme mx-auto flex w-full max-w-7xl flex-col gap-8 px-1 py-2 sm:px-2 sm:py-4">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
        <div className="max-w-3xl">
          <div className="flex items-center gap-3">
            <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary"><ShieldCheck aria-hidden="true" /></span>
            <div>
              <h2 className={compact ? "text-lg font-semibold" : "text-2xl font-semibold tracking-tight"}>{title}</h2>
              <p className="mt-1 text-sm leading-6 text-muted-foreground">{description}</p>
            </div>
          </div>
        </div>
        <Field className="w-full xl:max-w-sm">
          <FieldLabel htmlFor={`permission-search-${endpoint}`}>Search permissions</FieldLabel>
          <div className="relative">
            <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input id={`permission-search-${endpoint}`} value={query} onChange={(event) => setQuery(event.target.value)} className="pl-9" placeholder="Documents, payments, messages…" />
          </div>
        </Field>
      </div>

      {notice ? <Alert><Check aria-hidden="true" /><AlertTitle>Saved</AlertTitle><AlertDescription>{notice}</AlertDescription></Alert> : null}
      {error ? <Alert variant="destructive"><ShieldAlert aria-hidden="true" /><AlertTitle>Unable to continue</AlertTitle><AlertDescription>{error}</AlertDescription></Alert> : null}

      <section className="rounded-2xl border border-primary/15 bg-primary/5 p-5 shadow-sm sm:p-6">
        <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-4">
          <Field>
            <FieldLabel>Access profile</FieldLabel>
            <PolicySelect label="Access profile" value={draft.preset} values={[...(catalog?.presets || []), "CUSTOM"].map((preset) => [preset, PRESET_LABELS[preset] || preset])} onChange={(preset) => setDraft((current) => ({ ...current, preset, permissions: preset === "CUSTOM" ? current.permissions : {} }))} />
            <FieldDescription>Choose a starting point, then fine-tune below.</FieldDescription>
          </Field>
          <Field>
            <FieldLabel>Portal status</FieldLabel>
            <PolicySelect label="Portal status" value={draft.status} values={[["ACTIVE", "Active"], ["RESTRICTED", "Restricted"], ...(allowSuspension ? [["SUSPENDED", "Suspended"]] : [])]} onChange={(status) => status === "SUSPENDED" ? setConfirmSuspend(true) : setDraft((current) => ({ ...current, status }))} />
            <FieldDescription>{STATUS_COPY[draft.status]}</FieldDescription>
          </Field>
          <Field className="rounded-xl border border-primary/20 bg-background p-4 shadow-xs">
            <FieldLabel htmlFor={`policy-from-${endpoint}`}>Active from</FieldLabel>
            <Input id={`policy-from-${endpoint}`} type="date" value={draft.validFrom} onChange={(event) => setDraft((current) => ({ ...current, validFrom: event.target.value }))} />
            <FieldDescription>Optional start date.</FieldDescription>
          </Field>
          <Field className="rounded-xl border border-primary/20 bg-background p-4 shadow-xs">
            <FieldLabel htmlFor={`policy-until-${endpoint}`}>Expires</FieldLabel>
            <Input id={`policy-until-${endpoint}`} type="date" value={draft.validUntil} onChange={(event) => setDraft((current) => ({ ...current, validUntil: event.target.value }))} />
            <FieldDescription>Leave blank for ongoing access.</FieldDescription>
          </Field>
        </div>
      </section>

      {allowVeto ? <div className="flex gap-3 border-b pb-5 text-sm text-muted-foreground"><LockKeyhole aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-foreground" /><p><span className="font-medium text-foreground">Admin controls:</span> Force deny overrides lower-level access. Force allow never bypasses security restrictions.</p></div> : null}

      <div className="grid min-w-0 gap-6 md:grid-cols-[220px_minmax(0,1fr)] lg:gap-8">
        {!query.trim() ? <aside className="min-w-0 md:sticky md:top-6 md:self-start">
          <Field className="md:hidden">
            <FieldLabel>Permission category</FieldLabel>
            <PolicySelect label="Permission category" value={activeGroup} values={visibleGroups.map(([group, keys]) => [group, `${GROUP_LABELS[group]} (${keys.length})`])} onChange={setActiveGroup} />
          </Field>
          <nav aria-label="Permission categories" className="hidden flex-col gap-1 rounded-2xl border border-primary/10 bg-primary/5 p-2 md:flex">
            {visibleGroups.map(([group, keys]) => (
              <Button key={group} type="button" variant={activeGroup === group ? "default" : "ghost"} onClick={() => setActiveGroup(group)} className="min-h-11 justify-between px-3">
                <span>{GROUP_LABELS[group]}</span><Badge variant={activeGroup === group ? "default" : "outline"} className="rounded-full">{keys.length}</Badge>
              </Button>
            ))}
          </nav>
        </aside> : <div className="hidden md:block"><p className="rounded-xl bg-primary/5 p-4 text-sm text-muted-foreground">Showing matches across all categories.</p></div>}

        <div className="min-w-0 rounded-2xl border border-primary/10 bg-background px-5 py-2 shadow-sm sm:px-6">
          {displayedGroups.map(([group, keys]) => (
            <section key={group} aria-labelledby={`permission-group-${group}`} className={query.trim() ? "border-b py-6 last:border-b-0" : ""}>
              <div className="flex items-center justify-between gap-4 border-b py-5">
                <div>
                  <h3 id={`permission-group-${group}`} className="text-lg font-semibold text-foreground">{GROUP_LABELS[group]}</h3>
                  <p className="mt-1 text-sm text-muted-foreground">Choose whether each action follows the profile, is allowed, or is denied.</p>
                </div>
                <Badge variant="secondary" className="rounded-full">{keys.length}</Badge>
              </div>
              {keys.map((key) => <PermissionRow key={`${group}.${key}`} permissionKey={`${group}.${key}`} draft={draft} effective={effective} allowVeto={allowVeto} immutable={immutable.has(`${group}.${key}`)} onPermission={(permissionKey, value) => setEntry("permissions", permissionKey, value)} onVeto={(permissionKey, value) => setEntry("vetoes", permissionKey, value)} />)}
            </section>
          ))}
          {!displayedGroups.length ? <div className="py-14 text-center"><p className="font-medium">No permissions found</p><p className="mt-1 text-sm text-muted-foreground">Try a broader search term.</p></div> : null}
        </div>
      </div>

      <div className="sticky bottom-0 z-10 -mx-4 flex flex-col gap-3 border-t bg-background/95 px-4 py-4 shadow-[0_-8px_24px_rgba(0,0,0,0.04)] backdrop-blur sm:mx-0 sm:flex-row sm:items-center sm:justify-between sm:px-0">
        <p className="text-sm text-muted-foreground">{dirty ? "You have unsaved changes." : "All changes are saved."}</p>
        <div className="flex flex-col-reverse gap-2 sm:flex-row">
          {resetEndpoint ? <Button variant="ghost" disabled={saving} onClick={() => setConfirmReset(true)} className="text-destructive hover:text-destructive">Reset to defaults</Button> : null}
          <Button variant="outline" disabled={!dirty || saving} onClick={() => setDraft(original)}>Discard</Button>
          <Button disabled={!dirty || saving} onClick={save}>{saving ? "Saving…" : "Save changes"}</Button>
        </div>
      </div>
      <AlertDialog open={confirmSuspend} onOpenChange={setConfirmSuspend}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Suspend client portal access?</AlertDialogTitle>
            <AlertDialogDescription>The client will immediately lose access to case information, documents, forms, payments, appointments, and messages after you save. The portal account is not deleted and can be restored.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={() => { setDraft((current) => ({ ...current, status: "SUSPENDED" })); setConfirmSuspend(false); }}>Suspend access</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog open={confirmReset} onOpenChange={setConfirmReset}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reset this case policy?</AlertDialogTitle>
            <AlertDialogDescription>All case-level overrides, temporary windows, and case-level vetoes will be removed. The case will immediately inherit the agency defaults and any individual-client policy.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={() => { setConfirmReset(false); void resetPolicy(); }}>Reset policy</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
