import { CalendarPlus, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useAuth } from "../../../auth/AuthContext";
import { getBookingSettings } from "../../../api/bookingApi";
import api from "../../../services/api";

function localInput(date) {
  const copy = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return copy.toISOString().slice(0, 16);
}

function initialForm(ownerId, timezone) {
  return { consultantUserId: ownerId || "", startAt: "", endAt: "", timezone: timezone || "America/Toronto", appointmentType: "JITSI", locationId: "", fee: "", paymentStatus: "UNPAID", notes: "" };
}

function dateKey(value = new Date(Date.now() + 24 * 60 * 60_000)) {
  const date = new Date(value.getTime() - value.getTimezoneOffset() * 60_000);
  return date.toISOString().slice(0, 10);
}

const fieldClass = "mt-2 h-11 w-full rounded-xl border border-slate-200 bg-white px-3.5 text-sm text-slate-900 shadow-sm outline-none transition focus:border-brand-300 focus:ring-4 focus:ring-brand-100";

export default function BookConsultationSheet({ lead, staff, onClose, onCreated }) {
  const { agency } = useAuth();
  // Mirrors the backend's own acceptance rule for consultantUserId
  // (lead.service.js's createConsultation) — admin or consultant, not
  // consultant-only. An agency where the person taking consultations is
  // an admin (e.g. a solo/owner-operator setup) would otherwise see an
  // empty dropdown here even though the booking itself would succeed.
  const consultants = staff.filter((person) => person.role === "consultant" || person.role === "admin");
  const preferredConsultant = consultants.some((person) => person.id === lead.ownerUserId) ? lead.ownerUserId : consultants[0]?.id;
  const [form, setForm] = useState(() => initialForm(preferredConsultant, agency?.timezone));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [scheduling, setScheduling] = useState(null);
  const [selectedDate, setSelectedDate] = useState(() => dateKey());
  const [slots, setSlots] = useState([]);
  const [loadingSlots, setLoadingSlots] = useState(false);
  useEffect(() => { getBookingSettings().then(setScheduling).catch(() => {}); }, []);
  const zoomMappedIds = useMemo(() => new Set((scheduling?.staff || []).filter((member) => member.zoomHostMapping?.status === "active").map((member) => member.id)), [scheduling]);
  const appointmentTypes = useMemo(() => [
    ["IN_PERSON", "In person", true],
    ["PHONE", "Phone call", scheduling?.settings?.phoneBookingEnabled === true],
    ["JITSI", "Jitsi video", scheduling?.settings?.onlineBookingEnabled !== false],
    ["ZOOM", "Zoom video", scheduling?.settings?.zoomBookingEnabled === true && zoomMappedIds.size > 0],
  ].filter(([, , enabled]) => enabled), [scheduling, zoomMappedIds]);
  useEffect(() => {
    if (appointmentTypes.some(([value]) => value === form.appointmentType)) return;
    setForm((current) => ({ ...current, appointmentType: appointmentTypes[0]?.[0] || "IN_PERSON" }));
  }, [appointmentTypes, form.appointmentType]);
  useEffect(() => {
    if (!form.consultantUserId || !selectedDate || (form.appointmentType === "IN_PERSON" && !form.locationId)) {
      setSlots([]);
      return;
    }
    const meetingMode = { PHONE: "Phone", JITSI: "Jitsi", VIDEO: "Jitsi", ZOOM: "Zoom", IN_PERSON: "InPerson" }[form.appointmentType];
    let active = true;
    setLoadingSlots(true);
    setError("");
    api.get("/booking/availability", { params: { durationMinutes: 30, from: selectedDate, to: selectedDate, assignedToId: form.consultantUserId, meetingMode, ...(form.locationId ? { locationId: form.locationId } : {}) } })
      .then((response) => { if (active) setSlots(response.data.data?.days?.[selectedDate] || []); })
      .catch((requestError) => { if (active) { setSlots([]); setError(requestError.response?.data?.message || "Available times could not be loaded."); } })
      .finally(() => { if (active) setLoadingSlots(false); });
    return () => { active = false; };
  }, [form.appointmentType, form.consultantUserId, form.locationId, selectedDate]);
  const update = (event) => {
    const { name, value } = event.target;
    setForm((current) => {
      if (name !== "startAt") return { ...current, [name]: value };
      const start = new Date(value);
      return { ...current, startAt: value, endAt: Number.isNaN(start.getTime()) ? current.endAt : localInput(new Date(start.getTime() + 30 * 60_000)) };
    });
  };

  async function submit(event) {
    event.preventDefault();
    try {
      setSaving(true);
      setError("");
      const response = await api.post(`/leads/${lead.id}/consultations`, form, { timeout: 25_000 });
      onCreated(response.data.data);
    } catch (requestError) {
      setError(requestError.response?.data?.message || "The consultation could not be scheduled.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[180] flex items-center justify-center bg-slate-950/25 p-4 backdrop-blur-md" role="dialog" aria-modal="true" aria-labelledby="book-consultation-title">
      <button type="button" className="absolute inset-0" onClick={onClose} aria-label="Close consultation form" />
      <form onSubmit={submit} className="relative flex max-h-[92vh] w-full max-w-2xl flex-col overflow-hidden rounded-3xl border border-white/80 bg-[#f7f9fc] shadow-[0_30px_100px_rgba(15,23,42,0.3)]">
        <header className="flex items-start justify-between border-b border-slate-200/70 bg-white/90 px-6 py-5">
          <div><div className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-brand-600 text-white"><CalendarPlus className="h-5 w-5" /></div><h2 id="book-consultation-title" className="text-xl font-semibold tracking-tight text-slate-950">Book consultation</h2><p className="mt-1 text-sm text-slate-500">Schedule a consultation for {lead.firstName || "this lead"}.</p></div>
          <button type="button" onClick={onClose} className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-100 text-slate-500 hover:bg-slate-200"><X className="h-4 w-4" /></button>
        </header>
        <div className="grid gap-4 overflow-y-auto p-6 sm:grid-cols-2">
          {error ? <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 sm:col-span-2">{error}</div> : null}
          <label className="text-sm font-medium text-slate-700 sm:col-span-2">Consultant<select required name="consultantUserId" value={form.consultantUserId} onChange={update} className={fieldClass}><option value="">Select consultant</option>{consultants.map((person) => <option key={person.id} value={person.id} disabled={form.appointmentType === "ZOOM" && !zoomMappedIds.has(person.id)}>{person.fullName}{form.appointmentType === "ZOOM" && !zoomMappedIds.has(person.id) ? " · Zoom not mapped" : ""}</option>)}</select></label>
          <label className="text-sm font-medium text-slate-700 sm:col-span-2">Date<input required type="date" min={dateKey(new Date())} value={selectedDate} onChange={(event) => { setSelectedDate(event.target.value); setForm((current) => ({ ...current, startAt: "", endAt: "" })); }} className={fieldClass} /></label>
          <label className="text-sm font-medium text-slate-700">Type<select name="appointmentType" value={form.appointmentType} onChange={update} className={fieldClass}>{appointmentTypes.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          <label className="text-sm font-medium text-slate-700">Timezone<input required name="timezone" value={form.timezone} onChange={update} className={fieldClass} /></label>
          {form.appointmentType === "IN_PERSON" ? <label className="text-sm font-medium text-slate-700 sm:col-span-2">Location<select required name="locationId" value={form.locationId} onChange={update} className={fieldClass}><option value="">Choose an office</option>{(scheduling?.settings?.locations || []).map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}</select></label> : null}
          {form.appointmentType === "PHONE" ? <p className="rounded-xl bg-sky-50 px-4 py-3 text-sm leading-6 text-sky-800 sm:col-span-2">{agency?.name || "Your team"} will call {lead.phone || "the lead’s saved phone number"}{scheduling?.settings?.phoneCallerId ? ` from ${scheduling.settings.phoneCallerId}` : ""}. The lead must have a valid phone number.</p> : null}
          <div className="sm:col-span-2"><p className="text-sm font-medium text-slate-700">Available times</p>{loadingSlots ? <p className="mt-3 text-sm text-slate-400">Checking availability…</p> : slots.length ? <div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-5">{slots.map((slot) => <button key={`${slot.startsAt}-${slot.assignedToId || "slot"}`} type="button" onClick={() => setForm((current) => ({ ...current, startAt: slot.startsAt, endAt: slot.endsAt }))} className={`rounded-xl border px-3 py-2.5 text-xs font-semibold transition ${form.startAt === slot.startsAt ? "border-brand-600 bg-brand-600 text-white" : "border-slate-200 bg-white text-slate-700 hover:border-brand-300 hover:bg-brand-50"}`}>{new Intl.DateTimeFormat("en-CA", { hour: "numeric", minute: "2-digit", timeZone: scheduling?.settings?.timezone || agency?.timezone || "America/Toronto" }).format(new Date(slot.startsAt))}</button>)}</div> : <p className="mt-3 rounded-xl bg-slate-50 px-4 py-3 text-sm text-slate-500">No available times for this date.</p>}</div>
          <label className="text-sm font-medium text-slate-700">Fee (CAD)<input type="number" min="0" step="0.01" name="fee" value={form.fee} onChange={update} className={fieldClass} placeholder="0.00" /></label>
          <label className="text-sm font-medium text-slate-700">Payment<select name="paymentStatus" value={form.paymentStatus} onChange={update} className={fieldClass}><option value="UNPAID">Unpaid</option><option value="WAIVED">Waived</option></select><span className="mt-2 block text-xs leading-5 text-slate-500">A paid or refunded status appears only after a financial transaction is recorded.</span></label>
          <label className="text-sm font-medium text-slate-700 sm:col-span-2">Notes<textarea name="notes" value={form.notes} onChange={update} rows={3} className={`${fieldClass} h-auto py-3`} /></label>
        </div>
        <footer className="flex justify-end gap-3 border-t border-slate-200 bg-white px-6 py-4"><button type="button" onClick={onClose} className="h-10 rounded-full px-5 text-sm font-semibold text-slate-600 hover:bg-slate-100">Cancel</button><button disabled={saving || !form.startAt || !form.endAt || !consultants.length || (form.appointmentType === "PHONE" && !lead.phone) || (form.appointmentType === "ZOOM" && !zoomMappedIds.has(form.consultantUserId))} className="h-10 rounded-full bg-brand-600 px-5 text-sm font-semibold text-white shadow-sm hover:bg-brand-700 disabled:opacity-50">{saving ? "Scheduling…" : "Schedule consultation"}</button></footer>
      </form>
    </div>
  );
}
