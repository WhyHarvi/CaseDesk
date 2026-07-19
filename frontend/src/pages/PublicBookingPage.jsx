import { AnimatePresence, motion, useMotionValue, useTransform } from "framer-motion";
import {
  ArrowLeft,
  ArrowRight,
  Building2,
  CalendarDays,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock3,
  ExternalLink,
  Globe2,
  Loader2,
  Mail,
  MapPin,
  Phone,
  Video,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { createPublicBooking, getPublicAvailability, getPublicBookingInfo, joinPublicBookingWaitlist, requestPublicBookingVerification, verifyPublicBookingEmail } from "../api/bookingApi";

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

function formatTime(value, timezone) {
  return new Date(value).toLocaleTimeString("en-CA", { timeZone: timezone, hour: "numeric", minute: "2-digit" });
}

function externalUrl(value) {
  return /^https?:\/\//i.test(value || "") ? value : `https://${value}`;
}

const glass = "rounded-[1.6rem] border border-white/70 bg-white/70 shadow-[0_18px_50px_rgba(15,23,42,0.10)] backdrop-blur-2xl";

/** Month calendar with available-day highlighting; slots render BELOW via onDaySelect. */
export function BookingMonthPicker({ fetchAvailability, onPickSlot, timezone }) {
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
    return Array.from({ length: 42 }, (_, index) => new Date(
      gridStart.getFullYear(),
      gridStart.getMonth(),
      gridStart.getDate() + index,
    ));
  }, [cursor]);

  const slots = selectedDay ? days[selectedDay] || [] : [];
  const todayKey = dateKey(new Date());

  return (
    <div>
      <div className="flex items-center justify-between">
        <AnimatePresence mode="wait">
          <motion.p key={cursor.toISOString()} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} className="text-base font-semibold text-slate-900">
            {cursor.toLocaleDateString("en-CA", { month: "long", year: "numeric" })}
          </motion.p>
        </AnimatePresence>
        <div className="flex items-center gap-1.5">
          <button type="button" aria-label="Previous month" onClick={() => { setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1)); setSelectedDay(null); setSelectedSlot(null); }} className="flex h-10 w-10 items-center justify-center rounded-full border border-slate-200/70 bg-white/80 text-slate-500 shadow-sm transition hover:bg-white active:scale-95">
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button type="button" aria-label="Next month" onClick={() => { setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1)); setSelectedDay(null); setSelectedSlot(null); }} className="flex h-10 w-10 items-center justify-center rounded-full border border-slate-200/70 bg-white/80 text-slate-500 shadow-sm transition hover:bg-white active:scale-95">
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-7 text-center">
        {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((label) => (
          <span key={label} className="pb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">{label}</span>
        ))}
        {cells.map((cell, index) => {
          const key = dateKey(cell);
          const inMonth = cell.getMonth() === cursor.getMonth();
          const available = (days[key] || []).length > 0;
          const isSelected = key === selectedDay;
          return (
            <span key={key} className="flex h-12 items-center justify-center">
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
                      ? "font-semibold text-slate-800 hover:bg-white"
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
      {loading ? <p className="mt-1 flex items-center gap-2 text-xs text-slate-400"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Checking availability…</p> : null}

      <AnimatePresence mode="wait">
        {selectedDay ? (
          <motion.div
            key={selectedDay}
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.28, ease: [0.32, 0.72, 0, 1] }}
            className="overflow-hidden"
          >
            <div className="mt-4 border-t border-slate-200/60 pt-4">
              <p className="text-sm font-semibold text-slate-900">
                {new Date(`${selectedDay}T12:00:00`).toLocaleDateString("en-CA", { weekday: "long", month: "long", day: "numeric" })}
              </p>
              <div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-4">
                {slots.map((slot, index) => (
                  <motion.button
                    key={slot.startsAt}
                    type="button"
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: Math.min(index * 0.02, 0.25), ...spring }}
                    whileTap={{ scale: 0.94 }}
                    onClick={() => { setSelectedSlot(slot); onPickSlot(slot); }}
                    className={`rounded-2xl border px-2 py-2.5 text-sm font-semibold transition-colors ${
                      selectedSlot?.startsAt === slot.startsAt
                        ? "border-sky-600 bg-sky-600 text-white shadow-[0_10px_24px_rgba(2,132,199,0.4)]"
                        : "border-slate-200/80 bg-white/80 text-slate-700 hover:border-sky-300 hover:bg-white"
                    }`}
                  >
                    {formatTime(slot.startsAt, timezone)}
                  </motion.button>
                ))}
                {!slots.length ? <p className="col-span-full text-sm text-slate-400">No times left on this day.</p> : null}
              </div>
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

export function PublicShell({ children, agencyName }) {
  return (
    <main className="min-h-[100dvh] bg-[radial-gradient(circle_at_15%_10%,rgba(56,130,246,0.14),transparent_38%),radial-gradient(circle_at_85%_85%,rgba(125,159,201,0.16),transparent_40%),linear-gradient(160deg,#f2f6fb_0%,#e7eef7_60%,#e2ebf5_100%)] px-4 py-6 sm:px-6 sm:py-10">
      <div className="mx-auto flex min-h-[calc(100dvh-3rem)] w-full max-w-xl flex-col justify-center sm:min-h-[calc(100dvh-5rem)]">
        {agencyName ? (
          <div className="mb-5 text-center">
            <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">Book with</p>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight text-slate-950">{agencyName}</h1>
          </div>
        ) : null}
        <motion.div initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }} className={`${glass} p-6 sm:p-8`}>
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
  const [verification, setVerification] = useState({ id: "", code: "", token: "", sending: false, recognized: false, consultant: null });
  const bookingKey = useRef(crypto.randomUUID());

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
  const needsLocationStep = meetingMode === "InPerson" && selectableLocations.length > 1;

  useEffect(() => {
    if (!sessionType?.allowedMeetingModes?.length || sessionType.allowedMeetingModes.includes(meetingMode)) return;
    setMeetingMode(sessionType.allowedMeetingModes[0]);
    setSlot(null);
  }, [sessionType, meetingMode]);

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

  async function submit() {
    if (saving) return;
    setSaving(true);
    setError("");
    try {
      const result = await createPublicBooking(token, {
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
      });
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
  const stepIndex = { service: 0, location: 1, time: 2, details: 3, waitlist: 3, done: 4 }[step];

  const summaryPanel = (
    <div className="flex flex-col">
      {agency.logoUrl ? (
        <img src={agency.logoUrl} alt={`${info.agencyName} logo`} className="h-16 w-16 rounded-2xl border border-white/80 bg-white object-contain p-1 shadow-[0_14px_30px_rgba(15,23,42,0.12)]" />
      ) : (
        <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-sky-500 to-indigo-600 text-lg font-bold text-white shadow-[0_14px_30px_rgba(56,130,246,0.35)]">{initials}</span>
      )}
      <h1 className="mt-4 text-xl font-semibold leading-7 tracking-tight text-slate-950">{info.agencyName}</h1>
      <p className="mt-1 text-sm text-slate-500">Immigration consultation booking</p>

      {(agencyAddress || agency.phone || agency.email || agency.website) ? (
        <div className="mt-6 space-y-3 border-y border-slate-200/70 py-5 text-sm text-slate-600">
          {agencyAddress ? <p className="flex items-start gap-2.5"><MapPin className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" /><span>{agencyAddress}</span></p> : null}
          {agency.phone ? <a href={`tel:${agency.phone}`} className="flex items-center gap-2.5 transition hover:text-sky-700"><Phone className="h-4 w-4 shrink-0 text-slate-400" />{agency.phone}</a> : null}
          {agency.email ? <a href={`mailto:${agency.email}`} className="flex items-center gap-2.5 break-all transition hover:text-sky-700"><Mail className="h-4 w-4 shrink-0 text-slate-400" />{agency.email}</a> : null}
          {agency.website ? <a href={externalUrl(agency.website)} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2.5 transition hover:text-sky-700"><Globe2 className="h-4 w-4 shrink-0 text-slate-400" /><span className="truncate">{agency.website.replace(/^https?:\/\//, "")}</span><ExternalLink className="h-3 w-3 shrink-0" /></a> : null}
        </div>
      ) : null}

      <div className="mt-6 space-y-3.5 text-sm text-slate-600">
        {sessionType ? (
          <p className="flex items-center gap-2.5"><Clock3 className="h-4 w-4 shrink-0 text-slate-400" />{sessionType.name} · {sessionType.durationMinutes} mins</p>
        ) : null}
        {meetingMode === "Online" ? (
          <p className="flex items-start gap-2.5"><Video className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />Video call details provided upon confirmation</p>
        ) : location ? (
          <p className="flex items-start gap-2.5"><MapPin className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" /><span>{location.name}<span className="block text-xs text-slate-400">{location.address}</span></span></p>
        ) : selectableLocations.length ? (
          <p className="flex items-center gap-2.5"><Building2 className="h-4 w-4 shrink-0 text-slate-400" />{selectableLocations.length} office location{selectableLocations.length > 1 ? "s" : ""}</p>
        ) : null}
        {slot ? (
          <p className="flex items-center gap-2.5"><CalendarDays className="h-4 w-4 shrink-0 text-slate-400" />{new Date(slot.startsAt).toLocaleDateString("en-CA", { timeZone: info.timezone, weekday: "short", month: "short", day: "numeric" })} · {formatTime(slot.startsAt, info.timezone)}</p>
        ) : null}
      </div>

      <div className="mt-6 hidden lg:block">
        <div className="flex gap-1.5">
          {[0, 1, 2, 3].map((index) => (
            <span key={index} className={`h-1 flex-1 rounded-full transition-colors duration-300 ${index <= stepIndex ? "bg-sky-500" : "bg-slate-200"}`} />
          ))}
        </div>
      </div>
    </div>
  );

  return (
    <main className="min-h-[100dvh] bg-[radial-gradient(circle_at_15%_10%,rgba(56,130,246,0.14),transparent_38%),radial-gradient(circle_at_85%_85%,rgba(125,159,201,0.16),transparent_40%),linear-gradient(160deg,#f2f6fb_0%,#e7eef7_60%,#e2ebf5_100%)]">
      <div className="mx-auto flex min-h-[100dvh] w-full max-w-6xl items-stretch p-3 sm:p-5 lg:items-center lg:p-6">
        <motion.div
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
          className={`${glass} grid min-h-[calc(100dvh-1.5rem)] w-full overflow-hidden sm:min-h-[calc(100dvh-2.5rem)] lg:h-[calc(100dvh-3rem)] lg:min-h-0 lg:grid-cols-[340px_1fr]`}
        >
          <aside className="hidden overflow-y-auto border-r border-white/60 bg-white/40 p-8 lg:block">{summaryPanel}</aside>

          <div className="flex min-h-0 flex-col overflow-y-auto p-5 sm:p-8">
            <div className="mb-5 flex items-center gap-3 lg:hidden">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-sky-500 to-indigo-600 text-sm font-bold text-white">{initials}</span>
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-slate-950">{info.agencyName}</p>
                <p className="text-xs text-slate-400">Immigration consultation booking</p>
              </div>
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

                  <p className="mt-5 text-sm font-medium text-slate-700">How would you like to meet?</p>
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    {[
                      { id: "InPerson", label: "In person", icon: MapPin, disabled: !selectableLocations.length || (sessionType?.allowedMeetingModes && !sessionType.allowedMeetingModes.includes("InPerson")) },
                      { id: "Online", label: "Online video call", icon: Video, disabled: sessionType?.allowedMeetingModes && !sessionType.allowedMeetingModes.includes("Online") },
                    ].map(({ id, label, icon: Icon, disabled }) => (
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
                <motion.div key="time" {...stepMotion} className="flex flex-1 flex-col">
                  <div className="mb-4 flex items-center justify-between">
                    <button type="button" onClick={() => setStep(needsLocationStep ? "location" : "service")} className="flex items-center gap-1.5 text-sm font-medium text-slate-500 transition hover:text-slate-800">
                      <ArrowLeft className="h-4 w-4" /> Back
                    </button>
                    <p className="text-sm text-slate-500">{sessionType?.name} · {sessionType?.durationMinutes} min</p>
                  </div>
                  <h2 className="mb-4 text-lg font-semibold text-slate-950">Select date and time</h2>
                  {error ? <p className="mb-3 rounded-2xl bg-rose-50 px-3.5 py-2.5 text-sm text-rose-700">{error}</p> : null}
                  <BookingMonthPicker key={`${sessionTypeId}:${consultantId}`} fetchAvailability={fetchAvailability} timezone={info.timezone} onPickSlot={(picked) => { setSlot(picked); setError(""); }} />
                  <div className="flex-1" />
                  <motion.button
                    type="button"
                    whileTap={{ scale: 0.98 }}
                    disabled={!slot}
                    onClick={() => setStep("details")}
                    className="mt-6 flex min-h-[52px] w-full items-center justify-center rounded-full bg-slate-950 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:opacity-40"
                  >
                    {slot ? `Continue with ${formatTime(slot.startsAt, info.timezone)}` : "Pick a time to continue"}
                  </motion.button>
                  {info.waitlistEnabled ? <button type="button" onClick={() => setStep("waitlist")} className="mt-3 text-sm font-semibold text-sky-700 transition hover:text-sky-900">Can’t find a suitable time? Join the waitlist</button> : null}
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
                  <div className={`${glass} !rounded-2xl px-4 py-3.5 text-sm`}>
                    <p className="font-semibold text-slate-900">{sessionType?.name}</p>
                    <p className="mt-0.5 text-slate-500">
                      {new Date(slot.startsAt).toLocaleDateString("en-CA", { timeZone: info.timezone, weekday: "long", month: "long", day: "numeric" })} · {formatTime(slot.startsAt, info.timezone)}
                    </p>
                    <p className="mt-0.5 text-xs text-slate-400">
                      {meetingMode === "Online" ? "Online video call" : location ? `${location.name} · ${location.address}` : "In person"}
                    </p>
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
                    <label className="block text-xs font-medium text-slate-600">Anything we should know? (optional)
                      <textarea rows={2} value={form.notes} onChange={(e) => setForm((c) => ({ ...c, notes: e.target.value }))} className={`mt-1.5 resize-none ${inputClass}`} />
                    </label>
                  </div>
                  {error ? <p className="mt-3 rounded-2xl bg-rose-50 px-3.5 py-2.5 text-sm text-rose-700">{error}</p> : null}
                  <div className="flex-1" />
                  <div className="mt-5">
                    {form.name.trim() && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email) ? (
                      <>
                        <div className="lg:hidden"><SlideToConfirm onConfirm={submit} busy={saving} label="Slide to confirm booking" /></div>
                        <motion.button type="button" whileTap={{ scale: 0.98 }} disabled={saving} onClick={submit} className="hidden min-h-[52px] w-full items-center justify-center gap-2 rounded-full bg-slate-950 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:opacity-60 lg:flex">
                          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}{saving ? "Booking…" : "Confirm appointment"}
                        </motion.button>
                      </>
                    ) : (
                      <div className="flex h-14 items-center justify-center rounded-full bg-slate-200/80 text-sm font-semibold text-slate-400">
                        Enter your name and email to confirm
                      </div>
                    )}
                  </div>
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
                    <div className={`${glass} mt-5 w-full max-w-[340px] !rounded-2xl px-4 py-3.5 text-left text-sm`}>
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
        </motion.div>
      </div>
    </main>
  );
}
