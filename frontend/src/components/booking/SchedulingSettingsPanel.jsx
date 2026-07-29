import { CalendarClock, Check, Copy, Eye, Loader2, MapPin, Plus, Send, Trash2, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import {
  createSessionType,
  createSchedulingBlock,
  deleteSessionType,
  deleteSchedulingBlock,
  getBookingSettings,
  getSchedulingBlocks,
  previewBookingEmail,
  sendBookingTestEmail,
  updateBookingSettings,
  updateSessionType,
  updateSchedulingStaff,
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

function SchedulingHeader() {
  return (
    <header className="flex items-start gap-3 pb-1">
      <div className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-sky-50 text-sky-600 ring-1 ring-sky-100">
        <CalendarClock className="h-5 w-5" />
      </div>
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-sky-600">Appointments</p>
        <h1 className="mt-1 text-[28px] font-semibold leading-8 tracking-[-0.03em] text-slate-950">Scheduling</h1>
        <p className="mt-1.5 max-w-2xl text-sm leading-6 text-slate-500">
          Manage your team’s availability, appointment types, booking rules, locations, and client communications.
        </p>
      </div>
    </header>
  );
}

function EmailPreviewModal({ preview, kind, onClose }) {
  useEffect(() => {
    function handleKeyDown(event) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  if (!preview || typeof document === "undefined") return null;

  const kindLabels = {
    booked: "Booking confirmation",
    reminder: "Appointment reminder",
    rescheduled: "Rescheduled appointment",
    cancelled: "Cancellation notice",
  };

  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-0 sm:p-6" role="dialog" aria-modal="true" aria-labelledby="email-preview-title">
      <button type="button" aria-label="Close email preview" onClick={onClose} className="absolute inset-0 bg-slate-950/55 backdrop-blur-sm" />
      <div className="relative flex h-full w-full flex-col overflow-hidden bg-white shadow-2xl sm:h-[min(860px,calc(100vh-3rem))] sm:max-w-4xl sm:rounded-[1.75rem] sm:ring-1 sm:ring-white/30">
        <header className="flex shrink-0 items-center justify-between gap-4 border-b border-slate-200/80 bg-white px-4 py-3.5 sm:px-6 sm:py-4">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-sky-600">{kindLabels[kind] || "Email preview"}</p>
            <h2 id="email-preview-title" className="mt-1 truncate text-base font-semibold text-slate-950 sm:text-lg">{preview.subject}</h2>
          </div>
          <button type="button" onClick={onClose} aria-label="Close email preview" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-500 transition hover:bg-slate-200 hover:text-slate-900">
            <X className="h-5 w-5" />
          </button>
        </header>
        <div className="min-h-0 flex-1 bg-slate-100 p-0 sm:p-4">
          <iframe title={`${kindLabels[kind] || "Booking"} email preview`} sandbox="" srcDoc={preview.html} className="h-full w-full bg-white sm:rounded-2xl sm:ring-1 sm:ring-slate-200" />
        </div>
      </div>
    </div>,
    document.body,
  );
}

function PersonalHoursEditor({ member, preference, workspaceHours, onSave }) {
  const custom = Array.isArray(preference.workingHours);
  const [hours, setHours] = useState(() => custom ? preference.workingHours : workspaceHours);
  const [saving, setSaving] = useState(false);
  const rows = DAY_ORDER.map((day) => hours.find((item) => Number(item.day) === day) || { day, enabled: false, start: "09:00", end: "17:00" });

  function patchDay(day, patch) {
    setHours(rows.map((item) => item.day === day ? { ...item, ...patch } : item));
  }

  async function saveHours(next) {
    setSaving(true);
    await onSave(member, { workingHours: next });
    setSaving(false);
  }

  return <div className="mt-3 border-t border-slate-200/70 pt-3"><div className="flex items-center justify-between gap-3"><div><p className="text-xs font-semibold text-slate-700">Personal weekly hours</p><p className="text-[11px] text-slate-400">Override workspace hours for this consultant.</p></div><button type="button" onClick={() => { if (custom) saveHours(null); else { setHours(workspaceHours); saveHours(workspaceHours); } }} className={`rounded-full px-3 py-1.5 text-[11px] font-semibold ${custom ? "bg-sky-600 text-white" : "bg-slate-200 text-slate-600"}`}>{custom ? "Custom hours" : "Use workspace hours"}</button></div>{custom ? <><div className="mt-3 space-y-2">{rows.map((rule) => <div key={rule.day} className="flex flex-wrap items-center gap-2"><Toggle checked={rule.enabled} onChange={(enabled) => patchDay(rule.day, { enabled })} label={`${member.fullName} ${DAY_LABELS[rule.day]} availability`} /><span className="w-20 text-xs font-medium text-slate-600">{DAY_LABELS[rule.day].slice(0, 3)}</span>{rule.enabled ? <><input type="time" value={rule.start} onChange={(event) => patchDay(rule.day, { start: event.target.value })} className={`${inputClass} !px-2 !py-1.5`} /><span className="text-[11px] text-slate-400">to</span><input type="time" value={rule.end} onChange={(event) => patchDay(rule.day, { end: event.target.value })} className={`${inputClass} !px-2 !py-1.5`} /></> : <span className="text-xs text-slate-400">Unavailable</span>}</div>)}</div><button type="button" disabled={saving} onClick={() => saveHours(rows)} className="mt-3 rounded-full bg-slate-950 px-4 py-2 text-xs font-semibold text-white disabled:opacity-50">{saving ? "Saving…" : "Save personal hours"}</button></> : null}</div>;
}

function LocationHoursEditor({ location, workspaceHours, onChange }) {
  const custom = Boolean(location.useCustomHours);
  const hours = Array.isArray(location.workingHours) && location.workingHours.length ? location.workingHours : workspaceHours;
  const rows = DAY_ORDER.map((day) => hours.find((item) => Number(item.day) === day) || { day, enabled: false, start: "09:00", end: "17:00" });

  function patchDay(day, patch) {
    onChange({ ...location, workingHours: rows.map((item) => (item.day === day ? { ...item, ...patch } : item)) });
  }

  return (
    <div className="mt-3 border-t border-slate-100 pt-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold text-slate-700">Office hours</p>
          <p className="text-[11px] text-slate-400">Override the workspace default for this location.</p>
        </div>
        <button
          type="button"
          onClick={() => onChange(custom ? { ...location, useCustomHours: false } : { ...location, useCustomHours: true, workingHours: Array.isArray(location.workingHours) && location.workingHours.length ? location.workingHours : workspaceHours })}
          className={`rounded-full px-3 py-1.5 text-[11px] font-semibold ${custom ? "bg-sky-600 text-white" : "bg-slate-200 text-slate-600"}`}
        >
          {custom ? "Custom hours" : "Use workspace hours"}
        </button>
      </div>
      {custom ? (
        <div className="mt-3 space-y-2">
          {rows.map((rule) => (
            <div key={rule.day} className="flex flex-wrap items-center gap-2">
              <Toggle checked={rule.enabled} onChange={(enabled) => patchDay(rule.day, { enabled })} label={`${location.name} ${DAY_LABELS[rule.day]} availability`} />
              <span className="w-20 text-xs font-medium text-slate-600">{DAY_LABELS[rule.day].slice(0, 3)}</span>
              {rule.enabled ? (
                <>
                  <input type="time" value={rule.start} onChange={(event) => patchDay(rule.day, { start: event.target.value })} className={`${inputClass} !px-2 !py-1.5`} />
                  <span className="text-[11px] text-slate-400">to</span>
                  <input type="time" value={rule.end} onChange={(event) => patchDay(rule.day, { end: event.target.value })} className={`${inputClass} !px-2 !py-1.5`} />
                </>
              ) : <span className="text-xs text-slate-400">Unavailable</span>}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export default function SchedulingSettingsPanel() {
  const [settings, setSettings] = useState(null);
  const [sessionTypes, setSessionTypes] = useState([]);
  const [staff, setStaff] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const [newDayOff, setNewDayOff] = useState("");
  const [newLocation, setNewLocation] = useState({ name: "", address: "", mapsUrl: "" });
  const [addressSuggestions, setAddressSuggestions] = useState([]);
  const [addressSearching, setAddressSearching] = useState(false);
  const [addressSuggestionsOpen, setAddressSuggestionsOpen] = useState(false);
  const [addressPicked, setAddressPicked] = useState(false);
  const [newType, setNewType] = useState({ name: "", durationMinutes: 30 });
  const [addingType, setAddingType] = useState(false);
  const [copied, setCopied] = useState(false);
  const [blocks, setBlocks] = useState([]);
  const [newBlock, setNewBlock] = useState({ userId: "", title: "Unavailable", startsAt: "", endsAt: "", recurrence: "NONE", recurrenceUntil: "" });
  const [emailPreview, setEmailPreview] = useState(null);
  const [emailPreviewKind, setEmailPreviewKind] = useState("booked");
  const [emailPreviewBusy, setEmailPreviewBusy] = useState(false);
  const [emailTestNotice, setEmailTestNotice] = useState("");

  useEffect(() => {
    let active = true;
    getBookingSettings()
      .then((data) => {
        if (!active) return;
        setSettings(data.settings);
        setSessionTypes(data.sessionTypes);
        setStaff(data.staff || []);
      })
      .catch(() => active && setError("Scheduling settings could not be loaded."))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, []);

  useEffect(() => {
    getSchedulingBlocks().then(setBlocks).catch(() => {});
  }, []);

  // Address-as-you-type search via OpenStreetMap's free Nominatim API — no
  // API key/billing setup needed, and this is low-volume enough (a handful
  // of office addresses, typed occasionally in Settings) to stay well
  // within its usage policy. Debounced so keystrokes don't each fire a
  // request, and skipped right after a suggestion is picked so selecting
  // one doesn't immediately re-open the dropdown for its own text.
  useEffect(() => {
    if (addressPicked) { setAddressPicked(false); return undefined; }
    const query = newLocation.address.trim();
    if (query.length < 4) { setAddressSuggestions([]); setAddressSearching(false); return undefined; }
    let active = true;
    setAddressSearching(true);
    const timer = window.setTimeout(async () => {
      try {
        const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=0&limit=5&q=${encodeURIComponent(query)}`;
        const response = await fetch(url, { headers: { Accept: "application/json" } });
        const results = response.ok ? await response.json() : [];
        if (active) { setAddressSuggestions(results); setAddressSuggestionsOpen(true); }
      } catch {
        if (active) setAddressSuggestions([]);
      } finally {
        if (active) setAddressSearching(false);
      }
    }, 400);
    return () => { active = false; window.clearTimeout(timer); };
  }, [newLocation.address, addressPicked]);

  function pickAddressSuggestion(result) {
    setAddressPicked(true);
    setNewLocation((c) => ({ ...c, address: result.display_name }));
    setAddressSuggestions([]);
    setAddressSuggestionsOpen(false);
  }

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
        reminderSchedule: settings.reminderSchedule?.length ? settings.reminderSchedule : [settings.reminderMinutes],
        waitlistEnabled: settings.waitlistEnabled,
        attendanceConfirmationEnabled: settings.attendanceConfirmationEnabled,
        onlineBookingEnabled: settings.onlineBookingEnabled,
        messageTemplates: settings.messageTemplates || {},
        publicBookingEnabled: settings.publicBookingEnabled,
        freeConsultationsEnabled: settings.freeConsultationsEnabled,
        freeConsultationsPerContact: settings.freeConsultationsPerContact,
        cancellationCutoffMinutes: settings.cancellationCutoffMinutes,
        rescheduleCutoffMinutes: settings.rescheduleCutoffMinutes,
        consultFeeEnabled: settings.consultFeeEnabled,
        consultFeeAmount: settings.consultFeeAmount,
        consultFeeHoldMinutes: settings.consultFeeHoldMinutes,
        consultFeeTerms: settings.consultFeeTerms || "",
        publicHeadline: settings.publicHeadline || "",
        publicWelcomeMessage: settings.publicWelcomeMessage || "",
        publicSignOffName: settings.publicSignOffName || "",
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

  async function toggleTypeMode(type, mode) {
    const current = type.allowedMeetingModes?.length ? type.allowedMeetingModes : ["InPerson", "Online"];
    const next = current.includes(mode) ? current.filter((item) => item !== mode) : [...current, mode];
    if (!next.length) return;
    const updated = await updateSessionType(type.id, { allowedMeetingModes: next }).catch(() => null);
    if (updated) setSessionTypes((items) => items.map((item) => item.id === type.id ? updated : item));
  }

  async function setTypeStaff(type, userId) {
    const current = (type.eligibleStaff || []).map((item) => item.userId);
    const next = userId === null ? [] : current.includes(userId) ? current.filter((id) => id !== userId) : [...current, userId];
    const updated = await updateSessionType(type.id, { eligibleStaffIds: next }).catch(() => null);
    if (updated) setSessionTypes((items) => items.map((item) => item.id === type.id ? updated : item));
  }

  async function setTypeLocation(type, locationId) {
    const current = type.allowedLocationIds || [];
    const next = locationId === null ? [] : current.includes(locationId) ? current.filter((id) => id !== locationId) : [...current, locationId];
    const updated = await updateSessionType(type.id, { allowedLocationIds: next }).catch(() => null);
    if (updated) setSessionTypes((items) => items.map((item) => item.id === type.id ? updated : item));
  }

  async function changeType(type, patch) {
    const updated = await updateSessionType(type.id, patch).catch((reason) => {
      setError(reason.response?.data?.message || "Session details could not be saved.");
      return null;
    });
    if (updated) setSessionTypes((items) => items.map((item) => item.id === type.id ? updated : item));
  }

  async function removeType(type) {
    const result = await deleteSessionType(type.id).catch(() => null);
    if (!result) return;
    if (result.meta?.deleted) setSessionTypes((current) => current.filter((item) => item.id !== type.id));
    else setSessionTypes((current) => current.map((item) => (item.id === type.id ? result.data : item)));
  }

  async function changeStaff(member, patch) {
    const preference = member.schedulingPreference || {
      acceptsAppointments: member.role === "consultant",
      publicBookable: member.role === "consultant",
      maxDailyAppointments: null,
    };
    const updated = await updateSchedulingStaff(member.id, { ...preference, ...patch }).catch((reason) => {
      setError(reason.response?.data?.message || "Team scheduling preference could not be saved.");
      return null;
    });
    if (updated) setStaff((current) => current.map((item) => item.id === member.id ? { ...item, schedulingPreference: updated } : item));
  }

  async function addBlock() {
    if (!newBlock.userId || !newBlock.startsAt || !newBlock.endsAt) return;
    try {
      const created = await createSchedulingBlock({ ...newBlock, recurrenceUntil: newBlock.recurrence === "NONE" ? null : newBlock.recurrenceUntil });
      setBlocks((current) => [...current, created].sort((a, b) => new Date(a.startsAt) - new Date(b.startsAt)));
      setNewBlock((current) => ({ ...current, title: "Unavailable", startsAt: "", endsAt: "", recurrence: "NONE", recurrenceUntil: "" }));
    } catch (reason) {
      setError(reason.response?.data?.message || "Availability block could not be added.");
    }
  }

  async function removeBlock(id) {
    const removed = await deleteSchedulingBlock(id).catch(() => null);
    if (removed) setBlocks((current) => current.filter((item) => item.id !== id));
  }

  async function loadEmailPreview(kind = emailPreviewKind) {
    setEmailPreviewBusy(true); setEmailTestNotice(""); setEmailPreviewKind(kind);
    try { setEmailPreview(await previewBookingEmail(kind, settings.messageTemplates || {})); }
    catch (reason) { setError(reason.response?.data?.message || "Email preview could not be generated."); }
    finally { setEmailPreviewBusy(false); }
  }

  async function sendTestEmail() {
    setEmailPreviewBusy(true); setEmailTestNotice("");
    try { const result = await sendBookingTestEmail(emailPreviewKind, settings.messageTemplates || {}); setEmailTestNotice(`Test sent to ${result.recipient}`); }
    catch (reason) { setError(reason.response?.data?.message || "Test email could not be sent."); }
    finally { setEmailPreviewBusy(false); }
  }


  if (loading) {
    return <div className="space-y-5"><SchedulingHeader /><div className={`${card} flex items-center gap-2 text-sm text-slate-500`}><Loader2 className="h-4 w-4 animate-spin" /> Loading scheduling settings…</div></div>;
  }
  if (!settings) {
    return <div className="space-y-5"><SchedulingHeader /><div className={`${card} text-sm text-rose-700`}>{error || "Scheduling settings could not be loaded."}</div></div>;
  }

  const bookingUrl = `${window.location.origin}/b/${settings.publicSlug || settings.publicToken}`;

  return (
    <div className="space-y-5">
      <SchedulingHeader />
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
        <h3 className="text-sm font-semibold text-slate-900">Scheduling team</h3>
        <p className="mt-0.5 text-xs text-slate-500">Consultants participate by default. Administrators choose whether their calendar joins the assignment pool.</p>
        <div className="mt-3 divide-y divide-slate-100">
          {staff.map((member) => {
            const preference = member.schedulingPreference || { acceptsAppointments: member.role === "consultant", publicBookable: member.role === "consultant", maxDailyAppointments: null };
            return (
              <div key={member.id} className="flex flex-wrap items-center gap-3 py-3">
                <div className="min-w-[150px] flex-1">
                  <p className="text-sm font-medium text-slate-800">{member.fullName}</p>
                  <p className="text-xs capitalize text-slate-400">{member.role}{member.role === "admin" && preference.acceptsAppointments ? " · Participating" : ""}</p>
                </div>
                <label className="flex items-center gap-2 text-xs font-medium text-slate-600"><Toggle checked={preference.acceptsAppointments} onChange={(value) => changeStaff(member, { acceptsAppointments: value, publicBookable: value ? preference.publicBookable : false })} label={`${member.fullName} accepts appointments`} /> Accepts</label>
                <label className="flex items-center gap-2 text-xs font-medium text-slate-600"><Toggle checked={preference.publicBookable} onChange={(value) => changeStaff(member, { publicBookable: value, acceptsAppointments: value ? true : preference.acceptsAppointments })} label={`${member.fullName} public bookable`} /> Public</label>
                <input type="number" min="1" max="50" value={preference.maxDailyAppointments ?? ""} onChange={(event) => changeStaff(member, { maxDailyAppointments: event.target.value ? Number(event.target.value) : null })} placeholder="Daily max" className={`${inputClass} w-24`} />
                <details className="w-full rounded-xl bg-slate-50 px-3 py-2">
                  <summary className="cursor-pointer text-xs font-semibold text-slate-600">Personal availability overrides</summary>
                  <div className="mt-2 grid gap-2 sm:grid-cols-3">
                    <label className="text-[11px] font-medium text-slate-500">Timezone<input value={preference.timezone || ""} onBlur={(event) => changeStaff(member, { timezone: event.target.value || null })} onChange={(event) => setStaff((items) => items.map((item) => item.id === member.id ? { ...item, schedulingPreference: { ...preference, timezone: event.target.value } } : item))} placeholder={settings.timezone} className={`${inputClass} mt-1 w-full`} /></label>
                    <label className="text-[11px] font-medium text-slate-500">Personal buffer<input type="number" min="0" max="240" value={preference.bufferMinutes ?? ""} onBlur={(event) => changeStaff(member, { bufferMinutes: event.target.value === "" ? null : Number(event.target.value) })} onChange={(event) => setStaff((items) => items.map((item) => item.id === member.id ? { ...item, schedulingPreference: { ...preference, bufferMinutes: event.target.value } } : item))} placeholder={`${settings.bufferMinutes} min (workspace)`} className={`${inputClass} mt-1 w-full`} /></label>
                    <label className="text-[11px] font-medium text-slate-500">Days off (YYYY-MM-DD)<input defaultValue={(preference.daysOff || []).join(", ")} onBlur={(event) => changeStaff(member, { daysOff: event.target.value.split(",").map((item) => item.trim()).filter(Boolean) })} placeholder="2026-08-01, 2026-08-02" className={`${inputClass} mt-1 w-full`} /></label>
                  </div>
                  <PersonalHoursEditor member={member} preference={preference} workspaceHours={hoursByDay} onSave={changeStaff} />
                </details>
              </div>
            );
          })}
        </div>
      </section>

      <section className={card}>
        <div className="flex items-center gap-2"><CalendarClock className="h-4 w-4 text-violet-600" /><h3 className="text-sm font-semibold text-slate-900">Availability blocks</h3></div>
        <p className="mt-0.5 text-xs text-slate-500">Block meetings, lunch, leave, or recurring unavailable time. These periods are removed from public and internal slots.</p>
        <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          <Select value={newBlock.userId} onChange={(event) => setNewBlock((current) => ({ ...current, userId: event.target.value }))}><option value="">Choose team member</option>{staff.map((member) => <option key={member.id} value={member.id}>{member.fullName}</option>)}</Select>
          <input value={newBlock.title} onChange={(event) => setNewBlock((current) => ({ ...current, title: event.target.value }))} placeholder="Unavailable" className={inputClass} />
          <Select value={newBlock.recurrence} onChange={(event) => setNewBlock((current) => ({ ...current, recurrence: event.target.value }))}><option value="NONE">Does not repeat</option><option value="DAILY">Daily</option><option value="WEEKLY">Weekly</option></Select>
          <label className="text-[11px] font-medium text-slate-500">Starts<input type="datetime-local" value={newBlock.startsAt} onChange={(event) => setNewBlock((current) => ({ ...current, startsAt: event.target.value }))} className={`${inputClass} mt-1 w-full`} /></label>
          <label className="text-[11px] font-medium text-slate-500">Ends<input type="datetime-local" value={newBlock.endsAt} onChange={(event) => setNewBlock((current) => ({ ...current, endsAt: event.target.value }))} className={`${inputClass} mt-1 w-full`} /></label>
          {newBlock.recurrence !== "NONE" ? <label className="text-[11px] font-medium text-slate-500">Repeat until<input type="date" value={newBlock.recurrenceUntil} onChange={(event) => setNewBlock((current) => ({ ...current, recurrenceUntil: event.target.value }))} className={`${inputClass} mt-1 w-full`} /></label> : <div />}
        </div>
        <button type="button" disabled={!newBlock.userId || !newBlock.startsAt || !newBlock.endsAt || (newBlock.recurrence !== "NONE" && !newBlock.recurrenceUntil)} onClick={addBlock} className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-slate-950 px-4 py-2 text-xs font-semibold text-white disabled:opacity-40"><Plus className="h-3.5 w-3.5" /> Add block</button>
        {blocks.length ? <div className="mt-4 divide-y divide-slate-100 rounded-2xl border border-slate-100 px-3">{blocks.map((block) => <div key={block.id} className="flex items-center justify-between gap-3 py-2.5"><div className="min-w-0"><p className="truncate text-xs font-semibold text-slate-800">{block.title} · {block.user?.fullName}</p><p className="truncate text-[11px] text-slate-400">{new Intl.DateTimeFormat("en-CA", { dateStyle: "medium", timeStyle: "short" }).format(new Date(block.startsAt))} → {new Intl.DateTimeFormat("en-CA", { timeStyle: "short" }).format(new Date(block.endsAt))}{block.recurrence && block.recurrence !== "NONE" ? ` · ${block.recurrence.toLowerCase()}` : ""}</p></div><button type="button" onClick={() => removeBlock(block.id)} aria-label={`Remove ${block.title}`} className="rounded-full p-2 text-slate-400 hover:bg-rose-50 hover:text-rose-600"><Trash2 className="h-4 w-4" /></button></div>)}</div> : null}
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
          <div className="sm:col-span-2">
            <p className="text-xs font-medium text-slate-600">Reminder sequence</p>
            <div className="mt-1.5 flex flex-wrap gap-2">{REMINDER_OPTIONS.map((option) => { const selected = (settings.reminderSchedule || [settings.reminderMinutes]).includes(option.value); return <button key={option.value} type="button" onClick={() => setSettings((current) => { const values = current.reminderSchedule || [current.reminderMinutes]; const next = selected ? values.filter((item) => item !== option.value) : [...values, option.value]; return next.length ? { ...current, reminderSchedule: next } : current; })} className={`rounded-full px-3 py-1.5 text-xs font-semibold ${selected ? "bg-violet-600 text-white" : "bg-slate-100 text-slate-500"}`}>{option.label}</button>; })}</div>
          </div>
          <label className="block text-xs font-medium text-slate-600 sm:col-span-2">Timezone
            <input value={settings.timezone} onChange={(event) => setSettings((c) => ({ ...c, timezone: event.target.value }))} className={`mt-1.5 w-full ${inputClass}`} list="booking-timezones" />
            <datalist id="booking-timezones">
              {["America/Toronto", "America/Vancouver", "America/Edmonton", "America/Winnipeg", "America/Halifax", "Asia/Kolkata", "Europe/London"].map((zone) => <option key={zone} value={zone} />)}
            </datalist>
          </label>
          <label className="block text-xs font-medium text-slate-600">Cancellation cutoff
            <input type="number" min="0" value={settings.cancellationCutoffMinutes} onChange={(event) => setSettings((c) => ({ ...c, cancellationCutoffMinutes: Number(event.target.value) }))} className={`mt-1.5 w-full ${inputClass}`} />
          </label>
          <label className="block text-xs font-medium text-slate-600">Reschedule cutoff
            <input type="number" min="0" value={settings.rescheduleCutoffMinutes} onChange={(event) => setSettings((c) => ({ ...c, rescheduleCutoffMinutes: Number(event.target.value) }))} className={`mt-1.5 w-full ${inputClass}`} />
          </label>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-3 rounded-2xl border border-slate-100 bg-slate-50/70 p-3.5">
          <Toggle checked={settings.freeConsultationsEnabled} onChange={(value) => setSettings((c) => ({ ...c, freeConsultationsEnabled: value }))} label="Free consultations enabled" />
          <div className="min-w-[160px] flex-1"><p className="text-sm font-medium text-slate-800">Free consultations</p><p className="text-xs text-slate-400">Limit repeat bookings by email or client.</p></div>
          <label className="text-xs font-medium text-slate-600">Per contact <input type="number" min="1" max="20" disabled={!settings.freeConsultationsEnabled} value={settings.freeConsultationsPerContact} onChange={(event) => setSettings((c) => ({ ...c, freeConsultationsPerContact: Number(event.target.value) }))} className={`${inputClass} ml-2 w-20`} /></label>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-3 rounded-2xl border border-slate-100 bg-slate-50/70 p-3.5">
          <Toggle checked={settings.consultFeeEnabled} onChange={(value) => setSettings((c) => ({ ...c, consultFeeEnabled: value }))} label="Paid consultation bookings enabled" />
          <div className="min-w-[160px] flex-1"><p className="text-sm font-medium text-slate-800">Paid bookings</p><p className="text-xs text-slate-400">Client pays by card on QuickBooks before the slot is confirmed.</p></div>
          <label className="text-xs font-medium text-slate-600">Fee (CAD) <input type="number" min="0.01" step="0.01" max="10000" disabled={!settings.consultFeeEnabled} value={settings.consultFeeAmount ?? ""} onChange={(event) => setSettings((c) => ({ ...c, consultFeeAmount: event.target.value === "" ? null : Number(event.target.value) }))} className={`${inputClass} ml-2 w-24`} /></label>
          <label className="text-xs font-medium text-slate-600">Hold window (min) <input type="number" min="5" max="120" disabled={!settings.consultFeeEnabled} value={settings.consultFeeHoldMinutes} onChange={(event) => setSettings((c) => ({ ...c, consultFeeHoldMinutes: Number(event.target.value) }))} className={`${inputClass} ml-2 w-20`} /></label>
          <label className="block w-full text-xs font-medium text-slate-600">Payment terms shown to clients
            <textarea
              value={settings.consultFeeTerms || ""}
              maxLength={2000}
              disabled={!settings.consultFeeEnabled}
              onChange={(event) => setSettings((c) => ({ ...c, consultFeeTerms: event.target.value }))}
              placeholder="e.g. Fully refundable if cancelled more than 24 hours before your appointment."
              rows={2}
              className={`${inputClass} mt-1.5 w-full font-normal`}
            />
          </label>
        </div>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          <label className="flex items-center gap-3 rounded-2xl border border-slate-100 bg-slate-50/70 p-3.5"><Toggle checked={settings.waitlistEnabled !== false} onChange={(value) => setSettings((current) => ({ ...current, waitlistEnabled: value }))} label="Waitlist enabled" /><span><span className="block text-sm font-medium text-slate-800">Waitlist</span><span className="block text-xs text-slate-400">Offer an option when slots are full.</span></span></label>
          <label className="flex items-center gap-3 rounded-2xl border border-slate-100 bg-slate-50/70 p-3.5"><Toggle checked={settings.attendanceConfirmationEnabled !== false} onChange={(value) => setSettings((current) => ({ ...current, attendanceConfirmationEnabled: value }))} label="Attendance confirmation enabled" /><span><span className="block text-sm font-medium text-slate-800">Attendance confirmation</span><span className="block text-xs text-slate-400">Let clients confirm before arrival.</span></span></label>
          <label className="flex items-center gap-3 rounded-2xl border border-slate-100 bg-slate-50/70 p-3.5"><Toggle checked={settings.onlineBookingEnabled !== false} onChange={(value) => setSettings((current) => ({ ...current, onlineBookingEnabled: value }))} label="Online video call booking enabled" /><span><span className="block text-sm font-medium text-slate-800">Online video call bookings</span><span className="block text-xs text-slate-400">Turn off to hide the video call option from the public page entirely.</span></span></label>
        </div>
        <details className="mt-3 rounded-2xl border border-slate-100 bg-slate-50/70 p-3.5">
          <summary className="cursor-pointer text-sm font-medium text-slate-800">Email wording</summary>
          <p className="mt-1 text-xs text-slate-400">Customize the headline and opening sentence while keeping the polished appointment details and actions.</p>
          <div className="mt-3 flex flex-wrap items-center gap-2"><Select value={emailPreviewKind} onChange={(event) => setEmailPreviewKind(event.target.value)}><option value="booked">Booking confirmation</option><option value="reminder">Reminder</option><option value="rescheduled">Rescheduled</option><option value="cancelled">Cancellation</option></Select><button type="button" disabled={emailPreviewBusy} onClick={() => loadEmailPreview()} className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 disabled:opacity-50">{emailPreviewBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Eye className="h-3.5 w-3.5" />} Preview</button><button type="button" disabled={emailPreviewBusy} onClick={sendTestEmail} className="inline-flex items-center gap-1.5 rounded-full bg-slate-950 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50">{emailPreviewBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />} Send test</button>{emailTestNotice ? <span className="text-xs font-semibold text-emerald-600">{emailTestNotice}</span> : null}</div>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">{[["booked", "Booking confirmation"], ["reminder", "Reminder"], ["rescheduled", "Rescheduled"], ["cancelled", "Cancellation"]].map(([kind, label]) => <div key={kind} className="rounded-xl bg-white p-3"><p className="text-xs font-semibold text-slate-700">{label}</p><input value={settings.messageTemplates?.[kind]?.subject || ""} onChange={(event) => setSettings((current) => ({ ...current, messageTemplates: { ...(current.messageTemplates || {}), [kind]: { ...(current.messageTemplates?.[kind] || {}), subject: event.target.value } } }))} placeholder="Use default headline" className={`${inputClass} mt-2 w-full`} /><textarea value={settings.messageTemplates?.[kind]?.intro || ""} onChange={(event) => setSettings((current) => ({ ...current, messageTemplates: { ...(current.messageTemplates || {}), [kind]: { ...(current.messageTemplates?.[kind] || {}), intro: event.target.value } } }))} rows="2" placeholder="Use default opening message" className={`${inputClass} mt-2 w-full`} /></div>)}</div>
        </details>
      </section>

      <EmailPreviewModal preview={emailPreview} kind={emailPreviewKind} onClose={() => setEmailPreview(null)} />

      <section className={card}>
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold text-slate-900">Office locations</h3>
          <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700">Required for public booking</span>
        </div>
        <p className="mt-0.5 text-xs text-slate-500">Where clients meet you in person. The address is sent with every in-person confirmation; the Google Maps link is optional.</p>
        <div className="mt-3 space-y-2">
          {(settings.locations || []).map((location) => (
            <div key={location.id} className="rounded-2xl border border-slate-200/80 bg-white px-3.5 py-3">
              <div className="flex items-start justify-between gap-3">
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
              <LocationHoursEditor
                location={location}
                workspaceHours={hoursByDay}
                onChange={(nextLocation) => setSettings((c) => ({ ...c, locations: (c.locations || []).map((item) => (item.id === location.id ? nextLocation : item)) }))}
              />
            </div>
          ))}
          {!(settings.locations || []).length ? <p className="rounded-2xl border border-dashed border-amber-200 bg-amber-50/50 px-3.5 py-3 text-xs text-amber-800">No locations yet — add your office below to activate the public booking link.</p> : null}
        </div>
        <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_1.4fr]">
          <input value={newLocation.name} onChange={(event) => setNewLocation((c) => ({ ...c, name: event.target.value }))} placeholder="Office name (e.g. Main Office)" className={inputClass} />
          <div className="relative">
            <input
              value={newLocation.address}
              onChange={(event) => setNewLocation((c) => ({ ...c, address: event.target.value }))}
              onFocus={() => { if (addressSuggestions.length) setAddressSuggestionsOpen(true); }}
              onBlur={() => setAddressSuggestionsOpen(false)}
              placeholder="Full street address"
              autoComplete="off"
              className={`${inputClass} w-full`}
            />
            {addressSearching ? <Loader2 className="pointer-events-none absolute right-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 animate-spin text-slate-400" /> : null}
            {addressSuggestionsOpen && addressSuggestions.length ? (
              <ul className="absolute inset-x-0 top-full z-20 mt-1 max-h-56 overflow-y-auto rounded-xl border border-slate-200 bg-white py-1 text-sm shadow-lg">
                {addressSuggestions.map((result) => (
                  <li key={result.place_id}>
                    <button
                      type="button"
                      onMouseDown={(event) => { event.preventDefault(); pickAddressSuggestion(result); }}
                      className="block w-full truncate px-3 py-2 text-left text-slate-700 hover:bg-sky-50 hover:text-sky-800"
                    >
                      {result.display_name}
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
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
                <div className="mt-1.5 flex gap-1.5">
                  {[['InPerson', 'In person'], ['Online', 'Online']].map(([mode, label]) => <button key={mode} type="button" onClick={() => toggleTypeMode(type, mode)} className={`rounded-full px-2 py-0.5 text-[10px] font-semibold transition ${(type.allowedMeetingModes || ['InPerson', 'Online']).includes(mode) ? "bg-sky-50 text-sky-700" : "bg-slate-100 text-slate-400"}`}>{label}</button>)}
                </div>
                <details className="mt-2">
                  <summary className="cursor-pointer text-[11px] font-medium text-slate-500">Eligible team · {type.eligibleStaff?.length ? type.eligibleStaff.length : "all"}</summary>
                  <div className="mt-2 flex max-w-md flex-wrap gap-1.5">
                    <button type="button" onClick={() => setTypeStaff(type, null)} className={`rounded-full px-2 py-1 text-[10px] font-semibold ${!type.eligibleStaff?.length ? "bg-slate-950 text-white" : "bg-slate-100 text-slate-500"}`}>All participating</button>
                    {staff.map((member) => <button key={member.id} type="button" onClick={() => setTypeStaff(type, member.id)} className={`rounded-full px-2 py-1 text-[10px] font-semibold ${(type.eligibleStaff || []).some((item) => item.userId === member.id) ? "bg-sky-600 text-white" : "bg-slate-100 text-slate-500"}`}>{member.fullName}</button>)}
                  </div>
                </details>
                {(settings.locations || []).length ? <details className="mt-1.5">
                  <summary className="cursor-pointer text-[11px] font-medium text-slate-500">Locations · {type.allowedLocationIds?.length ? type.allowedLocationIds.length : "all"}</summary>
                  <div className="mt-2 flex max-w-md flex-wrap gap-1.5">
                    <button type="button" onClick={() => setTypeLocation(type, null)} className={`rounded-full px-2 py-1 text-[10px] font-semibold ${!type.allowedLocationIds?.length ? "bg-slate-950 text-white" : "bg-slate-100 text-slate-500"}`}>All offices</button>
                    {settings.locations.map((location) => <button key={location.id} type="button" onClick={() => setTypeLocation(type, location.id)} className={`rounded-full px-2 py-1 text-[10px] font-semibold ${(type.allowedLocationIds || []).includes(location.id) ? "bg-sky-600 text-white" : "bg-slate-100 text-slate-500"}`}>{location.name}</button>)}
                  </div>
                </details> : null}
                <details className="mt-1.5">
                  <summary className="cursor-pointer text-[11px] font-medium text-slate-500">Preparation & timing</summary>
                  <div className="mt-2 grid max-w-2xl gap-2 sm:grid-cols-2">
                    <label className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Session buffer<input type="number" min="0" max="240" defaultValue={type.bufferMinutes ?? ""} onBlur={(event) => changeType(type, { bufferMinutes: event.target.value === "" ? null : Number(event.target.value) })} placeholder="Use workspace buffer" className={`${inputClass} mt-1 w-full normal-case`} /></label>
                    <label className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Checklist (one per line)<textarea defaultValue={(type.preparationChecklist || []).join("\n")} onBlur={(event) => changeType(type, { preparationChecklist: event.target.value.split("\n").map((item) => item.trim()).filter(Boolean) })} rows="2" className={`${inputClass} mt-1 w-full normal-case`} /></label>
                    <label className="text-[10px] font-semibold uppercase tracking-wide text-slate-400 sm:col-span-2">Preparation instructions<textarea defaultValue={type.preparationInstructions || ""} onBlur={(event) => changeType(type, { preparationInstructions: event.target.value })} rows="2" placeholder="Documents to bring, arrival guidance…" className={`${inputClass} mt-1 w-full normal-case`} /></label>
                    <label className="text-[10px] font-semibold uppercase tracking-wide text-slate-400 sm:col-span-2">Parking / arrival notes<textarea defaultValue={type.parkingInstructions || ""} onBlur={(event) => changeType(type, { parkingInstructions: event.target.value })} rows="2" className={`${inputClass} mt-1 w-full normal-case`} /></label>
                  </div>
                </details>
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
            <h3 className="text-sm font-semibold text-slate-900">Public booking page</h3>
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
        </div>
        <div className="mt-5 grid gap-4 border-t border-slate-100 pt-5">
          <label className="text-xs font-semibold text-slate-600">Headline
            <input
              value={settings.publicHeadline || ""}
              maxLength={140}
              onChange={(event) => setSettings((current) => ({ ...current, publicHeadline: event.target.value }))}
              placeholder="Schedule your consultation"
              className={`${inputClass} mt-1.5 w-full font-normal`}
            />
          </label>
          <label className="text-xs font-semibold text-slate-600">Welcome message
            <textarea
              value={settings.publicWelcomeMessage || ""}
              maxLength={2000}
              rows={4}
              onChange={(event) => setSettings((current) => ({ ...current, publicWelcomeMessage: event.target.value }))}
              placeholder="Welcome clients and help them prepare for their consultation."
              className={`${inputClass} mt-1.5 w-full resize-y font-normal leading-6`}
            />
          </label>
          <label className="text-xs font-semibold text-slate-600">Sign-off
            <input
              value={settings.publicSignOffName || ""}
              maxLength={160}
              onChange={(event) => setSettings((current) => ({ ...current, publicSignOffName: event.target.value }))}
              placeholder="TEAM — Your agency name"
              className={`${inputClass} mt-1.5 w-full font-normal`}
            />
          </label>
        </div>
      </section>

      <button type="button" onClick={save} disabled={saving} className="flex h-11 w-full items-center justify-center gap-2 rounded-full bg-slate-950 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:opacity-60">
        {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : saved ? <Check className="h-4 w-4 text-emerald-300" /> : null}
        {saving ? "Saving…" : saved ? "Saved" : "Save scheduling settings"}
      </button>
    </div>
  );
}
