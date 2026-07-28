import {
  Archive,
  ArrowDownLeft,
  ArrowUpRight,
  BarChart3,
  Bot,
  Check,
  ChevronRight,
  CircleAlert,
  Download,
  FileUp,
  Filter,
  Inbox,
  Loader2,
  Mail,
  MessageSquareText,
  MessagesSquare,
  MoreHorizontal,
  PhoneCall,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Trash2,
  UserRoundCheck,
  UsersRound,
  X,
} from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useSearchParams } from "react-router-dom";
import api from "../../services/api";
import CommunicationComposer from "./communication/CommunicationComposer";
import CommunicationAnalyticsPanel from "./communication/CommunicationAnalyticsPanel";
import CommunicationOperationsOverlay from "./communication/CommunicationOperationsOverlay";
import ClientChatAccessOverlay from "./communication/ClientChatAccessOverlay";
import ConversationOverlay from "./communication/ConversationOverlay";

const channelConfig = {
  Email: { label: "Email", icon: Mail, tone: "bg-blue-50 text-blue-600" },
  Sms: {
    label: "SMS",
    icon: MessageSquareText,
    tone: "bg-emerald-50 text-emerald-600",
  },
  Chat: {
    label: "Chat",
    icon: MessagesSquare,
    tone: "bg-violet-50 text-violet-600",
  },
  Call: { label: "Calls", icon: PhoneCall, tone: "bg-amber-50 text-amber-700" },
};
const statuses = [
  "All",
  "Draft",
  "Scheduled",
  "Queued",
  "Sending",
  "Sent",
  "Delivered",
  "Received",
  "Failed",
  "Bounced",
  "Blocked",
  "OptedOut",
  "Cancelled",
  "Missed",
  "Completed",
];
const inputClass =
  "mt-2 w-full rounded-2xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-900 outline-none transition focus:border-sky-400 focus:ring-4 focus:ring-sky-100/60";
const formatWhen = (value) =>
  new Date(value).toLocaleString("en-CA", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
const summary = (item) =>
  item.channel === "Call"
    ? `${item.callDisposition || "Call"}${item.durationSeconds ? ` · ${Math.max(1, Math.round(item.durationSeconds / 60))} min` : ""}`
    : item.bodyText || item.subject || "No message content";
const statusTone = (status) =>
  ["Failed", "Bounced", "Blocked", "Missed"].includes(status)
    ? "bg-rose-50 text-rose-700"
    : ["Draft", "Scheduled", "Queued", "Sending"].includes(status)
      ? "bg-amber-50 text-amber-700"
      : "bg-emerald-50 text-emerald-700";

function Shell({ children, onClose, maxWidth = "max-w-lg" }) {
  return createPortal(
    <div className="fixed inset-0 z-[460] flex items-center justify-center bg-slate-950/25 p-4 backdrop-blur-md">
      <button
        type="button"
        className="absolute inset-0"
        onClick={onClose}
        aria-label="Close overlay"
      />
      <motion.section
        initial={{ opacity: 0, y: 14, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 8, scale: 0.99 }}
        className={`relative max-h-[92dvh] w-full ${maxWidth} overflow-hidden rounded-[1.8rem] border border-white/80 bg-white shadow-[0_30px_90px_rgba(15,23,42,0.25)]`}
      >
        {children}
      </motion.section>
    </div>,
    document.body,
  );
}

function HeaderActionsMenu({
  anchor,
  onClose,
  onConsent,
  onPreferences,
  onAutomations,
  onChatAccess,
  onTemplates,
  onImport,
}) {
  if (!anchor) return null;
  const items = [
    { label: "Consent records", icon: ShieldCheck, action: onConsent },
    {
      label: "Client preferences",
      icon: UserRoundCheck,
      action: onPreferences,
    },
    { label: "Automations & targets", icon: Bot, action: onAutomations },
    { label: "Client chat access", icon: MessagesSquare, action: onChatAccess },
    {
      label: "Message templates",
      icon: SlidersHorizontal,
      action: onTemplates,
    },
    { label: "Import history", icon: FileUp, action: onImport },
  ];
  const left = Math.max(
    12,
    Math.min(anchor.right - 224, window.innerWidth - 236),
  );
  return createPortal(
    <div className="fixed inset-0 z-[455]">
      <button
        type="button"
        className="absolute inset-0"
        onClick={onClose}
        aria-label="Close communication menu"
      />
      <motion.div
        initial={{ opacity: 0, y: -5, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        style={{
          left,
          top: Math.min(anchor.bottom + 8, window.innerHeight - 290),
        }}
        className="fixed w-56 overflow-hidden rounded-2xl border border-white/80 bg-white/95 p-1.5 shadow-[0_24px_70px_rgba(15,23,42,.22)] backdrop-blur-xl"
      >
        {items.map(({ label, icon: Icon, action }) => (
          <button
            key={label}
            type="button"
            onClick={() => {
              action();
              onClose();
            }}
            className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-xs font-semibold text-slate-700 hover:bg-slate-100"
          >
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-slate-100 text-slate-500">
              <Icon className="h-3.5 w-3.5" />
            </span>
            {label}
          </button>
        ))}
      </motion.div>
    </div>,
    document.body,
  );
}

function TrashOverlay({ count, busy, error, onClose, onConfirm }) {
  return (
    <Shell onClose={onClose}>
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
        <h3 className="mt-4 text-xl font-semibold">
          Move {count} record{count === 1 ? "" : "s"} to Trash?
        </h3>
        <p className="mt-2 text-sm leading-6 text-slate-500">
          The records disappear from the active timeline but remain recoverable
          under the workspace retention policy. Legal-hold records are always
          protected.
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
          Keep records
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={onConfirm}
          className="rounded-2xl bg-rose-600 px-4 py-3 text-sm font-semibold text-white disabled:opacity-50"
        >
          {busy ? "Moving…" : "Move to Trash"}
        </button>
      </div>
    </Shell>
  );
}

function ImportOverlay({ busy, error, onClose, onImport }) {
  const [file, setFile] = useState(null);
  const submit = async (event) => {
    event.preventDefault();
    const text = await file.text();
    let source;
    if (file.name.toLowerCase().endsWith(".json")) source = JSON.parse(text);
    else {
      const lines = text.split(/\r?\n/).filter(Boolean);
      const headers = (lines.shift() || "").split(",").map((value) =>
        value
          .replace(/^\uFEFF/, "")
          .replace(/^"|"$/g, "")
          .trim(),
      );
      source = lines.map((line) => {
        const values =
          line
            .match(/("(?:[^"]|"")*"|[^,]*)(?:,|$)/g)
            ?.map((value) =>
              value
                .replace(/,$/, "")
                .replace(/^"|"$/g, "")
                .replaceAll('""', '"'),
            ) || [];
        return Object.fromEntries(
          headers.map((header, index) => [header, values[index] || ""]),
        );
      });
    }
    const rows = Array.isArray(source) ? source : source.records || [];
    await onImport(
      rows.map((record) => ({
        occurredAt: record.occurredAt || record.Date,
        channel: record.channel || record.Channel,
        direction: record.direction || record.Direction,
        status: record.status || record.Status,
        subject: record.subject || record.Subject,
        senderAddress: record.senderAddress || record.From,
        recipients: Array.isArray(record.recipients)
          ? record.recipients
          : String(record.recipients || record.Recipients || "")
              .split(";")
              .map((value) => value.trim())
              .filter(Boolean),
        bodyText: record.bodyText || record.Message,
        durationSeconds: record.durationSeconds || record["Duration Seconds"],
        callDisposition: record.callDisposition || record.Disposition,
        provider: record.provider || record.Provider,
        providerMessageId:
          record.providerMessageId || record["Provider Message ID"],
      })),
    );
  };
  return (
    <Shell onClose={onClose}>
      <form onSubmit={submit}>
        <div className="px-6 pb-6 pt-6">
          <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-sky-50 text-sky-600">
            <FileUp className="h-5 w-5" />
          </span>
          <h3 className="mt-4 text-xl font-semibold">
            Import communication history
          </h3>
          <p className="mt-2 text-sm leading-6 text-slate-500">
            Upload CSV or JSON. Provider message IDs are used to skip duplicates
            safely.
          </p>
          <label className="mt-5 flex cursor-pointer flex-col items-center rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-5 py-8 text-center">
            <FileUp className="h-6 w-6 text-slate-400" />
            <span className="mt-2 text-sm font-semibold">
              {file?.name || "Choose JSON or CSV"}
            </span>
            <input
              type="file"
              accept=".json,.csv,application/json,text/csv"
              className="sr-only"
              onChange={(event) => setFile(event.target.files?.[0] || null)}
            />
          </label>
          {error ? (
            <p className="mt-3 rounded-xl bg-rose-50 px-3 py-2 text-xs text-rose-700">
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
            Cancel
          </button>
          <button
            type="submit"
            disabled={!file || busy}
            className="rounded-2xl bg-slate-950 px-4 py-3 text-sm font-semibold text-white disabled:opacity-50"
          >
            {busy ? "Importing…" : "Import"}
          </button>
        </div>
      </form>
    </Shell>
  );
}

function TemplateOverlay({
  templates,
  permissions,
  busy,
  error,
  onClose,
  onCreate,
  onUpdate,
  onDelete,
}) {
  const [values, setValues] = useState({
    channel: "Email",
    name: "",
    category: "",
    subject: "",
    bodyText: "",
  });
  const [editingId, setEditingId] = useState("");
  const [confirmDelete, setConfirmDelete] = useState("");
  const submit = async (event) => {
    event.preventDefault();
    const saved = editingId
      ? await onUpdate(editingId, values)
      : await onCreate(values);
    if (!saved) return;
    setValues((current) => ({
      ...current,
      name: "",
      category: "",
      subject: "",
      bodyText: "",
    }));
    setEditingId("");
  };
  return (
    <Shell onClose={onClose} maxWidth="max-w-2xl">
      <div className="flex max-h-[92dvh] flex-col">
        <header className="flex items-start justify-between border-b border-slate-100 px-6 py-5">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-sky-600">
              Reusable content
            </p>
            <h3 className="mt-1 text-xl font-semibold">
              Communication templates
            </h3>
            <p className="mt-1 text-sm text-slate-500">
              Merge fields supported: {"{{client.fullName}}"},{" "}
              {"{{case.caseType}}"}, and {"{{case.stage}}"}.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-100"
          >
            <X className="h-4 w-4" />
          </button>
        </header>
        <main className="scrollbar-hidden min-h-0 flex-1 overflow-y-auto bg-slate-50/60 p-5">
          {error ? (
            <p className="mb-3 rounded-xl bg-rose-50 px-3 py-2 text-xs text-rose-700">
              {error}
            </p>
          ) : null}
          {permissions?.canManageTemplates ? (
            <form
              onSubmit={submit}
              className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm"
            >
              <div className="grid gap-3 sm:grid-cols-3">
                <label className="text-xs font-semibold">
                  Channel
                  <select
                    value={values.channel}
                    onChange={(event) =>
                      setValues((current) => ({
                        ...current,
                        channel: event.target.value,
                      }))
                    }
                    className="select-field mt-2 w-full"
                  >
                    <option>Email</option>
                    <option value="Sms">SMS</option>
                    <option>Chat</option>
                  </select>
                </label>
                <label className="text-xs font-semibold">
                  Template name
                  <input
                    required
                    value={values.name}
                    onChange={(event) =>
                      setValues((current) => ({
                        ...current,
                        name: event.target.value,
                      }))
                    }
                    className={inputClass}
                  />
                </label>
                <label className="text-xs font-semibold">
                  Category
                  <input
                    value={values.category}
                    onChange={(event) =>
                      setValues((current) => ({
                        ...current,
                        category: event.target.value,
                      }))
                    }
                    className={inputClass}
                  />
                </label>
              </div>
              {values.channel === "Email" ? (
                <label className="mt-3 block text-xs font-semibold">
                  Subject
                  <input
                    value={values.subject}
                    onChange={(event) =>
                      setValues((current) => ({
                        ...current,
                        subject: event.target.value,
                      }))
                    }
                    className={inputClass}
                  />
                </label>
              ) : null}
              <label className="mt-3 block text-xs font-semibold">
                Message
                <textarea
                  required
                  rows={4}
                  value={values.bodyText}
                  onChange={(event) =>
                    setValues((current) => ({
                      ...current,
                      bodyText: event.target.value,
                    }))
                  }
                  className={`${inputClass} resize-none`}
                />
              </label>
              <div className="mt-3 flex justify-end">
                <button
                  type="submit"
                  disabled={busy}
                  className="rounded-full bg-slate-950 px-4 py-2 text-xs font-semibold text-white"
                >
                  {editingId ? "Save changes" : "Add template"}
                </button>
              </div>
            </form>
          ) : null}
          <div className="mt-4 space-y-2">
            {templates.map((template) => (
              <article
                key={template.id}
                role={permissions?.canManageTemplates ? "button" : undefined}
                tabIndex={permissions?.canManageTemplates ? 0 : undefined}
                onClick={() => {
                  if (!permissions?.canManageTemplates) return;
                  setEditingId(template.id);
                  setValues({
                    channel: template.channel,
                    name: template.name,
                    category: template.category || "",
                    subject: template.subject || "",
                    bodyText: template.bodyText || "",
                  });
                }}
                className={`flex items-center justify-between gap-3 rounded-2xl border bg-white px-4 py-3 ${editingId === template.id ? "border-sky-300 ring-4 ring-sky-50" : "border-slate-200"}`}
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold">
                    {template.name}
                  </p>
                  <p className="mt-0.5 text-[10px] text-slate-400">
                    {channelConfig[template.channel]?.label || template.channel}
                    {template.category ? ` · ${template.category}` : ""}
                  </p>
                </div>
                {permissions?.canManageTemplates ? (
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      if (confirmDelete === template.id) {
                        onDelete(template);
                        setConfirmDelete("");
                      } else setConfirmDelete(template.id);
                    }}
                    className={`flex h-8 items-center justify-center rounded-full text-[10px] font-semibold ${confirmDelete === template.id ? "bg-rose-600 px-3 text-white" : "w-8 bg-rose-50 text-rose-600"}`}
                  >
                    {confirmDelete === template.id ? (
                      "Delete?"
                    ) : (
                      <Trash2 className="h-3.5 w-3.5" />
                    )}
                  </button>
                ) : null}
              </article>
            ))}
            {!templates.length ? (
              <p className="py-10 text-center text-sm text-slate-400">
                No templates yet.
              </p>
            ) : null}
          </div>
        </main>
      </div>
    </Shell>
  );
}

function ConsentOverlay({
  caseItem,
  consents,
  permissions,
  busy,
  error,
  onClose,
  onSave,
}) {
  const current = (channel, address) =>
    consents.find(
      (item) =>
        item.channel === channel &&
        item.address.replace(/[^+\d]/g, "") ===
          String(address || "").replace(/[^+\d]/g, ""),
    ) ||
    consents.find(
      (item) =>
        item.channel === channel &&
        item.address.toLowerCase() === String(address || "").toLowerCase(),
    );
  const [emailStatus, setEmailStatus] = useState(
    current("Email", caseItem.client?.email)?.status || "Unknown",
  );
  const [smsStatus, setSmsStatus] = useState(
    current("Sms", caseItem.client?.phone)?.status || "Unknown",
  );
  const [source, setSource] = useState("");
  const submit = async (event) => {
    event.preventDefault();
    const jobs = [];
    if (caseItem.client?.email)
      jobs.push(
        onSave({
          caseId: caseItem.id,
          channel: "Email",
          address: caseItem.client.email,
          status: emailStatus,
          source:
            source ||
            (emailStatus === "Consented"
              ? "Recorded by consultant"
              : "Preference update"),
          purpose: "Case and client communication",
        }),
      );
    if (caseItem.client?.phone)
      jobs.push(
        onSave({
          caseId: caseItem.id,
          channel: "Sms",
          address: caseItem.client.phone,
          status: smsStatus,
          source:
            source ||
            (smsStatus === "Consented"
              ? "Recorded by consultant"
              : "Preference update"),
          purpose: "Case and client communication",
        }),
      );
    await Promise.all(jobs);
    onClose();
  };
  return (
    <Shell onClose={onClose}>
      <form onSubmit={submit}>
        <div className="px-6 pb-6 pt-6">
          <div className="flex items-start justify-between">
            <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-700">
              <ShieldCheck className="h-5 w-5" />
            </span>
            <button
              type="button"
              onClick={onClose}
              className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-100"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <h3 className="mt-4 text-xl font-semibold">Communication consent</h3>
          <p className="mt-2 text-sm leading-6 text-slate-500">
            Record the client’s channel preference and evidence. CaseDesk blocks
            delivery after an opt-out.
          </p>
          {error ? (
            <p className="mt-3 rounded-xl bg-rose-50 px-3 py-2 text-xs text-rose-700">
              {error}
            </p>
          ) : null}
          <div className="mt-5 space-y-3">
            {caseItem.client?.email ? (
              <label className="block rounded-2xl bg-slate-50 p-4 text-sm font-semibold">
                Email · {caseItem.client.email}
                <select
                  disabled={!permissions?.canManageConsent}
                  value={emailStatus}
                  onChange={(event) => setEmailStatus(event.target.value)}
                  className="select-field mt-2 w-full"
                >
                  <option>Unknown</option>
                  <option>Consented</option>
                  <option value="OptedOut">Opted out</option>
                </select>
              </label>
            ) : null}
            {caseItem.client?.phone ? (
              <label className="block rounded-2xl bg-slate-50 p-4 text-sm font-semibold">
                SMS · {caseItem.client.phone}
                <select
                  disabled={!permissions?.canManageConsent}
                  value={smsStatus}
                  onChange={(event) => setSmsStatus(event.target.value)}
                  className="select-field mt-2 w-full"
                >
                  <option>Unknown</option>
                  <option>Consented</option>
                  <option value="OptedOut">Opted out</option>
                </select>
              </label>
            ) : null}
            <label className="block text-sm font-semibold">
              Evidence or source
              <input
                disabled={!permissions?.canManageConsent}
                value={source}
                onChange={(event) => setSource(event.target.value)}
                className={inputClass}
                placeholder="Signed retainer, portal preference, verbal consent…"
              />
            </label>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3 border-t border-slate-100 bg-slate-50/70 p-4">
          <button
            type="button"
            onClick={onClose}
            className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={busy || !permissions?.canManageConsent}
            className="rounded-2xl bg-slate-950 px-4 py-3 text-sm font-semibold text-white disabled:opacity-50"
          >
            Save preferences
          </button>
        </div>
      </form>
    </Shell>
  );
}

export default function CommunicationWorkspace({ caseItem }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const [view, setView] = useState("timeline");
  const [records, setRecords] = useState([]);
  const [meta, setMeta] = useState({ page: 1, hasMore: false, counts: {} });
  const [providers, setProviders] = useState({});
  const [permissions, setPermissions] = useState({});
  const [templates, setTemplates] = useState([]);
  const [consents, setConsents] = useState([]);
  const [team, setTeam] = useState([]);
  const [channel, setChannel] = useState("All");
  const [status, setStatus] = useState("All");
  const [sort, setSort] = useState("newest");
  const [inboxScope, setInboxScope] = useState("all");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [compose, setCompose] = useState(null);
  const [conversationId, setConversationId] = useState(null);
  const [trashOpen, setTrashOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [templateOpen, setTemplateOpen] = useState(false);
  const [consentOpen, setConsentOpen] = useState(false);
  const [operationsTab, setOperationsTab] = useState("");
  const [chatAccessOpen, setChatAccessOpen] = useState(false);
  const [menuAnchor, setMenuAnchor] = useState(null);
  const debounce = useRef(null);
  const realtimeRefresh = useRef(null);
  const menuButton = useRef(null);

  const query = (page = 1) => {
    const params = new URLSearchParams({
      page: String(page),
      limit: "40",
      sort,
    });
    if (channel !== "All") params.set("channel", channel);
    if (status !== "All" && ["timeline", "trash"].includes(view))
      params.set("status", status);
    if (search.trim()) params.set("search", search.trim());
    return params.toString();
  };
  const loadView = async ({
    page = 1,
    append = false,
    silent = false,
  } = {}) => {
    try {
      if (view === "analytics") {
        setRecords([]);
        setMeta({ page: 1, hasMore: false, counts: meta.counts || {} });
        setLoading(false);
        return;
      }
      if (silent) setRefreshing(true);
      else if (!append) setLoading(true);
      const endpoint = ["timeline", "trash"].includes(view)
        ? `/communications/case/${caseItem.id}?${view === "trash" ? "trash=true&" : ""}${query(page)}`
        : view === "inbox"
          ? `/communications/inbox?scope=${inboxScope}&${query(page)}`
          : `/communications/unmatched?${query(page)}`;
      const response = await api.get(endpoint);
      setRecords((current) =>
        append
          ? [...current, ...(response.data.data || [])]
          : response.data.data || [],
      );
      setMeta(response.data.meta || {});
      setError("");
    } catch (requestError) {
      setError(
        requestError.response?.data?.message ||
          "Communication could not be loaded.",
      );
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };
  const loadFoundation = async () => {
    try {
      const [
        providerResponse,
        templateResponse,
        consentResponse,
        userResponse,
      ] = await Promise.all([
        api.get("/communications/providers"),
        api.get("/communications/templates"),
        api.get(`/communications/case/${caseItem.id}/consents`),
        api.get("/users?limit=100"),
      ]);
      setProviders(providerResponse.data.data || {});
      setPermissions(providerResponse.data.meta?.permissions || {});
      setTemplates(templateResponse.data.data || []);
      setConsents(consentResponse.data.data || []);
      setTeam(userResponse.data.data || []);
    } catch (requestError) {
      setError(
        requestError.response?.data?.message ||
          "Communication settings could not be loaded.",
      );
    }
  };
  realtimeRefresh.current = () => loadView({ silent: true });
  useEffect(() => {
    loadFoundation();
  }, [caseItem.id]);
  useEffect(() => {
    const requestedChannel = searchParams.get("compose");
    if (!Object.prototype.hasOwnProperty.call(channelConfig, requestedChannel)) return;
    setCompose({ channel: requestedChannel });
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      next.delete("compose");
      return next;
    }, { replace: true });
  }, [searchParams, setSearchParams]);
  useEffect(() => {
    if (searchParams.get("chat") !== "1") return;
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      next.delete("chat");
      return next;
    }, { replace: true });
    api
      .get(`/communications/case/${caseItem.id}?channel=Chat&limit=1&page=1`)
      .then((response) => {
        const latestChatConversationId = response.data.data?.[0]?.conversationId;
        if (latestChatConversationId) setConversationId(latestChatConversationId);
        else setCompose({ channel: "Chat" });
      })
      .catch(() => setCompose({ channel: "Chat" }));
  }, [searchParams, setSearchParams, caseItem.id]);
  useEffect(() => {
    clearTimeout(debounce.current);
    debounce.current = setTimeout(() => loadView(), search ? 350 : 0);
    return () => clearTimeout(debounce.current);
  }, [view, channel, status, sort, search, inboxScope, caseItem.id]);
  useEffect(() => {
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") loadView({ silent: true });
    }, 20000);
    return () => clearInterval(timer);
  }, [view, channel, status, search, inboxScope, caseItem.id]);
  useEffect(() => setSelected([]), [view, channel, status]);
  useEffect(() => {
    if (!["timeline", "trash"].includes(view) && sort === "status")
      setSort("newest");
    if (["timeline", "trash"].includes(view) && sort === "priority")
      setSort("newest");
  }, [view, sort]);
  useEffect(() => {
    let client;
    let liveChannel;
    let active = true;
    api
      .get(`/communications/realtime/case/${caseItem.id}`)
      .then(async (response) => {
        const config = response.data.data;
        if (!active || !config?.configured) return;
        const { createClient } = await import("@supabase/supabase-js");
        if (!active) return;
        client = createClient(config.url, config.anonKey, {
          auth: { persistSession: false, autoRefreshToken: false },
        });
        client.realtime.setAuth(config.token);
        liveChannel = client
          .channel(config.topic, { config: { private: true } })
          .on("broadcast", { event: "message" }, () =>
            realtimeRefresh.current?.(),
          )
          .subscribe();
      })
      .catch(() => {});
    return () => {
      active = false;
      if (client && liveChannel) void client.removeChannel(liveChannel);
    };
  }, [caseItem.id]);

  const selectedCount = selected.length;
  const allVisibleSelected =
    records.length > 0 && records.every((item) => selected.includes(item.id));
  const toggleAll = () =>
    setSelected(allVisibleSelected ? [] : records.map((item) => item.id));
  const refresh = async () => {
    await Promise.all([loadView({ silent: true }), loadFoundation()]);
  };
  const afterSaved = async () => {
    await refresh();
  };
  const remove = async () => {
    try {
      setBusy(true);
      await api.post("/communications/bulk-delete", {
        caseId: caseItem.id,
        ids: selected,
      });
      setTrashOpen(false);
      setSelected([]);
      await loadView();
    } catch (requestError) {
      setError(
        requestError.response?.data?.message ||
          "Records could not be moved to Trash.",
      );
    } finally {
      setBusy(false);
    }
  };
  const bulkInboxAction = async (action) => {
    if (!action) return;
    try {
      setBusy(true);
      setError("");
      const [operation, assignedToId] = action.split(":");
      await api.post("/communications/conversations/bulk", {
        ids: selected,
        action: operation,
        ...(assignedToId ? { assignedToId } : {}),
      });
      setSelected([]);
      await loadView();
    } catch (requestError) {
      setError(
        requestError.response?.data?.message ||
          "The selected conversations could not be updated.",
      );
    } finally {
      setBusy(false);
    }
  };
  const exportRecords = async () => {
    try {
      setBusy(true);
      const response = await api.post(
        "/communications/export",
        { caseId: caseItem.id, ids: selected },
        { responseType: "blob" },
      );
      const url = URL.createObjectURL(response.data);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `communication-${caseItem.client?.fullName || "case"}.csv`;
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (requestError) {
      setError(
        requestError.response?.data?.message ||
          "Communication could not be exported.",
      );
    } finally {
      setBusy(false);
    }
  };
  const importRecords = async (rows) => {
    try {
      setBusy(true);
      const response = await api.post("/communications/import", {
        caseId: caseItem.id,
        records: rows,
      });
      setImportOpen(false);
      await loadView();
      return response.data.data;
    } catch (requestError) {
      setError(
        requestError.response?.data?.message ||
          "Records could not be imported.",
      );
      throw requestError;
    } finally {
      setBusy(false);
    }
  };
  const assignUnmatched = async (item) => {
    try {
      setBusy(true);
      const response = await api.post(
        `/communications/unmatched/${item.id}/assign`,
        {
          caseId: caseItem.id,
        },
      );
      const assignedConversationId = response.data.data?.conversationId;
      setRecords((current) =>
        current.filter((record) => record.id !== item.id),
      );
      setView("inbox");
      if (assignedConversationId) setConversationId(assignedConversationId);
    } catch (requestError) {
      setError(
        requestError.response?.data?.message ||
          "Communication could not be assigned.",
      );
    } finally {
      setBusy(false);
    }
  };
  const createTemplate = async (values) => {
    try {
      setBusy(true);
      const response = await api.post("/communications/templates", values);
      setTemplates((current) =>
        [...current, response.data.data].sort((a, b) =>
          a.name.localeCompare(b.name),
        ),
      );
      return true;
    } catch (requestError) {
      setError(
        requestError.response?.data?.message ||
          "Template could not be created.",
      );
      return false;
    } finally {
      setBusy(false);
    }
  };
  const deleteTemplate = async (template) => {
    try {
      setBusy(true);
      await api.delete(`/communications/templates/${template.id}`);
      setTemplates((current) =>
        current.filter((item) => item.id !== template.id),
      );
    } catch (requestError) {
      setError(
        requestError.response?.data?.message ||
          "Template could not be removed.",
      );
    } finally {
      setBusy(false);
    }
  };
  const updateTemplate = async (id, values) => {
    try {
      setBusy(true);
      const response = await api.patch(
        `/communications/templates/${id}`,
        values,
      );
      setTemplates((current) =>
        current
          .map((item) => (item.id === id ? response.data.data : item))
          .sort((a, b) => a.name.localeCompare(b.name)),
      );
      return true;
    } catch (requestError) {
      setError(
        requestError.response?.data?.message ||
          "Template could not be updated.",
      );
      return false;
    } finally {
      setBusy(false);
    }
  };
  const saveConsent = async (values) => {
    try {
      setBusy(true);
      const response = await api.post("/communications/consents", values);
      setConsents((current) => [
        ...current.filter(
          (item) =>
            item.id !== response.data.data.id &&
            !(
              item.channel === response.data.data.channel &&
              item.address === response.data.data.address
            ),
        ),
        response.data.data,
      ]);
    } catch (requestError) {
      setError(
        requestError.response?.data?.message || "Consent could not be updated.",
      );
      throw requestError;
    } finally {
      setBusy(false);
    }
  };
  const trashFromConversation = (message) => {
    if (!message) return;
    setSelected([message.id]);
    setConversationId(null);
    setTrashOpen(true);
  };
  const restoreMessage = async (message) => {
    try {
      setBusy(true);
      setError("");
      await api.post(`/communications/messages/${message.id}/restore`);
      await loadView();
    } catch (requestError) {
      setError(
        requestError.response?.data?.message ||
          "The communication record could not be restored.",
      );
    } finally {
      setBusy(false);
    }
  };
  const consentWarning = consents.some((item) => item.status === "OptedOut");

  return (
    <section className="overflow-hidden rounded-[1.65rem] border border-slate-200 bg-white shadow-[0_18px_55px_rgba(15,23,42,0.07)]">
      <header className="border-b border-slate-100 bg-[linear-gradient(135deg,#ffffff,#f8fafc)] px-5 py-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-sky-600">
                Unified communication hub
              </p>
              {refreshing ? (
                <RefreshCw className="h-3 w-3 animate-spin text-sky-500" />
              ) : null}
            </div>
            <h2 className="mt-1 text-lg font-semibold tracking-tight">
              Communication
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              Reliable email, SMS, secure chat, and calls with ownership and
              delivery history.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {consentWarning ? (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700">
                <ShieldCheck className="h-3.5 w-3.5" />
                Opt-out recorded
              </span>
            ) : null}
            <button
              ref={menuButton}
              type="button"
              onClick={() =>
                setMenuAnchor(
                  menuButton.current?.getBoundingClientRect() || null,
                )
              }
              className="flex h-10 w-10 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-600 shadow-sm"
              aria-label="Communication options"
            >
              <MoreHorizontal className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => setCompose({ channel: "Email" })}
              className="inline-flex items-center gap-2 rounded-full bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white"
            >
              <Plus className="h-4 w-4" /> New
            </button>
          </div>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-2 lg:grid-cols-4">
          {Object.entries(channelConfig).map(([key, item]) => {
            const Icon = item.icon;
            const provider = providers[key] || {};
            return (
              <button
                key={key}
                type="button"
                onClick={() => {
                  setView("timeline");
                  setChannel(channel === key ? "All" : key);
                }}
                className={`rounded-2xl border bg-white p-3 text-left shadow-sm transition ${channel === key && view === "timeline" ? "border-slate-900" : "border-white"}`}
              >
                <div className="flex items-center justify-between">
                  <span
                    className={`flex h-9 w-9 items-center justify-center rounded-xl ${item.tone}`}
                  >
                    <Icon className="h-4 w-4" />
                  </span>
                  <span
                    className={`h-2 w-2 rounded-full ${provider.sendConfigured ? "bg-emerald-400" : "bg-amber-400"}`}
                  />
                </div>
                <div className="mt-2 flex items-end justify-between">
                  <div>
                    <p className="text-xs font-semibold">{item.label}</p>
                    <p className="mt-0.5 max-w-[10rem] truncate text-[9px] text-slate-400">
                      {provider.detail || provider.provider || "Not connected"}
                    </p>
                  </div>
                  <p className="text-lg font-semibold">
                    {meta.counts?.[key] || 0}
                  </p>
                </div>
              </button>
            );
          })}
        </div>
      </header>
      <div className="border-b border-slate-100 px-4 py-3">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
          <div className="scrollbar-hidden flex shrink-0 overflow-x-auto rounded-full bg-slate-100 p-1">
            {[
              { id: "timeline", label: "Case timeline", icon: Archive },
              { id: "inbox", label: "Workspace inbox", icon: Inbox },
              { id: "unassigned", label: "Unassigned", icon: UsersRound },
              { id: "analytics", label: "Insights", icon: BarChart3 },
              { id: "trash", label: "Trash", icon: Trash2 },
            ].map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setView(item.id)}
                className={`inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-semibold ${view === item.id ? "bg-white text-slate-950 shadow-sm" : "text-slate-500"}`}
              >
                <item.icon className="h-3.5 w-3.5" />
                {item.label}
              </button>
            ))}
          </div>
          {view !== "analytics" ? (
            <>
              <label className="relative min-w-0 flex-1">
                <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                <input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder={
                    view === "unassigned"
                      ? "Search incoming sender or message"
                      : "Search subject, client, sender, or content"
                  }
                  className="h-9 w-full rounded-xl border border-slate-200 pl-9 pr-3 text-xs outline-none focus:border-sky-300"
                />
              </label>
              <select
                value={sort}
                onChange={(event) => setSort(event.target.value)}
                className="select-field h-9 py-0 text-xs"
                aria-label="Sort communication"
              >
                <option value="newest">Newest</option>
                <option value="oldest">Oldest</option>
                <option value="name">Name</option>
                {["timeline", "trash"].includes(view) ? (
                  <option value="status">Status</option>
                ) : (
                  <option value="priority">Priority</option>
                )}
              </select>
              {view === "inbox" ? (
                <select
                  value={inboxScope}
                  onChange={(event) => setInboxScope(event.target.value)}
                  className="select-field h-9 py-0 text-xs"
                  aria-label="Inbox scope"
                >
                  <option value="all">All active</option>
                  <option value="mine">Assigned to me</option>
                  <option value="unread">Unread</option>
                  <option value="unassigned">Unassigned</option>
                  <option value="archived">Archived</option>
                </select>
              ) : null}
              {["timeline", "trash"].includes(view) ? (
                <>
                  <label className="relative">
                    <Filter className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                    <select
                      value={status}
                      onChange={(event) => setStatus(event.target.value)}
                      className="select-field h-9 py-0 pl-8 text-xs"
                    >
                      {statuses.map((item) => (
                        <option key={item}>{item}</option>
                      ))}
                    </select>
                  </label>
                  {view === "timeline" && selectedCount ? (
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-semibold text-slate-500">
                        {selectedCount} selected
                      </span>
                      {permissions.canExport ? (
                        <button
                          type="button"
                          onClick={exportRecords}
                          className="flex h-8 w-8 items-center justify-center rounded-full border border-slate-200"
                        >
                          <Download className="h-3.5 w-3.5" />
                        </button>
                      ) : null}
                      {permissions.canDelete ? (
                        <button
                          type="button"
                          onClick={() => setTrashOpen(true)}
                          className="flex h-8 w-8 items-center justify-center rounded-full bg-rose-50 text-rose-600"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      ) : null}
                    </div>
                  ) : null}
                </>
              ) : null}
              {view === "inbox" && selectedCount ? (
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold text-slate-500">
                    {selectedCount} selected
                  </span>
                  <select
                    defaultValue=""
                    disabled={busy}
                    onChange={(event) => {
                      void bulkInboxAction(event.target.value);
                      event.target.value = "";
                    }}
                    className="select-field h-9 py-0 text-xs"
                  >
                    <option value="" disabled>
                      Bulk action
                    </option>
                    <option value="read">Mark read</option>
                    <option value="archive">Archive</option>
                    <option value="close">Close</option>
                    <option value="reopen">Reopen</option>
                    <optgroup label="Assign to">
                      {team.map((user) => (
                        <option key={user.id} value={`assign:${user.id}`}>
                          {user.fullName}
                        </option>
                      ))}
                    </optgroup>
                  </select>
                </div>
              ) : null}
            </>
          ) : (
            <span className="ml-auto rounded-full bg-sky-50 px-3 py-2 text-[10px] font-semibold uppercase tracking-[.12em] text-sky-700">
              Last 30 days
            </span>
          )}
        </div>
      </div>
      {error && !compose ? (
        <p className="m-3 flex items-start gap-2 rounded-xl bg-rose-50 px-3 py-2 text-xs text-rose-700">
          <CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          {error}
        </p>
      ) : null}
      {loading ? (
        <div className="space-y-2 p-4">
          {Array.from({ length: 5 }, (_, index) => (
            <div
              key={index}
              className="h-20 animate-pulse rounded-2xl bg-slate-100"
            />
          ))}
        </div>
      ) : view === "analytics" ? (
        <CommunicationAnalyticsPanel caseId={caseItem.id} />
      ) : (
        <div>
          {["timeline", "inbox"].includes(view) ? (
            <div className="flex items-center gap-3 border-b border-slate-100 px-4 py-2.5">
              <button
                type="button"
                onClick={toggleAll}
                className={`flex h-5 w-5 items-center justify-center rounded-md border ${allVisibleSelected ? "border-slate-950 bg-slate-950 text-white" : "border-slate-300"}`}
              >
                {allVisibleSelected ? <Check className="h-3 w-3" /> : null}
              </button>
              <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">
                Select visible {view === "inbox" ? "conversations" : "records"}
              </span>
            </div>
          ) : null}
          <div className="divide-y divide-slate-100">
            {records.map((item) => {
              if (view === "trash") {
                const config =
                  channelConfig[item.channel] || channelConfig.Email;
                const Icon = config.icon;
                return (
                  <article
                    key={item.id}
                    className="flex items-center gap-3 px-4 py-3.5 hover:bg-slate-50/70"
                  >
                    <span
                      className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl ${config.tone}`}
                    >
                      <Icon className="h-4 w-4" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold">
                        {item.subject || config.label}
                      </p>
                      <p className="mt-1 truncate text-xs text-slate-500">
                        {summary(item)}
                      </p>
                      <p className="mt-1.5 text-[10px] text-slate-400">
                        Deleted {formatWhen(item.deletedAt)}
                        {item.deletedBy?.fullName
                          ? ` by ${item.deletedBy.fullName}`
                          : ""}
                      </p>
                    </div>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => restoreMessage(item)}
                      className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700"
                    >
                      <RotateCcw className="h-3.5 w-3.5" />
                      Restore
                    </button>
                  </article>
                );
              }
              if (view === "unassigned")
                return (
                  <article
                    key={item.id}
                    className="flex items-center gap-3 px-4 py-4 hover:bg-slate-50/70"
                  >
                    <span
                      className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl ${channelConfig[item.channel]?.tone || "bg-slate-100"}`}
                    >
                      {channelConfig[item.channel] ? (
                        (() => {
                          const Icon = channelConfig[item.channel].icon;
                          return <Icon className="h-4 w-4" />;
                        })()
                      ) : (
                        <Inbox className="h-4 w-4" />
                      )}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold">
                        {item.subject ||
                          item.senderAddress ||
                          `${item.channel} communication`}
                      </p>
                      <p className="mt-1 truncate text-xs text-slate-500">
                        {item.bodyText || "No message preview"}
                      </p>
                      <p className="mt-1 text-[10px] text-slate-400">
                        {formatWhen(item.occurredAt)} · {item.provider}
                      </p>
                    </div>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => assignUnmatched(item)}
                      className="inline-flex items-center gap-2 rounded-full bg-slate-950 px-3.5 py-2 text-xs font-semibold text-white"
                    >
                      <UserRoundCheck className="h-3.5 w-3.5" /> Assign & open
                    </button>
                  </article>
                );
              if (view === "inbox") {
                const latest = item.messages?.[0];
                const config =
                  channelConfig[item.channel] || channelConfig.Email;
                const Icon = config.icon;
                return (
                  <article
                    key={item.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => setConversationId(item.id)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        setConversationId(item.id);
                      }
                    }}
                    aria-label={`Open ${item.channel.toLowerCase()} conversation with ${item.client?.fullName || "client"}`}
                    title="Open conversation"
                    className="group flex cursor-pointer items-center gap-3 px-4 py-3.5 hover:bg-slate-50/70"
                  >
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        setSelected((current) =>
                          current.includes(item.id)
                            ? current.filter((id) => id !== item.id)
                            : [...current, item.id],
                        );
                      }}
                      className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md border ${selected.includes(item.id) ? "border-slate-950 bg-slate-950 text-white" : "border-slate-300"}`}
                      aria-label={`Select conversation with ${item.client?.fullName || "client"}`}
                    >
                      {selected.includes(item.id) ? (
                        <Check className="h-3 w-3" />
                      ) : null}
                    </button>
                    <span
                      className={`relative flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl ${config.tone}`}
                    >
                      <Icon className="h-4 w-4" />
                      {item.unreadCount ? (
                        <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-sky-600 px-1 text-[8px] font-bold text-white">
                          {item.unreadCount}
                        </span>
                      ) : null}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <p className="truncate text-sm font-semibold">
                          {item.client?.fullName ||
                            item.subject ||
                            config.label}
                        </p>
                        <span
                          className={`rounded-full px-2 py-0.5 text-[9px] font-semibold ${item.state === "WaitingOnAgency" ? "bg-amber-50 text-amber-700" : "bg-slate-100 text-slate-500"}`}
                        >
                          {String(item.state)
                            .replace(/([A-Z])/g, " $1")
                            .trim()}
                        </span>
                      </div>
                      <p className="mt-1 truncate text-xs text-slate-500">
                        {latest
                          ? summary(latest)
                          : item.subject || "No preview"}
                      </p>
                      <p className="mt-1.5 text-[10px] text-slate-400">
                        {formatWhen(item.lastMessageAt)} ·{" "}
                        {item.assignedTo?.fullName || "Unassigned"} ·{" "}
                        {item.case?.caseType}
                      </p>
                    </div>
                    <span className="hidden rounded-full bg-slate-100 px-2.5 py-1 text-[9px] font-semibold text-slate-600 sm:inline">
                      {item.priority}
                    </span>
                    <ChevronRight className="h-4 w-4 text-slate-300" />
                  </article>
                );
              }
              const config = channelConfig[item.channel] || channelConfig.Email;
              const Icon = config.icon;
              const checked = selected.includes(item.id);
              const DirectionIcon =
                item.direction === "Inbound" ? ArrowDownLeft : ArrowUpRight;
              return (
                <article
                  key={item.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => setConversationId(item.conversationId)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter")
                      setConversationId(item.conversationId);
                  }}
                  className="group flex cursor-pointer items-center gap-3 px-4 py-3.5 hover:bg-slate-50/70"
                >
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      setSelected((current) =>
                        checked
                          ? current.filter((id) => id !== item.id)
                          : [...current, item.id],
                      );
                    }}
                    className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md border ${checked ? "border-slate-950 bg-slate-950 text-white" : "border-slate-300"}`}
                  >
                    {checked ? <Check className="h-3 w-3" /> : null}
                  </button>
                  <span
                    className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl ${config.tone}`}
                  >
                    <Icon className="h-4 w-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="truncate text-sm font-semibold">
                        {item.subject || config.label}
                      </p>
                      <span className="inline-flex items-center gap-1 rounded-full bg-slate-50 px-2 py-0.5 text-[9px] font-semibold text-slate-500">
                        <DirectionIcon className="h-2.5 w-2.5" />
                        {item.direction}
                      </span>
                    </div>
                    <p className="mt-1 truncate text-xs text-slate-500">
                      {summary(item)}
                    </p>
                    <p className="mt-1.5 text-[10px] text-slate-400">
                      {formatWhen(item.occurredAt)} ·{" "}
                      {item.senderUser?.fullName ||
                        item.senderAddress ||
                        item.provider ||
                        "Imported"}
                    </p>
                  </div>
                  <span
                    className={`hidden rounded-full px-2.5 py-1 text-[9px] font-semibold sm:inline ${statusTone(item.status)}`}
                  >
                    {item.status}
                  </span>
                  <ChevronRight className="h-4 w-4 text-slate-300" />
                </article>
              );
            })}
            {!records.length ? (
              <div className="px-6 py-16 text-center">
                <Inbox className="mx-auto h-8 w-8 text-slate-300" />
                <h3 className="mt-3 text-sm font-semibold">
                  {view === "unassigned"
                    ? "No unmatched communication"
                    : view === "trash"
                      ? "Trash is empty"
                      : "No communication records"}
                </h3>
                <p className="mt-1 text-sm text-slate-500">
                  {view === "unassigned"
                    ? "Incoming messages that cannot be matched will appear here."
                    : view === "trash"
                      ? "Deleted communication remains recoverable until the retention period ends."
                      : "Start with an email, SMS, chat message, or call."}
                </p>
                {!["unassigned", "trash"].includes(view) ? (
                  <button
                    type="button"
                    onClick={() => setCompose({ channel: "Email" })}
                    className="mt-4 inline-flex h-11 w-11 items-center justify-center rounded-full bg-slate-950 text-white"
                  >
                    <Plus className="h-5 w-5" />
                  </button>
                ) : null}
              </div>
            ) : null}
          </div>
          {meta.hasMore ? (
            <div className="flex justify-center border-t border-slate-100 p-4">
              <button
                type="button"
                disabled={refreshing}
                onClick={() =>
                  loadView({ page: Number(meta.page || 1) + 1, append: true })
                }
                className="inline-flex items-center gap-2 rounded-full border border-slate-200 px-4 py-2 text-xs font-semibold"
              >
                {refreshing ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Plus className="h-3.5 w-3.5" />
                )}{" "}
                Load more
              </button>
            </div>
          ) : null}
        </div>
      )}
      <HeaderActionsMenu
        anchor={menuAnchor}
        onClose={() => setMenuAnchor(null)}
        onConsent={() => setConsentOpen(true)}
        onPreferences={() => setOperationsTab("client")}
        onAutomations={() => setOperationsTab("automations")}
        onChatAccess={() => setChatAccessOpen(true)}
        onTemplates={() => setTemplateOpen(true)}
        onImport={() => setImportOpen(true)}
      />
      <AnimatePresence>
        {compose ? (
          <CommunicationComposer
            initialChannel={compose.channel || "Email"}
            caseItem={compose.caseItem || caseItem}
            providers={providers}
            permissions={permissions}
            templates={templates}
            reply={compose.reply}
            prefill={compose.prefill}
            onClose={() => setCompose(null)}
            onSaved={afterSaved}
          />
        ) : null}
        {conversationId ? (
          <ConversationOverlay
            conversationId={conversationId}
            permissions={permissions}
            onClose={() => setConversationId(null)}
            onReply={(reply) => {
              setConversationId(null);
              setCompose({
                channel: reply.channel,
                reply,
                caseItem: reply.caseItem,
              });
            }}
            onChanged={refresh}
            onTrash={trashFromConversation}
          />
        ) : null}
        {trashOpen ? (
          <TrashOverlay
            count={selected.length}
            busy={busy}
            error={error}
            onClose={() => setTrashOpen(false)}
            onConfirm={remove}
          />
        ) : null}
        {importOpen ? (
          <ImportOverlay
            busy={busy}
            error={error}
            onClose={() => setImportOpen(false)}
            onImport={importRecords}
          />
        ) : null}
        {templateOpen ? (
          <TemplateOverlay
            templates={templates}
            permissions={permissions}
            busy={busy}
            error={error}
            onClose={() => setTemplateOpen(false)}
            onCreate={createTemplate}
            onUpdate={updateTemplate}
            onDelete={deleteTemplate}
          />
        ) : null}
        {consentOpen ? (
          <ConsentOverlay
            caseItem={caseItem}
            consents={consents}
            permissions={permissions}
            busy={busy}
            error={error}
            onClose={() => setConsentOpen(false)}
            onSave={saveConsent}
          />
        ) : null}
        {operationsTab ? (
          <CommunicationOperationsOverlay
            caseItem={caseItem}
            permissions={permissions}
            initialTab={operationsTab}
            onClose={() => setOperationsTab("")}
            onChanged={refresh}
          />
        ) : null}
        {chatAccessOpen ? (
          <ClientChatAccessOverlay
            caseItem={caseItem}
            onClose={() => setChatAccessOpen(false)}
            onEmailLink={(url) => {
              setChatAccessOpen(false);
              setCompose({
                channel: "Email",
                prefill: {
                  subject: `Secure CaseDesk chat — ${caseItem.caseType}`,
                  bodyText: `Hello ${caseItem.client?.fullName || ""},\n\nUse this private link to message our team securely about your case:\n${url}\n\nPlease do not forward this link. It acts like a password and expires automatically.\n\nThank you.`,
                },
              });
            }}
          />
        ) : null}
      </AnimatePresence>
    </section>
  );
}
