import { Check, Copy, Loader2, MapPin, Plus, RefreshCw, Trash2, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  createSessionType,
  deleteSessionType,
  getBookingSettings,
  regenerateBookingToken,
  updateBookingSettings,
  updateSessionType,
} from "../../api/bookingApi";
import Select from "../ui/Select";

const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0];
const DAY_LABELS = { 0: "Sunday", 1: "Monday", 2: "Tuesday", 3: "Wednesday", 4: "Thursday", 5: "Friday", 6: "Saturday" };
const BUFFER_OPTIONS = [0, 5, 10, 15, 20, 30, 45, 60];
const NOTICE_OPTIONS = [
  { label: "No minimum", value: 0 },
  { label: "1 hour", value: 60 },
  { label: "2 hours", value: 120 },
  { label: "4 hours", value: 240 },
  { label: "12 hours", value: 720 },
  { label: "24 hours", value: 1440 },
  { label: "48 hours", value: 2880 },
];
const HORIZON_OPTIONS = [7, 14, 30, 60, 90, 180];
const REMINDER_OPTIONS = [
  { label: "1 hour before", value: 60 },
  { label: "4 hours before", value: 240 },
  { label: "24 hours before", value: 1440 },
  { label: "48 hours before", value: 2880 },
];

const card = "rounded-[1.4rem] border border-white/70 bg-white/80 p-5 shadow-[0_14px_40px_rgba(15,23,42,0.07)] backdrop-blur-xl";
const inputClass = "rounded-xl border border-slate-200/80 bg-white px-3 py-2 text-sm outline-none focus:border-sky-400";

function Toggle({ checked, onChange, label }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={`relative h-[26px] w-[44px] shrink-0 rounded-full transition-colors ${checked ? "bg-emerald-500" : "bg-slate-300/90"}`}
    >
      <span className={`absolute top-[2px] h-[22px] w-[22px] rounded-full bg-white shadow transition-all ${checked ? "left-[20px]" : "left-[2px]"}`} />
    </button>
  );
}

export default function SchedulingSettingsPanel() {
  const [settings, setSettings] = useState(null);
  const [sessionTypes, setSessionTypes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const [newDayOff, setNewDayOff] = useState("");
  const [newLocation, setNewLocation] = useState({ name: "", address: "", mapsUrl: "" });
  const [newType, setNewType] = useState({ name: "", durationMinutes: 30 });
  const [addingType, setAddingType] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let active = true;
    getBookingSettings()
      .then((data) => {
        if (!active) return;
        setSettings(data.settings);
        setSessionTypes(data.sessionTypes);
      })
      .catch(() => active && setError("Scheduling settings could not be loaded."))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, []);

  const hoursByDay = useMemo(() => {
    const map = new Map((settings?.workingHours || []).map((rule) => [Number(rule.day), rule]));
    return DAY_ORDER.map((day) => map.get(day) || { day, enabled: false, start: "09:00", end: "17:00" });
  }, [settings]);

  function setHours(day, patch) {
    setSettings((current) => ({
      ...current,
      workingHours: DAY_ORDER.map((key) => {
        const existing = (current.workingHours || []).find((rule) => Number(rule.day) === key) || { day: key, enabled: false, start: "09:00", end: "17:00" };
        return key === day ? { ...existing, ...patch } : existing;
      }),
    }));
  }

  async function save() {
    setSaving(true);
    setError("");
    try {
      const updated = await updateBookingSettings({
        timezone: settings.timezone,
        workingHours: settings.workingHours?.length ? settings.workingHours : hoursByDay,
        daysOff: settings.daysOff || [],
        locations: settings.locations || [],
        bufferMinutes: settings.bufferMinutes,
        minNoticeMinutes: settings.minNoticeMinutes,
        horizonDays: settings.horizonDays,
        reminderMinutes: settings.reminderMinutes,
        publicBookingEnabled: settings.publicBookingEnabled,
      });
      setSettings(updated);
      setSaved(true);
      window.setTimeout(() => setSaved(false), 2200);
    } catch (reason) {
      setError(reason.response?.data?.message || "Settings could not be saved.");
    } finally {
      setSaving(false);
    }
  }

  async function addSessionType() {
    if (!newType.name.trim()) return;
    setAddingType(true);
    try {
      const created = await createSessionType({ name: newType.name.trim(), durationMinutes: Number(newType.durationMinutes) });
      setSessionTypes((current) => [...current, created]);
      setNewType({ name: "", durationMinutes: 30 });
    } catch (reason) {
      setError(reason.response?.data?.message || "Session type could not be added.");
    } finally {
      setAddingType(false);
    }
  }

  async function toggleType(type) {
    const updated = await updateSessionType(type.id, { isActive: !type.isActive }).catch(() => null);
    if (updated) setSessionTypes((current) => current.map((item) => (item.id === type.id ? updated : item)));
  }

  async function removeType(type) {
    const result = await deleteSessionType(type.id).catch(() => null);
    if (!result) return;
    if (result.meta?.deleted) setSessionTypes((current) => current.filter((item) => item.id !== type.id));
    else setSessionTypes((current) => current.map((item) => (item.id === type.id ? result.data : item)));
  }

  async function regenerate() {
    const updated = await regenerateBookingToken().catch(() => null);
    if (updated) setSettings((current) => ({ ...current, publicToken: updated.publicToken }));
  }

  if (loading) {
    return <div className={`${card} flex items-center gap-2 text-sm text-slate-500`}><Loader2 className="h-4 w-4 animate-spin" /> Loading scheduling settings…</div>;
  }
  if (!settings) {
    return <div className={`${card} text-sm text-rose-700`}>{error || "Scheduling settings could not be loaded."}</div>;
  }

  const bookingUrl = `${window.location.origin}/book/${settings.publicToken}`;

  return (
    <div className="space-y-5">
      {error ? <p className="rounded-2xl bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</p> : null}

      <section className={card}>
        <h3 className="text-sm font-semibold text-slate-900">Weekly hours</h3>
        <p className="mt-0.5 text-xs text-slate-500">When appointments can be booked. Times are in {settings.timezone}.</p>
        <div className="mt-4 space-y-2">
          {hoursByDay.map((rule) => (
            <div key={rule.day} className="flex flex-wrap items-center gap-3">
              <Toggle checked={rule.enabled} onChange={(value) => setHours(rule.day, { enabled: value })} label={`${DAY_LABELS[rule.day]} open`} />
              <span className="w-24 text-sm font-medium text-slate-700">{DAY_LABELS[rule.day]}</span>
              {rule.enabled ? (
                <span className="flex items-center gap-2">
                  <input type="time" value={rule.start} onChange={(event) => setHours(rule.day, { start: event.target.value })} className={inputClass} />
                  <span className="text-xs text-slate-400">to</span>
                  <input type="time" value={rule.end} onChange={(event) => setHours(rule.day, { end: event.target.value })} className={inputClass} />
                </span>
              ) : (
                <span className="text-sm text-slate-400">Closed</span>
              )}
            </div>
          ))}
        </div>
      </section>

      <section className={card}>
        <h3 className="text-sm font-semibold text-slate-900">Days off</h3>
        <p className="mt-0.5 text-xs text-slate-500">Holidays and closures — no bookings on these dates.</p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {(settings.daysOff || []).map((day) => (
            <span key={day} className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-700">
              {day}
              <button type="button" aria-label={`Remove ${day}`} onClick={() => setSettings((current) => ({ ...current, daysOff: current.daysOff.filter((item) => item !== day) }))} className="text-slate-400 hover:text-rose-600">
                <X className="h-3.5 w-3.5" />
              </button>
            </span>
          ))}
          <span className="flex items-center gap-2">
            <input type="date" value={newDayOff} onChange={(event) => setNewDayOff(event.target.value)} className={inputClass} />
            <button
              type="button"
              onClick={() => {
                if (!newDayOff) return;
                setSettings((current) => ({ ...current, daysOff: [...new Set([...(current.daysOff || []), newDayOff])].sort() }));
                setNewDayOff("");
              }}
              className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
            >
              <Plus className="h-3.5 w-3.5" /> Add
            </button>
          </span>
        </div>
      </section>

      <section className={card}>
        <h3 className="text-sm font-semibold text-slate-900">Booking rules</h3>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <label className="block text-xs font-medium text-slate-600">Buffer between appointments
            <Select value={settings.bufferMinutes} onChange={(event) => setSettings((c) => ({ ...c, bufferMinutes: Number(event.target.value) }))} className="mt-1.5 w-full">
              {BUFFER_OPTIONS.map((minutes) => <option key={minutes} value={minutes}>{minutes ? `${minutes} minutes` : "No buffer"}</option>)}
            </Select>
          </label>
          <label className="block text-xs font-medium text-slate-600">Minimum notice
            <Select value={settings.minNoticeMinutes} onChange={(event) => setSettings((c) => ({ ...c, minNoticeMinutes: Number(event.target.value) }))} className="mt-1.5 w-full">
              {NOTICE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </Select>
          </label>
          <label className="block text-xs font-medium text-slate-600">How far ahead people can book
            <Select value={settings.horizonDays} onChange={(event) => setSettings((c) => ({ ...c, horizonDays: Number(event.target.value) }))} className="mt-1.5 w-full">
              {HORIZON_OPTIONS.map((days) => <option key={days} value={days}>{days} days</option>)}
            </Select>
          </label>
          <label className="block text-xs font-medium text-slate-600">Reminder
            <Select value={settings.reminderMinutes} onChange={(event) => setSettings((c) => ({ ...c, reminderMinutes: Number(event.target.value) }))} className="mt-1.5 w-full">
              {REMINDER_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </Select>
          </label>
          <label className="block text-xs font-medium text-slate-600 sm:col-span-2">Timezone
            <input value={settings.timezone} onChange={(event) => setSettings((c) => ({ ...c, timezone: event.target.value }))} className={`mt-1.5 w-full ${inputClass}`} list="booking-timezones" />
            <datalist id="booking-timezones">
              {["America/Toronto", "America/Vancouver", "America/Edmonton", "America/Winnipeg", "America/Halifax", "Asia/Kolkata", "Europe/London"].map((zone) => <option key={zone} value={zone} />)}
            </datalist>
          </label>
        </div>
      </section>

      <section className={card}>
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold text-slate-900">Office locations</h3>
          <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700">Required for public booking</span>
        </div>
        <p className="mt-0.5 text-xs text-slate-500">Where clients meet you in person. The address is sent with every in-person confirmation; the Google Maps link is optional.</p>
        <div className="mt-3 space-y-2">
          {(settings.locations || []).map((location) => (
            <div key={location.id} className="flex items-start justify-between gap-3 rounded-2xl border border-slate-200/80 bg-white px-3.5 py-3">
              <div className="flex min-w-0 items-start gap-2.5">
                <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-sky-50 text-sky-600"><MapPin className="h-4 w-4" /></span>
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-slate-900">{location.name}</p>
                  <p className="truncate text-xs text-slate-500">{location.address}</p>
                  {location.mapsUrl ? <a href={location.mapsUrl} target="_blank" rel="noopener noreferrer" className="text-xs font-medium text-sky-600 hover:text-sky-800">Map link ↗</a> : null}
                </div>
              </div>
              <button type="button" aria-label={`Remove ${location.name}`} onClick={() => setSettings((c) => ({ ...c, locations: (c.locations || []).filter((item) => item.id !== location.id) }))} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-slate-400 hover:bg-rose-50 hover:text-rose-600">
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}
          {!(settings.locations || []).length ? <p className="rounded-2xl border border-dashed border-amber-200 bg-amber-50/50 px-3.5 py-3 text-xs text-amber-800">No locations yet — add your office below to activate the public booking link.</p> : null}
        </div>
        <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_1.4fr]">
          <input value={newLocation.name} onChange={(event) => setNewLocation((c) => ({ ...c, name: event.target.value }))} placeholder="Office name (e.g. Main Office)" className={inputClass} />
          <input value={newLocation.address} onChange={(event) => setNewLocation((c) => ({ ...c, address: event.target.value }))} placeholder="Full street address" className={inputClass} />
          <input value={newLocation.mapsUrl} onChange={(event) => setNewLocation((c) => ({ ...c, mapsUrl: event.target.value }))} placeholder="Google Maps link (optional)" className={`${inputClass} sm:col-span-2`} />
        </div>
        <button
          type="button"
          disabled={!newLocation.name.trim() || !newLocation.address.trim()}
          onClick={() => {
            setSettings((c) => ({ ...c, locations: [...(c.locations || []), { id: `loc-${Date.now()}`, name: newLocation.name.trim(), address: newLocation.address.trim(), mapsUrl: newLocation.mapsUrl.trim() || null }] }));
            setNewLocation({ name: "", address: "", mapsUrl: "" });
          }}
          className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-slate-950 px-4 py-2 text-xs font-semibold text-white disabled:opacity-50"
        >
          <Plus className="h-3.5 w-3.5" /> Add location
        </button>
      </section>

      <section className={card}>
        <h3 className="text-sm font-semibold text-slate-900">Session types</h3>
        <p className="mt-0.5 text-xs text-slate-500">What people book — each with its own length.</p>
        <div className="mt-3 divide-y divide-slate-100">
          {sessionTypes.map((type) => (
            <div key={type.id} className="flex items-center justify-between gap-3 py-2.5">
              <div className="min-w-0">
                <p className={`truncate text-sm font-medium ${type.isActive ? "text-slate-800" : "text-slate-400 line-through"}`}>{type.name}</p>
                <p className="text-xs text-slate-400">{type.durationMinutes} minutes</p>
              </div>
              <div className="flex items-center gap-2">
                <Toggle checked={type.isActive} onChange={() => toggleType(type)} label={`${type.name} active`} />
                <button type="button" aria-label={`Delete ${type.name}`} onClick={() => removeType(type)} className="flex h-8 w-8 items-center justify-center rounded-full text-slate-400 hover:bg-rose-50 hover:text-rose-600">
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </div>
          ))}
          {!sessionTypes.length ? <p className="py-3 text-sm text-slate-400">No session types yet — add your first below.</p> : null}
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <input value={newType.name} onChange={(event) => setNewType((c) => ({ ...c, name: event.target.value }))} placeholder="Session name" className={`${inputClass} flex-1 min-w-[180px]`} />
          <Select value={newType.durationMinutes} onChange={(event) => setNewType((c) => ({ ...c, durationMinutes: Number(event.target.value) }))}>
            {[15, 30, 45, 60, 90, 120].map((minutes) => <option key={minutes} value={minutes}>{minutes} min</option>)}
          </Select>
          <button type="button" disabled={addingType || !newType.name.trim()} onClick={addSessionType} className="inline-flex items-center gap-1.5 rounded-full bg-slate-950 px-4 py-2 text-xs font-semibold text-white disabled:opacity-50">
            {addingType ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />} Add
          </button>
        </div>
      </section>

      <section className={card}>
        <div className="flex items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-slate-900">Public booking link</h3>
            <p className="mt-0.5 text-xs text-slate-500">Share this link so clients can book directly with your immigration firm.</p>
          </div>
          <Toggle checked={settings.publicBookingEnabled} onChange={(value) => setSettings((c) => ({ ...c, publicBookingEnabled: value }))} label="Public booking enabled" />
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <code className="min-w-0 flex-1 truncate rounded-xl bg-slate-100 px-3 py-2 text-xs text-slate-600">{bookingUrl}</code>
          <button
            type="button"
            onClick={() => { navigator.clipboard?.writeText(bookingUrl); setCopied(true); window.setTimeout(() => setCopied(false), 1800); }}
            className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
          >
            {copied ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />} {copied ? "Copied" : "Copy"}
          </button>
          <button type="button" onClick={regenerate} className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50">
            <RefreshCw className="h-3.5 w-3.5" /> Regenerate
          </button>
        </div>
      </section>

      <button type="button" onClick={save} disabled={saving} className="flex h-11 w-full items-center justify-center gap-2 rounded-full bg-slate-950 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:opacity-60">
        {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : saved ? <Check className="h-4 w-4 text-emerald-300" /> : null}
        {saving ? "Saving…" : saved ? "Saved" : "Save scheduling settings"}
      </button>
    </div>
  );
}
