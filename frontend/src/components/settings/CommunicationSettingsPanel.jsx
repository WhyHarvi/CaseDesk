import {
  Archive,
  Check,
  ChevronRight,
  Clock3,
  Loader2,
  ShieldCheck,
  Trash2,
  UsersRound,
} from "lucide-react";
import { useEffect, useState } from "react";
import api from "../../services/api";

const permissionOptions = [
  ["canView", "View communication", "See assigned client conversations"],
  [
    "canViewAll",
    "View agency inbox",
    "See conversations owned by other team members",
  ],
  ["canSendEmail", "Send email", "Create, schedule, and retry email"],
  ["canSendSms", "Send SMS", "Send texts through the agency number"],
  ["canUseChat", "Use secure chat", "Send and receive portal chat"],
  ["canInitiateCalls", "Start calls", "Use Ooma click-to-call"],
  [
    "canManageConsent",
    "Manage consent",
    "Change opt-in and contact preferences",
  ],
  [
    "canManageTemplates",
    "Manage templates",
    "Create and archive message templates",
  ],
  ["canExport", "Export records", "Download communication history"],
  ["canDelete", "Move to Trash", "Soft-delete communication records"],
];

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

export default function CommunicationSettingsPanel() {
  const [users, setUsers] = useState([]);
  const [selectedId, setSelectedId] = useState("");
  const [retention, setRetention] = useState({
    retentionDays: 2555,
    trashDays: 30,
    allowStaffDelete: false,
  });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const selected = users.find((user) => user.id === selectedId) || users[0];

  useEffect(() => {
    let active = true;
    Promise.all([
      api.get("/communications/permissions/team"),
      api.get("/communications/retention"),
    ])
      .then(([userResponse, retentionResponse]) => {
        if (!active) return;
        const nextUsers = userResponse.data.data || [];
        setUsers(nextUsers);
        setSelectedId(nextUsers[0]?.id || "");
        setRetention(retentionResponse.data.data || retention);
      })
      .catch((requestError) => {
        if (active)
          setError(
            requestError.response?.data?.message ||
              "Communication administration could not be loaded.",
          );
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const changePermission = async (key, value) => {
    if (!selected || selected.role === "admin") return;
    const previous = users;
    setUsers((current) =>
      current.map((user) =>
        user.id === selected.id
          ? { ...user, permissions: { ...user.permissions, [key]: value } }
          : user,
      ),
    );
    try {
      setBusy(true);
      setError("");
      setNotice("");
      const response = await api.patch(
        `/communications/permissions/${selected.id}`,
        { [key]: value },
      );
      setUsers((current) =>
        current.map((user) =>
          user.id === selected.id
            ? {
                ...user,
                permissions: {
                  ...user.permissions,
                  [key]: response.data.data[key],
                },
                permissionSource: "user",
              }
            : user,
        ),
      );
      setNotice(`Access updated for ${selected.fullName}.`);
    } catch (requestError) {
      setUsers(previous);
      setError(
        requestError.response?.data?.message ||
          "Team access could not be updated.",
      );
    } finally {
      setBusy(false);
    }
  };

  const saveRetention = async (event) => {
    event.preventDefault();
    try {
      setBusy(true);
      setError("");
      setNotice("");
      const response = await api.patch("/communications/retention", retention);
      setRetention(response.data.data);
      setNotice("Communication retention settings saved.");
    } catch (requestError) {
      setError(
        requestError.response?.data?.message ||
          "Retention settings could not be saved.",
      );
    } finally {
      setBusy(false);
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
  return (
    <div className="space-y-6">
      <div className="border-b border-slate-200/80 pb-6">
        <p className="text-[13px] font-medium text-slate-500">
          Team operations
        </p>
        <h2 className="mt-1 text-[28px] font-semibold leading-9 tracking-[-.03em] text-slate-950">
          Communication controls
        </h2>
        <p className="mt-2 max-w-2xl text-[15px] leading-6 text-slate-500">
          Control who can contact clients, protect sensitive records, and define
          how long deleted communication remains recoverable.
        </p>
      </div>
      {notice ? (
        <p className="flex items-center gap-2 rounded-3xl bg-emerald-50 px-5 py-4 text-sm text-emerald-800">
          <Check className="h-4 w-4" />
          {notice}
        </p>
      ) : null}
      {error ? (
        <p className="rounded-3xl bg-rose-50 px-5 py-4 text-sm text-rose-800">
          {error}
        </p>
      ) : null}
      <section className="grid overflow-hidden rounded-[1.7rem] border border-slate-200 bg-white shadow-sm lg:grid-cols-[17rem_minmax(0,1fr)]">
        <aside className="border-b border-slate-200 bg-slate-50/70 p-3 lg:border-b-0 lg:border-r">
          <div className="flex items-center gap-2 px-3 pb-3 pt-2 text-[10px] font-semibold uppercase tracking-[.14em] text-slate-400">
            <UsersRound className="h-3.5 w-3.5" />
            Team members
          </div>
          <div className="space-y-1">
            {users.map((user) => (
              <button
                key={user.id}
                type="button"
                onClick={() => setSelectedId(user.id)}
                className={`flex w-full items-center gap-3 rounded-2xl px-3 py-3 text-left ${selected?.id === user.id ? "bg-white shadow-sm" : "hover:bg-white/70"}`}
              >
                <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-slate-950 text-xs font-semibold text-white">
                  {user.fullName
                    .split(/\s+/)
                    .slice(0, 2)
                    .map((part) => part[0])
                    .join("")}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold">
                    {user.fullName}
                  </span>
                  <span className="mt-0.5 block text-[10px] capitalize text-slate-400">
                    {user.role} · {user.permissionSource}
                  </span>
                </span>
                <ChevronRight className="h-3.5 w-3.5 text-slate-300" />
              </button>
            ))}
          </div>
        </aside>
        <div className="p-5">
          {selected ? (
            <>
              <div className="flex items-start justify-between">
                <div>
                  <h3 className="text-base font-semibold">
                    {selected.fullName}
                  </h3>
                  <p className="mt-1 text-sm text-slate-500">
                    {selected.role === "admin"
                      ? "Administrators always retain full communication access."
                      : "Changes apply immediately and are recorded in the audit history."}
                  </p>
                </div>
                {busy ? (
                  <Loader2 className="h-4 w-4 animate-spin text-slate-400" />
                ) : (
                  <ShieldCheck className="h-5 w-5 text-emerald-600" />
                )}
              </div>
              <div className="mt-5 grid gap-2 sm:grid-cols-2">
                {permissionOptions.map(([key, label, help]) => (
                  <label
                    key={key}
                    className="flex items-start justify-between gap-3 rounded-2xl bg-slate-50 px-4 py-3"
                  >
                    <span>
                      <span className="block text-sm font-semibold">
                        {label}
                      </span>
                      <span className="mt-1 block text-[11px] leading-4 text-slate-400">
                        {help}
                      </span>
                    </span>
                    <Toggle
                      checked={selected.permissions?.[key] === true}
                      disabled={busy || selected.role === "admin"}
                      onChange={(value) => changePermission(key, value)}
                      label={`Toggle ${label}`}
                    />
                  </label>
                ))}
              </div>
            </>
          ) : (
            <p className="py-10 text-center text-sm text-slate-400">
              No team members found.
            </p>
          )}
        </div>
      </section>
      <form
        onSubmit={saveRetention}
        className="rounded-[1.7rem] border border-slate-200 bg-white p-5 shadow-sm"
      >
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-amber-50 text-amber-700">
            <Archive className="h-4 w-4" />
          </span>
          <div>
            <h3 className="text-base font-semibold">
              Retention & recoverable Trash
            </h3>
            <p className="mt-1 text-sm leading-6 text-slate-500">
              Legal-hold conversations are never purged. Deleted records remain
              recoverable for the Trash period, then files and database records
              are permanently removed.
            </p>
          </div>
        </div>
        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <label className="text-xs font-semibold">
            Keep communication for days
            <input
              type="number"
              min="30"
              max="36500"
              value={retention.retentionDays || 2555}
              onChange={(event) =>
                setRetention((current) => ({
                  ...current,
                  retentionDays: event.target.value,
                }))
              }
              className="mt-2 h-11 w-full rounded-2xl border border-slate-200 px-3.5 text-sm outline-none focus:border-sky-400"
            />
          </label>
          <label className="text-xs font-semibold">
            Keep deleted records for days
            <input
              type="number"
              min="1"
              max="365"
              value={retention.trashDays || 30}
              onChange={(event) =>
                setRetention((current) => ({
                  ...current,
                  trashDays: event.target.value,
                }))
              }
              className="mt-2 h-11 w-full rounded-2xl border border-slate-200 px-3.5 text-sm outline-none focus:border-sky-400"
            />
          </label>
        </div>
        <label className="mt-4 flex items-center justify-between rounded-2xl bg-slate-50 px-4 py-4">
          <span className="flex items-start gap-3">
            <Trash2 className="mt-0.5 h-4 w-4 text-slate-400" />
            <span>
              <span className="block text-sm font-semibold">
                Allow staff to move records to Trash
              </span>
              <span className="mt-1 block text-xs text-slate-400">
                Individual user permission is still required.
              </span>
            </span>
          </span>
          <Toggle
            checked={retention.allowStaffDelete === true}
            disabled={busy}
            onChange={(value) =>
              setRetention((current) => ({
                ...current,
                allowStaffDelete: value,
              }))
            }
            label="Allow staff delete"
          />
        </label>
        <div className="mt-4 flex justify-end">
          <button
            type="submit"
            disabled={busy}
            className="inline-flex items-center gap-2 rounded-full bg-slate-950 px-5 py-2.5 text-xs font-semibold text-white disabled:opacity-50"
          >
            {busy ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Clock3 className="h-3.5 w-3.5" />
            )}
            Save retention
          </button>
        </div>
      </form>
    </div>
  );
}
