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
import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import api from "../../services/api";

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
  const [searchParams] = useSearchParams();
  const [mailbox, setMailbox] = useState(empty);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [calendarToggling, setCalendarToggling] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

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
      const response = await api.patch("/mailboxes/me", {
        syncEnabled: mailbox.syncEnabled,
        signatureHtml: mailbox.signatureHtml,
      });
      setMailbox((current) => ({ ...current, ...response.data.data }));
      setNotice("Mailbox preferences saved.");
    } catch (reason) {
      setError(reason.response?.data?.message || "Mailbox preferences could not be saved.");
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
                      ? "Stop calendar sync"
                      : "Turn on calendar sync"}
              </button>
            </div>
          </section>

          <section className="rounded-[2rem] border border-white/90 bg-white/60 p-5 shadow-[0_18px_45px_rgba(15,23,42,0.06)] backdrop-blur-2xl sm:p-6">
            <label className="flex items-start justify-between gap-5">
              <span><span className="block text-sm font-semibold text-slate-900">Synchronize client replies</span><span className="mt-1 block text-xs leading-5 text-slate-500">Only email matching CRM clients or existing CaseDesk threads is imported. Unrelated personal mail stays private.</span></span>
              <input type="checkbox" checked={mailbox.syncEnabled} onChange={(event) => setMailbox((current) => ({ ...current, syncEnabled: event.target.checked }))} className="mt-1 h-5 w-5 accent-sky-600" />
            </label>
            <label className="mt-5 block text-sm font-semibold text-slate-900">
              Personal signature
              <textarea rows={5} value={mailbox.signatureHtml || ""} onChange={(event) => setMailbox((current) => ({ ...current, signatureHtml: event.target.value }))} className="mt-2 w-full resize-y rounded-2xl border border-white/90 bg-white/70 px-4 py-3 text-sm leading-6 text-slate-800 shadow-sm outline-none transition focus:border-sky-300 focus:ring-4 focus:ring-sky-100/70" placeholder="Your name, title, phone number, and office details" />
            </label>
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
