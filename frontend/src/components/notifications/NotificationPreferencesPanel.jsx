import { AnimatePresence, motion } from "framer-motion";
import { Check, Loader2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { getNotificationPreferences, updateNotificationPreference } from "../../api/notificationApi";
import { CATEGORY_META, categoryMeta } from "./notificationMeta";

const CATEGORIES = ["all", "cases", "leads", "documents", "appointments", "communications", "work", "questionnaires", "security"];

const DUE_SOON_OPTIONS = [
  { label: "15 minutes", value: 15 },
  { label: "30 minutes", value: 30 },
  { label: "1 hour", value: 60 },
  { label: "4 hours", value: 240 },
  { label: "24 hours", value: 1440 },
  { label: "3 days", value: 4320 },
  { label: "7 days", value: 10080 },
];

const COMMON_TIMEZONES = [
  "America/Toronto",
  "America/Vancouver",
  "America/Edmonton",
  "America/Winnipeg",
  "America/Halifax",
  "America/St_Johns",
  "America/New_York",
  "America/Los_Angeles",
  "Asia/Kolkata",
  "Europe/London",
  "Australia/Sydney",
];

const DEFAULT_PREFERENCE = {
  inAppEnabled: true,
  emailEnabled: false,
  smsEnabled: false,
  dueSoonMinutes: 1440,
  quietHoursStart: "",
  quietHoursEnd: "",
  timezone: "America/Toronto",
  deliveryMode: "immediate",
  digestHour: 9,
};

function Toggle({ checked, onChange, label }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={`relative h-[26px] w-[44px] shrink-0 rounded-full transition-colors duration-200 ${checked ? "bg-emerald-500" : "bg-slate-300/90"}`}
    >
      <span
        className={`absolute top-[2px] h-[22px] w-[22px] rounded-full bg-white shadow-[0_2px_5px_rgba(0,0,0,0.25)] transition-all duration-200 ${checked ? "left-[20px]" : "left-[2px]"}`}
      />
    </button>
  );
}

export default function NotificationPreferencesPanel({ compact = false, isClient = false }) {
  const [preferences, setPreferences] = useState(null);
  const [category, setCategory] = useState("all");
  const [form, setForm] = useState(DEFAULT_PREFERENCE);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  const stored = useMemo(() => {
    const map = new Map((preferences || []).map((preference) => [preference.category, preference]));
    return map;
  }, [preferences]);

  useEffect(() => {
    let active = true;
    getNotificationPreferences()
      .then((data) => {
        if (!active) return;
        setPreferences(data);
      })
      .catch(() => active && setError("Preferences could not be loaded."))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const base = stored.get(category) || stored.get("all") || DEFAULT_PREFERENCE;
    setForm({
      inAppEnabled: base.inAppEnabled ?? true,
      emailEnabled: base.emailEnabled ?? false,
      smsEnabled: base.smsEnabled ?? false,
      dueSoonMinutes: base.dueSoonMinutes ?? 1440,
      quietHoursStart: base.quietHoursStart || "",
      quietHoursEnd: base.quietHoursEnd || "",
      timezone: base.timezone || "America/Toronto",
      deliveryMode: base.deliveryMode || "immediate",
      digestHour: base.digestHour ?? 9,
    });
    setSaved(false);
    setError("");
  }, [category, stored]);

  async function save() {
    setSaving(true);
    setError("");
    setSaved(false);
    try {
      const payload = {
        inAppEnabled: form.inAppEnabled,
        emailEnabled: form.emailEnabled,
        smsEnabled: form.smsEnabled,
        dueSoonMinutes: Number(form.dueSoonMinutes),
        quietHoursStart: form.quietHoursStart || null,
        quietHoursEnd: form.quietHoursEnd || null,
        timezone: form.timezone,
        deliveryMode: form.deliveryMode,
        digestHour: Number(form.digestHour),
      };
      const updated = await updateNotificationPreference(category, payload);
      setPreferences((current) => {
        const rest = (current || []).filter((preference) => preference.category !== category);
        return [...rest, updated];
      });
      setSaved(true);
      window.setTimeout(() => setSaved(false), 2200);
    } catch (reason) {
      setError(reason.response?.data?.message || "Preferences could not be saved.");
    } finally {
      setSaving(false);
    }
  }

  const set = (key) => (value) => setForm((current) => ({ ...current, [key]: value }));

  if (loading) {
    return (
      <div className="flex items-center gap-2 rounded-2xl border border-white/70 bg-white/70 px-4 py-6 text-sm text-slate-500">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading preferences…
      </div>
    );
  }

  const meta = category === "all" ? null : categoryMeta(category);

  return (
    <div className={compact ? "space-y-4" : "space-y-5"}>
      <div className="flex flex-wrap gap-1.5">
        {CATEGORIES.map((key) => {
          const active = key === category;
          const label = key === "all" ? "All" : CATEGORY_META[key]?.label || key;
          const hasOverride = key !== "all" && stored.has(key);
          return (
            <button
              key={key}
              type="button"
              onClick={() => setCategory(key)}
              className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${
                active
                  ? "bg-slate-950 text-white shadow-[0_8px_18px_rgba(15,23,42,0.25)]"
                  : "border border-white/70 bg-white/70 text-slate-600 hover:bg-white"
              }`}
            >
              {label}
              {hasOverride ? <span className="ml-1 text-[9px] text-sky-500">●</span> : null}
            </button>
          );
        })}
      </div>

      <div className="rounded-[1.4rem] border border-white/70 bg-white/75 p-4 shadow-[0_14px_40px_rgba(15,23,42,0.08)] backdrop-blur-xl">
        <p className="text-sm font-semibold text-slate-900">
          {category === "all" ? "All notifications" : `${meta.label} notifications`}
        </p>
        <p className="mt-0.5 text-xs text-slate-500">
          {category === "all"
            ? "Your default preferences for everything."
            : `Overrides the “All” preference for ${meta.label.toLowerCase()} only.`}
        </p>

        <div className="mt-4 divide-y divide-slate-100/80">
          {[
            ["inAppEnabled", "In-app", "Show in the notification center"],
            ["emailEnabled", "Email", "Send a copy to your email"],
            ["smsEnabled", "SMS", isClient ? "Requires a phone number and messaging consent on file" : "Requires a valid phone number on your profile"],
          ].map(([key, label, hint]) => (
            <div key={key} className="flex items-center justify-between gap-3 py-3">
              <div>
                <p className="text-[13px] font-medium text-slate-800">{label}</p>
                <p className="text-[11.5px] text-slate-400">{hint}</p>
              </div>
              <Toggle checked={form[key]} onChange={set(key)} label={`${label} notifications`} />
            </div>
          ))}
        </div>

        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          {category === "all" ? (
            <>
              <label className="block">
                <span className="text-[12px] font-medium text-slate-600">Routine updates</span>
                <select
                  value={form.deliveryMode}
                  onChange={(event) => set("deliveryMode")(event.target.value)}
                  className="mt-1.5 w-full rounded-xl border border-slate-200/80 bg-white/90 px-3 py-2.5 text-sm outline-none focus:border-sky-400"
                >
                  <option value="immediate">Send immediately</option>
                  <option value="daily_digest">Daily email summary</option>
                </select>
                <span className="mt-1 block text-[11px] leading-4 text-slate-400">Action-required alerts remain immediate.</span>
              </label>
              {form.deliveryMode === "daily_digest" ? (
                <label className="block">
                  <span className="text-[12px] font-medium text-slate-600">Summary time</span>
                  <select
                    value={form.digestHour}
                    onChange={(event) => set("digestHour")(Number(event.target.value))}
                    className="mt-1.5 w-full rounded-xl border border-slate-200/80 bg-white/90 px-3 py-2.5 text-sm outline-none focus:border-sky-400"
                  >
                    {Array.from({ length: 13 }, (_, index) => index + 6).map((hour) => (
                      <option key={hour} value={hour}>{new Date(2000, 0, 1, hour).toLocaleTimeString("en-CA", { hour: "numeric" })}</option>
                    ))}
                  </select>
                  {!form.emailEnabled ? <span className="mt-1 block text-[11px] leading-4 text-amber-600">Turn on Email above to receive the summary.</span> : null}
                </label>
              ) : null}
            </>
          ) : null}
          <label className="block">
            <span className="text-[12px] font-medium text-slate-600">Notify me before due dates</span>
            <select
              value={form.dueSoonMinutes}
              onChange={(event) => set("dueSoonMinutes")(Number(event.target.value))}
              className="mt-1.5 w-full rounded-xl border border-slate-200/80 bg-white/90 px-3 py-2.5 text-sm outline-none focus:border-sky-400"
            >
              {DUE_SOON_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-[12px] font-medium text-slate-600">Timezone</span>
            <input
              list="notification-timezones"
              value={form.timezone}
              onChange={(event) => set("timezone")(event.target.value)}
              className="mt-1.5 w-full rounded-xl border border-slate-200/80 bg-white/90 px-3 py-2.5 text-sm outline-none focus:border-sky-400"
            />
            <datalist id="notification-timezones">
              {COMMON_TIMEZONES.map((zone) => <option key={zone} value={zone} />)}
            </datalist>
          </label>
          <label className="block">
            <span className="text-[12px] font-medium text-slate-600">Quiet hours start</span>
            <input
              type="time"
              value={form.quietHoursStart}
              onChange={(event) => set("quietHoursStart")(event.target.value)}
              className="mt-1.5 w-full rounded-xl border border-slate-200/80 bg-white/90 px-3 py-2.5 text-sm outline-none focus:border-sky-400"
            />
          </label>
          <label className="block">
            <span className="text-[12px] font-medium text-slate-600">Quiet hours end</span>
            <input
              type="time"
              value={form.quietHoursEnd}
              onChange={(event) => set("quietHoursEnd")(event.target.value)}
              className="mt-1.5 w-full rounded-xl border border-slate-200/80 bg-white/90 px-3 py-2.5 text-sm outline-none focus:border-sky-400"
            />
          </label>
        </div>

        <AnimatePresence>
          {error ? (
            <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="mt-3 rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-700">
              {error}
            </motion.p>
          ) : null}
        </AnimatePresence>

        <button
          type="button"
          onClick={save}
          disabled={saving}
          className="mt-4 flex h-11 w-full items-center justify-center gap-2 rounded-full bg-slate-950 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:opacity-60"
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : saved ? <Check className="h-4 w-4 text-emerald-300" /> : null}
          {saving ? "Saving…" : saved ? "Saved" : "Save preferences"}
        </button>
      </div>
    </div>
  );
}
