import {
  Activity,
  Bot,
  Check,
  Clock3,
  Loader2,
  Plus,
  ShieldCheck,
  Trash2,
  UserRound,
  X,
} from "lucide-react";
import { motion } from "framer-motion";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import api from "../../../services/api";

const inputClass =
  "mt-2 h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none transition focus:border-sky-400 focus:ring-4 focus:ring-sky-100/60 disabled:bg-slate-50";
const tabs = [
  { id: "client", label: "Client", icon: UserRound },
  { id: "automations", label: "Automations", icon: Bot },
  { id: "targets", label: "Targets", icon: Clock3 },
  { id: "audit", label: "Audit", icon: Activity },
];
const triggerLabels = {
  InboundReceived: "New inbound message",
  DeliveryFailed: "Delivery failed",
  MissedCall: "Missed call",
  ConversationOverdue: "Response target missed",
  ResolutionOverdue: "Resolution target missed",
};
const blankRule = {
  name: "",
  trigger: "InboundReceived",
  channel: "",
  containsText: "",
  priority: "High",
  createFollowUp: true,
  followUpTitle: "",
  followUpDueMinutes: 240,
  assignToUserId: "",
};

function Toggle({ checked, disabled, onChange, label }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative h-7 w-12 shrink-0 rounded-full transition disabled:opacity-40 ${checked ? "bg-slate-950" : "bg-slate-300"}`}
      aria-label={label}
    >
      <span
        className={`absolute top-1 h-5 w-5 rounded-full bg-white shadow transition ${checked ? "left-6" : "left-1"}`}
      />
    </button>
  );
}

function ClientPreferences({
  value,
  globalPolicy,
  hasClientOverride,
  disabled,
  busy,
  onChange,
  onSave,
}) {
  const toggleRows = [
    ["allowEmail", "Email"],
    ["allowSms", "SMS"],
    ["allowChat", "Secure chat"],
    ["allowCalls", "Phone calls"],
  ];
  return (
    <form onSubmit={onSave} className="space-y-5">
      <div>
        <h3 className="text-base font-semibold">Contact preferences</h3>
        <p className="mt-1 text-sm leading-6 text-slate-500">
          Respect the client’s preferred channel, language, local time, and
          do-not-contact instructions.
        </p>
        <p className="mt-2 rounded-xl bg-sky-50 px-3 py-2 text-xs leading-5 text-sky-800">
          {hasClientOverride
            ? "This client has individual preferences. Workspace-wide restrictions still take priority."
            : "This client currently inherits the workspace client policy."}
        </p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="text-xs font-semibold text-slate-700">
          Preferred channel
          <select
            value={value.preferredChannel || ""}
            disabled={disabled}
            onChange={(event) =>
              onChange("preferredChannel", event.target.value)
            }
            className="select-field mt-2 h-10 w-full py-0"
          >
            <option value="">No preference</option>
            <option
              disabled={
                globalPolicy?.communicationEnabled === false ||
                globalPolicy?.allowEmail === false
              }
            >
              Email
            </option>
            <option
              value="Sms"
              disabled={
                globalPolicy?.communicationEnabled === false ||
                globalPolicy?.allowSms === false
              }
            >
              SMS
            </option>
            <option
              disabled={
                globalPolicy?.communicationEnabled === false ||
                globalPolicy?.allowChat === false
              }
            >
              Chat
            </option>
            <option
              disabled={
                globalPolicy?.communicationEnabled === false ||
                globalPolicy?.allowCalls === false
              }
            >
              Call
            </option>
          </select>
        </label>
        <label className="text-xs font-semibold text-slate-700">
          Preferred language
          <input
            value={value.language || ""}
            disabled={disabled}
            onChange={(event) => onChange("language", event.target.value)}
            className={inputClass}
            placeholder="English"
          />
        </label>
        <label className="text-xs font-semibold text-slate-700">
          Timezone
          <input
            value={value.timezone || ""}
            disabled={disabled}
            onChange={(event) => onChange("timezone", event.target.value)}
            className={inputClass}
            placeholder="America/Toronto"
          />
        </label>
        <div className="grid grid-cols-2 gap-2">
          <label className="text-xs font-semibold text-slate-700">
            Quiet from
            <input
              type="time"
              value={value.quietHoursStart || ""}
              disabled={disabled}
              onChange={(event) =>
                onChange("quietHoursStart", event.target.value)
              }
              className={inputClass}
            />
          </label>
          <label className="text-xs font-semibold text-slate-700">
            Until
            <input
              type="time"
              value={value.quietHoursEnd || ""}
              disabled={disabled}
              onChange={(event) =>
                onChange("quietHoursEnd", event.target.value)
              }
              className={inputClass}
            />
          </label>
        </div>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        {toggleRows.map(([key, label]) => (
          <label
            key={key}
            className="flex items-center justify-between rounded-2xl bg-slate-50 px-4 py-3"
          >
            <span>
              <span className="block text-sm font-semibold">{label}</span>
              {globalPolicy?.communicationEnabled === false ||
              globalPolicy?.[key] === false ? (
                <span className="mt-0.5 block text-[10px] text-amber-700">
                  Disabled by workspace policy
                </span>
              ) : null}
            </span>
            <Toggle
              checked={
                globalPolicy?.communicationEnabled !== false &&
                globalPolicy?.[key] !== false &&
                value[key] !== false
              }
              disabled={
                disabled ||
                globalPolicy?.communicationEnabled === false ||
                globalPolicy?.[key] === false
              }
              onChange={(next) => onChange(key, next)}
              label={`Allow ${label}`}
            />
          </label>
        ))}
      </div>
      <label
        className={`flex items-start justify-between rounded-2xl border px-4 py-4 ${value.doNotContact ? "border-rose-200 bg-rose-50" : "border-slate-200 bg-white"}`}
      >
        <span className="pr-4">
          <span className="block text-sm font-semibold">Do not contact</span>
          <span className="mt-1 block text-xs leading-5 text-slate-500">
            Blocks all new outbound messages and calls until this is
            deliberately cleared.
          </span>
        </span>
        <Toggle
          checked={value.doNotContact === true}
          disabled={disabled}
          onChange={(next) => onChange("doNotContact", next)}
          label="Do not contact"
        />
      </label>
      <label className="block text-xs font-semibold text-slate-700">
        Internal note
        <textarea
          rows={3}
          value={value.notes || ""}
          disabled={disabled}
          onChange={(event) => onChange("notes", event.target.value)}
          className={`${inputClass} h-auto resize-none py-3`}
          placeholder="Reason for preference, accessibility needs, or best time to reach the client"
        />
      </label>
      <div className="flex justify-end">
        <button
          type="submit"
          disabled={disabled || busy}
          className="inline-flex items-center gap-2 rounded-full bg-slate-950 px-4 py-2.5 text-xs font-semibold text-white disabled:opacity-40"
        >
          {busy ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Check className="h-3.5 w-3.5" />
          )}
          Save preferences
        </button>
      </div>
    </form>
  );
}

function Automations({
  rules,
  users,
  canManage,
  busy,
  onCreate,
  onToggle,
  onDelete,
}) {
  const [rule, setRule] = useState(blankRule);
  const [confirmDelete, setConfirmDelete] = useState("");
  const update = (key, value) =>
    setRule((current) => ({ ...current, [key]: value }));
  const submit = async (event) => {
    event.preventDefault();
    const saved = await onCreate({
      name: rule.name,
      trigger: rule.trigger,
      channel: rule.channel || null,
      conditions: {
        ...(rule.containsText ? { containsText: rule.containsText } : {}),
      },
      actions: {
        priority: rule.priority,
        createFollowUp: rule.createFollowUp,
        followUpTitle: rule.followUpTitle,
        followUpDueMinutes: Number(rule.followUpDueMinutes),
        ...(rule.assignToUserId ? { assignToUserId: rule.assignToUserId } : {}),
      },
    });
    if (saved) setRule(blankRule);
  };
  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-base font-semibold">Inbox automations</h3>
        <p className="mt-1 text-sm leading-6 text-slate-500">
          Route urgent messages and create follow-up work without automatically
          sending legal advice.
        </p>
      </div>
      {canManage ? (
        <form
          onSubmit={submit}
          className="rounded-3xl border border-slate-200 bg-slate-50/70 p-4"
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-xs font-semibold">
              Rule name
              <input
                required
                value={rule.name}
                onChange={(event) => update("name", event.target.value)}
                className={inputClass}
                placeholder="Urgent client message"
              />
            </label>
            <label className="text-xs font-semibold">
              When
              <select
                value={rule.trigger}
                onChange={(event) => update("trigger", event.target.value)}
                className="select-field mt-2 h-10 w-full py-0"
              >
                {Object.entries(triggerLabels).map(([key, label]) => (
                  <option key={key} value={key}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs font-semibold">
              Only this channel
              <select
                value={rule.channel}
                onChange={(event) => update("channel", event.target.value)}
                className="select-field mt-2 h-10 w-full py-0"
              >
                <option value="">Any channel</option>
                <option>Email</option>
                <option value="Sms">SMS</option>
                <option>Chat</option>
                <option>Call</option>
              </select>
            </label>
            <label className="text-xs font-semibold">
              Message contains
              <input
                value={rule.containsText}
                onChange={(event) => update("containsText", event.target.value)}
                className={inputClass}
                placeholder="Optional keyword"
              />
            </label>
            <label className="text-xs font-semibold">
              Set priority
              <select
                value={rule.priority}
                onChange={(event) => update("priority", event.target.value)}
                className="select-field mt-2 h-10 w-full py-0"
              >
                <option>Normal</option>
                <option>High</option>
                <option>Urgent</option>
                <option>Low</option>
              </select>
            </label>
            <label className="text-xs font-semibold">
              Assign to
              <select
                value={rule.assignToUserId}
                onChange={(event) =>
                  update("assignToUserId", event.target.value)
                }
                className="select-field mt-2 h-10 w-full py-0"
              >
                <option value="">Keep case owner</option>
                {users.map((user) => (
                  <option key={user.id} value={user.id}>
                    {user.fullName}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label className="mt-3 flex items-center justify-between rounded-2xl bg-white px-4 py-3">
            <span>
              <span className="block text-sm font-semibold">
                Create follow-up task
              </span>
              <span className="mt-1 block text-xs text-slate-400">
                Keeps the response visible on the dashboard
              </span>
            </span>
            <Toggle
              checked={rule.createFollowUp}
              onChange={(next) => update("createFollowUp", next)}
              label="Create follow-up"
            />
          </label>
          {rule.createFollowUp ? (
            <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_10rem]">
              <label className="text-xs font-semibold">
                Task title
                <input
                  value={rule.followUpTitle}
                  onChange={(event) =>
                    update("followUpTitle", event.target.value)
                  }
                  className={inputClass}
                  placeholder="Reply to client"
                />
              </label>
              <label className="text-xs font-semibold">
                Due in minutes
                <input
                  type="number"
                  min="5"
                  value={rule.followUpDueMinutes}
                  onChange={(event) =>
                    update("followUpDueMinutes", event.target.value)
                  }
                  className={inputClass}
                />
              </label>
            </div>
          ) : null}
          <div className="mt-4 flex justify-end">
            <button
              type="submit"
              disabled={busy}
              className="inline-flex items-center gap-2 rounded-full bg-slate-950 px-4 py-2.5 text-xs font-semibold text-white"
            >
              <Plus className="h-3.5 w-3.5" />
              Add automation
            </button>
          </div>
        </form>
      ) : (
        <p className="rounded-2xl bg-amber-50 px-4 py-3 text-sm text-amber-800">
          A workspace administrator manages automation rules.
        </p>
      )}
      <div className="space-y-2">
        {rules.map((item) => (
          <article
            key={item.id}
            className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3"
          >
            <span
              className={`flex h-9 w-9 items-center justify-center rounded-xl ${item.isActive ? "bg-violet-50 text-violet-700" : "bg-slate-100 text-slate-400"}`}
            >
              <Bot className="h-4 w-4" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold">{item.name}</p>
              <p className="mt-0.5 truncate text-[10px] text-slate-400">
                {triggerLabels[item.trigger] || item.trigger}
                {item.channel
                  ? ` · ${item.channel === "Sms" ? "SMS" : item.channel}`
                  : " · All channels"}
                {item.runCount ? ` · Run ${item.runCount} times` : ""}
              </p>
            </div>
            {canManage ? (
              <>
                <Toggle
                  checked={item.isActive}
                  disabled={busy}
                  onChange={(next) => onToggle(item, next)}
                  label={`Toggle ${item.name}`}
                />
                <button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    confirmDelete === item.id
                      ? onDelete(item)
                      : setConfirmDelete(item.id)
                  }
                  className={`h-8 rounded-full px-2.5 text-[10px] font-semibold ${confirmDelete === item.id ? "bg-rose-600 text-white" : "bg-rose-50 text-rose-600"}`}
                >
                  {confirmDelete === item.id ? (
                    "Delete?"
                  ) : (
                    <Trash2 className="h-3.5 w-3.5" />
                  )}
                </button>
              </>
            ) : null}
          </article>
        ))}
        {!rules.length ? (
          <p className="py-8 text-center text-sm text-slate-400">
            No automation rules yet.
          </p>
        ) : null}
      </div>
    </div>
  );
}

function Targets({ value, canManage, busy, onChange, onSave }) {
  return (
    <form onSubmit={onSave} className="space-y-5">
      <div>
        <h3 className="text-base font-semibold">Response targets</h3>
        <p className="mt-1 text-sm leading-6 text-slate-500">
          CaseDesk flags unanswered client communication and can trigger an
          automation when the target is missed.
        </p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="text-xs font-semibold">
          First response target (minutes)
          <input
            type="number"
            min="5"
            max="10080"
            disabled={!canManage}
            value={value.firstResponseMinutes || 240}
            onChange={(event) =>
              onChange("firstResponseMinutes", event.target.value)
            }
            className={inputClass}
          />
        </label>
        <label className="text-xs font-semibold">
          Resolution target (hours)
          <input
            type="number"
            min="1"
            max="720"
            disabled={!canManage}
            value={value.resolutionHours || 48}
            onChange={(event) =>
              onChange("resolutionHours", event.target.value)
            }
            className={inputClass}
          />
        </label>
      </div>
      <label className="flex items-center justify-between rounded-2xl bg-slate-50 px-4 py-4">
        <span>
          <span className="block text-sm font-semibold">
            Count business hours only
          </span>
          <span className="mt-1 block text-xs text-slate-400">
            Monday to Friday using the schedule below
          </span>
        </span>
        <Toggle
          checked={value.businessHoursOnly === true}
          disabled={!canManage}
          onChange={(next) => onChange("businessHoursOnly", next)}
          label="Business hours only"
        />
      </label>
      {value.businessHoursOnly ? (
        <div className="grid gap-3 rounded-2xl border border-slate-200 p-4 sm:grid-cols-3">
          <label className="text-xs font-semibold">
            Timezone
            <input
              disabled={!canManage}
              value={value.timezone || "America/Toronto"}
              onChange={(event) => onChange("timezone", event.target.value)}
              className={inputClass}
            />
          </label>
          <label className="text-xs font-semibold">
            Workday begins
            <input
              type="time"
              disabled={!canManage}
              value={value.businessHoursStart || "09:00"}
              onChange={(event) =>
                onChange("businessHoursStart", event.target.value)
              }
              className={inputClass}
            />
          </label>
          <label className="text-xs font-semibold">
            Workday ends
            <input
              type="time"
              disabled={!canManage}
              value={value.businessHoursEnd || "17:00"}
              onChange={(event) =>
                onChange("businessHoursEnd", event.target.value)
              }
              className={inputClass}
            />
          </label>
        </div>
      ) : null}
      {!canManage ? (
        <p className="rounded-2xl bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Only a workspace administrator can change response targets.
        </p>
      ) : (
        <div className="flex justify-end">
          <button
            type="submit"
            disabled={busy}
            className="inline-flex items-center gap-2 rounded-full bg-slate-950 px-4 py-2.5 text-xs font-semibold text-white"
          >
            {busy ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Check className="h-3.5 w-3.5" />
            )}
            Save targets
          </button>
        </div>
      )}
    </form>
  );
}

function Audit({ events }) {
  return (
    <div>
      <h3 className="text-base font-semibold">Communication audit</h3>
      <p className="mt-1 text-sm leading-6 text-slate-500">
        A tamper-resistant activity trail of sending, consent, assignments,
        automation, and deletion.
      </p>
      <div className="mt-5 space-y-2">
        {events.map((event) => (
          <article
            key={event.id}
            className="rounded-2xl border border-slate-200 bg-white px-4 py-3"
          >
            <div className="flex items-start justify-between gap-3">
              <p className="text-sm font-semibold">
                {event.details || event.action}
              </p>
              <time className="shrink-0 text-[10px] text-slate-400">
                {new Date(event.createdAt).toLocaleString("en-CA", {
                  month: "short",
                  day: "numeric",
                  hour: "numeric",
                  minute: "2-digit",
                })}
              </time>
            </div>
            <p className="mt-1 text-[10px] text-slate-400">
              {event.user?.fullName || "System"} · {event.action}
            </p>
          </article>
        ))}
        {!events.length ? (
          <p className="py-10 text-center text-sm text-slate-400">
            Audit events will appear here.
          </p>
        ) : null}
      </div>
    </div>
  );
}

export default function CommunicationOperationsOverlay({
  caseItem,
  permissions,
  initialTab = "client",
  onClose,
  onChanged,
}) {
  const [tab, setTab] = useState(initialTab);
  const [preference, setPreference] = useState({});
  const [globalPolicy, setGlobalPolicy] = useState({});
  const [hasClientOverride, setHasClientOverride] = useState(false);
  const [rules, setRules] = useState([]);
  const [sla, setSla] = useState({});
  const [events, setEvents] = useState([]);
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const canManage = permissions?.source === "role";
  const updatePreference = (key, value) =>
    setPreference((current) => ({ ...current, [key]: value }));
  const updateSla = (key, value) =>
    setSla((current) => ({ ...current, [key]: value }));
  const load = async () => {
    try {
      setLoading(true);
      const [
        preferenceResponse,
        rulesResponse,
        slaResponse,
        auditResponse,
        usersResponse,
      ] = await Promise.all([
        api.get(`/communications/case/${caseItem.id}/preferences`),
        api.get("/communications/automations"),
        api.get("/communications/sla"),
        api.get("/communications/audit?limit=50"),
        api.get("/users?limit=100"),
      ]);
      const preferenceData = preferenceResponse.data.data || {};
      setPreference(
        preferenceData.configuredPreference || preferenceData,
      );
      setGlobalPolicy(preferenceData.globalPolicy || {});
      setHasClientOverride(preferenceData.hasClientOverride === true);
      setRules(rulesResponse.data.data || []);
      setSla(slaResponse.data.data || {});
      setEvents(auditResponse.data.data || []);
      setUsers(usersResponse.data.data || []);
    } catch (requestError) {
      setError(
        requestError.response?.data?.message ||
          "Communication controls could not be loaded.",
      );
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    load();
  }, [caseItem.id]);
  const run = async (job, message) => {
    try {
      setBusy(true);
      setError("");
      setNotice("");
      await job();
      setNotice(message);
      onChanged?.();
      return true;
    } catch (requestError) {
      setError(
        requestError.response?.data?.message ||
          "The change could not be saved.",
      );
      return false;
    } finally {
      setBusy(false);
    }
  };
  const savePreference = (event) => {
    event.preventDefault();
    return run(async () => {
      const response = await api.put(
        `/communications/case/${caseItem.id}/preferences`,
        preference,
      );
      const preferenceData = response.data.data || {};
      setPreference(preferenceData.configuredPreference || preferenceData);
      setGlobalPolicy(preferenceData.globalPolicy || {});
      setHasClientOverride(preferenceData.hasClientOverride === true);
    }, "Client communication preferences saved.");
  };
  const createRule = (values) =>
    run(async () => {
      const response = await api.post("/communications/automations", values);
      setRules((current) => [...current, response.data.data]);
    }, "Automation added.");
  const toggleRule = (item, isActive) =>
    run(
      async () => {
        const response = await api.patch(
          `/communications/automations/${item.id}`,
          { ...item, isActive },
        );
        setRules((current) =>
          current.map((rule) =>
            rule.id === item.id ? response.data.data : rule,
          ),
        );
      },
      isActive ? "Automation turned on." : "Automation paused.",
    );
  const deleteRule = (item) =>
    run(async () => {
      await api.delete(`/communications/automations/${item.id}`);
      setRules((current) => current.filter((rule) => rule.id !== item.id));
    }, "Automation deleted.");
  const saveSla = (event) => {
    event.preventDefault();
    return run(async () => {
      const response = await api.patch("/communications/sla", sla);
      setSla(response.data.data);
    }, "Response targets saved.");
  };
  return createPortal(
    <div className="fixed inset-0 z-[470] flex items-center justify-center bg-slate-950/25 p-3 backdrop-blur-md">
      <button
        type="button"
        className="absolute inset-0"
        onClick={onClose}
        aria-label="Close communication controls"
      />
      <motion.section
        initial={{ opacity: 0, y: 16, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        className="relative flex max-h-[94dvh] w-full max-w-4xl flex-col overflow-hidden rounded-[2rem] border border-white/80 bg-white shadow-[0_35px_110px_rgba(15,23,42,.28)]"
      >
        <header className="flex items-start justify-between border-b border-slate-100 px-6 py-5">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[.18em] text-violet-600">
              Communication operations
            </p>
            <h2 className="mt-1 text-xl font-semibold">
              Preferences, automations & controls
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              {caseItem.client?.fullName} · {caseItem.caseType}
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
        <nav className="scrollbar-hidden flex gap-1 overflow-x-auto border-b border-slate-100 px-4 py-2">
          {tabs.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              onClick={() => setTab(id)}
              className={`inline-flex items-center gap-2 rounded-full px-3.5 py-2 text-xs font-semibold ${tab === id ? "bg-slate-950 text-white" : "text-slate-500 hover:bg-slate-100"}`}
            >
              <Icon className="h-3.5 w-3.5" />
              {label}
            </button>
          ))}
        </nav>
        {notice ? (
          <p className="mx-5 mt-4 flex items-center gap-2 rounded-2xl bg-emerald-50 px-4 py-3 text-xs text-emerald-700">
            <ShieldCheck className="h-3.5 w-3.5" />
            {notice}
          </p>
        ) : null}
        {error ? (
          <p className="mx-5 mt-4 rounded-2xl bg-rose-50 px-4 py-3 text-xs text-rose-700">
            {error}
          </p>
        ) : null}
        <main className="scrollbar-hidden min-h-0 flex-1 overflow-y-auto p-5 sm:p-6">
          {loading ? (
            <div className="flex min-h-64 items-center justify-center">
              <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
            </div>
          ) : tab === "client" ? (
            <ClientPreferences
              value={preference}
              globalPolicy={globalPolicy}
              hasClientOverride={hasClientOverride}
              disabled={!permissions?.canManageConsent}
              busy={busy}
              onChange={updatePreference}
              onSave={savePreference}
            />
          ) : tab === "automations" ? (
            <Automations
              rules={rules}
              users={users}
              canManage={canManage}
              busy={busy}
              onCreate={createRule}
              onToggle={toggleRule}
              onDelete={deleteRule}
            />
          ) : tab === "targets" ? (
            <Targets
              value={sla}
              canManage={canManage}
              busy={busy}
              onChange={updateSla}
              onSave={saveSla}
            />
          ) : (
            <Audit events={events} />
          )}
        </main>
      </motion.section>
    </div>,
    document.body,
  );
}
