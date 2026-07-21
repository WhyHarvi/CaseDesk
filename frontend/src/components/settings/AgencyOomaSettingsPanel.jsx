import {
  AlertCircle,
  CheckCircle2,
  Copy,
  Loader2,
  MessageSquareText,
  RefreshCw,
  Send,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import { useEffect, useState } from "react";
import api from "../../services/api";

const inputClass =
  "mt-2 h-12 w-full rounded-2xl border border-white/80 bg-white/70 px-4 text-sm font-medium text-slate-900 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_8px_24px_rgba(15,23,42,0.04)] outline-none backdrop-blur-xl transition-all duration-300 placeholder:text-slate-400 focus:border-sky-300 focus:bg-white/90 focus:ring-4 focus:ring-sky-100/70 disabled:bg-slate-100/60 disabled:text-slate-400";

const glassCard =
  "relative overflow-hidden rounded-[2rem] border border-white/80 bg-white/62 p-5 shadow-[0_24px_70px_rgba(15,23,42,0.08),inset_0_1px_0_rgba(255,255,255,0.95)] backdrop-blur-2xl sm:p-6";

const blank = {
  canManage: true,
  secureStorageReady: true,
  fromNumber: "",
  webhookUrl: "",
  hasWebhook: false,
  lastWebhookAt: null,
  hasZapierOutboundWebhook: false,
  lastZapierOutboundTestedAt: null,
  lastZapierOutboundTestStatus: null,
  lastZapierOutboundTestMessage: null,
};

const errorMessage = (reason, fallback) =>
  reason?.response?.data?.message || fallback;

function StatusNotice({ type = "success", children }) {
  const failed = type === "error";
  const Icon = failed ? AlertCircle : CheckCircle2;
  return (
    <div
      className={`flex items-start gap-3 rounded-3xl border px-5 py-4 text-sm leading-6 shadow-sm backdrop-blur-xl ${
        failed
          ? "border-rose-100/80 bg-rose-50/80 text-rose-800"
          : "border-emerald-100/80 bg-emerald-50/80 text-emerald-800"
      }`}
    >
      <Icon className="mt-0.5 h-4 w-4 shrink-0" />
      {children}
    </div>
  );
}

function ConnectionBadge({ connected, pendingLabel = "Not connected" }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold shadow-sm backdrop-blur-xl ${
        connected
          ? "border-emerald-200/70 bg-emerald-50/80 text-emerald-700"
          : "border-white/80 bg-white/65 text-slate-600"
      }`}
    >
      {connected ? <CheckCircle2 className="h-3.5 w-3.5" /> : null}
      {connected ? "Connected" : pendingLabel}
    </span>
  );
}

export default function AgencyOomaSettingsPanel() {
  const [form, setForm] = useState(blank);
  const [loading, setLoading] = useState(true);
  const [generatingInbound, setGeneratingInbound] = useState(false);
  const [checkingInbound, setCheckingInbound] = useState(false);
  const [savingOutbound, setSavingOutbound] = useState(false);
  const [testingOutbound, setTestingOutbound] = useState(false);
  const [disconnectingOutbound, setDisconnectingOutbound] = useState(false);
  const [editingOutbound, setEditingOutbound] = useState(false);
  const [outboundWebhookUrl, setOutboundWebhookUrl] = useState("");
  const [testNumber, setTestNumber] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  const mergeSettings = (data) => {
    setForm((current) => ({ ...current, ...data }));
    if (!data?.hasZapierOutboundWebhook) setEditingOutbound(true);
  };

  useEffect(() => {
    let active = true;
    api
      .get("/settings/ooma")
      .then((response) => {
        if (active) mergeSettings(response.data.data);
      })
      .catch((reason) => {
        if (active)
          setError(errorMessage(reason, "Zapier communication settings could not be loaded."));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const copy = async (value, message) => {
    try {
      await navigator.clipboard.writeText(value);
      setNotice(message);
      setError("");
    } catch {
      setError("The value could not be copied. Select it and copy it manually.");
    }
  };

  const generateInbound = async () => {
    try {
      setGeneratingInbound(true);
      setError("");
      const response = await api.post("/settings/ooma/webhook-token");
      mergeSettings(response.data.data);
      setNotice(
        form.hasWebhook
          ? "A new inbound URL was generated. Replace the previous URL in your inbound Zap."
          : "Your inbound CaseDesk webhook URL is ready.",
      );
    } catch (reason) {
      setError(errorMessage(reason, "The inbound CaseDesk webhook could not be generated."));
    } finally {
      setGeneratingInbound(false);
    }
  };

  const checkInbound = async () => {
    try {
      setCheckingInbound(true);
      setError("");
      const response = await api.getFresh("/settings/ooma");
      mergeSettings(response.data.data);
    } catch (reason) {
      setError(errorMessage(reason, "CaseDesk could not check the latest inbound activity."));
    } finally {
      setCheckingInbound(false);
    }
  };

  const saveOutbound = async (event) => {
    event.preventDefault();
    try {
      setSavingOutbound(true);
      setError("");
      setNotice("");
      const response = await api.put("/settings/ooma/zapier-outbound", {
        webhookUrl: outboundWebhookUrl,
        fromNumber: form.fromNumber,
      });
      mergeSettings(response.data.data);
      setOutboundWebhookUrl("");
      setEditingOutbound(false);
      setNotice("Your sending connection is saved. Send a test message to finish setup.");
    } catch (reason) {
      setError(errorMessage(reason, "The outbound Zapier hook could not be saved."));
    } finally {
      setSavingOutbound(false);
    }
  };

  const testOutbound = async () => {
    try {
      setTestingOutbound(true);
      setError("");
      setNotice("");
      const response = await api.post(
        "/settings/ooma/zapier-outbound/test-sms",
        { to: testNumber },
        { timeout: 35000 },
      );
      mergeSettings(response.data.data);
      setNotice(
        "Zapier accepted the outbound test. Confirm the Zap continued to its Ooma Send SMS action and the phone received the text.",
      );
    } catch (reason) {
      if (reason?.response?.data?.data) mergeSettings(reason.response.data.data);
      setError(errorMessage(reason, "The outbound Zapier test failed."));
    } finally {
      setTestingOutbound(false);
    }
  };

  const disconnectOutbound = async () => {
    try {
      setDisconnectingOutbound(true);
      setError("");
      await api.delete("/settings/ooma/zapier-outbound");
      setForm((current) => ({
        ...current,
        hasZapierOutboundWebhook: false,
        lastZapierOutboundTestedAt: null,
        lastZapierOutboundTestStatus: null,
        lastZapierOutboundTestMessage: null,
      }));
      setEditingOutbound(true);
      setNotice("The sending connection has been removed.");
    } catch (reason) {
      setError(errorMessage(reason, "Outbound Zapier messaging could not be disconnected."));
    } finally {
      setDisconnectingOutbound(false);
    }
  };

  if (loading) {
    return (
      <div className="space-y-4 rounded-[2.25rem] bg-gradient-to-br from-sky-50 via-white to-indigo-50 p-5">
        {Array.from({ length: 3 }, (_, index) => (
          <div key={index} className="h-40 animate-pulse rounded-[2rem] border border-white/80 bg-white/60 backdrop-blur-xl" />
        ))}
      </div>
    );
  }

  const outboundConnected =
    form.hasZapierOutboundWebhook &&
    form.lastZapierOutboundTestStatus === "Connected";

  return (
    <div className="relative isolate overflow-hidden rounded-[2.4rem] border border-white/70 bg-gradient-to-br from-slate-50 via-sky-50/70 to-indigo-50/80 p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.9)] sm:p-7">
      <div className="pointer-events-none absolute -left-24 top-12 -z-10 h-72 w-72 rounded-full bg-sky-300/25 blur-3xl" aria-hidden="true" />
      <div className="pointer-events-none absolute -right-24 top-64 -z-10 h-80 w-80 rounded-full bg-indigo-300/20 blur-3xl" aria-hidden="true" />

      <div className="space-y-6">
      <header className="px-2 pb-2 pt-3 sm:px-3">
        <div className="flex h-12 w-12 items-center justify-center rounded-[1.15rem] border border-white/90 bg-white/70 text-sky-600 shadow-[0_12px_30px_rgba(14,165,233,0.14)] backdrop-blur-xl">
          <MessageSquareText className="h-5 w-5" />
        </div>
        <p className="mt-5 text-[12px] font-semibold uppercase tracking-[0.17em] text-sky-600">Phone &amp; messaging</p>
        <h2 className="mt-1.5 text-[30px] font-semibold leading-tight tracking-[-0.04em] text-slate-950 sm:text-[34px]">
          Connect Ooma
        </h2>
        <p className="mt-2 max-w-2xl text-[15px] leading-6 text-slate-600">
          Bring Ooma activity into CaseDesk and send client messages from one place. Zapier connects the two securely—no Ooma API key is needed.
        </p>
      </header>

      {!form.canManage ? (
        <StatusNotice type="error">Only a workspace administrator can change these connections.</StatusNotice>
      ) : null}
      {!form.secureStorageReady ? (
        <StatusNotice type="error">Secure integration storage is unavailable. Configure the server encryption key first.</StatusNotice>
      ) : null}
      {notice ? <StatusNotice>{notice}</StatusNotice> : null}
      {error ? <StatusNotice type="error">{error}</StatusNotice> : null}

      <section className={glassCard}>
        <div className="pointer-events-none absolute -right-12 -top-16 h-44 w-44 rounded-full bg-violet-200/35 blur-3xl" aria-hidden="true" />
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex min-w-0 gap-3">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-white/90 bg-white/75 text-violet-600 shadow-[0_10px_25px_rgba(124,58,237,0.12)] backdrop-blur-xl">
              <MessageSquareText className="h-5 w-5" />
            </span>
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-violet-500">Receive activity</p>
              <h3 className="mt-1 text-lg font-semibold tracking-[-0.02em] text-slate-950">Sync Ooma with CaseDesk</h3>
              <p className="mt-1 max-w-2xl text-sm leading-6 text-slate-600">
                Create a Zap that sends new Ooma calls and messages to your secure CaseDesk address.
              </p>
            </div>
          </div>
          <ConnectionBadge connected={Boolean(form.lastWebhookAt)} pendingLabel={form.hasWebhook ? "Waiting for event" : "Not configured"} />
        </div>

        {form.webhookUrl ? (
          <div className="mt-5 space-y-3">
            <div className="flex items-center gap-2 rounded-2xl border border-white/90 bg-white/65 p-2 shadow-sm backdrop-blur-xl">
              <input readOnly value={form.webhookUrl} aria-label="Inbound CaseDesk webhook URL" className="min-w-0 flex-1 bg-transparent px-2 text-xs text-slate-600 outline-none" />
              <button type="button" onClick={() => copy(form.webhookUrl, "CaseDesk address copied.")} className="inline-flex h-9 items-center gap-2 rounded-xl bg-slate-950 px-3 text-xs font-semibold text-white shadow-sm transition-all duration-200 hover:bg-slate-800 active:scale-[0.97]">
                <Copy className="h-4 w-4" /> Copy URL
              </button>
              <button type="button" disabled={!form.canManage || generatingInbound} onClick={generateInbound} aria-label="Generate a new CaseDesk address" className="flex h-9 w-9 items-center justify-center rounded-xl border border-white bg-white/80 text-slate-600 transition hover:bg-white disabled:opacity-50">
                <RefreshCw className={`h-4 w-4 ${generatingInbound ? "animate-spin" : ""}`} />
              </button>
            </div>
            <div className="flex flex-col gap-2 rounded-2xl border border-white/70 bg-white/45 px-4 py-3 backdrop-blur-xl sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-xs font-semibold text-violet-950">
                  {form.lastWebhookAt ? `Last event received ${new Date(form.lastWebhookAt).toLocaleString()}` : "Waiting for the first event from Zapier"}
                </p>
                <p className="mt-0.5 text-[11px] text-slate-500">Paste this address into your Zapier webhook action. Its security token is already included.</p>
              </div>
              <button type="button" disabled={checkingInbound} onClick={checkInbound} className="inline-flex items-center justify-center gap-2 rounded-xl border border-white/80 bg-white/70 px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-white disabled:opacity-50">
                <RefreshCw className={`h-3.5 w-3.5 ${checkingInbound ? "animate-spin" : ""}`} /> {checkingInbound ? "Checking…" : "Check connection"}
              </button>
            </div>
          </div>
        ) : (
          <button type="button" disabled={generatingInbound || !form.canManage || !form.secureStorageReady} onClick={generateInbound} className="mt-5 inline-flex items-center gap-2 rounded-2xl bg-slate-950 px-4 py-3 text-sm font-semibold text-white shadow-[0_12px_30px_rgba(15,23,42,0.16)] transition-all duration-200 hover:-translate-y-0.5 hover:bg-slate-800 active:translate-y-0 disabled:opacity-50">
            {generatingInbound ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
            {generatingInbound ? "Preparing…" : "Create CaseDesk connection"}
          </button>
        )}
      </section>

      <section className={glassCard}>
        <div className="pointer-events-none absolute -left-12 -bottom-16 h-44 w-44 rounded-full bg-sky-200/40 blur-3xl" aria-hidden="true" />
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex min-w-0 gap-3">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-white/90 bg-white/75 text-sky-600 shadow-[0_10px_25px_rgba(14,165,233,0.12)] backdrop-blur-xl">
              <Send className="h-5 w-5" />
            </span>
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-sky-500">Send messages</p>
              <h3 className="mt-1 text-lg font-semibold tracking-[-0.02em] text-slate-950">Message clients through Ooma</h3>
              <p className="mt-1 max-w-2xl text-sm leading-6 text-slate-600">
                Connect a Zapier Catch Hook so messages written in CaseDesk are delivered from your Ooma number.
              </p>
            </div>
          </div>
          <ConnectionBadge connected={outboundConnected} pendingLabel={form.hasZapierOutboundWebhook ? form.lastZapierOutboundTestStatus || "Test required" : "Not configured"} />
        </div>

        <ol className="mt-5 grid gap-2 text-sm leading-6 text-slate-700 sm:grid-cols-3">
          <li className="rounded-2xl border border-white/80 bg-white/48 px-4 py-3 backdrop-blur-xl"><strong className="mr-1 text-sky-600">1</strong> In Zapier, choose Webhooks by Zapier and Catch Hook.</li>
          <li className="rounded-2xl border border-white/80 bg-white/48 px-4 py-3 backdrop-blur-xl"><strong className="mr-1 text-sky-600">2</strong> Paste the generated address below, then save it.</li>
          <li className="rounded-2xl border border-white/80 bg-white/48 px-4 py-3 backdrop-blur-xl"><strong className="mr-1 text-sky-600">3</strong> Add Ooma Send SMS, map <code>from</code>, <code>to</code> and <code>body</code>.</li>
        </ol>

        {editingOutbound || !form.hasZapierOutboundWebhook ? (
          <form onSubmit={saveOutbound} className="mt-5 rounded-3xl border border-white/90 bg-white/55 p-4 shadow-sm backdrop-blur-xl">
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="text-sm font-semibold text-slate-800">
                Ooma business number
                <input required value={form.fromNumber || ""} onChange={(event) => setForm((current) => ({ ...current, fromNumber: event.target.value }))} className={inputClass} placeholder="+1 416 555 0100" />
              </label>
              <label className="text-sm font-semibold text-slate-800">
                Zapier Catch Hook URL
                <input required type="url" value={outboundWebhookUrl} onChange={(event) => setOutboundWebhookUrl(event.target.value.trim())} className={inputClass} placeholder="https://hooks.zapier.com/hooks/catch/..." autoComplete="off" />
              </label>
            </div>
            <p className="mt-3 inline-flex items-center gap-1.5 text-xs leading-5 text-slate-500"><ShieldCheck className="h-3.5 w-3.5 text-emerald-600" /> Your Zapier address is encrypted and hidden after it is saved.</p>
            <div className="mt-4 flex justify-end gap-2">
              {form.hasZapierOutboundWebhook ? (
                <button type="button" onClick={() => { setEditingOutbound(false); setOutboundWebhookUrl(""); }} className="rounded-2xl border border-white/90 bg-white/60 px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-white">Cancel</button>
              ) : null}
              <button type="submit" disabled={savingOutbound || !form.canManage || !form.secureStorageReady} className="inline-flex items-center gap-2 rounded-2xl bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-all duration-200 hover:bg-slate-800 active:scale-[0.98] disabled:opacity-50">
                {savingOutbound ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
                {savingOutbound ? "Saving…" : "Save connection"}
              </button>
            </div>
          </form>
        ) : (
          <div className="mt-5 rounded-3xl border border-white/90 bg-white/55 p-4 shadow-sm backdrop-blur-xl">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-sm font-semibold text-slate-950">Sending connection saved</p>
                <p className="mt-1 text-xs text-slate-500">Business number: {form.fromNumber || "Not set"}</p>
                {form.lastZapierOutboundTestMessage ? <p className="mt-1 text-xs text-slate-500">{form.lastZapierOutboundTestMessage}</p> : null}
              </div>
              <div className="flex gap-2">
                <button type="button" onClick={() => setEditingOutbound(true)} className="rounded-xl border border-white/90 bg-white/70 px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-white">Update connection</button>
                <button type="button" disabled={disconnectingOutbound} onClick={disconnectOutbound} className="flex h-9 w-9 items-center justify-center rounded-xl border border-rose-100 bg-rose-50/80 text-rose-600 transition hover:bg-rose-100 disabled:opacity-50" aria-label="Remove sending connection">
                  {disconnectingOutbound ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                </button>
              </div>
            </div>

            <div className="mt-4 flex flex-col gap-2 sm:flex-row">
              <input value={testNumber} onChange={(event) => setTestNumber(event.target.value)} className="h-11 min-w-0 flex-1 rounded-2xl border border-white/90 bg-white/70 px-3.5 text-sm shadow-sm outline-none transition focus:border-sky-300 focus:ring-4 focus:ring-sky-100/70" placeholder="Test phone: +1 416 555 0100" />
              <button type="button" disabled={testingOutbound || !testNumber.trim() || !form.canManage} onClick={testOutbound} className="inline-flex items-center justify-center gap-2 rounded-2xl bg-sky-600 px-4 py-3 text-sm font-semibold text-white shadow-[0_10px_24px_rgba(14,165,233,0.2)] transition-all duration-200 hover:bg-sky-500 active:scale-[0.98] disabled:opacity-50">
                {testingOutbound ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                {testingOutbound ? "Sending…" : "Send outbound test"}
              </button>
            </div>
          </div>
        )}
      </section>

      <p className="px-3 pb-2 text-center text-xs leading-5 text-slate-500">
        CaseDesk stores connection details securely. You can update or remove either connection at any time.
      </p>
      </div>
    </div>
  );
}
