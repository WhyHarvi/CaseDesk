import {
  AlertCircle,
  CalendarClock,
  CheckCircle2,
  ExternalLink,
  Loader2,
  Mail,
  RefreshCw,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useAuth } from "../../auth/AuthContext";
import api from "../../services/api";

const emptyCalendarStats = { active: false, scope: null, synced: 0, pending: 0, failed: 0, lastSyncedAt: null };

const ACCENT_OPTIONS = [
  { value: "#002FA7", label: "Brand blue" },
  { value: "#0f172a", label: "Slate" },
  { value: "#047857", label: "Emerald" },
  { value: "#9f1239", label: "Burgundy" },
];

const emptySignatureFields = { name: "", title: "", company: "", phone: "", email: "", tagline: "", accent: ACCENT_OPTIONS[0].value };

function escapeSignatureHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// Structured fields round-trip through a leading HTML comment ahead of the
// visible signature markup — mail clients render comments as nothing, so it
// never shows up in a sent email, but it's what lets someone reopen Settings
// later and edit the same name/title/phone fields instead of starting over.
function encodeSignatureMeta(fields) {
  return `<!--casedesk-signature-fields:${encodeURIComponent(JSON.stringify(fields))}-->`;
}
function decodeSignatureMeta(html) {
  const match = /^<!--casedesk-signature-fields:([^>]*)-->/.exec(String(html || "").trim());
  if (!match) return null;
  try {
    const parsed = JSON.parse(decodeURIComponent(match[1]));
    return parsed && typeof parsed === "object" ? { ...emptySignatureFields, ...parsed } : null;
  } catch {
    return null;
  }
}

// Real @font-face / Google Fonts get stripped by most mail clients, so a
// "handwritten" look here leans on script fonts that ship with Windows and
// macOS themselves (Segoe Script, Bradley Hand) — these actually render in
// Outlook/Apple Mail without any font ever being downloaded, falling back to
// the browser's generic cursive elsewhere.
const SCRIPT_FONT_STACK = "'Segoe Script','Bradley Hand','Brush Script MT',cursive";

function buildSignatureHtml({ name, title, company, phone, email, tagline, accent } = emptySignatureFields) {
  const safeName = escapeSignatureHtml(name).trim();
  if (!safeName && !title?.trim() && !phone?.trim() && !email?.trim() && !tagline?.trim()) return "";
  const color = ACCENT_OPTIONS.some((option) => option.value === accent) ? accent : ACCENT_OPTIONS[0].value;
  const titleLine = [escapeSignatureHtml(title).trim(), escapeSignatureHtml(company).trim()].filter(Boolean).join(" &middot; ");
  const contactParts = [];
  if (phone?.trim()) {
    const telHref = phone.replace(/[^\d+]/g, "");
    contactParts.push(`<a href="tel:${escapeSignatureHtml(telHref)}" style="color:#64748b;text-decoration:none;">${escapeSignatureHtml(phone.trim())}</a>`);
  }
  if (email?.trim()) {
    contactParts.push(`<a href="mailto:${escapeSignatureHtml(email.trim())}" style="color:#64748b;text-decoration:none;">${escapeSignatureHtml(email.trim())}</a>`);
  }
  return [
    '<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;font-family:Arial,Helvetica,sans-serif;">',
    `<tr><td style="padding:0 0 2px 0;"><span style="font-family:${SCRIPT_FONT_STACK};font-size:27px;line-height:1.25;color:${color};">${safeName || "&nbsp;"}</span></td></tr>`,
    titleLine ? `<tr><td style="padding:0 0 6px 0;font-size:13px;color:#475569;">${titleLine}</td></tr>` : "",
    `<tr><td style="padding:0 0 8px 0;"><span style="display:inline-block;width:56px;height:2px;background-color:${color};font-size:0;line-height:0;">&nbsp;</span></td></tr>`,
    contactParts.length ? `<tr><td style="font-size:12px;color:#64748b;">${contactParts.join(" &nbsp;&middot;&nbsp; ")}</td></tr>` : "",
    tagline?.trim() ? `<tr><td style="padding-top:4px;font-size:11px;color:#94a3b8;">${escapeSignatureHtml(tagline.trim())}</td></tr>` : "",
    "</table>",
  ].filter(Boolean).join("");
}

const empty = {
  configured: false,
  connected: false,
  emailAddress: "",
  displayName: "",
  status: "disconnected",
  calendarScopeGranted: false,
  calendarSyncReady: false,
  calendarSyncEnabled: true,
  syncEnabled: true,
  signatureHtml: "",
  lastSyncedAt: null,
  lastSyncStatus: null,
  lastSyncMessage: null,
  lastError: null,
};

function Notice({ error = false, children }) {
  const Icon = error ? AlertCircle : CheckCircle2;
  return (
    <div className={`flex items-start gap-3 rounded-3xl border px-4 py-3 text-sm ${error ? "border-rose-100 bg-rose-50/80 text-rose-800" : "border-emerald-100 bg-emerald-50/80 text-emerald-800"}`}>
      <Icon className="mt-0.5 h-4 w-4 shrink-0" />
      <span>{children}</span>
    </div>
  );
}

export default function PersonalMailboxSettingsPanel() {
  const { appUser, agency } = useAuth();
  const [searchParams] = useSearchParams();
  const [mailbox, setMailbox] = useState(empty);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [calendarToggling, setCalendarToggling] = useState(false);
  const [calendarStats, setCalendarStats] = useState(emptyCalendarStats);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [sig, setSig] = useState(emptySignatureFields);
  const sigInitializedRef = useRef(false);

  // Seeded once, the first time a connected mailbox's saved signature (or
  // lack of one) is known — reusing whatever fields were saved before, or
  // falling back to the account's own name/title/phone so the builder
  // never opens completely blank. Never re-seeds after that, so it can't
  // clobber changes the person is mid-way through typing.
  useEffect(() => {
    if (sigInitializedRef.current || !mailbox.connected) return;
    sigInitializedRef.current = true;
    const decoded = decodeSignatureMeta(mailbox.signatureHtml);
    setSig(decoded || {
      ...emptySignatureFields,
      name: appUser?.fullName || mailbox.displayName || "",
      title: appUser?.jobTitle || "",
      company: agency?.name || "",
      phone: appUser?.phone || "",
      email: mailbox.emailAddress || "",
    });
  }, [mailbox.connected, mailbox.signatureHtml, mailbox.displayName, mailbox.emailAddress, appUser, agency]);

  const visibleSignatureHtml = useMemo(() => buildSignatureHtml(sig), [sig]);
  const hasLegacySignature = Boolean(mailbox.signatureHtml) && !decodeSignatureMeta(mailbox.signatureHtml);

  const load = async (fresh = false) => {
    try {
      const response = fresh ? await api.getFresh("/mailboxes/me") : await api.get("/mailboxes/me");
      setMailbox((current) => ({ ...current, ...response.data.data }));
    } catch (reason) {
      setError(reason.response?.data?.message || "Your mailbox status could not be loaded.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load(true);
    const result = searchParams.get("mailbox");
    if (result === "connected") setNotice("Your Microsoft mailbox is connected and ready.");
    if (["denied", "invalid", "error"].includes(result)) {
      setError(searchParams.get("message") || "The Microsoft mailbox could not be connected.");
    }
  }, []);

  const loadCalendarStats = async () => {
    try {
      const response = await api.get("/mailboxes/me/calendar-sync-status");
      setCalendarStats(response.data.data);
    } catch {
      // Silent — this is a background live-status poll, not a user action;
      // the calendar sync card just keeps showing its last-known numbers.
    }
  };

  // Real counts instead of a static "Syncing" badge, refreshed every few
  // seconds so the card visibly moves while appointments are still catching
  // up — this only runs while the card is actually showing a ready state.
  useEffect(() => {
    if (!mailbox.calendarSyncReady) {
      setCalendarStats(emptyCalendarStats);
      return undefined;
    }
    void loadCalendarStats();
    const interval = setInterval(loadCalendarStats, 4_000);
    return () => clearInterval(interval);
  }, [mailbox.calendarSyncReady]);

  const connect = async () => {
    try {
      setConnecting(true);
      setError("");
      const response = await api.post("/mailboxes/microsoft/connect");
      window.location.assign(response.data.data.url);
    } catch (reason) {
      setConnecting(false);
      setError(reason.response?.data?.message || "Microsoft sign-in could not be started.");
    }
  };

  const toggleCalendarSync = async () => {
    // Already have Microsoft's permission — this is just our own on/off
    // switch, so it's a plain preference save, not another OAuth round trip.
    try {
      setCalendarToggling(true);
      setError("");
      const response = await api.patch("/mailboxes/me", { calendarSyncEnabled: !mailbox.calendarSyncEnabled });
      setMailbox((current) => ({ ...current, ...response.data.data }));
    } catch (reason) {
      setError(reason.response?.data?.message || "Calendar sync could not be updated.");
    } finally {
      setCalendarToggling(false);
    }
  };

  const save = async () => {
    try {
      setSaving(true);
      setError("");
      const signatureHtml = visibleSignatureHtml ? `${encodeSignatureMeta(sig)}\n${visibleSignatureHtml}` : "";
      const response = await api.patch("/mailboxes/me", {
        syncEnabled: mailbox.syncEnabled,
        signatureHtml,
      });
      setMailbox((current) => ({ ...current, ...response.data.data }));
      setNotice("Mailbox preferences saved.");
    } catch (reason) {
      setError(reason.response?.data?.message || "Mailbox preferences could not be saved.");
    } finally {
      setSaving(false);
    }
  };

  const removeSignature = async () => {
    setSig(emptySignatureFields);
    try {
      setSaving(true);
      setError("");
      const response = await api.patch("/mailboxes/me", { syncEnabled: mailbox.syncEnabled, signatureHtml: "" });
      setMailbox((current) => ({ ...current, ...response.data.data }));
      setNotice("Signature removed.");
    } catch (reason) {
      setError(reason.response?.data?.message || "The signature could not be removed.");
    } finally {
      setSaving(false);
    }
  };

  const disconnect = async () => {
    if (!window.confirm("Disconnect your Microsoft mailbox from CaseDesk?")) return;
    try {
      setDisconnecting(true);
      setError("");
      await api.delete("/mailboxes/me");
      setMailbox({ ...empty, configured: mailbox.configured });
      setNotice("Your Microsoft mailbox has been disconnected.");
    } catch (reason) {
      setError(reason.response?.data?.message || "Your mailbox could not be disconnected.");
    } finally {
      setDisconnecting(false);
    }
  };

  if (loading) return <div className="h-80 animate-pulse rounded-[2rem] border border-white/80 bg-slate-100/70" />;

  return (
    <div className="relative isolate overflow-hidden rounded-[2.35rem] border border-white/80 bg-gradient-to-br from-sky-50 via-white to-indigo-50 p-5 shadow-[0_24px_70px_rgba(15,23,42,0.08)] sm:p-8">
      <div className="pointer-events-none absolute -left-24 top-20 -z-10 h-72 w-72 rounded-full bg-sky-300/25 blur-3xl" />
      <div className="pointer-events-none absolute -right-24 top-44 -z-10 h-72 w-72 rounded-full bg-indigo-300/20 blur-3xl" />

      <header className="max-w-2xl">
        <div className="flex h-12 w-12 items-center justify-center rounded-[1.15rem] border border-white/90 bg-white/70 text-sky-600 shadow-[0_12px_30px_rgba(14,165,233,0.14)] backdrop-blur-xl">
          <Mail className="h-5 w-5" />
        </div>
        <p className="mt-5 text-xs font-semibold uppercase tracking-[0.17em] text-sky-600">Personal communication</p>
        <h2 className="mt-1.5 text-3xl font-semibold tracking-[-0.04em] text-slate-950">Your Microsoft mailbox</h2>
        <p className="mt-2 text-[15px] leading-6 text-slate-600">
          Send client email from your own address, bring matching replies into CaseDesk, and mirror your appointments onto your Outlook calendar. Your Microsoft password is never shared with us.
        </p>
      </header>

      <div className="mt-5 space-y-3">
        {notice ? <Notice>{notice}</Notice> : null}
        {error ? <Notice error>{error}</Notice> : null}
      </div>

      {!mailbox.connected ? (
        <section className="mt-6 rounded-[2rem] border border-white/90 bg-white/60 p-5 shadow-[0_18px_45px_rgba(15,23,42,0.06)] backdrop-blur-2xl sm:p-6">
          <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex gap-4">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-[#eef4ff] text-[#2563eb]"><ExternalLink className="h-5 w-5" /></span>
              <div>
                <h3 className="font-semibold text-slate-950">Connect with Microsoft</h3>
                <p className="mt-1 max-w-lg text-sm leading-6 text-slate-500">Sign in using your own work email. Microsoft will ask you to approve sending and reading mail for CRM synchronization.</p>
              </div>
            </div>
            <button type="button" disabled={connecting || !mailbox.configured} onClick={connect} className="inline-flex shrink-0 items-center justify-center gap-2 rounded-2xl bg-slate-950 px-5 py-3 text-sm font-semibold text-white shadow-lg transition hover:-translate-y-0.5 hover:bg-slate-800 disabled:opacity-50">
              {connecting ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
              {connecting ? "Opening Microsoft…" : "Connect Outlook"}
            </button>
          </div>
          {!mailbox.configured ? <p className="mt-4 rounded-2xl bg-amber-50 px-4 py-3 text-xs leading-5 text-amber-800">Microsoft connection credentials must be added to the CaseDesk server before team members can connect.</p> : null}
        </section>
      ) : (
        <div className="mt-6 space-y-4">
          <section className="rounded-[2rem] border border-white/90 bg-white/60 p-5 shadow-[0_18px_45px_rgba(15,23,42,0.06)] backdrop-blur-2xl sm:p-6">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-3">
                <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-600"><CheckCircle2 className="h-5 w-5" /></span>
                <div>
                  <p className="font-semibold text-slate-950">{mailbox.displayName || "Microsoft mailbox"}</p>
                  <p className="mt-0.5 text-sm text-slate-500">{mailbox.emailAddress}</p>
                </div>
              </div>
              <span className="w-fit rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-700">Connected</span>
            </div>
            <div className="mt-5 rounded-2xl border border-white/90 bg-white/55 px-4 py-3 text-xs leading-5 text-slate-500">
              <div className="flex items-center justify-between gap-3">
                <span>{mailbox.lastSyncMessage || "Mailbox synchronization is ready."}</span>
                <button type="button" onClick={() => load(true)} className="rounded-xl p-2 text-slate-500 transition hover:bg-white" aria-label="Refresh mailbox status"><RefreshCw className="h-4 w-4" /></button>
              </div>
              {mailbox.lastSyncedAt ? <p className="mt-1">Last checked {new Date(mailbox.lastSyncedAt).toLocaleString()}</p> : null}
            </div>
          </section>

          <section className="rounded-[2rem] border border-white/90 bg-white/60 p-5 shadow-[0_18px_45px_rgba(15,23,42,0.06)] backdrop-blur-2xl sm:p-6">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex gap-4">
                <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl ${mailbox.calendarSyncReady ? "bg-emerald-50 text-emerald-600" : "bg-slate-100 text-slate-500"}`}>
                  <CalendarClock className="h-5 w-5" />
                </span>
                <div>
                  <h3 className="font-semibold text-slate-950">Outlook calendar sync</h3>
                  <p className="mt-1 max-w-lg text-sm leading-6 text-slate-500">
                    {mailbox.calendarSyncReady
                      ? "Your CaseDesk appointments are mirrored onto your Outlook calendar as busy blocks — one way, nothing is read back, and clients are never emailed a Microsoft invite."
                      : "Mirror your CaseDesk appointments onto your Outlook calendar as busy blocks. One way — nothing is read back, and clients are never emailed a Microsoft invite."}
                  </p>
                </div>
              </div>
              <button
                type="button"
                disabled={connecting || calendarToggling}
                onClick={mailbox.calendarScopeGranted ? toggleCalendarSync : connect}
                className={`inline-flex shrink-0 items-center justify-center gap-2 rounded-2xl px-5 py-3 text-sm font-semibold shadow-lg transition hover:-translate-y-0.5 disabled:opacity-50 ${
                  mailbox.calendarSyncReady ? "border border-rose-100 bg-rose-50/80 text-rose-700 hover:bg-rose-100" : "bg-slate-950 text-white hover:bg-slate-800"
                }`}
              >
                {connecting || calendarToggling ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : mailbox.calendarSyncReady ? (
                  <CalendarClock className="h-4 w-4" />
                ) : (
                  <ShieldCheck className="h-4 w-4" />
                )}
                {connecting
                  ? "Opening Microsoft…"
                  : calendarToggling
                    ? "Updating…"
                    : mailbox.calendarSyncReady
                      ? "Cancel sync"
                      : "Turn on calendar sync"}
              </button>
            </div>

            {mailbox.calendarSyncReady ? (
              <div className="mt-5 rounded-2xl border border-white/90 bg-white/55 px-4 py-3 text-xs leading-5 text-slate-500">
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
                  <span className="inline-flex items-center gap-1.5 font-semibold text-slate-800">
                    {calendarStats.pending > 0 ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin text-sky-600" />
                    ) : (
                      <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                    )}
                    {calendarStats.pending > 0 ? `Syncing ${calendarStats.pending} more…` : "All caught up"}
                  </span>
                  <span>{calendarStats.synced} synced{calendarStats.scope === "agency" ? " across the agency" : ""}</span>
                  {calendarStats.failed > 0 ? <span className="font-semibold text-rose-600">{calendarStats.failed} failed</span> : null}
                </div>
                {calendarStats.lastSyncedAt ? <p className="mt-1.5">Last synced {new Date(calendarStats.lastSyncedAt).toLocaleTimeString()}</p> : null}
              </div>
            ) : null}
          </section>

          <section className="rounded-[2rem] border border-white/90 bg-white/60 p-5 shadow-[0_18px_45px_rgba(15,23,42,0.06)] backdrop-blur-2xl sm:p-6">
            <label className="flex items-start justify-between gap-5">
              <span><span className="block text-sm font-semibold text-slate-900">Synchronize client replies</span><span className="mt-1 block text-xs leading-5 text-slate-500">Only email matching CRM clients or existing CaseDesk threads is imported. Unrelated personal mail stays private.</span></span>
              <input type="checkbox" checked={mailbox.syncEnabled} onChange={(event) => setMailbox((current) => ({ ...current, syncEnabled: event.target.checked }))} className="mt-1 h-5 w-5 accent-sky-600" />
            </label>
            <div className="mt-6">
              <p className="text-sm font-semibold text-slate-900">Personal email signature</p>
              <p className="mt-1 text-xs leading-5 text-slate-500">Appears automatically at the bottom of every email you send through CaseDesk from this mailbox.</p>
              {hasLegacySignature ? (
                <p className="mt-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs leading-5 text-amber-800">You have a plain-text signature saved from before. Fill in the fields below and save to replace it with a styled one.</p>
              ) : null}

              <div className="mt-4 grid gap-5 lg:grid-cols-2">
                <div className="space-y-4">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <label className="block text-xs font-semibold text-slate-600">Full name
                      <input value={sig.name} onChange={(event) => setSig((current) => ({ ...current, name: event.target.value }))} className="mt-1.5 h-10 w-full rounded-xl border border-white/90 bg-white/70 px-3 text-sm text-slate-800 shadow-sm outline-none transition focus:border-sky-300 focus:ring-4 focus:ring-sky-100/70" placeholder="Gagandeep Singh" />
                    </label>
                    <label className="block text-xs font-semibold text-slate-600">Title
                      <input value={sig.title} onChange={(event) => setSig((current) => ({ ...current, title: event.target.value }))} className="mt-1.5 h-10 w-full rounded-xl border border-white/90 bg-white/70 px-3 text-sm text-slate-800 shadow-sm outline-none transition focus:border-sky-300 focus:ring-4 focus:ring-sky-100/70" placeholder="Senior Immigration Consultant" />
                    </label>
                    <label className="block text-xs font-semibold text-slate-600">Company
                      <input value={sig.company} onChange={(event) => setSig((current) => ({ ...current, company: event.target.value }))} className="mt-1.5 h-10 w-full rounded-xl border border-white/90 bg-white/70 px-3 text-sm text-slate-800 shadow-sm outline-none transition focus:border-sky-300 focus:ring-4 focus:ring-sky-100/70" placeholder="Agency name" />
                    </label>
                    <label className="block text-xs font-semibold text-slate-600">Phone
                      <input value={sig.phone} onChange={(event) => setSig((current) => ({ ...current, phone: event.target.value }))} className="mt-1.5 h-10 w-full rounded-xl border border-white/90 bg-white/70 px-3 text-sm text-slate-800 shadow-sm outline-none transition focus:border-sky-300 focus:ring-4 focus:ring-sky-100/70" placeholder="+1 (555) 123-4567" />
                    </label>
                    <label className="block text-xs font-semibold text-slate-600">Email
                      <input value={sig.email} onChange={(event) => setSig((current) => ({ ...current, email: event.target.value }))} className="mt-1.5 h-10 w-full rounded-xl border border-white/90 bg-white/70 px-3 text-sm text-slate-800 shadow-sm outline-none transition focus:border-sky-300 focus:ring-4 focus:ring-sky-100/70" placeholder={mailbox.emailAddress || "you@example.com"} />
                    </label>
                    <label className="block text-xs font-semibold text-slate-600">Tagline (optional)
                      <input value={sig.tagline} onChange={(event) => setSig((current) => ({ ...current, tagline: event.target.value }))} className="mt-1.5 h-10 w-full rounded-xl border border-white/90 bg-white/70 px-3 text-sm text-slate-800 shadow-sm outline-none transition focus:border-sky-300 focus:ring-4 focus:ring-sky-100/70" placeholder="RCIC #R123456" />
                    </label>
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-slate-600">Accent color</p>
                    <div className="mt-1.5 flex items-center gap-2">
                      {ACCENT_OPTIONS.map((option) => (
                        <button
                          key={option.value}
                          type="button"
                          onClick={() => setSig((current) => ({ ...current, accent: option.value }))}
                          aria-label={option.label}
                          aria-pressed={sig.accent === option.value}
                          title={option.label}
                          className={`h-7 w-7 rounded-full border-2 transition ${sig.accent === option.value ? "scale-110 border-slate-900" : "border-white/60"}`}
                          style={{ backgroundColor: option.value }}
                        />
                      ))}
                    </div>
                  </div>
                  {mailbox.signatureHtml ? (
                    <button type="button" disabled={saving} onClick={removeSignature} className="text-xs font-semibold text-rose-600 transition hover:underline disabled:opacity-50">Remove signature</button>
                  ) : null}
                </div>
                <div>
                  <p className="text-xs font-semibold text-slate-600">Preview</p>
                  <div className="mt-1.5 min-h-32 rounded-2xl border border-white/90 bg-white px-5 py-4 shadow-sm">
                    {visibleSignatureHtml ? <div dangerouslySetInnerHTML={{ __html: visibleSignatureHtml }} /> : <p className="text-sm text-slate-400">Fill in your name to see a preview.</p>}
                  </div>
                </div>
              </div>
            </div>
            <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
              <button type="button" disabled={disconnecting} onClick={disconnect} className="inline-flex items-center justify-center gap-2 rounded-2xl border border-rose-100 bg-rose-50/80 px-4 py-2.5 text-sm font-semibold text-rose-700 transition hover:bg-rose-100 disabled:opacity-50">
                {disconnecting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />} Disconnect
              </button>
              <button type="button" disabled={saving} onClick={save} className="inline-flex items-center justify-center gap-2 rounded-2xl bg-slate-950 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:opacity-50">
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />} {saving ? "Saving…" : "Save preferences"}
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
