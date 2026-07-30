import { AnimatePresence, motion } from "framer-motion";
import {
  Bell,
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Copy,
  Loader2,
  MapPin,
  Phone,
  Plus,
  RefreshCw,
  Trash2,
  UserRound,
  Video,
  Wallet,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useSearchParams } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import {
  cancelBookingAppointment,
  convertAppointmentToClient,
  createBookingAppointment,
  createWalkInPayNowLink,
  getAvailability,
  getBookingPaymentHoldStatus,
  getBookingSettings,
  getCalendarAppointments,
  getFreeConsultationEligibility,
  lookupBookingClients,
  recordWalkInManualPayment,
  rescheduleBookingAppointment,
  updateBookingAppointmentStatus,
} from "../api/bookingApi";
import PageContainer from "../components/layout/PageContainer";
import Select from "../components/ui/Select";
import api from "../services/api";

const DAY_MS = 24 * 60 * 60 * 1000;
const GRID_START_HOUR = 7;
const GRID_END_HOUR = 20;
const HOUR_PX = 60;

const EVENT_TONES = [
  { chip: "bg-sky-500", block: "border-sky-400 bg-sky-50/90 hover:bg-sky-100/90", title: "text-sky-900", meta: "text-sky-600" },
  { chip: "bg-violet-500", block: "border-violet-400 bg-violet-50/90 hover:bg-violet-100/90", title: "text-violet-900", meta: "text-violet-600" },
  { chip: "bg-emerald-500", block: "border-emerald-400 bg-emerald-50/90 hover:bg-emerald-100/90", title: "text-emerald-900", meta: "text-emerald-600" },
  { chip: "bg-amber-500", block: "border-amber-400 bg-amber-50/90 hover:bg-amber-100/90", title: "text-amber-900", meta: "text-amber-600" },
  { chip: "bg-rose-500", block: "border-rose-400 bg-rose-50/90 hover:bg-rose-100/90", title: "text-rose-900", meta: "text-rose-600" },
  { chip: "bg-indigo-500", block: "border-indigo-400 bg-indigo-50/90 hover:bg-indigo-100/90", title: "text-indigo-900", meta: "text-indigo-600" },
];
const NEUTRAL_TONE = { chip: "bg-slate-400", block: "border-slate-300 bg-slate-50/90 hover:bg-slate-100/90", title: "text-slate-800", meta: "text-slate-500" };

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

function formatTime(value) {
  return new Date(value).toLocaleTimeString("en-CA", { hour: "numeric", minute: "2-digit" });
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

function DetailRow({ icon: Icon, children }) {
  return (
    <p className="flex items-center gap-2.5 text-sm text-slate-600">
      <Icon className="h-4 w-4 shrink-0 text-slate-400" />
      <span className="min-w-0">{children}</span>
    </p>
  );
}

function EventDetails({ appointment, tone, onClose, onCancel, cancelling, onRescheduled, onConverted, onStatus, role, settings }) {
  const start = new Date(appointment.startsAt);
  const person = appointment.client?.fullName || appointment.guestName || "No contact";
  const initials = person.split(" ").filter(Boolean).map((part) => part[0]).join("").slice(0, 2).toUpperCase();
  const [resched, setResched] = useState(false);
  const [reschedDate, setReschedDate] = useState(dateKey(start));
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
  const duration = Math.round((new Date(appointment.endsAt) - start) / 60000);
  const [payNow, setPayNow] = useState(null);
  const [payNowBusy, setPayNowBusy] = useState(false);
  const [payNowError, setPayNowError] = useState("");
  const [payNowCopied, setPayNowCopied] = useState(false);
  const [manualNote, setManualNote] = useState("");
  const [manualBusy, setManualBusy] = useState("");
  const [manualError, setManualError] = useState("");
  const meetingSyncLabel = appointment.meetingSyncStatus === "Pending"
    ? "preparing link"
    : appointment.meetingSyncStatus === "Retrying"
      ? "temporary issue · retrying automatically"
      : appointment.meetingSyncStatus === "Failed"
        ? "link setup failed"
        : "";

  async function generatePayNowLink() {
    setPayNowBusy(true);
    setPayNowError("");
    try {
      const result = await createWalkInPayNowLink(appointment.id);
      setPayNow(result);
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
    setManualBusy(method);
    setManualError("");
    try {
      const result = await recordWalkInManualPayment(appointment.id, { method, note: manualNote.trim() || undefined });
      setPayNow(result);
      setManualNote("");
    } catch (reason) {
      setManualError(reason.response?.data?.message || "Could not record this payment.");
    } finally {
      setManualBusy("");
    }
  }

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

  async function convertGuest() {
    setConverting(true);
    try { const result = await convertAppointmentToClient(appointment.id); onConverted(result.clientId); }
    catch (reason) { setReschedError(reason.response?.data?.message || "Could not convert this visitor."); }
    finally { setConverting(false); }
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
        <div className="flex min-w-0 items-center gap-2.5">
          <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${tone.chip}`} />
          <h3 className="truncate text-base font-semibold text-slate-950">{appointment.subject}</h3>
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
        <span className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-slate-700 to-slate-950 text-xs font-semibold text-white">
          {initials}
        </span>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-slate-900">{person}</p>
          <p className="text-xs text-slate-400">{appointment.client ? "Client" : "Walk-in guest"}{appointment.case ? ` · ${appointment.case.caseType}` : ""}</p>
        </div>
        {!appointment.client ? <button type="button" disabled={converting} onClick={convertGuest} className="ml-auto shrink-0 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-[11px] font-semibold text-slate-700 transition hover:border-sky-300 disabled:opacity-50">{converting ? "Saving…" : "Save as client"}</button> : null}
      </div>

      {appointment.description ? (
        <div className="mt-4">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">About</p>
          <p className="mt-1.5 text-sm leading-6 text-slate-600">{appointment.description}</p>
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

      {appointment.status === "Scheduled" && !appointment.isFreeConsultation ? (
        <div className="mt-4 rounded-2xl border border-slate-200/80 bg-slate-50/70 p-3.5">
          {payNow ? (
            payNow.status === "Paid" ? (
              <p className="flex items-center gap-2 text-sm font-semibold text-emerald-700"><Check className="h-4 w-4" /> Consultation fee paid</p>
            ) : payNow.payNowUrl ? (
              <>
                <p className="text-xs font-semibold text-slate-700">Consultation fee — {Number(payNow.amount).toLocaleString("en-CA", { style: "currency", currency: "CAD" })}</p>
                <p className="mt-1 text-xs text-slate-400">Share this link so the client can pay by card on the spot.</p>
                <button type="button" onClick={copyPayNowLink} className="mt-2 flex h-9 w-full items-center justify-center gap-1.5 rounded-full bg-slate-950 text-xs font-semibold text-white transition hover:bg-slate-800">
                  {payNowCopied ? <Check className="h-3.5 w-3.5 text-emerald-300" /> : <Copy className="h-3.5 w-3.5" />} {payNowCopied ? "Link copied" : "Copy pay-now link"}
                </button>
              </>
            ) : (
              <p className="text-xs leading-5 text-amber-700">Invoice created in QuickBooks, but online card payment isn't available on this company yet. Collect payment via cash or e-transfer instead.</p>
            )
          ) : (
            <button type="button" disabled={payNowBusy} onClick={generatePayNowLink} className="flex h-10 w-full items-center justify-center gap-1.5 rounded-full border border-slate-200 bg-white text-sm font-semibold text-slate-700 transition hover:border-sky-300 hover:bg-sky-50 disabled:opacity-50">
              {payNowBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wallet className="h-4 w-4" />} {payNowBusy ? "Generating…" : "Charge consultation fee by card"}
            </button>
          )}
          {payNowError ? <p className="mt-2 text-xs text-rose-600">{payNowError}</p> : null}
          {payNow?.status !== "Paid" ? (
            <div className="mt-3 border-t border-slate-200/70 pt-3">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Already paid another way?</p>
              <input
                type="text"
                value={manualNote}
                onChange={(event) => setManualNote(event.target.value)}
                placeholder="Note (optional)"
                className="mt-2 h-9 w-full rounded-full border border-slate-200 bg-white px-3.5 text-xs text-slate-700 outline-none transition focus:border-sky-400 focus:ring-2 focus:ring-sky-100"
              />
              <div className="mt-2 flex gap-2">
                <button type="button" disabled={Boolean(manualBusy)} onClick={() => recordManualPayment("Cash")} className="flex h-9 flex-1 items-center justify-center gap-1.5 rounded-full border border-slate-200 bg-white text-xs font-semibold text-slate-700 transition hover:border-emerald-300 hover:bg-emerald-50 disabled:opacity-50">
                  {manualBusy === "Cash" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null} Record cash
                </button>
                <button type="button" disabled={Boolean(manualBusy)} onClick={() => recordManualPayment("ETransfer")} className="flex h-9 flex-1 items-center justify-center gap-1.5 rounded-full border border-slate-200 bg-white text-xs font-semibold text-slate-700 transition hover:border-emerald-300 hover:bg-emerald-50 disabled:opacity-50">
                  {manualBusy === "ETransfer" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null} Record e-transfer
                </button>
              </div>
              {manualError ? <p className="mt-2 text-xs text-rose-600">{manualError}</p> : null}
            </div>
          ) : null}
        </div>
      ) : null}

      {resched ? (
        <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50/80 p-3.5">
          <p className="text-xs font-semibold text-slate-700">Move to</p>
          {appointment.seriesKey ? <div className="mt-2 flex rounded-xl bg-slate-100 p-1">{[["single", "This appointment"], ["series", "This & future"]].map(([value, label]) => <button key={value} type="button" onClick={() => setSeriesScope(value)} className={`flex-1 rounded-lg px-2 py-1.5 text-[11px] font-semibold ${seriesScope === value ? "bg-white text-slate-900 shadow-sm" : "text-slate-500"}`}>{label}</button>)}</div> : null}
          <input
            type="date"
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
      ) : (
        <div className="mt-4 grid grid-cols-2 gap-2">
          {start > new Date() ? <><button
            type="button"
            onClick={() => setResched(true)}
            className="flex h-11 items-center justify-center gap-1.5 rounded-full border border-slate-200 bg-white text-sm font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-slate-50"
          >
            <CalendarDays className="h-4 w-4" /> Reschedule
          </button>
          <button
            type="button"
            onClick={() => onCancel(seriesScope)}
            disabled={cancelling}
            className="flex h-11 items-center justify-center gap-2 rounded-full border border-rose-200 bg-rose-50 text-sm font-semibold text-rose-700 transition hover:bg-rose-100 disabled:opacity-60"
          >
            {cancelling ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />} Cancel
          </button></> : null}
          {start > new Date() && appointment.seriesKey ? <div className="col-span-2 flex rounded-xl bg-slate-100 p-1">{[["single", "Only this appointment"], ["series", "This and future appointments"]].map(([value, label]) => <button key={value} type="button" onClick={() => setSeriesScope(value)} className={`flex-1 rounded-lg px-2 py-1.5 text-[10px] font-semibold ${seriesScope === value ? "bg-white text-slate-900 shadow-sm" : "text-slate-500"}`}>{label}</button>)}</div> : null}
          {start <= new Date() ? <>
            <button type="button" onClick={() => onStatus("Completed")} className="h-10 rounded-full border border-emerald-200 bg-emerald-50 text-xs font-semibold text-emerald-700 transition hover:bg-emerald-100">Mark attended</button>
            <button type="button" onClick={() => onStatus("NoShow")} className="h-10 rounded-full border border-amber-200 bg-amber-50 text-xs font-semibold text-amber-700 transition hover:bg-amber-100">Mark no-show</button>
          </> : null}
        </div>
      )}
    </motion.div>
  );
}

function NewAppointmentSheet({ open, onClose, onCreated, onRefresh, staff, sessionTypes, role, userId, initialDate, settings }) {
  const [clients, setClients] = useState([]);
  const locations = Array.isArray(settings?.locations) ? settings.locations : [];
  const [form, setForm] = useState({ mode: role === "frontdesk" ? "guest" : "client", clientId: "", guestName: "", guestEmail: "", guestPhone: "", sessionTypeId: "", assignedToId: "", date: dateKey(new Date()), startsAt: "", subject: "", location: "", locationId: locations.length === 1 ? locations[0].id : "", meetingMode: "InPerson", recurrenceFrequency: "NONE", recurrenceCount: 2, paymentMethod: "" });
  const [slots, setSlots] = useState(null);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [freeEligibility, setFreeEligibility] = useState(null);
  const [clientSearch, setClientSearch] = useState("");
  const [pendingHold, setPendingHold] = useState(null);
  const [bookedWarning, setBookedWarning] = useState(null);

  useEffect(() => {
    if (!open) return;
    setForm((current) => ({ ...current, startsAt: "", date: initialDate || current.date, assignedToId: role === "consultant" ? userId : current.assignedToId, paymentMethod: "" }));
    setError("");
    setClientSearch("");
    setPendingHold(null);
    setBookedWarning(null);
    if (role === "frontdesk") {
      lookupBookingClients().then(setClients).catch(() => {});
    } else {
      api.get("/clients?limit=100").then((response) => setClients(response.data.data || [])).catch(() => {});
    }
  }, [open, role, userId, initialDate]);

  useEffect(() => {
    if (!open) return;
    const clientId = form.mode === "client" ? form.clientId : "";
    const guestEmail = form.mode === "guest" ? form.guestEmail.trim() : "";
    if (!clientId && !guestEmail) { setFreeEligibility(null); return; }
    const timer = setTimeout(() => {
      getFreeConsultationEligibility({ clientId: clientId || undefined, guestEmail: guestEmail || undefined })
        .then(setFreeEligibility)
        .catch(() => setFreeEligibility(null));
    }, 350);
    return () => clearTimeout(timer);
  }, [open, form.mode, form.clientId, form.guestEmail]);

  useEffect(() => {
    if (!pendingHold || pendingHold.status !== "AwaitingPayment") return;
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

  const activeTypes = sessionTypes.filter((type) => type.isActive);
  const selectedType = activeTypes.find((type) => type.id === form.sessionTypeId) || activeTypes[0] || null;
  const selectedClient = clients.find((client) => client.id === form.clientId) || null;
  const clientMatchesByName = form.clientId ? clients.filter((client) => client.fullName === selectedClient?.fullName) : [];
  const consultFeeAmount = Number(settings?.consultFeeAmount) || 0;
  const showsPaymentStep = consultFeeAmount > 0 && freeEligibility?.eligible !== true;
  const clientSearchNeedle = clientSearch.trim().toLowerCase();
  const filteredClients = clientSearchNeedle
    ? clients.filter((client) => [client.fullName, client.email, client.phone, client.clientNumber].filter(Boolean).some((field) => String(field).toLowerCase().includes(clientSearchNeedle)))
    : clients;
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

  const loadSlots = useCallback(async () => {
    if (!form.date || !selectedType) return;
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
  }, [form.date, form.assignedToId, form.meetingMode, form.locationId, selectedType, role]);

  useEffect(() => { if (open) loadSlots(); }, [open, loadSlots]);

  async function submit(event) {
    event.preventDefault();
    if (!form.startsAt) { setError("Pick an available time."); return; }
    if (showsPaymentStep && !form.paymentMethod) { setError("Choose how the client will pay."); return; }
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
        locationId: (form.meetingMode || "InPerson") === "InPerson" ? form.locationId || undefined : undefined,
        meetingMode: form.meetingMode || "InPerson",
        source: form.mode === "guest" ? "WalkIn" : "Internal",
        recurrence: { frequency: form.recurrenceFrequency, count: form.recurrenceFrequency === "NONE" ? 1 : Number(form.recurrenceCount) },
        paymentMethod: showsPaymentStep && form.paymentMethod !== "Skip" ? form.paymentMethod : undefined,
      });
      if (created.pending) {
        setPendingHold({ holdId: created.holdId, status: created.status, amount: created.amount, payNowUrl: created.payNowUrl, expiresAt: created.expiresAt });
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
                <div className="rounded-2xl border border-sky-200 bg-sky-50/70 p-4 text-center">
                  <Loader2 className="mx-auto h-6 w-6 animate-spin text-sky-600" />
                  <p className="mt-3 text-sm font-semibold text-slate-800">Slot reserved — waiting for payment</p>
                  <p className="mt-1 text-xs leading-5 text-slate-500">The appointment will confirm automatically the moment the {Number(pendingHold.amount).toLocaleString("en-CA", { style: "currency", currency: "CAD" })} payment goes through.</p>
                </div>
                {pendingHold.payNowUrl ? (
                  <button type="button" onClick={() => navigator.clipboard.writeText(pendingHold.payNowUrl)} className="flex h-10 w-full items-center justify-center gap-1.5 rounded-full border border-slate-200 bg-white text-sm font-semibold text-slate-700 transition hover:border-sky-300 hover:bg-sky-50">
                    <Copy className="h-3.5 w-3.5" /> Copy pay-now link
                  </button>
                ) : null}
                {pendingHold.expiresAt ? <p className="text-center text-xs text-slate-400">Reservation expires at {new Date(pendingHold.expiresAt).toLocaleTimeString("en-CA", { hour: "numeric", minute: "2-digit" })} if unpaid.</p> : null}
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
              <div className="flex rounded-full border border-slate-200 bg-slate-50 p-0.5">
                {[["client", "Existing client"], ["guest", "Walk-in / guest"]].map(([mode, label]) => (
                  <button key={mode} type="button" onClick={() => setForm((c) => ({ ...c, mode }))} className={`flex-1 rounded-full px-3 py-2 text-xs font-semibold transition ${form.mode === mode ? "bg-slate-950 text-white shadow" : "text-slate-500 hover:text-slate-800"}`}>{label}</button>
                ))}
              </div>

              {form.mode === "client" ? (
                <div className="space-y-1.5">
                  <label className="block text-xs font-medium text-slate-600">Search by name, email, phone, or client #
                    <input value={clientSearch} onChange={(event) => setClientSearch(event.target.value)} placeholder="Start typing to narrow the list…" className={`mt-1.5 ${input}`} />
                  </label>
                  <label className="block text-xs font-medium text-slate-600">Client
                    <Select value={form.clientId} onChange={(event) => setForm((c) => ({ ...c, clientId: event.target.value }))} className="mt-1.5 w-full" ariaLabel="Client">
                      <option value="">Choose a client…</option>
                      {filteredClients.map((client) => (
                        <option key={client.id} value={client.id}>
                          {client.fullName}
                          {client.clientNumber ? ` · #${client.clientNumber}` : ""}
                          {client.email ? ` · ${client.email}` : ""}
                          {client.phone ? ` · ${client.phone}` : ""}
                        </option>
                      ))}
                    </Select>
                  </label>
                  {selectedClient && clientMatchesByName.length > 1 ? (
                    <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-800">
                      {clientMatchesByName.length} clients are named "{selectedClient.fullName}". You selected {selectedClient.email || selectedClient.phone || `client #${selectedClient.clientNumber || selectedClient.id.slice(0, 8)}`} — double-check this is the right one.
                    </p>
                  ) : null}
                </div>
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

              {freeEligibility?.enabled ? (
                freeEligibility.eligible ? (
                  <p className="rounded-xl bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-700">Free consultation available ({freeEligibility.priorFreeCount} of {freeEligibility.limit} used)</p>
                ) : (
                  <p className="rounded-xl bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-700">Free consultation limit reached — this will be booked as a paid consultation.</p>
                )
              ) : null}

              {showsPaymentStep ? (
                <div>
                  <p className="text-xs font-medium text-slate-600">How will they pay? — {consultFeeAmount.toLocaleString("en-CA", { style: "currency", currency: "CAD" })}</p>
                  <div className="mt-1.5 grid grid-cols-4 gap-1.5">
                    {[["Card", "Card"], ["Cash", "Cash"], ["ETransfer", "E-transfer"], ["Skip", "Skip"]].map(([value, label]) => (
                      <button key={value} type="button" onClick={() => setForm((c) => ({ ...c, paymentMethod: value }))} className={`rounded-lg px-2 py-2 text-xs font-semibold transition ${form.paymentMethod === value ? "bg-slate-950 text-white shadow" : "border border-slate-200 bg-white text-slate-700 hover:border-sky-300 hover:bg-sky-50/50"}`}>
                        {label}
                      </button>
                    ))}
                  </div>
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

              <div className="grid grid-cols-2 gap-3">
                <label className="block text-xs font-medium text-slate-600">Session type
                  <Select value={selectedType?.id || ""} onChange={(event) => setForm((c) => ({ ...c, sessionTypeId: event.target.value, startsAt: "" }))} className="mt-1.5 w-full" ariaLabel="Session type">
                    {activeTypes.map((type) => <option key={type.id} value={type.id}>{type.name} · {type.durationMinutes}m</option>)}
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
                {loadingSlots ? (
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

              <label className="block text-xs font-medium text-slate-600">Subject (optional)
                <input value={form.subject} onChange={(event) => setForm((c) => ({ ...c, subject: event.target.value }))} placeholder={selectedType?.name || "Appointment"} className={`mt-1.5 ${input}`} />
              </label>
              {(form.meetingMode || "InPerson") === "InPerson" && locations.length ? (
                <label className="block text-xs font-medium text-slate-600">Office location
                  <Select value={form.locationId} onChange={(event) => setForm((c) => ({ ...c, locationId: event.target.value }))} className="mt-1.5 w-full" ariaLabel="Office location">
                    <option value="">Choose a location…</option>
                    {locations.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                  </Select>
                </label>
              ) : (form.meetingMode || "InPerson") === "InPerson" ? (
                <label className="block text-xs font-medium text-slate-600">Location (optional)
                  <input value={form.location} onChange={(event) => setForm((c) => ({ ...c, location: event.target.value }))} placeholder="Office or meeting place" className={`mt-1.5 ${input}`} />
                </label>
              ) : null}
              {form.meetingMode === "Phone" ? <p className="rounded-xl bg-sky-50 px-3 py-2 text-xs leading-5 text-sky-800">The office will call {form.mode === "client" ? selectedClient?.phone || "the client’s saved number" : form.guestPhone || "the visitor’s number"}{settings?.phoneCallerId ? ` from ${settings.phoneCallerId}` : ""}. A valid client phone number is required.</p> : null}

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
              <button type="button" onClick={submit} disabled={saving || !form.startsAt || (form.meetingMode === "Phone" && !(form.mode === "client" ? selectedClient?.phone : form.guestPhone))} className="flex h-12 w-full items-center justify-center gap-2 rounded-full bg-slate-950 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:opacity-50">
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
  const [searchParams, setSearchParams] = useSearchParams();
  const linkedAppointmentId = searchParams.get("appointment") || "";
  const linkedDate = searchParams.get("date");
  const now = useNow();
  const [selectedDate, setSelectedDate] = useState(() => startOfDayLocal(linkedDate && /^\d{4}-\d{2}-\d{2}$/.test(linkedDate) ? new Date(`${linkedDate}T12:00:00`) : new Date()));
  const [view, setView] = useState("week");
  const [appointments, setAppointments] = useState([]);
  const [sessionTypes, setSessionTypes] = useState([]);
  const [bookingSettings, setBookingSettings] = useState(null);
  const [staff, setStaff] = useState([]);
  const [staffFilter, setStaffFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [sheetOpen, setSheetOpen] = useState(false);
  const [selected, setSelected] = useState(null);
  const [cancelling, setCancelling] = useState(false);

  const monthCursor = useMemo(() => new Date(selectedDate.getFullYear(), selectedDate.getMonth(), 1), [selectedDate]);
  const rangeStart = useMemo(() => startOfWeek(monthCursor), [monthCursor]);
  const rangeEnd = useMemo(() => new Date(rangeStart.getTime() + 42 * DAY_MS), [rangeStart]);

  const load = useCallback(async ({ fresh = false, background = false } = {}) => {
    if (!background) setLoading(true);
    setError("");
    try {
      const [calendar, settings] = await Promise.all([
        getCalendarAppointments({ from: rangeStart.toISOString(), to: rangeEnd.toISOString(), fresh }),
        getBookingSettings(),
      ]);
      setAppointments(calendar);
      setSessionTypes(settings.sessionTypes);
      setBookingSettings(settings.settings);
    } catch (reason) {
      setError(reason.response?.data?.message || "The calendar could not be loaded.");
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
    setView("day");
    setSelectedDate((current) => dateKey(current) === dateKey(new Date(linked.startsAt)) ? current : startOfDayLocal(new Date(linked.startsAt)));
  }, [appointments, linkedAppointmentId]);

  useEffect(() => {
    const refreshWhenVisible = () => { if (document.visibilityState === "visible") load({ fresh: true, background: true }); };
    window.addEventListener("focus", refreshWhenVisible);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    const interval = window.setInterval(refreshWhenVisible, 60_000);
    return () => { window.removeEventListener("focus", refreshWhenVisible); document.removeEventListener("visibilitychange", refreshWhenVisible); window.clearInterval(interval); };
  }, [load]);

  useEffect(() => {
    if (role === "consultant") return;
    api.get("/leads/staff").then((response) => {
      setStaff((response.data.data || []).filter((member) => ["admin", "consultant"].includes(member.role)));
    }).catch(() => {});
  }, [role]);

  const staffTone = useMemo(() => {
    const map = new Map();
    staff.forEach((member, index) => map.set(member.id, EVENT_TONES[index % EVENT_TONES.length]));
    return map;
  }, [staff]);

  const toneFor = useCallback(
    (item) => (item.assignedTo && staffTone.get(item.assignedTo.id)) || (role === "consultant" ? EVENT_TONES[0] : NEUTRAL_TONE),
    [staffTone, role],
  );

  const visible = useMemo(
    () => appointments.filter((item) => item.status === "Scheduled" && (!staffFilter || item.assignedTo?.id === staffFilter)),
    [appointments, staffFilter],
  );

  const busyKeys = useMemo(() => new Set(visible.map((item) => dateKey(new Date(item.startsAt)))), [visible]);

  const days = useMemo(() => {
    if (view === "day") return [selectedDate];
    const weekStart = startOfWeek(selectedDate);
    return Array.from({ length: 7 }, (_, index) => new Date(weekStart.getTime() + index * DAY_MS));
  }, [view, selectedDate]);

  function shift(direction) {
    setSelectedDate((current) => new Date(current.getTime() + direction * (view === "day" ? 1 : 7) * DAY_MS));
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

  const headerDate = view === "day"
    ? selectedDate.toLocaleDateString("en-CA", { month: "long", day: "numeric", year: "numeric" })
    : `${days[0].toLocaleDateString("en-CA", { month: "short", day: "numeric" })} – ${days[days.length - 1].toLocaleDateString("en-CA", { month: "short", day: "numeric", year: "numeric" })}`;
  const headerSub = view === "day"
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
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-5 py-4">
            <div className="flex items-center gap-3.5">
              <div className="flex h-12 w-12 flex-col items-center justify-center overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
                <span className="w-full bg-slate-950 text-center text-[8px] font-bold uppercase tracking-wider text-white">
                  {selectedDate.toLocaleDateString("en-CA", { month: "short" })}
                </span>
                <span className="flex-1 pt-0.5 text-base font-bold leading-none text-slate-900">{selectedDate.getDate()}</span>
              </div>
              <div>
                <h2 className="text-lg font-semibold leading-6 tracking-tight text-slate-950">{headerDate}</h2>
                <p className="text-sm text-slate-400">{headerSub}</p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {role !== "consultant" && staff.length ? (
                <Select value={staffFilter} onChange={(event) => setStaffFilter(event.target.value)} ariaLabel="Filter by staff">
                  <option value="">All staff</option>
                  {staff.map((member) => <option key={member.id} value={member.id}>{member.fullName}</option>)}
                </Select>
              ) : null}
              <div className="flex items-center overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
                <button type="button" aria-label="Previous" onClick={() => shift(-1)} className="flex h-[42px] w-10 items-center justify-center text-slate-500 transition hover:bg-slate-50"><ChevronLeft className="h-4 w-4" /></button>
                <button type="button" onClick={() => setSelectedDate(startOfDayLocal(new Date()))} className="h-[42px] border-x border-slate-200 px-4 text-sm font-semibold text-slate-700 transition hover:bg-slate-50">Today</button>
                <button type="button" aria-label="Next" onClick={() => shift(1)} className="flex h-[42px] w-10 items-center justify-center text-slate-500 transition hover:bg-slate-50"><ChevronRight className="h-4 w-4" /></button>
              </div>
              <Select value={view} onChange={(event) => setView(event.target.value)} ariaLabel="Calendar view">
                <option value="day">Day view</option>
                <option value="week">Week view</option>
              </Select>
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

          <div className="overflow-x-auto">
            <div className={view === "week" ? "min-w-[820px]" : "min-w-[420px]"}>
              {view === "week" ? (
                <div className="grid grid-cols-[52px_repeat(7,1fr)] border-b border-slate-100">
                  <div />
                  {days.map((day) => {
                    const isToday = dateKey(day) === todayKey;
                    return (
                      <button key={day.toISOString()} type="button" onClick={() => { setSelectedDate(startOfDayLocal(day)); setView("day"); }} className="group px-2 py-2.5 text-center">
                        <p className={`text-[11px] font-semibold uppercase tracking-wide ${isToday ? "text-sky-600" : "text-slate-400"}`}>{day.toLocaleDateString("en-CA", { weekday: "short" })}</p>
                        <p className={`mx-auto mt-1 flex h-7 w-7 items-center justify-center rounded-full text-sm font-semibold transition ${isToday ? "bg-sky-600 text-white" : "text-slate-700 group-hover:bg-slate-100"}`}>{day.getDate()}</p>
                      </button>
                    );
                  })}
                </div>
              ) : null}

              <div className={view === "week" ? "grid grid-cols-[52px_repeat(7,1fr)]" : "grid grid-cols-[52px_1fr]"}>
                <div className="relative" style={{ height: gridHours * HOUR_PX }}>
                  {Array.from({ length: gridHours }, (_, index) => (
                    <span key={index} className="absolute right-2.5 -translate-y-1/2 text-[10px] font-medium text-slate-400" style={{ top: (index + 1) * HOUR_PX }}>
                      {((GRID_START_HOUR + index) % 12) + 1} {GRID_START_HOUR + index + 1 <= 11 || GRID_START_HOUR + index + 1 >= 24 ? "AM" : "PM"}
                    </span>
                  ))}
                </div>
                {days.map((day) => {
                  const key = dateKey(day);
                  const dayItems = visible.filter((item) => dateKey(new Date(item.startsAt)) === key);
                  const isToday = key === todayKey;
                  return (
                    <div key={key} className={`relative border-l border-slate-100 ${isToday ? "bg-sky-50/30" : ""}`} style={{ height: gridHours * HOUR_PX }}>
                      {Array.from({ length: gridHours }, (_, index) => (
                        <div key={index} className="absolute inset-x-0 border-t border-slate-100/90" style={{ top: index * HOUR_PX }} />
                      ))}
                      {isToday && showNowLine ? (
                        <div className="pointer-events-none absolute inset-x-0 z-10" style={{ top: nowOffset }}>
                          <div className="relative border-t-[1.5px] border-rose-500">
                            <span className="absolute -left-[3px] -top-[4px] h-2 w-2 rounded-full bg-rose-500" />
                          </div>
                        </div>
                      ) : null}
                      {dayItems.map((item) => {
                        const start = new Date(item.startsAt);
                        const end = new Date(item.endsAt);
                        const top = (start.getHours() + start.getMinutes() / 60 - GRID_START_HOUR) * HOUR_PX;
                        const height = Math.max(30, ((end - start) / 3600000) * HOUR_PX - 3);
                        const tone = toneFor(item);
                        const isSelected = selected?.id === item.id;
                        return (
                          <button
                            key={item.id}
                            type="button"
                            onClick={() => setSelected(item)}
                            className={`absolute inset-x-1.5 overflow-hidden rounded-xl border-l-[3px] px-2 py-1.5 text-left shadow-[0_4px_12px_rgba(15,23,42,0.05)] transition ${tone.block} ${isSelected ? "ring-2 ring-slate-950/70" : ""}`}
                            style={{ top: Math.max(0, top), height }}
                          >
                            <p className={`truncate text-[12px] font-semibold leading-tight ${tone.title}`}>{item.client?.fullName || item.guestName || item.subject}</p>
                            <p className={`truncate text-[11px] ${tone.meta}`}>{formatTime(item.startsAt)}{item.sessionType ? ` · ${item.sessionType.name}` : ""}</p>
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
                onConverted={() => { closeSelected(); load({ fresh: true }); }}
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
                      return (
                        <button key={item.id} type="button" onClick={() => { setSelected(item); setSelectedDate(startOfDayLocal(new Date(item.startsAt))); }} className="flex w-full items-center gap-3 rounded-2xl px-2 py-1.5 text-left transition hover:bg-slate-50">
                          <span className={`h-2 w-2 shrink-0 rounded-full ${tone.chip}`} />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-medium text-slate-800">{item.client?.fullName || item.guestName || item.subject}</span>
                            <span className="block text-xs text-slate-400">
                              {new Date(item.startsAt).toLocaleDateString("en-CA", { weekday: "short", month: "short", day: "numeric" })} · {formatTime(item.startsAt)}
                            </span>
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
        onClose={() => setSheetOpen(false)}
        onCreated={(created) => { setAppointments((current) => [...current, created]); setSelected(created); }}
        onRefresh={() => load({ fresh: true, background: true })}
        staff={staff}
        sessionTypes={sessionTypes}
        role={role}
        userId={appUser?.id}
        initialDate={dateKey(selectedDate)}
        settings={bookingSettings}
      />
    </PageContainer>
  );
}
