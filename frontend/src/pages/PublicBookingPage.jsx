import { AnimatePresence, motion, useMotionValue, useTransform } from "framer-motion";
import {
  ArrowLeft,
  ArrowRight,
  Briefcase,
  Calendar,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock3,
  ExternalLink,
  Globe2,
  Info,
  Loader2,
  Mail,
  MapPin,
  Phone,
  User,
  Video,
  Wallet,
  X,
} from "lucide-react";
import { gsap } from "gsap";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useParams, useSearchParams } from "react-router-dom";
import { createPublicBooking, createPublicBookingPaymentHold, getPublicAvailability, getPublicBookingAvatarUrl, getPublicBookingInfo, getPublicBookingPaymentHoldStatus, joinPublicBookingWaitlist, requestPublicBookingVerification, verifyPublicBookingEmail } from "../api/bookingApi";

const DAY_MS = 24 * 60 * 60 * 1000;
const spring = { type: "spring", stiffness: 380, damping: 32 };

function startOfWeek(date) {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  copy.setDate(copy.getDate() - ((copy.getDay() + 6) % 7));
  return copy;
}

function dateKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function zonedDateKey(value, timezone) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" })
    .formatToParts(new Date(value))
    .reduce((result, part) => ({ ...result, [part.type]: part.value }), {});
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function formatTime(value, timezone) {
  return new Date(value).toLocaleTimeString("en-CA", { timeZone: timezone, hour: "numeric", minute: "2-digit" });
}

function formatTimeWithZone(value, timezone) {
  return new Date(value).toLocaleTimeString("en-CA", { timeZone: timezone, hour: "numeric", minute: "2-digit", timeZoneName: "short" });
}

function isAfternoon(value, timezone) {
  const hour = Number(new Intl.DateTimeFormat("en-CA", { timeZone: timezone, hour: "numeric", hour12: false }).format(new Date(value)));
  return hour >= 12;
}

function externalUrl(value) {
  return /^https?:\/\//i.test(value || "") ? value : `https://${value}`;
}

function DetailRow({ icon: Icon, label, value }) {
  return (
    <div className="flex items-start gap-3">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-sky-100 text-sky-600"><Icon className="h-4 w-4" /></span>
      <span className="min-w-0">
        <span className="block text-[11px] font-medium text-slate-400">{label}</span>
        <span className="block truncate text-sm font-semibold text-slate-900">{value}</span>
      </span>
    </div>
  );
}

const MICRO_STEPS = ["Select date", "Select time", "Confirm"];

/**
 * Three persistent columns — date, time, confirm — matching the target
 * layout: picking a day never hides the calendar, and picking a slot
 * never hides the time list. The confirm column is a standing panel,
 * not a state that swaps another column away.
 */
export function BookingMonthPicker({ fetchAvailability, initialSlot, onPickSlot, timezone, sessionType, agencyName, consultantName }) {
  const initialDay = initialSlot?.startsAt
    ? zonedDateKey(initialSlot.startsAt, timezone)
    : null;
  const [cursor, setCursor] = useState(() => {
    const startingDate = initialDay ? new Date(`${initialDay}T12:00:00`) : new Date();
    return new Date(startingDate.getFullYear(), startingDate.getMonth(), 1);
  });
  const [days, setDays] = useState({});
  const [loading, setLoading] = useState(true);
  const [selectedDay, setSelectedDay] = useState(initialDay);
  const [selectedSlot, setSelectedSlot] = useState(initialSlot || null);

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
    return Array.from({ length: 42 }, (_, index) => new Date(
      gridStart.getFullYear(),
      gridStart.getMonth(),
      gridStart.getDate() + index,
    ));
  }, [cursor]);

  const slots = selectedDay ? days[selectedDay] || [] : [];
  const morningSlots = slots.filter((item) => !isAfternoon(item.startsAt, timezone));
  const afternoonSlots = slots.filter((item) => isAfternoon(item.startsAt, timezone));
  const todayKey = dateKey(new Date());
  const selectedDayLabel = selectedDay
    ? new Date(`${selectedDay}T12:00:00`).toLocaleDateString("en-CA", { weekday: "short", month: "short", day: "numeric" })
    : "";
  const selectedDayLabelFull = selectedDay
    ? new Date(`${selectedDay}T12:00:00`).toLocaleDateString("en-CA", { weekday: "short", month: "short", day: "numeric", year: "numeric" })
    : "";
  const microStep = !selectedDay ? 0 : !selectedSlot ? 1 : 2;

  const renderSlot = (slotItem, index) => (
    <motion.button
      key={slotItem.startsAt}
      type="button"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: Math.min(index * 0.02, 0.25), ...spring }}
      whileTap={{ scale: 0.94 }}
      onClick={() => setSelectedSlot(slotItem)}
      className={`min-h-[44px] rounded-2xl border px-2 py-2.5 text-sm font-semibold transition-colors ${
        selectedSlot?.startsAt === slotItem.startsAt
          ? "border-sky-600 bg-sky-600 text-white"
          : "border-slate-200 bg-white text-slate-700 hover:border-sky-300 hover:bg-sky-50"
      }`}
    >
      {formatTime(slotItem.startsAt, timezone)}
    </motion.button>
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="mb-4 flex shrink-0 items-center gap-2">
        {MICRO_STEPS.map((label, index) => (
          <Fragment key={label}>
            <div className="flex items-center gap-1.5">
              <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${
                index === microStep ? "bg-sky-600 text-white" : index < microStep ? "bg-sky-100 text-sky-700" : "bg-slate-100 text-slate-400"
              }`}>
                {index < microStep ? "✓" : index + 1}
              </span>
              <span className={`text-xs font-semibold ${index === microStep ? "text-slate-900" : "text-slate-400"}`}>{label}</span>
            </div>
            {index < MICRO_STEPS.length - 1 ? <span className="h-px w-5 shrink-0 bg-slate-200" /> : null}
          </Fragment>
        ))}
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-6 lg:flex-row">
        <div className="shrink-0 lg:w-[260px]">
          <div className="flex items-center justify-between">
            <AnimatePresence mode="wait">
              <motion.p key={cursor.toISOString()} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} className="text-base font-semibold text-slate-900">
                {cursor.toLocaleDateString("en-CA", { month: "long", year: "numeric" })}
              </motion.p>
            </AnimatePresence>
            <div className="flex items-center gap-1.5">
              <button type="button" aria-label="Previous month" onClick={() => { setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1)); setSelectedDay(null); setSelectedSlot(null); }} className="flex h-9 w-9 items-center justify-center rounded-full border border-slate-200 text-slate-500 transition hover:bg-slate-50 active:scale-95">
                <ChevronLeft className="h-4 w-4" />
              </button>
              <button type="button" aria-label="Next month" onClick={() => { setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1)); setSelectedDay(null); setSelectedSlot(null); }} className="flex h-9 w-9 items-center justify-center rounded-full border border-slate-200 text-slate-500 transition hover:bg-slate-50 active:scale-95">
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </div>

          <div className="mt-3 grid grid-cols-7 text-center">
            {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((label) => (
              <span key={label} className="pb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">{label}</span>
            ))}
            {cells.map((cell) => {
              const key = dateKey(cell);
              const inMonth = cell.getMonth() === cursor.getMonth();
              const available = (days[key] || []).length > 0;
              const isSelected = key === selectedDay;
              return (
                <span key={key} className="flex h-11 items-center justify-center">
                  <motion.button
                    type="button"
                    disabled={!available}
                    initial={false}
                    animate={{ scale: isSelected ? 1.08 : 1 }}
                    transition={spring}
                    whileTap={available ? { scale: 0.9 } : undefined}
                    onClick={() => { setSelectedDay(key); setSelectedSlot(null); }}
                    className={`relative flex h-10 w-10 items-center justify-center rounded-full text-sm font-medium transition-colors ${
                      isSelected
                        ? "bg-sky-600 text-white shadow-[0_10px_24px_rgba(2,132,199,0.45)]"
                        : available
                          ? "font-semibold text-slate-800 hover:bg-slate-100"
                          : inMonth
                            ? "text-slate-300"
                            : "text-slate-200"
                    } ${key === todayKey && !isSelected ? "ring-1 ring-inset ring-sky-300" : ""}`}
                  >
                    {cell.getDate()}
                    {available && !isSelected ? <span className="absolute bottom-1 h-1 w-1 rounded-full bg-sky-500" /> : null}
                  </motion.button>
                </span>
              );
            })}
          </div>

          <div className="mt-3 flex items-center gap-4 text-xs text-slate-500">
            <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-sky-500" /> Available</span>
            <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-slate-300" /> Unavailable</span>
          </div>
          {loading ? <p className="mt-2 flex items-center gap-2 text-xs text-slate-400"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Checking availability…</p> : null}
        </div>

        <div className={`flex min-h-0 flex-1 flex-col border-t border-slate-100 pt-5 lg:border-l lg:border-t-0 lg:px-6 lg:pt-0 ${selectedDay ? "flex" : "hidden lg:flex"}`}>
          {!selectedDay ? (
            <div className="hidden flex-1 items-center justify-center rounded-2xl bg-slate-50 px-4 py-10 text-center text-sm text-slate-400 lg:flex">
              Select a date to see available times
            </div>
          ) : (
            <>
              <p className="text-sm font-semibold text-slate-900">Select a time for {selectedDayLabel}</p>
              <p className="mt-0.5 text-xs text-slate-400">All times shown in {timezone}</p>
              <div className="mt-3 grid flex-1 auto-rows-min grid-cols-2 gap-2 overflow-y-auto sm:grid-cols-3">
                {morningSlots.map((slotItem, index) => renderSlot(slotItem, index))}
                {afternoonSlots.length ? (
                  <div className="col-span-full my-1 flex items-center gap-3 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                    <span className="h-px flex-1 bg-slate-200" /> Afternoon <span className="h-px flex-1 bg-slate-200" />
                  </div>
                ) : null}
                {afternoonSlots.map((slotItem, index) => renderSlot(slotItem, morningSlots.length + index))}
                {!slots.length ? <p className="col-span-full text-sm text-slate-400">No times left on this day.</p> : null}
              </div>
            </>
          )}
        </div>

        <div className={`shrink-0 flex-col border-t border-slate-100 pt-5 lg:w-[300px] lg:border-l lg:border-t-0 lg:pl-6 lg:pt-0 ${selectedSlot ? "flex" : "hidden lg:flex"}`}>
          {!selectedSlot ? (
            <div className="hidden flex-1 flex-col items-center justify-center rounded-2xl bg-slate-50 p-6 text-center text-sm text-slate-400 lg:flex">
              Pick a date and time to review your booking
            </div>
          ) : (
            <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="flex flex-1 flex-col">
              <div className="flex items-center gap-2 text-emerald-700">
                <CheckCircle2 className="h-5 w-5" />
                <p className="text-sm font-semibold text-slate-900">Confirm your booking</p>
              </div>
              <p className="mt-1 text-xs text-slate-500">Review your details and continue.</p>

              <div className="mt-4 space-y-3 rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <DetailRow icon={Calendar} label="Date" value={selectedDayLabelFull} />
                <DetailRow icon={Clock3} label="Time" value={formatTimeWithZone(selectedSlot.startsAt, timezone)} />
                {sessionType ? <DetailRow icon={Briefcase} label="Service" value={`${sessionType.name} (${sessionType.durationMinutes} min)`} /> : null}
                <DetailRow icon={User} label="With" value={consultantName || agencyName} />
              </div>

              <div className="mt-4 flex flex-col gap-2">
                <button type="button" onClick={() => onPickSlot(selectedSlot)} className="flex h-12 items-center justify-center rounded-full bg-slate-950 text-sm font-semibold text-white transition hover:bg-slate-800">
                  Continue
                </button>
                <button type="button" onClick={() => setSelectedSlot(null)} className="flex h-12 items-center justify-center rounded-full border border-slate-200 bg-white text-sm font-semibold text-slate-600 transition hover:bg-slate-50">
                  Choose another time
                </button>
                <button type="button" onClick={() => { setSelectedDay(null); setSelectedSlot(null); }} className="mt-1 flex items-center justify-center gap-1 text-xs font-semibold text-slate-500 transition hover:text-slate-800">
                  <ArrowLeft className="h-3.5 w-3.5" /> Back to date selection
                </button>
              </div>
            </motion.div>
          )}
        </div>
      </div>
    </div>
  );
}

export function PublicShell({ children, agencyName }) {
  return (
    <main className="flex min-h-[100dvh] flex-col items-center justify-center bg-white px-4 py-6 sm:px-6">
      <div className="w-full max-w-xl">
        {agencyName ? (
          <div className="mb-5 text-center">
            <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">Book with</p>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight text-slate-950">{agencyName}</h1>
          </div>
        ) : null}
        <motion.div initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }} className="rounded-2xl border border-slate-200 bg-white p-6 sm:p-8">
          {children}
        </motion.div>
        <p className="mt-5 text-center text-xs text-slate-400">Powered by CaseDesk</p>
      </div>
    </main>
  );
}

function SlideToConfirm({ onConfirm, busy, label = "Slide to confirm" }) {
  const trackRef = useRef(null);
  const x = useMotionValue(0);
  const [max, setMax] = useState(220);
  const progress = useTransform(x, [0, Math.max(max, 1)], [0, 1]);
  const labelOpacity = useTransform(progress, [0, 0.6], [1, 0]);

  useEffect(() => {
    const track = trackRef.current;
    if (!track) return;
    const measure = () => setMax(Math.max(track.clientWidth - 56 - 8, 0));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(track);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!busy) x.set(0);
  }, [busy, x]);

  return (
    <div ref={trackRef} className="relative h-14 w-full select-none overflow-hidden rounded-full bg-slate-950 shadow-[0_16px_40px_rgba(15,23,42,0.35)]">
      <motion.p style={{ opacity: labelOpacity }} className="pointer-events-none absolute inset-0 flex items-center justify-center pl-8 text-sm font-semibold text-white/85">
        {busy ? "Booking…" : label}
        {!busy ? <span className="ml-2 animate-pulse text-white/50">›››</span> : null}
      </motion.p>
      <motion.div
        drag={busy ? false : "x"}
        dragConstraints={{ left: 0, right: max }}
        dragElastic={0.02}
        dragMomentum={false}
        style={{ x }}
        onDragEnd={() => {
          if (x.get() >= max * 0.86) onConfirm();
          else x.set(0);
        }}
        className="absolute left-1 top-1 flex h-12 w-14 cursor-grab items-center justify-center rounded-full bg-white text-slate-950 shadow-lg active:cursor-grabbing"
      >
        {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <ArrowRight className="h-5 w-5" />}
      </motion.div>
    </div>
  );
}

const inputClass = "w-full rounded-2xl border border-slate-200/80 bg-white/80 px-3.5 py-3 text-base shadow-sm outline-none transition focus:border-sky-400 focus:ring-2 focus:ring-sky-100 sm:text-sm";

const stepMotion = {
  initial: { opacity: 0, x: 28 },
  animate: { opacity: 1, x: 0 },
  exit: { opacity: 0, x: -28 },
  transition: { duration: 0.3, ease: [0.32, 0.72, 0, 1] },
};

export default function PublicBookingPage() {
  const { token } = useParams();
  const [searchParams] = useSearchParams();
  const offerToken = searchParams.get("offer") || "";
  const [info, setInfo] = useState(null);
  const [loadError, setLoadError] = useState("");
  const [step, setStep] = useState("service");
  const [sessionTypeId, setSessionTypeId] = useState("");
  const [meetingMode, setMeetingMode] = useState("InPerson");
  const [locationId, setLocationId] = useState("");
  const [consultantId, setConsultantId] = useState("");
  const [slot, setSlot] = useState(null);
  const [form, setForm] = useState({ name: "", email: "", phone: "", notes: "", website: "" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(null);
  const [waitlistDates, setWaitlistDates] = useState(() => ({ from: dateKey(new Date()), to: dateKey(new Date(Date.now() + 30 * DAY_MS)) }));
  const [paymentHold, setPaymentHold] = useState(null);
  const [verification, setVerification] = useState({ id: "", code: "", token: "", sending: false, recognized: false, consultant: null });
  const [infoOpen, setInfoOpen] = useState(false);
  const [cookieInfoOpen, setCookieInfoOpen] = useState(false);
  const bookingKey = useRef(crypto.randomUUID());
  const heroRef = useRef(null);

  useEffect(() => {
    getPublicBookingInfo(token, offerToken)
      .then((data) => {
        setInfo(data);
        if (data.offerExpired) setError("That reserved waitlist time has expired, but you can choose another available appointment.");
        if (data.offer) {
          setSessionTypeId(data.offer.sessionTypeId);
          setMeetingMode(data.offer.meetingMode);
          setLocationId(data.offer.locationId || "");
          setConsultantId(data.offer.consultantId);
          setForm((current) => ({ ...current, name: data.offer.name, email: data.offer.email, phone: data.offer.phone || "" }));
          setSlot({ startsAt: data.offer.startsAt, endsAt: data.offer.endsAt });
          setStep("details");
          return;
        }
        if (data.sessionTypes.length === 1) setSessionTypeId(data.sessionTypes[0].id);
        if (data.locations.length === 1) setLocationId(data.locations[0].id);
        if (data.consultants?.length === 1) setConsultantId(data.consultants[0].id);
      })
      .catch((reason) => setLoadError(reason.response?.data?.message || "This booking page is not available."));
  }, [token, offerToken]);

  useEffect(() => {
    try {
      const saved = JSON.parse(sessionStorage.getItem(`booking-draft:${token}`) || "null");
      if (!saved || offerToken) return;
      if (saved.sessionTypeId) setSessionTypeId(saved.sessionTypeId);
      if (saved.meetingMode) setMeetingMode(saved.meetingMode);
      if (saved.locationId) setLocationId(saved.locationId);
      if (saved.consultantId) setConsultantId(saved.consultantId);
      if (saved.form) setForm((current) => ({ ...current, ...saved.form, website: "" }));
    } catch { /* Ignore an invalid browser draft. */ }
  }, [token, offerToken]);

  useEffect(() => {
    if (step === "done") return;
    sessionStorage.setItem(`booking-draft:${token}`, JSON.stringify({ sessionTypeId, meetingMode, locationId, consultantId, form: { name: form.name, email: form.email, phone: form.phone, notes: form.notes } }));
  }, [token, step, sessionTypeId, meetingMode, locationId, consultantId, form]);

  const sessionType = info?.sessionTypes.find((type) => type.id === sessionTypeId) || null;
  const selectableLocations = sessionType?.allowedLocationIds?.length ? info.locations.filter((item) => sessionType.allowedLocationIds.includes(item.id)) : info?.locations || [];
  const selectableConsultants = sessionType?.eligibleStaff?.length ? info.consultants.filter((item) => sessionType.eligibleStaff.some((eligible) => eligible.userId === item.id)) : info?.consultants || [];
  const location = selectableLocations.find((item) => item.id === locationId) || null;
  const consultantName = selectableConsultants.find((item) => item.id === consultantId)?.name || null;
  const needsLocationStep = meetingMode === "InPerson" && selectableLocations.length > 1;
  const meetingModeOptions = [
    { id: "InPerson", label: "In person", icon: MapPin, disabled: !selectableLocations.length || (sessionType?.allowedMeetingModes && !sessionType.allowedMeetingModes.includes("InPerson")) },
    { id: "Online", label: "Online video call", icon: Video, disabled: sessionType?.allowedMeetingModes && !sessionType.allowedMeetingModes.includes("Online") },
  ].filter((option) => option.id !== "Online" || info?.onlineBookingEnabled !== false);

  useEffect(() => {
    const allowedModes = (sessionType?.allowedMeetingModes?.length ? sessionType.allowedMeetingModes : ["InPerson", "Online"])
      .filter((mode) => mode !== "Online" || info?.onlineBookingEnabled !== false);
    if (!allowedModes.length || allowedModes.includes(meetingMode)) return;
    setMeetingMode(allowedModes[0] || "InPerson");
    setSlot(null);
  }, [sessionType, meetingMode, info?.onlineBookingEnabled]);

  useEffect(() => {
    if (consultantId && !selectableConsultants.some((item) => item.id === consultantId)) setConsultantId("");
  }, [consultantId, selectableConsultants]);

  const fetchAvailability = useCallback(
    (range) => getPublicAvailability(token, { sessionTypeId, consultantId, offerToken: offerToken || undefined, ...range }),
    [token, sessionTypeId, consultantId, offerToken],
  );

  function afterService() {
    setSlot(null);
    setStep(needsLocationStep ? "location" : "time");
  }

  const requiresPayment = Boolean(info?.consultFeeEnabled && Number(info?.consultFeeAmount) > 0);

  useEffect(() => {
    if (!info || !heroRef.current) return undefined;
    const context = gsap.context(() => {
      gsap.timeline({ defaults: { ease: "power3.out" } })
        .from("[data-booking-hero='logo']", { opacity: 0, scale: 0.82, y: -6, duration: 0.4 })
        .from("[data-booking-hero='copy']", { opacity: 0, y: 10, duration: 0.4, stagger: 0.08 }, "-=0.2")
        .from("[data-booking-hero='pill']", { opacity: 0, scale: 0.8, duration: 0.5, ease: "elastic.out(1, 0.55)" }, "-=0.25");
    }, heroRef);
    return () => context.revert();
  }, [info]);

  async function submit() {
    if (saving) return;
    setSaving(true);
    setError("");
    const payload = {
      sessionTypeId,
      startsAt: slot.startsAt,
      meetingMode,
      locationId: meetingMode === "InPerson" ? locationId || selectableLocations[0]?.id : undefined,
      consultantId: consultantId || undefined,
      idempotencyKey: bookingKey.current,
      name: form.name,
      email: form.email,
      phone: form.phone,
      notes: form.notes,
      website: form.website,
      verificationToken: verification.token || undefined,
      offerToken: offerToken || undefined,
    };
    try {
      if (requiresPayment) {
        const hold = await createPublicBookingPaymentHold(token, payload);
        setPaymentHold(hold);
        setStep("payment");
        return;
      }
      const result = await createPublicBooking(token, payload);
      sessionStorage.removeItem(`booking-draft:${token}`);
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

  // Poll the hold's status while waiting for the client to pay on
  // QuickBooks' hosted checkout page — the webhook confirms it
  // server-side, this just picks up the change.
  useEffect(() => {
    if (step !== "payment" || !paymentHold?.claimToken) return undefined;
    let active = true;
    const poll = async () => {
      try {
        const latest = await getPublicBookingPaymentHoldStatus(token, paymentHold.claimToken);
        if (!active) return;
        setPaymentHold(latest);
        if (latest.status === "Paid") {
          sessionStorage.removeItem(`booking-draft:${token}`);
          setDone({ subject: sessionType?.name, startsAt: latest.startsAt, location: location ? `${location.name} — ${location.address}` : null, locationMapsUrl: location?.mapsUrl });
          setStep("done");
        }
      } catch { /* transient poll failure — try again next tick */ }
    };
    poll();
    const interval = setInterval(poll, 4000);
    return () => { active = false; clearInterval(interval); };
  }, [step, paymentHold?.claimToken, token, sessionType, location]);

  async function requestVerification() {
    setVerification((current) => ({ ...current, sending: true })); setError("");
    try { const result = await requestPublicBookingVerification(token, form.email); setVerification({ id: result.verificationId, code: "", token: "", sending: false, recognized: false, consultant: null }); }
    catch (reason) { setVerification((current) => ({ ...current, sending: false })); setError(reason.response?.data?.message || "Verification email could not be sent."); }
  }

  async function verifyEmail() {
    setVerification((current) => ({ ...current, sending: true })); setError("");
    try { const result = await verifyPublicBookingEmail(token, verification.id, verification.code); setVerification((current) => ({ ...current, ...result, token: result.verificationToken, sending: false })); if (result.consultant && selectableConsultants.some((item) => item.id === result.consultant.id)) setConsultantId(result.consultant.id); }
    catch (reason) { setVerification((current) => ({ ...current, sending: false })); setError(reason.response?.data?.message || "Email could not be verified."); }
  }

  async function joinWaitlist() {
    if (saving) return;
    setSaving(true);
    setError("");
    try {
      await joinPublicBookingWaitlist(token, { sessionTypeId, consultantId: consultantId || undefined, meetingMode, locationId: meetingMode === "InPerson" ? locationId || selectableLocations[0]?.id : undefined, name: form.name, email: form.email, phone: form.phone, preferredFrom: `${waitlistDates.from}T00:00:00`, preferredTo: `${waitlistDates.to}T23:59:59` });
      sessionStorage.removeItem(`booking-draft:${token}`);
      setDone({ waitlist: true });
      setStep("done");
    } catch (reason) {
      setError(reason.response?.data?.message || "You could not be added to the waitlist.");
    } finally { setSaving(false); }
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

  const initials = info.agencyName.split(" ").filter(Boolean).map((part) => part[0]).join("").slice(0, 2).toUpperCase();
  const agency = info.agency || { name: info.agencyName };
  const agencyAddress = [agency.address, agency.city, agency.province, agency.postalCode, agency.country].filter(Boolean).join(", ");
  const stepIndex = { service: 0, location: 1, time: 2, details: 3, waitlist: 3, payment: 3, done: 4 }[step];
  const summarySession = sessionType || info.sessionTypes[0] || null;
  const currency = agency.defaultCurrency || "CAD";
  const bookingLogoUrl = agency.hasAvatar ? getPublicBookingAvatarUrl(token) : agency.logoUrl;
  const summaryMeta = [
    summarySession ? `${summarySession.durationMinutes} min` : null,
    requiresPayment ? Number(info.consultFeeAmount).toLocaleString("en-CA", { style: "currency", currency }) : null,
  ].filter(Boolean).join(" · ");
  const headline = info.publicHeadline || "Schedule your consultation";
  const signOff = info.publicSignOffName || `TEAM — ${info.agencyName}`;

  const brandLogo = (className) => bookingLogoUrl ? (
    <img src={bookingLogoUrl} alt={`${info.agencyName} logo`} className={`${className} border border-white/80 bg-white object-contain p-1 shadow-[0_14px_30px_rgba(15,23,42,0.12)]`} />
  ) : (
    <span className={`${className} flex items-center justify-center bg-gradient-to-br from-sky-500 to-indigo-600 font-bold text-white shadow-[0_14px_30px_rgba(56,130,246,0.35)]`}>{initials}</span>
  );

  const contactBlock = (className = "") => (agencyAddress || agency.phone || agency.email || agency.website) ? (
    <div className={`space-y-1.5 text-sm text-slate-600 ${className}`}>
      {agencyAddress ? <p className="flex items-start gap-2.5"><MapPin className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" /><span>{agencyAddress}</span></p> : null}
      {agency.phone ? <a href={`tel:${agency.phone}`} className="flex items-center gap-2.5 transition hover:text-sky-700"><Phone className="h-4 w-4 shrink-0 text-slate-400" />{agency.phone}</a> : null}
      {agency.email ? <a href={`mailto:${agency.email}`} className="flex items-center gap-2.5 break-all transition hover:text-sky-700"><Mail className="h-4 w-4 shrink-0 text-slate-400" />{agency.email}</a> : null}
      {agency.website ? <a href={externalUrl(agency.website)} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2.5 transition hover:text-sky-700"><Globe2 className="h-4 w-4 shrink-0 text-slate-400" /><span className="truncate">{agency.website.replace(/^https?:\/\//, "")}</span><ExternalLink className="h-3 w-3 shrink-0" /></a> : null}
    </div>
  ) : null;

  const legalLinks = (
    <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-[11px] font-medium text-slate-400">
      <button type="button" onClick={() => setCookieInfoOpen(true)} className="transition hover:text-slate-600">Cookie settings</button>
      <a href="/legal/privacy" className="transition hover:text-slate-600">Privacy Policy</a>
    </div>
  );

  return (
    <>
    <main className="flex h-[100dvh] flex-col overflow-hidden bg-white">
      <header ref={heroRef} className="flex shrink-0 items-center justify-between gap-3 border-b border-slate-200 px-4 py-3 sm:px-8">
        <div className="flex min-w-0 items-center gap-3">
          <div data-booking-hero="logo">{brandLogo("h-10 w-10 shrink-0 rounded-xl text-sm")}</div>
          <div className="min-w-0" data-booking-hero="copy">
            <p className="truncate text-sm font-semibold text-slate-950">{info.agencyName}</p>
            <p className="truncate text-xs text-slate-500">{headline}</p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {summaryMeta ? <span data-booking-hero="pill" className="hidden rounded-full border border-sky-100 bg-sky-50 px-3 py-1.5 text-xs font-semibold text-sky-800 sm:inline-block">{summaryMeta}</span> : null}
          <button type="button" onClick={() => setInfoOpen(true)} aria-label="About this consultation" className="flex h-9 w-9 items-center justify-center rounded-full border border-slate-200 text-slate-500 transition hover:bg-slate-50">
            <Info className="h-4 w-4" />
          </button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1 items-stretch justify-center overflow-hidden">
        <div className={`flex w-full flex-col overflow-y-auto px-4 py-5 sm:px-8 sm:py-6 ${step === "time" ? "max-w-6xl" : "max-w-4xl"}`}>
          <div className="mb-3 hidden items-center gap-1.5 sm:flex">
            {[0, 1, 2, 3].map((index) => (
              <span key={index} className={`h-1 flex-1 rounded-full transition-colors duration-300 ${index <= stepIndex ? "bg-sky-500" : "bg-slate-200"}`} />
            ))}
          </div>

          <AnimatePresence mode="wait">
              {step === "service" ? (
                <motion.div key="service" {...stepMotion} className="flex flex-1 flex-col">
                  <h2 className="text-lg font-semibold text-slate-950">What would you like to book?</h2>
                  <div className="mt-4 space-y-2.5">
                    {info.sessionTypes.map((type) => (
                      <motion.button
                        key={type.id}
                        type="button"
                        whileTap={{ scale: 0.985 }}
                        onClick={() => setSessionTypeId(type.id)}
                        className={`flex w-full items-center justify-between rounded-2xl border px-4 py-3.5 text-left transition ${
                          sessionTypeId === type.id ? "border-sky-500 bg-sky-50/70 ring-1 ring-sky-400" : "border-slate-200/80 bg-white/70 hover:border-slate-300 hover:bg-white"
                        }`}
                      >
                        <span>
                          <span className="block text-sm font-semibold text-slate-900">{type.name}</span>
                          {type.description ? <span className="mt-0.5 block text-xs text-slate-500">{type.description}</span> : null}
                        </span>
                        <span className="flex shrink-0 items-center gap-1.5 text-xs font-medium text-slate-500"><Clock3 className="h-3.5 w-3.5" />{type.durationMinutes} min</span>
                      </motion.button>
                    ))}
                    {!info.sessionTypes.length ? <p className="text-sm text-slate-400">No bookable services right now.</p> : null}
                  </div>

                  {meetingModeOptions.length > 1 ? (
                    <>
                      <p className="mt-5 text-sm font-medium text-slate-700">How would you like to meet?</p>
                      <div className="mt-2 grid grid-cols-2 gap-2">
                        {meetingModeOptions.map(({ id, label, icon: Icon, disabled }) => (
                          <motion.button
                            key={id}
                            type="button"
                            disabled={disabled}
                            whileTap={{ scale: 0.97 }}
                            onClick={() => setMeetingMode(id)}
                            className={`flex items-center justify-center gap-2 rounded-2xl border px-4 py-3 text-sm font-semibold transition ${
                              meetingMode === id ? "border-sky-600 bg-sky-600 text-white shadow-[0_10px_25px_rgba(2,132,199,0.35)]" : "border-slate-200/80 bg-white/70 text-slate-700 hover:border-slate-300"
                            } disabled:opacity-40`}
                          >
                            <Icon className="h-4 w-4" /> {label}
                          </motion.button>
                        ))}
                      </div>
                    </>
                  ) : null}

                  {selectableConsultants.length > 1 ? (
                    <div className="mt-5"><p className="text-sm font-medium text-slate-700">Consultant preference <span className="font-normal text-slate-400">(optional)</span></p><div className="mt-2 grid gap-2 sm:grid-cols-2"><button type="button" onClick={() => { setConsultantId(""); setSlot(null); }} className={`rounded-2xl border px-3 py-3 text-left transition ${!consultantId ? "border-sky-500 bg-sky-50 ring-1 ring-sky-400" : "border-slate-200/80 bg-white/70"}`}><span className="block text-sm font-semibold text-slate-900">First available</span><span className="block text-xs text-slate-400">Fastest matching consultant</span></button>{selectableConsultants.map((consultant) => <button key={consultant.id} type="button" onClick={() => { setConsultantId(consultant.id); setSlot(null); }} className={`rounded-2xl border px-3 py-3 text-left transition ${consultantId === consultant.id ? "border-sky-500 bg-sky-50 ring-1 ring-sky-400" : "border-slate-200/80 bg-white/70"}`}><span className="block text-sm font-semibold text-slate-900">{consultant.name}</span><span className="block text-xs text-slate-400">{consultant.title}{consultant.specializations?.length ? ` · ${consultant.specializations.slice(0, 2).join(", ")}` : ""}</span></button>)}</div></div>
                  ) : null}

                  <div className="flex-1" />
                  <motion.button
                    type="button"
                    whileTap={{ scale: 0.98 }}
                    disabled={!sessionTypeId || (meetingMode === "InPerson" && !selectableLocations.length)}
                    onClick={afterService}
                    className="mt-6 flex h-13 min-h-[52px] w-full items-center justify-center rounded-full bg-slate-950 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:opacity-40"
                  >
                    Continue
                  </motion.button>
                </motion.div>
              ) : step === "location" ? (
                <motion.div key="location" {...stepMotion} className="flex flex-1 flex-col">
                  <button type="button" onClick={() => setStep("service")} className="mb-4 flex w-fit items-center gap-1.5 text-sm font-medium text-slate-500 transition hover:text-slate-800">
                    <ArrowLeft className="h-4 w-4" /> Back
                  </button>
                  <h2 className="text-lg font-semibold text-slate-950">Select an office</h2>
                  <p className="mt-1 text-sm text-slate-500">Where would you like to meet in person?</p>
                  <div className="mt-4 space-y-2.5">
                    {selectableLocations.map((item) => (
                      <motion.div
                        key={item.id}
                        role="button"
                        tabIndex={0}
                        whileTap={{ scale: 0.985 }}
                        onClick={() => setLocationId(item.id)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            setLocationId(item.id);
                          }
                        }}
                        className={`flex w-full cursor-pointer items-start gap-3 rounded-2xl border px-4 py-3.5 text-left transition ${
                          locationId === item.id ? "border-sky-500 bg-sky-50/70 ring-1 ring-sky-400" : "border-slate-200/80 bg-white/70 hover:border-slate-300 hover:bg-white"
                        }`}
                      >
                        <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-sky-50 text-sky-600"><MapPin className="h-4 w-4" /></span>
                        <span className="min-w-0">
                          <span className="block text-sm font-semibold text-slate-900">{item.name}</span>
                          <span className="mt-0.5 block text-xs leading-5 text-slate-500">{item.address}</span>
                          {item.mapsUrl ? <a href={item.mapsUrl} target="_blank" rel="noopener noreferrer" onClick={(event) => event.stopPropagation()} className="mt-0.5 inline-block text-xs font-medium text-sky-600">View on map ↗</a> : null}
                        </span>
                      </motion.div>
                    ))}
                  </div>
                  <div className="flex-1" />
                  <motion.button type="button" whileTap={{ scale: 0.98 }} disabled={!locationId} onClick={() => setStep("time")} className="mt-6 flex min-h-[52px] w-full items-center justify-center rounded-full bg-slate-950 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:opacity-40">
                    Continue
                  </motion.button>
                </motion.div>
              ) : step === "time" ? (
                <motion.div key="time" {...stepMotion} className="flex min-h-0 flex-1 flex-col">
                  <div className="mb-4 flex items-center justify-between">
                    <button type="button" onClick={() => setStep(needsLocationStep ? "location" : "service")} className="flex items-center gap-1.5 text-sm font-medium text-slate-500 transition hover:text-slate-800">
                      <ArrowLeft className="h-4 w-4" /> Back
                    </button>
                    <p className="text-sm text-slate-500">{sessionType?.name} · {sessionType?.durationMinutes} min</p>
                  </div>
                  {error ? <p className="mb-3 rounded-2xl bg-rose-50 px-3.5 py-2.5 text-sm text-rose-700">{error}</p> : null}
                  <BookingMonthPicker
                    key={`${sessionTypeId}:${consultantId}`}
                    fetchAvailability={fetchAvailability}
                    initialSlot={slot}
                    timezone={info.timezone}
                    sessionType={sessionType}
                    agencyName={info.agencyName}
                    consultantName={consultantName}
                    onPickSlot={(picked) => {
                      setSlot(picked);
                      setError("");
                      setStep("details");
                    }}
                  />
                  {info.waitlistEnabled ? <button type="button" onClick={() => setStep("waitlist")} className="mt-4 shrink-0 text-sm font-semibold text-sky-700 transition hover:text-sky-900">Can’t find a suitable time? Join the waitlist</button> : null}
                </motion.div>
              ) : step === "waitlist" ? (
                <motion.div key="waitlist" {...stepMotion} className="flex flex-1 flex-col">
                  <button type="button" onClick={() => setStep("time")} className="mb-4 flex w-fit items-center gap-1.5 text-sm font-medium text-slate-500 transition hover:text-slate-800"><ArrowLeft className="h-4 w-4" /> Back</button>
                  <h2 className="text-lg font-semibold text-slate-950">Join the appointment waitlist</h2>
                  <p className="mt-1 text-sm leading-6 text-slate-500">Tell us who to contact and your preferred date range. The office can reach out when a matching time opens.</p>
                  <div className="mt-5 grid grid-cols-2 gap-3">
                    <label className="block text-xs font-medium text-slate-600">From<input type="date" value={waitlistDates.from} onChange={(event) => setWaitlistDates((current) => ({ ...current, from: event.target.value }))} className={`mt-1.5 ${inputClass}`} /></label>
                    <label className="block text-xs font-medium text-slate-600">To<input type="date" value={waitlistDates.to} onChange={(event) => setWaitlistDates((current) => ({ ...current, to: event.target.value }))} className={`mt-1.5 ${inputClass}`} /></label>
                  </div>
                  <div className="mt-4 space-y-3.5">
                    <label className="block text-xs font-medium text-slate-600">Full name<input required value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} className={`mt-1.5 ${inputClass}`} autoComplete="name" /></label>
                    <label className="block text-xs font-medium text-slate-600">Email<input required type="email" value={form.email} onChange={(event) => setForm((current) => ({ ...current, email: event.target.value }))} className={`mt-1.5 ${inputClass}`} autoComplete="email" /></label>
                    <label className="block text-xs font-medium text-slate-600">Phone (optional)<input value={form.phone} onChange={(event) => setForm((current) => ({ ...current, phone: event.target.value }))} className={`mt-1.5 ${inputClass}`} autoComplete="tel" /></label>
                  </div>
                  {error ? <p className="mt-3 rounded-2xl bg-rose-50 px-3.5 py-2.5 text-sm text-rose-700">{error}</p> : null}
                  <div className="flex-1" />
                  <button type="button" disabled={saving || !form.name.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)} onClick={joinWaitlist} className="mt-6 flex min-h-[52px] w-full items-center justify-center gap-2 rounded-full bg-slate-950 text-sm font-semibold text-white disabled:opacity-40">{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}{saving ? "Joining…" : "Join waitlist"}</button>
                </motion.div>
              ) : step === "details" ? (
                <motion.div key="details" {...stepMotion} className="flex flex-1 flex-col">
                  <button type="button" onClick={() => setStep("time")} className="mb-4 flex w-fit items-center gap-1.5 text-sm font-medium text-slate-500 transition hover:text-slate-800">
                    <ArrowLeft className="h-4 w-4" /> Back
                  </button>
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3.5 text-sm">
                    <p className="font-semibold text-slate-900">{sessionType?.name}</p>
                    <p className="mt-0.5 text-slate-500">
                      {new Date(slot.startsAt).toLocaleDateString("en-CA", { timeZone: info.timezone, weekday: "long", month: "long", day: "numeric" })} · {formatTime(slot.startsAt, info.timezone)}
                    </p>
                    <p className="mt-0.5 text-xs text-slate-400">
                      {meetingMode === "Online" ? "Online video call" : location ? `${location.name} · ${location.address}` : "In person"}
                    </p>
                    {requiresPayment ? (
                      <p className="mt-2 flex items-center gap-1.5 border-t border-slate-100 pt-2.5 text-xs font-semibold text-slate-600">
                        <Wallet className="h-3.5 w-3.5 text-sky-600" /> {Number(info.consultFeeAmount).toLocaleString("en-CA", { style: "currency", currency })} due to confirm — paid securely by card on the next step
                      </p>
                    ) : null}
                  </div>
                  <div className="mt-4 space-y-3.5">
                    <label className="absolute -left-[10000px] top-auto h-px w-px overflow-hidden" aria-hidden="true">Website
                      <input tabIndex={-1} autoComplete="off" value={form.website} onChange={(e) => setForm((c) => ({ ...c, website: e.target.value }))} />
                    </label>
                    <label className="block text-xs font-medium text-slate-600">Full name
                      <input required value={form.name} onChange={(e) => setForm((c) => ({ ...c, name: e.target.value }))} className={`mt-1.5 ${inputClass}`} autoComplete="name" />
                    </label>
                    <label className="block text-xs font-medium text-slate-600">Email
                      <input required type="email" value={form.email} onChange={(e) => { setForm((c) => ({ ...c, email: e.target.value })); setVerification({ id: "", code: "", token: "", sending: false, recognized: false, consultant: null }); }} className={`mt-1.5 ${inputClass}`} autoComplete="email" />
                    </label>
                    {/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email) ? <div className="rounded-2xl border border-sky-100 bg-sky-50/60 p-3">{verification.token ? <p className="flex items-center gap-2 text-xs font-semibold text-emerald-700"><CheckCircle2 className="h-4 w-4" /> Email verified{verification.recognized ? verification.consultant ? ` · Welcome back; ${verification.consultant.name} is preferred` : " · Welcome back" : ""}</p> : verification.id ? <div className="flex gap-2"><input inputMode="numeric" maxLength="6" value={verification.code} onChange={(event) => setVerification((current) => ({ ...current, code: event.target.value.replace(/\D/g, "").slice(0, 6) }))} placeholder="6-digit code" className={`${inputClass} !py-2`} /><button type="button" disabled={verification.sending || verification.code.length !== 6} onClick={verifyEmail} className="rounded-full bg-sky-600 px-4 text-xs font-semibold text-white disabled:opacity-40">Verify</button></div> : <button type="button" disabled={verification.sending} onClick={requestVerification} className="text-xs font-semibold text-sky-700">{verification.sending ? "Sending code…" : "Returning client? Verify email"}</button>}</div> : null}
                    <label className="block text-xs font-medium text-slate-600">Phone (optional)
                      <input value={form.phone} onChange={(e) => setForm((c) => ({ ...c, phone: e.target.value }))} className={`mt-1.5 ${inputClass}`} autoComplete="tel" />
                    </label>
                    <label className="block text-xs font-medium text-slate-600">What is your question? <span className="font-normal text-slate-400">Please share anything that will help prepare for our meeting.</span>
                      <textarea rows={2} value={form.notes} onChange={(e) => setForm((c) => ({ ...c, notes: e.target.value }))} className={`mt-1.5 resize-none ${inputClass}`} />
                    </label>
                  </div>
                  {error ? <p className="mt-3 rounded-2xl bg-rose-50 px-3.5 py-2.5 text-sm text-rose-700">{error}</p> : null}
                  <div className="flex-1" />
                  <div className="mt-5">
                    {form.name.trim() && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email) ? (
                      <>
                        <div className="lg:hidden"><SlideToConfirm onConfirm={submit} busy={saving} label={requiresPayment ? "Slide to continue to payment" : "Slide to confirm booking"} /></div>
                        <motion.button type="button" whileTap={{ scale: 0.98 }} disabled={saving} onClick={submit} className="hidden min-h-[52px] w-full items-center justify-center gap-2 rounded-full bg-slate-950 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:opacity-60 lg:flex">
                          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}{saving ? "Preparing…" : requiresPayment ? `Continue to payment · ${Number(info.consultFeeAmount).toLocaleString("en-CA", { style: "currency", currency })}` : "Confirm appointment"}
                        </motion.button>
                      </>
                    ) : (
                      <div className="flex h-14 items-center justify-center rounded-full bg-slate-200/80 text-sm font-semibold text-slate-400">
                        Enter your name and email to confirm
                      </div>
                    )}
                  </div>
                </motion.div>
              ) : step === "payment" ? (
                <motion.div key="payment" {...stepMotion} className="flex flex-1 flex-col items-center justify-center py-6 text-center">
                  {paymentHold?.status === "Expired" ? (
                    <>
                      <span className="flex h-16 w-16 items-center justify-center rounded-full bg-amber-100">
                        <Clock3 className="h-8 w-8 text-amber-600" />
                      </span>
                      <h2 className="mt-5 text-lg font-semibold text-slate-950">This time was released</h2>
                      <p className="mx-auto mt-1.5 max-w-[300px] text-sm leading-6 text-slate-500">Payment wasn't completed in time, so the slot was held for someone else. Pick another time to try again.</p>
                      <button type="button" onClick={() => { setPaymentHold(null); setStep("time"); setSlot(null); }} className="mt-5 inline-flex items-center gap-1.5 rounded-full bg-slate-950 px-5 py-3 text-sm font-semibold text-white transition hover:bg-slate-800">
                        Pick another time
                      </button>
                    </>
                  ) : (
                    <>
                      <motion.span initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: "spring", stiffness: 260, damping: 18 }} className="flex h-16 w-16 items-center justify-center rounded-full bg-sky-100">
                        <Wallet className="h-8 w-8 text-sky-600" />
                      </motion.span>
                      <h2 className="mt-5 text-lg font-semibold text-slate-950">
                        {Number(paymentHold?.amount ?? info.consultFeeAmount).toLocaleString("en-CA", { style: "currency", currency })} to confirm your appointment
                      </h2>
                      <p className="mx-auto mt-1.5 max-w-[300px] text-sm leading-6 text-slate-500">
                        Pay securely on QuickBooks — your time is held for the next {paymentHold?.expiresAt ? Math.max(1, Math.round((new Date(paymentHold.expiresAt).getTime() - Date.now()) / 60000)) : "a few"} minutes.
                      </p>
                      {paymentHold?.payNowUrl ? (
                        <a href={paymentHold.payNowUrl} target="_blank" rel="noopener noreferrer" className="mt-5 inline-flex items-center gap-2 rounded-full bg-sky-600 px-6 py-3.5 text-sm font-semibold text-white shadow-[0_14px_30px_rgba(2,132,199,0.35)] transition hover:bg-sky-700">
                          <Wallet className="h-4 w-4" /> Pay now on QuickBooks
                        </a>
                      ) : (
                        <p className="mt-5 rounded-2xl bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-800">Online payment isn't available right now. Please contact the office to complete this booking.</p>
                      )}
                      <p className="mt-5 flex items-center gap-2 text-xs text-slate-400"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Waiting for payment confirmation…</p>
                    </>
                  )}
                  {error ? <p className="mt-4 rounded-2xl bg-rose-50 px-3.5 py-2.5 text-sm text-rose-700">{error}</p> : null}
                </motion.div>
              ) : (
                <motion.div key="done" initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} className="flex flex-1 flex-col items-center justify-center py-6 text-center">
                  <motion.span initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: "spring", stiffness: 260, damping: 18 }} className="inline-flex">
                    <span className="flex h-20 w-20 items-center justify-center rounded-full bg-emerald-100">
                      <CheckCircle2 className="h-11 w-11 text-emerald-600" strokeWidth={1.7} />
                    </span>
                  </motion.span>
                  <h2 className="mt-5 text-xl font-semibold text-slate-950">{done?.waitlist ? "You’re on the waitlist" : "Appointment confirmed"}</h2>
                  <p className="mt-1.5 text-sm text-slate-500">{done?.waitlist ? "The office can contact you when a matching appointment opens." : <>{done?.subject} · {new Date(done?.startsAt).toLocaleDateString("en-CA", { timeZone: info.timezone, weekday: "long", month: "long", day: "numeric" })} at {formatTime(done?.startsAt, info.timezone)}</>}</p>
                  {!done?.waitlist && (done?.referenceCode || done?.assignedTo?.fullName) ? <div className="mt-3 flex flex-wrap justify-center gap-2 text-xs">{done.referenceCode ? <span className="rounded-full bg-slate-100 px-2.5 py-1 font-mono font-semibold text-slate-600">{done.referenceCode}</span> : null}{done.assignedTo?.fullName ? <span className="rounded-full bg-sky-50 px-2.5 py-1 font-semibold text-sky-700">With {done.assignedTo.fullName}</span> : null}</div> : null}

                  {done?.location ? (
                    <div className="mt-5 w-full max-w-[340px] rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3.5 text-left text-sm">
                      <p className="flex items-start gap-2.5 text-slate-700">
                        <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-sky-600" />
                        <span>{done.location}
                          <a href={done.locationMapsUrl || `https://maps.google.com/?q=${encodeURIComponent(done.location.split(" — ").pop())}`} target="_blank" rel="noopener noreferrer" className="mt-0.5 block text-xs font-semibold text-sky-600">Open in Maps ↗</a>
                        </span>
                      </p>
                    </div>
                  ) : null}
                  {done?.meetingUrl ? (
                    <a href={done.meetingUrl} target="_blank" rel="noopener noreferrer" className="mt-5 inline-flex items-center gap-2 rounded-full bg-sky-600 px-5 py-3 text-sm font-semibold text-white transition hover:bg-sky-700">
                      <Video className="h-4 w-4" /> Join link for your video call
                    </a>
                  ) : null}

                  {!done?.waitlist ? <p className="mx-auto mt-5 max-w-[330px] text-sm leading-6 text-slate-500">
                    A confirmation with all the details is on its way to your email{done?.location ? ", including the office address" : done?.meetingUrl ? ", including your join link" : ""}. Use the link in it to reschedule or cancel anytime.
                  </p> : null}
                  {!done?.waitlist ? <a href={`/book/manage/${done?.manageToken}`} className="mt-4 inline-block text-sm font-semibold text-sky-700 transition hover:text-sky-800">
                    Manage this booking →
                  </a> : null}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
    </main>
    {infoOpen ? createPortal(
      <div className="fixed inset-0 z-[9999] flex items-end justify-center bg-slate-950/45 p-0 backdrop-blur-sm sm:items-center sm:p-6" onMouseDown={() => setInfoOpen(false)}>
        <div role="dialog" aria-modal="true" aria-labelledby="about-info-title" onMouseDown={(event) => event.stopPropagation()} className="max-h-[85vh] w-full max-w-md overflow-y-auto rounded-t-[24px] bg-white p-6 shadow-[0_30px_100px_rgba(15,23,42,0.35)] sm:rounded-[24px]">
          <div className="flex items-start justify-between gap-3">
            {brandLogo("h-12 w-12 shrink-0 rounded-xl text-base")}
            <button type="button" onClick={() => setInfoOpen(false)} aria-label="Close" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-slate-400 transition hover:bg-slate-100 hover:text-slate-700">
              <X className="h-4 w-4" />
            </button>
          </div>
          <h2 id="about-info-title" className="mt-4 text-lg font-semibold text-slate-950">{info.agencyName}</h2>
          {info.publicWelcomeMessage ? <p className="mt-2 text-sm leading-6 text-slate-600">{info.publicWelcomeMessage}</p> : null}
          {contactBlock("mt-4 border-t border-slate-100 pt-4")}
          <p className="mt-4 text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">{signOff}</p>
          <div className="mt-4 border-t border-slate-100 pt-4">{legalLinks}</div>
        </div>
      </div>,
      document.body,
    ) : null}
    {cookieInfoOpen ? createPortal(
      <div className="fixed inset-0 z-[9999] flex items-end justify-center bg-slate-950/45 p-0 backdrop-blur-sm sm:items-center sm:p-6" onMouseDown={() => setCookieInfoOpen(false)}>
        <div role="dialog" aria-modal="true" aria-labelledby="cookie-info-title" onMouseDown={(event) => event.stopPropagation()} className="w-full max-w-md rounded-t-[24px] bg-white p-6 shadow-[0_30px_100px_rgba(15,23,42,0.35)] sm:rounded-[24px]">
          <h2 id="cookie-info-title" className="text-lg font-semibold text-slate-950">Cookies & storage</h2>
          <p className="mt-3 text-sm leading-6 text-slate-600">This booking page uses session storage only to preserve your in-progress booking if you refresh or navigate back. It does not use third-party advertising or analytics cookies.</p>
          <div className="mt-5 flex items-center justify-between gap-3">
            <a href="/legal/privacy" className="text-sm font-semibold text-sky-700">Read our Privacy Policy</a>
            <button type="button" onClick={() => setCookieInfoOpen(false)} className="rounded-full bg-slate-950 px-5 py-2.5 text-sm font-semibold text-white">Close</button>
          </div>
        </div>
      </div>,
      document.body,
    ) : null}
    </>
  );
}
