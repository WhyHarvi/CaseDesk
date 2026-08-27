import { AnimatePresence, motion } from "framer-motion";
import {
  AlertTriangle,
  Bell,
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock3,
  ClipboardCheck,
  Copy,
  Loader2,
  Mail,
  MessageSquare,
  MapPin,
  NotebookPen,
  Phone,
  Plus,
  RefreshCw,
  Sparkles,
  Trash2,
  UserRound,
  Video,
  Wallet,
  X,
} from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import {
  cancelBookingAppointment,
  cancelBookingPaymentHoldRequest,
  convertAppointmentToClient,
  createBookingAppointment,
  createWalkInPayNowLink,
  getAppointmentRefundEstimate,
  getAvailability,
  getBookingPaymentHoldStatus,
  getBookingSettings,
  getCalendarAppointments,
  getFreeConsultationEligibility,
  lookupBookingClients,
  lookupBookingContacts,
  recordWalkInManualPayment,
  resendBookingPaymentHoldRequest,
  rescheduleBookingAppointment,
  shortenAppointmentSubject,
  updateBookingAppointmentStatus,
  updatePaidAppointmentPaymentDetails,
} from "../api/bookingApi";
import PageContainer from "../components/layout/PageContainer";
import AppointmentProfileOverlay from "../components/appointments/AppointmentProfileOverlay";
import RefundFeeNotice from "../components/booking/RefundFeeNotice";
import Select from "../components/ui/Select";
import ClientCombobox, { useClientMatches } from "../components/ui/ClientCombobox";
import api from "../services/api";

const newBookingOperationKey = () => globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`;

const APPOINTMENT_SUBJECT_MAX_WORDS = 10;
const subjectWordCount = (value) =>
  String(value || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;

// Keeps the New Appointment sheet open (and whatever was filled in) across a
// browser reload, the same way the Add Client drawer does — sessionStorage
// so a stale draft never resurfaces in a new tab days later.
const APPOINTMENT_DRAFT_STORAGE_KEY = "casedesk:appointment-drawer-draft";

function readAppointmentDraft() {
  try {
    const raw = window.sessionStorage.getItem(APPOINTMENT_DRAFT_STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeAppointmentDraft(draft) {
  try {
    window.sessionStorage.setItem(APPOINTMENT_DRAFT_STORAGE_KEY, JSON.stringify(draft));
  } catch {
    // Storage unavailable (private browsing, quota) — the sheet still works,
    // it just won't survive a reload.
  }
}

function clearAppointmentDraft() {
  try {
    window.sessionStorage.removeItem(APPOINTMENT_DRAFT_STORAGE_KEY);
  } catch {
    // Nothing to clean up if storage was never reachable.
  }
}

const DAY_MS = 24 * 60 * 60 * 1000;
const GRID_START_HOUR = 7;
const GRID_END_HOUR = 20;
// 88px/hour (was 72, originally 60) — matching the reference screenshot's
// chunkier appointment blocks meant more than just fitting text: there
// needed to be real room for an avatar plus two lines without the block
// looking squeezed.
const HOUR_PX = 88;

const EVENT_TONES = [
  { chip: "bg-sky-500", block: "border-sky-400 bg-sky-50/90 hover:bg-sky-100/90", title: "text-sky-900", meta: "text-sky-600" },
  { chip: "bg-violet-500", block: "border-violet-400 bg-violet-50/90 hover:bg-violet-100/90", title: "text-violet-900", meta: "text-violet-600" },
  { chip: "bg-emerald-500", block: "border-emerald-400 bg-emerald-50/90 hover:bg-emerald-100/90", title: "text-emerald-900", meta: "text-emerald-600" },
  { chip: "bg-amber-500", block: "border-amber-400 bg-amber-50/90 hover:bg-amber-100/90", title: "text-amber-900", meta: "text-amber-600" },
  { chip: "bg-rose-500", block: "border-rose-400 bg-rose-50/90 hover:bg-rose-100/90", title: "text-rose-900", meta: "text-rose-600" },
  { chip: "bg-indigo-500", block: "border-indigo-400 bg-indigo-50/90 hover:bg-indigo-100/90", title: "text-indigo-900", meta: "text-indigo-600" },
];

function calendarRowsEqual(current, next) {
  if (current.length !== next.length) return false;
  return current.every((item, index) => {
    const candidate = next[index];
    return item.id === candidate?.id
      && item.updatedAt === candidate.updatedAt
      && item.startsAt === candidate.startsAt
      && item.endsAt === candidate.endsAt
      && item.status === candidate.status;
  });
}
const NEUTRAL_TONE = { chip: "bg-slate-400", block: "border-slate-300 bg-slate-50/90 hover:bg-slate-100/90", title: "text-slate-800", meta: "text-slate-500" };
// Frontdesk-booked (walk-in) appointments get this fixed color regardless
// of who they're assigned to, instead of the per-staff rotation below — a
// distinct, at-a-glance "this came from the front desk" signal.
const WALK_IN_TONE = { chip: "bg-fuchsia-500", block: "border-fuchsia-400 bg-fuchsia-50/90 hover:bg-fuchsia-100/90", title: "text-fuchsia-900", meta: "text-fuchsia-600" };
const ATTENDED_TONE = { chip: "bg-slate-300", block: "border-slate-200 bg-slate-50/55 hover:bg-slate-100/70", title: "text-slate-500", meta: "text-slate-400" };
const NO_SHOW_TONE = { chip: "bg-amber-600", block: "border-amber-500 bg-amber-100 hover:bg-amber-200", title: "text-amber-950", meta: "text-amber-800", emphasis: "ring-2 ring-inset ring-amber-300 shadow-[0_7px_18px_rgba(217,119,6,0.16)]" };
const ATTENDANCE_NEEDED_TONE = { chip: "bg-rose-600", block: "border-rose-600 bg-rose-100 hover:bg-rose-200", title: "text-rose-950", meta: "text-rose-800", emphasis: "ring-2 ring-inset ring-rose-300 shadow-[0_8px_20px_rgba(225,29,72,0.2)]" };
// Free consultations are a service/payment distinction, so their color is
// stable across consultants and booking sources. Teal is intentionally not
// part of the rotating staff palette and stays distinct from walk-ins.
const FREE_CONSULTATION_TONE = { chip: "bg-teal-500", block: "border-teal-400 bg-teal-50/95 hover:bg-teal-100/95", title: "text-teal-950", meta: "text-teal-700" };
const MEETING_MODE_ICON = { InPerson: MapPin, Phone: Phone, Online: Video, Zoom: Video };
const MEETING_MODE_LABEL = { InPerson: "In person", Phone: "Phone call", Online: "Jitsi video call", Zoom: "Zoom video call" };
const APPOINTMENT_STATUS_TONE = {
  Scheduled: "bg-sky-50 text-sky-700 ring-sky-200",
  Completed: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  Cancelled: "bg-rose-50 text-rose-700 ring-rose-200",
  NoShow: "bg-amber-50 text-amber-700 ring-amber-200",
};

function appointmentNeedsAttendance(item, now = new Date()) {
  return item.status === "Scheduled" && new Date(item.endsAt) <= now;
}

function appointmentRequiresPaymentRecord(appointment, settings) {
  // Attendance and payment are independent states. Completing a consultation
  // must not make an unpaid fee disappear from the calendar.
  return ["Scheduled", "Completed"].includes(appointment?.status)
    && !appointment.isFreeConsultation
    && Number(settings?.consultFeeAmount || 0) > 0
    && (!appointment.seriesKey || !appointment.recurrenceIndex || appointment.recurrenceIndex === 1);
}

function appointmentPaymentAttention(appointment, hold = appointment?.paymentHold, settings = null) {
  const approval = appointment?.paymentApprovals?.[0];
  if (["PendingApproval", "ApprovalFailed"].includes(hold?.status)) return hold.status === "ApprovalFailed" ? "Approval processing failed" : "Payment approval pending";
  if (!hold && approval) return approval.status === "Failed" ? "Approval processing failed" : "Payment approval pending";
  if (!hold) return appointmentRequiresPaymentRecord(appointment, settings) ? "Payment not recorded" : null;
  if (["Voided", "Refunded", "Expired", "Cancelled", "Failed"].includes(hold.status)) return null;
  if (hold.status === "PaymentFailed") return "Payment record failed";
  const reference = hold.manualPaymentReference || hold.paymentReference;
  if (hold.status === "Paid") return hold.paymentMethod === "ETransfer" && !reference ? "Transaction # missing" : null;
  if (hold.status === "Confirming") return "Payment confirmation pending";
  if (hold.status === "RecordingPayment") return "Payment recording pending";
  if (hold.status === "AwaitingPayment") return hold.paymentMethod === "ETransfer" ? "E-transfer pending" : "Payment pending";
  return null;
}

function startOfWeek(date) {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  copy.setDate(copy.getDate() - ((copy.getDay() + 6) % 7)); // Monday
  return copy;
}

function startOfDayLocal(date) {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

function dateKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function addMonthsClamped(date, amount) {
  const target = new Date(date.getFullYear(), date.getMonth() + amount, 1);
  const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  target.setDate(Math.min(date.getDate(), lastDay));
  return startOfDayLocal(target);
}

function formatTime(value) {
  return new Date(value).toLocaleTimeString("en-CA", { hour: "numeric", minute: "2-digit" });
}

function layoutOverlappingAppointments(items) {
  const sorted = [...items]
    .map((item) => ({
      item,
      start: new Date(item.startsAt).getTime(),
      end: new Date(item.endsAt).getTime(),
    }))
    .sort((first, second) => first.start - second.start || first.end - second.end);

  const groups = [];
  let group = [];
  let groupEnd = -Infinity;

  sorted.forEach((entry) => {
    if (group.length && entry.start >= groupEnd) {
      groups.push(group);
      group = [];
      groupEnd = -Infinity;
    }

    group.push(entry);
    groupEnd = Math.max(groupEnd, entry.end);
  });

  if (group.length) groups.push(group);

  return groups.flatMap((entries) => {
    const columnEnds = [];
    const positioned = entries.map((entry) => {
      let column = columnEnds.findIndex((end) => end <= entry.start);

      if (column === -1) {
        column = columnEnds.length;
        columnEnds.push(entry.end);
      } else {
        columnEnds[column] = entry.end;
      }

      return { ...entry, column };
    });
    const columns = Math.max(columnEnds.length, 1);

    return positioned.map(({ item, column }) => ({ item, column, columns }));
  });
}

function useNow() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const interval = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(interval);
  }, []);
  return now;
}

function MiniMonth({ cursor, onCursor, selectedDate, onSelect, busyKeys }) {
  const monthStart = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
  const gridStart = startOfWeek(monthStart);
  const todayKey = dateKey(new Date());
  const selectedKey = dateKey(selectedDate);
  const cells = Array.from({ length: 42 }, (_, index) => new Date(gridStart.getTime() + index * DAY_MS));

  return (
    <div className="rounded-[1.4rem] border border-white/70 bg-white/85 p-4 shadow-[0_14px_40px_rgba(15,23,42,0.07)] backdrop-blur-xl">
      <div className="flex items-center justify-between">
        <button
          type="button"
          aria-label="Previous month"
          onClick={() => onCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1))}
          className="flex h-8 w-8 items-center justify-center rounded-full text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <p className="text-sm font-semibold text-slate-900">
          {cursor.toLocaleDateString("en-CA", { month: "long", year: "numeric" })}
        </p>
        <button
          type="button"
          aria-label="Next month"
          onClick={() => onCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1))}
          className="flex h-8 w-8 items-center justify-center rounded-full text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
      <div className="mt-3 grid grid-cols-7 text-center">
        {["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"].map((label) => (
          <span key={label} className="pb-1.5 text-[11px] font-semibold text-slate-400">{label}</span>
        ))}
        {cells.map((cell) => {
          const key = dateKey(cell);
          const inMonth = cell.getMonth() === cursor.getMonth();
          const isSelected = key === selectedKey;
          const isToday = key === todayKey;
          return (
            <button
              key={key}
              type="button"
              onClick={() => onSelect(cell)}
              className="group relative flex h-9 items-center justify-center"
            >
              <span
                className={`flex h-8 w-8 items-center justify-center rounded-full text-[13px] transition ${
                  isSelected
                    ? "bg-slate-950 font-semibold text-white shadow-[0_6px_16px_rgba(15,23,42,0.3)]"
                    : isToday
                      ? "font-semibold text-sky-700 ring-1 ring-inset ring-sky-300 group-hover:bg-sky-50"
                      : inMonth
                        ? "text-slate-700 group-hover:bg-slate-100"
                        : "text-slate-300 group-hover:bg-slate-50"
                }`}
              >
                {cell.getDate()}
              </span>
              {busyKeys.has(key) && !isSelected ? (
                <span className="absolute bottom-0.5 h-1 w-1 rounded-full bg-sky-500" />
              ) : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function MonthCalendar({ cursor, items, selectedDate, todayKey, toneFor, onOpenDay, onSelectItem }) {
  const monthStart = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
  const gridStart = startOfWeek(monthStart);
  const cells = Array.from({ length: 42 }, (_, index) => {
    const cell = new Date(gridStart);
    cell.setDate(gridStart.getDate() + index);
    return cell;
  });
  const selectedKey = dateKey(selectedDate);
  const itemsByDay = new Map();
  for (const item of items) {
    const key = dateKey(new Date(item.startsAt));
    const dayItems = itemsByDay.get(key) || [];
    dayItems.push(item);
    itemsByDay.set(key, dayItems);
  }
  for (const dayItems of itemsByDay.values()) {
    dayItems.sort((left, right) => new Date(left.startsAt) - new Date(right.startsAt));
  }
  const monthItems = items
    .filter((item) => {
      const start = new Date(item.startsAt);
      return start.getFullYear() === cursor.getFullYear() && start.getMonth() === cursor.getMonth();
    })
    .sort((left, right) => new Date(left.startsAt) - new Date(right.startsAt));

  return (
    <div role="region" aria-label={`${cursor.toLocaleDateString("en-CA", { month: "long", year: "numeric" })} calendar`}>
      <div className="hidden grid-cols-7 border-b border-slate-100 bg-slate-50/60 text-center md:grid">
        {["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"].map((label) => (
          <div key={label} className="border-l border-slate-100 px-3 py-2.5 first:border-l-0">
            <span className="text-[11px] font-bold uppercase tracking-[0.08em] text-slate-400">{label.slice(0, 3)}</span>
          </div>
        ))}
      </div>

      <div className="hidden grid-cols-7 md:grid">
        {cells.map((cell) => {
          const key = dateKey(cell);
          const dayItems = itemsByDay.get(key) || [];
          const inMonth = cell.getMonth() === cursor.getMonth();
          const isToday = key === todayKey;
          const isSelected = key === selectedKey;
          const visibleItems = dayItems.slice(0, 3);
          return (
            <div key={key} className={`min-h-36 border-b border-l border-slate-100 p-2 first:border-l-0 ${inMonth ? "bg-white/60" : "bg-slate-50/50"} ${isSelected ? "ring-2 ring-inset ring-sky-200" : ""}`}>
              <button
                type="button"
                onClick={() => onOpenDay(cell)}
                aria-label={`Open ${cell.toLocaleDateString("en-CA", { weekday: "long", month: "long", day: "numeric", year: "numeric" })}`}
                className={`flex h-8 min-w-8 items-center justify-center rounded-full px-2 text-sm font-semibold transition hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 ${isToday ? "bg-sky-600 text-white shadow-sm hover:bg-sky-700" : inMonth ? "text-slate-800" : "text-slate-300"}`}
              >
                {cell.getDate()}
              </button>
              <div className="mt-1.5 space-y-1">
                {visibleItems.map((item) => {
                  const tone = toneFor(item);
                  const name = item.client?.fullName || item.guestName || item.subject || "Appointment";
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => onSelectItem(item)}
                      aria-label={`${formatTime(item.startsAt)} ${name}`}
                      className={`flex min-h-8 w-full items-center gap-1.5 rounded-lg border-l-2 px-2 py-1 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 ${tone.block}`}
                    >
                      <span className="shrink-0 text-[10px] font-bold tabular-nums text-slate-500">{formatTime(item.startsAt)}</span>
                      <span className={`min-w-0 truncate text-[11px] font-semibold ${tone.title}`} title={name}>{name}</span>
                    </button>
                  );
                })}
                {dayItems.length > visibleItems.length ? (
                  <button type="button" onClick={() => onOpenDay(cell)} className="flex min-h-8 w-full items-center px-2 text-left text-[11px] font-semibold text-sky-700 hover:text-sky-900">
                    +{dayItems.length - visibleItems.length} more
                  </button>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>

      <div className="p-3 md:hidden">
        <div className="grid grid-cols-7 text-center">
          {["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"].map((label) => (
            <span key={label} className="pb-2 text-[10px] font-bold uppercase text-slate-400">{label}</span>
          ))}
          {cells.map((cell) => {
            const key = dateKey(cell);
            const count = (itemsByDay.get(key) || []).length;
            const inMonth = cell.getMonth() === cursor.getMonth();
            const isToday = key === todayKey;
            return (
              <button
                key={key}
                type="button"
                onClick={() => onOpenDay(cell)}
                aria-label={`${cell.toLocaleDateString("en-CA", { month: "long", day: "numeric" })}${count ? `, ${count} appointment${count === 1 ? "" : "s"}` : ""}`}
                className="relative flex min-h-12 items-center justify-center rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500"
              >
                <span className={`flex h-8 w-8 items-center justify-center rounded-full text-xs font-semibold ${isToday ? "bg-sky-600 text-white" : inMonth ? "text-slate-700" : "text-slate-300"}`}>{cell.getDate()}</span>
                {count ? <span className="absolute bottom-0.5 min-w-4 rounded-full bg-slate-950 px-1 text-[9px] font-bold leading-4 text-white">{count}</span> : null}
              </button>
            );
          })}
        </div>

        <div className="mt-5 border-t border-slate-100 pt-4">
          <h3 className="text-sm font-semibold text-slate-900">Month appointments</h3>
          {monthItems.length ? (
            <div className="mt-3 space-y-2">
              {monthItems.map((item) => {
                const start = new Date(item.startsAt);
                const tone = toneFor(item);
                const name = item.client?.fullName || item.guestName || item.subject || "Appointment";
                return (
                    <button key={item.id} type="button" onClick={() => onSelectItem(item)} className={`flex min-h-14 w-full items-center gap-3 rounded-2xl border-l-4 px-3 py-2 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 ${tone.block} ${tone.emphasis || ""}`}>
                    <span className="flex h-10 w-10 shrink-0 flex-col items-center justify-center rounded-xl bg-slate-100 text-slate-700">
                      <span className="text-[9px] font-bold uppercase">{start.toLocaleDateString("en-CA", { month: "short" })}</span>
                      <span className="text-sm font-bold leading-4">{start.getDate()}</span>
                    </span>
                    <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${tone.chip}`} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold text-slate-800">{name}</span>
                      <span className="block text-xs text-slate-500">{start.toLocaleDateString("en-CA", { weekday: "short" })} · {formatTime(item.startsAt)}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          ) : (
            <p className="mt-2 rounded-2xl bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">No appointments scheduled this month.</p>
          )}
        </div>
      </div>
    </div>
  );
}

function DetailRow({ icon: Icon, children }) {
  return (
    <p className="flex items-center gap-2.5 text-sm text-slate-600">
      <Icon className="h-4 w-4 shrink-0 text-slate-400" />
      <span className="min-w-0">{children}</span>
    </p>
  );
}

function initialsFor(name) {
  return String(name || "").split(" ").filter(Boolean).map((part) => part[0]).join("").slice(0, 2).toUpperCase() || "?";
}

// A solid-fill circle in the appointment's existing per-staff tone color —
// there's no client photo field in the data model, so this stands in for
// the avatar a reference design would use, while keeping the same color
// meaning (who it's with) the rest of the calendar already relies on.
function InitialsAvatar({ name, tone, className = "h-6 w-6 text-[10px]" }) {
  return (
    <span className={`flex shrink-0 items-center justify-center rounded-full font-bold text-white ${tone.chip} ${className}`}>
      {initialsFor(name)}
    </span>
  );
}

const HOVER_CARD_WIDTH = 296;
const HOVER_CARD_MARGIN = 10;

function hoverCardPosition(anchorRect, measuredHeight = 260) {
  const availableWidth = Math.max(0, window.innerWidth - HOVER_CARD_MARGIN * 2);
  const availableHeight = Math.max(0, window.innerHeight - HOVER_CARD_MARGIN * 2);
  const width = Math.min(HOVER_CARD_WIDTH, availableWidth);
  const maxHeight = availableHeight;

  const spaceRight = window.innerWidth - anchorRect.right - HOVER_CARD_MARGIN;
  const spaceLeft = anchorRect.left - HOVER_CARD_MARGIN;
  let left;
  if (spaceRight >= width) left = anchorRect.right + HOVER_CARD_MARGIN;
  else if (spaceLeft >= width) left = anchorRect.left - width - HOVER_CARD_MARGIN;
  else left = spaceRight >= spaceLeft ? anchorRect.right + HOVER_CARD_MARGIN : anchorRect.left - width - HOVER_CARD_MARGIN;

  const maxLeft = Math.max(HOVER_CARD_MARGIN, window.innerWidth - HOVER_CARD_MARGIN - width);
  left = Math.min(Math.max(left, HOVER_CARD_MARGIN), maxLeft);

  const visibleHeight = Math.min(measuredHeight, maxHeight);
  const maxTop = Math.max(HOVER_CARD_MARGIN, window.innerHeight - HOVER_CARD_MARGIN - visibleHeight);
  const top = Math.min(Math.max(anchorRect.top, HOVER_CARD_MARGIN), maxTop);

  return { left, top, width, maxHeight };
}

// A lightweight preview on hover, additive to the existing click-to-open
// side panel (EventDetails) — this never replaces it, it just answers "who
// is this / are they reachable" without committing to opening the full
// panel and losing whatever was already selected there.
function AppointmentHoverCard({ item, tone, rect, onViewDetails, onMouseEnter, onMouseLeave }) {
  const cardRef = useRef(null);
  const [style, setStyle] = useState(() => hoverCardPosition(rect));

  useLayoutEffect(() => {
    const card = cardRef.current;
    if (!card) return undefined;

    const reposition = () => {
      const next = hoverCardPosition(rect, card.scrollHeight);
      setStyle((current) => Object.keys(next).every((key) => current[key] === next[key]) ? current : next);
    };

    reposition();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(reposition);
    observer?.observe(card);
    window.addEventListener("resize", reposition);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", reposition);
    };
  }, [item.id, rect]);

  const start = new Date(item.startsAt);
  const displayName = item.client?.fullName || item.guestName || item.subject;
  const email = item.client?.email || item.guestEmail || "";
  const phone = item.client?.phone || item.guestPhone || "";
  const ModeIcon = MEETING_MODE_ICON[item.meetingMode] || MapPin;
  const modeLabel = MEETING_MODE_LABEL[item.meetingMode] || item.meetingMode;

  return createPortal(
    <motion.div
      ref={cardRef}
      initial={{ opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.96 }}
      transition={{ duration: 0.12 }}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      className="fixed z-[500] overflow-x-hidden overflow-y-auto rounded-2xl border border-slate-100 bg-white shadow-[0_20px_50px_rgba(15,23,42,0.18)] overscroll-contain"
      style={style}
    >
      <div className="flex items-center gap-2.5 border-b border-slate-100 px-4 py-3.5">
        <InitialsAvatar name={displayName} tone={tone} className="h-9 w-9 text-xs" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-slate-900">{displayName}</p>
          <span className={`mt-0.5 inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold ring-1 ring-inset ${APPOINTMENT_STATUS_TONE[item.status] || "bg-slate-100 text-slate-600 ring-slate-200"}`}>
            {item.status === "NoShow" ? "No-show" : item.status}
          </span>
        </div>
      </div>

      <div className="space-y-2 px-4 py-3.5 text-sm text-slate-600">
        {phone ? <p className="flex items-center gap-2 truncate"><Phone className="h-3.5 w-3.5 shrink-0 text-slate-400" />{phone}</p> : null}
        {email ? <p className="flex items-center gap-2 truncate"><Mail className="h-3.5 w-3.5 shrink-0 text-slate-400" />{email}</p> : null}
        {!phone && !email ? <p className="text-slate-400">No contact details on file.</p> : null}

        <div className="grid grid-cols-2 gap-2 pt-1">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Visit type</p>
            <p className="truncate text-xs font-medium text-slate-700">{item.sessionType?.name || "—"}</p>
          </div>
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">With</p>
            <p className="truncate text-xs font-medium text-slate-700">{item.assignedTo?.fullName || "—"}</p>
          </div>
        </div>

        <p className="flex items-center gap-2 pt-1"><Clock3 className="h-3.5 w-3.5 shrink-0 text-slate-400" />{start.toLocaleDateString("en-CA", { weekday: "short", month: "short", day: "numeric" })} · {formatTime(item.startsAt)}–{formatTime(item.endsAt)}</p>
        <p className="flex items-center gap-2 truncate"><ModeIcon className="h-3.5 w-3.5 shrink-0 text-slate-400" />{item.location || modeLabel}</p>
      </div>

      <div className="border-t border-slate-100 px-4 py-3">
        <button type="button" onClick={onViewDetails} className="flex h-9 w-full items-center justify-center rounded-full bg-slate-950 text-xs font-semibold text-white transition hover:bg-slate-800">
          View details
        </button>
      </div>
    </motion.div>,
    document.body,
  );
}

function AppointmentPill({ item, column, columns, view, tone, isSelected, isFocused, bookingSettings, onSelect, onHoverStart, onHoverEnd }) {
  const start = new Date(item.startsAt);
  const end = new Date(item.endsAt);
  const top = (start.getHours() + start.getMinutes() / 60 - GRID_START_HOUR) * HOUR_PX;
  const height = Math.max(26, ((end - start) / 3600000) * HOUR_PX - 3);
  const isCompact = height < 44;
  const isNarrowWeekPill = view === "week" && columns > 1;
  const isDone = item.status === "Completed";
  const isNoShow = item.status === "NoShow";
  const attendanceNeeded = appointmentNeedsAttendance(item);
  const paymentAttention = appointmentPaymentAttention(item, item.paymentHold, bookingSettings);
  const displayName = item.client?.fullName || item.guestName || item.subject;
  const ModeIcon = MEETING_MODE_ICON[item.meetingMode] || MapPin;
  const outerGutter = 5;
  const columnGap = 4;
  const horizontalStyle = columns === 1
    ? { left: 6, right: 6 }
    : {
        left: `calc(${(column * 100) / columns}% + ${outerGutter + columnGap * column - (column * (outerGutter * 2 + columnGap * (columns - 1))) / columns}px)`,
        width: `calc(${100 / columns}% - ${(outerGutter * 2 + columnGap * (columns - 1)) / columns}px)`,
      };

  return (
    <button
      type="button"
      onClick={onSelect}
      onMouseEnter={(event) => onHoverStart(item, tone, event.currentTarget.getBoundingClientRect())}
      onMouseLeave={onHoverEnd}
      onFocus={(event) => onHoverStart(item, tone, event.currentTarget.getBoundingClientRect())}
      onBlur={onHoverEnd}
      title={`${displayName} · ${formatTime(item.startsAt)}–${formatTime(item.endsAt)}${isDone ? " · Attended" : isNoShow ? " · No-show" : attendanceNeeded ? " · Attendance needed" : ""}${paymentAttention ? ` · ${paymentAttention}` : ""}`}
      aria-label={`${displayName}, ${formatTime(item.startsAt)} to ${formatTime(item.endsAt)}${isDone ? ", attended" : isNoShow ? ", no-show" : attendanceNeeded ? ", attendance needed" : ""}${paymentAttention ? `, ${paymentAttention}` : ""}`}
      className={`absolute z-[1] flex min-w-0 flex-col justify-center overflow-hidden rounded-xl border-l-4 px-2.5 text-left shadow-[0_4px_12px_rgba(15,23,42,0.05)] transition-[background-color,box-shadow,opacity] duration-[3800ms] hover:z-20 hover:shadow-[0_10px_24px_rgba(15,23,42,0.12)] focus:z-20 ${isCompact ? "py-1" : "py-1.5"} ${tone.block} ${tone.emphasis || ""} ${isDone && !paymentAttention ? "opacity-70" : ""} ${paymentAttention ? "ring-1 ring-inset ring-amber-300" : ""} ${isSelected ? "ring-2 ring-slate-950/70" : ""} ${isFocused ? "z-20 ring-4 ring-amber-300 shadow-[0_10px_30px_rgba(245,158,11,0.35)]" : ""}`}
      style={{ top: Math.max(0, top), height, ...horizontalStyle }}
    >
      <p className={`flex w-full items-center gap-1 overflow-hidden font-semibold leading-[1.15] ${isNarrowWeekPill ? "text-[11px]" : "text-[12px]"} ${isCompact ? "whitespace-nowrap text-ellipsis" : isNarrowWeekPill ? "line-clamp-3" : "line-clamp-2"} ${tone.title}`}>
        <ModeIcon className="h-3 w-3 shrink-0" />
        {isDone ? <Check className="h-3 w-3 shrink-0" /> : null}
        {paymentAttention ? <Wallet className="h-3 w-3 shrink-0 text-amber-600" aria-label={paymentAttention} /> : null}
        <span className="min-w-0 overflow-hidden text-ellipsis">{displayName}</span>
      </p>
      {!isCompact && !isNarrowWeekPill ? (
        <p className={`mt-0.5 truncate text-[11px] leading-tight ${tone.meta}`}>
          {formatTime(item.startsAt)}
          {item.sessionType ? ` · ${item.sessionType.name}` : ""}
          {isNoShow ? " · No-show" : ""}
          {attendanceNeeded ? " · Attendance needed" : ""}
          {paymentAttention ? ` · ${paymentAttention}` : ""}
        </p>
      ) : null}
    </button>
  );
}

function EventDetails({ appointment, tone, onClose, onCancel, cancelling, onRescheduled, onConverted, onOpenNotes, onStatus, onPaymentUpdated, role, settings }) {
  const start = new Date(appointment.startsAt);
  const effectiveClient = appointment.client || appointment.matchedClient || null;
  const clientProfilePath = effectiveClient?.id
    ? `/app/clients/${effectiveClient.id}`
    : null;
  const person = effectiveClient?.fullName || appointment.guestName || "No contact";
  const initials = person.split(" ").filter(Boolean).map((part) => part[0]).join("").slice(0, 2).toUpperCase();
  const [resched, setResched] = useState(false);
  const [reschedDate, setReschedDate] = useState(dateKey(start > new Date() ? start : new Date()));
  const [reschedSlots, setReschedSlots] = useState(null);
  const [reschedSlot, setReschedSlot] = useState(null);
  const [reschedBusy, setReschedBusy] = useState(false);
  const [reschedError, setReschedError] = useState("");
  const [reschedMode, setReschedMode] = useState(appointment.meetingMode || "InPerson");
  const locations = Array.isArray(settings?.locations) ? settings.locations : [];
  const currentLocationId = locations.find((item) => `${item.name} — ${item.address}` === appointment.location)?.id || "";
  const [reschedLocationId, setReschedLocationId] = useState(currentLocationId || (locations.length === 1 ? locations[0].id : ""));
  const [converting, setConverting] = useState(false);
  const [seriesScope, setSeriesScope] = useState("single");
  const [refundEstimate, setRefundEstimate] = useState(null);
  const [confirmingCancel, setConfirmingCancel] = useState(false);
  const [checkingRefund, setCheckingRefund] = useState(false);
  const duration = Math.round((new Date(appointment.endsAt) - start) / 60000);
  const [payNow, setPayNow] = useState(() => appointment.paymentHold ? {
    id: appointment.paymentHold.id,
    status: appointment.paymentHold.status,
    amount: appointment.paymentHold.amount,
    payNowUrl: appointment.paymentHold.status === "AwaitingPayment" ? appointment.paymentHold.qbInvoiceLink : null,
    paidAt: appointment.paymentHold.paidAt,
    paymentMethod: appointment.paymentHold.paymentMethod,
    paymentReference: appointment.paymentHold.manualPaymentReference,
    paymentError: appointment.paymentHold.paymentError,
    invoiceNumber: appointment.paymentHold.qbInvoiceNumber,
  } : appointment.paymentApprovals?.[0] ? {
    id: appointment.paymentApprovals[0].id,
    status: appointment.paymentApprovals[0].status === "Failed" ? "ApprovalFailed" : "PendingApproval",
    amount: appointment.paymentApprovals[0].amount,
    paymentMethod: appointment.paymentApprovals[0].method,
    paymentReference: appointment.paymentApprovals[0].transactionReference,
    paymentError: appointment.paymentApprovals[0].processingError,
  } : null);
  const [payNowBusy, setPayNowBusy] = useState(false);
  const [payNowError, setPayNowError] = useState("");
  const [payNowCopied, setPayNowCopied] = useState(false);
  const [manualReference, setManualReference] = useState(
    appointment.paymentHold?.manualPaymentReference || "",
  );
  const [manualNote, setManualNote] = useState("");
  const [manualEntryMethod, setManualEntryMethod] = useState("");
  const [manualPaymentDate, setManualPaymentDate] = useState(appointment.paymentHold?.paidAt ? dateKey(new Date(appointment.paymentHold.paidAt)) : dateKey(new Date()));
  const [paidDetailsOpen, setPaidDetailsOpen] = useState(false);
  const [paidDetailsMethod, setPaidDetailsMethod] = useState(["Cash", "ETransfer"].includes(appointment.paymentHold?.paymentMethod) ? appointment.paymentHold.paymentMethod : "ETransfer");
  const [manualBusy, setManualBusy] = useState("");
  const [manualError, setManualError] = useState("");
  const paymentAttention = appointmentPaymentAttention(appointment, payNow, settings);
  const paymentLinkDelivery = payNow?.delivery || [];
  const paymentLinkChannels = [
    paymentLinkDelivery.some((item) => item.channel === "email") ? "email" : null,
    paymentLinkDelivery.some((item) => item.channel === "sms") ? "SMS" : null,
  ].filter(Boolean);
  const paymentLinkDeliveryFailed = paymentLinkDelivery.some((item) => item.status === "failed");
  const paymentLinkDeliveryPending = paymentLinkDelivery.some((item) => ["pending", "processing"].includes(item.status));
  const meetingSyncLabel = appointment.meetingSyncStatus === "Pending"
    ? "preparing link"
    : appointment.meetingSyncStatus === "Retrying"
      ? "temporary issue · retrying automatically"
      : appointment.meetingSyncStatus === "Failed"
        ? "link setup failed"
        : "";

  // Free/unpaid appointments cancel immediately, same as before — the
  // extra confirmation step only appears when there's an actual paid hold
  // to disclose the refund-fee impact of.
  async function requestCancel() {
    setCheckingRefund(true);
    try {
      const estimate = await getAppointmentRefundEstimate(appointment.id);
      if (estimate) {
        setRefundEstimate(estimate);
        setConfirmingCancel(true);
      } else {
        onCancel(seriesScope);
      }
    } catch {
      onCancel(seriesScope);
    } finally {
      setCheckingRefund(false);
    }
  }

  async function generatePayNowLink() {
    setPayNowBusy(true);
    setPayNowError("");
    try {
      const result = await createWalkInPayNowLink(appointment.id);
      setPayNow(result);
      onPaymentUpdated?.(result);
    } catch (reason) {
      setPayNowError(reason.response?.data?.message || "Could not generate a pay-now link.");
    } finally {
      setPayNowBusy(false);
    }
  }

  async function copyPayNowLink() {
    if (!payNow?.payNowUrl) return;
    try {
      await navigator.clipboard.writeText(payNow.payNowUrl);
      setPayNowCopied(true);
      window.setTimeout(() => setPayNowCopied(false), 2000);
    } catch { /* clipboard access denied — link is still shown on screen */ }
  }

  async function recordManualPayment(method) {
    if (method !== "Cash" && !manualReference.trim()) {
      setManualError("Enter the e-transfer transaction number first.");
      return;
    }
    setManualBusy(method);
    setManualError("");
    try {
      const result = await recordWalkInManualPayment(appointment.id, {
        method,
        transactionReference: manualReference.trim() || undefined,
        paymentDate: manualPaymentDate,
        note: manualNote.trim() || undefined,
      });
      setPayNow(result);
      setManualNote("");
      setManualEntryMethod("");
      onPaymentUpdated?.(result);
    } catch (reason) {
      setManualError(reason.response?.data?.message || "Could not record this payment.");
    } finally {
      setManualBusy("");
    }
  }

  async function savePaidPaymentDetails() {
    if (paidDetailsMethod !== "Cash" && !manualReference.trim()) {
      setManualError("Enter the e-transfer transaction number first.");
      return;
    }
    setManualBusy("details");
    setManualError("");
    try {
      const result = await updatePaidAppointmentPaymentDetails(appointment.id, {
        method: paidDetailsMethod,
        transactionReference: manualReference.trim() || undefined,
        paymentDate: manualPaymentDate,
      });
      setPayNow(result);
      setPaidDetailsOpen(false);
      onPaymentUpdated?.(result);
    } catch (reason) {
      setManualError(reason.response?.data?.message || "Could not update the payment details.");
    } finally {
      setManualBusy("");
    }
  }

  useEffect(() => {
    const paymentHold = appointment.paymentHold;
    if (!paymentHold?.id) {
      const approval = appointment.paymentApprovals?.[0];
      setPayNow(approval ? {
        id: approval.id,
        status: approval.status === "Failed" ? "ApprovalFailed" : "PendingApproval",
        amount: approval.amount,
        paymentMethod: approval.method,
        paymentReference: approval.transactionReference,
        paymentError: approval.processingError,
      } : null);
      return;
    }

    setPayNow({
      id: paymentHold.id,
      status: paymentHold.status,
      amount: paymentHold.amount,
      payNowUrl: paymentHold.status === "AwaitingPayment" ? paymentHold.qbInvoiceLink : null,
      paidAt: paymentHold.paidAt,
      paymentMethod: paymentHold.paymentMethod,
      paymentReference: paymentHold.manualPaymentReference,
      paymentError: paymentHold.paymentError,
      invoiceNumber: paymentHold.qbInvoiceNumber,
    });
    setManualReference(paymentHold.manualPaymentReference || "");
    setManualPaymentDate(paymentHold.paidAt ? dateKey(new Date(paymentHold.paidAt)) : dateKey(new Date()));
    setPaidDetailsMethod(["Cash", "ETransfer"].includes(paymentHold.paymentMethod) ? paymentHold.paymentMethod : "ETransfer");
    setPaidDetailsOpen(false);
  }, [appointment.id, appointment.paymentHold, appointment.paymentApprovals]);

  useEffect(() => {
    if (!payNow?.id || !["AwaitingPayment", "Confirming", "Expired"].includes(payNow.status)) return undefined;

    let active = true;
    let timer = null;

    async function refreshPayment() {
      try {
        const result = await getBookingPaymentHoldStatus(payNow.id);
        if (!active) return;
        setPayNow(result);
        setPayNowError("");
        if (!["AwaitingPayment", "Confirming"].includes(result.status)) onPaymentUpdated?.(result);
        if (["AwaitingPayment", "Confirming"].includes(result.status)) {
          timer = window.setTimeout(refreshPayment, 5_000);
        }
      } catch (reason) {
        if (!active) return;
        setPayNowError(reason.response?.data?.message || "Payment status could not be refreshed.");
      }
    }

    refreshPayment();

    return () => {
      active = false;
      if (timer) window.clearTimeout(timer);
    };
  }, [payNow?.id, payNow?.status, onPaymentUpdated]);

  useEffect(() => {
    if (!resched) return;
    let active = true;
    setReschedSlots(null);
    setReschedSlot(null);
    getAvailability({
      from: reschedDate,
      to: reschedDate,
      durationMinutes: duration,
      assignedToId: role === "consultant" ? undefined : appointment.assignedTo?.id || undefined,
      meetingMode: reschedMode,
      locationId: reschedMode === "InPerson" ? reschedLocationId || undefined : undefined,
    })
      .then((result) => active && setReschedSlots(result.days[reschedDate] || []))
      .catch(() => active && setReschedSlots([]));
    return () => { active = false; };
  }, [resched, reschedDate, duration, appointment.assignedTo, role, reschedMode, reschedLocationId]);

  async function confirmReschedule() {
    if (!reschedSlot) return;
    setReschedBusy(true);
    setReschedError("");
    try {
      const updated = await rescheduleBookingAppointment(appointment.id, reschedSlot.startsAt, { meetingMode: reschedMode, locationId: reschedMode === "InPerson" ? reschedLocationId : undefined, scope: seriesScope });
      onRescheduled(updated);
      setResched(false);
    } catch (reason) {
      setReschedError(reason.response?.data?.message || "Could not move the appointment.");
    } finally {
      setReschedBusy(false);
    }
  }

  async function linkGuestToClient() {
    setConverting(true);
    try {
      const result = await convertAppointmentToClient(appointment.id);
      onConverted(result.clientId, result.existing);
      return true;
    }
    catch (reason) { setReschedError(reason.response?.data?.message || "Could not convert this visitor."); }
    finally { setConverting(false); }
    return false;
  }

  async function openAppointmentNotes() {
    if (!appointment.client && appointment.matchedClient) {
      const linked = await linkGuestToClient();
      if (!linked) return;
    }
    onOpenNotes();
  }

  return (
    <motion.div
      key={appointment.id}
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 6 }}
      transition={{ duration: 0.18 }}
      className="rounded-[1.4rem] border border-white/70 bg-white/85 p-5 shadow-[0_14px_40px_rgba(15,23,42,0.07)] backdrop-blur-xl"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 flex-wrap items-center gap-2.5">
          <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${tone.chip}`} />
          <h3 className="truncate text-base font-semibold text-slate-950">{appointment.subject}</h3>
          <span className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] font-bold ring-1 ring-inset ${APPOINTMENT_STATUS_TONE[appointment.status] || "bg-slate-100 text-slate-600 ring-slate-200"}`}>
            {appointment.status === "NoShow" ? "No-show" : appointment.status}
          </span>
          {paymentAttention ? (
            <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-amber-50 px-2.5 py-1 text-[10px] font-bold text-amber-700 ring-1 ring-inset ring-amber-200">
              <Wallet className="h-3 w-3" /> {paymentAttention}
            </span>
          ) : null}
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close details"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="mt-4 space-y-2.5">
        <DetailRow icon={CalendarDays}>{start.toLocaleDateString("en-CA", { weekday: "long", month: "short", day: "numeric", year: "numeric" })}</DetailRow>
        <DetailRow icon={Clock3}>{formatTime(appointment.startsAt)} – {formatTime(appointment.endsAt)}{appointment.sessionType ? ` · ${appointment.sessionType.name}` : ""}</DetailRow>
        {appointment.assignedTo ? <DetailRow icon={UserRound}>{appointment.assignedTo.fullName}</DetailRow> : null}
        {appointment.meetingMode === "Phone" ? <DetailRow icon={Phone}>Phone call — the office calls the client{appointment.meetingPhoneNumber ? ` from ${appointment.meetingPhoneNumber}` : ""}</DetailRow> : null}
        {appointment.location ? <DetailRow icon={MapPin}>{appointment.location}</DetailRow> : null}
        {["Online", "Zoom"].includes(appointment.meetingMode) ? <DetailRow icon={Video}>{appointment.meetingMode === "Zoom" ? "Zoom video call" : "Jitsi video call"}{meetingSyncLabel ? ` · ${meetingSyncLabel}` : ""}</DetailRow> : null}
        <DetailRow icon={Bell}>Reminder set from workspace scheduling rules</DetailRow>
      </div>

      {appointment.meetingMode === "Zoom" && appointment.meetingSyncStatus === "Failed" ? (
        <p className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 px-3.5 py-3 text-xs leading-5 text-rose-700">
          The client’s Zoom link could not be prepared after automatic retries. Reconnect or correct Zoom in Scheduling, then reschedule this appointment to retry synchronization.
          {appointment.meetingSyncError ? <span className="mt-1 block font-medium">{appointment.meetingSyncError}</span> : null}
        </p>
      ) : null}

      <div className="mt-4 flex items-center gap-3 rounded-2xl bg-slate-50/90 px-3.5 py-3">
        {clientProfilePath ? (
          <Link
            to={clientProfilePath}
            aria-label={`Open ${person}'s client profile`}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-slate-700 to-slate-950 text-xs font-semibold text-white shadow-sm transition hover:scale-105 hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-2"
          >
            {initials}
          </Link>
        ) : (
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-slate-700 to-slate-950 text-xs font-semibold text-white">
            {initials}
          </span>
        )}
        <div className="min-w-0 flex-1">
          {clientProfilePath ? (
            <Link
              to={clientProfilePath}
              className="group inline-flex max-w-full items-center rounded-md focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-2"
            >
              <span className="truncate text-sm font-semibold text-slate-900 transition group-hover:text-sky-700 group-hover:underline group-hover:decoration-sky-300 group-hover:underline-offset-4">
                {person}
              </span>
            </Link>
          ) : (
            <p className="truncate text-sm font-semibold text-slate-900">{person}</p>
          )}
          <p className="text-xs text-slate-400">{effectiveClient ? "Client" : "Walk-in guest"}{appointment.case ? ` · ${appointment.case.caseType}` : ""}</p>
          {!effectiveClient ? (
            <button type="button" disabled={converting} onClick={linkGuestToClient} className="mt-2 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-[11px] font-semibold text-slate-700 transition hover:border-sky-300 disabled:opacity-50">
              {converting ? "Saving…" : "Save as client"}
            </button>
          ) : ["admin", "consultant"].includes(role) ? (
            <button type="button" disabled={converting} onClick={openAppointmentNotes} className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-violet-50 px-3 py-1.5 text-[11px] font-semibold text-violet-700 transition hover:bg-violet-100 disabled:opacity-50">
              {converting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <NotebookPen className="h-3.5 w-3.5" />} {converting ? "Linking…" : "Appointment notes"}
            </button>
          ) : null}
        </div>
      </div>

      {appointment.description ? (
        <div className="mt-4 rounded-2xl border border-sky-100 bg-sky-50/70 px-4 py-3">
          <p className="text-xs font-bold uppercase tracking-[0.14em] text-sky-600">About</p>
          <p className="mt-1 text-base font-medium leading-6 text-slate-900">{appointment.description}</p>
        </div>
      ) : null}

      {appointment.meetingUrl ? (
        <a
          href={appointment.meetingUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-4 flex h-11 w-full items-center justify-center gap-2 rounded-full bg-sky-600 text-sm font-semibold text-white transition hover:bg-sky-700"
        >
          <Video className="h-4 w-4" /> Join {appointment.meetingMode === "Zoom" ? "Zoom" : "Jitsi"} video call
        </a>
      ) : null}

      {appointment.status === "Scheduled" && appointment.isFreeConsultation ? (
        <p className="mt-4 flex items-center gap-2 rounded-2xl border border-emerald-200/80 bg-emerald-50/70 p-3.5 text-sm font-semibold text-emerald-700"><Check className="h-4 w-4" /> Free consultation — no fee due</p>
      ) : null}

      {!appointment.isFreeConsultation ? (
        <div className="mt-4 rounded-2xl border border-slate-200/80 bg-slate-50/70 p-3.5">
          {payNow ? (
            payNow.status === "Paid" ? (
              <div>
                <p className="flex items-center gap-2 text-sm font-semibold text-emerald-700"><Check className="h-4 w-4" /> Consultation fee paid{payNow.paymentMethod ? ` by ${payNow.paymentMethod === "ETransfer" ? "e-transfer" : payNow.paymentMethod.toLowerCase()}` : ""}</p>
                {payNow.paymentReference ? <p className="mt-1 text-xs font-medium text-slate-500">Transaction #{payNow.paymentReference}</p> : null}
                {payNow.invoiceNumber ? <p className="mt-1 text-xs text-slate-400">QuickBooks invoice #{payNow.invoiceNumber}</p> : null}
                {payNow.paymentMethod === "ETransfer" && !payNow.paymentReference ? (
                  paidDetailsOpen ? (
                    <div className="mt-3 space-y-2 rounded-2xl border border-amber-200 bg-amber-50/70 p-3">
                      <div className="grid grid-cols-2 gap-1 rounded-xl bg-white/80 p-1">{[["ETransfer", "E-transfer"], ["Cash", "Cash"]].map(([value, label]) => <button key={value} type="button" onClick={() => setPaidDetailsMethod(value)} className={`h-8 rounded-lg text-[11px] font-semibold ${paidDetailsMethod === value ? "bg-slate-950 text-white" : "text-slate-500"}`}>{label}</button>)}</div>
                      <input value={manualReference} onChange={(event) => setManualReference(event.target.value)} maxLength={100} placeholder={paidDetailsMethod === "ETransfer" ? "Transaction number" : "Receipt / reference (optional)"} className="h-9 w-full rounded-xl border border-slate-200 bg-white px-3 text-xs outline-none focus:border-sky-400" />
                      <input type="date" max={dateKey(new Date())} value={manualPaymentDate} onChange={(event) => setManualPaymentDate(event.target.value)} className="h-9 w-full rounded-xl border border-slate-200 bg-white px-3 text-xs outline-none focus:border-sky-400" />
                      <div className="flex gap-2"><button type="button" disabled={Boolean(manualBusy)} onClick={() => setPaidDetailsOpen(false)} className="h-9 flex-1 rounded-full bg-white text-xs font-semibold text-slate-600">Cancel</button><button type="button" disabled={Boolean(manualBusy) || (paidDetailsMethod !== "Cash" && !manualReference.trim())} onClick={savePaidPaymentDetails} className="flex h-9 flex-1 items-center justify-center gap-1 rounded-full bg-slate-950 text-xs font-semibold text-white">{manualBusy === "details" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null} Save details</button></div>
                      {manualError ? <p className="text-xs text-rose-600">{manualError}</p> : null}
                    </div>
                  ) : <button type="button" onClick={() => setPaidDetailsOpen(true)} className="mt-2 text-xs font-semibold text-amber-700 underline decoration-amber-300 underline-offset-4">Add missing transaction number</button>
                ) : null}
              </div>
            ) : payNow.status === "Confirming" ? (
              <p className="flex items-center gap-2 text-sm font-semibold text-sky-700"><Loader2 className="h-4 w-4 animate-spin" /> Confirming card payment…</p>
            ) : payNow.status === "RecordingPayment" ? (
              <p className="flex items-center gap-2 text-sm font-semibold text-sky-700"><Loader2 className="h-4 w-4 animate-spin" /> Recording payment…</p>
            ) : payNow.status === "PendingApproval" ? (
              <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5"><p className="flex items-center gap-1.5 text-xs font-semibold text-amber-800"><ClipboardCheck className="h-3.5 w-3.5" /> Payment request sent</p><p className="mt-1 text-xs leading-5 text-amber-700">Waiting for administrator approval. This request was submitted successfully; do not enter the payment again. You will receive a notification when it is approved or rejected.</p></div>
            ) : payNow.status === "ApprovalFailed" ? (
              <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2.5"><p className="text-xs font-semibold text-rose-700">Administrator review needs attention</p><p className="mt-1 text-xs leading-5 text-rose-600">{payNow.paymentError || "The approved payment could not be processed. An administrator can retry it from Payment approvals."}</p></div>
            ) : payNow.status === "PaymentFailed" ? (
              <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2.5">
                <p className="text-xs font-semibold text-rose-700">Payment record needs attention</p>
                <p className="mt-1 text-xs leading-5 text-rose-600">{payNow.paymentError || "QuickBooks could not record this payment. Correct the issue and retry below."} The appointment remains scheduled.</p>
              </div>
            ) : payNow.status === "AwaitingPayment" && payNow.paymentMethod === "ETransfer" && !payNow.paymentReference ? (
              <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5">
                <p className="flex items-center gap-1.5 text-xs font-semibold text-amber-800"><Wallet className="h-3.5 w-3.5" /> E-transfer payment pending</p>
                <p className="mt-1 text-xs leading-5 text-amber-700">The appointment is confirmed. Enter the transaction number below after the payment is received; this warning stays active until then.</p>
                {payNow.invoiceNumber ? <p className="mt-1 text-[11px] text-amber-600">QuickBooks invoice #{payNow.invoiceNumber}</p> : null}
              </div>
            ) : payNow.status === "AwaitingPayment" ? (
              <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5">
                <p className="text-xs font-semibold text-slate-700">Consultation fee — {Number(payNow.amount).toLocaleString("en-CA", { style: "currency", currency: "CAD" })}</p>
                <p className="mt-1 flex items-center gap-1.5 text-xs font-semibold text-amber-700"><Wallet className="h-3.5 w-3.5" /> Payment pending</p>
                <p className="mt-1 text-xs text-amber-700">This stays outstanding even after the consultation is marked attended.</p>
                {paymentLinkChannels.length ? <p className={`mt-1 text-[11px] font-medium ${paymentLinkDeliveryFailed ? "text-rose-600" : "text-amber-600"}`}>{paymentLinkDeliveryFailed ? "The payment link could not be delivered through every available channel." : paymentLinkDeliveryPending ? `Payment link is being sent by ${paymentLinkChannels.join(" and ")}.` : `Payment link sent by ${paymentLinkChannels.join(" and ")}.`}</p> : null}
                {payNow.payNowUrl ? <button type="button" onClick={copyPayNowLink} className="mt-2 flex h-9 w-full items-center justify-center gap-1.5 rounded-full bg-slate-950 text-xs font-semibold text-white transition hover:bg-slate-800">
                  {payNowCopied ? <Check className="h-3.5 w-3.5 text-emerald-300" /> : <Copy className="h-3.5 w-3.5" />} {payNowCopied ? "Link copied" : "Copy pay-now link"}
                </button> : null}
              </div>
            ) : ["Expired", "Voided", "Failed"].includes(payNow.status) ? (
              <p className="text-xs leading-5 text-amber-700">The previous payment request is no longer active. The client will not be asked to use that checkout again.</p>
            ) : (
              <p className="text-xs leading-5 text-amber-700">Invoice created in QuickBooks, but online card payment isn't available on this company yet. Collect payment via cash or e-transfer instead.</p>
            )
          ) : appointmentRequiresPaymentRecord(appointment, settings) ? (
            <div>
              <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5">
                <p className="flex items-center gap-1.5 text-xs font-semibold text-amber-800"><Wallet className="h-3.5 w-3.5" /> Payment not recorded</p>
                <p className="mt-1 text-xs leading-5 text-amber-700">This consultation {appointment.status === "Completed" ? "was attended" : "is scheduled"}, but no payment or payment method is recorded. The warning remains until payment is recorded.</p>
              </div>
            </div>
          ) : (
            <p className="text-xs leading-5 text-slate-500">No consultation payment is recorded. If payment was received previously, record it below to restore the billing history.</p>
          )}
          {payNowError ? <p className="mt-2 text-xs text-rose-600">{payNowError}</p> : null}
          {!["Paid", "Confirming", "PendingApproval", "ApprovalFailed"].includes(payNow?.status) ? (
            <div className="mt-3 border-t border-slate-200/70 pt-3">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Collect consultation payment</p>
              <div className="mt-2 grid grid-cols-3 gap-2">
                <button type="button" disabled={Boolean(manualBusy) || payNowBusy} onClick={() => { setManualEntryMethod(""); generatePayNowLink(); }} className="flex h-9 items-center justify-center gap-1 rounded-full border border-sky-200 bg-sky-50 px-2 text-[11px] font-semibold text-sky-700 transition hover:bg-sky-100 disabled:opacity-50">
                  {payNowBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Wallet className="h-3.5 w-3.5" />} Card
                </button>
                {[["ETransfer", "E-transfer"], ["Cash", "Cash"]].map(([method, label]) => (
                  <button key={method} type="button" disabled={Boolean(manualBusy) || payNowBusy} onClick={() => { setManualEntryMethod(method); setManualError(""); }} className={`flex h-9 items-center justify-center gap-1 rounded-full border px-2 text-[11px] font-semibold transition disabled:opacity-50 ${manualEntryMethod === method ? "border-slate-950 bg-slate-950 text-white" : "border-slate-200 bg-white text-slate-700 hover:border-emerald-300 hover:bg-emerald-50"}`}>
                    {label}
                  </button>
                ))}
              </div>
              <p className="mt-2 text-[11px] leading-4 text-slate-500">Card sends the secure payment link by email, SMS, or both—using the contact details on this appointment.</p>
              {manualEntryMethod ? (
                <div className="mt-2 space-y-2 rounded-2xl border border-slate-200 bg-white p-3">
                  <input
                    type="text"
                    value={manualReference}
                    onChange={(event) => setManualReference(event.target.value)}
                    maxLength={100}
                    placeholder={manualEntryMethod === "ETransfer" ? "E-transfer transaction number" : "Cash receipt / reference (optional)"}
                    className="h-9 w-full rounded-full border border-slate-200 bg-white px-3.5 text-xs text-slate-700 outline-none transition focus:border-sky-400 focus:ring-2 focus:ring-sky-100"
                  />
                  <input type="date" max={dateKey(new Date())} value={manualPaymentDate} onChange={(event) => setManualPaymentDate(event.target.value)} className="h-9 w-full rounded-full border border-slate-200 bg-white px-3.5 text-xs text-slate-700 outline-none transition focus:border-sky-400 focus:ring-2 focus:ring-sky-100" />
                  <input
                    type="text"
                    value={manualNote}
                    onChange={(event) => setManualNote(event.target.value)}
                    placeholder="Note (optional)"
                    className="h-9 w-full rounded-full border border-slate-200 bg-white px-3.5 text-xs text-slate-700 outline-none transition focus:border-sky-400 focus:ring-2 focus:ring-sky-100"
                  />
                  <button type="button" disabled={Boolean(manualBusy) || (manualEntryMethod === "ETransfer" && !manualReference.trim())} onClick={() => recordManualPayment(manualEntryMethod)} className="flex h-9 w-full items-center justify-center gap-1.5 rounded-full bg-slate-950 text-xs font-semibold text-white transition hover:bg-slate-800 disabled:opacity-40">
                    {manualBusy === manualEntryMethod ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}Record {manualEntryMethod === "ETransfer" ? "e-transfer" : "cash"} payment
                  </button>
                </div>
              ) : null}
              {manualError ? <p className="mt-2 text-xs text-rose-600">{manualError}</p> : null}
            </div>
          ) : null}
        </div>
      ) : null}

      {resched ? (
        <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50/80 p-3.5">
          <p className="text-xs font-semibold text-slate-700">Move to</p>
          {appointment.seriesKey && appointment.status === "Scheduled" ? <div className="mt-2 flex rounded-xl bg-slate-100 p-1">{[["single", "This appointment"], ["series", "This & future"]].map(([value, label]) => <button key={value} type="button" onClick={() => setSeriesScope(value)} className={`flex-1 rounded-lg px-2 py-1.5 text-[11px] font-semibold ${seriesScope === value ? "bg-white text-slate-900 shadow-sm" : "text-slate-500"}`}>{label}</button>)}</div> : null}
          <input
            type="date"
            min={dateKey(new Date())}
            value={reschedDate}
            onChange={(event) => setReschedDate(event.target.value)}
            className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm shadow-sm outline-none focus:border-sky-400"
          />
          <div className="mt-2 grid grid-cols-2 gap-1.5">
            {[["InPerson", "In person"], ["Phone", "Phone"], ["Online", "Jitsi"], ["Zoom", "Zoom"]]
              .filter(([value]) => (appointment.sessionType?.allowedMeetingModes || ["InPerson", "Online"]).includes(value))
              .filter(([value]) => value !== "Phone" || settings?.phoneBookingEnabled === true)
              .filter(([value]) => value !== "Online" || settings?.onlineBookingEnabled !== false)
              .filter(([value]) => value !== "Zoom" || (settings?.zoomBookingEnabled === true && appointment.assignedTo?.zoomHostMapping?.status === "active"))
              .map(([value, label]) => <button key={value} type="button" onClick={() => { setReschedMode(value); setReschedSlot(null); }} className={`rounded-xl border px-2 py-2 text-xs font-semibold ${reschedMode === value ? "border-slate-950 bg-slate-950 text-white" : "border-slate-200 bg-white text-slate-600"}`}>{label}</button>)}
          </div>
          {reschedMode === "InPerson" && locations.length ? <Select value={reschedLocationId} onChange={(event) => setReschedLocationId(event.target.value)} className="mt-2 w-full" ariaLabel="Office location"><option value="">Choose a location…</option>{locations.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</Select> : null}
          {reschedSlots === null ? (
            <p className="mt-2 flex items-center gap-2 text-xs text-slate-400"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Checking…</p>
          ) : reschedSlots.length ? (
            <div className="mt-2 grid max-h-[130px] grid-cols-3 gap-1.5 overflow-y-auto">
              {reschedSlots.map((slotOption) => (
                <button key={slotOption.startsAt} type="button" onClick={() => setReschedSlot(slotOption)} className={`rounded-lg px-1.5 py-1.5 text-[11px] font-semibold transition ${reschedSlot?.startsAt === slotOption.startsAt ? "bg-slate-950 text-white" : "border border-slate-200 bg-white text-slate-700 hover:border-sky-300"}`}>
                  {formatTime(slotOption.startsAt)}
                </button>
              ))}
            </div>
          ) : (
            <p className="mt-2 text-xs text-slate-400">No open times that day.</p>
          )}
          {reschedError ? <p className="mt-2 text-xs text-rose-600">{reschedError}</p> : null}
          <div className="mt-3 grid grid-cols-2 gap-2">
            <button type="button" onClick={() => setResched(false)} className="h-9 rounded-full text-xs font-semibold text-slate-600 transition hover:bg-slate-100">Back</button>
            <button type="button" disabled={!reschedSlot || reschedBusy} onClick={confirmReschedule} className="flex h-9 items-center justify-center gap-1.5 rounded-full bg-slate-950 text-xs font-semibold text-white disabled:opacity-40">
              {reschedBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null} Confirm
            </button>
          </div>
        </div>
      ) : confirmingCancel ? (
        <div className="mt-4 space-y-3">
          <RefundFeeNotice estimate={refundEstimate} audience="staff" />
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setConfirmingCancel(false)}
              disabled={cancelling}
              className="flex h-11 items-center justify-center gap-1.5 rounded-full border border-slate-200 bg-white text-sm font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-slate-50 disabled:opacity-60"
            >
              Keep appointment
            </button>
            <button
              type="button"
              onClick={() => onCancel(seriesScope)}
              disabled={cancelling}
              className="flex h-11 items-center justify-center gap-2 rounded-full border border-rose-200 bg-rose-50 text-sm font-semibold text-rose-700 transition hover:bg-rose-100 disabled:opacity-60"
            >
              {cancelling ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />} Cancel anyway
            </button>
          </div>
        </div>
      ) : (
        <div className="mt-4 grid grid-cols-2 gap-2">
          {appointment.status === "Scheduled" && start > new Date() ? <><button
            type="button"
            onClick={() => setResched(true)}
            className="flex h-11 items-center justify-center gap-1.5 rounded-full border border-slate-200 bg-white text-sm font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-slate-50"
          >
            <CalendarDays className="h-4 w-4" /> Reschedule
          </button>
          <button
            type="button"
            onClick={requestCancel}
            disabled={cancelling || checkingRefund}
            className="flex h-11 items-center justify-center gap-2 rounded-full border border-rose-200 bg-rose-50 text-sm font-semibold text-rose-700 transition hover:bg-rose-100 disabled:opacity-60"
          >
            {cancelling || checkingRefund ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />} Cancel
          </button></> : null}
          {appointment.status === "Scheduled" && start > new Date() && appointment.seriesKey ? <div className="col-span-2 flex rounded-xl bg-slate-100 p-1">{[["single", "Only this appointment"], ["series", "This and future appointments"]].map(([value, label]) => <button key={value} type="button" onClick={() => setSeriesScope(value)} className={`flex-1 rounded-lg px-2 py-1.5 text-[10px] font-semibold ${seriesScope === value ? "bg-white text-slate-900 shadow-sm" : "text-slate-500"}`}>{label}</button>)}</div> : null}
          {appointment.status === "Scheduled" && start <= new Date() ? <>
            {role !== "frontdesk" ? <button type="button" onClick={() => onStatus("Completed")} className="h-10 rounded-full border border-emerald-200 bg-emerald-50 text-xs font-semibold text-emerald-700 transition hover:bg-emerald-100">Mark attended</button> : null}
            <button type="button" onClick={() => onStatus("NoShow")} className={`h-10 rounded-full border border-amber-200 bg-amber-50 text-xs font-semibold text-amber-700 transition hover:bg-amber-100 ${role === "frontdesk" ? "col-span-2" : ""}`}>Mark no-show</button>
          </> : null}
          {appointment.status !== "Scheduled" ? (
            <div className="col-span-2 space-y-2">
              <div className={`rounded-2xl px-4 py-3 text-center text-xs font-semibold ${appointment.status === "Completed" ? "bg-emerald-50 text-emerald-700" : appointment.status === "Cancelled" ? "bg-rose-50 text-rose-700" : "bg-amber-50 text-amber-700"}`}>
                {appointment.status === "Completed" ? "This appointment was marked attended." : appointment.status === "Cancelled" ? "This appointment was cancelled." : "This appointment was marked no-show."}
              </div>
              {appointment.status === "Completed" && role === "admin" ? (
                <button type="button" onClick={() => onStatus("Scheduled")} className="h-10 w-full rounded-full border border-slate-200 bg-white text-xs font-semibold text-slate-600 transition hover:border-slate-300 hover:bg-slate-50">Unmark attended</button>
              ) : null}
              {appointment.status === "NoShow" ? (
                <div className="space-y-2 rounded-2xl border border-amber-200/80 bg-amber-50/60 p-3">
                  {role !== "frontdesk" ? (
                    <div className="px-1 pb-1">
                      <p className="text-xs font-semibold text-slate-800">Was the consultation completed another way?</p>
                      <p className="mt-1 text-[11px] leading-4 text-slate-500">Correct the attendance record without changing the original appointment time.</p>
                    </div>
                  ) : null}
                  {role !== "frontdesk" ? (
                    <button type="button" onClick={() => onStatus("Completed")} className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2">
                      <Check className="h-4 w-4" /> Mark as attended
                    </button>
                  ) : null}
                  <button type="button" onClick={() => setResched(true)} className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-amber-200 bg-white px-4 py-2.5 text-sm font-semibold text-amber-800 shadow-sm transition hover:border-amber-300 hover:bg-amber-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 focus-visible:ring-offset-2">
                    <CalendarDays className="h-4 w-4" /> Reschedule missed appointment
                  </button>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      )}
    </motion.div>
  );
}

function NewAppointmentSheet({ open, onClose, onCreated, onRefresh, staff, sessionTypes, role, userId, initialDate, initialClient, initialLead, initialIntake, settings }) {
  const locations = Array.isArray(settings?.locations) ? settings.locations : [];
  // Set once at mount and never again — distinguishes "the sheet is open
  // because a draft was restored on page load" from every other reason
  // `open` might be true, so the reset effect below only skips its normal
  // clear-the-form behavior on that one specific restore.
  const isRestoringDraft = useRef(Boolean(open) && Boolean(readAppointmentDraft()));
  const [form, setForm] = useState(() => readAppointmentDraft()?.form || { mode: role === "frontdesk" ? "guest" : "client", clientId: "", leadId: "", guestName: "", guestEmail: "", guestPhone: "", sessionTypeId: "", assignedToId: "", date: dateKey(new Date()), startsAt: "", subject: "", description: "", location: "", locationId: locations.length === 1 ? locations[0].id : "", meetingMode: "InPerson", recurrenceFrequency: "NONE", recurrenceCount: 2, paymentMethod: "", paymentReference: "", idempotencyKey: newBookingOperationKey() });
  const [selectedClient, setSelectedClient] = useState(() => readAppointmentDraft()?.selectedClient || null);
  const [slots, setSlots] = useState(null);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [freeEligibility, setFreeEligibility] = useState(null);
  const [pendingHold, setPendingHold] = useState(null);
  const [bookedWarning, setBookedWarning] = useState(null);
  const [paymentAction, setPaymentAction] = useState("");
  const [paymentActionError, setPaymentActionError] = useState("");
  const [paymentRecipient, setPaymentRecipient] = useState("");
  const [confirmPaymentCancel, setConfirmPaymentCancel] = useState(false);
  const [shorteningSubject, setShorteningSubject] = useState(false);
  const [subjectSuggestion, setSubjectSuggestion] = useState(null);

  const searchClients = useCallback((query) => role === "frontdesk"
    ? lookupBookingClients({ search: query })
    : api.get(`/clients?limit=20${query ? `&search=${encodeURIComponent(query)}` : ""}`).then((response) => response.data.data || []),
  [role]);

  useEffect(() => {
    if (!open) return;
    if (isRestoringDraft.current) {
      // The sheet is open on this very first render because a draft was
      // restored from a reload, not because it was just freshly opened —
      // skip the usual reset so the restored form isn't immediately wiped.
      isRestoringDraft.current = false;
      return;
    }
    setForm((current) => ({
      ...current,
      startsAt: "",
      date: initialDate || current.date,
      paymentMethod: initialIntake?.action === "appointment-payment" ? initialIntake.paymentMethod || "" : "",
      paymentReference: initialIntake?.action === "appointment-payment" ? initialIntake.paymentReference || "" : "",
      idempotencyKey: newBookingOperationKey(),
      mode: initialClient ? "client" : initialLead ? "guest" : current.mode,
      clientId: initialClient?.id || "",
      leadId: initialLead?.id || "",
      guestName: initialLead ? [initialLead.firstName, initialLead.lastName].filter(Boolean).join(" ") : current.guestName,
      guestEmail: initialLead?.email || (initialLead ? "" : current.guestEmail),
      guestPhone: initialLead?.phone || (initialLead ? "" : current.guestPhone),
      assignedToId: initialLead?.ownerUserId || initialLead?.owner?.id || (role === "consultant" ? userId : current.assignedToId),
    }));
    setSelectedClient(initialClient || null);
    setError("");
    setPendingHold(null);
    setBookedWarning(null);
    setPaymentAction("");
    setPaymentActionError("");
    setPaymentRecipient("");
    setConfirmPaymentCancel(false);
  }, [open, role, userId, initialDate, initialClient, initialLead, initialIntake]);

  useEffect(() => {
    if (!open) {
      clearAppointmentDraft();
      return;
    }
    writeAppointmentDraft({ form, selectedClient });
  }, [open, form, selectedClient]);

  useEffect(() => {
    if (!open) return;
    const clientId = form.mode === "client" ? form.clientId : "";
    const guestEmail = form.mode === "guest" ? form.guestEmail.trim() : "";
    if (!clientId && !guestEmail) { setFreeEligibility(null); return; }
    const timer = setTimeout(() => {
      getFreeConsultationEligibility({ clientId: clientId || undefined, guestEmail: guestEmail || undefined, sessionTypeId: form.sessionTypeId || undefined })
        .then(setFreeEligibility)
        .catch(() => setFreeEligibility(null));
    }, 350);
    return () => clearTimeout(timer);
  }, [open, form.mode, form.clientId, form.guestEmail, form.sessionTypeId]);

  useEffect(() => {
    if (!pendingHold || !["AwaitingPayment", "Confirming"].includes(pendingHold.status)) return;
    const timer = setInterval(async () => {
      try {
        const latest = await getBookingPaymentHoldStatus(pendingHold.holdId);
        if (latest.status === "Paid" && latest.appointmentId) {
          onRefresh?.();
          onClose();
          return;
        }
        setPendingHold((current) => (current ? { ...current, ...latest } : current));
      } catch {
        // transient failure — keep polling rather than interrupting the wait
      }
    }, 4000);
    return () => clearInterval(timer);
  }, [pendingHold?.holdId, pendingHold?.status, onRefresh, onClose]);

  async function resendPaymentRequest() {
    setPaymentAction("resend");
    setPaymentActionError("");
    try {
      const latest = await resendBookingPaymentHoldRequest(pendingHold.holdId, { email: paymentRecipient || pendingHold.guestEmail });
      setPendingHold((current) => ({ ...current, ...latest, holdId: current.holdId }));
      setPaymentRecipient(latest.guestEmail || "");
    } catch (reason) {
      setPaymentActionError(reason.response?.data?.message || "The payment request could not be resent.");
    } finally {
      setPaymentAction("");
    }
  }

  async function cancelPaymentRequest() {
    setPaymentAction("cancel");
    setPaymentActionError("");
    try {
      const latest = await cancelBookingPaymentHoldRequest(pendingHold.holdId);
      setPendingHold((current) => ({ ...current, ...latest, holdId: current.holdId, payNowUrl: null }));
      setConfirmPaymentCancel(false);
      onRefresh?.();
    } catch (reason) {
      setPaymentActionError(reason.response?.data?.message || "The reservation could not be cancelled.");
    } finally {
      setPaymentAction("");
    }
  }

  const activeTypes = sessionTypes.filter((type) => type.isActive);
  // Earned eligibility remains the default. Admin and front desk may also
  // deliberately grant the dedicated free follow-up type; the API verifies
  // that narrow role/type/duration override before skipping payment.
  const contactVerifiedFreeEligible = Boolean(freeEligibility?.contactEligible);
  const canGrantFreeFollowUp = ["admin", "frontdesk"].includes(role);
  const isFreeNamedType = (type) => /free/i.test(type.name);
  useEffect(() => {
    const current = activeTypes.find((type) => type.id === form.sessionTypeId);
    if (current && isFreeNamedType(current) && !contactVerifiedFreeEligible && !canGrantFreeFollowUp) {
      setForm((c) => ({ ...c, sessionTypeId: "" }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canGrantFreeFollowUp, contactVerifiedFreeEligible, form.sessionTypeId]);
  const selectedType = activeTypes.find((type) => type.id === form.sessionTypeId) || activeTypes.find((type) => !isFreeNamedType(type)) || activeTypes[0] || null;
  const consultFeeAmount = Number(settings?.consultFeeAmount) || 0;
  const intakePaymentRequested = initialIntake?.action === "appointment-payment";
  const staffFreeFollowUpSelected = Boolean(!intakePaymentRequested && canGrantFreeFollowUp && freeEligibility?.eligible !== true && selectedType && isFreeNamedType(selectedType));
  const showsPaymentStep = intakePaymentRequested || (consultFeeAmount > 0 && freeEligibility?.eligible !== true && !staffFreeFollowUpSelected);
  const zoomCandidateId = role === "consultant" ? userId : form.assignedToId;
  const zoomHostAvailable = zoomCandidateId
    ? staff.some((member) => member.id === zoomCandidateId && member.zoomHostMapping?.status === "active")
    : staff.some((member) => member.zoomHostMapping?.status === "active");
  const meetingModes = useMemo(() => [
    ["InPerson", "In person", MapPin],
    ["Phone", "Phone", Phone],
    ["Online", "Jitsi", Video],
    ["Zoom", "Zoom", Video],
  ]
    .filter(([modeId]) => (selectedType?.allowedMeetingModes || ["InPerson", "Online"]).includes(modeId))
    .filter(([modeId]) => modeId !== "Phone" || settings?.phoneBookingEnabled === true)
    .filter(([modeId]) => modeId !== "Online" || settings?.onlineBookingEnabled !== false)
    .filter(([modeId]) => modeId !== "Zoom" || (settings?.zoomBookingEnabled === true && zoomHostAvailable)), [selectedType, settings?.phoneBookingEnabled, settings?.onlineBookingEnabled, settings?.zoomBookingEnabled, zoomHostAvailable]);

  useEffect(() => {
    if (!selectedType || meetingModes.some(([modeId]) => modeId === form.meetingMode)) return;
    setForm((current) => ({ ...current, meetingMode: meetingModes[0]?.[0] || "InPerson", startsAt: "" }));
  }, [selectedType, meetingModes, form.meetingMode]);

  // Guest-mode "this looks like an existing client" hint — mirrors the
  // backend's own email-or-phone OR match (createBookingAppointment) so the
  // hint and the auto-link it's describing never disagree about what counts
  // as a match.
  const guestEmailQuery = form.mode === "guest" && /\S+@\S+\.\S+/.test(form.guestEmail.trim()) ? form.guestEmail.trim() : "";
  const guestPhoneDigits = form.guestPhone.replace(/\D/g, "");
  const guestPhoneQuery = form.mode === "guest" && guestPhoneDigits.length >= 7 ? form.guestPhone.trim() : "";
  const searchBookingContacts = useCallback((query) => lookupBookingContacts({ search: query }), []);
  const { results: guestEmailMatches } = useClientMatches(Boolean(guestEmailQuery), guestEmailQuery, searchBookingContacts);
  const { results: guestPhoneMatches } = useClientMatches(Boolean(guestPhoneQuery), guestPhoneQuery, searchBookingContacts);
  const guestMatches = useMemo(() => {
    const merged = new Map();
    [...guestEmailMatches, ...guestPhoneMatches].forEach((contact) => merged.set(`${contact.recordType}:${contact.id}`, contact));
    return [...merged.values()];
  }, [guestEmailMatches, guestPhoneMatches]);
  const selectedGuestLead = useMemo(() => guestMatches.find((contact) => contact.recordType === "lead" && contact.id === form.leadId) || null, [guestMatches, form.leadId]);
  const phoneBookingNumber = form.mode === "client" ? selectedClient?.phone || "" : form.guestPhone || "";
  const hasValidPhoneBookingNumber = phoneBookingNumber.replace(/\D/g, "").length >= 10;

  const loadSlots = useCallback(async () => {
    const locationChoicePending = form.meetingMode === "InPerson" && locations.length > 1 && !form.locationId;
    if (!form.date || !selectedType || locationChoicePending) { setSlots(null); return; }
    setLoadingSlots(true);
    setSlots(null);
    try {
      const result = await getAvailability({
        from: form.date,
        to: form.date,
        durationMinutes: selectedType.durationMinutes,
        sessionTypeId: selectedType.id,
        assignedToId: role === "consultant" ? undefined : form.assignedToId || undefined,
        meetingMode: form.meetingMode,
        locationId: form.meetingMode === "InPerson" ? form.locationId || undefined : undefined,
      });
      setSlots(result.days[form.date] || []);
    } catch {
      setSlots([]);
    } finally {
      setLoadingSlots(false);
    }
  }, [form.date, form.assignedToId, form.meetingMode, form.locationId, selectedType, role, locations.length]);

  useEffect(() => { if (open) loadSlots(); }, [open, loadSlots]);

  function updateSubject(value) {
    setSubjectSuggestion(null);
    setForm((c) => ({ ...c, subject: value }));
  }

  async function shortenSubject() {
    try {
      setShorteningSubject(true);
      const suggestion = await shortenAppointmentSubject(form.subject);
      setSubjectSuggestion(suggestion);
    } catch (reason) {
      setError(reason.response?.data?.message || "Nova could not shorten this subject right now.");
    } finally {
      setShorteningSubject(false);
    }
  }

  function acceptSubjectSuggestion() {
    if (!subjectSuggestion) return;
    setForm((c) => ({ ...c, subject: subjectSuggestion }));
    setSubjectSuggestion(null);
  }

  async function submit(event) {
    event.preventDefault();
    if (!form.startsAt) { setError("Pick an available time."); return; }
    const trimmedSubject = form.subject.trim();
    if (!trimmedSubject) { setError("Add a subject for this appointment."); return; }
    if (/transfer details|reference number\s*:|sent from\s*:|amount\s*:.*\b(?:cad|usd)\b/i.test(trimmedSubject)) {
      setError("Use an appointment title such as Initial Consultation. Enter the e-transfer transaction number in the payment field.");
      return;
    }
    const subjectWords = subjectWordCount(trimmedSubject);
    if (subjectWords > APPOINTMENT_SUBJECT_MAX_WORDS) {
      setError(`Keep the subject to ${APPOINTMENT_SUBJECT_MAX_WORDS} words or fewer (currently ${subjectWords}).`);
      return;
    }
    if (showsPaymentStep && !form.paymentMethod) { setError("Choose how the client will pay."); return; }
    if (showsPaymentStep && !["Card", "Cash", "ETransfer", "Skip"].includes(form.paymentMethod)) { setError("Choose card, cash, or e-transfer."); return; }
    setSaving(true);
    setError("");
    try {
      const created = await createBookingAppointment({
        startsAt: form.startsAt,
        sessionTypeId: selectedType?.id,
        assignedToId: form.assignedToId || undefined,
        clientId: form.mode === "client" ? form.clientId || undefined : undefined,
        leadId: form.mode === "guest" ? form.leadId || undefined : undefined,
        guestName: form.mode === "guest" ? form.guestName : undefined,
        guestEmail: form.mode === "guest" ? form.guestEmail : undefined,
        guestPhone: form.mode === "guest" ? form.guestPhone : undefined,
        subject: form.subject || undefined,
        description: (form.description || "").trim() || undefined,
        location: form.location || undefined,
        locationId: (form.meetingMode || "InPerson") === "InPerson" ? form.locationId || undefined : undefined,
        meetingMode: form.meetingMode || "InPerson",
        source: form.mode === "guest" ? "WalkIn" : "Internal",
        recurrence: { frequency: form.recurrenceFrequency, count: form.recurrenceFrequency === "NONE" ? 1 : Number(form.recurrenceCount) },
        paymentMethod: showsPaymentStep && form.paymentMethod !== "Skip" ? form.paymentMethod : undefined,
        paymentReference: showsPaymentStep && ["Cash", "ETransfer"].includes(form.paymentMethod) ? form.paymentReference.trim() || undefined : undefined,
        staffFreeFollowUp: staffFreeFollowUpSelected,
        idempotencyKey: form.idempotencyKey,
      });
      if (created.pending) {
        setPendingHold({ ...created, holdId: created.holdId });
        setPaymentRecipient(created.guestEmail || (form.mode === "client" ? selectedClient?.email : form.guestEmail) || "");
        return;
      }
      onCreated(created);
      if (created.manualPaymentWarning) {
        setBookedWarning(created.manualPaymentWarning);
        return;
      }
      onClose();
    } catch (reason) {
      setError(reason.response?.data?.message || "The appointment could not be booked.");
      if (reason.response?.data?.code === "SLOT_TAKEN") loadSlots();
    } finally {
      setSaving(false);
    }
  }

  if (typeof document === "undefined") return null;
  const input = "w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm shadow-sm outline-none transition hover:border-slate-300 focus:border-sky-400 focus:ring-2 focus:ring-sky-100";
  const emailDelivery = pendingHold?.delivery?.find((item) => item.channel === "email") || null;
  const smsDelivery = pendingHold?.delivery?.find((item) => item.channel === "sms") || null;
  const paymentTerminal = ["Expired", "Voided", "Failed"].includes(pendingHold?.status);
  const paymentOrphaned = pendingHold?.status === "Paid" && !pendingHold?.appointmentId;
  const paymentConfirming = pendingHold?.status === "Confirming";

  return createPortal(
    <AnimatePresence>
      {open ? (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[400] flex justify-end bg-slate-950/25 backdrop-blur-[2px]" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
          <motion.aside initial={{ x: 60, opacity: 0 }} animate={{ x: 0, opacity: 1 }} exit={{ x: 60, opacity: 0 }} transition={{ type: "spring", stiffness: 380, damping: 34 }} className="flex h-full w-full max-w-[440px] flex-col overflow-hidden border-l border-white/70 bg-white/95 shadow-[-30px_0_90px_rgba(15,23,42,0.2)] backdrop-blur-2xl">
            <header className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
              <h2 className="text-lg font-semibold text-slate-950">New appointment</h2>
              <button type="button" onClick={onClose} aria-label="Close" className="flex h-9 w-9 items-center justify-center rounded-full text-slate-500 transition hover:bg-slate-100"><X className="h-5 w-5" /></button>
            </header>
            {pendingHold ? (
              <div className="flex-1 space-y-4 overflow-y-auto px-6 py-5">
                <div className={`rounded-2xl border p-4 text-center ${paymentTerminal || paymentOrphaned ? "border-amber-200 bg-amber-50/70" : "border-sky-200 bg-sky-50/70"}`}>
                  {!paymentTerminal && !paymentOrphaned ? <Loader2 className="mx-auto h-6 w-6 animate-spin text-sky-600" /> : <X className="mx-auto h-6 w-6 text-amber-600" />}
                  <p className="mt-3 text-sm font-semibold text-slate-800">
                    {paymentConfirming ? "Payment received — confirming appointment" : paymentTerminal ? "This payment request is no longer active" : paymentOrphaned ? "Payment received — staff action required" : "Slot reserved — waiting for payment"}
                  </p>
                  <p className="mt-1 text-xs leading-5 text-slate-500">
                    {paymentConfirming ? "QuickBooks has reported the payment. CaseDesk is safely creating the appointment now." : paymentTerminal ? "The slot has been released. Choose a new available time before sending another request." : paymentOrphaned ? "The payment was collected, but the slot could not be converted into an appointment. Open Payments and follow the urgent recovery steps." : `The appointment will confirm automatically the moment the ${Number(pendingHold.amount).toLocaleString("en-CA", { style: "currency", currency: "CAD" })} payment goes through.`}
                  </p>
                </div>
                {!paymentTerminal && !paymentOrphaned ? (
                  <div className="rounded-2xl border border-slate-200 bg-white p-3.5">
                    {pendingHold.guestEmail || paymentRecipient ? <div className="flex items-center justify-between gap-3">
                      <div className="flex min-w-0 items-center gap-2">
                        <Mail className="h-4 w-4 shrink-0 text-slate-400" />
                        <div className="min-w-0"><p className="truncate text-xs font-semibold text-slate-700">{pendingHold.guestEmail || paymentRecipient}</p><p className="text-[11px] text-slate-400">{emailDelivery?.status === "sent" ? "Payment email sent" : emailDelivery?.status === "failed" ? "Delivery failed" : emailDelivery?.lastError ? "Retrying after a delivery error…" : "Sending payment email…"}</p></div>
                      </div>
                      <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${emailDelivery?.status === "sent" ? "bg-emerald-500" : emailDelivery?.status === "failed" ? "bg-rose-500" : "animate-pulse bg-amber-400"}`} />
                    </div> : null}
                    {emailDelivery?.lastError ? <p className="mt-2 rounded-xl bg-rose-50 px-3 py-2 text-[11px] leading-4 text-rose-600">{emailDelivery.lastError}</p> : null}
                    {pendingHold.guestPhone ? <div className="mt-3 flex items-center gap-2 border-t border-slate-100 pt-3"><MessageSquare className="h-4 w-4 text-slate-400" /><div className="min-w-0 flex-1"><p className="truncate text-xs font-semibold text-slate-700">{pendingHold.guestPhone}</p><p className="text-[11px] text-slate-400">{smsDelivery?.status === "sent" ? "Payment SMS sent" : smsDelivery?.status === "failed" ? "SMS delivery failed" : smsDelivery?.lastError ? "Retrying SMS…" : smsDelivery ? "Sending payment SMS…" : "SMS not queued"}</p></div><span className={`h-2.5 w-2.5 rounded-full ${smsDelivery?.status === "sent" ? "bg-emerald-500" : smsDelivery?.status === "failed" || !smsDelivery ? "bg-slate-300" : "animate-pulse bg-amber-400"}`} /></div> : null}
                    <p className="mt-3 rounded-xl bg-slate-50 px-3 py-2 text-[11px] leading-4 text-slate-500">The secure card link is sent by email, SMS, or both—based on the contact details available above.</p>
                    <input type="email" value={paymentRecipient} onChange={(event) => setPaymentRecipient(event.target.value.replace(/\s/g, ""))} aria-label="Payment request email" placeholder={pendingHold.guestPhone ? "Add or update email (optional)" : "Payment request email"} className="mt-3 h-9 w-full rounded-xl border border-slate-200 px-3 text-xs outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-100" />
                    <button type="button" disabled={Boolean(paymentAction) || paymentConfirming} onClick={resendPaymentRequest} className="mt-2 flex h-9 w-full items-center justify-center gap-1.5 rounded-full border border-slate-200 text-xs font-semibold text-slate-700 transition hover:border-sky-300 hover:bg-sky-50 disabled:opacity-50">
                      {paymentAction === "resend" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />} Resend payment request
                    </button>
                  </div>
                ) : null}
                {pendingHold.payNowUrl && !paymentTerminal ? <button type="button" onClick={() => navigator.clipboard.writeText(pendingHold.payNowUrl)} className="flex h-10 w-full items-center justify-center gap-1.5 rounded-full border border-slate-200 bg-white text-sm font-semibold text-slate-700 transition hover:border-sky-300 hover:bg-sky-50"><Copy className="h-3.5 w-3.5" /> Copy pay-now link</button> : null}
                {pendingHold.expiresAt ? <p className="text-center text-xs text-slate-400">Reservation expires at {new Date(pendingHold.expiresAt).toLocaleTimeString("en-CA", { hour: "numeric", minute: "2-digit" })} if unpaid.</p> : null}
                {paymentActionError ? <p className="rounded-xl bg-rose-50 px-3 py-2 text-xs leading-5 text-rose-700">{paymentActionError}</p> : null}
                {!paymentTerminal && !paymentOrphaned && !paymentConfirming && !confirmPaymentCancel ? <button type="button" disabled={Boolean(paymentAction)} onClick={() => setConfirmPaymentCancel(true)} className="flex h-10 w-full items-center justify-center gap-1.5 rounded-full text-xs font-semibold text-rose-600 transition hover:bg-rose-50 disabled:opacity-50"><Trash2 className="h-3.5 w-3.5" /> Cancel payment request</button> : null}
                {!paymentTerminal && !paymentOrphaned && !paymentConfirming && confirmPaymentCancel ? <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4"><p className="text-sm font-semibold text-rose-900">Release this slot?</p><p className="mt-1 text-xs leading-5 text-rose-700">The QuickBooks invoice will be voided and the payment link will stop working.</p><div className="mt-3 flex gap-2"><button type="button" disabled={Boolean(paymentAction)} onClick={() => setConfirmPaymentCancel(false)} className="h-9 flex-1 rounded-full bg-white text-xs font-semibold text-slate-600">Keep it</button><button type="button" disabled={Boolean(paymentAction)} onClick={cancelPaymentRequest} className="flex h-9 flex-1 items-center justify-center gap-1.5 rounded-full bg-rose-600 text-xs font-semibold text-white">{paymentAction === "cancel" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null} Release slot</button></div></div> : null}
                <Link to={`/app/payments?source=booking_payment&hold=${encodeURIComponent(pendingHold.holdId)}`} onClick={onClose} className="flex h-10 w-full items-center justify-center rounded-full bg-slate-950 text-sm font-semibold text-white transition hover:bg-slate-800">Open in Payments</Link>
                <button type="button" onClick={onClose} className="flex h-10 w-full items-center justify-center rounded-full text-sm font-semibold text-slate-500 transition hover:bg-slate-100">Close and check later</button>
              </div>
            ) : bookedWarning ? (
              <div className="flex-1 space-y-4 overflow-y-auto px-6 py-5">
                <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
                  <p className="text-sm font-semibold text-amber-800">Appointment booked</p>
                  <p className="mt-1 text-xs leading-5 text-amber-700">The payment couldn't be recorded automatically: {bookedWarning}. Record it from the appointment once it's fixed.</p>
                </div>
                <button type="button" onClick={onClose} className="flex h-10 w-full items-center justify-center rounded-full bg-slate-950 text-sm font-semibold text-white transition hover:bg-slate-800">Done</button>
              </div>
            ) : (
            <form onSubmit={submit} className="flex-1 space-y-4 overflow-y-auto px-6 py-5">
              {initialIntake ? (
                <div className={`rounded-2xl border p-3.5 ${initialIntake.action === "appointment-payment" ? "border-emerald-200 bg-emerald-50" : "border-sky-200 bg-sky-50"}`}>
                  <div className="flex items-start gap-2.5">
                    {initialIntake.action === "appointment-payment" ? <Wallet className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" /> : <CalendarDays className="mt-0.5 h-4 w-4 shrink-0 text-sky-600" />}
                    <div>
                      <p className="text-xs font-semibold text-slate-800">Client created — finish the appointment</p>
                      <p className="mt-1 text-[11px] leading-4 text-slate-600">
                        {initialIntake.action === "appointment-payment"
                          ? `${initialIntake.paymentMethod === "Card" ? "The card payment link" : `${initialIntake.paymentMethod || "The payment"} details`} will be applied when you book the selected slot.`
                          : "The new client is already selected. Choose the meeting format, staff member, date, and time."}
                      </p>
                    </div>
                  </div>
                </div>
              ) : null}
              <div className="flex rounded-full border border-slate-200 bg-slate-50 p-0.5">
                {[["client", "Existing client"], ["guest", "Walk-in / guest"]].map(([mode, label]) => (
                  <button key={mode} type="button" onClick={() => setForm((c) => ({ ...c, mode, ...(mode === "client" ? { leadId: "" } : { clientId: "" }) }))} className={`flex-1 rounded-full px-3 py-2 text-xs font-semibold transition ${form.mode === mode ? "bg-slate-950 text-white shadow" : "text-slate-500 hover:text-slate-800"}`}>{label}</button>
                ))}
              </div>

              {form.mode === "client" ? (
                <label className="block text-xs font-medium text-slate-600">Client
                  <div className="mt-1.5">
                    <ClientCombobox
                      selected={selectedClient}
                      onSelect={(client) => { setSelectedClient(client); setForm((c) => ({ ...c, clientId: client.id })); }}
                      onClear={() => { setSelectedClient(null); setForm((c) => ({ ...c, clientId: "" })); }}
                      search={searchClients}
                    />
                  </div>
                </label>
              ) : (
                <div className="space-y-3">
                  <label className="block text-xs font-medium text-slate-600">Visitor name
                    <input required value={form.guestName} onChange={(event) => setForm((c) => ({ ...c, guestName: event.target.value, leadId: "" }))} className={`mt-1.5 ${input}`} />
                  </label>
                  <div className="grid grid-cols-2 gap-3">
                    <label className="block text-xs font-medium text-slate-600">Email
                      <input type="email" value={form.guestEmail} onChange={(event) => setForm((c) => ({ ...c, guestEmail: event.target.value, leadId: "" }))} className={`mt-1.5 ${input}`} />
                    </label>
                    <label className="block text-xs font-medium text-slate-600">Phone
                      <input value={form.guestPhone} onChange={(event) => setForm((c) => ({ ...c, guestPhone: event.target.value, leadId: "" }))} className={`mt-1.5 ${input}`} />
                    </label>
                  </div>
                  <p className="text-xs text-slate-400">Enter at least one of email or phone.</p>
                  {selectedGuestLead ? (
                    <p className="rounded-lg bg-emerald-50 px-3 py-2 text-xs font-semibold leading-5 text-emerald-800">
                      Lead selected: {selectedGuestLead.fullName}{selectedGuestLead.owner?.fullName ? ` · ${selectedGuestLead.owner.fullName}` : ""}. This appointment will be added to the lead's activity.
                    </p>
                  ) : guestMatches.length === 1 && guestMatches[0].recordType === "client" ? (
                    <p className="rounded-lg bg-sky-50 px-3 py-2 text-xs leading-5 text-sky-800">
                      This looks like an existing client — {guestMatches[0].fullName}. It'll be linked automatically when you book.
                    </p>
                  ) : guestMatches.length ? (
                    <div className="rounded-lg bg-amber-50 p-2.5">
                      <p className="px-0.5 text-xs font-semibold leading-5 text-amber-800">Existing CaseDesk contact found. Select the correct Client or Lead before booking.</p>
                      <div className="mt-1.5 space-y-1">
                        {guestMatches.map((contact) => (
                          <button
                            key={`${contact.recordType}:${contact.id}`}
                            type="button"
                            onClick={() => contact.recordType === "client"
                              ? (setSelectedClient(contact), setForm((c) => ({ ...c, mode: "client", clientId: contact.id, leadId: "" })))
                              : setForm((c) => ({ ...c, mode: "guest", clientId: "", leadId: contact.id, guestName: contact.fullName, guestEmail: contact.email || c.guestEmail, guestPhone: contact.phone || c.guestPhone, assignedToId: contact.owner?.id || c.assignedToId }))}
                            className="flex w-full items-center justify-between rounded-lg bg-white px-2.5 py-1.5 text-left text-xs font-medium text-slate-700 shadow-sm transition hover:bg-amber-100/60"
                          >
                            <span className="truncate">{contact.fullName}<span className="ml-1.5 text-[10px] font-bold uppercase text-amber-700">{contact.recordType}</span></span>
                            <span className="ml-2 shrink-0 truncate text-slate-400">{contact.recordType === "lead" ? contact.owner?.fullName || contact.leadNumber : contact.email || contact.phone}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </div>
              )}

              {freeEligibility?.enabled && freeEligibility.contactEligible && !intakePaymentRequested ? (
                freeEligibility.eligible ? (
                  <p className="flex items-center gap-1.5 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-700"><Check className="h-3.5 w-3.5 shrink-0" /> Eligible for a free 15-minute follow-up ({freeEligibility.priorFreeCount} of {freeEligibility.limit} used)</p>
                ) : (
                  <p className="flex items-center gap-1.5 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-700"><Check className="h-3.5 w-3.5 shrink-0" /> Eligible for a free follow-up — choose a 15-minute appointment type to apply it.</p>
                )
              ) : null}
              {staffFreeFollowUpSelected && freeEligibility?.eligible !== true && !intakePaymentRequested ? (
                <p className="flex items-center gap-1.5 rounded-xl border border-sky-200 bg-sky-50 px-3 py-2 text-xs font-semibold text-sky-700"><Check className="h-3.5 w-3.5 shrink-0" /> Free follow-up selected by staff — no payment will be requested.</p>
              ) : null}

              {showsPaymentStep ? (
                <div className={initialIntake?.action === "appointment-payment" ? "rounded-2xl border border-emerald-200 bg-emerald-50/50 p-3" : ""}>
                  <p className="text-xs font-medium text-slate-600">How will they pay? — {consultFeeAmount.toLocaleString("en-CA", { style: "currency", currency: "CAD" })}</p>
                  <div className="mt-1.5 grid grid-cols-3 gap-1.5">
                    {[["Card", "Card"], ["ETransfer", "E-transfer"], ["Cash", "Cash"], ...(intakePaymentRequested ? [] : [["Skip", "Skip"]])].map(([value, label]) => (
                      <button key={value} type="button" onClick={() => setForm((c) => ({ ...c, paymentMethod: value, paymentReference: c.paymentMethod === value ? c.paymentReference : "" }))} className={`rounded-lg px-2 py-2 text-xs font-semibold transition ${form.paymentMethod === value ? "bg-slate-950 text-white shadow" : "border border-slate-200 bg-white text-slate-700 hover:border-sky-300 hover:bg-sky-50/50"}`}>
                        {label}
                      </button>
                    ))}
                  </div>
                  {["Cash", "ETransfer"].includes(form.paymentMethod) ? (
                    <label className="mt-2 block text-xs font-medium text-slate-600">
                      {form.paymentMethod === "Cash" ? "Cash receipt / reference (optional)" : "E-transfer transaction number (optional)"}
                      <input
                        value={form.paymentReference}
                        onChange={(event) => setForm((current) => ({ ...current, paymentReference: event.target.value }))}
                        maxLength={100}
                        placeholder={form.paymentMethod === "Cash" ? "Receipt or internal reference" : "Enter it now, or leave blank and add it later"}
                        className={`mt-1.5 ${input}`}
                      />
                      {form.paymentMethod === "ETransfer" ? (
                        <span className="mt-1.5 block text-[11px] leading-4 text-slate-500">
                          If the payment has arrived, enter its transaction number now. Otherwise leave this blank—the appointment will still be booked and payment will remain pending.
                        </span>
                      ) : null}
                    </label>
                  ) : null}
                  {form.paymentMethod === "Card" ? (
                    <p className="mt-1.5 text-xs leading-5 text-slate-500">The slot is held and a payment link is sent right away — the appointment is confirmed the moment they pay.</p>
                  ) : null}
                </div>
              ) : null}

              <div className="grid grid-cols-2 gap-2">
                {meetingModes.map(([modeId, label, Icon]) => (
                  <button key={modeId} type="button" onClick={() => setForm((c) => ({ ...c, meetingMode: modeId, startsAt: "" }))} className={`flex items-center justify-center gap-2 rounded-xl border px-3 py-2.5 text-xs font-semibold transition ${(form.meetingMode || "InPerson") === modeId ? "border-slate-950 bg-slate-950 text-white" : "border-slate-200 text-slate-600 hover:border-slate-300"}`}>
                    <Icon className="h-3.5 w-3.5" /> {label}
                  </button>
                ))}
              </div>

              {(form.meetingMode || "InPerson") === "InPerson" && locations.length > 1 ? (
                <label className="block text-xs font-medium text-slate-600">Office location
                  <Select value={form.locationId} onChange={(event) => setForm((c) => ({ ...c, locationId: event.target.value, startsAt: "" }))} className="mt-1.5 w-full" ariaLabel="Office location">
                    <option value="">Choose a location…</option>
                    {locations.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                  </Select>
                </label>
              ) : (form.meetingMode || "InPerson") === "InPerson" && !locations.length ? (
                <label className="block text-xs font-medium text-slate-600">Location (optional)
                  <input value={form.location} onChange={(event) => setForm((c) => ({ ...c, location: event.target.value }))} placeholder="Office or meeting place" className={`mt-1.5 ${input}`} />
                </label>
              ) : null}

              <div className="grid grid-cols-2 gap-3">
                <label className="block text-xs font-medium text-slate-600">Session type
                  <Select value={selectedType?.id || ""} onChange={(event) => setForm((c) => ({ ...c, sessionTypeId: event.target.value, startsAt: "" }))} className="mt-1.5 w-full" ariaLabel="Session type">
                    {activeTypes.map((type) => {
                      const locked = isFreeNamedType(type) && !contactVerifiedFreeEligible && !canGrantFreeFollowUp;
                      return (
                        <option key={type.id} value={type.id} disabled={locked}>
                          {type.name} · {type.durationMinutes}m{locked ? " (requires a prior paid consultation)" : isFreeNamedType(type) && canGrantFreeFollowUp && !contactVerifiedFreeEligible ? " (staff override)" : ""}
                        </option>
                      );
                    })}
                    {!activeTypes.length ? <option value="">No session types yet</option> : null}
                  </Select>
                </label>
                {role !== "consultant" ? (
                  <label className="block text-xs font-medium text-slate-600">Staff
                    <Select value={form.assignedToId} onChange={(event) => setForm((c) => ({ ...c, assignedToId: event.target.value, startsAt: "" }))} className="mt-1.5 w-full" ariaLabel="Staff">
                      <option value="">Anyone / unassigned</option>
                      {staff.map((member) => <option key={member.id} value={member.id} disabled={form.meetingMode === "Zoom" && member.zoomHostMapping?.status !== "active"}>{member.fullName}{form.meetingMode === "Zoom" && member.zoomHostMapping?.status !== "active" ? " · Zoom not mapped" : ""}</option>)}
                    </Select>
                  </label>
                ) : null}
              </div>

              <label className="block text-xs font-medium text-slate-600">Date
                <input type="date" required value={form.date} onChange={(event) => setForm((c) => ({ ...c, date: event.target.value, startsAt: "" }))} className={`mt-1.5 ${input}`} />
              </label>

              <div>
                <p className="text-xs font-medium text-slate-600">Available times</p>
                {form.meetingMode === "InPerson" && locations.length > 1 && !form.locationId ? (
                  <p className="mt-2 text-sm text-slate-400">Choose an office location above to see available times.</p>
                ) : loadingSlots ? (
                  <p className="mt-2 flex items-center gap-2 text-sm text-slate-400"><Loader2 className="h-4 w-4 animate-spin" /> Checking availability…</p>
                ) : slots && slots.length ? (
                  <div className="mt-2 grid grid-cols-4 gap-1.5">
                    {slots.map((slot) => (
                      <button key={slot.startsAt} type="button" onClick={() => setForm((c) => ({ ...c, startsAt: slot.startsAt }))} className={`rounded-lg px-2 py-2 text-xs font-semibold transition ${form.startsAt === slot.startsAt ? "bg-slate-950 text-white shadow" : "border border-slate-200 bg-white text-slate-700 hover:border-sky-300 hover:bg-sky-50/50"}`}>
                        {formatTime(slot.startsAt)}
                      </button>
                    ))}
                  </div>
                ) : (
                  <p className="mt-2 text-sm text-slate-400">No open times on this day.</p>
                )}
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-600">Subject
                  <input value={form.subject} onChange={(event) => updateSubject(event.target.value)} placeholder="What's this appointment about? (e.g. Initial consultation)" className={`mt-1.5 ${input}`} />
                </label>
                <div className="mt-1.5 flex items-center justify-between gap-2 text-[10px] font-normal">
                  <span className={subjectWordCount(form.subject) > APPOINTMENT_SUBJECT_MAX_WORDS ? "font-semibold text-rose-600" : "text-slate-400"}>
                    {subjectWordCount(form.subject)}/{APPOINTMENT_SUBJECT_MAX_WORDS} words
                  </span>
                  {subjectWordCount(form.subject) > APPOINTMENT_SUBJECT_MAX_WORDS ? (
                    <button type="button" onClick={shortenSubject} disabled={shorteningSubject} className="inline-flex items-center gap-1 font-semibold text-sky-700 disabled:opacity-50">
                      {shorteningSubject ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
                      {shorteningSubject ? "Asking Nova…" : "Shorten with Nova"}
                    </button>
                  ) : null}
                </div>
                {subjectSuggestion ? (
                  <div className="mt-2 flex items-center justify-between gap-3 rounded-xl bg-sky-50 px-3 py-2 text-xs text-sky-800">
                    <span className="min-w-0 flex-1">
                      Nova suggests: <span className="font-semibold">“{subjectSuggestion}”</span>
                    </span>
                    <span className="flex shrink-0 items-center gap-2">
                      <button type="button" onClick={acceptSubjectSuggestion} className="font-semibold text-sky-700">Use this</button>
                      <button type="button" onClick={() => setSubjectSuggestion(null)} className="text-slate-400">Dismiss</button>
                    </span>
                  </div>
                ) : null}
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-600">Private staff context
                  <textarea
                    value={form.description || ""}
                    onChange={(event) => setForm((current) => ({ ...current, description: event.target.value.slice(0, 2000) }))}
                    placeholder="Notes for the consultant/staff only — e.g. what the client wants to cover. Never shown to the client."
                    rows={3}
                    className={`mt-1.5 resize-none ${input}`}
                  />
                </label>
                <p className="mt-1 text-[10px] text-slate-400">Internal only — shows in the appointment's About section for staff, not sent to the client.</p>
              </div>
              {form.meetingMode === "Phone" ? hasValidPhoneBookingNumber ? (
                <p className="rounded-xl bg-sky-50 px-3 py-2 text-xs leading-5 text-sky-800">The office will call {phoneBookingNumber}{settings?.phoneCallerId ? ` from ${settings.phoneCallerId}` : ""}.</p>
              ) : (
                <p className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2.5 text-xs font-semibold leading-5 text-rose-700" role="alert">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>{form.mode === "client" ? `${selectedClient?.fullName || "This client"} does not have a valid phone number saved. Update the client profile before booking a phone appointment.` : "Enter a valid phone number before booking a phone appointment."}</span>
                </p>
              ) : null}

              <div className="grid grid-cols-2 gap-3 rounded-2xl border border-slate-100 bg-slate-50/70 p-3">
                <label className="block text-xs font-medium text-slate-600">Repeat
                  <Select value={form.recurrenceFrequency} onChange={(event) => setForm((current) => ({ ...current, recurrenceFrequency: event.target.value }))} className="mt-1.5 w-full"><option value="NONE">Does not repeat</option><option value="DAILY">Daily</option><option value="WEEKLY">Weekly</option><option value="MONTHLY">Monthly</option></Select>
                </label>
                {form.recurrenceFrequency !== "NONE" ? <label className="block text-xs font-medium text-slate-600">Appointments<input type="number" min="2" max="52" value={form.recurrenceCount} onChange={(event) => setForm((current) => ({ ...current, recurrenceCount: event.target.value }))} className={`mt-1.5 ${input}`} /></label> : null}
              </div>

              {error ? <p className="rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p> : null}
            </form>
            )}
            {!pendingHold && !bookedWarning ? (
            <footer className="border-t border-slate-100 p-4">
              <button type="button" onClick={submit} disabled={saving || !form.startsAt || !form.subject.trim() || subjectWordCount(form.subject) > APPOINTMENT_SUBJECT_MAX_WORDS || (form.mode === "guest" && !form.guestEmail.trim() && !form.guestPhone.trim()) || (form.meetingMode === "Phone" && !hasValidPhoneBookingNumber)} className="flex h-12 w-full items-center justify-center gap-2 rounded-full bg-slate-950 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:opacity-50">
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null} {saving ? "Booking…" : form.paymentMethod === "Card" ? "Reserve & send payment link" : "Book appointment"}
              </button>
            </footer>
            ) : null}
          </motion.aside>
        </motion.div>
      ) : null}
    </AnimatePresence>,
    document.body,
  );
}

export default function CalendarPage() {
  const { role, appUser } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const linkedAppointmentId = searchParams.get("appointment") || "";
  const linkedDate = searchParams.get("date");
  const now = useNow();
  const [selectedDate, setSelectedDate] = useState(() => startOfDayLocal(linkedDate && /^\d{4}-\d{2}-\d{2}$/.test(linkedDate) ? new Date(`${linkedDate}T12:00:00`) : new Date()));
  const [view, setView] = useState("day");
  const [appointments, setAppointments] = useState([]);
  const [sessionTypes, setSessionTypes] = useState([]);
  const [bookingSettings, setBookingSettings] = useState(null);
  const [staff, setStaff] = useState([]);
  const [staffFilter, setStaffFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [sheetOpen, setSheetOpen] = useState(() => Boolean(readAppointmentDraft()));
  const [prefillClient, setPrefillClient] = useState(null);
  const [prefillLead, setPrefillLead] = useState(null);
  const [prefillIntake, setPrefillIntake] = useState(null);
  const [selected, setSelected] = useState(null);
  const [focusedAppointmentId, setFocusedAppointmentId] = useState("");
  const [notesAppointmentId, setNotesAppointmentId] = useState(null);
  const [cancelling, setCancelling] = useState(false);
  const lastBackgroundRefreshAt = useRef(0);

  const monthCursor = useMemo(() => new Date(selectedDate.getFullYear(), selectedDate.getMonth(), 1), [selectedDate]);
  const rangeStart = useMemo(() => startOfWeek(monthCursor), [monthCursor]);
  const rangeEnd = useMemo(() => new Date(rangeStart.getTime() + 42 * DAY_MS), [rangeStart]);

  const load = useCallback(async ({ fresh = false, background = false } = {}) => {
    if (!background) setLoading(true);
    if (!background) setError("");
    try {
      if (background) {
        const calendar = await getCalendarAppointments({ from: rangeStart.toISOString(), to: rangeEnd.toISOString(), fresh });
        setAppointments((current) => calendarRowsEqual(current, calendar) ? current : calendar);
      } else {
        const [calendar, settings] = await Promise.all([
          getCalendarAppointments({ from: rangeStart.toISOString(), to: rangeEnd.toISOString(), fresh }),
          getBookingSettings(),
        ]);
        setAppointments(calendar);
        setSessionTypes(settings.sessionTypes);
        setBookingSettings(settings.settings);
        setStaff(settings.eligibleStaff || (settings.staff || []).filter((member) => (
          member.schedulingPreference
            ? member.schedulingPreference.acceptsAppointments
            : member.role === "consultant"
        )));
      }
    } catch (reason) {
      if (!background) setError(reason.response?.data?.message || "The calendar could not be loaded.");
    } finally {
      if (!background) setLoading(false);
    }
  }, [rangeStart, rangeEnd]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!linkedAppointmentId) return;
    const linked = appointments.find((item) => item.id === linkedAppointmentId);
    if (!linked) return;
    setSelected(linked);
    setFocusedAppointmentId(linked.id);
    setView("day");
    setSelectedDate((current) => dateKey(current) === dateKey(new Date(linked.startsAt)) ? current : startOfDayLocal(new Date(linked.startsAt)));
    const timer = window.setTimeout(() => setFocusedAppointmentId(""), 4800);
    return () => window.clearTimeout(timer);
  }, [appointments, linkedAppointmentId]);

  // Arriving from a client profile's "Book" link — open straight into the
  // new-appointment form with that client already picked, instead of making
  // staff search for someone whose profile they're already looking at.
  useEffect(() => {
    const bookForClientId = searchParams.get("bookForClient");
    if (!bookForClientId) return;
    let cancelled = false;
    const intake = role === "frontdesk" ? location.state?.frontDeskIntake || null : null;
    setPrefillIntake(intake);
    api.get(`/clients/${bookForClientId}`).then((response) => {
      if (cancelled) return;
      setPrefillClient(response.data.data.client);
      setSheetOpen(true);
      const next = new URLSearchParams(searchParams);
      next.delete("bookForClient");
      navigate({ pathname: location.pathname, search: next.toString() ? `?${next.toString()}` : "" }, { replace: true, state: null });
    }).catch((reason) => {
      if (!cancelled) setError(reason.response?.data?.message || "The new client was saved, but appointment booking could not be opened.");
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Arriving from a lead's "Book" action opens the calendar's appointment
  // form with the lead linked and their contact details already populated.
  useEffect(() => {
    const bookForLeadId = searchParams.get("bookForLead");
    if (!bookForLeadId) return;
    let cancelled = false;
    api.get(`/leads/${bookForLeadId}`).then((response) => {
      if (cancelled) return;
      setPrefillLead(response.data.data);
      setSheetOpen(true);
      const next = new URLSearchParams(searchParams);
      next.delete("bookForLead");
      navigate({ pathname: location.pathname, search: next.toString() ? `?${next.toString()}` : "" }, { replace: true, state: null });
    }).catch((reason) => {
      if (!cancelled) setError(reason.response?.data?.message || "The lead was opened, but appointment booking could not be loaded.");
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const refreshWhenVisible = () => {
      if (document.visibilityState !== "visible" || Date.now() - lastBackgroundRefreshAt.current < 30_000) return;
      lastBackgroundRefreshAt.current = Date.now();
      void load({ fresh: true, background: true });
    };
    window.addEventListener("focus", refreshWhenVisible);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => { window.removeEventListener("focus", refreshWhenVisible); document.removeEventListener("visibilitychange", refreshWhenVisible); };
  }, [load]);

  const staffTone = useMemo(() => {
    const map = new Map();
    staff.forEach((member, index) => map.set(member.id, EVENT_TONES[index % EVENT_TONES.length]));
    return map;
  }, [staff]);

  const toneFor = useCallback(
    // Finished consultations recede. Missing attendance records and no-shows
    // override consultant/source colors because they require staff action.
    (item) => item.status === "Completed" ? ATTENDED_TONE : appointmentNeedsAttendance(item) ? ATTENDANCE_NEEDED_TONE : item.status === "NoShow" ? NO_SHOW_TONE : item.isFreeConsultation ? FREE_CONSULTATION_TONE : item.source === "WalkIn" ? WALK_IN_TONE : (item.assignedTo && staffTone.get(item.assignedTo.id)) || (role === "consultant" ? EVENT_TONES[0] : NEUTRAL_TONE),
    [staffTone, role],
  );

  // Hover preview is purely additive to the click-opens-panel flow below —
  // a short show-delay avoids flashing a card on every pass of the mouse,
  // and a short hide-delay gives the pointer time to travel from the pill
  // into the card itself (e.g. to use the "View details" button) without
  // it flicker-closing first.
  const [hoverPreview, setHoverPreview] = useState(null);
  const hoverShowTimer = useRef(null);
  const hoverHideTimer = useRef(null);

  const scheduleHoverPreview = useCallback((item, tone, rect) => {
    window.clearTimeout(hoverHideTimer.current);
    window.clearTimeout(hoverShowTimer.current);
    hoverShowTimer.current = window.setTimeout(() => setHoverPreview({ item, tone, rect }), 300);
  }, []);

  const cancelHoverPreview = useCallback(() => {
    window.clearTimeout(hoverShowTimer.current);
    hoverHideTimer.current = window.setTimeout(() => setHoverPreview(null), 150);
  }, []);

  const closeHoverPreview = useCallback(() => {
    window.clearTimeout(hoverShowTimer.current);
    window.clearTimeout(hoverHideTimer.current);
    setHoverPreview(null);
  }, []);

  const keepHoverPreview = useCallback(() => {
    window.clearTimeout(hoverHideTimer.current);
  }, []);

  useEffect(() => {
    if (!hoverPreview) return undefined;
    const close = () => setHoverPreview(null);
    window.addEventListener("scroll", close, true);
    return () => window.removeEventListener("scroll", close, true);
  }, [hoverPreview]);

  useEffect(() => () => {
    window.clearTimeout(hoverShowTimer.current);
    window.clearTimeout(hoverHideTimer.current);
  }, []);

  const visible = useMemo(
    // Attendance changes the visual state, not the historical calendar.
    // Keep no-shows in their original time slot so consultants can still
    // open the appointment, review notes, and follow up with context.
    () => appointments.filter((item) => ["Scheduled", "Completed", "NoShow"].includes(item.status) && (!staffFilter || item.assignedTo?.id === staffFilter)),
    [appointments, staffFilter],
  );

  const busyKeys = useMemo(() => new Set(visible.map((item) => dateKey(new Date(item.startsAt)))), [visible]);

  const days = useMemo(() => {
    if (view === "day") return [selectedDate];
    if (view === "month") return [];
    const weekStart = startOfWeek(selectedDate);
    return Array.from({ length: 7 }, (_, index) => new Date(weekStart.getTime() + index * DAY_MS));
  }, [view, selectedDate]);

  function shift(direction) {
    setSelectedDate((current) => view === "month"
      ? addMonthsClamped(current, direction)
      : new Date(current.getTime() + direction * (view === "day" ? 1 : 7) * DAY_MS));
  }

  function closeSelected() {
    setSelected(null);
    if (linkedAppointmentId) {
      setSearchParams((current) => {
        const next = new URLSearchParams(current);
        next.delete("appointment");
        next.delete("date");
        return next;
      }, { replace: true });
    }
  }

  const handlePaymentUpdated = useCallback((result) => {
    const mergePayment = (item) => {
      if (!item) return item;
      if (result.approvalRequired || result.status === "PendingApproval") {
        return {
          ...item,
          paymentApprovals: [{
            id: result.approval?.id || result.id,
            status: "Pending",
            method: result.paymentMethod,
            amount: result.amount,
            transactionReference: result.paymentReference || null,
            processingError: null,
          }],
        };
      }
      return {
        ...item,
        paymentHold: {
          ...item.paymentHold,
          id: result.id,
          status: result.status,
          amount: result.amount,
          paidAt: result.paidAt,
          paymentMethod: result.paymentMethod,
          manualPaymentReference: result.paymentReference ?? result.manualPaymentReference ?? null,
          paymentError: result.paymentError,
          qbInvoiceNumber: result.invoiceNumber ?? result.qbInvoiceNumber,
        },
      };
    };
    const matchesPayment = (item) => item?.paymentHold?.id === result.id || item?.id === result.appointmentId;
    setAppointments((current) => current.map((item) => matchesPayment(item) ? mergePayment(item) : item));
    setSelected((current) => matchesPayment(current) ? mergePayment(current) : current);
  }, []);

  async function cancelSelected(scope = "single") {
    if (!selected) return;
    setCancelling(true);
    try {
      const updated = await cancelBookingAppointment(selected.id, { scope });
      if (updated.seriesAffected) await load({ fresh: true });
      else setAppointments((current) => current.map((item) => (item.id === updated.id ? updated : item)));
      closeSelected();
    } catch (reason) {
      setError(reason.response?.data?.message || "The appointment could not be cancelled.");
    } finally {
      setCancelling(false);
    }
  }

  const todayKey = dateKey(now);
  const gridHours = GRID_END_HOUR - GRID_START_HOUR;
  const nowOffset = (now.getHours() + now.getMinutes() / 60 - GRID_START_HOUR) * HOUR_PX;
  const showNowLine = nowOffset > 0 && nowOffset < gridHours * HOUR_PX;

  const upcoming = useMemo(
    () => visible
      .filter((item) => new Date(item.endsAt) > now)
      .sort((left, right) => new Date(left.startsAt) - new Date(right.startsAt))
      .slice(0, 4),
    [visible, now],
  );

  const monthAppointmentCount = useMemo(() => visible.filter((item) => {
    const start = new Date(item.startsAt);
    return start.getFullYear() === selectedDate.getFullYear() && start.getMonth() === selectedDate.getMonth();
  }).length, [visible, selectedDate]);
  const headerDate = view === "month"
    ? selectedDate.toLocaleDateString("en-CA", { month: "long", year: "numeric" })
    : view === "day"
      ? selectedDate.toLocaleDateString("en-CA", { month: "long", day: "numeric", year: "numeric" })
      : `${days[0].toLocaleDateString("en-CA", { month: "short", day: "numeric" })} – ${days[days.length - 1].toLocaleDateString("en-CA", { month: "short", day: "numeric", year: "numeric" })}`;
  const headerSub = view === "month"
    ? `${monthAppointmentCount} appointment${monthAppointmentCount === 1 ? "" : "s"}`
    : view === "day"
      ? selectedDate.toLocaleDateString("en-CA", { weekday: "long" })
      : `Week ${Math.ceil(((days[0] - new Date(days[0].getFullYear(), 0, 1)) / DAY_MS + 1) / 7)}`;

  return (
    <PageContainer
      title="Calendar"
      description={role === "consultant" ? "Your appointments and open time." : "Appointments across the workspace — book walk-ins and consultations."}
      actions={
        <button type="button" onClick={() => setSheetOpen(true)} className="inline-flex h-11 items-center gap-2 rounded-2xl bg-slate-950 px-5 text-sm font-semibold text-white shadow-[0_14px_30px_rgba(15,23,42,0.22)] transition hover:-translate-y-0.5 hover:bg-slate-800">
          <Plus className="h-4 w-4" /> Add appointment
        </button>
      }
    >
      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="rounded-3xl border border-white/70 bg-white/80 shadow-[0_18px_45px_rgba(15,23,42,0.08)] backdrop-blur-xl">
          <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-100 px-6 py-5">
            <div className="flex items-center gap-3.5">
              <div className="flex h-12 w-12 flex-col items-center justify-center overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
                <span className="w-full bg-slate-950 text-center text-[8px] font-bold uppercase tracking-wider text-white">
                  {selectedDate.toLocaleDateString("en-CA", { month: "short" })}
                </span>
                <span className="flex-1 pt-0.5 text-base font-bold leading-none text-slate-900">{selectedDate.getDate()}</span>
              </div>
              <div aria-live="polite" aria-atomic="true">
                <h2 className="text-lg font-semibold leading-6 tracking-tight text-slate-950">{headerDate}</h2>
                <p className="text-sm text-slate-400">{headerSub}</p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2.5">
              {role !== "consultant" && staff.length ? (
                <>
                  <Select value={staffFilter} onChange={(event) => setStaffFilter(event.target.value)} ariaLabel="Filter by staff">
                    <option value="">All staff</option>
                    {staff.map((member) => <option key={member.id} value={member.id}>{member.fullName}</option>)}
                  </Select>
                  <div className="hidden h-7 w-px bg-slate-200 sm:block" />
                </>
              ) : null}
              <div className="flex items-center overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
                <button type="button" aria-label="Previous" onClick={() => shift(-1)} className="flex h-[42px] w-10 items-center justify-center text-slate-500 transition hover:bg-slate-50"><ChevronLeft className="h-4 w-4" /></button>
                <button type="button" onClick={() => setSelectedDate(startOfDayLocal(new Date()))} className="h-[42px] border-x border-slate-200 px-4 text-sm font-semibold text-slate-700 transition hover:bg-slate-50">Today</button>
                <button type="button" aria-label="Next" onClick={() => shift(1)} className="flex h-[42px] w-10 items-center justify-center text-slate-500 transition hover:bg-slate-50"><ChevronRight className="h-4 w-4" /></button>
              </div>
              <div className="flex items-center overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
                {[["day", "Day"], ["week", "Week"], ["month", "Month"]].map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setView(value)}
                    aria-pressed={view === value}
                    className={`h-[42px] px-4 text-sm font-semibold transition ${view === value ? "bg-slate-950 text-white" : "text-slate-600 hover:bg-slate-50"}`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <button type="button" onClick={() => load({ fresh: true })} aria-label="Refresh calendar" className="flex h-[42px] w-[42px] items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-500 shadow-sm transition hover:bg-slate-50">
                <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
              </button>
            </div>
          </div>

          {error ? (
            <div className="flex items-center justify-between gap-3 px-5 py-4">
              <p className="text-sm text-rose-700">{error}</p>
              <button type="button" onClick={load} className="text-sm font-semibold text-rose-700 underline">Try again</button>
            </div>
          ) : null}

          {view === "month" ? (
            <MonthCalendar
              cursor={monthCursor}
              items={visible}
              selectedDate={selectedDate}
              todayKey={todayKey}
              toneFor={toneFor}
              onOpenDay={(day) => { setSelectedDate(startOfDayLocal(day)); setView("day"); }}
              onSelectItem={(item) => { setSelected(item); setSelectedDate(startOfDayLocal(new Date(item.startsAt))); closeHoverPreview(); }}
            />
          ) : (
          <div className="overflow-x-auto">
            <div className={view === "week" ? "min-w-[820px]" : "min-w-[420px]"}>
              {view === "week" ? (
                <div className="grid grid-cols-[58px_repeat(7,1fr)] border-b border-slate-100">
                  <div />
                  {days.map((day) => {
                    const isToday = dateKey(day) === todayKey;
                    return (
                      <button key={day.toISOString()} type="button" onClick={() => { setSelectedDate(startOfDayLocal(day)); setView("day"); }} className="px-2.5 py-3 text-left transition hover:bg-slate-50">
                        <p className={`text-sm font-bold ${isToday ? "text-sky-600" : "text-slate-900"}`}>
                          {day.toLocaleDateString("en-CA", { weekday: "short" })} {String(day.getDate()).padStart(2, "0")}
                        </p>
                      </button>
                    );
                  })}
                </div>
              ) : null}

              <div className={view === "week" ? "grid grid-cols-[58px_repeat(7,1fr)]" : "grid grid-cols-[58px_1fr]"}>
                <div className="relative" style={{ height: gridHours * HOUR_PX }}>
                  {Array.from({ length: gridHours * 2 }, (_, index) => {
                    // Position N (in px) sits at the boundary after the Nth
                    // half-hour block, scaled by HOUR_PX/60 px per minute —
                    // index 0 is 7:30, index 1 is 8:00, and so on through
                    // the grid.
                    const totalMinutes = (index + 1) * 30;
                    const hour24 = GRID_START_HOUR + Math.floor(totalMinutes / 60);
                    const isHourMark = totalMinutes % 60 === 0;
                    const hour12 = ((hour24 - 1) % 12) + 1;
                    const isAM = hour24 <= 11 || hour24 >= 24;
                    return (
                      <span
                        key={index}
                        className={`absolute right-2.5 -translate-y-1/2 font-medium ${isHourMark ? "text-[10px] text-slate-400" : "text-[9px] text-slate-300"}`}
                        style={{ top: (totalMinutes / 60) * HOUR_PX }}
                      >
                        {isHourMark ? `${hour12} ${isAM ? "AM" : "PM"}` : `${hour12}:30 ${isAM ? "AM" : "PM"}`}
                      </span>
                    );
                  })}
                </div>
                {days.map((day) => {
                  const key = dateKey(day);
                  const dayItems = visible.filter((item) => dateKey(new Date(item.startsAt)) === key);
                  const positionedDayItems = layoutOverlappingAppointments(dayItems);
                  const isToday = key === todayKey;
                  return (
                    <div key={key} className={`relative border-l border-slate-100 ${isToday ? "bg-sky-50/30" : ""}`} style={{ height: gridHours * HOUR_PX }}>
                      {Array.from({ length: gridHours }, (_, index) => (
                        <div key={`hour-${index}`} className="absolute inset-x-0 border-t border-slate-100/90" style={{ top: index * HOUR_PX }} />
                      ))}
                      {/* Half-hour marks — a faint, dashed second layer so
                          11:30 reads as a real reference line without
                          competing with the hour lines. */}
                      {Array.from({ length: gridHours }, (_, index) => (
                        <div key={`half-${index}`} className="absolute inset-x-0 border-t border-dashed border-slate-100" style={{ top: (index + 0.5) * HOUR_PX }} />
                      ))}
                      {isToday && showNowLine ? (
                        <div className="pointer-events-none absolute inset-x-0 z-10" style={{ top: nowOffset }}>
                          <div className="relative border-t-[1.5px] border-rose-500">
                            <span className="absolute -left-[3px] -top-[4px] h-2 w-2 rounded-full bg-rose-500" />
                          </div>
                        </div>
                      ) : null}
                      {positionedDayItems.map(({ item, column, columns }) => (
                        <AppointmentPill
                          key={item.id}
                          item={item}
                          column={column}
                          columns={columns}
                          view={view}
                          tone={toneFor(item)}
                          isSelected={selected?.id === item.id}
                          isFocused={focusedAppointmentId === item.id}
                          bookingSettings={bookingSettings}
                          onSelect={() => { setSelected(item); closeHoverPreview(); }}
                          onHoverStart={scheduleHoverPreview}
                          onHoverEnd={cancelHoverPreview}
                        />
                      ))}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
          )}

          <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 rounded-b-3xl border-t border-slate-100 bg-slate-50/60 px-6 py-2.5 text-[11px] text-slate-500">
            <div className="flex flex-wrap items-center gap-2.5">
              {[["InPerson", "In person"], ["Phone", "Phone"], ["Online", "Video"], ["Zoom", "Zoom"]].map(([modeId, label]) => {
                const Icon = MEETING_MODE_ICON[modeId];
                return <span key={modeId} className="flex items-center gap-1"><Icon className="h-3 w-3 text-slate-400" />{label}</span>;
              })}
            </div>
            <div className="hidden h-3 w-px bg-slate-200 sm:block" />
            <div className="flex flex-wrap items-center gap-2.5">
              {role !== "consultant" && staff.length ? staff.map((member) => (
                <span key={member.id} className="flex items-center gap-1"><span className={`h-2 w-2 shrink-0 rounded-full ${staffTone.get(member.id)?.chip || NEUTRAL_TONE.chip}`} />{member.fullName}</span>
              )) : role === "consultant" ? (
                <span className="flex items-center gap-1"><span className={`h-2 w-2 shrink-0 rounded-full ${EVENT_TONES[0].chip}`} />Your appointments</span>
              ) : null}
              <span className="flex items-center gap-1"><span className={`h-2 w-2 shrink-0 rounded-full ${FREE_CONSULTATION_TONE.chip}`} />Free consultation</span>
              <span className="flex items-center gap-1"><span className={`h-2 w-2 shrink-0 rounded-full ${WALK_IN_TONE.chip}`} />Frontdesk (walk-in)</span>
            </div>
          </div>
        </div>

        <div className="space-y-4">
          <MiniMonth
            cursor={monthCursor}
            onCursor={(next) => setSelectedDate(startOfDayLocal(next))}
            selectedDate={selectedDate}
            onSelect={(day) => setSelectedDate(startOfDayLocal(day))}
            busyKeys={busyKeys}
          />

          <AnimatePresence mode="wait">
            {selected ? (
              <EventDetails
                appointment={selected}
                tone={toneFor(selected)}
                onClose={closeSelected}
                onCancel={cancelSelected}
                cancelling={cancelling}
                role={role}
                settings={bookingSettings}
                onConverted={(clientId) => {
                  const clientMatch = selected.client || selected.matchedClient;
                  const linked = {
                    ...selected,
                    client: {
                      id: clientId,
                      fullName: clientMatch?.fullName || selected.guestName || "Client",
                      email: clientMatch?.email || selected.guestEmail || null,
                      phone: clientMatch?.phone || selected.guestPhone || null,
                    },
                    matchedClient: undefined,
                  };
                  setSelected(linked);
                  setAppointments((current) => current.map((item) => item.id === linked.id ? linked : item));
                  load({ fresh: true, background: true });
                }}
                onOpenNotes={() => setNotesAppointmentId(selected.id)}
                onStatus={async (status) => {
                  try {
                    const updated = await updateBookingAppointmentStatus(selected.id, status);
                    setAppointments((current) => current.map((item) => item.id === updated.id ? updated : item));
                    closeSelected();
                  } catch (reason) { setError(reason.response?.data?.message || "Appointment status could not be updated."); }
                }}
                onRescheduled={(updated) => {
                  if (updated.seriesAffected) load({ fresh: true });
                  else setAppointments((current) => current.map((item) => (item.id === updated.id ? updated : item)));
                  setSelected(updated);
                }}
                onPaymentUpdated={handlePaymentUpdated}
              />
            ) : (
              <motion.div
                key="upcoming"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 6 }}
                className="rounded-[1.4rem] border border-white/70 bg-white/85 p-5 shadow-[0_14px_40px_rgba(15,23,42,0.07)] backdrop-blur-xl"
              >
                <h3 className="text-sm font-semibold text-slate-900">Up next</h3>
                {upcoming.length ? (
                  <div className="mt-3 space-y-2.5">
                    {upcoming.map((item) => {
                      const tone = toneFor(item);
                      const ModeIcon = MEETING_MODE_ICON[item.meetingMode] || MapPin;
                      const paymentAttention = appointmentPaymentAttention(item, item.paymentHold, bookingSettings);
                      return (
                        <button key={item.id} type="button" onClick={() => { setSelected(item); setSelectedDate(startOfDayLocal(new Date(item.startsAt))); }} className={`flex w-full items-center gap-3 rounded-2xl px-2 py-1.5 text-left transition-[background-color,box-shadow] duration-[3800ms] hover:bg-slate-50 ${focusedAppointmentId === item.id ? "bg-amber-100 ring-2 ring-amber-300" : ""}`}>
                          <span className={`h-2 w-2 shrink-0 rounded-full ${tone.chip}`} />
                          <span className="min-w-0 flex-1">
                            <span className="flex items-center gap-1 truncate text-sm font-medium text-slate-800"><ModeIcon className="h-3 w-3 shrink-0 text-slate-400" />{item.client?.fullName || item.guestName || item.subject}</span>
                            <span className="block text-xs text-slate-400">
                              {new Date(item.startsAt).toLocaleDateString("en-CA", { weekday: "short", month: "short", day: "numeric" })} · {formatTime(item.startsAt)}
                            </span>
                            {paymentAttention ? <span className="mt-0.5 flex items-center gap-1 text-[11px] font-semibold text-amber-700"><Wallet className="h-3 w-3" /> {paymentAttention}</span> : null}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <p className="mt-2 text-sm text-slate-400">Nothing coming up in this month view.</p>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      <NewAppointmentSheet
        open={sheetOpen}
        onClose={() => { setSheetOpen(false); setPrefillClient(null); setPrefillLead(null); setPrefillIntake(null); }}
        onCreated={(created) => { setAppointments((current) => [...current, created]); setSelected(created); }}
        onRefresh={() => load({ fresh: true, background: true })}
        staff={staff}
        sessionTypes={sessionTypes}
        role={role}
        userId={appUser?.id}
        initialDate={dateKey(selectedDate)}
        initialClient={prefillClient}
        initialLead={prefillLead}
        initialIntake={prefillIntake}
        settings={bookingSettings}
      />
      {notesAppointmentId ? (
        <AppointmentProfileOverlay
          appointmentId={notesAppointmentId}
          initialTab="notes"
          onClose={() => setNotesAppointmentId(null)}
          onChanged={() => load({ fresh: true, background: true })}
        />
      ) : null}
      <AnimatePresence>
        {hoverPreview ? (
          <AppointmentHoverCard
            item={hoverPreview.item}
            tone={hoverPreview.tone}
            rect={hoverPreview.rect}
            onMouseEnter={keepHoverPreview}
            onMouseLeave={cancelHoverPreview}
            onViewDetails={() => { setSelected(hoverPreview.item); closeHoverPreview(); }}
          />
        ) : null}
      </AnimatePresence>
    </PageContainer>
  );
}
