import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowLeft,
  CalendarDays,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Loader2,
  MapPin,
  Video,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { createPublicBooking, getPublicAvailability, getPublicBookingInfo } from "../api/bookingApi";

const DAY_MS = 24 * 60 * 60 * 1000;

function startOfWeek(date) {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  copy.setDate(copy.getDate() - ((copy.getDay() + 6) % 7));
  return copy;
}

function dateKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function formatTime(value) {
  return new Date(value).toLocaleTimeString("en-CA", { hour: "numeric", minute: "2-digit" });
}

export function BookingMonthPicker({ fetchAvailability, onPickSlot }) {
  const [cursor, setCursor] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });
  const [days, setDays] = useState({});
  const [loading, setLoading] = useState(true);
  const [selectedDay, setSelectedDay] = useState(null);
  const [selectedSlot, setSelectedSlot] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const gridStart = startOfWeek(new Date(cursor.getFullYear(), cursor.getMonth(), 1));
      const gridEnd = new Date(gridStart.getTime() + 41 * DAY_MS);
      const result = await fetchAvailability({ from: dateKey(gridStart), to: dateKey(gridEnd) });
      setDays(result.days || {});
    } catch {
      setDays({});
    } finally {
      setLoading(false);
    }
  }, [cursor, fetchAvailability]);

  useEffect(() => { load(); }, [load]);

  const cells = useMemo(() => {
    const gridStart = startOfWeek(new Date(cursor.getFullYear(), cursor.getMonth(), 1));
    return Array.from({ length: 42 }, (_, index) => new Date(gridStart.getTime() + index * DAY_MS));
  }, [cursor]);

  const slots = selectedDay ? days[selectedDay] || [] : [];
  const todayKey = dateKey(new Date());

  return (
    <div className="grid gap-6 sm:grid-cols-[1.15fr_1fr]">
      <div>
        <div className="flex items-center justify-between">
          <p className="text-sm font-semibold text-slate-900">
            {cursor.toLocaleDateString("en-CA", { month: "long", year: "numeric" })}
          </p>
          <div className="flex items-center gap-1">
            <button type="button" aria-label="Previous month" onClick={() => { setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1)); setSelectedDay(null); setSelectedSlot(null); }} className="flex h-9 w-9 items-center justify-center rounded-full text-slate-500 transition hover:bg-slate-100">
              <ChevronLeft className="h-4 w-4" />
            </button>
            <button type="button" aria-label="Next month" onClick={() => { setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1)); setSelectedDay(null); setSelectedSlot(null); }} className="flex h-9 w-9 items-center justify-center rounded-full text-slate-500 transition hover:bg-slate-100">
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>
        <div className="mt-3 grid grid-cols-7 text-center">
          {["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"].map((label) => (
            <span key={label} className="pb-2 text-[11px] font-semibold text-slate-400">{label}</span>
          ))}
          {cells.map((cell) => {
            const key = dateKey(cell);
            const inMonth = cell.getMonth() === cursor.getMonth();
            const available = (days[key] || []).length > 0;
            const isSelected = key === selectedDay;
            return (
              <span key={key} className="flex h-11 items-center justify-center">
                <button
                  type="button"
                  disabled={!available}
                  onClick={() => { setSelectedDay(key); setSelectedSlot(null); }}
                  className={`relative flex h-10 w-10 items-center justify-center rounded-full text-sm font-medium transition ${
                    isSelected
                      ? "bg-slate-950 text-white shadow-[0_8px_20px_rgba(15,23,42,0.3)]"
                      : available
                        ? "bg-sky-50 text-sky-700 hover:bg-sky-100"
                        : inMonth
                          ? "text-slate-300"
                          : "text-slate-200"
                  } ${key === todayKey && !isSelected ? "ring-1 ring-inset ring-slate-300" : ""}`}
                >
                  {cell.getDate()}
                </button>
              </span>
            );
          })}
        </div>
        {loading ? <p className="mt-2 flex items-center gap-2 text-xs text-slate-400"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Checking availability…</p> : null}
      </div>

      <div className="sm:border-l sm:border-slate-100 sm:pl-6">
        {selectedDay ? (
          <>
            <p className="text-sm font-semibold text-slate-900">
              {new Date(`${selectedDay}T12:00:00`).toLocaleDateString("en-CA", { weekday: "long", month: "long", day: "numeric" })}
            </p>
            <div className="mt-3 grid max-h-[300px] grid-cols-2 gap-2 overflow-y-auto pr-1">
              {slots.map((slot) => (
                <button
                  key={slot.startsAt}
                  type="button"
                  onClick={() => { setSelectedSlot(slot); onPickSlot(slot); }}
                  className={`rounded-xl border px-3 py-2.5 text-sm font-semibold transition ${
                    selectedSlot?.startsAt === slot.startsAt
                      ? "border-slate-950 bg-slate-950 text-white"
                      : "border-slate-200 bg-white text-slate-700 hover:border-sky-300 hover:bg-sky-50/60"
                  }`}
                >
                  {formatTime(slot.startsAt)}
                </button>
              ))}
              {!slots.length ? <p className="col-span-2 text-sm text-slate-400">No times left on this day.</p> : null}
            </div>
          </>
        ) : (
          <div className="flex h-full min-h-[180px] flex-col items-center justify-center text-center">
            <CalendarDays className="h-7 w-7 text-slate-300" />
            <p className="mt-2 max-w-[200px] text-sm text-slate-400">Pick a highlighted day to see available times.</p>
          </div>
        )}
      </div>
    </div>
  );
}

export function PublicShell({ children, agencyName }) {
  return (
    <main className="min-h-[100dvh] bg-[radial-gradient(circle_at_top_left,rgba(125,159,201,0.18),transparent_30%),radial-gradient(circle_at_90%_10%,rgba(93,130,178,0.12),transparent_25%),linear-gradient(180deg,#f5f8fc_0%,#e9f0f7_100%)] px-4 py-8 sm:py-14">
      <div className="mx-auto w-full max-w-2xl">
        {agencyName ? (
          <div className="mb-5 text-center">
            <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">Book with</p>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight text-slate-950">{agencyName}</h1>
          </div>
        ) : null}
        <motion.div
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
          className="rounded-[2rem] border border-white/80 bg-white/90 p-6 shadow-[0_30px_80px_rgba(15,23,42,0.12)] backdrop-blur-xl sm:p-8"
        >
          {children}
        </motion.div>
        <p className="mt-5 text-center text-xs text-slate-400">Powered by CaseDesk</p>
      </div>
    </main>
  );
}

const inputClass = "w-full rounded-xl border border-slate-200 bg-white px-3.5 py-3 text-base shadow-sm outline-none transition focus:border-sky-400 focus:ring-2 focus:ring-sky-100 sm:text-sm";

export default function PublicBookingPage() {
  const { token } = useParams();
  const [info, setInfo] = useState(null);
  const [loadError, setLoadError] = useState("");
  const [step, setStep] = useState("service");
  const [sessionTypeId, setSessionTypeId] = useState("");
  const [meetingMode, setMeetingMode] = useState("InPerson");
  const [slot, setSlot] = useState(null);
  const [form, setForm] = useState({ name: "", email: "", phone: "", notes: "" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(null);

  useEffect(() => {
    getPublicBookingInfo(token)
      .then((data) => {
        setInfo(data);
        if (data.sessionTypes.length === 1) setSessionTypeId(data.sessionTypes[0].id);
      })
      .catch((reason) => setLoadError(reason.response?.data?.message || "This booking page is not available."));
  }, [token]);

  const sessionType = info?.sessionTypes.find((type) => type.id === sessionTypeId) || null;

  const fetchAvailability = useCallback(
    (range) => getPublicAvailability(token, { sessionTypeId, ...range }),
    [token, sessionTypeId],
  );

  async function submit(event) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      const result = await createPublicBooking(token, {
        sessionTypeId,
        startsAt: slot.startsAt,
        meetingMode,
        name: form.name,
        email: form.email,
        phone: form.phone,
        notes: form.notes,
      });
      setDone(result);
      setStep("done");
    } catch (reason) {
      const code = reason.response?.data?.code;
      setError(reason.response?.data?.message || "The booking could not be completed.");
      if (code === "SLOT_TAKEN") { setStep("time"); setSlot(null); }
    } finally {
      setSaving(false);
    }
  }

  if (loadError) {
    return (
      <PublicShell>
        <div className="py-10 text-center">
          <p className="text-lg font-semibold text-slate-900">Booking unavailable</p>
          <p className="mt-2 text-sm text-slate-500">{loadError}</p>
        </div>
      </PublicShell>
    );
  }

  if (!info) {
    return (
      <PublicShell>
        <div className="flex items-center justify-center gap-2 py-14 text-sm text-slate-500">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading…
        </div>
      </PublicShell>
    );
  }

  return (
    <PublicShell agencyName={info.agencyName}>
      <AnimatePresence mode="wait">
        {step === "service" ? (
          <motion.div key="service" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}>
            <h2 className="text-lg font-semibold text-slate-950">What would you like to book?</h2>
            <div className="mt-4 space-y-2.5">
              {info.sessionTypes.map((type) => (
                <button
                  key={type.id}
                  type="button"
                  onClick={() => setSessionTypeId(type.id)}
                  className={`flex w-full items-center justify-between rounded-2xl border px-4 py-3.5 text-left transition ${
                    sessionTypeId === type.id ? "border-slate-950 bg-slate-950/[0.03] ring-1 ring-slate-950" : "border-slate-200 hover:border-slate-300 hover:bg-slate-50"
                  }`}
                >
                  <span>
                    <span className="block text-sm font-semibold text-slate-900">{type.name}</span>
                    {type.description ? <span className="mt-0.5 block text-xs text-slate-500">{type.description}</span> : null}
                  </span>
                  <span className="flex items-center gap-1.5 text-xs font-medium text-slate-500"><Clock3 className="h-3.5 w-3.5" />{type.durationMinutes} min</span>
                </button>
              ))}
              {!info.sessionTypes.length ? <p className="text-sm text-slate-400">No bookable services right now.</p> : null}
            </div>

            <p className="mt-5 text-sm font-medium text-slate-700">How would you like to meet?</p>
            <div className="mt-2 grid grid-cols-2 gap-2">
              {[
                { id: "InPerson", label: "In person", icon: MapPin },
                { id: "Online", label: "Online video call", icon: Video },
              ].map(({ id, label, icon: Icon }) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setMeetingMode(id)}
                  className={`flex items-center justify-center gap-2 rounded-2xl border px-4 py-3 text-sm font-semibold transition ${
                    meetingMode === id ? "border-slate-950 bg-slate-950 text-white" : "border-slate-200 text-slate-700 hover:border-slate-300"
                  }`}
                >
                  <Icon className="h-4 w-4" /> {label}
                </button>
              ))}
            </div>

            <button
              type="button"
              disabled={!sessionTypeId}
              onClick={() => setStep("time")}
              className="mt-6 flex h-12 w-full items-center justify-center rounded-full bg-slate-950 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:opacity-40"
            >
              Choose a time
            </button>
          </motion.div>
        ) : step === "time" ? (
          <motion.div key="time" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}>
            <div className="mb-4 flex items-center justify-between">
              <button type="button" onClick={() => setStep("service")} className="flex items-center gap-1.5 text-sm font-medium text-slate-500 transition hover:text-slate-800">
                <ArrowLeft className="h-4 w-4" /> Back
              </button>
              <p className="text-sm text-slate-500">{sessionType?.name} · {sessionType?.durationMinutes} min</p>
            </div>
            {error ? <p className="mb-3 rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p> : null}
            <BookingMonthPicker
              fetchAvailability={fetchAvailability}
              onPickSlot={(picked) => { setSlot(picked); setError(""); }}
            />
            <button
              type="button"
              disabled={!slot}
              onClick={() => setStep("details")}
              className="mt-6 flex h-12 w-full items-center justify-center rounded-full bg-slate-950 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:opacity-40"
            >
              {slot ? `Continue with ${formatTime(slot.startsAt)}` : "Pick a time to continue"}
            </button>
          </motion.div>
        ) : step === "details" ? (
          <motion.form key="details" onSubmit={submit} initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}>
            <div className="mb-4 flex items-center justify-between">
              <button type="button" onClick={() => setStep("time")} className="flex items-center gap-1.5 text-sm font-medium text-slate-500 transition hover:text-slate-800">
                <ArrowLeft className="h-4 w-4" /> Back
              </button>
            </div>
            <div className="rounded-2xl bg-slate-50 px-4 py-3.5 text-sm">
              <p className="font-semibold text-slate-900">{sessionType?.name}</p>
              <p className="mt-0.5 text-slate-500">
                {new Date(slot.startsAt).toLocaleDateString("en-CA", { weekday: "long", month: "long", day: "numeric" })} · {formatTime(slot.startsAt)}
                {" · "}{meetingMode === "Online" ? "Online video call" : "In person"}
              </p>
            </div>
            <div className="mt-4 space-y-3.5">
              <label className="block text-xs font-medium text-slate-600">Full name
                <input required value={form.name} onChange={(e) => setForm((c) => ({ ...c, name: e.target.value }))} className={`mt-1.5 ${inputClass}`} autoComplete="name" />
              </label>
              <label className="block text-xs font-medium text-slate-600">Email
                <input required type="email" value={form.email} onChange={(e) => setForm((c) => ({ ...c, email: e.target.value }))} className={`mt-1.5 ${inputClass}`} autoComplete="email" />
              </label>
              <label className="block text-xs font-medium text-slate-600">Phone (optional)
                <input value={form.phone} onChange={(e) => setForm((c) => ({ ...c, phone: e.target.value }))} className={`mt-1.5 ${inputClass}`} autoComplete="tel" />
              </label>
              <label className="block text-xs font-medium text-slate-600">Anything we should know? (optional)
                <textarea rows={2} value={form.notes} onChange={(e) => setForm((c) => ({ ...c, notes: e.target.value }))} className={`mt-1.5 resize-none ${inputClass}`} />
              </label>
            </div>
            {error ? <p className="mt-3 rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p> : null}
            <button type="submit" disabled={saving} className="mt-5 flex h-12 w-full items-center justify-center gap-2 rounded-full bg-slate-950 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:opacity-60">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null} {saving ? "Booking…" : "Confirm booking"}
            </button>
          </motion.form>
        ) : (
          <motion.div key="done" initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} className="py-4 text-center">
            <motion.span initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: "spring", stiffness: 260, damping: 18 }} className="inline-flex">
              <CheckCircle2 className="h-16 w-16 text-emerald-500" strokeWidth={1.5} />
            </motion.span>
            <h2 className="mt-4 text-xl font-semibold text-slate-950">You’re booked!</h2>
            <p className="mt-1.5 text-sm text-slate-500">
              {done?.subject} · {new Date(done?.startsAt).toLocaleDateString("en-CA", { weekday: "long", month: "long", day: "numeric" })} at {formatTime(done?.startsAt)}
            </p>
            {done?.meetingUrl ? (
              <a href={done.meetingUrl} target="_blank" rel="noopener noreferrer" className="mt-4 inline-flex items-center gap-2 rounded-full bg-sky-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-sky-700">
                <Video className="h-4 w-4" /> Join link for your video call
              </a>
            ) : null}
            <p className="mx-auto mt-5 max-w-[320px] text-sm leading-6 text-slate-500">
              A confirmation with all the details {done?.meetingUrl ? "and your join link " : ""}is on its way to your email. Use the link in it to reschedule or cancel anytime.
            </p>
            <a href={`/book/manage/${done?.manageToken}`} className="mt-4 inline-block text-sm font-semibold text-sky-700 transition hover:text-sky-800">
              Manage this booking →
            </a>
          </motion.div>
        )}
      </AnimatePresence>
    </PublicShell>
  );
}
