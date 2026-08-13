import { BellRing, Check, Clipboard, Clock3, Code2, ExternalLink, FileSpreadsheet, Inbox, KeyRound, Link2, Mail, MessageSquareText, Plus, RefreshCw, Route, ShieldCheck, Upload, Waypoints } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useAuth } from "../../../auth/AuthContext";
import api from "../../../services/api";
import { humanize } from "../leadPresentation";
import DuplicateReviewSheet from "../components/DuplicateReviewSheet";
import LeadRoutingRulesPanel from "../components/LeadRoutingRulesPanel";

const tabs = [{ id: "forms", label: "Public forms", icon: Link2, roles: ["admin", "consultant", "frontdesk"] }, { id: "routing", label: "Auto-assignment", icon: Route, roles: ["admin"] }, { id: "website", label: "Connections", icon: Code2, roles: ["admin"] }, { id: "imports", label: "CSV imports", icon: FileSpreadsheet, roles: ["admin", "consultant"] }, { id: "events", label: "Incoming events", icon: Inbox, roles: ["admin"] }];
const providerLabels = { WEBSITE: "Website", META: "Meta lead forms", WHATSAPP: "WhatsApp Business", GOOGLE_ADS: "Google Ads", EMAIL: "Email intake", OOMA: "Ooma / phone" };
const fields = [["phone", "Phone"], ["firstName", "First name"], ["lastName", "Last name"], ["fullName", "Full name"], ["email", "Email"], ["country", "Country"], ["preferredLanguage", "Language"], ["currentImmigrationStatus", "Current status"], ["immigrationInterest", "Interest"], ["preferredContactTime", "Contact time"], ["initialMessage", "Message / notes"]];
const statusTone = { ACTIVE: "bg-emerald-50 text-emerald-700", PAUSED: "bg-slate-100 text-slate-600", PROCESSED: "bg-emerald-50 text-emerald-700", COMPLETED: "bg-emerald-50 text-emerald-700", PENDING: "bg-amber-50 text-amber-700", PROCESSING: "bg-blue-50 text-blue-700", QUEUED: "bg-blue-50 text-blue-700", DUPLICATE_REVIEW: "bg-violet-50 text-violet-700", DUPLICATE: "bg-violet-50 text-violet-700", FAILED: "bg-rose-50 text-rose-700", INVALID: "bg-rose-50 text-rose-700", PREVIEW: "bg-slate-100 text-slate-600" };
const inputClass = "h-11 w-full rounded-2xl border border-slate-200 bg-white px-4 text-sm text-slate-800 outline-none transition focus:border-brand-300 focus:ring-4 focus:ring-brand-100";

function Pill({ value }) { return <span className={`inline-flex rounded-full px-2.5 py-1 text-[10px] font-semibold ${statusTone[value] || "bg-slate-100 text-slate-600"}`}>{humanize(value)}</span>; }
function Empty({ icon: Icon, title, copy }) { return <div className="flex min-h-64 flex-col items-center justify-center px-6 text-center"><div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100 text-slate-500"><Icon className="h-5 w-5" /></div><h3 className="mt-4 text-sm font-semibold text-slate-900">{title}</h3><p className="mt-1 max-w-sm text-sm text-slate-500">{copy}</p></div>; }

export default function LeadIntakePage() {
  const { role } = useAuth();
  const [searchParams] = useSearchParams();
  const requestedTab = searchParams.get("tab");
  const requestedEventId = searchParams.get("event") || "";
  const [tab, setTab] = useState(() => tabs.some((item) => item.id === requestedTab && item.roles.includes(role)) ? requestedTab : "forms");
  const [focusedEventId, setFocusedEventId] = useState("");
  const [forms, setForms] = useState([]), [imports, setImports] = useState([]), [events, setEvents] = useState([]);
  const [sources, setSources] = useState([]), [staff, setStaff] = useState([]);
  const [websiteConnections, setWebsiteConnections] = useState([]), [websiteOpen, setWebsiteOpen] = useState(false), [credentials, setCredentials] = useState(null), [secureStorageReady, setSecureStorageReady] = useState(true);
  const [operations, setOperations] = useState(null);
  const [leadSettings, setLeadSettings] = useState(null);
  const [staleOutreach, setStaleOutreach] = useState(null);
  const [outreachRunNotice, setOutreachRunNotice] = useState("");
  const [connectorProvider, setConnectorProvider] = useState("WEBSITE");
  const [loading, setLoading] = useState(true), [error, setError] = useState(""), [busy, setBusy] = useState(false);
  const [formOpen, setFormOpen] = useState(false), [preview, setPreview] = useState(null), [copied, setCopied] = useState("");
  const [reviewingEventId, setReviewingEventId] = useState("");
  const [file, setFile] = useState(null), [headers, setHeaders] = useState([]), [mapping, setMapping] = useState({});
  const [importSource, setImportSource] = useState(""), [importOwner, setImportOwner] = useState("");
  const fileRef = useRef(null);

  const load = useCallback(async (fresh = false) => {
    try {
      setLoading(true);
      const get = fresh ? api.getFresh : api.get;
      const [formResult, importResult, eventResult, sourceResult, staffResult, websiteResult, operationsResult, leadSettingsResult, staleOutreachResult] = await Promise.all([get("/leads/intake/forms"), ["admin", "consultant"].includes(role) ? get("/leads/imports?limit=50") : Promise.resolve({ data: { data: [] } }), role === "admin" ? get("/leads/intake/events?limit=100") : Promise.resolve({ data: { data: [] } }), get("/leads/sources"), get("/leads/staff"), role === "admin" ? get("/leads/intake/connections") : Promise.resolve({ data: { data: { connections: [] } } }), role === "admin" ? get("/leads/intake/operations") : Promise.resolve({ data: { data: null } }), role === "admin" ? get("/leads/settings") : Promise.resolve({ data: { data: null } }), role === "admin" ? get("/leads/settings/stale-outreach") : Promise.resolve({ data: { data: null } })]);
      setForms(formResult.data.data); setImports(importResult.data.data); setEvents(eventResult.data.data); setSources(sourceResult.data.data); setStaff(staffResult.data.data);
      setWebsiteConnections(websiteResult.data.data.connections || []);
      setSecureStorageReady(websiteResult.data.data.secureStorageReady ?? true);
      setOperations(operationsResult.data.data);
      setLeadSettings(leadSettingsResult.data.data);
      setStaleOutreach(staleOutreachResult.data.data);
      setImportSource((value) => value || sourceResult.data.data.find((item) => item.type === "CSV_IMPORT")?.id || sourceResult.data.data[0]?.id || "");
      setImportOwner((value) => value || staffResult.data.data[0]?.id || ""); setError("");
    } catch (requestError) { setError(requestError.response?.data?.message || "Lead intake could not be loaded."); }
    finally { setLoading(false); }
  }, [role]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (role !== "admin" || !requestedEventId) return undefined;
    setTab("events");
    setFocusedEventId(requestedEventId);
    const frame = window.requestAnimationFrame(() => {
      document.getElementById(`lead-event-${requestedEventId}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
    const timer = window.setTimeout(() => setFocusedEventId(""), 4800);
    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(timer);
    };
  }, [events, requestedEventId, role]);

  async function createForm(event) {
    event.preventDefault(); setBusy(true); setError("");
    const data = Object.fromEntries(new FormData(event.currentTarget)); data.requireConsent = true; data.firstResponseMinutes = Number(data.firstResponseMinutes);
    try { await api.post("/leads/intake/forms", data); setFormOpen(false); await load(); }
    catch (requestError) { setError(requestError.response?.data?.message || "The public form could not be created."); }
    finally { setBusy(false); }
  }

  async function createWebsiteConnection(event) {
    event.preventDefault(); setBusy(true); setError("");
    const data = Object.fromEntries(new FormData(event.currentTarget));
    data.provider = connectorProvider; data.firstResponseMinutes = Number(data.firstResponseMinutes); data.allowedOrigins = data.allowedOrigins.split(/[\n,]/).map((item) => item.trim()).filter(Boolean);
    try {
      const response = await api.post("/leads/intake/connections", data);
      setWebsiteOpen(false); setCredentials({ name: response.data.data.name, provider: response.data.data.provider, webhookUrl: response.data.data.webhookUrl, signingSecret: response.data.data.signingSecret, verificationToken: response.data.data.verificationToken }); await load();
    } catch (requestError) { setError(requestError.response?.data?.message || "The website connector could not be created."); }
    finally { setBusy(false); }
  }

  async function toggleWelcomeEmail() {
    setBusy(true); setError("");
    try {
      const response = await api.patch("/leads/settings", { welcomeEmailEnabled: !leadSettings?.welcomeEmailEnabled });
      setLeadSettings(response.data.data);
    } catch (requestError) { setError(requestError.response?.data?.message || "The setting could not be updated."); }
    finally { setBusy(false); }
  }

  async function updateStaleOutreach(patch) {
    setBusy(true); setError("");
    try {
      await api.patch("/leads/settings", patch);
      await load(true);
    } catch (requestError) { setError(requestError.response?.data?.message || "The stale-lead outreach setting could not be updated."); }
    finally { setBusy(false); }
  }

  async function updateOverdueAlert(patch) {
    setBusy(true); setError("");
    try {
      const response = await api.patch("/leads/settings", patch);
      setLeadSettings(response.data.data);
    } catch (requestError) { setError(requestError.response?.data?.message || "The overdue-alert setting could not be updated."); }
    finally { setBusy(false); }
  }

  async function runStaleOutreachNow() {
    setBusy(true); setError("");
    try {
      const response = await api.post("/leads/settings/stale-outreach/run");
      setOutreachRunNotice(response.data.data.message || "Outreach run started. Refresh shortly to see the delivery results.");
      window.setTimeout(() => void load(true), 5000);
    } catch (requestError) { setError(requestError.response?.data?.message || "The stale-lead outreach could not be run."); }
    finally { setBusy(false); }
  }

  async function rotateWebsiteSecret(connection) {
    if (!window.confirm(`Rotate the signing secret for ${connection.name}? The website must be updated immediately.`)) return;
    setBusy(true); setError("");
    const providerSecret = ["META", "WHATSAPP"].includes(connection.provider) ? window.prompt("Enter the new provider app secret:") : null;
    if (["META", "WHATSAPP"].includes(connection.provider) && !providerSecret) return;
    const providerAccessToken = connection.provider === "META" ? window.prompt("Enter the current Meta page or system-user access token:") : null;
    if (connection.provider === "META" && !providerAccessToken) return;
    try { const response = await api.post(`/leads/intake/connections/${connection.id}/rotate-secret`, { ...(providerSecret ? { providerSecret } : {}), ...(providerAccessToken ? { providerAccessToken } : {}) }); setCredentials({ name: connection.name, provider: connection.provider, webhookUrl: connection.webhookUrl, signingSecret: response.data.data.signingSecret, verificationToken: connection.verificationToken }); }
    catch (requestError) { setError(requestError.response?.data?.message || "The signing secret could not be rotated."); }
    finally { setBusy(false); }
  }

  async function toggleWebsiteConnection(connection) {
    setBusy(true); setError("");
    try { await api.patch(`/leads/intake/connections/${connection.id}`, { isActive: !connection.isActive }); await load(); }
    catch (requestError) { setError(requestError.response?.data?.message || "The connector could not be updated."); }
    finally { setBusy(false); }
  }

  async function copyText(value, id) {
    await navigator.clipboard.writeText(value); setCopied(id); setTimeout(() => setCopied(""), 1600);
  }

  async function retryEvent(eventId) {
    setBusy(true); setError("");
    try { await api.post(`/leads/intake/events/${eventId}/retry`); await load(); }
    catch (requestError) { setError(requestError.response?.data?.message || "The event could not be retried."); }
    finally { setBusy(false); }
  }

  async function chooseFile(selected) {
    setFile(selected || null); setPreview(null); setMapping({});
    if (!selected) { setHeaders([]); return; }
    const firstLine = (await selected.text()).replace(/^\uFEFF/, "").split(/\r?\n/, 1)[0] || "";
    const nextHeaders = firstLine.split(",").map((value) => value.replace(/^"|"$/g, "").trim()).filter(Boolean); setHeaders(nextHeaders);
    const auto = {};
    fields.forEach(([field]) => { const compact = field.toLowerCase(); const found = nextHeaders.find((header) => header.toLowerCase().replace(/[\s_-]/g, "") === compact || (field === "phone" && /phone|mobile|cell/i.test(header)) || (field === "fullName" && /^name$/i.test(header))); if (found) auto[field] = found; });
    setMapping(auto);
  }

  async function previewCsv() {
    if (!file || !mapping.phone) { setError("Choose a CSV and map its Phone column first."); return; }
    setBusy(true); setError("");
    const data = new FormData(); data.append("file", file); data.append("sourceId", importSource); data.append("ownerUserId", importOwner); data.append("mapping", JSON.stringify(mapping));
    try { const response = await api.post("/leads/imports/preview", data); setPreview(response.data.data); await load(); }
    catch (requestError) { setError(requestError.response?.data?.message || "The CSV could not be previewed."); }
    finally { setBusy(false); }
  }

  async function commit() {
    setBusy(true); setError("");
    try { const response = await api.post(`/leads/imports/${preview.id}/commit`); setPreview(response.data.data); await load(); }
    catch (requestError) { setError(requestError.response?.data?.message || "The import could not be queued."); }
    finally { setBusy(false); }
  }

  async function copyUrl(form) {
    const url = `${window.location.origin}/public/intake/${form.publicToken}`; await navigator.clipboard.writeText(url); setCopied(form.id); setTimeout(() => setCopied(""), 1600);
  }

  const activeCount = useMemo(() => forms.filter((item) => item.isActive).length, [forms]);
  return <section className="space-y-5 pb-8">
    <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between"><div><p className="text-xs font-semibold uppercase tracking-[0.18em] text-brand-600">Universal intake</p><h1 className="mt-2 text-3xl font-semibold tracking-[-0.03em] text-slate-950">Lead intake</h1><p className="mt-1.5 text-sm text-slate-500">Bring every lead stream into one clean, reviewable pipeline.</p></div><button onClick={() => load(true)} disabled={loading} className="inline-flex h-10 items-center justify-center gap-2 rounded-full border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 shadow-sm hover:bg-slate-50"><RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />Refresh</button></header>
    {error ? <div className="rounded-2xl border border-rose-200 bg-rose-50 px-5 py-4 text-sm text-rose-700">{error}</div> : null}
    <div className="flex gap-1 overflow-x-auto rounded-2xl border border-slate-200 bg-slate-100/70 p-1.5">{tabs.filter((item) => item.roles.includes(role)).map(({ id, label, icon: Icon }) => <button key={id} onClick={() => setTab(id)} className={`inline-flex h-10 min-w-max flex-1 items-center justify-center gap-2 rounded-xl px-4 text-sm font-semibold transition ${tab === id ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700"}`}><Icon className="h-4 w-4" />{label}</button>)}</div>

    {tab === "forms" ? <div className="space-y-4">
      <div className="flex items-center justify-between rounded-2xl border border-slate-200 bg-white px-5 py-4"><div><p className="text-sm font-semibold text-slate-900">{activeCount} active public {activeCount === 1 ? "form" : "forms"}</p><p className="mt-1 text-xs text-slate-500">Each link is secure, stable, and ready for a website button or QR code.</p></div>{role === "admin" ? <button onClick={() => setFormOpen(true)} className="inline-flex h-10 items-center gap-2 rounded-full bg-slate-900 px-4 text-sm font-semibold text-white"><Plus className="h-4 w-4" />New form</button> : null}</div>
      {!forms.length && !loading ? <Empty icon={Link2} title="No public forms yet" copy="Create one link for each intake stream that needs its own source and owner." /> : <div className="grid gap-3 lg:grid-cols-2">{forms.map((form) => { const url = `${window.location.origin}/public/intake/${form.publicToken}`; return <article key={form.id} className="rounded-3xl border border-slate-200/80 bg-white p-5 shadow-[0_14px_40px_rgba(28,45,74,0.06)]"><div className="flex items-start justify-between gap-3"><div><div className="flex items-center gap-2"><h2 className="font-semibold text-slate-950">{form.name}</h2><Pill value={form.isActive ? "ACTIVE" : "PAUSED"} /></div><p className="mt-1 text-xs text-slate-500">{form.source.name} · {form.owner.fullName} · {form.firstResponseMinutes} min response</p></div><Waypoints className="h-5 w-5 text-brand-500" /></div><div className="mt-4 flex items-center gap-2 rounded-2xl bg-slate-50 p-2 pl-3"><p className="min-w-0 flex-1 truncate text-xs text-slate-500">{url}</p><button onClick={() => copyUrl(form)} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white text-slate-600 shadow-sm" aria-label="Copy link">{copied === form.id ? <Check className="h-4 w-4 text-emerald-600" /> : <Clipboard className="h-4 w-4" />}</button><a href={url} target="_blank" rel="noreferrer" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white text-slate-600 shadow-sm"><ExternalLink className="h-4 w-4" /></a></div></article>; })}</div>}
    </div> : null}

    {tab === "routing" && role === "admin" ? <LeadRoutingRulesPanel staff={staff} /> : null}

    {tab === "website" && role === "admin" ? <div className="space-y-4">
      <section className="flex flex-col gap-4 rounded-3xl border border-slate-200 bg-white p-5 sm:flex-row sm:items-center sm:justify-between"><div className="flex items-start gap-3"><div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-brand-50 text-brand-700"><Waypoints className="h-5 w-5" /></div><div><h2 className="font-semibold text-slate-950">Automatic welcome message</h2><p className="mt-1 max-w-2xl text-sm text-slate-500">The moment a fresh inbound lead lands (website chat, connectors, or a public form) they get a friendly message with a link to book a consultation — by email if they gave one, by text through your Ooma line if they only gave a phone number. Skipped for CSV imports and leads created from a booking that already happened.</p></div></div><button disabled={busy || !leadSettings} onClick={toggleWelcomeEmail} className={`inline-flex h-10 shrink-0 items-center gap-2 rounded-full px-4 text-sm font-semibold transition disabled:opacity-50 ${leadSettings?.welcomeEmailEnabled ? "bg-emerald-600 text-white" : "border border-slate-200 text-slate-600 hover:bg-slate-50"}`}>{leadSettings?.welcomeEmailEnabled ? <Check className="h-4 w-4" /> : null}{leadSettings?.welcomeEmailEnabled ? "On" : "Off"}</button></section>
      {staleOutreach ? <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-[0_14px_40px_rgba(28,45,74,0.04)]">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between"><div className="flex items-start gap-3"><div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-amber-50 text-amber-700"><Clock3 className="h-5 w-5" /></div><div><h2 className="font-semibold text-slate-950">Stale lead consultation check-in</h2><p className="mt-1 max-w-3xl text-sm leading-6 text-slate-500">Sends one professional check-in to an opted-in open lead after no recent contact. Leads with a future follow-up or consultation, import-review leads, closed leads, and leads already sent this check-in are skipped.</p></div></div><button disabled={busy} onClick={() => updateStaleOutreach({ staleOutreachEnabled: !staleOutreach.settings.staleOutreachEnabled })} className={`inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-full px-4 text-sm font-semibold transition disabled:opacity-50 ${staleOutreach.settings.staleOutreachEnabled ? "bg-emerald-600 text-white" : "border border-slate-200 text-slate-600 hover:bg-slate-50"}`}>{staleOutreach.settings.staleOutreachEnabled ? <Check className="h-4 w-4" /> : null}{staleOutreach.settings.staleOutreachEnabled ? "Automation on" : "Automation off"}</button></div>
        <div className="mt-5 grid gap-3 md:grid-cols-[180px_1fr_1fr_auto]"><label className="text-xs font-semibold text-slate-500">Inactive for<select value={staleOutreach.settings.staleOutreachDays} onChange={(event) => updateStaleOutreach({ staleOutreachDays: Number(event.target.value) })} className={`${inputClass} mt-1.5`}><option value="7">7 days</option><option value="14">14 days</option><option value="21">21 days</option><option value="30">30 days</option><option value="60">60 days</option><option value="90">90 days</option></select></label><button disabled={busy} onClick={() => updateStaleOutreach({ staleOutreachEmailEnabled: !staleOutreach.settings.staleOutreachEmailEnabled })} className={`mt-auto flex h-11 items-center gap-3 rounded-2xl border px-4 text-left text-sm font-semibold ${staleOutreach.settings.staleOutreachEmailEnabled ? "border-sky-200 bg-sky-50 text-sky-800" : "border-slate-200 text-slate-500"}`}><Mail className="h-4 w-4" />Email {staleOutreach.settings.staleOutreachEmailEnabled ? "on" : "off"}</button><button disabled={busy} onClick={() => updateStaleOutreach({ staleOutreachSmsEnabled: !staleOutreach.settings.staleOutreachSmsEnabled })} className={`mt-auto flex h-11 items-center gap-3 rounded-2xl border px-4 text-left text-sm font-semibold ${staleOutreach.settings.staleOutreachSmsEnabled ? "border-violet-200 bg-violet-50 text-violet-800" : "border-slate-200 text-slate-500"}`}><MessageSquareText className="h-4 w-4" />SMS {staleOutreach.settings.staleOutreachSmsEnabled ? "on" : "off"}</button><button disabled={busy || !staleOutreach.settings.staleOutreachEnabled || !staleOutreach.eligible} onClick={runStaleOutreachNow} className="mt-auto h-11 rounded-full bg-slate-950 px-5 text-sm font-semibold text-white disabled:bg-slate-300">Run now</button></div>
        <div className="mt-5 grid grid-cols-2 overflow-hidden rounded-2xl border border-slate-200 bg-slate-50 sm:grid-cols-5">{[["Eligible leads", staleOutreach.eligible], ["Sent deliveries", staleOutreach.counts.sent || 0], ["Failed deliveries", staleOutreach.counts.failed || 0], ["Skipped", staleOutreach.counts.skipped || 0], ["Last checked", staleOutreach.settings.staleOutreachLastRunAt ? new Date(staleOutreach.settings.staleOutreachLastRunAt).toLocaleString("en-CA", { dateStyle: "medium", timeStyle: "short" }) : "Not yet"]].map(([label, value], index) => <div key={label} className={`px-4 py-4 ${index ? "border-l border-slate-200" : ""}`}><p className="text-[11px] font-medium text-slate-400">{label}</p><p className="mt-1 text-sm font-semibold text-slate-900">{value}</p></div>)}</div>
        {outreachRunNotice ? <p className="mt-3 rounded-2xl bg-emerald-50 px-4 py-3 text-xs font-medium text-emerald-700">{outreachRunNotice}</p> : null}
        {staleOutreach.recent.length ? <div className="mt-5"><div className="mb-2 flex items-center justify-between"><h3 className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-400">Recent delivery log</h3><p className="text-[11px] text-slate-400">Full message is also saved under each lead’s Messages tab</p></div><div className="divide-y divide-slate-100 rounded-2xl border border-slate-200">{staleOutreach.recent.slice(0, 8).map((delivery) => <div key={delivery.id} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center"><div className="min-w-0 flex-1"><Link to={`/leads?lead=${encodeURIComponent(delivery.leadId)}`} className="truncate text-sm font-semibold text-slate-800 hover:text-brand-700 hover:underline">{[delivery.lead.firstName, delivery.lead.lastName].filter(Boolean).join(" ") || delivery.lead.leadNumber}</Link><p className="mt-0.5 truncate text-xs text-slate-400">{delivery.lead.leadNumber} · {delivery.channel === "sms" ? "SMS" : "Email"} · {delivery.recipient}</p></div><div className="flex items-center gap-3"><Pill value={String(delivery.status).toUpperCase()} /><time className="text-[11px] text-slate-400">{new Date(delivery.sentAt || delivery.failedAt || delivery.createdAt).toLocaleString("en-CA", { dateStyle: "medium", timeStyle: "short" })}</time></div>{delivery.lastError ? <p className="text-xs text-rose-600 sm:max-w-xs">{delivery.lastError}</p> : null}</div>)}</div></div> : null}
      </section> : null}
      <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-[0_14px_40px_rgba(28,45,74,0.04)]">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-rose-50 text-rose-700"><BellRing className="h-5 w-5" /></div>
            <div>
              <h2 className="font-semibold text-slate-950">Overdue-lead alerts</h2>
              <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-500">Once a day, anyone with an overdue next action gets a personal digest note. If one person's overdue count crosses the threshold below, admins get their own alert too — so a backlog gets caught before it piles onto one person.</p>
            </div>
          </div>
          <button disabled={busy || !leadSettings} onClick={() => updateOverdueAlert({ overdueAlertEnabled: !leadSettings?.overdueAlertEnabled })} className={`inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-full px-4 text-sm font-semibold transition disabled:opacity-50 ${leadSettings?.overdueAlertEnabled ? "bg-emerald-600 text-white" : "border border-slate-200 text-slate-600 hover:bg-slate-50"}`}>{leadSettings?.overdueAlertEnabled ? <Check className="h-4 w-4" /> : null}{leadSettings?.overdueAlertEnabled ? "Automation on" : "Automation off"}</button>
        </div>
        <div className="mt-5 grid gap-3 sm:grid-cols-[220px_auto] sm:items-end">
          <label className="text-xs font-semibold text-slate-500">Alert admins once someone reaches
            <input type="number" min="1" max="100" value={leadSettings?.overdueAlertAdminThreshold ?? 5} onChange={(event) => updateOverdueAlert({ overdueAlertAdminThreshold: Number(event.target.value) })} className={`${inputClass} mt-1.5`} />
          </label>
          <p className="text-xs text-slate-400">overdue leads under one owner{leadSettings?.overdueAlertLastRunAt ? ` · Last checked ${new Date(leadSettings.overdueAlertLastRunAt).toLocaleString("en-CA", { dateStyle: "medium", timeStyle: "short" })}` : ""}</p>
        </div>
      </section>
      <section className="flex flex-col gap-4 rounded-3xl border border-slate-200 bg-white p-5 sm:flex-row sm:items-center sm:justify-between"><div className="flex items-start gap-3"><div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-700"><ShieldCheck className="h-5 w-5" /></div><div><h2 className="font-semibold text-slate-950">External lead connections</h2><p className="mt-1 max-w-2xl text-sm text-slate-500">Connect Meta, WhatsApp, Google Ads, email, phone providers, or a custom website backend to universal intake.</p>{!secureStorageReady ? <p className="mt-2 text-xs font-semibold text-rose-600">Secure credential storage must be configured before creating a connector.</p> : null}</div></div><button disabled={!secureStorageReady} onClick={() => setWebsiteOpen(true)} className="inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-full bg-slate-900 px-4 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-slate-300"><Plus className="h-4 w-4" />New connector</button></section>
      {!websiteConnections.length ? <Empty icon={Code2} title="No external connections" copy="Create a connection for the first external lead stream." /> : <div className="grid gap-3 xl:grid-cols-2">{websiteConnections.map((connection) => <article key={connection.id} className="rounded-3xl border border-slate-200 bg-white p-5 shadow-[0_14px_40px_rgba(28,45,74,0.05)]"><div className="flex items-start justify-between gap-3"><div><div className="flex flex-wrap items-center gap-2"><h3 className="font-semibold text-slate-950">{connection.name}</h3><span className="rounded-full bg-brand-50 px-2.5 py-1 text-[10px] font-semibold text-brand-700">{providerLabels[connection.provider] || connection.provider}</span><Pill value={connection.isActive ? "ACTIVE" : "PAUSED"} /></div><p className="mt-1 text-xs text-slate-500">{connection.source.name} · {connection.owner.fullName} · {connection.firstResponseMinutes} min target</p></div><Code2 className="h-5 w-5 text-brand-500" /></div><div className="mt-4 flex min-w-0 items-center gap-2 rounded-2xl bg-slate-50 p-2 pl-3"><p className="min-w-0 flex-1 truncate font-mono text-[11px] text-slate-500">{connection.webhookUrl}</p><button onClick={() => copyText(connection.webhookUrl, `url-${connection.id}`)} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white text-slate-600 shadow-sm">{copied === `url-${connection.id}` ? <Check className="h-4 w-4 text-emerald-600" /> : <Clipboard className="h-4 w-4" />}</button></div><div className="mt-4 flex flex-wrap items-center gap-2"><button onClick={() => rotateWebsiteSecret(connection)} disabled={busy} className="inline-flex h-9 items-center gap-1.5 rounded-full border border-slate-200 px-3.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"><KeyRound className="h-3.5 w-3.5" />Update secret</button><button onClick={() => toggleWebsiteConnection(connection)} disabled={busy} className="h-9 rounded-full border border-slate-200 px-3.5 text-xs font-semibold text-slate-600 hover:bg-slate-50">{connection.isActive ? "Pause" : "Activate"}</button><span className="ml-auto text-[11px] text-slate-400">{connection.lastEventAt ? `Last event ${new Date(connection.lastEventAt).toLocaleString()}` : "No events received"}</span></div></article>)}</div>}
    </div> : null}

    {tab === "imports" ? <div className="space-y-4"><section className="rounded-3xl border border-slate-200 bg-white p-5"><div><h2 className="font-semibold text-slate-950">Import a CSV</h2><p className="mt-1 text-sm text-slate-500">Map columns, validate every row, then queue only valid leads.</p></div><div className="mt-5 grid gap-3 md:grid-cols-3"><select className={inputClass} value={importSource} onChange={(e) => setImportSource(e.target.value)}>{sources.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select><select className={inputClass} value={importOwner} onChange={(e) => setImportOwner(e.target.value)}>{staff.map((item) => <option key={item.id} value={item.id}>{item.fullName}</option>)}</select><button onClick={() => fileRef.current?.click()} className="inline-flex h-11 items-center justify-center gap-2 rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-4 text-sm font-semibold text-slate-700"><Upload className="h-4 w-4" />{file?.name || "Choose CSV"}</button><input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden" onChange={(event) => chooseFile(event.target.files?.[0])} /></div>
        {headers.length ? <div className="mt-5"><p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-400">Column mapping</p><div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{fields.map(([field, label]) => <label key={field} className="text-xs font-medium text-slate-600">{label}{field === "phone" ? " *" : ""}<select value={mapping[field] || ""} onChange={(e) => setMapping((current) => ({ ...current, [field]: e.target.value || undefined }))} className="mt-1.5 h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none focus:border-brand-300"><option value="">Not mapped</option>{headers.map((header) => <option key={header} value={header}>{header}</option>)}</select></label>)}</div><button onClick={previewCsv} disabled={busy || !mapping.phone} className="mt-4 inline-flex h-10 items-center rounded-full bg-brand-600 px-5 text-sm font-semibold text-white disabled:bg-slate-300">Validate and preview</button></div> : null}</section>
      {preview ? <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white"><div className="flex flex-col gap-3 border-b border-slate-200 px-5 py-4 sm:flex-row sm:items-center sm:justify-between"><div><h2 className="font-semibold text-slate-950">{preview.fileName}</h2><p className="mt-1 text-xs text-slate-500">{preview.validRows} valid · {preview.invalidRows} invalid · {preview.totalRows} total</p></div>{preview.status === "PREVIEW" ? <button onClick={commit} disabled={busy || !preview.validRows} className="h-10 rounded-full bg-slate-900 px-5 text-sm font-semibold text-white disabled:bg-slate-300">Import {preview.validRows} valid rows</button> : <Pill value={preview.status} />}</div><div className="max-h-[420px] overflow-auto"><table className="w-full min-w-[760px] text-left text-sm"><thead className="sticky top-0 bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500"><tr><th className="px-5 py-3">Row</th><th className="px-4 py-3">Name</th><th className="px-4 py-3">Phone</th><th className="px-4 py-3">Email</th><th className="px-4 py-3">Validation</th></tr></thead><tbody>{preview.rows?.map((row) => <tr key={row.id} className="border-t border-slate-100"><td className="px-5 py-3 text-slate-400">{row.rowNumber}</td><td className="px-4 py-3 font-medium text-slate-800">{[row.normalizedData?.firstName, row.normalizedData?.lastName].filter(Boolean).join(" ") || "—"}</td><td className="px-4 py-3 text-slate-600">{row.normalizedData?.phone || "—"}</td><td className="px-4 py-3 text-slate-600">{row.normalizedData?.email || "—"}</td><td className="px-4 py-3">{row.validationErrors?.length ? <span className="text-xs text-rose-600">{row.validationErrors.join(" ")}</span> : <Pill value={row.status} />}</td></tr>)}</tbody></table></div></section> : null}
      <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white"><div className="border-b border-slate-200 px-5 py-4"><h2 className="font-semibold text-slate-950">Import history</h2></div>{!imports.length ? <Empty icon={FileSpreadsheet} title="No imports yet" copy="Your validated CSV batches will remain here for audit and progress tracking." /> : <div>{imports.map((batch) => <button key={batch.id} onClick={async () => { const result = await api.get(`/leads/imports/${batch.id}`); setPreview(result.data.data); }} className="flex w-full items-center gap-4 border-b border-slate-100 px-5 py-4 text-left last:border-0 hover:bg-slate-50"><div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold text-slate-900">{batch.fileName}</p><p className="mt-1 text-xs text-slate-500">{batch.source.name} · {batch.totalRows} rows · {batch.processedRows} created · {batch.duplicateRows} possible duplicates</p></div><Pill value={batch.status} /></button>)}</div>}</section></div> : null}

    {tab === "events" ? <div className="space-y-4">{operations ? <section className="grid grid-cols-2 overflow-hidden rounded-2xl border border-slate-200 bg-white sm:grid-cols-4">{[["Pending", operations.counts.PENDING || 0], ["Processing", operations.counts.PROCESSING || 0], ["Failed", operations.counts.FAILED || 0], ["Oldest wait", operations.oldestPendingSeconds ? `${operations.oldestPendingSeconds}s` : "Clear"]].map(([label, value], index) => <div key={label} className={`px-4 py-4 ${index ? "border-l border-slate-100" : ""}`}><p className="text-xs font-medium text-slate-400">{label}</p><p className="mt-1 text-xl font-semibold text-slate-900">{value}</p></div>)}</section> : null}<section className="overflow-hidden rounded-3xl border border-slate-200 bg-white"><div className="border-b border-slate-200 px-5 py-4"><h2 className="font-semibold text-slate-950">Incoming events</h2><p className="mt-1 text-xs text-slate-500">Raw submissions move through validation, duplicate review, and lead creation in the background.</p></div>{!events.length ? <Empty icon={Inbox} title="No incoming events" copy="Public submissions and committed CSV rows will appear here." /> : <div className="divide-y divide-slate-100">{events.map((event) => <div id={`lead-event-${event.id}`} key={event.id} className={`flex flex-col gap-3 px-5 py-4 transition-[background-color,box-shadow] duration-[3800ms] sm:flex-row sm:items-center ${focusedEventId === event.id ? "bg-amber-100 ring-2 ring-inset ring-amber-300" : "bg-white"}`}><div className="min-w-0 flex-1"><p className="text-sm font-semibold text-slate-900">{[event.normalizedPayload?.firstName || event.rawPayload?.firstName, event.normalizedPayload?.lastName || event.rawPayload?.lastName].filter(Boolean).join(" ") || "Unnamed lead"}</p><p className="mt-1 truncate text-xs text-slate-500">{event.source.name} · {humanize(event.channel)} · {new Date(event.createdAt).toLocaleString()}</p>{event.lastError ? <p className="mt-1 text-xs text-rose-600">{event.lastError}</p> : null}</div>{event.status === "FAILED" && role === "admin" ? <button disabled={busy} onClick={() => retryEvent(event.id)} className="h-8 rounded-full border border-rose-200 px-3 text-xs font-semibold text-rose-700 hover:bg-rose-50">Retry</button> : null}{event.processedLead ? <a href={`/leads?search=${event.processedLead.leadNumber}`} className="text-xs font-semibold text-brand-600">{event.processedLead.leadNumber}</a> : null}{event.duplicateCandidates?.length ? <button type="button" onClick={() => setReviewingEventId(event.id)} className="h-8 rounded-full bg-violet-50 px-3 text-xs font-semibold text-violet-700 hover:bg-violet-100">{event.duplicateCandidates.length} match{event.duplicateCandidates.length > 1 ? "es" : ""} — review</button> : null}<Pill value={event.status} /></div>)}</div>}</section></div> : null}

    {websiteOpen ? <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/35 p-4 backdrop-blur-sm" onMouseDown={() => setWebsiteOpen(false)}><form onSubmit={createWebsiteConnection} onMouseDown={(e) => e.stopPropagation()} className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-[28px] bg-white p-6 shadow-2xl [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"><h2 className="text-xl font-semibold tracking-tight text-slate-950">New external connection</h2><p className="mt-1 text-sm text-slate-500">Route a provider into the universal intake pipeline.</p><div className="mt-5 space-y-3"><select value={connectorProvider} onChange={(event) => setConnectorProvider(event.target.value)} className={inputClass}>{Object.entries(providerLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select><input name="name" required maxLength="120" className={inputClass} placeholder={`${providerLabels[connectorProvider]} connection`} />{["META", "WHATSAPP"].includes(connectorProvider) ? <label className="block text-xs font-medium text-slate-500">Provider app secret<input name="providerSecret" type="password" required autoComplete="new-password" className={`${inputClass} mt-1.5`} placeholder="Stored encrypted and never displayed" /></label> : null}{connectorProvider === "META" ? <label className="block text-xs font-medium text-slate-500">Page or system-user access token<input name="providerAccessToken" type="password" required autoComplete="new-password" className={`${inputClass} mt-1.5`} placeholder="Used by the worker to retrieve lead details" /></label> : null}<select name="sourceId" required className={inputClass}><option value="">Select source</option>{sources.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select><select name="ownerUserId" required className={inputClass}><option value="">Assign consultant</option>{staff.map((item) => <option key={item.id} value={item.id}>{item.fullName}</option>)}</select><label className="block text-xs font-medium text-slate-500">First response target<input name="firstResponseMinutes" type="number" min="1" max="10080" defaultValue="15" className={`${inputClass} mt-1.5`} /></label><label className="block text-xs font-medium text-slate-500">Allowed origins <span className="font-normal text-slate-400">(optional)</span><textarea name="allowedOrigins" rows="2" className="mt-1.5 w-full resize-none rounded-2xl border border-slate-200 p-4 text-sm outline-none focus:border-brand-300 focus:ring-4 focus:ring-brand-100" placeholder="https://www.example.com" /></label></div><div className="mt-6 flex justify-end gap-2"><button type="button" onClick={() => setWebsiteOpen(false)} className="h-10 rounded-full px-4 text-sm font-semibold text-slate-600">Cancel</button><button disabled={busy} className="h-10 rounded-full bg-slate-900 px-5 text-sm font-semibold text-white">Create connection</button></div></form></div> : null}

    {credentials ? <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/45 p-4 backdrop-blur-sm"><div className="w-full max-w-xl rounded-[28px] bg-white p-6 shadow-2xl"><div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-amber-50 text-amber-700"><KeyRound className="h-5 w-5" /></div><h2 className="mt-4 text-xl font-semibold tracking-tight text-slate-950">Save the connection details now</h2><p className="mt-1 text-sm leading-6 text-slate-500">Configure these values in {providerLabels[credentials.provider] || credentials.provider}. Generated secrets will not be displayed again.</p><div className="mt-5 space-y-3">{[["Webhook URL", credentials.webhookUrl, "credential-url"], ["Signing / lead key", credentials.signingSecret, "credential-secret"], ["Webhook verification token", ["META", "WHATSAPP"].includes(credentials.provider) ? credentials.verificationToken : null, "credential-verification"]].filter(([, value]) => value).map(([label, value, id]) => <div key={id}><p className="mb-1.5 text-xs font-semibold text-slate-500">{label}</p><div className="flex min-w-0 items-center gap-2 rounded-2xl bg-slate-100 p-2 pl-3"><p className="min-w-0 flex-1 break-all font-mono text-xs text-slate-700">{value}</p><button onClick={() => copyText(value, id)} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white shadow-sm">{copied === id ? <Check className="h-4 w-4 text-emerald-600" /> : <Clipboard className="h-4 w-4" />}</button></div></div>)}</div><button onClick={() => setCredentials(null)} className="mt-6 h-11 w-full rounded-full bg-slate-950 text-sm font-semibold text-white">I saved these details</button></div></div> : null}

    {formOpen ? <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/35 p-4 backdrop-blur-sm" onMouseDown={() => setFormOpen(false)}><form onSubmit={createForm} onMouseDown={(e) => e.stopPropagation()} className="w-full max-w-lg rounded-[28px] bg-white p-6 shadow-2xl"><h2 className="text-xl font-semibold tracking-tight text-slate-950">New public intake form</h2><p className="mt-1 text-sm text-slate-500">Give this stream a source, consultant, and response target.</p><div className="mt-5 space-y-3"><input name="name" required maxLength="120" className={inputClass} placeholder="Form name, e.g. Website consultation" /><select name="sourceId" required className={inputClass}><option value="">Select source</option>{sources.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select><select name="ownerUserId" required className={inputClass}><option value="">Assign consultant</option>{staff.map((item) => <option key={item.id} value={item.id}>{item.fullName}</option>)}</select><label className="block text-xs font-medium text-slate-500">First response target<input name="firstResponseMinutes" type="number" min="1" max="10080" defaultValue="15" className={`${inputClass} mt-1.5`} /></label><textarea name="successMessage" rows="3" maxLength="500" className="w-full resize-none rounded-2xl border border-slate-200 p-4 text-sm outline-none focus:border-brand-300 focus:ring-4 focus:ring-brand-100" defaultValue="Thank you. Our team will contact you shortly." /></div><div className="mt-6 flex justify-end gap-2"><button type="button" onClick={() => setFormOpen(false)} className="h-10 rounded-full px-4 text-sm font-semibold text-slate-600">Cancel</button><button disabled={busy} className="h-10 rounded-full bg-slate-900 px-5 text-sm font-semibold text-white">Create form</button></div></form></div> : null}
    {reviewingEventId ? <DuplicateReviewSheet eventId={reviewingEventId} onClose={() => setReviewingEventId("")} onResolved={async () => { setReviewingEventId(""); await load(true); }} /> : null}
  </section>;
}
