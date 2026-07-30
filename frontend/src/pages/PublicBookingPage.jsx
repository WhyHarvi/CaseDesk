import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowLeft,
  Calendar,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Globe2,
  Loader2,
  MapPin,
  Phone,
  Video,
  Wallet,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useParams, useSearchParams } from "react-router-dom";
import {
  createPublicBooking,
  createPublicBookingPaymentHold,
  getPublicAvailability,
  getPublicBookingAvatarUrl,
  getPublicBookingInfo,
  getPublicBookingPaymentHoldStatus,
  joinPublicBookingWaitlist,
  requestPublicBookingVerification,
  verifyPublicBookingEmail,
} from "../api/bookingApi";

const DAY_MS = 24 * 60 * 60 * 1000;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const springy = { type: "spring", stiffness: 420, damping: 30 };
const cardHover = {
  whileHover: { scale: 1.015, y: -1 },
  whileTap: { scale: 0.98 },
  transition: springy,
};
const stepTransition = {
  initial: { opacity: 0, x: 14 },
  animate: { opacity: 1, x: 0 },
  exit: { opacity: 0, x: -10 },
  transition: { duration: 0.28, ease: [0.32, 0.72, 0, 1] },
};
const listStagger = { animate: { transition: { staggerChildren: 0.05 } } };
const listItem = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0 },
  transition: springy,
};

function paymentHoldStorageKey(token) {
  return `casedesk:booking-payment:${token}`;
}

function readPendingPayment(token) {
  try {
    const value = JSON.parse(
      sessionStorage.getItem(paymentHoldStorageKey(token)) || "null",
    );
    return value?.claimToken ? value : null;
  } catch {
    return null;
  }
}

function savePendingPayment(token, payment) {
  try {
    sessionStorage.setItem(
      paymentHoldStorageKey(token),
      JSON.stringify(payment),
    );
  } catch {
    /* The status endpoint and confirmation messages remain the fallback. */
  }
}

function clearPendingPayment(token) {
  try {
    sessionStorage.removeItem(paymentHoldStorageKey(token));
  } catch {
    /* No-op when browser storage is unavailable. */
  }
}

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
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  })
    .formatToParts(new Date(value))
    .reduce((result, part) => ({ ...result, [part.type]: part.value }), {});
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function formatTime(value, timezone) {
  return new Date(value).toLocaleTimeString("en-CA", {
    timeZone: timezone,
    hour: "numeric",
    minute: "2-digit",
  });
}

// "10:26pm" / "22:26" — no space before am/pm, matching the reference copy style.
function formatClock(date, timezone, use24h) {
  if (use24h) {
    return new Intl.DateTimeFormat("en-GB", {
      timeZone: timezone,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(date);
  }
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).formatToParts(date);
  const hour = parts.find((part) => part.type === "hour")?.value || "";
  const minute = parts.find((part) => part.type === "minute")?.value || "";
  const dayPeriod = (
    parts.find((part) => part.type === "dayPeriod")?.value || ""
  )
    .toLowerCase()
    .replace(/\./g, "");
  return `${hour}:${minute}${dayPeriod}`;
}

// Derives a human timezone name ("Eastern Standard Time") from the
// agency's real IANA zone instead of hardcoding one tenant's label.
function timezoneLongLabel(timezone, date) {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      timeZoneName: "long",
    }).formatToParts(date);
    return (
      parts.find((part) => part.type === "timeZoneName")?.value || timezone
    );
  } catch {
    return timezone;
  }
}

/**
 * Month calendar with available-day highlighting; picking a slot fires
 * `onPickSlot` immediately (the calling page is responsible for its own
 * confirmation step, if it wants one). Shared with the reschedule page.
 */
export function BookingMonthPicker({
  fetchAvailability,
  initialSlot,
  onPickSlot,
  timezone,
}) {
  const initialDay = initialSlot?.startsAt
    ? zonedDateKey(initialSlot.startsAt, timezone)
    : null;
  const [cursor, setCursor] = useState(() => {
    const startingDate = initialDay
      ? new Date(`${initialDay}T12:00:00`)
      : new Date();
    return new Date(startingDate.getFullYear(), startingDate.getMonth(), 1);
  });
  const [days, setDays] = useState({});
  const [loading, setLoading] = useState(true);
  const [selectedDay, setSelectedDay] = useState(initialDay);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const gridStart = startOfWeek(
        new Date(cursor.getFullYear(), cursor.getMonth(), 1),
      );
      const gridEnd = new Date(gridStart.getTime() + 41 * DAY_MS);
      const result = await fetchAvailability({
        from: dateKey(gridStart),
        to: dateKey(gridEnd),
      });
      setDays(result.days || {});
    } catch {
      setDays({});
    } finally {
      setLoading(false);
    }
  }, [cursor, fetchAvailability]);

  useEffect(() => {
    load();
  }, [load]);

  const cells = useMemo(() => {
    const gridStart = startOfWeek(
      new Date(cursor.getFullYear(), cursor.getMonth(), 1),
    );
    return Array.from(
      { length: 42 },
      (_, index) =>
        new Date(
          gridStart.getFullYear(),
          gridStart.getMonth(),
          gridStart.getDate() + index,
        ),
    );
  }, [cursor]);

  const slots = selectedDay ? days[selectedDay] || [] : [];
  const todayKey = dateKey(new Date());
  const selectedDayLabel = selectedDay
    ? new Date(`${selectedDay}T12:00:00`).toLocaleDateString("en-CA", {
        weekday: "short",
        month: "short",
        day: "numeric",
      })
    : "";

  return (
    <div className="flex flex-col gap-8 sm:flex-row">
      <div className="shrink-0 sm:w-[340px]">
        <div className="flex items-center justify-between">
          <AnimatePresence mode="wait">
            <motion.p
              key={cursor.toISOString()}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              className="text-base font-semibold text-slate-900"
            >
              {cursor.toLocaleDateString("en-CA", {
                month: "long",
                year: "numeric",
              })}
            </motion.p>
          </AnimatePresence>
          <div className="flex items-center gap-2">
            <motion.button
              type="button"
              aria-label="Previous month"
              whileHover={{ scale: 1.1 }}
              whileTap={{ scale: 0.9 }}
              onClick={() => {
                setCursor(
                  new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1),
                );
                setSelectedDay(null);
              }}
              className="flex h-9 w-9 items-center justify-center rounded-full border border-slate-200 text-slate-500 transition-colors hover:bg-sky-50"
            >
              <ChevronLeft className="h-4 w-4" />
            </motion.button>
            <motion.button
              type="button"
              aria-label="Next month"
              whileHover={{ scale: 1.1 }}
              whileTap={{ scale: 0.9 }}
              onClick={() => {
                setCursor(
                  new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1),
                );
                setSelectedDay(null);
              }}
              className="flex h-9 w-9 items-center justify-center rounded-full border border-slate-200 text-slate-500 transition-colors hover:bg-sky-50"
            >
              <ChevronRight className="h-4 w-4" />
            </motion.button>
          </div>
        </div>

        <div className="mt-5 grid grid-cols-7 gap-y-1 text-center">
          {["S", "M", "T", "W", "T", "F", "S"].map((label, index) => (
            <span
              key={`${label}-${index}`}
              className="pb-2 text-xs font-bold uppercase tracking-wide text-slate-400"
            >
              {label}
            </span>
          ))}
          {cells.map((cell) => {
            const key = dateKey(cell);
            const inMonth = cell.getMonth() === cursor.getMonth();
            const available = (days[key] || []).length > 0;
            const isSelected = key === selectedDay;
            return (
              <span
                key={key}
                className="flex aspect-square items-center justify-center p-0.5"
              >
                <motion.button
                  type="button"
                  disabled={!available}
                  initial={false}
                  animate={{ scale: isSelected ? 1.08 : 1 }}
                  transition={{ type: "spring", stiffness: 380, damping: 32 }}
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
                  {available && !isSelected ? (
                    <span className="absolute bottom-1.5 h-1 w-1 rounded-full bg-sky-500 opacity-60" />
                  ) : null}
                </motion.button>
              </span>
            );
          })}
        </div>
        {loading ? (
          <p className="mt-3 flex items-center gap-2 text-xs text-slate-400">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Checking
            availability…
          </p>
        ) : null}
      </div>

      <div className="min-w-0 flex-1">
        {!selectedDay ? (
          <p className="text-sm text-slate-400">
            Pick a date to see available times
          </p>
        ) : (
          <>
            <p className="text-sm text-slate-500">
              Times for{" "}
              <b className="font-semibold text-slate-900">{selectedDayLabel}</b>{" "}
              · {timezone}
            </p>
            <div className="mt-4 flex flex-wrap gap-2.5">
              {slots.map((slot, index) => (
                <motion.button
                  key={slot.startsAt}
                  type="button"
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{
                    delay: Math.min(index * 0.02, 0.25),
                    type: "spring",
                    stiffness: 380,
                    damping: 32,
                  }}
                  whileTap={{ scale: 0.94 }}
                  onClick={() => onPickSlot(slot)}
                  className="flex items-center gap-2 rounded-full border border-slate-200 bg-white px-5 py-3 text-sm font-semibold text-slate-700 transition-colors hover:border-sky-300 hover:bg-sky-50"
                >
                  <span>{formatTime(slot.startsAt, timezone)}</span>
                  {Number(slot.capacity) > 1 ? (
                    <span className="rounded-full bg-sky-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-sky-700">
                      {slot.capacity} available
                    </span>
                  ) : null}
                </motion.button>
              ))}
              {!slots.length ? (
                <p className="py-4 text-[12.5px] italic text-slate-400">
                  No times left this day — try another date.
                </p>
              ) : null}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export function PublicShell({ children, agencyName, fullWidth = false }) {
  return (
    <main className="flex min-h-[100dvh] w-full flex-col items-center justify-center bg-slate-50 px-4 py-6 sm:px-6">
      <div
        className={`w-full transition-[max-width] duration-500 ease-out ${
          fullWidth ? "max-w-none" : "max-w-xl"
        }`}
      >
        {agencyName ? (
          <div className="mb-5 text-center">
            <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">
              Book with
            </p>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight text-slate-950">
              {agencyName}
            </h1>
          </div>
        ) : null}
        <motion.div
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
          className="w-full rounded-2xl border border-slate-200 bg-white p-6 sm:p-8"
        >
          {children}
        </motion.div>
        <p className="mt-5 text-center text-xs text-slate-400">
          Powered by CaseDesk
        </p>
      </div>
    </main>
  );
}

function LoadingDots() {
  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-[#F9F9FA]">
      <div className="flex items-end gap-1.5">
        <span
          className="h-2 w-2 animate-pulse rounded-full bg-[#1A1F36]"
          style={{ animationDuration: "1.4s" }}
        />
        <span
          className="h-2.5 w-2.5 animate-pulse rounded-full bg-[#1A1F36]"
          style={{ animationDuration: "1.4s", animationDelay: "0.15s" }}
        />
        <span
          className="h-2 w-2 animate-pulse rounded-full bg-[#1A1F36]"
          style={{ animationDuration: "1.4s", animationDelay: "0.3s" }}
        />
      </div>
    </div>
  );
}

const inputClass =
  "w-full rounded-md border border-[#E5E7EB] bg-white px-3.5 py-2.5 text-sm text-[#1A1F36] outline-none transition focus:border-[#006BFF] focus:ring-2 focus:ring-[#006BFF]/15";

/**
 * Step 1 of the public flow: a month calendar beside a time-slot list
 * that slides in once a date is picked. Picking a slot doesn't advance
 * immediately — it highlights and reveals a "Next" button beside it,
 * so the guest gets one deliberate confirmation tap before moving on.
 */
function CalendlyTimeStep({
  fetchAvailability,
  initialSlot,
  timezone,
  timeFormat24h,
  onFormatChange,
  onConfirm,
  waitlistEnabled,
  onWaitlist,
}) {
  const initialDay = initialSlot?.startsAt
    ? zonedDateKey(initialSlot.startsAt, timezone)
    : null;
  const [cursor, setCursor] = useState(() => {
    const startingDate = initialDay
      ? new Date(`${initialDay}T12:00:00`)
      : new Date();
    return new Date(startingDate.getFullYear(), startingDate.getMonth(), 1);
  });
  const [days, setDays] = useState({});
  const [loading, setLoading] = useState(true);
  const [selectedDay, setSelectedDay] = useState(initialDay);
  const [pendingSlot, setPendingSlot] = useState(initialSlot || null);
  const [tzPopoverOpen, setTzPopoverOpen] = useState(false);
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 30000);
    return () => clearInterval(timer);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const gridStart = startOfWeek(
        new Date(cursor.getFullYear(), cursor.getMonth(), 1),
      );
      const gridEnd = new Date(gridStart.getTime() + 41 * DAY_MS);
      const result = await fetchAvailability({
        from: dateKey(gridStart),
        to: dateKey(gridEnd),
      });
      setDays(result.days || {});
    } catch {
      setDays({});
    } finally {
      setLoading(false);
    }
  }, [cursor, fetchAvailability]);

  useEffect(() => {
    load();
  }, [load]);

  const cells = useMemo(() => {
    const gridStart = startOfWeek(
      new Date(cursor.getFullYear(), cursor.getMonth(), 1),
    );
    return Array.from(
      { length: 42 },
      (_, index) =>
        new Date(
          gridStart.getFullYear(),
          gridStart.getMonth(),
          gridStart.getDate() + index,
        ),
    );
  }, [cursor]);

  const slots = selectedDay ? days[selectedDay] || [] : [];
  const todayKey = dateKey(new Date());
  const selectedDayLabel = selectedDay
    ? new Date(`${selectedDay}T12:00:00`).toLocaleDateString("en-US", {
        weekday: "long",
        month: "long",
        day: "numeric",
      })
    : "";
  const tzLabel = timezoneLongLabel(timezone, now);

  return (
    <div>
      <h2 className="text-[17px] font-bold text-[#1A1F36]">
        Select a Date &amp; Time
      </h2>
      <div className="mt-5 flex flex-col sm:flex-row">
        <div className="shrink-0 sm:w-[300px] sm:border-r sm:border-[#E5E7EB] sm:pr-7">
          <div className="flex items-center justify-between">
            <motion.button
              type="button"
              aria-label="Previous month"
              whileHover={{ scale: 1.12 }}
              whileTap={{ scale: 0.88 }}
              onClick={() => {
                setCursor(
                  new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1),
                );
                setSelectedDay(null);
                setPendingSlot(null);
              }}
              className="flex h-8 w-8 items-center justify-center rounded-full text-[#4D5865] transition-colors hover:bg-slate-100"
            >
              <ChevronLeft className="h-4 w-4" />
            </motion.button>
            <AnimatePresence mode="wait">
              <motion.p
                key={cursor.toISOString()}
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.15 }}
                className="text-sm font-bold text-[#1A1F36]"
              >
                {cursor.toLocaleDateString("en-US", {
                  month: "long",
                  year: "numeric",
                })}
              </motion.p>
            </AnimatePresence>
            <motion.button
              type="button"
              aria-label="Next month"
              whileHover={{ scale: 1.12 }}
              whileTap={{ scale: 0.88 }}
              onClick={() => {
                setCursor(
                  new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1),
                );
                setSelectedDay(null);
                setPendingSlot(null);
              }}
              className="flex h-8 w-8 items-center justify-center rounded-full text-[#4D5865] transition-colors hover:bg-slate-100"
            >
              <ChevronRight className="h-4 w-4" />
            </motion.button>
          </div>
          <div className="mt-3 grid grid-cols-7 text-center">
            {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((label) => (
              <span
                key={label}
                className="pb-2 text-[11px] font-semibold text-[#6B7280]"
              >
                {label.slice(0, 1)}
              </span>
            ))}
            {cells.map((cell) => {
              const key = dateKey(cell);
              const inMonth = cell.getMonth() === cursor.getMonth();
              const available = (days[key] || []).length > 0;
              const isSelected = key === selectedDay;
              return (
                <span
                  key={key}
                  className="flex aspect-square items-center justify-center p-0.5"
                >
                  <motion.button
                    type="button"
                    disabled={!available}
                    initial={false}
                    animate={{ scale: isSelected ? 1.08 : 1 }}
                    transition={springy}
                    whileHover={
                      available && !isSelected ? { scale: 1.1 } : undefined
                    }
                    whileTap={available ? { scale: 0.88 } : undefined}
                    onClick={() => {
                      setSelectedDay(key);
                      setPendingSlot(null);
                    }}
                    className={`relative flex h-full w-full items-center justify-center rounded-full text-[13px] font-medium transition-colors ${
                      isSelected
                        ? "bg-[#006BFF] text-white"
                        : available
                          ? "text-[#1A1F36] hover:bg-[#E8F1FF]"
                          : inMonth
                            ? "pointer-events-none text-[#C4C9D4]"
                            : "pointer-events-none text-[#E5E7EB]"
                    }`}
                  >
                    {cell.getDate()}
                    {available && !isSelected ? (
                      <span className="absolute bottom-1 h-1 w-1 rounded-full bg-[#006BFF]" />
                    ) : null}
                  </motion.button>
                </span>
              );
            })}
          </div>
          {loading ? (
            <p className="mt-3 flex items-center gap-2 text-xs text-[#6B7280]">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Checking
              availability…
            </p>
          ) : null}
        </div>

        {/* Fixed-width column, always mounted — only its content swaps when
            a date is picked, so nothing in the layout resizes or shifts. */}
        <div className="mt-6 min-w-0 flex-1 sm:mt-0 sm:pl-7">
          <AnimatePresence mode="wait">
            {!selectedDay ? (
              <motion.div
                key="empty"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="flex h-full min-h-[220px] items-center justify-center text-center"
              >
                <p className="text-sm text-[#6B7280]">
                  Select a date to see available times
                </p>
              </motion.div>
            ) : (
              <motion.div
                key={selectedDay}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.2 }}
              >
                <p className="text-sm font-bold text-[#1A1F36]">
                  {selectedDayLabel}
                </p>
                <motion.div
                  initial="initial"
                  animate="animate"
                  variants={listStagger}
                  className="mt-3 max-h-[380px] space-y-2 overflow-y-auto pr-1"
                >
                  {slots.map((slot) => {
                    const isPending = pendingSlot?.startsAt === slot.startsAt;
                    return (
                      <motion.div
                        key={slot.startsAt}
                        variants={listItem}
                        className="flex items-center gap-2"
                      >
                        <motion.button
                          type="button"
                          whileHover={!isPending ? { scale: 1.015 } : undefined}
                          whileTap={{ scale: 0.97 }}
                          onClick={() =>
                            setPendingSlot(isPending ? null : slot)
                          }
                          className={`flex flex-1 items-center justify-between gap-3 rounded-md border px-4 py-2.5 text-sm font-semibold transition-colors ${
                            isPending
                              ? "border-[#E5E7EB] bg-[#F3F4F6] text-[#6B7280]"
                              : "border-[#006BFF] text-[#006BFF] hover:bg-[#E8F1FF]"
                          }`}
                        >
                          <span>
                            {formatClock(
                              new Date(slot.startsAt),
                              timezone,
                              timeFormat24h,
                            )}
                          </span>
                          {Number(slot.capacity) > 1 ? (
                            <span
                              className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
                                isPending
                                  ? "bg-white text-[#6B7280]"
                                  : "bg-[#E8F1FF] text-[#0057CC]"
                              }`}
                            >
                              {slot.capacity} available
                            </span>
                          ) : null}
                        </motion.button>
                        {isPending ? (
                          <motion.button
                            initial={{ opacity: 0, scale: 0.85, width: 0 }}
                            animate={{ opacity: 1, scale: 1, width: "auto" }}
                            transition={springy}
                            whileHover={{ scale: 1.03 }}
                            whileTap={{ scale: 0.95 }}
                            type="button"
                            onClick={() => onConfirm(slot)}
                            className="rounded-md bg-[#006BFF] px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#0057CC]"
                          >
                            Next
                          </motion.button>
                        ) : null}
                      </motion.div>
                    );
                  })}
                  {!slots.length ? (
                    <p className="py-4 text-sm italic text-[#6B7280]">
                      No times left this day — try another date.
                    </p>
                  ) : null}
                </motion.div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      <div className="relative mt-6 border-t border-[#E5E7EB] pt-4">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-[#6B7280]">
          Time zone
        </p>
        <motion.button
          type="button"
          whileHover={{ x: 2 }}
          onClick={() => setTzPopoverOpen((open) => !open)}
          className="mt-1.5 flex items-center gap-2 text-sm font-medium text-[#1A1F36]"
        >
          <Globe2 className="h-4 w-4 text-[#6B7280]" />
          {tzLabel}
          <span className="text-[#6B7280]">
            ({formatClock(now, timezone, timeFormat24h)})
          </span>
          <motion.span
            animate={{ rotate: tzPopoverOpen ? 180 : 0 }}
            transition={{ duration: 0.2 }}
          >
            <ChevronDown className="h-3.5 w-3.5 text-[#6B7280]" />
          </motion.span>
        </motion.button>
        <AnimatePresence>
          {tzPopoverOpen ? (
            <motion.div
              initial={{ opacity: 0, y: 6, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 6, scale: 0.97 }}
              transition={{ duration: 0.15 }}
              className="absolute bottom-full left-0 z-10 mb-2 w-72 rounded-lg border border-[#E5E7EB] bg-white p-4 text-center shadow-[0_10px_30px_rgba(15,23,42,0.12)]"
            >
              <p className="text-xs text-[#6B7280]">
                Available times locked to
              </p>
              <p className="mt-1 text-sm font-semibold text-[#1A1F36]">
                {tzLabel} ({formatClock(now, timezone, timeFormat24h)})
              </p>
              <div className="my-3 border-t border-[#E5E7EB]" />
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-bold uppercase tracking-wide text-[#6B7280]">
                  Time format
                </span>
                <motion.button
                  type="button"
                  aria-label="Toggle 24-hour time"
                  whileTap={{ scale: 0.92 }}
                  onClick={() => onFormatChange(!timeFormat24h)}
                  className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${timeFormat24h ? "bg-[#006BFF]" : "bg-[#CBD5E1]"}`}
                >
                  <motion.span
                    animate={{ left: timeFormat24h ? 22 : 2 }}
                    transition={springy}
                    className="absolute top-0.5 h-5 w-5 rounded-full bg-white shadow"
                  />
                </motion.button>
              </div>
              <p className="mt-1 text-right text-[10px] text-[#6B7280]">
                {timeFormat24h ? "24-hour" : "am/pm"}
              </p>
            </motion.div>
          ) : null}
        </AnimatePresence>
      </div>
      {waitlistEnabled ? (
        <button
          type="button"
          onClick={onWaitlist}
          className="mt-4 text-sm font-semibold text-[#006BFF] transition hover:text-[#0057CC]"
        >
          Can't find a suitable time? Join the waitlist
        </button>
      ) : null}
    </div>
  );
}

export default function PublicBookingPage() {
  const { token } = useParams();
  const [searchParams] = useSearchParams();
  const offerToken = searchParams.get("offer") || "";
  const pendingPaymentAtLoad = useRef(readPendingPayment(token)).current;
  const [info, setInfo] = useState(null);
  const [loadError, setLoadError] = useState("");
  const [step, setStep] = useState(pendingPaymentAtLoad ? "payment" : "format");
  const [sessionTypeId, setSessionTypeId] = useState("");
  const [meetingMode, setMeetingMode] = useState("");
  const [locationId, setLocationId] = useState("");
  const [consultantId, setConsultantId] = useState("");
  const [slot, setSlot] = useState(null);
  const [form, setForm] = useState({
    name: "",
    email: "",
    phone: "",
    notes: "",
    website: "",
  });
  const [timeFormat24h, setTimeFormat24h] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(null);
  const [pendingPayment, setPendingPayment] = useState(pendingPaymentAtLoad);
  const [paymentChecking, setPaymentChecking] = useState(
    Boolean(pendingPaymentAtLoad),
  );
  const [paymentError, setPaymentError] = useState("");
  const [waitlistDates, setWaitlistDates] = useState(() => ({
    from: dateKey(new Date()),
    to: dateKey(new Date(Date.now() + 30 * DAY_MS)),
  }));
  const [verification, setVerification] = useState({
    id: "",
    code: "",
    token: "",
    sending: false,
    recognized: false,
    consultant: null,
  });
  const [cookieInfoOpen, setCookieInfoOpen] = useState(false);
  // Persisted per booking-page token so a reload/new-tab resend reuses the
  // same key instead of minting a fresh one — otherwise the backend's
  // idempotency check (agencyId + idempotencyKey) never catches a
  // reload-and-resubmit, only a same-page double-click.
  const bookingKey = useRef(
    (() => {
      const storageKey = `casedesk:booking-key:${token}`;
      try {
        const existing = sessionStorage.getItem(storageKey);
        if (existing) return existing;
        const fresh = crypto.randomUUID();
        sessionStorage.setItem(storageKey, fresh);
        return fresh;
      } catch {
        return crypto.randomUUID();
      }
    })(),
  );

  useEffect(() => {
    getPublicBookingInfo(token, offerToken)
      .then((data) => {
        setInfo(data);
        if (data.offerExpired)
          setError(
            "That reserved waitlist time has expired, but you can choose another available appointment.",
          );
        if (pendingPaymentAtLoad) return;
        if (data.offer) {
          setSessionTypeId(data.offer.sessionTypeId);
          setMeetingMode(data.offer.meetingMode);
          setLocationId(data.offer.locationId || "");
          setConsultantId(data.offer.consultantId);
          setForm((current) => ({
            ...current,
            name: data.offer.name,
            email: data.offer.email,
            phone: data.offer.phone || "",
          }));
          setSlot({ startsAt: data.offer.startsAt, endsAt: data.offer.endsAt });
          setStep("details");
          return;
        }
        if (data.sessionTypes.length === 1)
          setSessionTypeId(data.sessionTypes[0].id);
        if (data.consultants?.length === 1)
          setConsultantId(data.consultants[0].id);
      })
      .catch((reason) =>
        setLoadError(
          reason.response?.data?.message ||
            "This booking page is not available.",
        ),
      );
  }, [token, offerToken, pendingPaymentAtLoad]);

  useEffect(() => {
    try {
      const saved = JSON.parse(
        sessionStorage.getItem(`booking-draft:${token}`) || "null",
      );
      if (!saved || offerToken) return;
      if (saved.sessionTypeId) setSessionTypeId(saved.sessionTypeId);
      if (saved.meetingMode) setMeetingMode(saved.meetingMode);
      if (saved.locationId) setLocationId(saved.locationId);
      if (saved.form)
        setForm((current) => ({ ...current, ...saved.form, website: "" }));
    } catch {
      /* Ignore an invalid browser draft. */
    }
  }, [token, offerToken]);

  useEffect(() => {
    if (["done", "payment"].includes(step)) return;
    sessionStorage.setItem(
      `booking-draft:${token}`,
      JSON.stringify({
        sessionTypeId,
        meetingMode,
        locationId,
        form: {
          name: form.name,
          email: form.email,
          phone: form.phone,
          notes: form.notes,
        },
      }),
    );
  }, [token, step, sessionTypeId, meetingMode, locationId, form]);

  useEffect(() => {
    const claimToken = pendingPayment?.claimToken;
    if (!claimToken) return undefined;
    let stopped = false;
    let timer = null;

    async function checkPayment() {
      let keepPolling = true;
      try {
        const result = await getPublicBookingPaymentHoldStatus(
          token,
          claimToken,
        );
        if (stopped) return;
        const next = {
          ...pendingPayment,
          ...result,
          payNowUrl: result.payNowUrl || pendingPayment.payNowUrl || null,
        };
        setPendingPayment(next);
        savePendingPayment(token, next);
        setPaymentError("");

        if (result.appointment) {
          clearPendingPayment(token);
          try {
            sessionStorage.removeItem(`booking-draft:${token}`);
            sessionStorage.removeItem(`casedesk:booking-key:${token}`);
          } catch {
            /* No-op when browser storage is unavailable. */
          }
          setDone(result.appointment);
          setPendingPayment(null);
          setStep("done");
          keepPolling = false;
        } else if (
          result.requiresStaffResolution ||
          ["Expired", "Voided", "Failed"].includes(result.status)
        ) {
          keepPolling = false;
        }
      } catch (reason) {
        if (stopped) return;
        setPaymentError(
          reason.response?.data?.message ||
            "Payment status could not be checked. We will keep trying.",
        );
      } finally {
        if (!stopped) setPaymentChecking(false);
      }
      if (!stopped && keepPolling)
        timer = window.setTimeout(checkPayment, 5_000);
    }

    checkPayment();
    return () => {
      stopped = true;
      if (timer) window.clearTimeout(timer);
    };
  }, [token, pendingPayment?.claimToken]);

  const sessionType =
    info?.sessionTypes.find((type) => type.id === sessionTypeId) || null;
  const selectableLocations = sessionType?.allowedLocationIds?.length
    ? info.locations.filter((item) =>
        sessionType.allowedLocationIds.includes(item.id),
      )
    : info?.locations || [];
  const selectableConsultants = sessionType?.eligibleStaff?.length
    ? info.consultants.filter((item) =>
        sessionType.eligibleStaff.some(
          (eligible) => eligible.userId === item.id,
        ),
      )
    : info?.consultants || [];
  const location =
    selectableLocations.find((item) => item.id === locationId) || null;
  const sessionAllowsMode = (type, mode) =>
    Boolean(type) &&
    (!type.allowedMeetingModes?.length ||
      type.allowedMeetingModes.includes(mode));
  const sessionTypesForMode = (mode) =>
    (info?.sessionTypes || []).filter((type) => sessionAllowsMode(type, mode));
  const sessionTypeHasZoomStaff = (type) => {
    const eligibleIds = type?.eligibleStaff?.map((item) => item.userId) || [];
    return (info?.consultants || []).some(
      (item) =>
        item.zoomEnabled &&
        (!eligibleIds.length || eligibleIds.includes(item.id)),
    );
  };
  const compatibleSessionTypes = meetingMode
    ? sessionTypesForMode(meetingMode).filter(
        (type) => meetingMode !== "Zoom" || sessionTypeHasZoomStaff(type),
      )
    : [];
  const sessionTypeHasLocation = (type) =>
    (info?.locations || []).some(
      (item) =>
        !type.allowedLocationIds?.length ||
        type.allowedLocationIds.includes(item.id),
    );
  const meetingModeOptions = [
    {
      id: "InPerson",
      label: "In person",
      sub: "Visit one of our offices.",
      icon: MapPin,
      enabled: sessionTypesForMode("InPerson").some(sessionTypeHasLocation),
    },
    {
      id: "Phone",
      label: "Phone call",
      sub: info?.phoneCallerId
        ? `We will call you from ${info.phoneCallerId}.`
        : "We will call you at your number.",
      icon: Phone,
      enabled:
        info?.phoneBookingEnabled === true &&
        sessionTypesForMode("Phone").length > 0,
    },
    {
      id: "Online",
      label: "Jitsi video call",
      sub: "A secure Jitsi link will be emailed to you.",
      icon: Video,
      enabled:
        info?.onlineBookingEnabled !== false &&
        sessionTypesForMode("Online").length > 0,
    },
    {
      id: "Zoom",
      label: "Zoom video call",
      sub: "A Zoom join link will be emailed to you.",
      icon: Video,
      enabled:
        info?.zoomBookingEnabled === true &&
        sessionTypesForMode("Zoom").some(sessionTypeHasZoomStaff),
    },
  ].filter((option) => option.enabled);

  function pickMeetingMode(mode) {
    const matchingTypes = sessionTypesForMode(mode).filter(
      (type) => mode !== "Zoom" || sessionTypeHasZoomStaff(type),
    );
    setMeetingMode(mode);
    setSessionTypeId(matchingTypes.length === 1 ? matchingTypes[0].id : "");
    setLocationId("");
    setSlot(null);
    setStep(
      matchingTypes.length > 1
        ? "service"
        : mode === "InPerson"
          ? "location"
          : "time",
    );
  }

  function pickSessionType(type) {
    setSessionTypeId(type.id);
    setLocationId("");
    setSlot(null);
    setStep(meetingMode === "InPerson" ? "location" : "time");
  }

  function pickLocation(location) {
    setLocationId(location.id);
    setSlot(null);
    setStep("time");
  }

  // The calendar must never be reachable without a resolved location —
  // on reload, a restored draft can leave meetingMode set while step is
  // still "location" (fine, it just pre-highlights the matching option),
  // but if step ever ends up on "time" without meetingMode actually set,
  // bounce back rather than let the calendar show real, pickable slots
  // for no chosen location/mode.
  useEffect(() => {
    if (
      step === "time" &&
      (!meetingMode || (meetingMode === "InPerson" && !locationId))
    ) {
      setStep(meetingMode === "InPerson" ? "location" : "format");
    }
  }, [step, meetingMode, locationId]);

  useEffect(() => {
    if (
      consultantId &&
      !selectableConsultants.some((item) => item.id === consultantId)
    )
      setConsultantId("");
  }, [consultantId, selectableConsultants]);

  const fetchAvailability = useCallback(
    (range) =>
      getPublicAvailability(token, {
        sessionTypeId,
        consultantId,
        offerToken: offerToken || undefined,
        meetingMode,
        locationId:
          meetingMode === "InPerson" ? locationId || undefined : undefined,
        ...range,
      }),
    [token, sessionTypeId, consultantId, offerToken, meetingMode, locationId],
  );

  const requiresPayment = Boolean(
    info?.consultFeeEnabled && Number(info?.consultFeeAmount) > 0,
  );

  async function submit() {
    if (saving) return;
    setSaving(true);
    setError("");
    const payload = {
      sessionTypeId,
      startsAt: slot.startsAt,
      meetingMode,
      locationId:
        meetingMode === "InPerson"
          ? locationId || selectableLocations[0]?.id
          : undefined,
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
        // Keep the private claim token in this tab before leaving for
        // QuickBooks. If the client returns with Back/reloads this page,
        // the status endpoint reconciles the invoice and restores the
        // confirmed appointment without depending on the webhook.
        savePendingPayment(token, hold);
        setPendingPayment(hold);
        setPaymentChecking(true);
        setStep("payment");
        // An idempotent retry can briefly recover the already-created slot
        // hold while its first request is still saving the QuickBooks link.
        // Stay on the status screen and let the poller surface the link
        // instead of navigating to the literal value "null".
        if (hold.payNowUrl) window.location.assign(hold.payNowUrl);
        return;
      }
      const result = await createPublicBooking(token, payload);
      sessionStorage.removeItem(`booking-draft:${token}`);
      // Clear so a second, unrelated booking started later in this same tab
      // gets a fresh key — reusing this one would make the backend's
      // idempotency check silently return this same appointment instead of
      // creating the new one.
      sessionStorage.removeItem(`casedesk:booking-key:${token}`);
      setDone(result);
      setStep("done");
    } catch (reason) {
      const code = reason.response?.data?.code;
      setError(
        reason.response?.data?.message || "The booking could not be completed.",
      );
      if (code === "SLOT_TAKEN") {
        setSlot(null);
        setStep("time");
      }
    } finally {
      setSaving(false);
    }
  }

  function restartAfterClosedPayment() {
    clearPendingPayment(token);
    setPendingPayment(null);
    setPaymentError("");
    setSlot(null);
    const freshKey = crypto.randomUUID();
    bookingKey.current = freshKey;
    try {
      sessionStorage.setItem(`casedesk:booking-key:${token}`, freshKey);
    } catch {
      /* The backend still protects slot creation transactionally. */
    }
    setStep(
      meetingMode && (meetingMode !== "InPerson" || locationId)
        ? "time"
        : "format",
    );
  }

  async function requestVerification() {
    setVerification((current) => ({ ...current, sending: true }));
    setError("");
    try {
      const result = await requestPublicBookingVerification(token, form.email);
      setVerification({
        id: result.verificationId,
        code: "",
        token: "",
        sending: false,
        recognized: false,
        consultant: null,
      });
    } catch (reason) {
      setVerification((current) => ({ ...current, sending: false }));
      setError(
        reason.response?.data?.message ||
          "Verification email could not be sent.",
      );
    }
  }

  async function verifyEmail() {
    setVerification((current) => ({ ...current, sending: true }));
    setError("");
    try {
      const result = await verifyPublicBookingEmail(
        token,
        verification.id,
        verification.code,
      );
      // The verification token lets the backend prefer the client's prior
      // consultant while still assigning another eligible consultant when
      // that person is busy or unavailable for Zoom. Do not turn this into a
      // hard consultant filter in the browser.
      setVerification((current) => ({
        ...current,
        ...result,
        token: result.verificationToken,
        sending: false,
      }));
    } catch (reason) {
      setVerification((current) => ({ ...current, sending: false }));
      setError(
        reason.response?.data?.message || "Email could not be verified.",
      );
    }
  }

  async function joinWaitlist() {
    if (saving) return;
    setSaving(true);
    setError("");
    try {
      const result = await joinPublicBookingWaitlist(token, {
        sessionTypeId,
        consultantId: consultantId || undefined,
        meetingMode,
        locationId:
          meetingMode === "InPerson"
            ? locationId || selectableLocations[0]?.id
            : undefined,
        name: form.name,
        email: form.email,
        phone: form.phone,
        preferredFrom: waitlistDates.from,
        preferredTo: waitlistDates.to,
      });
      sessionStorage.removeItem(`booking-draft:${token}`);
      setDone({ waitlist: true, waitlistStatus: result.status });
      setStep("done");
    } catch (reason) {
      setError(
        reason.response?.data?.message ||
          "You could not be added to the waitlist.",
      );
    } finally {
      setSaving(false);
    }
  }

  if (loadError) {
    return (
      <PublicShell>
        <div className="py-10 text-center">
          <p className="text-lg font-semibold text-slate-900">
            Booking unavailable
          </p>
          <p className="mt-2 text-sm text-slate-500">{loadError}</p>
        </div>
      </PublicShell>
    );
  }

  if (!info) return <LoadingDots />;

  const initials = info.agencyName
    .split(" ")
    .filter(Boolean)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
  const agency = info.agency || { name: info.agencyName };
  const currency = agency.defaultCurrency || "CAD";
  const bookingLogoUrl = agency.hasAvatar
    ? getPublicBookingAvatarUrl(token)
    : agency.logoUrl;
  const headline =
    info.publicHeadline || "Schedule Your Personalized Consultation Now!";
  const welcomeMessage =
    info.publicWelcomeMessage ||
    `Thank you for choosing us. Please select a time for your consultation and come prepared with any questions — we look forward to assisting you.`;
  const signOff = info.publicSignOffName || `TEAM — ${info.agencyName}`;

  const emailValid = EMAIL_PATTERN.test(form.email);
  const detailsReady = Boolean(
    meetingMode &&
    (meetingMode !== "InPerson" || locationId) &&
    (meetingMode !== "Phone" || form.phone.trim()) &&
    form.name.trim() &&
    emailValid &&
    form.notes.trim(),
  );
  const ready = Boolean(sessionTypeId && slot && detailsReady);

  const brandLogo = (className) =>
    bookingLogoUrl ? (
      <img
        src={bookingLogoUrl}
        alt={`${info.agencyName} logo`}
        className={`${className} border border-white/80 bg-white object-contain p-1`}
      />
    ) : (
      <span
        className={`${className} flex items-center justify-center bg-gradient-to-br from-[#006BFF] to-[#3B93FF] font-bold text-white`}
      >
        {initials}
      </span>
    );

  const legalLinks = (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs font-medium text-[#006BFF]">
      <button
        type="button"
        onClick={() => setCookieInfoOpen(true)}
        className="underline-offset-2 transition hover:underline"
      >
        Cookie settings
      </button>
      <a
        href="/legal/privacy"
        className="underline-offset-2 transition hover:underline"
      >
        Privacy Policy
      </a>
    </div>
  );

  const twoStepFlow = [
    "format",
    "service",
    "location",
    "time",
    "details",
  ].includes(step);
  const backStep =
    step === "details"
      ? "time"
      : step === "time"
        ? meetingMode === "InPerson"
          ? "location"
          : compatibleSessionTypes.length > 1
            ? "service"
            : "format"
        : step === "location"
          ? compatibleSessionTypes.length > 1
            ? "service"
            : "format"
          : step === "service"
            ? "format"
            : null;

  const leftPanel = (
    <motion.div
      initial="initial"
      animate="animate"
      variants={listStagger}
      className="flex w-full shrink-0 flex-col border-b border-[#E5E7EB] p-7 sm:p-9 md:w-[330px] md:border-b-0 md:border-r"
    >
      <motion.div
        variants={listItem}
        className="flex flex-col items-center text-center"
      >
        {brandLogo("h-[72px] w-[72px] rounded-2xl text-2xl")}
      </motion.div>
      <motion.div
        variants={listItem}
        className="my-6 border-t border-[#E5E7EB]"
      />
      <motion.div variants={listItem} className="flex items-center gap-2.5">
        {brandLogo("h-9 w-9 shrink-0 rounded-lg text-xs")}
        <span className="text-xs font-medium text-[#6B7280]">
          {info.agencyName}
        </span>
      </motion.div>
      <motion.h1
        variants={listItem}
        className="mt-4 text-[19px] font-bold leading-snug text-[#1A1F36]"
      >
        {headline}
      </motion.h1>

      <motion.div
        variants={listItem}
        className="mt-4 space-y-2 text-sm text-[#4D5865]"
      >
        <AnimatePresence>
          {(step === "time" || step === "details") && meetingMode ? (
            <motion.p
              key="meta-location"
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="flex items-center gap-2.5"
            >
              {meetingMode === "InPerson" ? (
                <MapPin className="h-4 w-4 shrink-0 text-[#6B7280]" />
              ) : meetingMode === "Phone" ? (
                <Phone className="h-4 w-4 shrink-0 text-[#6B7280]" />
              ) : (
                <Video className="h-4 w-4 shrink-0 text-[#6B7280]" />
              )}
              {meetingMode === "InPerson"
                ? location?.name || "In person"
                : meetingMode === "Phone"
                  ? "Phone call"
                  : meetingMode === "Zoom"
                    ? "Zoom video call"
                    : "Jitsi video call"}
            </motion.p>
          ) : null}
          {step === "details" && slot ? (
            <motion.div
              key="meta-datetime"
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="space-y-2"
            >
              <p className="flex items-center gap-2.5">
                <Calendar className="h-4 w-4 shrink-0 text-[#6B7280]" />
                {formatClock(
                  new Date(slot.startsAt),
                  info.timezone,
                  timeFormat24h,
                )}{" "}
                -{" "}
                {formatClock(
                  new Date(slot.endsAt),
                  info.timezone,
                  timeFormat24h,
                )}
                ,{" "}
                {new Date(slot.startsAt).toLocaleDateString("en-US", {
                  timeZone: info.timezone,
                  weekday: "long",
                  month: "long",
                  day: "numeric",
                  year: "numeric",
                })}
              </p>
              <p className="flex items-center gap-2.5">
                <Globe2 className="h-4 w-4 shrink-0 text-[#6B7280]" />
                {timezoneLongLabel(info.timezone, new Date())}
              </p>
            </motion.div>
          ) : null}
        </AnimatePresence>
        <p className="flex items-center gap-2.5">
          <Clock3 className="h-4 w-4 shrink-0 text-[#6B7280]" />
          {sessionType ? `${sessionType.durationMinutes} min` : "—"}
        </p>
        {requiresPayment ? (
          <p className="flex items-center gap-2.5">
            <Wallet className="h-4 w-4 shrink-0 text-[#6B7280]" />
            {Number(info.consultFeeAmount).toLocaleString("en-CA", {
              style: "currency",
              currency,
            })}
          </p>
        ) : null}
      </motion.div>

      <motion.h2
        variants={listItem}
        className="mt-6 text-sm font-bold text-[#1A1F36] underline decoration-1 underline-offset-2"
      >
        Welcome to {info.agencyName}!
      </motion.h2>
      <motion.p
        variants={listItem}
        className="mt-2 text-[13px] leading-5 text-[#4D5865]"
      >
        {welcomeMessage}
      </motion.p>
      <motion.p
        variants={listItem}
        className="mt-3 text-[13px] font-semibold text-[#1A1F36]"
      >
        {signOff}
      </motion.p>

      <motion.div variants={listItem} className="mt-auto pt-6">
        {legalLinks}
      </motion.div>
    </motion.div>
  );

  return (
    <>
      <div className="flex min-h-[100dvh] items-center justify-center bg-[#F9F9FA] p-4 sm:p-8">
        <motion.div
          initial={{ opacity: 0, y: 16, scale: 0.985 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
          className="relative flex w-full max-w-[1100px] flex-col overflow-hidden rounded-lg bg-white shadow-[0_10px_40px_rgba(15,23,42,0.12)] md:flex-row"
        >
          <AnimatePresence>
            {backStep ? (
              <motion.button
                key="back"
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.8 }}
                whileHover={{ scale: 1.08, x: -2 }}
                whileTap={{ scale: 0.9 }}
                type="button"
                onClick={() => setStep(backStep)}
                aria-label="Back"
                className="absolute left-4 top-4 z-10 flex h-9 w-9 items-center justify-center rounded-full border border-[#E5E7EB] bg-white text-[#4D5865] shadow-sm transition-colors hover:bg-slate-50"
              >
                <ArrowLeft className="h-4 w-4" />
              </motion.button>
            ) : null}
          </AnimatePresence>

          {twoStepFlow ? leftPanel : null}

          <div
            className={twoStepFlow ? "flex-1 p-7 sm:p-9" : "w-full p-7 sm:p-9"}
          >
            {error && !twoStepFlow ? (
              <motion.p
                key={error}
                initial={{ opacity: 0, x: -6 }}
                animate={{ opacity: 1, x: 0 }}
                className="mb-4 rounded-md bg-rose-50 px-4 py-3 text-sm text-rose-700"
              >
                {error}
              </motion.p>
            ) : null}
            <AnimatePresence mode="wait">
              {step === "format" ? (
                <motion.div key="format" {...stepTransition}>
                  <h2 className="text-[17px] font-bold text-[#1A1F36]">
                    How would you like to meet?
                  </h2>
                  {error ? (
                    <motion.p
                      key={error}
                      initial={{ opacity: 0, x: -6 }}
                      animate={{ opacity: 1, x: 0 }}
                      className="mb-4 mt-3 rounded-md bg-rose-50 px-4 py-3 text-sm text-rose-700"
                    >
                      {error}
                    </motion.p>
                  ) : null}
                  <motion.div
                    initial="initial"
                    animate="animate"
                    variants={listStagger}
                    className="mt-5 space-y-2"
                  >
                    <p className="text-xs font-semibold uppercase tracking-wide text-[#6B7280]">
                      Appointment format
                    </p>
                    {meetingModeOptions.map((option) => (
                      <motion.button
                        key={option.id}
                        variants={listItem}
                        {...cardHover}
                        type="button"
                        onClick={() => pickMeetingMode(option.id)}
                        className={`flex w-full items-center gap-3 rounded-md border px-3.5 py-3 text-left transition-colors ${meetingMode === option.id ? "border-[#006BFF] bg-[#E8F1FF]" : "border-[#E5E7EB] bg-white hover:border-[#006BFF]"}`}
                      >
                        <option.icon className="h-4 w-4 shrink-0 text-[#4D5865]" />
                        <span className="min-w-0">
                          <span className="block text-sm font-semibold text-[#1A1F36]">
                            {option.label}
                          </span>
                          <span className="block truncate text-xs text-[#6B7280]">
                            {option.sub}
                          </span>
                        </span>
                      </motion.button>
                    ))}
                    {!meetingModeOptions.length ? (
                      <p className="text-xs text-[#6B7280]">
                        No meeting formats are configured yet.
                      </p>
                    ) : null}
                  </motion.div>
                </motion.div>
              ) : step === "service" ? (
                <motion.div key="service" {...stepTransition}>
                  <h2 className="text-[17px] font-bold text-[#1A1F36]">
                    What would you like to book?
                  </h2>
                  <p className="mt-1 text-sm text-[#6B7280]">
                    Choose a service available for this appointment format.
                  </p>
                  <motion.div
                    initial="initial"
                    animate="animate"
                    variants={listStagger}
                    className="mt-5 space-y-2"
                  >
                    {compatibleSessionTypes.map((type) => (
                      <motion.button
                        key={type.id}
                        variants={listItem}
                        {...cardHover}
                        type="button"
                        onClick={() => pickSessionType(type)}
                        className={`flex w-full items-center justify-between rounded-md border px-4 py-3 text-left transition-colors ${sessionTypeId === type.id ? "border-[#006BFF] bg-[#E8F1FF]" : "border-[#E5E7EB] bg-white hover:border-[#006BFF]"}`}
                      >
                        <span className="text-sm font-semibold text-[#1A1F36]">
                          {type.name}
                        </span>
                        <span className="text-xs font-medium text-[#6B7280]">
                          {type.durationMinutes} min
                        </span>
                      </motion.button>
                    ))}
                  </motion.div>
                </motion.div>
              ) : step === "location" ? (
                <motion.div key="location" {...stepTransition}>
                  <h2 className="text-[17px] font-bold text-[#1A1F36]">
                    Choose an office
                  </h2>
                  <p className="mt-1 text-sm text-[#6B7280]">
                    In-person appointments use the same consultant schedule as
                    phone and video calls.
                  </p>
                  <motion.div
                    initial="initial"
                    animate="animate"
                    variants={listStagger}
                    className="mt-5 space-y-2"
                  >
                    {selectableLocations.map((office) => (
                      <motion.button
                        key={office.id}
                        variants={listItem}
                        {...cardHover}
                        type="button"
                        onClick={() => pickLocation(office)}
                        className={`flex w-full items-center gap-3 rounded-md border px-3.5 py-3 text-left transition-colors ${locationId === office.id ? "border-[#006BFF] bg-[#E8F1FF]" : "border-[#E5E7EB] bg-white hover:border-[#006BFF]"}`}
                      >
                        <MapPin className="h-4 w-4 shrink-0 text-[#4D5865]" />
                        <span className="min-w-0">
                          <span className="block text-sm font-semibold text-[#1A1F36]">
                            {office.name}
                          </span>
                          <span className="block truncate text-xs text-[#6B7280]">
                            {office.address}
                          </span>
                        </span>
                      </motion.button>
                    ))}
                  </motion.div>
                </motion.div>
              ) : step === "time" ? (
                <motion.div key="time" {...stepTransition}>
                  {error ? (
                    <motion.p
                      key={error}
                      initial={{ opacity: 0, x: -6 }}
                      animate={{ opacity: 1, x: 0 }}
                      className="mb-4 rounded-md bg-rose-50 px-4 py-3 text-sm text-rose-700"
                    >
                      {error}
                    </motion.p>
                  ) : null}
                  <CalendlyTimeStep
                    key={`${sessionTypeId}:${consultantId}:${meetingMode}:${locationId}`}
                    fetchAvailability={fetchAvailability}
                    initialSlot={slot}
                    timezone={info.timezone}
                    timeFormat24h={timeFormat24h}
                    onFormatChange={setTimeFormat24h}
                    onConfirm={(picked) => {
                      setSlot(picked);
                      setError("");
                      setStep("details");
                    }}
                    waitlistEnabled={info.waitlistEnabled}
                    onWaitlist={() => setStep("waitlist")}
                  />
                </motion.div>
              ) : step === "details" ? (
                <motion.div key="details" {...stepTransition}>
                  <h2 className="text-[17px] font-bold text-[#1A1F36]">
                    Enter Details
                  </h2>
                  {error ? (
                    <motion.p
                      key={error}
                      initial={{ opacity: 0, x: -6 }}
                      animate={{ opacity: 1, x: 0 }}
                      className="mb-4 mt-3 rounded-md bg-rose-50 px-4 py-3 text-sm text-rose-700"
                    >
                      {error}
                    </motion.p>
                  ) : null}

                  <label
                    className="absolute -left-[10000px] top-auto h-px w-px overflow-hidden"
                    aria-hidden="true"
                  >
                    Website
                    <input
                      tabIndex={-1}
                      autoComplete="off"
                      value={form.website}
                      onChange={(e) =>
                        setForm((c) => ({ ...c, website: e.target.value }))
                      }
                    />
                  </label>

                  <motion.div
                    initial="initial"
                    animate="animate"
                    variants={listStagger}
                    className="mt-5 space-y-4"
                  >
                    <motion.label
                      variants={listItem}
                      className="block text-xs font-semibold text-[#1A1F36]"
                    >
                      Name<span className="text-rose-500">*</span>
                      <input
                        required
                        value={form.name}
                        onChange={(e) =>
                          setForm((c) => ({ ...c, name: e.target.value }))
                        }
                        className={`mt-1.5 ${inputClass}`}
                        autoComplete="name"
                        placeholder="Full name"
                      />
                    </motion.label>

                    <motion.label
                      variants={listItem}
                      className="block text-xs font-semibold text-[#1A1F36]"
                    >
                      Email<span className="text-rose-500">*</span>
                      <input
                        required
                        type="email"
                        value={form.email}
                        onChange={(e) => {
                          setForm((c) => ({ ...c, email: e.target.value }));
                          setVerification({
                            id: "",
                            code: "",
                            token: "",
                            sending: false,
                            recognized: false,
                            consultant: null,
                          });
                          setConsultantId(
                            info?.consultants?.length === 1
                              ? info.consultants[0].id
                              : "",
                          );
                        }}
                        className={`mt-1.5 ${inputClass}`}
                        autoComplete="email"
                        placeholder="you@example.com"
                      />
                    </motion.label>
                    <AnimatePresence>
                      {emailValid ? (
                        <motion.div
                          initial={{ opacity: 0, height: 0 }}
                          animate={{ opacity: 1, height: "auto" }}
                          exit={{ opacity: 0, height: 0 }}
                          transition={{ duration: 0.2 }}
                          className="overflow-hidden rounded-md border border-[#E5E7EB] bg-[#F9F9FA] p-3"
                        >
                          {verification.token ? (
                            <motion.p
                              initial={{ opacity: 0, scale: 0.95 }}
                              animate={{ opacity: 1, scale: 1 }}
                              className="flex items-center gap-2 text-xs font-semibold text-emerald-700"
                            >
                              <CheckCircle2 className="h-4 w-4" /> Email
                              verified
                              {verification.recognized
                                ? verification.consultant
                                  ? ` · Welcome back; ${verification.consultant.name} is preferred`
                                  : " · Welcome back"
                                : ""}
                            </motion.p>
                          ) : verification.id ? (
                            <div className="flex gap-2">
                              <input
                                inputMode="numeric"
                                maxLength="6"
                                value={verification.code}
                                onChange={(event) =>
                                  setVerification((current) => ({
                                    ...current,
                                    code: event.target.value
                                      .replace(/\D/g, "")
                                      .slice(0, 6),
                                  }))
                                }
                                placeholder="6-digit code"
                                className={`${inputClass} !py-2`}
                              />
                              <motion.button
                                whileHover={{ scale: 1.03 }}
                                whileTap={{ scale: 0.96 }}
                                type="button"
                                disabled={
                                  verification.sending ||
                                  verification.code.length !== 6
                                }
                                onClick={verifyEmail}
                                className="rounded-md bg-[#006BFF] px-4 text-xs font-semibold text-white transition-colors hover:bg-[#0057CC] disabled:opacity-40"
                              >
                                Verify
                              </motion.button>
                            </div>
                          ) : (
                            <button
                              type="button"
                              disabled={verification.sending}
                              onClick={requestVerification}
                              className="text-xs font-semibold text-[#006BFF] transition-colors hover:text-[#0057CC]"
                            >
                              {verification.sending
                                ? "Sending code…"
                                : "Returning client? Verify email"}
                            </button>
                          )}
                        </motion.div>
                      ) : null}
                    </AnimatePresence>

                    <motion.label
                      variants={listItem}
                      className="block text-xs font-semibold text-[#1A1F36]"
                    >
                      What is your question?
                      <span className="text-rose-500">*</span>
                      <span className="mt-0.5 block font-normal text-[#6B7280]">
                        Please share anything that will help prepare for our
                        meeting.
                      </span>
                      <textarea
                        required
                        rows={3}
                        value={form.notes}
                        onChange={(e) =>
                          setForm((c) => ({ ...c, notes: e.target.value }))
                        }
                        className={`mt-1.5 resize-none ${inputClass}`}
                      />
                    </motion.label>

                    <motion.label
                      variants={listItem}
                      className="block text-xs font-semibold text-[#1A1F36]"
                    >
                      {meetingMode === "Phone" ? (
                        <>
                          Phone number {info.agencyName} should call
                          <span className="text-rose-500">*</span>
                        </>
                      ) : (
                        <>
                          Send text messages to{" "}
                          <span className="font-normal text-[#6B7280]">
                            (optional)
                          </span>
                        </>
                      )}
                      <div className="mt-1.5 flex overflow-hidden rounded-md border border-[#E5E7EB] focus-within:border-[#006BFF] focus-within:ring-2 focus-within:ring-[#006BFF]/15">
                        <span className="flex items-center gap-1 border-r border-[#E5E7EB] bg-[#F9F9FA] px-3 text-sm text-[#4D5865]">
                          <Phone className="h-3.5 w-3.5" /> +1
                        </span>
                        <input
                          value={form.phone}
                          onChange={(e) =>
                            setForm((c) => ({ ...c, phone: e.target.value }))
                          }
                          className="flex-1 px-3 py-2.5 text-sm text-[#1A1F36] outline-none"
                          autoComplete="tel"
                          placeholder="(555) 123-4567"
                        />
                      </div>
                      {meetingMode === "Phone" ? (
                        <span className="mt-1.5 block font-normal leading-5 text-[#6B7280]">
                          {info.agencyName} will call this number
                          {info.phoneCallerId
                            ? ` from ${info.phoneCallerId}`
                            : ""}
                          . You do not need to call the office.
                        </span>
                      ) : null}
                    </motion.label>

                    {requiresPayment ? (
                      <motion.div
                        variants={listItem}
                        className="rounded-md border border-[#E5E7EB] p-4"
                      >
                        <p className="text-sm font-bold text-[#1A1F36]">
                          Payment information
                          <span className="text-rose-500">*</span>
                        </p>
                        <div className="mt-3 flex items-center justify-between text-sm">
                          <span className="text-[#4D5865]">Price</span>
                          <span className="font-semibold text-[#1A1F36]">
                            {Number(info.consultFeeAmount).toLocaleString(
                              "en-CA",
                              { style: "currency", currency },
                            )}
                          </span>
                        </div>
                        {info.consultFeeTerms ? (
                          <div className="mt-3 border-t border-[#E5E7EB] pt-3">
                            <p className="text-xs font-semibold uppercase tracking-wide text-[#6B7280]">
                              Payment terms
                            </p>
                            <p className="mt-1 text-xs leading-5 text-[#4D5865]">
                              {info.consultFeeTerms}
                            </p>
                          </div>
                        ) : null}
                        <p className="mt-3 flex items-center gap-1.5 text-xs text-[#6B7280]">
                          <Wallet className="h-3.5 w-3.5 shrink-0" /> You'll
                          securely complete payment via QuickBooks right after
                          scheduling.
                        </p>
                      </motion.div>
                    ) : null}

                    <motion.p
                      variants={listItem}
                      className="text-xs leading-5 text-[#6B7280]"
                    >
                      By proceeding, you confirm that you have read and agree to{" "}
                      <a
                        href="/legal/terms"
                        className="font-semibold text-[#1A1F36] underline"
                      >
                        {info.agencyName} Participant Terms
                      </a>{" "}
                      and{" "}
                      <a
                        href="/legal/privacy"
                        className="font-semibold text-[#1A1F36] underline"
                      >
                        Privacy Notice
                      </a>
                      .
                    </motion.p>

                    <motion.button
                      variants={listItem}
                      type="button"
                      whileHover={
                        ready && !saving ? { scale: 1.01, y: -1 } : undefined
                      }
                      whileTap={{ scale: 0.98 }}
                      disabled={!ready || saving}
                      onClick={submit}
                      className="flex h-12 w-full items-center justify-center gap-2 rounded-md bg-[#006BFF] text-sm font-bold text-white transition-colors hover:bg-[#0057CC] disabled:opacity-40"
                    >
                      {saving ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : null}
                      {saving ? "Preparing…" : "Schedule Event"}
                    </motion.button>
                  </motion.div>
                </motion.div>
              ) : step === "payment" ? (
                <motion.div
                  key="payment"
                  {...stepTransition}
                  className="mx-auto max-w-lg py-5 text-center"
                >
                  <span
                    className={`mx-auto flex h-16 w-16 items-center justify-center rounded-full ${
                      pendingPayment?.requiresStaffResolution
                        ? "bg-amber-100 text-amber-700"
                        : ["Expired", "Voided", "Failed"].includes(
                              pendingPayment?.status,
                            )
                          ? "bg-rose-100 text-rose-700"
                          : "bg-[#E8F1FF] text-[#006BFF]"
                    }`}
                  >
                    {paymentChecking ||
                    ["AwaitingPayment", "Confirming"].includes(
                      pendingPayment?.status,
                    ) ? (
                      <Loader2 className="h-8 w-8 animate-spin" />
                    ) : pendingPayment?.requiresStaffResolution ? (
                      <CheckCircle2 className="h-8 w-8" />
                    ) : (
                      <Wallet className="h-8 w-8" />
                    )}
                  </span>

                  <h2 className="mt-5 text-[19px] font-bold text-[#1A1F36]">
                    {pendingPayment?.requiresStaffResolution
                      ? "Payment received"
                      : ["Expired", "Voided", "Failed"].includes(
                            pendingPayment?.status,
                          )
                        ? "Payment window closed"
                        : pendingPayment?.status === "Confirming"
                          ? "Confirming your payment"
                          : "Complete your payment"}
                  </h2>

                  {pendingPayment?.requiresStaffResolution ? (
                    <p className="mt-2 text-sm leading-6 text-[#4D5865]">
                      Your payment is confirmed, but the appointment could not
                      be created automatically. The scheduling team has received
                      an urgent alert and will contact you to arrange the time
                      or issue a refund.
                    </p>
                  ) : ["Expired", "Voided", "Failed"].includes(
                      pendingPayment?.status,
                    ) ? (
                    <p className="mt-2 text-sm leading-6 text-[#4D5865]">
                      This checkout is no longer active and the appointment was
                      not confirmed. Choose another available time to start a
                      new booking.
                    </p>
                  ) : (
                    <p className="mt-2 text-sm leading-6 text-[#4D5865]">
                      Your time is held while you pay securely through
                      QuickBooks. After payment, return to this tab;
                      confirmation is checked automatically and does not depend
                      on the webhook.
                    </p>
                  )}

                  {pendingPayment?.startsAt ? (
                    <div className="mt-5 rounded-md border border-[#E5E7EB] bg-[#F9F9FA] px-4 py-3 text-sm text-[#4D5865]">
                      <p className="font-semibold text-[#1A1F36]">
                        {new Date(pendingPayment.startsAt).toLocaleDateString(
                          "en-CA",
                          {
                            timeZone: info.timezone,
                            weekday: "long",
                            month: "long",
                            day: "numeric",
                          },
                        )}
                        {" at "}
                        {formatClock(
                          new Date(pendingPayment.startsAt),
                          info.timezone,
                          timeFormat24h,
                        )}
                      </p>
                      {pendingPayment.amount ? (
                        <p className="mt-1">
                          {Number(pendingPayment.amount).toLocaleString(
                            "en-CA",
                            { style: "currency", currency },
                          )}
                        </p>
                      ) : null}
                      {pendingPayment.status === "AwaitingPayment" &&
                      pendingPayment.expiresAt ? (
                        <p className="mt-1 text-xs text-[#6B7280]">
                          Checkout hold expires at{" "}
                          {formatClock(
                            new Date(pendingPayment.expiresAt),
                            info.timezone,
                            timeFormat24h,
                          )}
                          .
                        </p>
                      ) : null}
                    </div>
                  ) : null}

                  {paymentError ? (
                    <p className="mt-4 rounded-md bg-amber-50 px-4 py-3 text-sm text-amber-800">
                      {paymentError}
                    </p>
                  ) : null}

                  {pendingPayment?.status === "AwaitingPayment" &&
                  pendingPayment.payNowUrl ? (
                    <motion.a
                      whileHover={{ scale: 1.01, y: -1 }}
                      whileTap={{ scale: 0.98 }}
                      href={pendingPayment.payNowUrl}
                      className="mt-5 inline-flex h-12 items-center justify-center gap-2 rounded-md bg-[#006BFF] px-6 text-sm font-bold text-white transition-colors hover:bg-[#0057CC]"
                    >
                      <Wallet className="h-4 w-4" /> Open secure payment
                    </motion.a>
                  ) : null}

                  {["Expired", "Voided", "Failed"].includes(
                    pendingPayment?.status,
                  ) ? (
                    <motion.button
                      whileHover={{ scale: 1.01, y: -1 }}
                      whileTap={{ scale: 0.98 }}
                      type="button"
                      onClick={restartAfterClosedPayment}
                      className="mt-5 h-12 rounded-md bg-[#006BFF] px-6 text-sm font-bold text-white transition-colors hover:bg-[#0057CC]"
                    >
                      Choose another time
                    </motion.button>
                  ) : null}
                </motion.div>
              ) : step === "waitlist" ? (
                <motion.div key="waitlist" {...stepTransition}>
                  <motion.button
                    whileHover={{ x: -2 }}
                    type="button"
                    onClick={() => setStep("time")}
                    className="mb-4 flex w-fit items-center gap-1.5 text-sm font-medium text-[#4D5865] transition-colors hover:text-[#1A1F36]"
                  >
                    <ArrowLeft className="h-4 w-4" /> Back
                  </motion.button>
                  <h2 className="text-[17px] font-bold text-[#1A1F36]">
                    Join the appointment waitlist
                  </h2>
                  <p className="mt-1 text-sm leading-6 text-[#4D5865]">
                    Tell us who to contact and your preferred date range. The
                    office can reach out when a matching time opens.
                  </p>
                  <motion.div
                    initial="initial"
                    animate="animate"
                    variants={listStagger}
                    className="mt-5 grid grid-cols-2 gap-3"
                  >
                    <motion.label
                      variants={listItem}
                      className="block text-xs font-medium text-[#1A1F36]"
                    >
                      From
                      <input
                        type="date"
                        value={waitlistDates.from}
                        onChange={(event) =>
                          setWaitlistDates((current) => ({
                            ...current,
                            from: event.target.value,
                          }))
                        }
                        className={`mt-1.5 ${inputClass}`}
                      />
                    </motion.label>
                    <motion.label
                      variants={listItem}
                      className="block text-xs font-medium text-[#1A1F36]"
                    >
                      To
                      <input
                        type="date"
                        value={waitlistDates.to}
                        onChange={(event) =>
                          setWaitlistDates((current) => ({
                            ...current,
                            to: event.target.value,
                          }))
                        }
                        className={`mt-1.5 ${inputClass}`}
                      />
                    </motion.label>
                  </motion.div>
                  <motion.div
                    initial="initial"
                    animate="animate"
                    variants={listStagger}
                    className="mt-4 space-y-3.5"
                  >
                    <motion.label
                      variants={listItem}
                      className="block text-xs font-medium text-[#1A1F36]"
                    >
                      Full name
                      <input
                        required
                        value={form.name}
                        onChange={(event) =>
                          setForm((current) => ({
                            ...current,
                            name: event.target.value,
                          }))
                        }
                        className={`mt-1.5 ${inputClass}`}
                        autoComplete="name"
                      />
                    </motion.label>
                    <motion.label
                      variants={listItem}
                      className="block text-xs font-medium text-[#1A1F36]"
                    >
                      Email
                      <input
                        required
                        type="email"
                        value={form.email}
                        onChange={(event) =>
                          setForm((current) => ({
                            ...current,
                            email: event.target.value,
                          }))
                        }
                        className={`mt-1.5 ${inputClass}`}
                        autoComplete="email"
                      />
                    </motion.label>
                    <motion.label
                      variants={listItem}
                      className="block text-xs font-medium text-[#1A1F36]"
                    >
                      Phone{" "}
                      {meetingMode === "Phone" ? (
                        <span className="text-rose-500">*</span>
                      ) : (
                        "(optional)"
                      )}
                      <input
                        value={form.phone}
                        onChange={(event) =>
                          setForm((current) => ({
                            ...current,
                            phone: event.target.value,
                          }))
                        }
                        className={`mt-1.5 ${inputClass}`}
                        autoComplete="tel"
                      />
                    </motion.label>
                  </motion.div>
                  <motion.button
                    whileHover={
                      !(
                        saving ||
                        !form.name.trim() ||
                        !EMAIL_PATTERN.test(form.email) ||
                        (meetingMode === "Phone" && !form.phone.trim())
                      )
                        ? { scale: 1.01, y: -1 }
                        : undefined
                    }
                    whileTap={{ scale: 0.98 }}
                    type="button"
                    disabled={
                      saving ||
                      !form.name.trim() ||
                      !EMAIL_PATTERN.test(form.email) ||
                      (meetingMode === "Phone" && !form.phone.trim())
                    }
                    onClick={joinWaitlist}
                    className="mt-6 flex h-12 w-full items-center justify-center gap-2 rounded-md bg-[#006BFF] text-sm font-bold text-white transition-colors hover:bg-[#0057CC] disabled:opacity-40"
                  >
                    {saving ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : null}
                    {saving ? "Joining…" : "Join waitlist"}
                  </motion.button>
                </motion.div>
              ) : (
                <motion.div
                  key="done"
                  initial={{ opacity: 0, scale: 0.97 }}
                  animate={{ opacity: 1, scale: 1 }}
                  className="py-4 text-center"
                >
                  <motion.span
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    transition={{ type: "spring", stiffness: 260, damping: 18 }}
                    className="inline-flex"
                  >
                    <span className="flex h-16 w-16 items-center justify-center rounded-full bg-[#006BFF]">
                      <CheckCircle2
                        className="h-8 w-8 text-white"
                        strokeWidth={2}
                      />
                    </span>
                  </motion.span>
                  <motion.div
                    initial="initial"
                    animate="animate"
                    variants={{
                      animate: {
                        transition: {
                          staggerChildren: 0.08,
                          delayChildren: 0.15,
                        },
                      },
                    }}
                  >
                    <motion.h2
                      variants={listItem}
                      className="mt-5 text-[19px] font-bold text-[#1A1F36]"
                    >
                      {done?.waitlist
                        ? done.waitlistStatus === "Offered"
                          ? "You already have a reserved time"
                          : "You're on the waitlist"
                        : "Appointment confirmed"}
                    </motion.h2>
                    <motion.p
                      variants={listItem}
                      className="mt-1.5 text-sm text-[#4D5865]"
                    >
                      {done?.waitlist ? (
                        done.waitlistStatus === "Offered" ? (
                          "Check your email for the active reservation link before it expires."
                        ) : (
                          "The office can contact you when a matching appointment opens."
                        )
                      ) : (
                        <>
                          {done?.subject} ·{" "}
                          {new Date(done?.startsAt).toLocaleDateString(
                            "en-CA",
                            {
                              timeZone: info.timezone,
                              weekday: "long",
                              month: "long",
                              day: "numeric",
                            },
                          )}{" "}
                          at{" "}
                          {formatClock(
                            new Date(done?.startsAt),
                            info.timezone,
                            timeFormat24h,
                          )}
                        </>
                      )}
                    </motion.p>
                    {!done?.waitlist &&
                    (done?.referenceCode || done?.assignedTo?.fullName) ? (
                      <motion.div
                        variants={listItem}
                        className="mt-3 flex flex-wrap justify-center gap-2 text-xs"
                      >
                        {done.referenceCode ? (
                          <span className="rounded-full bg-[#F3F4F6] px-2.5 py-1 font-mono font-semibold text-[#4D5865]">
                            {done.referenceCode}
                          </span>
                        ) : null}
                        {done.assignedTo?.fullName ? (
                          <span className="rounded-full bg-[#E8F1FF] px-2.5 py-1 font-semibold text-[#006BFF]">
                            With {done.assignedTo.fullName}
                          </span>
                        ) : null}
                      </motion.div>
                    ) : null}

                    {done?.location ? (
                      <motion.div
                        variants={listItem}
                        className="mt-5 w-full rounded-md border border-[#E5E7EB] px-4 py-3.5 text-left text-sm"
                      >
                        <p className="flex items-start gap-2.5 text-[#4D5865]">
                          <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-[#006BFF]" />
                          <span>
                            {done.location}
                            <a
                              href={
                                done.locationMapsUrl ||
                                `https://maps.google.com/?q=${encodeURIComponent(done.location.split(" — ").pop())}`
                              }
                              target="_blank"
                              rel="noopener noreferrer"
                              className="mt-0.5 block text-xs font-semibold text-[#006BFF] transition-colors hover:text-[#0057CC]"
                            >
                              Open in Maps ↗
                            </a>
                          </span>
                        </p>
                      </motion.div>
                    ) : null}
                    {done?.meetingUrl ? (
                      <motion.a
                        variants={listItem}
                        whileHover={{ scale: 1.02, y: -1 }}
                        whileTap={{ scale: 0.98 }}
                        href={done.meetingUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="mt-5 inline-flex items-center gap-2 rounded-md bg-[#006BFF] px-5 py-3 text-sm font-bold text-white transition-colors hover:bg-[#0057CC]"
                      >
                        <Video className="h-4 w-4" /> Join{" "}
                        {done.meetingMode === "Zoom" ? "Zoom" : "Jitsi"} video
                        call
                      </motion.a>
                    ) : null}
                    {done?.meetingMode === "Phone" ? (
                      <motion.div
                        variants={listItem}
                        className="mt-5 w-full rounded-md border border-[#E5E7EB] px-4 py-3.5 text-left text-sm text-[#4D5865]"
                      >
                        <p className="flex items-start gap-2.5">
                          <Phone className="mt-0.5 h-4 w-4 shrink-0 text-[#006BFF]" />
                          <span>
                            {info.agencyName} will call the phone number you
                            provided
                            {done.meetingPhoneNumber ? (
                              <>
                                {" "}
                                from{" "}
                                <strong className="text-[#1A1F36]">
                                  {done.meetingPhoneNumber}
                                </strong>
                              </>
                            ) : (
                              ""
                            )}
                            . You do not need to call us.
                          </span>
                        </p>
                      </motion.div>
                    ) : null}
                    {done?.meetingMode === "Zoom" && !done?.meetingUrl ? (
                      <motion.p
                        variants={listItem}
                        className="mt-5 rounded-md bg-[#E8F1FF] px-4 py-3 text-sm text-[#1A1F36]"
                      >
                        Your secure Zoom link is being prepared and will be
                        included in the confirmation email and text message.
                      </motion.p>
                    ) : null}

                    {!done?.waitlist ? (
                      <motion.p
                        variants={listItem}
                        className="mx-auto mt-5 max-w-[330px] text-sm leading-6 text-[#4D5865]"
                      >
                        A confirmation with all the details is on its way to
                        your email
                        {done?.location
                          ? ", including the office address"
                          : done?.meetingMode === "Phone"
                            ? ", including the number your call will come from"
                            : [
                                  done?.meetingUrl,
                                  done?.meetingMode === "Zoom",
                                ].some(Boolean)
                              ? ", including your join link"
                              : ""}
                        . Use the link in it to reschedule or cancel anytime.
                      </motion.p>
                    ) : null}
                    {!done?.waitlist ? (
                      <motion.a
                        variants={listItem}
                        href={`/book/manage/${done?.manageToken}`}
                        className="mt-4 inline-block text-sm font-semibold text-[#006BFF] transition-colors hover:text-[#0057CC]"
                      >
                        Manage this booking →
                      </motion.a>
                    ) : null}
                  </motion.div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </motion.div>
      </div>
      <AnimatePresence>
        {cookieInfoOpen
          ? createPortal(
              <motion.div
                key="cookie-modal"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="fixed inset-0 z-[9999] flex items-end justify-center bg-slate-950/45 p-0 backdrop-blur-sm sm:items-center sm:p-6"
                onMouseDown={() => setCookieInfoOpen(false)}
              >
                <motion.div
                  initial={{ opacity: 0, y: 24, scale: 0.97 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: 24, scale: 0.97 }}
                  transition={springy}
                  role="dialog"
                  aria-modal="true"
                  aria-labelledby="cookie-info-title"
                  onMouseDown={(event) => event.stopPropagation()}
                  className="w-full max-w-md rounded-t-[24px] bg-white p-6 shadow-[0_30px_100px_rgba(15,23,42,0.35)] sm:rounded-[24px]"
                >
                  <h2
                    id="cookie-info-title"
                    className="text-lg font-semibold text-slate-950"
                  >
                    Cookies &amp; storage
                  </h2>
                  <p className="mt-3 text-sm leading-6 text-slate-600">
                    This booking page uses session storage only to preserve your
                    in-progress booking if you refresh or navigate back. It does
                    not use third-party advertising or analytics cookies.
                  </p>
                  <div className="mt-5 flex items-center justify-between gap-3">
                    <a
                      href="/legal/privacy"
                      className="text-sm font-semibold text-sky-700 transition-colors hover:text-sky-800"
                    >
                      Read our Privacy Policy
                    </a>
                    <motion.button
                      whileHover={{ scale: 1.03 }}
                      whileTap={{ scale: 0.96 }}
                      type="button"
                      onClick={() => setCookieInfoOpen(false)}
                      className="rounded-full bg-slate-950 px-5 py-2.5 text-sm font-semibold text-white"
                    >
                      Close
                    </motion.button>
                  </div>
                </motion.div>
              </motion.div>,
              document.body,
            )
          : null}
      </AnimatePresence>
    </>
  );
}
