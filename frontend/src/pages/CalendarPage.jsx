import { AnimatePresence, motion } from "framer-motion";
import { CalendarDays, ChevronLeft, ChevronRight, Loader2, Plus, RefreshCw, Trash2, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useAuth } from "../auth/AuthContext";
import {
  cancelBookingAppointment,
  createBookingAppointment,
  getAvailability,
  getBookingSettings,
  getCalendarAppointments,
} from "../api/bookingApi";
import PageContainer from "../components/layout/PageContainer";
import api from "../services/api";

const DAY_MS = 24 * 60 * 60 * 1000;
const GRID_START_HOUR = 7;
const GRID_END_HOUR = 20;
const HOUR_PX = 56;

const STAFF_COLORS = [
  "bg-sky-500/90 border-sky-600",
  "bg-violet-500/90 border-violet-600",
  "bg-emerald-500/90 border-emerald-600",
  "bg-amber-500/90 border-amber-600",
  "bg-rose-500/90 border-rose-600",
  "bg-indigo-500/90 border-indigo-600",
];

function startOfWeek(date) {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  copy.setDate(copy.getDate() - ((copy.getDay() + 6) % 7)); // Monday
  return copy;
}

function dateKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function formatTime(value) {
  return new Date(value).toLocaleTimeString("en-CA", { hour: "numeric", minute: "2-digit" });
}

function NewAppointmentSheet({ open, onClose, onCreated, staff, sessionTypes, role, userId }) {
  const [clients, setClients] = useState([]);
  const [form, setForm] = useState({ mode: "client", clientId: "", guestName: "", guestEmail: "", guestPhone: "", sessionTypeId: "", assignedToId: "", date: dateKey(new Date()), startsAt: "", subject: "", location: "" });
  const [slots, setSlots] = useState(null);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    setForm((current) => ({ ...current, startsAt: "", assignedToId: role === "consultant" ? userId : current.assignedToId }));
    setError("");
    api.get("/clients?limit=100").then((response) => setClients(response.data.data || [])).catch(() => {});
  }, [open, role, userId]);

  const activeTypes = sessionTypes.filter((type) => type.isActive);
  const selectedType = activeTypes.find((type) => type.id === form.sessionTypeId) || activeTypes[0] || null;

  const loadSlots = useCallback(async () => {
    if (!form.date || !selectedType) return;
    setLoadingSlots(true);
    setSlots(null);
    try {
      const result = await getAvailability({
        from: form.date,
        to: form.date,
        durationMinutes: selectedType.durationMinutes,
        assignedToId: role === "consultant" ? undefined : form.assignedToId || undefined,
      });
      setSlots(result.days[form.date] || []);
    } catch {
      setSlots([]);
    } finally {
      setLoadingSlots(false);
    }
  }, [form.date, form.assignedToId, selectedType, role]);

  useEffect(() => { if (open) loadSlots(); }, [open, loadSlots]);

  async function submit(event) {
    event.preventDefault();
    if (!form.startsAt) { setError("Pick an available time."); return; }
    setSaving(true);
    setError("");
    try {
      const created = await createBookingAppointment({
        startsAt: form.startsAt,
        sessionTypeId: selectedType?.id,
        assignedToId: form.assignedToId || undefined,
        clientId: form.mode === "client" ? form.clientId || undefined : undefined,
        guestName: form.mode === "guest" ? form.guestName : undefined,
        guestEmail: form.mode === "guest" ? form.guestEmail : undefined,
        guestPhone: form.mode === "guest" ? form.guestPhone : undefined,
        subject: form.subject || undefined,
        location: form.location || undefined,
      });
      onCreated(created);
      onClose();
    } catch (reason) {
      setError(reason.response?.data?.message || "The appointment could not be booked.");
      if (reason.response?.data?.code === "SLOT_TAKEN") loadSlots();
    } finally {
      setSaving(false);
    }
  }

  if (typeof document === "undefined") return null;
  const input = "w-full rounded-xl border border-slate-200/80 bg-white px-3 py-2.5 text-sm outline-none focus:border-sky-400";

  return createPortal(
    <AnimatePresence>
      {open ? (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[400] flex justify-end bg-slate-950/25 backdrop-blur-[2px]" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
          <motion.aside initial={{ x: 60, opacity: 0 }} animate={{ x: 0, opacity: 1 }} exit={{ x: 60, opacity: 0 }} transition={{ type: "spring", stiffness: 380, damping: 34 }} className="flex h-full w-full max-w-[440px] flex-col overflow-hidden border-l border-white/70 bg-white/95 shadow-[-30px_0_90px_rgba(15,23,42,0.2)] backdrop-blur-2xl">
            <header className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
              <h2 className="text-lg font-semibold text-slate-950">New appointment</h2>
              <button type="button" onClick={onClose} aria-label="Close" className="flex h-9 w-9 items-center justify-center rounded-full text-slate-500 hover:bg-slate-100"><X className="h-5 w-5" /></button>
            </header>
            <form onSubmit={submit} className="flex-1 space-y-4 overflow-y-auto px-6 py-5">
              <div className="flex rounded-full border border-slate-200 bg-slate-50 p-0.5">
                {[["client", "Existing client"], ["guest", "Walk-in / guest"]].map(([mode, label]) => (
                  <button key={mode} type="button" onClick={() => setForm((c) => ({ ...c, mode }))} className={`flex-1 rounded-full px-3 py-2 text-xs font-semibold transition ${form.mode === mode ? "bg-slate-950 text-white shadow" : "text-slate-500"}`}>{label}</button>
                ))}
              </div>

              {form.mode === "client" ? (
                <label className="block text-xs font-medium text-slate-600">Client
                  <select required value={form.clientId} onChange={(event) => setForm((c) => ({ ...c, clientId: event.target.value }))} className={`mt-1.5 ${input}`}>
                    <option value="">Choose a client…</option>
                    {clients.map((client) => <option key={client.id} value={client.id}>{client.fullName}</option>)}
                  </select>
                </label>
              ) : (
                <div className="space-y-3">
                  <label className="block text-xs font-medium text-slate-600">Visitor name
                    <input required value={form.guestName} onChange={(event) => setForm((c) => ({ ...c, guestName: event.target.value }))} className={`mt-1.5 ${input}`} />
                  </label>
                  <div className="grid grid-cols-2 gap-3">
                    <label className="block text-xs font-medium text-slate-600">Email
                      <input type="email" value={form.guestEmail} onChange={(event) => setForm((c) => ({ ...c, guestEmail: event.target.value }))} className={`mt-1.5 ${input}`} />
                    </label>
                    <label className="block text-xs font-medium text-slate-600">Phone
                      <input value={form.guestPhone} onChange={(event) => setForm((c) => ({ ...c, guestPhone: event.target.value }))} className={`mt-1.5 ${input}`} />
                    </label>
                  </div>
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <label className="block text-xs font-medium text-slate-600">Session type
                  <select value={selectedType?.id || ""} onChange={(event) => setForm((c) => ({ ...c, sessionTypeId: event.target.value, startsAt: "" }))} className={`mt-1.5 ${input}`}>
                    {activeTypes.map((type) => <option key={type.id} value={type.id}>{type.name} · {type.durationMinutes}m</option>)}
                    {!activeTypes.length ? <option value="">No session types — add in Settings</option> : null}
                  </select>
                </label>
                {role !== "consultant" ? (
                  <label className="block text-xs font-medium text-slate-600">Staff
                    <select value={form.assignedToId} onChange={(event) => setForm((c) => ({ ...c, assignedToId: event.target.value, startsAt: "" }))} className={`mt-1.5 ${input}`}>
                      <option value="">Anyone / unassigned</option>
                      {staff.map((member) => <option key={member.id} value={member.id}>{member.fullName}</option>)}
                    </select>
                  </label>
                ) : null}
              </div>

              <label className="block text-xs font-medium text-slate-600">Date
                <input type="date" required value={form.date} onChange={(event) => setForm((c) => ({ ...c, date: event.target.value, startsAt: "" }))} className={`mt-1.5 ${input}`} />
              </label>

              <div>
                <p className="text-xs font-medium text-slate-600">Available times</p>
                {loadingSlots ? (
                  <p className="mt-2 flex items-center gap-2 text-sm text-slate-400"><Loader2 className="h-4 w-4 animate-spin" /> Checking availability…</p>
                ) : slots && slots.length ? (
                  <div className="mt-2 grid grid-cols-4 gap-1.5">
                    {slots.map((slot) => (
                      <button key={slot.startsAt} type="button" onClick={() => setForm((c) => ({ ...c, startsAt: slot.startsAt }))} className={`rounded-lg px-2 py-2 text-xs font-semibold transition ${form.startsAt === slot.startsAt ? "bg-slate-950 text-white shadow" : "border border-slate-200 bg-white text-slate-700 hover:border-sky-300"}`}>
                        {formatTime(slot.startsAt)}
                      </button>
                    ))}
                  </div>
                ) : (
                  <p className="mt-2 text-sm text-slate-400">No open times on this day.</p>
                )}
              </div>

              <label className="block text-xs font-medium text-slate-600">Subject (optional)
                <input value={form.subject} onChange={(event) => setForm((c) => ({ ...c, subject: event.target.value }))} placeholder={selectedType?.name || "Appointment"} className={`mt-1.5 ${input}`} />
              </label>
              <label className="block text-xs font-medium text-slate-600">Location (optional)
                <input value={form.location} onChange={(event) => setForm((c) => ({ ...c, location: event.target.value }))} placeholder="Office, phone, or video link" className={`mt-1.5 ${input}`} />
              </label>

              {error ? <p className="rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p> : null}
            </form>
            <footer className="border-t border-slate-100 p-4">
              <button type="button" onClick={submit} disabled={saving || !form.startsAt} className="flex h-12 w-full items-center justify-center gap-2 rounded-full bg-slate-950 text-sm font-semibold text-white disabled:opacity-50">
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null} {saving ? "Booking…" : "Book appointment"}
              </button>
            </footer>
          </motion.aside>
        </motion.div>
      ) : null}
    </AnimatePresence>,
    document.body,
  );
}

export default function CalendarPage() {
  const { role, appUser } = useAuth();
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date()));
  const [appointments, setAppointments] = useState([]);
  const [sessionTypes, setSessionTypes] = useState([]);
  const [staff, setStaff] = useState([]);
  const [staffFilter, setStaffFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [sheetOpen, setSheetOpen] = useState(false);
  const [selected, setSelected] = useState(null);
  const [cancelling, setCancelling] = useState(false);

  const days = useMemo(() => Array.from({ length: 7 }, (_, index) => new Date(weekStart.getTime() + index * DAY_MS)), [weekStart]);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [calendar, settings] = await Promise.all([
        getCalendarAppointments({ from: weekStart.toISOString(), to: new Date(weekStart.getTime() + 7 * DAY_MS).toISOString() }),
        getBookingSettings(),
      ]);
      setAppointments(calendar);
      setSessionTypes(settings.sessionTypes);
    } catch (reason) {
      setError(reason.response?.data?.message || "The calendar could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, [weekStart]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (role === "consultant") return;
    api.get("/leads/staff").then((response) => {
      setStaff((response.data.data || []).filter((member) => ["admin", "consultant"].includes(member.role)));
    }).catch(() => {});
  }, [role]);

  const staffColor = useMemo(() => {
    const map = new Map();
    staff.forEach((member, index) => map.set(member.id, STAFF_COLORS[index % STAFF_COLORS.length]));
    return map;
  }, [staff]);

  const visible = appointments.filter((item) => item.status === "Scheduled" && (!staffFilter || item.assignedTo?.id === staffFilter));

  async function cancelSelected() {
    if (!selected) return;
    setCancelling(true);
    try {
      const updated = await cancelBookingAppointment(selected.id);
      setAppointments((current) => current.map((item) => (item.id === updated.id ? updated : item)));
      setSelected(null);
    } catch (reason) {
      setError(reason.response?.data?.message || "The appointment could not be cancelled.");
    } finally {
      setCancelling(false);
    }
  }

  const todayKey = dateKey(new Date());
  const gridHours = GRID_END_HOUR - GRID_START_HOUR;

  return (
    <PageContainer
      title="Calendar"
      description={role === "consultant" ? "Your appointments and open time." : "Appointments across the workspace — book walk-ins and consultations."}
      actions={
        <div className="flex items-center gap-2">
          {role !== "consultant" && staff.length ? (
            <select value={staffFilter} onChange={(event) => setStaffFilter(event.target.value)} className="h-11 rounded-2xl border border-slate-200 bg-white/85 px-3 text-sm font-medium text-slate-700 outline-none">
              <option value="">All staff</option>
              {staff.map((member) => <option key={member.id} value={member.id}>{member.fullName}</option>)}
            </select>
          ) : null}
          <button type="button" onClick={load} aria-label="Refresh calendar" className="inline-flex h-11 w-11 items-center justify-center rounded-2xl border border-slate-200 bg-white/85 text-slate-600 hover:bg-white">
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          </button>
          <button type="button" onClick={() => setSheetOpen(true)} className="inline-flex h-11 items-center gap-2 rounded-2xl bg-slate-950 px-5 text-sm font-semibold text-white shadow-[0_14px_30px_rgba(15,23,42,0.22)] transition hover:-translate-y-0.5 hover:bg-slate-800">
            <Plus className="h-4 w-4" /> New appointment
          </button>
        </div>
      }
    >
      <div className="rounded-3xl border border-white/70 bg-white/80 shadow-[0_18px_45px_rgba(15,23,42,0.08)] backdrop-blur-xl">
        <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-5 py-3.5">
          <div className="flex items-center gap-1.5">
            <button type="button" aria-label="Previous week" onClick={() => setWeekStart((current) => new Date(current.getTime() - 7 * DAY_MS))} className="flex h-9 w-9 items-center justify-center rounded-full text-slate-500 hover:bg-slate-100"><ChevronLeft className="h-4 w-4" /></button>
            <button type="button" onClick={() => setWeekStart(startOfWeek(new Date()))} className="rounded-full border border-slate-200 bg-white px-3.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50">Today</button>
            <button type="button" aria-label="Next week" onClick={() => setWeekStart((current) => new Date(current.getTime() + 7 * DAY_MS))} className="flex h-9 w-9 items-center justify-center rounded-full text-slate-500 hover:bg-slate-100"><ChevronRight className="h-4 w-4" /></button>
          </div>
          <p className="flex items-center gap-2 text-sm font-semibold text-slate-800">
            <CalendarDays className="h-4 w-4 text-slate-400" />
            {days[0].toLocaleDateString("en-CA", { month: "short", day: "numeric" })} – {days[6].toLocaleDateString("en-CA", { month: "short", day: "numeric", year: "numeric" })}
          </p>
        </div>

        {error ? (
          <div className="flex items-center justify-between gap-3 px-5 py-4">
            <p className="text-sm text-rose-700">{error}</p>
            <button type="button" onClick={load} className="text-sm font-semibold text-rose-700 underline">Try again</button>
          </div>
        ) : null}

        <div className="overflow-x-auto">
          <div className="min-w-[860px]">
            <div className="grid grid-cols-[56px_repeat(7,1fr)] border-b border-slate-100">
              <div />
              {days.map((day) => (
                <div key={day.toISOString()} className={`px-2 py-2.5 text-center ${dateKey(day) === todayKey ? "text-sky-700" : "text-slate-600"}`}>
                  <p className="text-[11px] font-semibold uppercase tracking-wide">{day.toLocaleDateString("en-CA", { weekday: "short" })}</p>
                  <p className={`mx-auto mt-0.5 flex h-7 w-7 items-center justify-center rounded-full text-sm font-semibold ${dateKey(day) === todayKey ? "bg-sky-600 text-white" : ""}`}>{day.getDate()}</p>
                </div>
              ))}
            </div>
            <div className="grid grid-cols-[56px_repeat(7,1fr)]">
              <div className="relative" style={{ height: gridHours * HOUR_PX }}>
                {Array.from({ length: gridHours }, (_, index) => (
                  <span key={index} className="absolute right-2 -translate-y-1/2 text-[10px] font-medium text-slate-400" style={{ top: index * HOUR_PX }}>
                    {index === 0 ? "" : `${((GRID_START_HOUR + index - 1) % 12) + 1}${GRID_START_HOUR + index <= 12 ? "am" : "pm"}`}
                  </span>
                ))}
              </div>
              {days.map((day) => {
                const key = dateKey(day);
                const dayItems = visible.filter((item) => dateKey(new Date(item.startsAt)) === key);
                return (
                  <div key={key} className={`relative border-l border-slate-100 ${key === todayKey ? "bg-sky-50/40" : ""}`} style={{ height: gridHours * HOUR_PX }}>
                    {Array.from({ length: gridHours }, (_, index) => (
                      <div key={index} className="absolute inset-x-0 border-t border-slate-100/80" style={{ top: index * HOUR_PX }} />
                    ))}
                    {dayItems.map((item) => {
                      const start = new Date(item.startsAt);
                      const end = new Date(item.endsAt);
                      const top = ((start.getHours() + start.getMinutes() / 60 - GRID_START_HOUR) * HOUR_PX);
                      const height = Math.max(26, ((end - start) / 3600000) * HOUR_PX - 3);
                      const color = (item.assignedTo && staffColor.get(item.assignedTo.id)) || "bg-slate-500/90 border-slate-600";
                      return (
                        <button
                          key={item.id}
                          type="button"
                          onClick={() => setSelected(item)}
                          className={`absolute inset-x-1 overflow-hidden rounded-lg border-l-2 px-1.5 py-1 text-left text-white shadow-sm transition hover:brightness-110 ${color}`}
                          style={{ top: Math.max(0, top), height }}
                        >
                          <p className="truncate text-[11px] font-semibold leading-tight">{item.client?.fullName || item.guestName || item.subject}</p>
                          <p className="truncate text-[10px] opacity-85">{formatTime(item.startsAt)} · {item.sessionType?.name || item.subject}</p>
                        </button>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      <NewAppointmentSheet
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        onCreated={(created) => setAppointments((current) => [...current, created])}
        staff={staff}
        sessionTypes={sessionTypes}
        role={role}
        userId={appUser?.id}
      />

      {selected && typeof document !== "undefined"
        ? createPortal(
            <div className="fixed inset-0 z-[400] flex items-center justify-center bg-slate-950/25 px-4 backdrop-blur-[2px]" onMouseDown={(event) => { if (event.target === event.currentTarget) setSelected(null); }}>
              <motion.div initial={{ opacity: 0, scale: 0.94, y: 10 }} animate={{ opacity: 1, scale: 1, y: 0 }} className="w-full max-w-[360px] rounded-[1.6rem] border border-white/70 bg-white/95 p-6 shadow-[0_30px_90px_rgba(15,23,42,0.25)] backdrop-blur-2xl">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h3 className="truncate text-base font-semibold text-slate-950">{selected.subject}</h3>
                    <p className="mt-0.5 text-sm text-slate-500">{selected.client?.fullName || selected.guestName || "No contact"}</p>
                  </div>
                  <button type="button" onClick={() => setSelected(null)} aria-label="Close" className="flex h-8 w-8 items-center justify-center rounded-full text-slate-400 hover:bg-slate-100"><X className="h-4 w-4" /></button>
                </div>
                <dl className="mt-4 space-y-2 text-sm">
                  <div className="flex justify-between gap-3"><dt className="text-slate-400">When</dt><dd className="text-right font-medium text-slate-800">{new Date(selected.startsAt).toLocaleDateString("en-CA", { weekday: "short", month: "short", day: "numeric" })} · {formatTime(selected.startsAt)}–{formatTime(selected.endsAt)}</dd></div>
                  {selected.assignedTo ? <div className="flex justify-between gap-3"><dt className="text-slate-400">Staff</dt><dd className="font-medium text-slate-800">{selected.assignedTo.fullName}</dd></div> : null}
                  {selected.sessionType ? <div className="flex justify-between gap-3"><dt className="text-slate-400">Session</dt><dd className="font-medium text-slate-800">{selected.sessionType.name}</dd></div> : null}
                  {selected.location ? <div className="flex justify-between gap-3"><dt className="text-slate-400">Where</dt><dd className="font-medium text-slate-800">{selected.location}</dd></div> : null}
                  {selected.case ? <div className="flex justify-between gap-3"><dt className="text-slate-400">Case</dt><dd className="font-medium text-slate-800">{selected.case.caseType}</dd></div> : null}
                </dl>
                <button type="button" onClick={cancelSelected} disabled={cancelling} className="mt-5 flex h-11 w-full items-center justify-center gap-2 rounded-full border border-rose-200 bg-rose-50 text-sm font-semibold text-rose-700 transition hover:bg-rose-100 disabled:opacity-60">
                  {cancelling ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />} Cancel appointment
                </button>
              </motion.div>
            </div>,
            document.body,
          )
        : null}
    </PageContainer>
  );
}
