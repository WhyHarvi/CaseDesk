import {
  CalendarClock,
  ChevronDown,
  FileText,
  Loader2,
  Mail,
  MessageSquareText,
  MessagesSquare,
  Paperclip,
  PhoneCall,
  Search,
  Send,
  Sparkles,
  X,
} from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import api from "../../../services/api";

const channels = {
  Email: {
    label: "Email",
    icon: Mail,
    tone: "bg-blue-50 text-[#002FA7]",
    permission: "canSendEmail",
  },
  Sms: {
    label: "SMS",
    icon: MessageSquareText,
    tone: "bg-emerald-50 text-emerald-600",
    permission: "canSendSms",
  },
  Chat: {
    label: "Chat",
    icon: MessagesSquare,
    tone: "bg-violet-50 text-violet-600",
    permission: "canUseChat",
  },
  Call: {
    label: "Call",
    icon: PhoneCall,
    tone: "bg-amber-50 text-amber-700",
    permission: "canInitiateCalls",
  },
};

const inputClass =
  "mt-2 w-full rounded-2xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-900 outline-none transition focus:border-[#002FA7] focus:ring-4 focus:ring-blue-100/70";
const splitAddresses = (value) =>
  String(value || "")
    .split(/[;,]/)
    .map((item) => item.trim())
    .filter(Boolean);

const EMAIL_SUBJECT_MAX_WORDS = 10;
const subjectWordCount = (value) =>
  String(value || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;

function mergeTemplate(value, caseItem) {
  const replacements = {
    "client.fullName": caseItem.client?.fullName || "",
    "client.email": caseItem.client?.email || "",
    "client.phone": caseItem.client?.phone || "",
    "case.caseType": caseItem.caseType || "",
    "case.stage": caseItem.stage || "",
  };
  return String(value || "").replace(
    /{{\s*([^}]+)\s*}}/g,
    (match, key) => replacements[key.trim()] ?? match,
  );
}

function initialValues(channel, caseItem, reply) {
  const replyMessage = reply?.message;
  const clientRecipient =
    channel === "Email" ? caseItem.client?.email : caseItem.client?.phone;
  return {
    channel,
    to:
      replyMessage?.direction === "Inbound"
        ? replyMessage.senderAddress || clientRecipient || ""
        : clientRecipient || "",
    cc: "",
    bcc: "",
    replyTo: "",
    subject: replyMessage?.subject
      ? `${/^re:/i.test(replyMessage.subject) ? "" : "Re: "}${replyMessage.subject}`
      : "",
    bodyText: "",
    scheduledAt: "",
    callMode: "log",
    callDisposition: "Completed",
    durationMinutes: "",
  };
}

export default function CommunicationComposer({
  initialChannel = "Email",
  caseItem,
  providers,
  permissions,
  templates,
  reply,
  prefill,
  allowClientSelection = false,
  lockChannel = false,
  onClose,
  onSaved,
}) {
  const [selectedClient, setSelectedClient] = useState(caseItem.client || null);
  const [clientSearch, setClientSearch] = useState("");
  const [clientResults, setClientResults] = useState([]);
  const [clientsLoading, setClientsLoading] = useState(allowClientSelection);
  const effectiveCaseItem = useMemo(
    () => ({ ...caseItem, client: selectedClient }),
    [caseItem, selectedClient],
  );
  const [values, setValues] = useState(() => ({
    ...initialValues(initialChannel, effectiveCaseItem, reply),
    ...(prefill || {}),
  }));
  const [files, setFiles] = useState([]);
  const [showEmailOptions, setShowEmailOptions] = useState(false);
  const [saving, setSaving] = useState(false);
  const [autoSaving, setAutoSaving] = useState(false);
  const [error, setError] = useState("");
  const [draftId, setDraftId] = useState(null);
  const [savedAt, setSavedAt] = useState(null);
  const [shorteningSubject, setShorteningSubject] = useState(false);
  const [subjectSuggestion, setSubjectSuggestion] = useState(null);
  const idempotencyKey = useRef(crypto.randomUUID());
  const submitting = useRef(false);
  const config = channels[values.channel];
  const provider = providers[values.channel] || {};
  const allowed = permissions?.[config.permission] !== false;
  const subjectWords = subjectWordCount(values.subject);
  const channelTemplates = useMemo(
    () => templates.filter((item) => item.channel === values.channel),
    [templates, values.channel],
  );
  const update = (key, value) =>
    setValues((current) => ({ ...current, [key]: value }));

  useEffect(() => {
    if (!allowClientSelection || selectedClient) return undefined;
    let active = true;
    const timer = window.setTimeout(() => {
      setClientsLoading(true);
      api.get(`/clients?limit=20${clientSearch.trim() ? `&search=${encodeURIComponent(clientSearch.trim())}` : ""}`)
        .then((response) => {
          if (active) setClientResults(response.data.data || []);
        })
        .catch(() => {
          if (active) setError("Clients could not be loaded.");
        })
        .finally(() => {
          if (active) setClientsLoading(false);
        });
    }, 250);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [allowClientSelection, clientSearch, selectedClient]);

  const chooseClient = (client) => {
    setSelectedClient(client);
    setValues((current) => ({ ...current, to: client.email || "" }));
    setError("");
  };

  const payload = (sendNow = false) => ({
    caseId: effectiveCaseItem.id || undefined,
    clientId: effectiveCaseItem.client?.id || undefined,
    conversationId: reply?.conversationId || undefined,
    parentMessageId: reply?.message?.id || undefined,
    channel: values.channel,
    direction: values.channel === "Chat" ? "Outbound" : "Outbound",
    recipients: splitAddresses(values.to),
    cc: splitAddresses(values.cc),
    bcc: splitAddresses(values.bcc),
    replyTo: values.replyTo || null,
    subject: values.subject || null,
    bodyText: values.bodyText || null,
    occurredAt: new Date().toISOString(),
    scheduledAt: values.scheduledAt
      ? new Date(values.scheduledAt).toISOString()
      : null,
    durationSeconds: values.durationMinutes
      ? Math.round(Number(values.durationMinutes) * 60)
      : null,
    callDisposition: values.channel === "Call" ? values.callDisposition : null,
    // Without this, a brand-new Chat conversation started here (no prior
    // conversationId to inherit AuthenticatedPortal from) posts under the
    // generic "Supabase" chat provider instead — the client's portal inbox
    // isn't filtered by provider so they'd still see it, but it silently
    // skips the activePortal check and reads inconsistently with the
    // client-profile composer, which always sends this for Chat.
    portalAudience: values.channel === "Chat" ? true : undefined,
    sendNow,
    initiateCall: false,
    idempotencyKey: idempotencyKey.current,
  });

  useEffect(() => {
    if (
      submitting.current ||
      !effectiveCaseItem.client?.id ||
      !["Email", "Sms"].includes(values.channel) ||
      (!values.subject.trim() && !values.bodyText.trim())
    )
      return undefined;
    const timer = setTimeout(async () => {
      try {
        setAutoSaving(true);
        const response = draftId
          ? await api.patch(
              `/communications/messages/${draftId}/draft`,
              payload(false),
            )
          : await api.post("/communications/messages", payload(false), {
              headers: { "Idempotency-Key": idempotencyKey.current },
            });
        setDraftId(response.data.data.id);
        setSavedAt(new Date());
      } catch (requestError) {
        setError(
          requestError.response?.data?.message || "Draft autosave failed.",
        );
      } finally {
        setAutoSaving(false);
      }
    }, 1400);
    return () => clearTimeout(timer);
  }, [
    values.to,
    values.cc,
    values.bcc,
    values.replyTo,
    values.subject,
    values.bodyText,
    values.channel,
    draftId,
  ]);

  const chooseChannel = (channel) => {
    setValues(initialValues(channel, effectiveCaseItem, null));
    setDraftId(null);
    setFiles([]);
    idempotencyKey.current = crypto.randomUUID();
    setError("");
  };

  const insertTemplate = (id) => {
    const template = templates.find((item) => item.id === id);
    if (!template) return;
    setValues((current) => ({
      ...current,
      subject: mergeTemplate(template.subject, effectiveCaseItem),
      bodyText: mergeTemplate(template.bodyText, effectiveCaseItem),
    }));
  };

  const updateSubject = (value) => {
    setSubjectSuggestion(null);
    update("subject", value);
  };

  const shortenSubject = async () => {
    try {
      setShorteningSubject(true);
      const response = await api.post("/communications/subject/shorten", {
        subject: values.subject,
      });
      setSubjectSuggestion(response.data.data.subject);
    } catch (requestError) {
      setError(
        requestError.response?.data?.message ||
          "Nova could not shorten this subject right now.",
      );
    } finally {
      setShorteningSubject(false);
    }
  };

  const acceptSubjectSuggestion = () => {
    if (!subjectSuggestion) return;
    update("subject", subjectSuggestion);
    setSubjectSuggestion(null);
  };

  const persistDraft = async () => {
    const response = draftId
      ? await api.patch(
          `/communications/messages/${draftId}/draft`,
          payload(false),
        )
      : await api.post("/communications/messages", payload(false), {
          headers: { "Idempotency-Key": idempotencyKey.current },
        });
    const id = response.data.data.id;
    setDraftId(id);
    for (const file of files) {
      const data = new FormData();
      data.append("file", file);
      await api.post(`/communications/messages/${id}/attachments`, data, {
        headers: { "Content-Type": "multipart/form-data" },
        timeout: 45000,
      });
    }
    return response.data.data;
  };

  const submit = async (event) => {
    event.preventDefault();
    if (!effectiveCaseItem.client?.id) {
      setError("Select a client before composing this email.");
      return;
    }
    const intent = event.nativeEvent.submitter?.value || "send";
    if (intent !== "draft" && values.channel === "Email") {
      const trimmedSubject = values.subject.trim();
      if (!trimmedSubject) {
        setError("Add a subject before sending this email.");
        return;
      }
      const words = subjectWordCount(trimmedSubject);
      if (words > EMAIL_SUBJECT_MAX_WORDS) {
        setError(
          `Keep the subject to ${EMAIL_SUBJECT_MAX_WORDS} words or fewer (currently ${words}).`,
        );
        return;
      }
    }
    try {
      submitting.current = true;
      setSaving(true);
      setError("");
      let message;
      if (["Email", "Sms"].includes(values.channel)) {
        message = await persistDraft();
        if (intent !== "draft") {
          const sent = await api.post(
            `/communications/messages/${message.id}/send`,
            values.scheduledAt
              ? { scheduledAt: new Date(values.scheduledAt).toISOString() }
              : {},
          );
          message = sent.data.data;
        }
      } else {
        const response = await api.post(
          "/communications/messages",
          payload(intent !== "draft" && values.channel !== "Call"),
          {
            headers: { "Idempotency-Key": idempotencyKey.current },
            timeout: 30000,
          },
        );
        message = response.data.data;
      }
      onSaved(message, { intent, client: effectiveCaseItem.client });
      onClose();
    } catch (requestError) {
      setError(
        requestError.response?.data?.message ||
          "This communication could not be saved.",
      );
    } finally {
      submitting.current = false;
      setSaving(false);
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-[440] flex justify-end bg-slate-950/20 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="communication-composer-title">
      <button
        type="button"
        className="absolute inset-0"
        onClick={onClose}
        aria-label="Close communication composer"
      />
      <motion.form
        initial={{ x: "100%" }}
        animate={{ x: 0 }}
        exit={{ x: "100%" }}
        transition={{ type: "spring", stiffness: 330, damping: 34 }}
        onSubmit={submit}
        className="relative flex h-full w-full max-w-3xl flex-col overflow-hidden border-l border-slate-200 bg-white shadow-[-24px_0_70px_rgba(15,23,42,0.18)]"
      >
        <header className="flex items-start justify-between gap-4 border-b border-slate-100 px-6 py-5">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[#002FA7]">
              Client communication
            </p>
            <h2 id="communication-composer-title" className="mt-1 text-xl font-semibold tracking-tight">
              {reply
                ? `Reply to ${effectiveCaseItem.client?.fullName}`
                : effectiveCaseItem.client?.fullName
                  ? `New communication — ${effectiveCaseItem.client.fullName}`
                  : "New client email"}
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              Drafts save automatically. Provider delivery runs safely in the
              background.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-500"
          >
            <X className="h-4 w-4" />
          </button>
        </header>
        <main className="scrollbar-hidden min-h-0 flex-1 space-y-4 overflow-y-auto bg-slate-50/60 p-5">
          {!reply && !lockChannel ? (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {Object.entries(channels).map(([channel, item]) => {
                const Icon = item.icon;
                const disabled = permissions?.[item.permission] === false;
                return (
                  <button
                    key={channel}
                    type="button"
                    disabled={disabled}
                    onClick={() => chooseChannel(channel)}
                    className={`rounded-2xl border p-3 text-left transition disabled:opacity-40 ${values.channel === channel ? "border-[#002FA7] bg-white shadow-sm" : "border-slate-100 bg-white/70"}`}
                  >
                    <span
                      className={`flex h-9 w-9 items-center justify-center rounded-xl ${item.tone}`}
                    >
                      <Icon className="h-4 w-4" />
                    </span>
                    <span className="mt-2 block text-xs font-semibold">
                      {item.label}
                    </span>
                  </button>
                );
              })}
            </div>
          ) : null}
          {allowClientSelection ? (
            <section className="rounded-[1.5rem] border border-slate-100 bg-white p-4 shadow-sm">
              <p className="text-sm font-semibold text-slate-800">Client</p>
              {selectedClient ? (
                <div className="mt-2 flex items-center justify-between gap-3 rounded-2xl border border-blue-100 bg-blue-50/60 px-4 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-slate-950">{selectedClient.fullName}</p>
                    <p className="mt-0.5 truncate text-xs text-slate-500">{selectedClient.email}</p>
                  </div>
                  <button
                    type="button"
                    disabled={Boolean(draftId)}
                    onClick={() => {
                      setSelectedClient(null);
                      setValues((current) => ({ ...current, to: "" }));
                    }}
                    className="shrink-0 rounded-full border border-blue-200 bg-white px-3 py-1.5 text-xs font-semibold text-[#002FA7] disabled:opacity-40"
                  >
                    Change
                  </button>
                </div>
              ) : (
                <>
                  <label className="relative mt-2 block">
                    <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                    <input
                      autoFocus
                      value={clientSearch}
                      onChange={(event) => setClientSearch(event.target.value)}
                      placeholder="Search clients"
                      className="h-11 w-full rounded-2xl border border-slate-200 bg-white pl-10 pr-3 text-sm outline-none transition focus:border-[#002FA7] focus:ring-4 focus:ring-blue-100/70"
                    />
                  </label>
                  <div className="mt-2 max-h-52 overflow-y-auto rounded-2xl border border-slate-200">
                    {clientsLoading ? (
                      <div className="flex justify-center py-8"><Loader2 className="h-4 w-4 animate-spin text-slate-400" /></div>
                    ) : clientResults.length ? clientResults.map((client) => (
                      <button
                        key={client.id}
                        type="button"
                        disabled={!client.email}
                        onClick={() => chooseClient(client)}
                        className="block w-full border-b border-slate-100 px-4 py-3 text-left transition last:border-b-0 hover:bg-blue-50/60 disabled:cursor-not-allowed disabled:opacity-45"
                      >
                        <span className="block truncate text-sm font-semibold text-slate-900">{client.fullName}</span>
                        <span className={`mt-0.5 block truncate text-xs ${client.email ? "text-slate-500" : "text-rose-600"}`}>{client.email || "No email on file"}</span>
                      </button>
                    )) : <p className="px-4 py-8 text-center text-xs text-slate-500">No clients found.</p>}
                  </div>
                </>
              )}
            </section>
          ) : null}
          {error ? (
            <p className="rounded-2xl bg-rose-50 px-4 py-3 text-sm text-rose-700">
              {error}
            </p>
          ) : null}
          <section className="rounded-[1.5rem] border border-slate-100 bg-white p-4 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <span
                  className={`flex h-9 w-9 items-center justify-center rounded-xl ${config.tone}`}
                >
                  <config.icon className="h-4 w-4" />
                </span>
                <div>
                  <p className="text-sm font-semibold">{config.label}</p>
                  <p className="text-[10px] text-slate-400">
                    {provider.detail || provider.provider || "CaseDesk"}
                  </p>
                </div>
              </div>
              <span
                className={`rounded-full px-2.5 py-1 text-[10px] font-semibold ${allowed && (provider.sendConfigured || values.channel === "Chat") ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}
              >
                {allowed && (provider.sendConfigured || values.channel === "Chat") ? "Ready" : "Record only"}
              </span>
            </div>
            {values.channel !== "Chat" ? (
              <label className="mt-4 block text-sm font-semibold text-slate-800">
                {values.channel === "Email" ? "To" : "Phone number"}
                <input
                  required
                  readOnly={allowClientSelection}
                  value={values.to}
                  onChange={(event) => update("to", event.target.value)}
                  className={inputClass}
                  placeholder={
                    values.channel === "Email"
                      ? "client@example.com"
                      : "+1 416 555 0100"
                  }
                />
              </label>
            ) : null}
            {values.channel === "Email" ? (
              <>
                <button
                  type="button"
                  onClick={() => setShowEmailOptions((open) => !open)}
                  className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-[#002FA7]"
                >
                  CC, BCC & reply address{" "}
                  <ChevronDown
                    className={`h-3.5 w-3.5 transition ${showEmailOptions ? "rotate-180" : ""}`}
                  />
                </button>
                <AnimatePresence initial={false}>
                  {showEmailOptions ? (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: "auto", opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      className="overflow-hidden"
                    >
                      <div className="mt-3 grid gap-3 sm:grid-cols-2">
                        <label className="text-xs font-semibold text-slate-600">
                          CC
                          <input
                            value={values.cc}
                            onChange={(event) =>
                              update("cc", event.target.value)
                            }
                            className={inputClass}
                            placeholder="Separate addresses with commas"
                          />
                        </label>
                        <label className="text-xs font-semibold text-slate-600">
                          BCC
                          <input
                            value={values.bcc}
                            onChange={(event) =>
                              update("bcc", event.target.value)
                            }
                            className={inputClass}
                          />
                        </label>
                        <label className="text-xs font-semibold text-slate-600 sm:col-span-2">
                          Replies should go to
                          <input
                            value={values.replyTo}
                            onChange={(event) =>
                              update("replyTo", event.target.value)
                            }
                            className={inputClass}
                            placeholder="Defaults to the connected mailbox"
                          />
                        </label>
                      </div>
                    </motion.div>
                  ) : null}
                </AnimatePresence>
              </>
            ) : null}
            {values.channel === "Email" ? (
              <label className="mt-4 block text-sm font-semibold text-slate-800">
                Subject
                <input
                  value={values.subject}
                  onChange={(event) => updateSubject(event.target.value)}
                  className={inputClass}
                />
              </label>
            ) : null}
            {values.channel === "Email" ? (
              <div className="mt-1.5 flex items-center justify-between gap-2 text-[10px] font-normal">
                <span
                  className={
                    subjectWords > EMAIL_SUBJECT_MAX_WORDS
                      ? "font-semibold text-rose-600"
                      : "text-slate-400"
                  }
                >
                  {subjectWords}/{EMAIL_SUBJECT_MAX_WORDS} words
                </span>
                {subjectWords > EMAIL_SUBJECT_MAX_WORDS ? (
                  <button
                    type="button"
                    onClick={shortenSubject}
                    disabled={shorteningSubject}
                    className="inline-flex items-center gap-1 font-semibold text-[#002FA7] disabled:opacity-50"
                  >
                    {shorteningSubject ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <Sparkles className="h-3 w-3" />
                    )}
                    {shorteningSubject ? "Asking Nova…" : "Shorten with Nova"}
                  </button>
                ) : null}
              </div>
            ) : null}
            {values.channel === "Email" && subjectSuggestion ? (
              <div className="mt-2 flex items-center justify-between gap-3 rounded-xl bg-blue-50 px-3 py-2 text-xs text-blue-900">
                <span className="min-w-0 flex-1">
                  Nova suggests: <span className="font-semibold">“{subjectSuggestion}”</span>
                </span>
                <span className="flex shrink-0 items-center gap-2">
                  <button
                    type="button"
                    onClick={acceptSubjectSuggestion}
                    className="font-semibold text-[#002FA7]"
                  >
                    Use this
                  </button>
                  <button
                    type="button"
                    onClick={() => setSubjectSuggestion(null)}
                    className="text-slate-400"
                  >
                    Dismiss
                  </button>
                </span>
              </div>
            ) : null}
            {channelTemplates.length && values.channel !== "Call" ? (
              <label className="mt-4 block text-sm font-semibold text-slate-800">
                Insert template
                <select
                  defaultValue=""
                  onChange={(event) => {
                    insertTemplate(event.target.value);
                    event.target.value = "";
                  }}
                  className="select-field mt-2 w-full"
                >
                  <option value="">Choose a reusable template…</option>
                  {channelTemplates.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.category ? `${item.category} · ` : ""}
                      {item.name}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            {values.channel !== "Call" ? (
              <label className="mt-4 block text-sm font-semibold text-slate-800">
                Message
                <textarea
                  required
                  rows={7}
                  value={values.bodyText}
                  onChange={(event) => update("bodyText", event.target.value)}
                  className={`${inputClass} resize-none leading-6`}
                  placeholder="Write a clear message…"
                />
                <span className="mt-1.5 flex justify-between text-[10px] font-normal text-slate-400">
                  <span>
                    {values.channel === "Sms"
                      ? `${Math.max(1, Math.ceil(values.bodyText.length / 160))} SMS segment${values.bodyText.length > 160 ? "s" : ""}`
                      : "Plain text is retained for the legal record"}
                  </span>
                  <span>
                    {values.bodyText.length.toLocaleString()} characters
                  </span>
                </span>
              </label>
            ) : (
              <div className="mt-4 space-y-4">
                <p className="rounded-2xl bg-blue-50 px-4 py-3 text-xs leading-5 text-blue-900">
                  Log a completed call here. Use the Twilio dialpad for live calls.
                </p>
                <div className="grid gap-4 sm:grid-cols-2">
                    <label className="text-sm font-semibold text-slate-800">
                      Call outcome
                      <select
                        value={values.callDisposition}
                        onChange={(event) =>
                          update("callDisposition", event.target.value)
                        }
                        className="select-field mt-2 w-full"
                      >
                        <option>Completed</option>
                        <option>Missed</option>
                        <option>Voicemail</option>
                        <option>No answer</option>
                        <option>Busy</option>
                      </select>
                    </label>
                    <label className="text-sm font-semibold text-slate-800">
                      Duration in minutes
                      <input
                        type="number"
                        min="0"
                        value={values.durationMinutes}
                        onChange={(event) =>
                          update("durationMinutes", event.target.value)
                        }
                        className={inputClass}
                      />
                    </label>
                </div>
                <label className="block text-sm font-semibold text-slate-800">
                  Call notes
                  <textarea
                    rows={4}
                    value={values.bodyText}
                    onChange={(event) => update("bodyText", event.target.value)}
                    className={`${inputClass} resize-none leading-6`}
                    placeholder="Purpose, outcome, advice given, and next steps"
                  />
                </label>
              </div>
            )}
          </section>
          {["Email", "Sms"].includes(values.channel) ? (
            <section className="rounded-[1.5rem] border border-slate-100 bg-white p-4 shadow-sm">
              <div
                className={`grid gap-4 ${values.channel === "Email" ? "sm:grid-cols-2" : ""}`}
              >
                {values.channel === "Email" ? (
                  <label className="text-sm font-semibold text-slate-800">
                    <span className="flex items-center gap-2">
                      <Paperclip className="h-4 w-4" /> Attach files
                    </span>
                    <input
                      type="file"
                      multiple
                      onChange={(event) =>
                        setFiles(Array.from(event.target.files || []))
                      }
                      className="mt-2 block w-full text-xs text-slate-500 file:mr-3 file:rounded-full file:border-0 file:bg-slate-100 file:px-3 file:py-2 file:text-xs file:font-semibold"
                    />
                  </label>
                ) : null}
                <label className="text-sm font-semibold text-slate-800">
                  <span className="flex items-center gap-2">
                    <CalendarClock className="h-4 w-4" /> Schedule delivery
                  </span>
                  <input
                    type="datetime-local"
                    value={values.scheduledAt}
                    min={new Date().toISOString().slice(0, 16)}
                    onChange={(event) =>
                      update("scheduledAt", event.target.value)
                    }
                    className={inputClass}
                  />
                </label>
              </div>
              {values.channel === "Email" && files.length ? (
                <div className="mt-3 flex flex-wrap gap-2">
                  {files.map((file) => (
                    <span
                      key={`${file.name}-${file.size}`}
                      className="rounded-full bg-slate-100 px-3 py-1.5 text-[10px] font-semibold text-slate-600"
                    >
                      {file.name}
                    </span>
                  ))}
                </div>
              ) : null}
            </section>
          ) : null}
        </main>
        <footer className="flex flex-col gap-3 border-t border-slate-100 bg-white px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-slate-400">
            {autoSaving
              ? "Saving draft…"
              : savedAt
                ? `Draft saved ${savedAt.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`
                : "Unsaved changes are protected by autosave"}
          </p>
          <div className="flex justify-end gap-2">
            {["Email", "Sms"].includes(values.channel) ? (
              <button
                type="submit"
                value="draft"
                disabled={saving || !effectiveCaseItem.client?.id}
                className="inline-flex items-center gap-2 rounded-full border border-slate-200 px-4 py-2.5 text-sm font-semibold"
              >
                <FileText className="h-4 w-4" /> Save draft
              </button>
            ) : null}
            <button
              type="submit"
              value="send"
              disabled={
                saving ||
                !effectiveCaseItem.client?.id ||
                !allowed ||
                // Chat's "sendConfigured" reflects live Supabase Realtime
                // push readiness, not whether the message can be delivered —
                // an authenticated portal message is durably saved and the
                // client sees it in their portal regardless of realtime
                // status, exactly like the client-profile composer, which
                // never gates its own send button on this at all.
                (!["Call", "Chat"].includes(values.channel) ? !provider.sendConfigured : false) ||
                (values.channel === "Email" &&
                  (!values.subject.trim() ||
                    subjectWords > EMAIL_SUBJECT_MAX_WORDS))
              }
                className="inline-flex items-center gap-2 rounded-full bg-[#002FA7] px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-blue-800 disabled:opacity-50"
            >
              {saving ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : values.scheduledAt ? (
                <CalendarClock className="h-4 w-4" />
              ) : (
                <Send className="h-4 w-4" />
              )}
              {saving
                ? "Saving…"
                : values.scheduledAt
                  ? "Schedule"
                  : values.channel === "Call"
                    ? "Save call record"
                    : "Send"}
            </button>
          </div>
        </footer>
      </motion.form>
    </div>,
    document.body,
  );
}
