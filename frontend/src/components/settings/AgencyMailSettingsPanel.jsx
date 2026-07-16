import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  Eye,
  EyeOff,
  ExternalLink,
  Loader2,
  Mail,
  Server,
  ShieldCheck,
  Trash2,
  X,
} from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import api from "../../services/api";

const providers = [
  {
    id: "Google Workspace",
    short: "Google",
    mark: "G",
    tone: "bg-blue-50 text-blue-600",
    host: "smtp.gmail.com",
    port: 465,
    secure: true,
    imapHost: "imap.gmail.com",
    imapPort: 993,
    imapSecure: true,
    help: "Use a 16-character Google app password. Your regular Google password should not be entered here.",
    links: [
      {
        label: "Create app password",
        href: "https://myaccount.google.com/apppasswords",
      },
      {
        label: "Google help guide",
        href: "https://support.google.com/accounts/answer/185833",
      },
    ],
  },
  {
    id: "Microsoft 365",
    short: "Microsoft",
    mark: "M",
    tone: "bg-sky-50 text-sky-600",
    host: "smtp.office365.com",
    port: 587,
    secure: false,
    imapHost: "outlook.office365.com",
    imapPort: 993,
    imapSecure: true,
    help: "Your Microsoft administrator may need to allow Authenticated SMTP for this mailbox.",
    links: [
      {
        label: "Microsoft security settings",
        href: "https://mysignins.microsoft.com/security-info",
      },
      {
        label: "Microsoft help guide",
        href: "https://support.microsoft.com/en-US/accounts-billing/manage/how-to-get-and-use-app-passwords",
      },
    ],
  },
  {
    id: "Zoho Mail",
    short: "Zoho",
    mark: "Z",
    tone: "bg-amber-50 text-amber-700",
    host: "smtppro.zoho.com",
    port: 465,
    secure: true,
    imapHost: "imap.zoho.com",
    imapPort: 993,
    imapSecure: true,
    help: "For a paid business-domain mailbox, Zoho normally uses smtppro.zoho.com. Use an app password when two-factor authentication is on.",
    links: [
      {
        label: "Create app password",
        href: "https://accounts.zoho.com/home#security/app_password",
      },
      {
        label: "Zoho help guide",
        href: "https://help.zoho.com/portal/en/kb/accounts/manage-your-zoho-account/articles/mfa-application-specific-passwords",
      },
    ],
  },
  {
    id: "Custom",
    short: "Other",
    mark: "…",
    tone: "bg-slate-100 text-slate-600",
    host: "",
    port: 587,
    secure: false,
    imapHost: "",
    imapPort: 993,
    imapSecure: true,
    help: "Ask your email provider for the outgoing mail server, port, username, and app password.",
    links: [],
  },
];

const inputClass =
  "mt-2 h-11 w-full rounded-2xl border border-slate-200 bg-white px-3.5 text-sm font-medium text-slate-900 outline-none transition focus:border-sky-400 focus:ring-4 focus:ring-sky-100/60 disabled:bg-slate-50 disabled:text-slate-400";

function blankSettings() {
  return {
    provider: "Google Workspace",
    displayName: "",
    emailAddress: "",
    smtpHost: "smtp.gmail.com",
    smtpPort: 465,
    smtpSecure: true,
    smtpUsername: "",
    imapHost: "imap.gmail.com",
    imapPort: 993,
    imapSecure: true,
    imapUsername: "",
    inboundEnabled: false,
    lastInboundSyncAt: null,
    lastInboundSyncStatus: null,
    lastInboundSyncMessage: null,
    password: "",
    hasPassword: false,
    enabled: true,
    configured: false,
    canManage: true,
    secureStorageReady: true,
    lastTestedAt: null,
    lastTestStatus: null,
    lastTestMessage: null,
  };
}

function statusStyles(status) {
  if (status === "Connected") return "bg-emerald-50 text-emerald-700";
  if (status === "Failed") return "bg-rose-50 text-rose-700";
  return "bg-amber-50 text-amber-700";
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
        exit={{ opacity: 0, y: 8, scale: 0.985 }}
        className="relative w-full max-w-md overflow-hidden rounded-[1.8rem] border border-white/80 bg-white shadow-[0_30px_90px_rgba(15,23,42,0.25)]"
      >
        <div className="px-6 pb-5 pt-6">
          <div className="flex items-start justify-between gap-4">
            <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-rose-50 text-rose-600">
              <Trash2 className="h-5 w-5" />
            </span>
            <button
              type="button"
              onClick={onClose}
              className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-100 text-slate-500"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <h3 className="mt-4 text-xl font-semibold tracking-tight">
            Disconnect this mailbox?
          </h3>
          <p className="mt-2 text-sm leading-6 text-slate-500">
            CaseDesk will stop sending client email from this address. Existing
            communication records will stay in each case.
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

export default function AgencyMailSettingsPanel() {
  const [form, setForm] = useState(blankSettings);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [advanced, setAdvanced] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [disconnectOpen, setDisconnectOpen] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const update = (key, value) =>
    setForm((current) => ({ ...current, [key]: value }));

  useEffect(() => {
    let active = true;
    api
      .get("/settings/mail")
      .then((response) => {
        if (active)
          setForm((current) => ({
            ...current,
            ...response.data.data,
            password: "",
          }));
      })
      .catch((requestError) => {
        if (active)
          setError(
            requestError.response?.data?.message ||
              "Agency email settings could not be loaded.",
          );
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const chooseProvider = (provider) => {
    setForm((current) => ({
      ...current,
      provider: provider.id,
      smtpHost: provider.host,
      smtpPort: provider.port,
      smtpSecure: provider.secure,
      smtpUsername: current.smtpUsername || current.emailAddress,
      imapHost: provider.imapHost,
      imapPort: provider.imapPort,
      imapSecure: provider.imapSecure,
      imapUsername:
        current.imapUsername || current.smtpUsername || current.emailAddress,
    }));
    if (provider.id === "Custom") setAdvanced(true);
    setNotice("");
  };

  const saveAndTest = async (event) => {
    event.preventDefault();
    try {
      setSaving(true);
      setError("");
      setNotice("");
      const saved = await api.put("/settings/mail", {
        provider: form.provider,
        displayName: form.displayName,
        emailAddress: form.emailAddress,
        smtpHost: form.smtpHost,
        smtpPort: Number(form.smtpPort),
        smtpSecure: form.smtpSecure,
        smtpUsername: form.smtpUsername || form.emailAddress,
        imapHost: form.imapHost,
        imapPort: Number(form.imapPort),
        imapSecure: form.imapSecure,
        imapUsername:
          form.imapUsername || form.smtpUsername || form.emailAddress,
        inboundEnabled: form.inboundEnabled,
        password: form.password,
        enabled: form.enabled,
      });
      setForm((current) => ({ ...current, ...saved.data.data, password: "" }));
      if (!form.enabled) {
        setNotice(
          "Mailbox details saved. Sending remains turned off until you enable this connection.",
        );
        return;
      }
      setSaving(false);
      setTesting(true);
      const tested = await api.post(
        "/settings/mail/test",
        {},
        { timeout: 30000 },
      );
      setForm((current) => ({ ...current, ...tested.data.data, password: "" }));
      setNotice(
        form.inboundEnabled
          ? "Mailbox connected. CaseDesk can now send and receive client email."
          : "Mailbox connected. CaseDesk can now send client email from this address.",
      );
    } catch (requestError) {
      if (requestError.response?.data?.data) {
        setForm((current) => ({
          ...current,
          ...requestError.response.data.data,
          password: "",
        }));
      }
      setError(
        requestError.response?.data?.message ||
          "The mailbox could not be connected.",
      );
    } finally {
      setSaving(false);
      setTesting(false);
    }
  };

  const testAgain = async () => {
    try {
      setTesting(true);
      setError("");
      setNotice("");
      const response = await api.post(
        "/settings/mail/test",
        {},
        { timeout: 30000 },
      );
      setForm((current) => ({
        ...current,
        ...response.data.data,
        password: "",
      }));
      setNotice("Connection checked successfully.");
    } catch (requestError) {
      if (requestError.response?.data?.data)
        setForm((current) => ({
          ...current,
          ...requestError.response.data.data,
          password: "",
        }));
      setError(
        requestError.response?.data?.message || "The connection check failed.",
      );
    } finally {
      setTesting(false);
    }
  };

  const disconnect = async () => {
    try {
      setSaving(true);
      setError("");
      await api.delete("/settings/mail");
      setForm(blankSettings());
      setDisconnectOpen(false);
      setNotice(
        "Mailbox disconnected. Existing case communication records were kept.",
      );
    } catch (requestError) {
      setError(
        requestError.response?.data?.message ||
          "The mailbox could not be disconnected.",
      );
    } finally {
      setSaving(false);
    }
  };

  const selectedProvider =
    providers.find((item) => item.id === form.provider) || providers[3];
  const busy = saving || testing;

  if (loading) {
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
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 border-b border-slate-200/80 pb-6 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-[13px] font-medium text-slate-500">
            Client communication
          </p>
          <h2 className="mt-1 text-[28px] font-semibold leading-9 tracking-[-0.03em] text-slate-950">
            Agency Email
          </h2>
          <p className="mt-2 max-w-2xl text-[15px] leading-6 text-slate-500">
            Connect the mailbox your team will use to send emails directly from
            client cases.
          </p>
        </div>
        {form.configured ? (
          <span
            className={`inline-flex items-center gap-2 self-start rounded-full px-3 py-2 text-xs font-semibold ${statusStyles(form.lastTestStatus)}`}
          >
            {form.lastTestStatus === "Connected" ? (
              <CheckCircle2 className="h-4 w-4" />
            ) : (
              <AlertCircle className="h-4 w-4" />
            )}
            {form.lastTestStatus || "Needs connection check"}
          </span>
        ) : null}
      </div>

      {!form.canManage ? (
        <div className="rounded-3xl border border-amber-200 bg-amber-50 px-5 py-4 text-sm leading-6 text-amber-800">
          Only an agency administrator can change mailbox details. You can still
          see whether email is connected.
        </div>
      ) : null}
      {!form.secureStorageReady ? (
        <div className="rounded-3xl border border-rose-200 bg-rose-50 px-5 py-4 text-sm leading-6 text-rose-800">
          Secure password storage is unavailable on this CaseDesk server. Ask
          the system administrator to configure the mailbox encryption key.
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

      {form.configured ? (
        <section className="rounded-[1.6rem] border border-slate-200 bg-[linear-gradient(135deg,#fff,#f8fafc)] p-5 shadow-[0_14px_38px_rgba(15,23,42,0.05)]">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex min-w-0 items-center gap-3">
              <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-slate-950 text-white">
                <Mail className="h-5 w-5" />
              </span>
              <div className="min-w-0">
                <p className="truncate text-base font-semibold text-slate-950">
                  {form.displayName || form.emailAddress}
                </p>
                <p className="mt-0.5 truncate text-sm text-slate-500">
                  {form.emailAddress} · {form.provider}
                </p>
                {form.lastTestedAt ? (
                  <p className="mt-1 text-[11px] text-slate-400">
                    Last checked{" "}
                    {new Date(form.lastTestedAt).toLocaleString("en-CA")}
                  </p>
                ) : null}
              </div>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                disabled={busy || !form.canManage}
                onClick={testAgain}
                className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold disabled:opacity-50"
              >
                {testing ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <ShieldCheck className="h-4 w-4" />
                )}{" "}
                Check connection
              </button>
              <button
                type="button"
                disabled={busy || !form.canManage}
                onClick={() => setDisconnectOpen(true)}
                className="flex h-10 w-10 items-center justify-center rounded-full bg-rose-50 text-rose-600 disabled:opacity-50"
                aria-label="Disconnect mailbox"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          </div>
          {form.lastTestMessage ? (
            <p className="mt-4 rounded-2xl bg-white px-4 py-3 text-sm text-slate-600 shadow-sm">
              {form.lastTestMessage}
            </p>
          ) : null}
        </section>
      ) : null}

      <form onSubmit={saveAndTest} className="space-y-5">
        <section>
          <p className="text-sm font-semibold text-slate-900">
            Who provides your agency email?
          </p>
          <p className="mt-1 text-sm text-slate-500">
            Choose the service where your agency mailbox is hosted.
          </p>
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {providers.map((provider) => (
              <button
                key={provider.id}
                type="button"
                disabled={!form.canManage}
                onClick={() => chooseProvider(provider)}
                className={`rounded-2xl border p-3 text-left transition disabled:opacity-60 ${form.provider === provider.id ? "border-slate-950 bg-white shadow-sm" : "border-slate-200 bg-slate-50/60 hover:bg-white"}`}
              >
                <span
                  className={`flex h-9 w-9 items-center justify-center rounded-xl text-sm font-bold ${provider.tone}`}
                >
                  {provider.mark}
                </span>
                <span className="mt-2 block text-xs font-semibold text-slate-800">
                  {provider.short}
                </span>
              </button>
            ))}
          </div>
          <div className="mt-3 flex items-start gap-3 rounded-2xl bg-sky-50 px-4 py-3 text-sm leading-6 text-sky-800">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
            <p>{selectedProvider.help}</p>
          </div>
        </section>

        <section className="rounded-[1.6rem] border border-slate-200 bg-white p-5 shadow-[0_12px_32px_rgba(15,23,42,0.04)]">
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="text-sm font-semibold text-slate-800">
              Name clients will see
              <input
                disabled={!form.canManage}
                value={form.displayName}
                onChange={(event) => update("displayName", event.target.value)}
                className={inputClass}
                placeholder="North Star Immigration"
              />
            </label>
            <label className="text-sm font-semibold text-slate-800">
              Email address clients will see
              <input
                required
                type="email"
                disabled={!form.canManage}
                value={form.emailAddress}
                onChange={(event) => {
                  const next = event.target.value;
                  setForm((current) => ({
                    ...current,
                    emailAddress: next,
                    smtpUsername:
                      !current.smtpUsername ||
                      current.smtpUsername === current.emailAddress
                        ? next
                        : current.smtpUsername,
                  }));
                }}
                className={inputClass}
                placeholder="hello@youragency.ca"
              />
            </label>
          </div>
          <label className="mt-4 block text-sm font-semibold text-slate-800">
            {form.hasPassword
              ? "New app password (only if changing it)"
              : "App password"}
            <span className="relative block">
              <input
                required={!form.hasPassword}
                type={showPassword ? "text" : "password"}
                disabled={!form.canManage}
                value={form.password}
                onChange={(event) =>
                  update("password", event.target.value.replace(/\s+/g, ""))
                }
                className={`${inputClass} pr-12`}
                autoComplete="new-password"
                placeholder={
                  form.hasPassword
                    ? "A password is already saved securely"
                    : "Paste the app password from your email provider"
                }
              />
              <button
                type="button"
                onClick={() => setShowPassword((visible) => !visible)}
                className="absolute right-2 top-[18px] flex h-8 w-8 items-center justify-center rounded-full text-slate-400"
                aria-label={showPassword ? "Hide password" : "Show password"}
              >
                {showPassword ? (
                  <EyeOff className="h-4 w-4" />
                ) : (
                  <Eye className="h-4 w-4" />
                )}
              </button>
            </span>
            <span className="mt-2 block text-xs font-normal leading-5 text-slate-500">
              Stored with server-side encryption and never shown again. Use a
              provider-generated app password instead of your everyday sign-in
              password. Spaces are removed automatically.
            </span>
            <span className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
              {selectedProvider.links.length ? (
                selectedProvider.links.map((link) => (
                  <a
                    key={link.href}
                    href={link.href}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-xs font-semibold text-sky-700 underline decoration-sky-300 underline-offset-4 hover:text-sky-900"
                  >
                    {link.label}
                    <ExternalLink className="h-3 w-3" />
                  </a>
                ))
              ) : (
                <span className="text-xs font-semibold text-sky-700">
                  Contact your email host and ask for its app-password or SMTP
                  setup guide.
                </span>
              )}
            </span>
          </label>
        </section>

        <section className="rounded-[1.6rem] border border-slate-200 bg-white p-5 shadow-[0_12px_32px_rgba(15,23,42,0.04)]">
          <div className="flex items-center justify-between gap-5">
            <div>
              <p className="text-sm font-semibold text-slate-900">
                Receive client replies in CaseDesk
              </p>
              <p className="mt-1 text-xs leading-5 text-slate-500">
                Securely watch the mailbox inbox and attach matching replies to
                the correct client case. Messages that cannot be matched appear
                in the Unassigned inbox.
              </p>
            </div>
            <button
              type="button"
              disabled={!form.canManage}
              onClick={() => update("inboundEnabled", !form.inboundEnabled)}
              className={`relative h-7 w-12 shrink-0 rounded-full transition disabled:opacity-50 ${form.inboundEnabled ? "bg-slate-950" : "bg-slate-300"}`}
              aria-label="Toggle incoming email synchronization"
            >
              <span
                className={`absolute top-1 h-5 w-5 rounded-full bg-white shadow transition ${form.inboundEnabled ? "left-6" : "left-1"}`}
              />
            </button>
          </div>
          {form.inboundEnabled && form.lastInboundSyncMessage ? (
            <div
              className={`mt-4 rounded-2xl px-4 py-3 text-xs leading-5 ${form.lastInboundSyncStatus === "Failed" ? "bg-rose-50 text-rose-700" : "bg-emerald-50 text-emerald-700"}`}
            >
              <p className="font-semibold">
                {form.lastInboundSyncStatus || "Incoming mailbox"}
              </p>
              <p className="mt-0.5">{form.lastInboundSyncMessage}</p>
              {form.lastInboundSyncAt ? (
                <p className="mt-1 opacity-70">
                  Last checked{" "}
                  {new Date(form.lastInboundSyncAt).toLocaleString("en-CA")}
                </p>
              ) : null}
            </div>
          ) : null}
        </section>

        <section className="overflow-hidden rounded-[1.6rem] border border-slate-200 bg-white shadow-[0_12px_32px_rgba(15,23,42,0.04)]">
          <button
            type="button"
            onClick={() => setAdvanced((open) => !open)}
            className="flex w-full items-center justify-between px-5 py-4 text-left"
          >
            <span className="flex items-center gap-3">
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-slate-100 text-slate-600">
                <Server className="h-4 w-4" />
              </span>
              <span>
                <span className="block text-sm font-semibold text-slate-900">
                  Advanced settings
                </span>
                <span className="mt-0.5 block text-xs text-slate-500">
                  Only needed for custom providers or troubleshooting
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
                    Outgoing mail server
                    <input
                      required
                      disabled={!form.canManage}
                      value={form.smtpHost}
                      onChange={(event) =>
                        update("smtpHost", event.target.value)
                      }
                      className={inputClass}
                      placeholder="smtp.yourprovider.com"
                    />
                  </label>
                  <label className="text-sm font-semibold text-slate-800">
                    Mailbox sign-in email or username
                    <input
                      required
                      disabled={!form.canManage}
                      value={form.smtpUsername}
                      onChange={(event) =>
                        update("smtpUsername", event.target.value)
                      }
                      className={inputClass}
                      placeholder="hello@youragency.ca"
                    />
                  </label>
                  <label className="text-sm font-semibold text-slate-800">
                    Port
                    <input
                      required
                      type="number"
                      min="1"
                      max="65535"
                      disabled={!form.canManage}
                      value={form.smtpPort}
                      onChange={(event) =>
                        update("smtpPort", event.target.value)
                      }
                      className={inputClass}
                    />
                  </label>
                  <div>
                    <p className="text-sm font-semibold text-slate-800">
                      Connection security
                    </p>
                    <div className="mt-2 grid grid-cols-2 rounded-2xl bg-slate-100 p-1">
                      <button
                        type="button"
                        disabled={!form.canManage}
                        onClick={() =>
                          setForm((current) => ({
                            ...current,
                            smtpSecure: true,
                            smtpPort:
                              current.smtpPort === 587 ? 465 : current.smtpPort,
                          }))
                        }
                        className={`rounded-xl px-3 py-2 text-xs font-semibold ${form.smtpSecure ? "bg-white shadow-sm" : "text-slate-500"}`}
                      >
                        SSL
                      </button>
                      <button
                        type="button"
                        disabled={!form.canManage}
                        onClick={() =>
                          setForm((current) => ({
                            ...current,
                            smtpSecure: false,
                            smtpPort:
                              current.smtpPort === 465 ? 587 : current.smtpPort,
                          }))
                        }
                        className={`rounded-xl px-3 py-2 text-xs font-semibold ${!form.smtpSecure ? "bg-white shadow-sm" : "text-slate-500"}`}
                      >
                        STARTTLS
                      </button>
                    </div>
                  </div>
                  {form.inboundEnabled ? (
                    <>
                      <label className="text-sm font-semibold text-slate-800">
                        Incoming mail server
                        <input
                          required
                          disabled={!form.canManage}
                          value={form.imapHost}
                          onChange={(event) =>
                            update("imapHost", event.target.value)
                          }
                          className={inputClass}
                          placeholder="imap.yourprovider.com"
                        />
                      </label>
                      <label className="text-sm font-semibold text-slate-800">
                        Incoming mailbox username
                        <input
                          required
                          disabled={!form.canManage}
                          value={form.imapUsername}
                          onChange={(event) =>
                            update("imapUsername", event.target.value)
                          }
                          className={inputClass}
                          placeholder="hello@youragency.ca"
                        />
                      </label>
                      <label className="text-sm font-semibold text-slate-800">
                        Incoming port
                        <input
                          required
                          type="number"
                          min="1"
                          max="65535"
                          disabled={!form.canManage}
                          value={form.imapPort}
                          onChange={(event) =>
                            update("imapPort", event.target.value)
                          }
                          className={inputClass}
                        />
                      </label>
                      <div>
                        <p className="text-sm font-semibold text-slate-800">
                          Incoming connection security
                        </p>
                        <div className="mt-2 grid grid-cols-2 rounded-2xl bg-slate-100 p-1">
                          <button
                            type="button"
                            disabled={!form.canManage}
                            onClick={() => update("imapSecure", true)}
                            className={`rounded-xl px-3 py-2 text-xs font-semibold ${form.imapSecure ? "bg-white shadow-sm" : "text-slate-500"}`}
                          >
                            SSL
                          </button>
                          <button
                            type="button"
                            disabled={!form.canManage}
                            onClick={() => update("imapSecure", false)}
                            className={`rounded-xl px-3 py-2 text-xs font-semibold ${!form.imapSecure ? "bg-white shadow-sm" : "text-slate-500"}`}
                          >
                            STARTTLS
                          </button>
                        </div>
                      </div>
                    </>
                  ) : null}
                </div>
              </motion.div>
            ) : null}
          </AnimatePresence>
        </section>

        <label className="flex items-center justify-between rounded-3xl bg-slate-50 px-5 py-4">
          <span>
            <span className="block text-sm font-semibold text-slate-900">
              Use this mailbox for client email
            </span>
            <span className="mt-1 block text-xs leading-5 text-slate-500">
              Turn this off to keep the details without allowing messages to be
              sent.
            </span>
          </span>
          <button
            type="button"
            disabled={!form.canManage}
            onClick={() => update("enabled", !form.enabled)}
            className={`relative h-7 w-12 shrink-0 rounded-full transition disabled:opacity-50 ${form.enabled ? "bg-slate-950" : "bg-slate-300"}`}
            aria-label="Toggle client email"
          >
            <span
              className={`absolute top-1 h-5 w-5 rounded-full bg-white shadow transition ${form.enabled ? "left-6" : "left-1"}`}
            />
          </button>
        </label>

        <div className="flex justify-end">
          <button
            type="submit"
            disabled={busy || !form.canManage || !form.secureStorageReady}
            className="inline-flex items-center gap-2 rounded-full bg-slate-950 px-5 py-3 text-sm font-semibold text-white shadow-[0_12px_28px_rgba(15,23,42,0.18)] disabled:opacity-50"
          >
            {busy ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <ShieldCheck className="h-4 w-4" />
            )}
            {saving
              ? "Saving securely…"
              : testing
                ? "Checking connection…"
                : "Save and check connection"}
          </button>
        </div>
      </form>

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
