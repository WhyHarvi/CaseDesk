import { AnimatePresence, motion } from "framer-motion";
import { ArrowLeft, CalendarClock, CalendarDays, CheckCircle2, Clock3, Loader2, MapPin, Video, XCircle } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import {
  cancelManagedBooking,
  completeManagedPreparation,
  confirmManagedBooking,
  getManagedAvailability,
  getManagedBooking,
  rescheduleManagedBooking,
} from "../api/bookingApi";
import { BookingMonthPicker, PublicShell } from "./PublicBookingPage";

function formatWhen(value, timezone) {
  return `${new Date(value).toLocaleDateString("en-CA", { timeZone: timezone, weekday: "long", month: "long", day: "numeric", year: "numeric" })} at ${new Date(value).toLocaleTimeString("en-CA", { timeZone: timezone, hour: "numeric", minute: "2-digit" })}`;
}

export default function ManageBookingPage() {
  const { manageToken } = useParams();
  const [booking, setBooking] = useState(null);
  const [loadError, setLoadError] = useState("");
  const [mode, setMode] = useState("view");
  const [slot, setSlot] = useState(null);
  const [meetingMode, setMeetingMode] = useState("InPerson");
  const [locationId, setLocationId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [cancelReason, setCancelReason] = useState("");
  const [seriesScope, setSeriesScope] = useState("single");

  useEffect(() => {
    getManagedBooking(manageToken)
      .then((data) => {
        setBooking(data);
        setMeetingMode(data.meetingMode || "InPerson");
        setLocationId(data.locationId || (data.locations?.length === 1 ? data.locations[0].id : ""));
      })
      .catch((reason) => setLoadError(reason.response?.data?.message || "This appointment link is not valid."));
  }, [manageToken]);

  const fetchAvailability = useCallback(
    (range) => getManagedAvailability(manageToken, range),
    [manageToken],
  );

  async function confirmCancel() {
    setBusy(true);
    setError("");
    try {
      const updated = await cancelManagedBooking(manageToken, cancelReason, seriesScope);
      setBooking(updated);
      setMode("view");
      setNotice("Your appointment has been cancelled.");
    } catch (reason) {
      setError(reason.response?.data?.message || "The appointment could not be cancelled.");
    } finally {
      setBusy(false);
    }
  }

  async function confirmReschedule() {
    if (!slot) return;
    setBusy(true);
    setError("");
    try {
      const updated = await rescheduleManagedBooking(manageToken, {
        startsAt: slot.startsAt,
        meetingMode,
        locationId: meetingMode === "InPerson" ? locationId || booking.locations?.[0]?.id : undefined,
        scope: seriesScope,
      });
      setBooking(updated);
      setMeetingMode(updated.meetingMode || "InPerson");
      setLocationId(updated.locationId || (updated.locations?.length === 1 ? updated.locations[0].id : ""));
      setMode("view");
      setSlot(null);
      setNotice("Your appointment has been moved. A new confirmation is on its way.");
    } catch (reason) {
      setError(reason.response?.data?.message || "The appointment could not be moved.");
    } finally {
      setBusy(false);
    }
  }

  async function confirmAttendance() {
    setBusy(true); setError("");
    try { const updated = await confirmManagedBooking(manageToken); setBooking(updated); setNotice("Attendance confirmed. We’ll see you there."); }
    catch (reason) { setError(reason.response?.data?.message || "Attendance could not be confirmed."); }
    finally { setBusy(false); }
  }

  async function completePreparation() {
    setBusy(true); setError("");
    try { const updated = await completeManagedPreparation(manageToken); setBooking(updated); setNotice("Preparation marked complete."); }
    catch (reason) { setError(reason.response?.data?.message || "Preparation could not be updated."); }
    finally { setBusy(false); }
  }

  if (loadError) {
    return (
      <PublicShell>
        <div className="py-10 text-center">
          <p className="text-lg font-semibold text-slate-900">Link not valid</p>
          <p className="mt-2 text-sm text-slate-500">{loadError}</p>
        </div>
      </PublicShell>
    );
  }

  if (!booking) {
    return (
      <PublicShell>
        <div className="flex items-center justify-center gap-2 py-14 text-sm text-slate-500">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading your appointment…
        </div>
      </PublicShell>
    );
  }

  const cancelled = booking.status !== "Scheduled";
  const past = new Date(booking.startsAt) <= new Date();
  const locations = booking.locations || [];
  const needsLocation = meetingMode === "InPerson" && locations.length > 1;

  return (
    <PublicShell agencyName={booking.agencyName}>
      <AnimatePresence mode="wait">
        {mode === "reschedule" ? (
          <motion.div key="reschedule" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}>
            <div className="mb-4 flex items-center justify-between">
              <button type="button" onClick={() => { setMode("view"); setSlot(null); setError(""); }} className="flex items-center gap-1.5 text-sm font-medium text-slate-500 transition hover:text-slate-800">
                <ArrowLeft className="h-4 w-4" /> Back
              </button>
              <p className="text-sm text-slate-500">Update appointment</p>
            </div>
            {error ? <p className="mb-3 rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p> : null}
            {booking.isRecurring ? <div className="mb-4 flex rounded-xl bg-slate-100 p-1">{[["single", "Only this appointment"], ["series", "This and future"]].map(([value, label]) => <button key={value} type="button" onClick={() => setSeriesScope(value)} className={`flex-1 rounded-lg px-2 py-2 text-xs font-semibold ${seriesScope === value ? "bg-white text-slate-900 shadow-sm" : "text-slate-500"}`}>{label}</button>)}</div> : null}

            <div className="mb-5">
              <p className="text-sm font-semibold text-slate-900">How would you like to meet?</p>
              <div className="mt-2 grid grid-cols-2 gap-2">
                {[
                  { id: "InPerson", label: "In person", icon: MapPin, disabled: (!locations.length && booking.meetingMode !== "InPerson") || !booking.allowedMeetingModes?.includes("InPerson") },
                  { id: "Online", label: "Video call", icon: Video, disabled: !booking.allowedMeetingModes?.includes("Online") },
                ].map(({ id, label, icon: Icon, disabled }) => (
                  <motion.button
                    key={id}
                    type="button"
                    disabled={disabled}
                    whileTap={{ scale: 0.97 }}
                    onClick={() => {
                      setMeetingMode(id);
                      if (id === "InPerson" && locations.length === 1) setLocationId(locations[0].id);
                    }}
                    className={`flex min-h-12 items-center justify-center gap-2 rounded-2xl border px-3 text-sm font-semibold transition ${meetingMode === id ? "border-sky-600 bg-sky-600 text-white shadow-[0_8px_20px_rgba(2,132,199,0.28)]" : "border-slate-200 bg-white text-slate-700 hover:border-slate-300"} disabled:opacity-40`}
                  >
                    <Icon className="h-4 w-4" /> {label}
                  </motion.button>
                ))}
              </div>
            </div>

            {needsLocation ? (
              <div className="mb-5">
                <p className="text-sm font-semibold text-slate-900">Choose an office</p>
                <div className="mt-2 space-y-2">
                  {locations.map((location) => (
                    <motion.button
                      key={location.id}
                      type="button"
                      whileTap={{ scale: 0.985 }}
                      onClick={() => setLocationId(location.id)}
                      className={`flex w-full items-start gap-3 rounded-2xl border px-3.5 py-3 text-left transition ${locationId === location.id ? "border-sky-500 bg-sky-50 ring-1 ring-sky-400" : "border-slate-200 bg-white hover:border-slate-300"}`}
                    >
                      <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-sky-600" />
                      <span><span className="block text-sm font-semibold text-slate-900">{location.name}</span><span className="mt-0.5 block text-xs leading-5 text-slate-500">{location.address}</span></span>
                    </motion.button>
                  ))}
                </div>
              </div>
            ) : meetingMode === "InPerson" && locations.length === 1 ? (
              <p className="mb-5 flex items-start gap-2.5 rounded-2xl bg-sky-50/70 px-3.5 py-3 text-sm text-slate-700"><MapPin className="mt-0.5 h-4 w-4 shrink-0 text-sky-600" /><span><span className="font-semibold">{locations[0].name}</span><span className="block text-xs text-slate-500">{locations[0].address}</span></span></p>
            ) : null}

            <p className="mb-3 text-sm font-semibold text-slate-900">Pick a new date and time</p>
            <BookingMonthPicker fetchAvailability={fetchAvailability} onPickSlot={setSlot} timezone={booking.timezone} />
            <button
              type="button"
              disabled={!slot || busy || (meetingMode === "InPerson" && locations.length > 1 && !locationId)}
              onClick={confirmReschedule}
              className="mt-6 flex h-12 w-full items-center justify-center gap-2 rounded-full bg-slate-950 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:opacity-40"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {slot ? `Move to ${new Date(slot.startsAt).toLocaleDateString("en-CA", { month: "short", day: "numeric" })}, ${new Date(slot.startsAt).toLocaleTimeString("en-CA", { hour: "numeric", minute: "2-digit" })}` : "Pick a new time"}
            </button>
          </motion.div>
        ) : mode === "cancel" ? (
          <motion.div key="cancel" initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }} className="py-4 text-center">
            <XCircle className="mx-auto h-12 w-12 text-rose-400" strokeWidth={1.5} />
            <h2 className="mt-3 text-lg font-semibold text-slate-950">Cancel this appointment?</h2>
            <p className="mt-1.5 text-sm text-slate-500">{booking.subject} · {formatWhen(booking.startsAt, booking.timezone)}</p>
            <textarea value={cancelReason} onChange={(event) => setCancelReason(event.target.value)} rows={3} placeholder="Reason for cancelling (optional)" className="mt-4 w-full resize-none rounded-2xl border border-slate-200 bg-white px-3.5 py-3 text-base outline-none transition focus:border-rose-300 sm:text-sm" />
            {booking.isRecurring ? <div className="mt-4 flex rounded-xl bg-slate-100 p-1">{[["single", "Only this appointment"], ["series", "This and future"]].map(([value, label]) => <button key={value} type="button" onClick={() => setSeriesScope(value)} className={`flex-1 rounded-lg px-2 py-2 text-xs font-semibold ${seriesScope === value ? "bg-white text-slate-900 shadow-sm" : "text-slate-500"}`}>{label}</button>)}</div> : null}
            {error ? <p className="mt-3 rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p> : null}
            <div className="mt-6 space-y-2">
              <button type="button" onClick={confirmCancel} disabled={busy} className="flex h-12 w-full items-center justify-center gap-2 rounded-full bg-rose-600 text-sm font-semibold text-white transition hover:bg-rose-500 disabled:opacity-60">
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Yes, cancel it
              </button>
              <button type="button" onClick={() => setMode("view")} disabled={busy} className="h-11 w-full rounded-full text-sm font-semibold text-slate-600 transition hover:bg-slate-100">
                Keep my appointment
              </button>
            </div>
          </motion.div>
        ) : (
          <motion.div key="view" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
            {notice ? (
              <p className="mb-4 flex items-center gap-2 rounded-2xl bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
                <CheckCircle2 className="h-4 w-4 shrink-0" /> {notice}
              </p>
            ) : null}

            <div className="flex items-center gap-3">
              <span className={`flex h-11 w-11 items-center justify-center rounded-2xl ${cancelled ? "bg-slate-100 text-slate-400" : "bg-sky-50 text-sky-600"}`}>
                <CalendarClock className="h-5 w-5" />
              </span>
              <div>
                <h2 className="text-lg font-semibold text-slate-950">{booking.subject}</h2>
                <p className={`text-sm ${cancelled ? "font-medium text-rose-600" : "text-slate-500"}`}>
                  {cancelled ? "Cancelled" : past ? "Completed" : "Confirmed"}
                </p>
              </div>
            </div>
            <div className="mt-3 flex flex-wrap gap-2 text-xs text-slate-500">{booking.referenceCode ? <span className="rounded-full bg-slate-100 px-2.5 py-1 font-mono font-semibold">{booking.referenceCode}</span> : null}{booking.consultant?.name ? <span className="rounded-full bg-sky-50 px-2.5 py-1 font-semibold text-sky-700">With {booking.consultant.name}</span> : null}{booking.confirmationStatus === "Confirmed" ? <span className="rounded-full bg-emerald-50 px-2.5 py-1 font-semibold text-emerald-700">Attendance confirmed</span> : null}</div>

            <div className="mt-5 space-y-3 rounded-2xl bg-slate-50 px-4 py-4 text-sm text-slate-700">
              <p className="flex items-center gap-2.5"><CalendarDays className="h-4 w-4 shrink-0 text-slate-400" />{formatWhen(booking.startsAt, booking.timezone)}</p>
              <p className="flex items-center gap-2.5"><Clock3 className="h-4 w-4 shrink-0 text-slate-400" />{booking.sessionType?.durationMinutes || Math.round((new Date(booking.endsAt) - new Date(booking.startsAt)) / 60000)} minutes · {booking.timezone}</p>
              {booking.meetingMode === "Online" ? (
                <p className="flex items-center gap-2.5"><Video className="h-4 w-4 shrink-0 text-slate-400" />Online video call</p>
              ) : (
                <p className="flex items-start gap-2.5"><MapPin className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" /><span>{booking.location || "In person"}{booking.locationMapsUrl ? <a href={booking.locationMapsUrl} target="_blank" rel="noopener noreferrer" className="mt-1 block text-xs font-semibold text-sky-600 hover:text-sky-700">Open in Maps ↗</a> : null}</span></p>
              )}
            </div>

            {!cancelled && !past && (booking.preparationInstructions || booking.preparationChecklist?.length || booking.parkingInstructions) ? <div className="mt-4 rounded-2xl border border-amber-100 bg-amber-50/60 px-4 py-4 text-sm text-slate-700"><p className="font-semibold text-slate-900">Before your appointment</p>{booking.preparationInstructions ? <p className="mt-1.5 leading-6">{booking.preparationInstructions}</p> : null}{booking.preparationChecklist?.length ? <ul className="mt-2 space-y-1">{booking.preparationChecklist.map((item) => <li key={item} className="flex gap-2"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />{item}</li>)}</ul> : null}{booking.parkingInstructions && booking.meetingMode === "InPerson" ? <p className="mt-2 border-t border-amber-100 pt-2 text-xs text-slate-500">Arrival: {booking.parkingInstructions}</p> : null}{!booking.preparationCompletedAt ? <button type="button" disabled={busy} onClick={completePreparation} className="mt-3 rounded-full bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-sm disabled:opacity-50">I’m prepared</button> : <p className="mt-3 text-xs font-semibold text-emerald-700">Preparation complete ✓</p>}</div> : null}

            {!cancelled && !past && booking.canConfirm ? <button type="button" disabled={busy} onClick={confirmAttendance} className="mt-4 flex h-12 w-full items-center justify-center gap-2 rounded-full bg-emerald-600 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:opacity-50"><CheckCircle2 className="h-4 w-4" /> Confirm I’ll attend</button> : null}

            {!cancelled && !past && booking.meetingUrl ? (
              <a href={booking.meetingUrl} target="_blank" rel="noopener noreferrer" className="mt-4 flex h-12 w-full items-center justify-center gap-2 rounded-full bg-sky-600 text-sm font-semibold text-white transition hover:bg-sky-700">
                <Video className="h-4 w-4" /> Join video call
              </a>
            ) : null}

            {!cancelled && !past && (booking.canReschedule || booking.canCancel) ? (
              <div className={`mt-3 grid gap-2 ${booking.canReschedule && booking.canCancel ? "grid-cols-2" : "grid-cols-1"}`}>
                {booking.canReschedule ? <button type="button" onClick={() => { setMode("reschedule"); setNotice(""); setMeetingMode(booking.meetingMode || "InPerson"); setLocationId(booking.locationId || (booking.locations?.length === 1 ? booking.locations[0].id : "")); }} className="h-12 rounded-full border border-slate-200 bg-white text-sm font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-slate-50">
                  Reschedule
                </button> : null}
                {booking.canCancel ? <button type="button" onClick={() => { setMode("cancel"); setNotice(""); }} className="h-12 rounded-full border border-rose-200 bg-rose-50 text-sm font-semibold text-rose-700 transition hover:bg-rose-100">
                  Cancel
                </button> : null}
              </div>
            ) : null}

            {!cancelled && !past && !booking.canReschedule && !booking.canCancel ? <p className="mt-4 text-center text-xs text-slate-500">This appointment is inside the office change cutoff. Contact {booking.agencyName} if you need help.</p> : null}

            {cancelled ? (
              <p className="mt-4 text-center text-sm text-slate-500">Need a new time? Ask {booking.agencyName} for their booking link.</p>
            ) : null}
          </motion.div>
        )}
      </AnimatePresence>
    </PublicShell>
  );
}
