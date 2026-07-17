import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  Copy,
  ExternalLink,
  Eye,
  EyeOff,
  Loader2,
  MessageSquareText,
  PhoneCall,
  RefreshCw,
  Send,
  Server,
  ShieldCheck,
  Trash2,
  X,
} from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import api from "../../services/api";

const inputClass =
  "mt-2 h-11 w-full rounded-2xl border border-slate-200 bg-white px-3.5 text-sm font-medium text-slate-900 outline-none transition focus:border-sky-400 focus:ring-4 focus:ring-sky-100/60 disabled:bg-slate-50 disabled:text-slate-400";
const blank = {
  configured: false,
  canManage: true,
  secureStorageReady: true,
  apiBaseUrl: "",
  fromNumber: "",
  smsSendPath: "",
  callStartPath: "",
  authHeader: "authorization",
  authPrefix: "Bearer",
  apiKey: "",
  hasApiKey: false,
  enabled: true,
  smsEnabled: true,
  callsEnabled: true,
  lastSmsTestedAt: null,
  lastSmsTestStatus: null,
  lastSmsTestMessage: null,
  webhookUrl: "",
  hasWebhook: false,
  lastWebhookAt: null,
};

function Toggle({ checked, disabled, onChange, label }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative h-7 w-12 shrink-0 rounded-full transition disabled:opacity-50 ${checked ? "bg-slate-950" : "bg-slate-300"}`}
      aria-label={label}
    >
      <span
        className={`absolute top-1 h-5 w-5 rounded-full bg-white shadow transition ${checked ? "left-6" : "left-1"}`}
      />
    </button>
  );
}

function DisconnectDialog({ busy, error, onClose, onConfirm }) {
  return createPortal(
    <div className="fixed inset-0 z-[500] flex items-center justify-center bg-slate-950/25 p-4 backdrop-blur-md">
      <button
        type="button"
        className="absolute inset-0"
        onClick={onClose}
        aria-label="Cancel disconnect"
      />
      <motion.section
        initial={{ opacity: 0, y: 12, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        className="relative w-full max-w-md overflow-hidden rounded-[1.8rem] border border-white/80 bg-white shadow-[0_30px_90px_rgba(15,23,42,0.25)]"
      >
        <div className="px-6 pb-5 pt-6">
          <div className="flex items-start justify-between">
            <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-rose-50 text-rose-600">
              <Trash2 className="h-5 w-5" />
            </span>
            <button
              type="button"
              onClick={onClose}
              className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-100"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <h3 className="mt-4 text-xl font-semibold">Disconnect Ooma?</h3>
          <p className="mt-2 text-sm leading-6 text-slate-500">
            CaseDesk will stop starting Ooma calls and sending text messages.
            Existing case communication records will remain.
          </p>
          {error ? (
            <p className="mt-3 rounded-2xl bg-rose-50 px-4 py-3 text-sm text-rose-700">
              {error}
            </p>
          ) : null}
        </div>
        <div className="grid grid-cols-2 gap-3 border-t border-slate-100 bg-slate-50/70 p-4">
          <button
            type="button"
            onClick={onClose}
            className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold"
          >
            Keep connected
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={onConfirm}
            className="rounded-2xl bg-rose-600 px-4 py-3 text-sm font-semibold text-white disabled:opacity-50"
          >
            {busy ? "Disconnecting…" : "Disconnect"}
          </button>
        </div>
      </motion.section>
    </div>,
    document.body,
  );
}

export default function AgencyOomaSettingsPanel() {
  const [form, setForm] = useState(blank);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [rotatingWebhook, setRotatingWebhook] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const [advanced, setAdvanced] = useState(false);
  const [testNumber, setTestNumber] = useState("");
  const [disconnectOpen, setDisconnectOpen] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const update = (key, value) =>
    setForm((current) => ({ ...current, [key]: value }));

  useEffect(() => {
    let active = true;
    api
      .get("/settings/ooma")
      .then((response) => {
        if (active)
          setForm((current) => ({
            ...current,
            ...response.data.data,
            apiKey: "",
          }));
      })
      .catch((requestError) => {
        if (active)
          setError(
            requestError.response?.data?.message ||
              "Ooma settings could not be loaded.",
          );
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const save = async (event) => {
    event.preventDefault();
    try {
      setSaving(true);
      setError("");
      setNotice("");
      const response = await api.put("/settings/ooma", {
        apiBaseUrl: form.apiBaseUrl,
        fromNumber: form.fromNumber,
        apiKey: form.apiKey,
        smsSendPath: form.smsSendPath,
        callStartPath: form.callStartPath,
        authHeader: form.authHeader,
        authPrefix: form.authPrefix,
        enabled: form.enabled,
        smsEnabled: form.smsEnabled,
        callsEnabled: form.callsEnabled,
      });
      setForm((current) => ({ ...current, ...response.data.data, apiKey: "" }));
      setNotice(
        form.smsEnabled
          ? "Ooma details saved securely. Send a test text before messaging clients."
          : "Ooma call settings saved securely.",
      );
    } catch (requestError) {
      setError(
        requestError.response?.data?.message ||
          "The Ooma details could not be saved.",
      );
    } finally {
      setSaving(false);
    }
  };

  const testSms = async () => {
    try {
      setTesting(true);
      setError("");
      setNotice("");
      const response = await api.post(
        "/settings/ooma/test-sms",
        { to: testNumber },
        { timeout: 35000 },
      );
      setForm((current) => ({ ...current, ...response.data.data, apiKey: "" }));
      setNotice(
        "Ooma accepted the test message. Check the destination phone for the CaseDesk text.",
      );
    } catch (requestError) {
      if (requestError.response?.data?.data)
        setForm((current) => ({
          ...current,
          ...requestError.response.data.data,
          apiKey: "",
        }));
      setError(
        requestError.response?.data?.message || "The Ooma test text failed.",
      );
    } finally {
      setTesting(false);
    }
  };

  const disconnect = async () => {
    try {
      setSaving(true);
      setError("");
      await api.delete("/settings/ooma");
      setForm(blank);
      setDisconnectOpen(false);
      setNotice("Ooma disconnected. Existing communication history was kept.");
    } catch (requestError) {
      setError(
        requestError.response?.data?.message ||
          "Ooma could not be disconnected.",
      );
    } finally {
      setSaving(false);
    }
  };

  const copyWebhook = async () => {
    try {
      await navigator.clipboard.writeText(form.webhookUrl);
      setNotice("Ooma webhook address copied.");
    } catch {
      setError(
        "The webhook address could not be copied. Select and copy it manually.",
      );
    }
  };

  const rotateWebhook = async () => {
    try {
      setRotatingWebhook(true);
      setError("");
      setNotice("");
      const response = await api.post("/settings/ooma/webhook-token");
      setForm((current) => ({ ...current, ...response.data.data, apiKey: "" }));
      setNotice(
        "A new webhook address was generated. Replace the old address in Ooma.",
      );
    } catch (requestError) {
      setError(
        requestError.response?.data?.message ||
          "The webhook address could not be regenerated.",
      );
    } finally {
      setRotatingWebhook(false);
    }
  };

  if (loading)
    return (
      <div className="space-y-3">
        {Array.from({ length: 4 }, (_, index) => (
          <div
            key={index}
            className="h-24 animate-pulse rounded-3xl bg-slate-100"
          />
        ))}
      </div>
    );
  const busy = saving || testing || rotatingWebhook;
  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 border-b border-slate-200/80 pb-6 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-[13px] font-medium text-slate-500">
            Client communication
          </p>
          <h2 className="mt-1 text-[28px] font-semibold leading-9 tracking-[-0.03em] text-slate-950">
            Workspace Phone & SMS
          </h2>
          <p className="mt-2 max-w-2xl text-[15px] leading-6 text-slate-500">
            Connect Ooma Enterprise so your team can text clients, start calls,
            and keep the activity in each case.
          </p>
        </div>
        {form.configured ? (
          <span
            className={`inline-flex items-center gap-2 self-start rounded-full px-3 py-2 text-xs font-semibold ${form.lastSmsTestStatus === "Connected" ? "bg-emerald-50 text-emerald-700" : form.lastSmsTestStatus === "Failed" ? "bg-rose-50 text-rose-700" : "bg-amber-50 text-amber-700"}`}
          >
            {form.lastSmsTestStatus === "Connected" ? (
              <CheckCircle2 className="h-4 w-4" />
            ) : (
              <AlertCircle className="h-4 w-4" />
            )}
            {form.lastSmsTestStatus || "Setup saved"}
          </span>
        ) : null}
      </div>
      {!form.canManage ? (
        <div className="rounded-3xl bg-amber-50 px-5 py-4 text-sm text-amber-800">
          Only a workspace administrator can change the Ooma connection.
        </div>
      ) : null}
      {!form.secureStorageReady ? (
        <div className="rounded-3xl bg-rose-50 px-5 py-4 text-sm text-rose-800">
          Secure integration storage is unavailable. Ask the system
          administrator to configure the encryption key.
        </div>
      ) : null}
      {notice ? (
        <div className="flex items-start gap-3 rounded-3xl bg-emerald-50 px-5 py-4 text-sm leading-6 text-emerald-800">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
          {notice}
        </div>
      ) : null}
      {error ? (
        <div className="flex items-start gap-3 rounded-3xl bg-rose-50 px-5 py-4 text-sm leading-6 text-rose-800">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          {error}
        </div>
      ) : null}

      <section className="rounded-[1.6rem] border border-sky-100 bg-sky-50/70 p-5">
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-white text-sky-600 shadow-sm">
            <ShieldCheck className="h-4 w-4" />
          </span>
          <div>
            <p className="text-sm font-semibold text-sky-950">
              Get these values from Ooma Enterprise
            </p>
            <p className="mt-1 text-sm leading-6 text-sky-800">
              Ask for CRM API access, your API base address and key, plus the
              exact outbound SMS and click-to-call paths. Business texting must
              also be activated and registered.
            </p>
            <div className="mt-2 flex flex-wrap gap-4">
              <a
                href="https://www.ooma.com/contact/"
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-xs font-semibold text-sky-700 underline decoration-sky-300 underline-offset-4"
              >
                Contact Ooma <ExternalLink className="h-3 w-3" />
              </a>
              <a
                href="https://support.oomaenterprise.com/support/solutions/articles/48001271312-requirements-for-sms-messaging"
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-xs font-semibold text-sky-700 underline decoration-sky-300 underline-offset-4"
              >
                SMS registration guide <ExternalLink className="h-3 w-3" />
              </a>
            </div>
          </div>
        </div>
      </section>

      {form.configured ? (
        <section className="rounded-[1.6rem] border border-slate-200 bg-[linear-gradient(135deg,#fff,#f8fafc)] p-5 shadow-sm">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex min-w-0 items-center gap-3">
              <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-slate-950 text-white">
                <PhoneCall className="h-5 w-5" />
              </span>
              <div className="min-w-0">
                <p className="truncate text-base font-semibold">
                  {form.fromNumber}
                </p>
                <p className="mt-0.5 text-sm text-slate-500">
                  Ooma Enterprise · {form.smsEnabled ? "SMS" : "SMS off"} ·{" "}
                  {form.callsEnabled ? "Calls" : "Calls off"}
                </p>
                {form.lastSmsTestMessage ? (
                  <p className="mt-1 text-xs text-slate-400">
                    {form.lastSmsTestMessage}
                  </p>
                ) : null}
              </div>
            </div>
            <button
              type="button"
              disabled={busy || !form.canManage}
              onClick={() => setDisconnectOpen(true)}
              className="flex h-10 w-10 items-center justify-center self-start rounded-full bg-rose-50 text-rose-600"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        </section>
      ) : null}

      <form onSubmit={save} className="space-y-5">
        <section className="rounded-[1.6rem] border border-slate-200 bg-white p-5 shadow-sm">
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="text-sm font-semibold text-slate-800">
              Ooma business phone number
              <input
                required
                disabled={!form.canManage}
                value={form.fromNumber}
                onChange={(event) => update("fromNumber", event.target.value)}
                className={inputClass}
                placeholder="+1 416 555 0100"
              />
            </label>
            <label className="text-sm font-semibold text-slate-800">
              API address from Ooma
              <input
                required
                type="url"
                disabled={!form.canManage}
                value={form.apiBaseUrl}
                onChange={(event) => update("apiBaseUrl", event.target.value)}
                className={inputClass}
                placeholder="https://api-address-from-ooma.com"
              />
            </label>
          </div>
          <label className="mt-4 block text-sm font-semibold text-slate-800">
            {form.hasApiKey
              ? "New API key (only if changing it)"
              : "API key from Ooma"}
            <span className="relative block">
              <input
                required={!form.hasApiKey}
                type={showKey ? "text" : "password"}
                disabled={!form.canManage}
                value={form.apiKey}
                onChange={(event) =>
                  update("apiKey", event.target.value.trim())
                }
                className={`${inputClass} pr-12`}
                autoComplete="new-password"
                placeholder={
                  form.hasApiKey
                    ? "An API key is already saved securely"
                    : "Paste the API key supplied by Ooma"
                }
              />
              <button
                type="button"
                onClick={() => setShowKey((current) => !current)}
                className="absolute right-2 top-[18px] flex h-8 w-8 items-center justify-center rounded-full text-slate-400"
              >
                {showKey ? (
                  <EyeOff className="h-4 w-4" />
                ) : (
                  <Eye className="h-4 w-4" />
                )}
              </button>
            </span>
            <span className="mt-2 block text-xs font-normal text-slate-500">
              Encrypted on the server and never shown again.
            </span>
          </label>
        </section>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex items-center justify-between rounded-3xl bg-slate-50 px-5 py-4">
            <span className="flex items-center gap-3">
              <MessageSquareText className="h-4 w-4 text-emerald-600" />
              <span>
                <span className="block text-sm font-semibold">
                  Client text messages
                </span>
                <span className="mt-1 block text-xs text-slate-500">
                  Send through the Ooma business number
                </span>
              </span>
            </span>
            <Toggle
              checked={form.smsEnabled}
              disabled={!form.canManage}
              onChange={(value) => update("smsEnabled", value)}
              label="Toggle Ooma SMS"
            />
          </label>
          <label className="flex items-center justify-between rounded-3xl bg-slate-50 px-5 py-4">
            <span className="flex items-center gap-3">
              <PhoneCall className="h-4 w-4 text-amber-600" />
              <span>
                <span className="block text-sm font-semibold">
                  Start client calls
                </span>
                <span className="mt-1 block text-xs text-slate-500">
                  Use Ooma click-to-call when supported
                </span>
              </span>
            </span>
            <Toggle
              checked={form.callsEnabled}
              disabled={!form.canManage}
              onChange={(value) => update("callsEnabled", value)}
              label="Toggle Ooma calls"
            />
          </label>
        </div>
        <section className="overflow-hidden rounded-[1.6rem] border border-slate-200 bg-white shadow-sm">
          <button
            type="button"
            onClick={() => setAdvanced((current) => !current)}
            className="flex w-full items-center justify-between px-5 py-4 text-left"
          >
            <span className="flex items-center gap-3">
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-slate-100">
                <Server className="h-4 w-4" />
              </span>
              <span>
                <span className="block text-sm font-semibold">
                  Advanced settings
                </span>
                <span className="mt-0.5 block text-xs text-slate-500">
                  Copy these exactly from Ooma's API documentation
                </span>
              </span>
            </span>
            <ChevronDown
              className={`h-4 w-4 text-slate-400 transition ${advanced ? "rotate-180" : ""}`}
            />
          </button>
          <AnimatePresence initial={false}>
            {advanced ? (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                className="overflow-hidden"
              >
                <div className="grid gap-4 border-t border-slate-100 px-5 pb-5 pt-4 sm:grid-cols-2">
                  <label className="text-sm font-semibold text-slate-800">
                    SMS endpoint path
                    <input
                      required={form.smsEnabled}
                      disabled={!form.canManage || !form.smsEnabled}
                      value={form.smsSendPath}
                      onChange={(event) =>
                        update("smsSendPath", event.target.value)
                      }
                      className={inputClass}
                      placeholder="/exact/path/from/ooma"
                    />
                  </label>
                  <label className="text-sm font-semibold text-slate-800">
                    Call endpoint path
                    <input
                      required={form.callsEnabled}
                      disabled={!form.canManage || !form.callsEnabled}
                      value={form.callStartPath}
                      onChange={(event) =>
                        update("callStartPath", event.target.value)
                      }
                      className={inputClass}
                      placeholder="/exact/path/from/ooma"
                    />
                  </label>
                  <label className="text-sm font-semibold text-slate-800">
                    Authentication header
                    <input
                      required
                      disabled={!form.canManage}
                      value={form.authHeader}
                      onChange={(event) =>
                        update("authHeader", event.target.value)
                      }
                      className={inputClass}
                    />
                  </label>
                  <label className="text-sm font-semibold text-slate-800">
                    Key prefix
                    <input
                      disabled={!form.canManage}
                      value={form.authPrefix}
                      onChange={(event) =>
                        update("authPrefix", event.target.value)
                      }
                      className={inputClass}
                      placeholder="Bearer"
                    />
                  </label>
                </div>
              </motion.div>
            ) : null}
          </AnimatePresence>
        </section>
        <label className="flex items-center justify-between rounded-3xl bg-slate-50 px-5 py-4">
          <span>
            <span className="block text-sm font-semibold">
              Use Ooma in client cases
            </span>
            <span className="mt-1 block text-xs text-slate-500">
              Turn off to retain the settings without allowing calls or
              messages.
            </span>
          </span>
          <Toggle
            checked={form.enabled}
            disabled={!form.canManage}
            onChange={(value) => update("enabled", value)}
            label="Toggle Ooma integration"
          />
        </label>
        <div className="flex justify-end">
          <button
            type="submit"
            disabled={busy || !form.canManage || !form.secureStorageReady}
            className="inline-flex items-center gap-2 rounded-full bg-slate-950 px-5 py-3 text-sm font-semibold text-white disabled:opacity-50"
          >
            {saving ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <ShieldCheck className="h-4 w-4" />
            )}
            {saving ? "Saving securely…" : "Save Ooma setup"}
          </button>
        </div>
      </form>

      {form.configured && form.webhookUrl ? (
        <section className="rounded-[1.6rem] border border-violet-100 bg-violet-50/60 p-5">
          <div className="flex items-start gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-white text-violet-600">
              <MessageSquareText className="h-4 w-4" />
            </span>
            <div className="min-w-0 flex-1">
              <h3 className="text-sm font-semibold text-violet-950">
                Receive texts and call updates
              </h3>
              <p className="mt-1 text-sm leading-6 text-violet-800">
                Add this callback address to Ooma's messaging and call event
                configuration. It securely routes replies and delivery updates
                to this agency.
              </p>
              <div className="mt-3 flex items-center gap-2 rounded-2xl border border-violet-100 bg-white p-2">
                <input
                  readOnly
                  value={form.webhookUrl}
                  className="min-w-0 flex-1 bg-transparent px-2 text-xs text-slate-600 outline-none"
                  aria-label="Ooma webhook address"
                />
                <button
                  type="button"
                  onClick={copyWebhook}
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-violet-50 text-violet-700"
                  aria-label="Copy webhook address"
                >
                  <Copy className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  disabled={!form.canManage || rotatingWebhook}
                  onClick={rotateWebhook}
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-600 disabled:opacity-50"
                  aria-label="Regenerate webhook address"
                >
                  {rotatingWebhook ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <RefreshCw className="h-4 w-4" />
                  )}
                </button>
              </div>
              {form.lastWebhookAt ? (
                <p className="mt-2 text-xs text-violet-700">
                  Last event received{" "}
                  {new Date(form.lastWebhookAt).toLocaleString()}
                </p>
              ) : (
                <p className="mt-2 text-xs text-violet-700">
                  Waiting for the first event from Ooma.
                </p>
              )}
            </div>
          </div>
        </section>
      ) : null}
      {form.configured && form.smsEnabled ? (
        <section className="rounded-[1.6rem] border border-emerald-100 bg-emerald-50/60 p-5">
          <div className="flex items-start gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-white text-emerald-600">
              <Send className="h-4 w-4" />
            </span>
            <div>
              <h3 className="text-sm font-semibold text-emerald-950">
                Send a test text
              </h3>
              <p className="mt-1 text-sm leading-6 text-emerald-800">
                Use a phone you control. This sends a real SMS and confirms the
                Ooma endpoint and API key.
              </p>
            </div>
          </div>
          <div className="mt-4 flex flex-col gap-2 sm:flex-row">
            <input
              value={testNumber}
              onChange={(event) => setTestNumber(event.target.value)}
              className="h-11 min-w-0 flex-1 rounded-2xl border border-emerald-200 bg-white px-3.5 text-sm outline-none"
              placeholder="+1 416 555 0100"
            />
            <button
              type="button"
              disabled={testing || !testNumber.trim() || !form.canManage}
              onClick={testSms}
              className="inline-flex items-center justify-center gap-2 rounded-2xl bg-emerald-600 px-4 py-3 text-sm font-semibold text-white disabled:opacity-50"
            >
              {testing ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Send className="h-4 w-4" />
              )}
              {testing ? "Sending test…" : "Send test SMS"}
            </button>
          </div>
        </section>
      ) : null}
      <AnimatePresence>
        {disconnectOpen ? (
          <DisconnectDialog
            busy={saving}
            error={error}
            onClose={() => {
              setDisconnectOpen(false);
              setError("");
            }}
            onConfirm={disconnect}
          />
        ) : null}
      </AnimatePresence>
    </div>
  );
}
