import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowLeft,
  Briefcase,
  Calendar,
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
  User,
  Video,
  Wallet,
  X,
} from "lucide-react";
import { gsap } from "gsap";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useParams, useSearchParams } from "react-router-dom";
import { createPublicBooking, createPublicBookingPaymentHold, getPublicAvailability, getPublicBookingAvatarUrl, getPublicBookingInfo, getPublicBookingPaymentHoldStatus, joinPublicBookingWaitlist, requestPublicBookingVerification, verifyPublicBookingEmail } from "../api/bookingApi";

const DAY_MS = 24 * 60 * 60 * 1000;
const spring = { type: "spring", stiffness: 380, damping: 32 };
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function startOfWeek(date) {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  copy.setDate(copy.getDate() - copy.getDay());
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

function externalUrl(value) {
  return /^https?:\/\//i.test(value || "") ? value : `https://${value}`;
}

/**
 * Month calendar with available-day highlighting; picking a slot fires
 * `onPickSlot` immediately (the calling page is responsible for its own
 * confirmation step, if it wants one — e.g. an accordion section that
 * collapses once a slot is chosen).
 */
export function BookingMonthPicker({ fetchAvailability, initialSlot, onPickSlot, timezone }) {
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
  const selectedDayLabel = selectedDay
    ? new Date(`${selectedDay}T12:00:00`).toLocaleDateString("en-CA", { weekday: "short", month: "short", day: "numeric" })
    : "";

  return (
    <div className="flex flex-col gap-8 sm:flex-row">
      <div className="shrink-0 sm:w-[340px]">
        <div className="flex items-center justify-between">
          <AnimatePresence mode="wait">
            <motion.p key={cursor.toISOString()} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} className="text-base font-semibold text-slate-900">
              {cursor.toLocaleDateString("en-CA", { month: "long", year: "numeric" })}
            </motion.p>
          </AnimatePresence>
          <div className="flex items-center gap-2">
            <button type="button" aria-label="Previous month" onClick={() => { setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1)); setSelectedDay(null); }} className="flex h-9 w-9 items-center justify-center rounded-full border border-slate-200 text-slate-500 transition hover:bg-sky-50">
              <ChevronLeft className="h-4 w-4" />
            </button>
            <button type="button" aria-label="Next month" onClick={() => { setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1)); setSelectedDay(null); }} className="flex h-9 w-9 items-center justify-center rounded-full border border-slate-200 text-slate-500 transition hover:bg-sky-50">
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="mt-5 grid grid-cols-7 gap-y-1 text-center">
          {["S", "M", "T", "W", "T", "F", "S"].map((label, index) => (
            <span key={`${label}-${index}`} className="pb-2 text-xs font-bold uppercase tracking-wide text-slate-400">{label}</span>
          ))}
          {cells.map((cell) => {
            const key = dateKey(cell);
            const inMonth = cell.getMonth() === cursor.getMonth();
            const available = (days[key] || []).length > 0;
            const isSelected = key === selectedDay;
            return (
              <span key={key} className="flex aspect-square items-center justify-center p-0.5">
                <motion.button
                  type="button"
                  disabled={!available}
                  initial={false}
                  animate={{ scale: isSelected ? 1.08 : 1 }}
                  transition={spring}
                  whileTap={available ? { scale: 0.9 } : undefined}
                  onClick={() => setSelectedDay(key)}
                  className={`relative flex h-full w-full items-center justify-center rounded-full text-sm font-medium transition-colors ${
                    isSelected
                      ? "bg-gradient-to-br from-sky-600 to-sky-400 text-white shadow-[0_6px_14px_rgba(2,132,199,0.4)]"
                      : available
                        ? "text-slate-800 hover:bg-sky-50"
                        : inMonth
                          ? "pointer-events-none text-slate-300 line-through decoration-slate-200"
                          : "pointer-events-none text-slate-200"
                  } ${key === todayKey && !isSelected ? "ring-1 ring-inset ring-sky-300" : ""}`}
                >
                  {cell.getDate()}
                  {available && !isSelected ? <span className="absolute bottom-1.5 h-1 w-1 rounded-full bg-sky-500 opacity-60" /> : null}
                </motion.button>
              </span>
            );
          })}
        </div>
        {loading ? <p className="mt-3 flex items-center gap-2 text-xs text-slate-400"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Checking availability…</p> : null}
      </div>

      <div className="min-w-0 flex-1">
        {!selectedDay ? (
          <p className="text-sm text-slate-400">Pick a date to see available times</p>
        ) : (
          <>
            <p className="text-sm text-slate-500">Times for <b className="font-semibold text-slate-900">{selectedDayLabel}</b> · {timezone}</p>
            <div className="mt-4 flex flex-wrap gap-2.5">
              {slots.map((slot, index) => (
                <motion.button
                  key={slot.startsAt}
                  type="button"
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: Math.min(index * 0.02, 0.25), ...spring }}
                  whileTap={{ scale: 0.94 }}
                  onClick={() => onPickSlot(slot)}
                  className="rounded-full border border-slate-200 bg-white px-5 py-3 text-sm font-semibold text-slate-700 transition-colors hover:border-sky-300 hover:bg-sky-50"
                >
                  {formatTime(slot.startsAt, timezone)}
                </motion.button>
              ))}
              {!slots.length ? <p className="py-4 text-[12.5px] italic text-slate-400">No times left this day — try another date.</p> : null}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export function PublicShell({ children, agencyName }) {
  return (
    <main className="flex min-h-[100dvh] flex-col items-center justify-center bg-slate-50 px-4 py-6 sm:px-6">
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

const inputClass = "w-full rounded-2xl border border-slate-200 bg-slate-50/60 px-3.5 py-3 text-base outline-none transition focus:border-sky-400 focus:bg-white focus:ring-2 focus:ring-sky-100 sm:text-sm";

function SummaryRow({ icon: Icon, label, value, empty }) {
  return (
    <div className="flex gap-3 border-b border-dashed border-slate-100 py-3 last:border-b-0">
      <span className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-[10px] bg-sky-50 text-sky-700"><Icon className="h-3.5 w-3.5" /></span>
      <span className="min-w-0">
        <span className="block text-[10.5px] font-bold uppercase tracking-wide text-slate-400">{label}</span>
        <span className={`block truncate text-[13px] font-semibold ${empty ? "font-normal italic text-slate-400" : "text-slate-900"}`}>{value}</span>
      </span>
    </div>
  );
}

function SectionShell({ index, title, sub, locked, active, done, onToggle, children, sectionRef }) {
  return (
    <div ref={sectionRef} className={`overflow-hidden rounded-[24px] rounded-bl-md border bg-white shadow-[0_2px_10px_rgba(15,23,42,0.06)] transition-all ${active ? "border-transparent shadow-[0_10px_30px_rgba(15,23,42,0.10),0_0_0_2px_rgba(2,132,199,0.16)]" : "border-slate-200"} ${locked ? "pointer-events-none opacity-45" : ""}`}>
      <button type="button" onClick={onToggle} className="flex w-full items-center gap-4 px-6 py-5 text-left sm:px-7">
        <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-sm font-bold transition-colors ${
          done ? "bg-emerald-500 text-white" : active ? "bg-gradient-to-br from-sky-600 to-sky-400 text-white shadow-[0_6px_16px_rgba(2,132,199,0.32)]" : "bg-sky-50 text-slate-400"
        }`}>
          {done ? <CheckCircle2 className="h-[18px] w-[18px]" strokeWidth={2.5} /> : index}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-base font-bold tracking-tight text-slate-900">{title}</span>
          {sub ? <span className="block truncate text-[13px] text-slate-500">{sub}</span> : null}
        </span>
      </button>
      <AnimatePresence initial={false}>
        {active ? (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.25, ease: [0.32, 0.72, 0, 1] }} className="overflow-hidden">
            <div className="border-t border-slate-100 px-6 pb-7 pt-5 sm:px-7">{children}</div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

export default function PublicBookingPage() {
  const { token } = useParams();
  const [searchParams] = useSearchParams();
  const offerToken = searchParams.get("offer") || "";
  const [info, setInfo] = useState(null);
  const [loadError, setLoadError] = useState("");
  const [step, setStep] = useState("booking");
  const [openSection, setOpenSection] = useState(1);
  const sectionRefs = useRef({});
  const scrollAreaRef = useRef(null);
  const [sessionTypeId, setSessionTypeId] = useState("");
  const [meetingMode, setMeetingMode] = useState("InPerson");
  const [locationId, setLocationId] = useState("");
  const [consultantId, setConsultantId] = useState("");
  const [slot, setSlot] = useState(null);
  const [form, setForm] = useState({ name: "", email: "", phone: "", notes: "", website: "" });
  const [consent, setConsent] = useState(false);
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
          setOpenSection(4);
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
    { id: "InPerson", label: "In person", sub: "Visit one of our offices", icon: MapPin, disabled: !selectableLocations.length || (sessionType?.allowedMeetingModes && !sessionType.allowedMeetingModes.includes("InPerson")) },
    { id: "Online", label: "Video call", sub: "Meet from anywhere", icon: Video, disabled: sessionType?.allowedMeetingModes && !sessionType.allowedMeetingModes.includes("Online") },
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

  useEffect(() => {
    if (meetingMode === "InPerson" && selectableLocations.length === 1 && locationId !== selectableLocations[0].id) {
      setLocationId(selectableLocations[0].id);
    }
  }, [meetingMode, selectableLocations, locationId]);

  useEffect(() => { setSlot(null); }, [sessionTypeId]);

  // Auto-advance the accordion the first time each section's requirement
  // is met — but only while that section is the one currently open, so
  // re-opening an earlier section to review it doesn't get yanked forward
  // again on every render.
  useEffect(() => {
    if (sessionTypeId && meetingMode) {
      setOpenSection((current) => (current === 1 ? (needsLocationStep ? 2 : 3) : current));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionTypeId, meetingMode]);
  useEffect(() => {
    if (locationId) setOpenSection((current) => (current === 2 ? 3 : current));
  }, [locationId]);
  useEffect(() => {
    if (slot) setOpenSection((current) => (current === 3 ? 4 : current));
  }, [slot]);

  // Bring the newly opened section fully into view — otherwise a tall
  // section (the calendar, most notably) can end up opening below the
  // fold of the scrollable content area with no visual cue to scroll.
  // Computed manually against the known scroll container (rather than
  // scrollIntoView, whose ancestor-scroll-chain walking was landing on
  // the section's still-collapsed height from the accordion's own
  // height:0-to-auto expand animation) and delayed past that ~250ms
  // expand transition so the measured position is the settled one.
  useEffect(() => {
    const container = scrollAreaRef.current;
    const target = sectionRefs.current[openSection];
    if (!container || !target) return undefined;
    const timer = setTimeout(() => {
      const containerRect = container.getBoundingClientRect();
      const targetRect = target.getBoundingClientRect();
      const offset = targetRect.top - containerRect.top + container.scrollTop;
      container.scrollTo({ top: Math.max(offset - 12, 0), behavior: "smooth" });
    }, 260);
    return () => clearTimeout(timer);
  }, [openSection]);

  const fetchAvailability = useCallback(
    (range) => getPublicAvailability(token, { sessionTypeId, consultantId, offerToken: offerToken || undefined, ...range }),
    [token, sessionTypeId, consultantId, offerToken],
  );

  const requiresPayment = Boolean(info?.consultFeeEnabled && Number(info?.consultFeeAmount) > 0);

  useEffect(() => {
    if (!info || !heroRef.current) return undefined;
    const context = gsap.context(() => {
      gsap.timeline({ defaults: { ease: "power3.out" } })
        .from("[data-booking-hero='topbar']", { opacity: 0, y: -10, duration: 0.4 })
        .from("[data-booking-hero='eyebrow']", { opacity: 0, y: 10, duration: 0.35 }, "-=0.15")
        .from("[data-booking-hero='title']", { opacity: 0, y: 10, duration: 0.4 }, "-=0.2");
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
      if (code === "SLOT_TAKEN") { setSlot(null); setOpenSection(3); }
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
  const currency = agency.defaultCurrency || "CAD";
  const bookingLogoUrl = agency.hasAvatar ? getPublicBookingAvatarUrl(token) : agency.logoUrl;
  const headline = info.publicHeadline || "Let's find you a time that works";
  const signOff = info.publicSignOffName || `TEAM — ${info.agencyName}`;
  const eyebrow = sessionType ? `${sessionType.name} · ${sessionType.durationMinutes} min${requiresPayment ? ` · ${Number(info.consultFeeAmount).toLocaleString("en-CA", { style: "currency", currency })}` : ""}` : "Consultation";

  const emailValid = EMAIL_PATTERN.test(form.email);
  const meetingReady = meetingMode === "Online" || (meetingMode === "InPerson" && (needsLocationStep ? Boolean(locationId) : true));
  const detailsReady = Boolean(form.name.trim() && emailValid && consent);
  const ready = Boolean(sessionTypeId && meetingReady && slot && detailsReady);

  const ringTotal = meetingMode === "Online" ? 3 : 4;
  let ringDone = 0;
  if (sessionTypeId && meetingMode) ringDone++;
  if (meetingMode === "InPerson" && locationId) ringDone++;
  if (slot) ringDone++;
  if (detailsReady) ringDone++;
  const ringCirc = 2 * Math.PI * 21;
  const ringOffset = ringCirc - (ringDone / ringTotal) * ringCirc;

  const brandLogo = (className) => bookingLogoUrl ? (
    <img src={bookingLogoUrl} alt={`${info.agencyName} logo`} className={`${className} border border-white/80 bg-white object-contain p-1 shadow-[0_10px_24px_rgba(2,132,199,0.18)]`} />
  ) : (
    <span className={`${className} flex items-center justify-center bg-gradient-to-br from-sky-600 to-sky-400 font-bold text-white shadow-[0_10px_24px_rgba(2,132,199,0.28)]`}>{initials}</span>
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
    <div className="flex h-[100dvh] flex-col overflow-hidden bg-slate-50">
      <div ref={scrollAreaRef} className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <div className="mx-auto w-full max-w-[1180px] px-4 py-6 sm:px-6 xl:max-w-[1320px] xl:px-8">

        <div ref={heroRef} className="shrink-0">
          <div data-booking-hero="topbar" className="mb-6 flex items-center justify-between gap-3 rounded-full border border-white/70 bg-white/80 px-6 py-3 shadow-[0_2px_10px_rgba(15,23,42,0.06)] backdrop-blur">
            <div className="flex min-w-0 items-center gap-3 font-extrabold tracking-tight text-slate-900">
              {brandLogo("h-9 w-9 shrink-0 rounded-[10px] text-xs")}
              <span className="truncate text-base">{info.agencyName}</span>
            </div>
            <div className="flex shrink-0 items-center gap-4 text-[13px] font-medium text-slate-500">
              <button type="button" onClick={() => setInfoOpen(true)} className="transition hover:text-sky-700">Need help?</button>
              <span className="hidden items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3.5 py-1.5 sm:flex">🌐 {info.timezone}</span>
            </div>
          </div>

          {step === "booking" ? (
            <div className="mb-6">
              <div data-booking-hero="eyebrow" className="mb-3 inline-flex items-center gap-1.5 rounded-full bg-sky-50 px-3.5 py-1.5 text-xs font-bold uppercase tracking-wide text-sky-700">
                {eyebrow}
              </div>
              <h1 data-booking-hero="title" className="text-2xl font-extrabold leading-tight tracking-tight text-slate-950 sm:text-[28px] xl:text-[32px]">{headline}</h1>
              {info.publicWelcomeMessage ? <p className="mt-1.5 max-w-xl text-[13.5px] leading-5 text-slate-500">{info.publicWelcomeMessage}</p> : null}
            </div>
          ) : null}
        </div>

        <AnimatePresence mode="wait">
          {step === "booking" ? (
            <motion.div key="booking" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="grid gap-8 lg:grid-cols-[1fr_360px] xl:grid-cols-[1fr_400px]">

              <div className="flex flex-col gap-5">
                {error ? <p className="rounded-2xl bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</p> : null}

                {/* SECTION 1 — meeting type */}
                <SectionShell
                  index={1}
                  title="How would you like to meet?"
                  sub={sessionTypeId && meetingMode ? `${meetingModeOptions.find((o) => o.id === meetingMode)?.label || ""}` : ""}
                  locked={false}
                  active={openSection === 1}
                  done={Boolean(sessionTypeId && meetingMode) && openSection !== 1}
                  onToggle={() => setOpenSection((current) => (current === 1 ? 0 : 1))}
                  sectionRef={(node) => { sectionRefs.current[1] = node; }}
                >
                  {info.sessionTypes.length > 1 ? (
                    <div className="mb-5 space-y-2">
                      {info.sessionTypes.map((type) => (
                        <button
                          key={type.id}
                          type="button"
                          onClick={() => setSessionTypeId(type.id)}
                          className={`flex w-full items-center justify-between rounded-2xl border px-5 py-4 text-left transition ${sessionTypeId === type.id ? "border-sky-500 bg-sky-50/70 ring-1 ring-sky-400" : "border-slate-200 bg-white hover:border-sky-300"}`}
                        >
                          <span>
                            <span className="block text-sm font-semibold text-slate-900">{type.name}</span>
                            {type.description ? <span className="mt-0.5 block text-xs text-slate-500">{type.description}</span> : null}
                          </span>
                          <span className="flex shrink-0 items-center gap-1.5 text-xs font-medium text-slate-500"><Clock3 className="h-3.5 w-3.5" />{type.durationMinutes} min</span>
                        </button>
                      ))}
                    </div>
                  ) : null}

                  <div className={`grid gap-4 ${meetingModeOptions.length > 1 ? "sm:grid-cols-2" : "grid-cols-1"}`}>
                    {meetingModeOptions.map(({ id, label, sub, icon: Icon, disabled }) => (
                      <motion.button
                        key={id}
                        type="button"
                        disabled={disabled}
                        whileTap={{ scale: 0.98 }}
                        onClick={() => setMeetingMode(id)}
                        className={`rounded-2xl border p-5 text-left transition disabled:opacity-40 ${meetingMode === id ? "border-transparent bg-gradient-to-b from-sky-50 to-white shadow-[0_0_0_2px_rgb(2,132,199)]" : "border-slate-200 bg-white hover:border-sky-300 hover:-translate-y-0.5"}`}
                      >
                        <span className="mb-3.5 flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-sky-600 to-sky-400 text-white shadow-[0_8px_18px_rgba(2,132,199,0.3)]"><Icon className="h-5 w-5" /></span>
                        <span className="block text-[15px] font-semibold text-slate-900">{label}</span>
                        <span className="block text-[13px] text-slate-500">{sub}</span>
                      </motion.button>
                    ))}
                  </div>

                  {selectableConsultants.length > 1 ? (
                    <div className="mt-5">
                      <p className="text-sm font-medium text-slate-700">Consultant preference <span className="font-normal text-slate-400">(optional)</span></p>
                      <div className="mt-2 grid gap-2 sm:grid-cols-2">
                        <button type="button" onClick={() => setConsultantId("")} className={`rounded-2xl border px-3 py-3 text-left transition ${!consultantId ? "border-sky-500 bg-sky-50 ring-1 ring-sky-400" : "border-slate-200 bg-white"}`}>
                          <span className="block text-sm font-semibold text-slate-900">First available</span>
                          <span className="block text-xs text-slate-400">Fastest matching consultant</span>
                        </button>
                        {selectableConsultants.map((consultant) => (
                          <button key={consultant.id} type="button" onClick={() => setConsultantId(consultant.id)} className={`rounded-2xl border px-3 py-3 text-left transition ${consultantId === consultant.id ? "border-sky-500 bg-sky-50 ring-1 ring-sky-400" : "border-slate-200 bg-white"}`}>
                            <span className="block text-sm font-semibold text-slate-900">{consultant.name}</span>
                            <span className="block text-xs text-slate-400">{consultant.title}{consultant.specializations?.length ? ` · ${consultant.specializations.slice(0, 2).join(", ")}` : ""}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </SectionShell>

                {/* SECTION 2 — office (only when relevant) */}
                {needsLocationStep ? (
                  <SectionShell
                    index={2}
                    title="Choose an office"
                    sub={location?.name || ""}
                    locked={!(sessionTypeId && meetingMode)}
                    active={openSection === 2}
                    done={Boolean(locationId) && openSection !== 2}
                    onToggle={() => setOpenSection((current) => (current === 2 ? 0 : 2))}
                    sectionRef={(node) => { sectionRefs.current[2] = node; }}
                  >
                    <div className="space-y-2.5">
                      {selectableLocations.map((item) => (
                        <button
                          key={item.id}
                          type="button"
                          onClick={() => setLocationId(item.id)}
                          className={`flex w-full items-center gap-4 rounded-2xl border px-5 py-4 text-left transition ${locationId === item.id ? "border-transparent bg-sky-50 shadow-[0_0_0_2px_rgb(2,132,199)]" : "border-slate-200 bg-white hover:border-sky-300"}`}
                        >
                          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-sky-50 text-sky-600"><MapPin className="h-4 w-4" /></span>
                          <span className="min-w-0 flex-1">
                            <span className="block text-sm font-semibold text-slate-900">{item.name}</span>
                            <span className="mt-0.5 block text-xs text-slate-500">{item.address}</span>
                          </span>
                          {item.mapsUrl ? <a href={item.mapsUrl} target="_blank" rel="noopener noreferrer" onClick={(event) => event.stopPropagation()} className="shrink-0 text-[11px] font-bold text-sky-600">Map ↗</a> : null}
                        </button>
                      ))}
                    </div>
                  </SectionShell>
                ) : null}

                {/* SECTION 3 — date & time */}
                <SectionShell
                  index={3}
                  title="Pick a date & time"
                  sub={slot ? `${new Date(slot.startsAt).toLocaleDateString("en-CA", { timeZone: info.timezone, weekday: "short", month: "short", day: "numeric" })} · ${formatTime(slot.startsAt, info.timezone)}` : ""}
                  locked={!(sessionTypeId && meetingMode && (!needsLocationStep || locationId))}
                  active={openSection === 3}
                  done={Boolean(slot) && openSection !== 3}
                  onToggle={() => setOpenSection((current) => (current === 3 ? 0 : 3))}
                  sectionRef={(node) => { sectionRefs.current[3] = node; }}
                >
                  <BookingMonthPicker
                    key={`${sessionTypeId}:${consultantId}`}
                    fetchAvailability={fetchAvailability}
                    initialSlot={slot}
                    timezone={info.timezone}
                    onPickSlot={(picked) => { setSlot(picked); setError(""); }}
                  />
                  {info.waitlistEnabled ? <button type="button" onClick={() => setStep("waitlist")} className="mt-4 text-sm font-semibold text-sky-700 transition hover:text-sky-900">Can't find a suitable time? Join the waitlist</button> : null}
                </SectionShell>

                {/* SECTION 4 — details */}
                <SectionShell
                  index={4}
                  title="Your details"
                  sub={detailsReady ? `${form.name} · ${form.email}` : ""}
                  locked={!slot}
                  active={openSection === 4}
                  done={detailsReady && openSection !== 4}
                  onToggle={() => setOpenSection((current) => (current === 4 ? 0 : 4))}
                  sectionRef={(node) => { sectionRefs.current[4] = node; }}
                >
                  <label className="absolute -left-[10000px] top-auto h-px w-px overflow-hidden" aria-hidden="true">Website
                    <input tabIndex={-1} autoComplete="off" value={form.website} onChange={(e) => setForm((c) => ({ ...c, website: e.target.value }))} />
                  </label>
                  <div className="grid gap-3.5 sm:grid-cols-2">
                    <label className="block text-xs font-medium text-slate-600">Full name
                      <input required value={form.name} onChange={(e) => setForm((c) => ({ ...c, name: e.target.value }))} className={`mt-1.5 ${inputClass}`} autoComplete="name" placeholder="Sam Rivera" />
                    </label>
                    <label className="block text-xs font-medium text-slate-600">Email
                      <input required type="email" value={form.email} onChange={(e) => { setForm((c) => ({ ...c, email: e.target.value })); setVerification({ id: "", code: "", token: "", sending: false, recognized: false, consultant: null }); }} className={`mt-1.5 ${inputClass}`} autoComplete="email" placeholder="sam@email.com" />
                    </label>
                  </div>
                  {emailValid ? (
                    <div className="mt-3.5 rounded-2xl border border-sky-100 bg-sky-50/60 p-3">
                      {verification.token ? (
                        <p className="flex items-center gap-2 text-xs font-semibold text-emerald-700"><CheckCircle2 className="h-4 w-4" /> Email verified{verification.recognized ? verification.consultant ? ` · Welcome back; ${verification.consultant.name} is preferred` : " · Welcome back" : ""}</p>
                      ) : verification.id ? (
                        <div className="flex gap-2">
                          <input inputMode="numeric" maxLength="6" value={verification.code} onChange={(event) => setVerification((current) => ({ ...current, code: event.target.value.replace(/\D/g, "").slice(0, 6) }))} placeholder="6-digit code" className={`${inputClass} !py-2`} />
                          <button type="button" disabled={verification.sending || verification.code.length !== 6} onClick={verifyEmail} className="rounded-full bg-sky-600 px-4 text-xs font-semibold text-white disabled:opacity-40">Verify</button>
                        </div>
                      ) : (
                        <button type="button" disabled={verification.sending} onClick={requestVerification} className="text-xs font-semibold text-sky-700">{verification.sending ? "Sending code…" : "Returning client? Verify email"}</button>
                      )}
                    </div>
                  ) : null}
                  <div className="mt-3.5 grid gap-3.5 sm:grid-cols-2">
                    <label className="block text-xs font-medium text-slate-600">Phone
                      <input value={form.phone} onChange={(e) => setForm((c) => ({ ...c, phone: e.target.value }))} className={`mt-1.5 ${inputClass}`} autoComplete="tel" placeholder="(416) 555-0148" />
                    </label>
                    <label className="block text-xs font-medium text-slate-600">Reason <span className="font-normal text-slate-400">(optional)</span>
                      <input value={form.notes} onChange={(e) => setForm((c) => ({ ...c, notes: e.target.value }))} className={`mt-1.5 ${inputClass}`} placeholder="What would help us prepare?" />
                    </label>
                  </div>
                  <label className="mt-4 flex items-start gap-2.5 text-xs text-slate-500">
                    <input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} className="mt-0.5" />
                    I agree to {info.agencyName}'s cancellation policy and consent to be contacted about this booking.
                  </label>
                </SectionShell>
              </div>

              {/* SUMMARY SIDEBAR */}
              <div className="lg:sticky lg:top-6 lg:self-start">
                <div className="rounded-[24px] rounded-bl-md border border-slate-200 bg-gradient-to-b from-white to-sky-50/40 p-7 shadow-[0_10px_30px_rgba(15,23,42,0.10)]">
                  <div className="mb-5 flex items-center gap-3.5">
                    <svg viewBox="0 0 50 50" className="h-[50px] w-[50px] shrink-0">
                      <circle cx="25" cy="25" r="21" stroke="#e0f2fe" fill="none" strokeWidth="5" />
                      <circle cx="25" cy="25" r="21" stroke="url(#booking-progress-gradient)" fill="none" strokeWidth="5" strokeLinecap="round" strokeDasharray={ringCirc} strokeDashoffset={ringOffset} transform="rotate(-90 25 25)" style={{ transition: "stroke-dashoffset .5s ease" }} />
                      <defs><linearGradient id="booking-progress-gradient" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stopColor="#0284c7" /><stop offset="100%" stopColor="#38bdf8" /></linearGradient></defs>
                    </svg>
                    <div>
                      <p className="text-[15px] font-extrabold text-slate-900">{ringDone} / {ringTotal}</p>
                      <p className="text-xs text-slate-500">steps complete</p>
                    </div>
                  </div>

                  <SummaryRow icon={Briefcase} label="Meeting type" empty={!sessionTypeId || !meetingMode} value={sessionTypeId && meetingMode ? `${meetingMode === "InPerson" ? "In person" : "Video call"}${meetingMode === "InPerson" && location ? ` — ${location.name}` : ""}` : "Not selected"} />
                  <SummaryRow icon={Calendar} label="Date & time" empty={!slot} value={slot ? `${new Date(slot.startsAt).toLocaleDateString("en-CA", { timeZone: info.timezone, weekday: "short", month: "short", day: "numeric" })} · ${formatTime(slot.startsAt, info.timezone)}` : "Not selected"} />
                  <SummaryRow icon={User} label="Your details" empty={!detailsReady} value={detailsReady ? `${form.name} · ${form.email}` : "Not entered"} />

                  <motion.button
                    type="button"
                    whileTap={{ scale: 0.98 }}
                    disabled={!ready || saving}
                    onClick={submit}
                    className={`mt-5 flex min-h-[52px] w-full items-center justify-center gap-2 rounded-full text-sm font-semibold transition ${ready && !saving ? "bg-gradient-to-r from-sky-600 to-sky-500 text-white shadow-[0_12px_28px_rgba(2,132,199,0.32)] hover:-translate-y-0.5" : "bg-slate-100 text-slate-400"}`}
                  >
                    {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                    {saving ? "Preparing…" : requiresPayment ? `Continue to payment${ready ? " →" : ""}` : `Confirm appointment${ready ? " →" : ""}`}
                  </motion.button>
                </div>

                <div className="mt-6 flex justify-center gap-5 text-[11px] font-semibold text-slate-400">
                  <span className="flex items-center gap-1.5"><Wallet className="h-3.5 w-3.5" />Secure &amp; confidential</span>
                  <span className="flex items-center gap-1.5"><Clock3 className="h-3.5 w-3.5" />Easy rescheduling</span>
                </div>
              </div>
            </motion.div>
          ) : step === "waitlist" ? (
            <motion.div key="waitlist" initial={{ opacity: 0, x: 24 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -24 }} className="mx-auto max-w-xl rounded-[24px] rounded-bl-md border border-slate-200 bg-white p-6 shadow-[0_10px_30px_rgba(15,23,42,0.08)] sm:p-8">
              <button type="button" onClick={() => setStep("booking")} className="mb-4 flex w-fit items-center gap-1.5 text-sm font-medium text-slate-500 transition hover:text-slate-800"><ArrowLeft className="h-4 w-4" /> Back</button>
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
              <button type="button" disabled={saving || !form.name.trim() || !EMAIL_PATTERN.test(form.email)} onClick={joinWaitlist} className="mt-6 flex min-h-[52px] w-full items-center justify-center gap-2 rounded-full bg-gradient-to-r from-sky-600 to-sky-500 text-sm font-semibold text-white disabled:opacity-40">{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}{saving ? "Joining…" : "Join waitlist"}</button>
            </motion.div>
          ) : step === "payment" ? (
            <motion.div key="payment" initial={{ opacity: 0, x: 24 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -24 }} className="mx-auto max-w-[520px]">
              <div className="mb-7 flex items-center justify-between gap-3 rounded-full border border-slate-200 bg-sky-50/60 px-5 py-2.5 text-[12.5px]">
                <b className="font-bold text-slate-800">{sessionType?.name} · {slot ? `${new Date(slot.startsAt).toLocaleDateString("en-CA", { month: "short", day: "numeric" })}, ${formatTime(slot.startsAt, info.timezone)}` : ""}</b>
                <button type="button" onClick={() => { setPaymentHold(null); setStep("booking"); }} className="shrink-0 font-bold text-sky-700">Edit</button>
              </div>
              {paymentHold?.status === "Expired" ? (
                <div className="rounded-[24px] rounded-bl-md border border-slate-200 bg-white p-8 text-center shadow-[0_10px_30px_rgba(15,23,42,0.08)]">
                  <h2 className="text-lg font-semibold text-slate-950">This time was released</h2>
                  <p className="mx-auto mt-1.5 max-w-[300px] text-sm leading-6 text-slate-500">Payment wasn't completed in time, so the slot was held for someone else. Pick another time to try again.</p>
                  <button type="button" onClick={() => { setPaymentHold(null); setStep("booking"); setSlot(null); setOpenSection(3); }} className="mt-5 w-full rounded-full bg-gradient-to-r from-sky-600 to-sky-500 px-5 py-3 text-sm font-semibold text-white">Pick another time</button>
                </div>
              ) : (
                <div className="relative overflow-hidden rounded-[24px] rounded-bl-md border border-slate-200 bg-white p-8 shadow-[0_10px_30px_rgba(15,23,42,0.08)]">
                  <div className="pointer-events-none absolute -right-16 -top-16 h-40 w-40 rounded-full bg-sky-100/60 blur-2xl" />
                  <div className="mb-2 inline-flex items-center rounded-full bg-sky-50 px-3.5 py-1.5 text-[11.5px] font-bold uppercase tracking-wide text-sky-700">Confirm &amp; pay</div>
                  <p className="text-[28px] font-extrabold tracking-tight text-slate-950">{Number(paymentHold?.amount ?? info.consultFeeAmount).toLocaleString("en-CA", { style: "currency", currency })}</p>
                  <p className="mb-6 text-[12.5px] text-slate-500">Pay securely on QuickBooks — your time is held for the next {paymentHold?.expiresAt ? Math.max(1, Math.round((new Date(paymentHold.expiresAt).getTime() - Date.now()) / 60000)) : "a few"} minutes.</p>
                  {paymentHold?.payNowUrl ? (
                    <a href={paymentHold.payNowUrl} target="_blank" rel="noopener noreferrer" className="flex items-center justify-center gap-2 rounded-full bg-gradient-to-r from-sky-600 to-sky-500 px-6 py-3.5 text-sm font-semibold text-white shadow-[0_12px_28px_rgba(2,132,199,0.32)] transition hover:-translate-y-0.5">
                      <Wallet className="h-4 w-4" /> Pay now on QuickBooks
                    </a>
                  ) : (
                    <p className="rounded-2xl bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-800">Online payment isn't available right now. Please contact the office to complete this booking.</p>
                  )}
                  <p className="mt-5 flex items-center justify-center gap-2 text-xs text-slate-400"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Waiting for payment confirmation…</p>
                </div>
              )}
              {error ? <p className="mt-4 rounded-2xl bg-rose-50 px-3.5 py-2.5 text-sm text-rose-700">{error}</p> : null}
            </motion.div>
          ) : (
            <motion.div key="done" initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} className="mx-auto max-w-[440px] py-6 text-center">
              <motion.span initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: "spring", stiffness: 260, damping: 18 }} className="inline-flex">
                <span className="flex h-20 w-20 items-center justify-center rounded-[22px] bg-gradient-to-br from-sky-600 to-sky-400 shadow-[0_12px_28px_rgba(2,132,199,0.32)]">
                  <CheckCircle2 className="h-10 w-10 text-white" strokeWidth={2} />
                </span>
              </motion.span>
              <h2 className="mt-5 text-xl font-semibold text-slate-950">{done?.waitlist ? "You're on the waitlist" : "Appointment confirmed"}</h2>
              <p className="mt-1.5 text-sm text-slate-500">{done?.waitlist ? "The office can contact you when a matching appointment opens." : <>{done?.subject} · {new Date(done?.startsAt).toLocaleDateString("en-CA", { timeZone: info.timezone, weekday: "long", month: "long", day: "numeric" })} at {formatTime(done?.startsAt, info.timezone)}</>}</p>
              {!done?.waitlist && (done?.referenceCode || done?.assignedTo?.fullName) ? <div className="mt-3 flex flex-wrap justify-center gap-2 text-xs">{done.referenceCode ? <span className="rounded-full bg-slate-100 px-2.5 py-1 font-mono font-semibold text-slate-600">{done.referenceCode}</span> : null}{done.assignedTo?.fullName ? <span className="rounded-full bg-sky-50 px-2.5 py-1 font-semibold text-sky-700">With {done.assignedTo.fullName}</span> : null}</div> : null}

              {done?.location ? (
                <div className="mt-5 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3.5 text-left text-sm shadow-[0_2px_10px_rgba(15,23,42,0.06)]">
                  <p className="flex items-start gap-2.5 text-slate-700">
                    <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-sky-600" />
                    <span>{done.location}
                      <a href={done.locationMapsUrl || `https://maps.google.com/?q=${encodeURIComponent(done.location.split(" — ").pop())}`} target="_blank" rel="noopener noreferrer" className="mt-0.5 block text-xs font-semibold text-sky-600">Open in Maps ↗</a>
                    </span>
                  </p>
                </div>
              ) : null}
              {done?.meetingUrl ? (
                <a href={done.meetingUrl} target="_blank" rel="noopener noreferrer" className="mt-5 inline-flex items-center gap-2 rounded-full bg-gradient-to-r from-sky-600 to-sky-500 px-5 py-3 text-sm font-semibold text-white transition hover:-translate-y-0.5">
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
    </div>
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
          <h2 id="cookie-info-title" className="text-lg font-semibold text-slate-950">Cookies &amp; storage</h2>
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
