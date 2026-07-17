import {
  CalendarDays,
  CalendarPlus,
  ChevronRight,
  Clock3,
  MapPin,
  Plus,
  Save,
  Trash2,
  UserRound,
  X,
} from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import api from "../../services/api";

const calendars = ["Case Calendar", "Workspace Calendar", "Personal Calendar"];
const inputClass =
  "mt-2 w-full rounded-2xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm font-normal text-slate-900 outline-none transition focus:border-sky-400 focus:ring-4 focus:ring-sky-100/60";

function pad(value) {
  return String(value).padStart(2, "0");
}

function localDate(value) {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) return "";
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function timeParts(value, fallbackHour) {
  const date = value ? new Date(value) : null;
  const hour24 =
    date && !Number.isNaN(date.getTime()) ? date.getHours() : fallbackHour;
  const minute = date && !Number.isNaN(date.getTime()) ? date.getMinutes() : 0;
  return {
    hour: String(hour24 % 12 || 12),
    minute: pad(minute),
    period: hour24 >= 12 ? "PM" : "AM",
  };
}

function initialValues(appointment, defaultAssigneeId) {
  const defaultStart = new Date();
  defaultStart.setMinutes(0, 0, 0);
  defaultStart.setHours(defaultStart.getHours() + 1);
  const defaultEnd = new Date(defaultStart.getTime() + 60 * 60 * 1000);
  const startValue = appointment?.startsAt || defaultStart;
  const endValue = appointment?.endsAt || defaultEnd;
  const start = timeParts(startValue, 9);
  const end = timeParts(endValue, 10);
  return {
    subject: appointment?.subject || "",
    location: appointment?.location || "",
    date: localDate(startValue),
    calendar: appointment?.calendar || "Case Calendar",
    startHour: start.hour,
    startMinute: start.minute,
    startPeriod: start.period,
    endHour: end.hour,
    endMinute: end.minute,
    endPeriod: end.period,
    description: appointment?.description || "",
    assignedToId: appointment?.assignedToId || defaultAssigneeId || "",
  };
}

function toIso(dateValue, hourValue, minuteValue, period) {
  const [year, month, day] = dateValue.split("-").map(Number);
  let hour = Number(hourValue) % 12;
  if (period === "PM") hour += 12;
  return new Date(
    year,
    month - 1,
    day,
    hour,
    Number(minuteValue),
    0,
    0,
  ).toISOString();
}

function formatAppointmentDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Date unavailable";
  return date.toLocaleDateString("en-CA", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatTimeRange(start, end) {
  const options = { hour: "numeric", minute: "2-digit" };
  return `${new Date(start).toLocaleTimeString("en-CA", options)} – ${new Date(end).toLocaleTimeString("en-CA", options)}`;
}

function TimePicker({ label, hour, minute, period, onChange }) {
  return (
    <fieldset>
      <legend className="text-sm font-semibold text-slate-800">{label}</legend>
      <div className="mt-2 grid grid-cols-[1fr_auto_1fr_1.15fr] items-center gap-2">
        <select
          value={hour}
          onChange={(event) => onChange("hour", event.target.value)}
          className="h-11 rounded-2xl border border-slate-200 bg-white px-3 text-sm outline-none focus:border-sky-400"
          aria-label={`${label} hour`}
        >
          {Array.from({ length: 12 }, (_, index) => String(index + 1)).map(
            (value) => (
              <option key={value}>{value}</option>
            ),
          )}
        </select>
        <span className="text-base font-semibold text-slate-400">:</span>
        <select
          value={minute}
          onChange={(event) => onChange("minute", event.target.value)}
          className="h-11 rounded-2xl border border-slate-200 bg-white px-3 text-sm outline-none focus:border-sky-400"
          aria-label={`${label} minute`}
        >
          {Array.from({ length: 12 }, (_, index) => pad(index * 5)).map(
            (value) => (
              <option key={value}>{value}</option>
            ),
          )}
        </select>
        <div className="grid grid-cols-2 rounded-2xl bg-slate-100 p-1">
          {["AM", "PM"].map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => onChange("period", value)}
              className={`rounded-xl px-2 py-2 text-xs font-semibold transition ${period === value ? "bg-white text-slate-950 shadow-sm" : "text-slate-500"}`}
            >
              {value}
            </button>
          ))}
        </div>
      </div>
    </fieldset>
  );
}

function AppointmentEditorOverlay({
  appointment,
  caseItem,
  users,
  saving,
  error,
  onClose,
  onSave,
  onRequestDelete,
}) {
  const [values, setValues] = useState(() =>
    initialValues(
      appointment,
      caseItem.assignedUserId || caseItem.assignedUser?.id,
    ),
  );
  const update = (key, value) =>
    setValues((current) => ({ ...current, [key]: value }));
  const updateTime = (prefix, key, value) =>
    update(`${prefix}${key[0].toUpperCase()}${key.slice(1)}`, value);
  const submit = async (event) => {
    event.preventDefault();
    await onSave({
      subject: values.subject.trim(),
      location: values.location.trim() || null,
      calendar: values.calendar,
      startsAt: toIso(
        values.date,
        values.startHour,
        values.startMinute,
        values.startPeriod,
      ),
      endsAt: toIso(
        values.date,
        values.endHour,
        values.endMinute,
        values.endPeriod,
      ),
      description: values.description.trim() || null,
      assignedToId: values.assignedToId || null,
    });
  };
  const clientName = caseItem.client?.fullName || "Client";
  return createPortal(
    <div className="fixed inset-0 z-[410] flex items-center justify-center bg-slate-950/25 p-3 backdrop-blur-md">
      <button
        type="button"
        className="absolute inset-0"
        onClick={onClose}
        aria-label="Close appointment form"
      />
      <motion.form
        initial={{ opacity: 0, y: 18, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 12, scale: 0.985 }}
        onSubmit={submit}
        className="relative flex max-h-[92dvh] w-full max-w-3xl flex-col overflow-hidden rounded-[2rem] border border-white/80 bg-white shadow-[0_34px_100px_rgba(15,23,42,0.28)]"
      >
        <header className="flex items-start justify-between gap-4 border-b border-slate-100 px-6 py-5">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-sky-600">
              Case appointment
            </p>
            <h2 className="mt-1 text-xl font-semibold tracking-tight text-slate-950">
              {appointment ? "Edit appointment" : "Add new appointment"} —{" "}
              {clientName}
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              Add the meeting to the case calendar and assign the responsible
              team member.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-500"
          >
            <X className="h-4 w-4" />
          </button>
        </header>
        <main className="scrollbar-hidden min-h-0 flex-1 space-y-4 overflow-y-auto bg-slate-50/55 p-5">
          {error ? (
            <p className="rounded-2xl bg-rose-50 px-4 py-3 text-sm text-rose-700">
              {error}
            </p>
          ) : null}
          <section className="rounded-[1.5rem] border border-slate-100 bg-white p-4 shadow-sm">
            <label className="block text-sm font-semibold text-slate-800">
              Subject
              <input
                autoFocus
                required
                maxLength={180}
                value={values.subject}
                onChange={(event) => update("subject", event.target.value)}
                placeholder="Client consultation"
                className={inputClass}
              />
            </label>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <label className="block text-sm font-semibold text-slate-800">
                Location
                <input
                  maxLength={300}
                  value={values.location}
                  onChange={(event) => update("location", event.target.value)}
                  placeholder="Office, phone, or video link"
                  className={inputClass}
                />
              </label>
              <label className="block text-sm font-semibold text-slate-800">
                Date
                <input
                  required
                  type="date"
                  value={values.date}
                  onChange={(event) => update("date", event.target.value)}
                  className={inputClass}
                />
              </label>
              <label className="block text-sm font-semibold text-slate-800 sm:col-span-2">
                Calendars
                <select
                  value={values.calendar}
                  onChange={(event) => update("calendar", event.target.value)}
                  className={inputClass}
                >
                  {calendars.map((calendar) => (
                    <option key={calendar}>{calendar}</option>
                  ))}
                </select>
              </label>
            </div>
          </section>
          <section className="rounded-[1.5rem] border border-slate-100 bg-white p-4 shadow-sm">
            <div className="grid gap-5 sm:grid-cols-2">
              <TimePicker
                label="Start Time"
                hour={values.startHour}
                minute={values.startMinute}
                period={values.startPeriod}
                onChange={(key, value) => updateTime("start", key, value)}
              />
              <TimePicker
                label="End Time"
                hour={values.endHour}
                minute={values.endMinute}
                period={values.endPeriod}
                onChange={(key, value) => updateTime("end", key, value)}
              />
            </div>
          </section>
          <section className="rounded-[1.5rem] border border-slate-100 bg-white p-4 shadow-sm">
            <label className="block text-sm font-semibold text-slate-800">
              Description
              <textarea
                rows={4}
                maxLength={5000}
                value={values.description}
                onChange={(event) => update("description", event.target.value)}
                placeholder="Purpose, preparation notes, or joining instructions…"
                className={`${inputClass} resize-none`}
              />
            </label>
            <label className="mt-4 block text-sm font-semibold text-slate-800">
              Assign Team Member
              <select
                value={values.assignedToId}
                onChange={(event) => update("assignedToId", event.target.value)}
                className={inputClass}
              >
                <option value="">Unassigned</option>
                {users.map((user) => (
                  <option key={user.id} value={user.id}>
                    {user.fullName}
                  </option>
                ))}
              </select>
            </label>
          </section>
        </main>
        <footer className="flex items-center justify-between gap-3 border-t border-slate-100 px-5 py-4">
          <div>
            {appointment ? (
              <button
                type="button"
                onClick={onRequestDelete}
                disabled={saving}
                className="inline-flex items-center gap-2 rounded-full px-3 py-2 text-sm font-semibold text-rose-600 hover:bg-rose-50"
              >
                <Trash2 className="h-4 w-4" />
                Delete
              </button>
            ) : null}
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="rounded-full border border-slate-200 px-4 py-2.5 text-sm font-semibold"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving || !values.subject.trim() || !values.date}
              className="inline-flex items-center gap-2 rounded-full bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
            >
              <Save className="h-4 w-4" />
              {saving
                ? "Saving…"
                : appointment
                  ? "Save changes"
                  : "Add appointment"}
            </button>
          </div>
        </footer>
      </motion.form>
    </div>,
    document.body,
  );
}

function DeleteAppointmentOverlay({
  appointment,
  saving,
  error,
  onClose,
  onConfirm,
}) {
  return createPortal(
    <div className="fixed inset-0 z-[440] flex items-center justify-center bg-slate-950/25 p-4 backdrop-blur-md">
      <button
        type="button"
        className="absolute inset-0"
        onClick={onClose}
        aria-label="Cancel appointment deletion"
      />
      <motion.section
        initial={{ opacity: 0, y: 12, scale: 0.96 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        className="relative w-full max-w-md overflow-hidden rounded-[1.8rem] border border-white/80 bg-white shadow-[0_30px_90px_rgba(15,23,42,0.26)]"
      >
        <div className="px-6 pb-5 pt-6">
          <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-rose-50 text-rose-600">
            <Trash2 className="h-5 w-5" />
          </span>
          <h3 className="mt-4 text-xl font-semibold text-slate-950">
            Delete appointment?
          </h3>
          <p className="mt-2 text-sm leading-6 text-slate-500">
            <strong className="text-slate-700">{appointment.subject}</strong>{" "}
            will be permanently removed from this case.
          </p>
          {error ? (
            <p className="mt-3 rounded-xl bg-rose-50 px-3 py-2 text-xs text-rose-700">
              {error}
            </p>
          ) : null}
        </div>
        <div className="grid grid-cols-2 gap-3 border-t border-slate-100 bg-slate-50/70 p-4">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold"
          >
            Keep it
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={saving}
            className="rounded-2xl bg-rose-600 px-4 py-3 text-sm font-semibold text-white disabled:opacity-50"
          >
            {saving ? "Deleting…" : "Delete"}
          </button>
        </div>
      </motion.section>
    </div>,
    document.body,
  );
}

export default function AppointmentsWorkspace({ caseItem }) {
  const [appointments, setAppointments] = useState([]);
  const [users, setUsers] = useState([]);
  const [view, setView] = useState("upcoming");
  const [editor, setEditor] = useState(undefined);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    Promise.all([
      api.get(`/appointments/case/${caseItem.id}`),
      api.get("/users?limit=100"),
    ])
      .then(([appointmentResponse, userResponse]) => {
        if (!active) return;
        setAppointments(appointmentResponse.data.data || []);
        setUsers(userResponse.data.data || []);
      })
      .catch((requestError) => {
        if (!active) return;
        setError(
          requestError.response?.data?.message ||
            "Unable to load appointments.",
        );
        setUsers(caseItem.assignedUser ? [caseItem.assignedUser] : []);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [caseItem.id, caseItem.assignedUser]);

  const visible = useMemo(() => {
    const now = Date.now();
    return appointments
      .filter((item) => item.status === "Scheduled")
      .filter((item) =>
        view === "overdue"
          ? new Date(item.endsAt).getTime() < now
          : new Date(item.endsAt).getTime() >= now,
      )
      .sort(
        (left, right) => new Date(left.startsAt) - new Date(right.startsAt),
      );
  }, [appointments, view]);
  const counts = useMemo(() => {
    const now = Date.now();
    return {
      upcoming: appointments.filter(
        (item) =>
          item.status === "Scheduled" && new Date(item.endsAt).getTime() >= now,
      ).length,
      overdue: appointments.filter(
        (item) =>
          item.status === "Scheduled" && new Date(item.endsAt).getTime() < now,
      ).length,
    };
  }, [appointments]);

  const save = async (values) => {
    try {
      setSaving(true);
      setError("");
      if (editor) {
        const response = await api.patch(`/appointments/${editor.id}`, values);
        setAppointments((current) =>
          current.map((item) =>
            item.id === editor.id ? response.data.data : item,
          ),
        );
      } else {
        const response = await api.post("/appointments", {
          caseId: caseItem.id,
          ...values,
        });
        setAppointments((current) => [...current, response.data.data]);
      }
      setEditor(undefined);
    } catch (requestError) {
      setError(
        requestError.response?.data?.message ||
          "Unable to save the appointment.",
      );
    } finally {
      setSaving(false);
    }
  };
  const remove = async () => {
    try {
      setSaving(true);
      setError("");
      await api.delete(`/appointments/${deleteTarget.id}`);
      setAppointments((current) =>
        current.filter((item) => item.id !== deleteTarget.id),
      );
      setDeleteTarget(null);
      setEditor(undefined);
    } catch (requestError) {
      setError(
        requestError.response?.data?.message ||
          "Unable to delete the appointment.",
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="overflow-hidden rounded-[1.6rem] border border-slate-200 bg-white shadow-[0_18px_55px_rgba(15,23,42,0.07)]">
      <header className="flex flex-col gap-4 border-b border-slate-100 bg-[linear-gradient(135deg,#ffffff,#f8fafc)] px-5 py-5 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-sky-600">
            Case calendar
          </p>
          <h2 className="mt-1 text-lg font-semibold tracking-tight text-slate-950">
            Appointments
          </h2>
          <p className="mt-1 text-sm text-slate-500">
            Schedule consultations, calls, biometrics, hearings, and office
            meetings.
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            setError("");
            setEditor(null);
          }}
          className="inline-flex w-fit items-center gap-2 rounded-full bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white shadow-[0_12px_28px_rgba(15,23,42,0.18)]"
        >
          <Plus className="h-4 w-4" />
          Add appointment
        </button>
      </header>
      <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-4 py-3">
        <div className="relative grid grid-cols-2 rounded-full bg-slate-100 p-1">
          {[
            ["upcoming", `Upcoming ${counts.upcoming}`],
            ["overdue", `Overdue ${counts.overdue}`],
          ].map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setView(id)}
              className={`relative z-10 rounded-full px-4 py-1.5 text-xs font-semibold transition ${view === id ? "text-slate-950" : "text-slate-500"}`}
            >
              {view === id ? (
                <motion.span
                  layoutId="appointment-view-pill"
                  className="absolute inset-0 -z-10 rounded-full bg-white shadow-sm"
                  transition={{ type: "spring", stiffness: 500, damping: 38 }}
                />
              ) : null}
              {label}
            </button>
          ))}
        </div>
        {error && editor === undefined && !deleteTarget ? (
          <p className="text-xs font-medium text-rose-600">{error}</p>
        ) : null}
      </div>
      {loading ? (
        <div className="space-y-2 p-4">
          {Array.from({ length: 3 }, (_, index) => (
            <div
              key={index}
              className="h-20 animate-pulse rounded-2xl bg-slate-100"
            />
          ))}
        </div>
      ) : (
        <div className="divide-y divide-slate-100">
          {visible.map((appointment) => (
            <article
              key={appointment.id}
              className="group flex items-center gap-3 px-4 py-3.5 transition hover:bg-slate-50/70"
            >
              <span
                className={`flex h-11 w-11 shrink-0 flex-col items-center justify-center rounded-2xl ${view === "overdue" ? "bg-rose-50 text-rose-600" : "bg-sky-50 text-sky-600"}`}
              >
                <span className="text-[9px] font-bold uppercase">
                  {new Date(appointment.startsAt).toLocaleDateString("en-CA", {
                    month: "short",
                  })}
                </span>
                <span className="text-base font-semibold leading-4">
                  {new Date(appointment.startsAt).getDate()}
                </span>
              </span>
              <button
                type="button"
                onClick={() => {
                  setError("");
                  setEditor(appointment);
                }}
                className="flex min-w-0 flex-1 items-center gap-3 text-left"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-slate-900">
                    {appointment.subject}
                  </span>
                  <span className="mt-1 block truncate text-xs text-slate-500">
                    {appointment.description || appointment.calendar}
                  </span>
                  <span className="mt-2 flex flex-wrap items-center gap-2 text-[10px] font-medium text-slate-400">
                    <span
                      className={
                        view === "overdue" ? "font-semibold text-rose-600" : ""
                      }
                    >
                      <Clock3 className="mr-1 inline h-3 w-3" />
                      {formatAppointmentDate(appointment.startsAt)} ·{" "}
                      {formatTimeRange(
                        appointment.startsAt,
                        appointment.endsAt,
                      )}
                    </span>
                    {appointment.location ? (
                      <span>
                        <MapPin className="mr-1 inline h-3 w-3" />
                        {appointment.location}
                      </span>
                    ) : null}
                    <span>
                      <UserRound className="mr-1 inline h-3 w-3" />
                      {appointment.assignedTo?.fullName || "Unassigned"}
                    </span>
                  </span>
                </span>
                <ChevronRight className="h-4 w-4 shrink-0 text-slate-300 transition group-hover:translate-x-0.5" />
              </button>
              <button
                type="button"
                onClick={() => {
                  setError("");
                  setDeleteTarget(appointment);
                }}
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-slate-400 transition hover:bg-rose-50 hover:text-rose-600"
                aria-label={`Delete ${appointment.subject}`}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </article>
          ))}
          {!visible.length ? (
            <div className="px-6 py-14 text-center">
              <span
                className={`mx-auto flex h-12 w-12 items-center justify-center rounded-2xl ${view === "overdue" ? "bg-rose-50 text-rose-500" : "bg-sky-50 text-sky-500"}`}
              >
                {view === "overdue" ? (
                  <CalendarDays className="h-6 w-6" />
                ) : (
                  <CalendarPlus className="h-6 w-6" />
                )}
              </span>
              <h3 className="mt-3 text-sm font-semibold text-slate-900">
                No {view} appointments
              </h3>
              <p className="mt-1 text-sm text-slate-500">
                {view === "upcoming"
                  ? "Add the first appointment for this case."
                  : "Missed appointments will appear here."}
              </p>
              {view === "upcoming" ? (
                <button
                  type="button"
                  onClick={() => setEditor(null)}
                  className="mt-4 inline-flex h-11 w-11 items-center justify-center rounded-full bg-slate-950 text-white"
                  aria-label="Add appointment"
                >
                  <Plus className="h-5 w-5" />
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
      )}
      <AnimatePresence>
        {editor !== undefined ? (
          <AppointmentEditorOverlay
            appointment={editor}
            caseItem={caseItem}
            users={users}
            saving={saving}
            error={error}
            onClose={() => {
              if (!saving) {
                setEditor(undefined);
                setError("");
              }
            }}
            onSave={save}
            onRequestDelete={() => setDeleteTarget(editor)}
          />
        ) : null}
      </AnimatePresence>
      {deleteTarget ? (
        <DeleteAppointmentOverlay
          appointment={deleteTarget}
          saving={saving}
          error={error}
          onClose={() => {
            if (!saving) {
              setDeleteTarget(null);
              setError("");
            }
          }}
          onConfirm={remove}
        />
      ) : null}
    </section>
  );
}
