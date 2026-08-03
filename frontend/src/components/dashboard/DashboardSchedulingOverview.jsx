import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Search, UserCheck } from "lucide-react";
import { useEffect, useState } from "react";
import { getAppointmentRegistry, getBookingWaitlist, getSchedulingAnalytics, updateBookingWaitlistEntry } from "../../api/bookingApi";
import AppointmentProfileOverlay from "../appointments/AppointmentProfileOverlay";

const card = "rounded-[1.4rem] border border-white/70 bg-white/80 p-5 shadow-[0_14px_40px_rgba(15,23,42,0.07)] backdrop-blur-xl";
const inputClass = "rounded-xl border border-slate-200/80 bg-white px-3 py-2 text-sm outline-none focus:border-sky-400";

export default function DashboardSchedulingOverview({ role, initial = null, focusSignal = 0 }) {
  const queryClient = useQueryClient();
  const [filters, setFilters] = useState({
    attendance: "all",
    range: "today",
    search: "",
    page: 1,
  });
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [selectedId, setSelectedId] = useState(null);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(filters.search), 250);
    return () => window.clearTimeout(timer);
  }, [filters.search]);

  useEffect(() => {
    if (!focusSignal) return;
    setFilters({ attendance: "all", range: "today", search: "", page: 1 });
    document.getElementById("appointment-register-heading")?.scrollIntoView({ behavior: "smooth", block: "start" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusSignal]);

  const filtersAreDefault = filters.attendance === "all" && filters.range === "today" && !debouncedSearch && filters.page === 1;
  const registryQuery = useQuery({
    queryKey: ["dashboard", "appointment-registry", { ...filters, search: debouncedSearch }],
    queryFn: () => getAppointmentRegistry({ ...filters, search: debouncedSearch, limit: 6 }),
    staleTime: 30_000,
    placeholderData: (previous) => previous,
    initialData: filtersAreDefault && initial?.registry ? initial.registry : undefined,
  });
  const analyticsQuery = useQuery({
    queryKey: ["dashboard", "scheduling-analytics", filters.range],
    queryFn: () => getSchedulingAnalytics({ range: filters.range }),
    enabled: role === "admin",
    staleTime: 60_000,
    placeholderData: (previous) => previous,
    initialData: filters.range === "today" && initial?.analytics ? initial.analytics : undefined,
  });
  const waitlistQuery = useQuery({
    queryKey: ["dashboard", "booking-waitlist"],
    queryFn: () => getBookingWaitlist(),
    enabled: role === "admin",
    staleTime: 30_000,
    initialData: initial?.waitlist || undefined,
  });
  const closeWaitlist = useMutation({
    mutationFn: (id) => updateBookingWaitlistEntry(id, "Closed"),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: ["dashboard", "booking-waitlist"],
      }),
  });
  const registry = registryQuery.data || {
    data: [],
    meta: { total: 0, page: 1, pages: 1 },
  };
  const analytics = analyticsQuery.data;
  const waitlist = waitlistQuery.data || [];

  return (
    <section className="space-y-4 pt-2" aria-labelledby="appointment-register-heading">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">Scheduling overview</p>
        <h2 id="appointment-register-heading" className="mt-1 text-lg font-semibold text-slate-950">
          People via appointments
        </h2>
        <p className="mt-0.5 text-sm text-slate-500">Attendance and appointment activity across public, internal, recurring, and walk-in bookings.</p>
      </div>

      {analytics ? (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {[
            ["Booked", analytics.booked],
            ["Attended", analytics.attended],
            ["Cancelled", analytics.cancelled],
            ["No-show", analytics.noShow],
          ].map(([label, value]) => (
            <div key={label} className="rounded-2xl border border-white/70 bg-white/80 px-4 py-3 shadow-sm backdrop-blur-xl">
              <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-400">{label}</p>
              <p className="mt-1 text-xl font-semibold text-slate-950">{value}</p>
            </div>
          ))}
        </div>
      ) : null}

      <div className={card}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-center gap-2">
            <UserCheck className="h-4 w-4 text-sky-600" />
            <h3 className="text-sm font-semibold text-slate-900">Appointment register</h3>
          </div>
          <span className="rounded-full bg-slate-950 px-3 py-1 text-xs font-semibold text-white">{registry.meta.total || 0} people</span>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          {[
            ["all", "All"],
            ["upcoming", "Upcoming"],
            ["attended", "Attended"],
            ["not_attended", "Not attended"],
            ["no_show", "No-show"],
            ["cancelled", "Cancelled"],
          ].map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() =>
                setFilters((current) => ({
                  ...current,
                  attendance: value,
                  page: 1,
                }))
              }
              className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${filters.attendance === value ? "bg-sky-600 text-white shadow-sm" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_auto]">
          <label className="relative">
            <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
            <input
              value={filters.search}
              onChange={(event) =>
                setFilters((current) => ({
                  ...current,
                  search: event.target.value,
                  page: 1,
                }))
              }
              placeholder="Search name, email, subject, or reference"
              className={`${inputClass} w-full pl-9`}
            />
          </label>
          <div className="flex rounded-xl bg-slate-100 p-1">
            {[
              ["today", "Today"],
              ["7", "7 days"],
              ["30", "30 days"],
              ["all", "All time"],
            ].map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() =>
                  setFilters((current) => ({
                    ...current,
                    range: value,
                    page: 1,
                  }))
                }
                className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${filters.range === value ? "bg-white text-slate-900 shadow-sm" : "text-slate-500"}`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        {registryQuery.isError ? (
          <p className="mt-4 rounded-2xl bg-rose-50 px-4 py-3 text-sm text-rose-700">Appointment records could not be loaded.</p>
        ) : (
          <div className="mt-4 overflow-hidden rounded-2xl border border-slate-100">
            {registryQuery.isPending ? (
              <div className="flex items-center justify-center gap-2 py-10 text-sm text-slate-400">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading appointments…
              </div>
            ) : registry.data.length ? (
              <div className="divide-y divide-slate-100">
                {registry.data.map((appointment) => {
                  const person = appointment.client || {
                    fullName: appointment.guestName,
                    email: appointment.guestEmail,
                    phone: appointment.guestPhone,
                  };
                  const statusStyle = appointment.status === "Completed" ? "bg-emerald-50 text-emerald-700" : appointment.status === "NoShow" ? "bg-amber-50 text-amber-700" : appointment.status === "Cancelled" ? "bg-rose-50 text-rose-700" : new Date(appointment.endsAt) < new Date() ? "bg-orange-50 text-orange-700" : "bg-sky-50 text-sky-700";
                  const statusLabel = appointment.status === "Completed" ? "Attended" : appointment.status === "NoShow" ? "No-show" : appointment.status === "Cancelled" ? "Cancelled" : new Date(appointment.endsAt) < new Date() ? "Not attended" : "Upcoming";
                  return (
                    <button type="button" onClick={() => setSelectedId(appointment.id)} key={appointment.id} className="grid w-full gap-2 px-3.5 py-3 text-left transition hover:bg-slate-50/80 focus:bg-sky-50/50 focus:outline-none sm:grid-cols-[1.2fr_1fr_auto] sm:items-center">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-slate-900">{person?.fullName || "Unnamed visitor"}</p>
                        <p className="truncate text-xs text-slate-400">{person?.email || person?.phone || appointment.referenceCode || "No contact details"}</p>
                      </div>
                      <div className="min-w-0">
                        <p className="truncate text-xs font-medium text-slate-700">{appointment.sessionType?.name || appointment.subject}</p>
                        <p className="truncate text-xs text-slate-400">
                          {new Intl.DateTimeFormat("en-CA", {
                            dateStyle: "medium",
                            timeStyle: "short",
                          }).format(new Date(appointment.startsAt))}
                          {appointment.assignedTo?.fullName ? ` · ${appointment.assignedTo.fullName}` : ""}
                        </p>
                      </div>
                      <span className={`w-fit rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide ${statusStyle}`}>{statusLabel}</span>
                    </button>
                  );
                })}
              </div>
            ) : (
              <p className="py-10 text-center text-sm text-slate-400">No appointments match these filters.</p>
            )}
          </div>
        )}
        {registry.meta.pages > 1 ? (
          <div className="mt-3 flex items-center justify-between gap-3">
            <span className="text-xs text-slate-400">
              Page {registry.meta.page} of {registry.meta.pages}
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={filters.page <= 1}
                onClick={() =>
                  setFilters((current) => ({
                    ...current,
                    page: current.page - 1,
                  }))
                }
                className="rounded-full border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 transition hover:bg-slate-50 disabled:opacity-40"
              >
                Previous
              </button>
              <button
                type="button"
                disabled={filters.page >= registry.meta.pages}
                onClick={() =>
                  setFilters((current) => ({
                    ...current,
                    page: current.page + 1,
                  }))
                }
                className="rounded-full border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 transition hover:bg-slate-50 disabled:opacity-40"
              >
                Next
              </button>
            </div>
          </div>
        ) : null}
      </div>

      {role === "admin" && waitlist.length ? (
        <div className={card}>
          <div className="flex items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-slate-900">Active waitlist</h3>
              <p className="mt-0.5 text-xs text-slate-500">Oldest matching request is offered first when an appointment is cancelled.</p>
            </div>
            <span className="rounded-full bg-violet-50 px-2.5 py-1 text-xs font-semibold text-violet-700">{waitlist.length} waiting</span>
          </div>
          <div className="mt-3 divide-y divide-slate-100">
            {waitlist.map((entry) => (
              <div key={entry.id} className="flex items-center justify-between gap-3 py-2.5">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-slate-800">
                    {entry.name} · {entry.sessionType?.name}
                  </p>
                  <p className="truncate text-xs text-slate-400">
                    {entry.email} · {new Date(entry.preferredFrom).toLocaleDateString("en-CA")}–{new Date(entry.preferredTo).toLocaleDateString("en-CA")}
                  </p>
                </div>
                <button type="button" disabled={closeWaitlist.isPending} onClick={() => closeWaitlist.mutate(entry.id)} className="rounded-full border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-500 hover:bg-slate-50 disabled:opacity-50">
                  Close
                </button>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <AppointmentProfileOverlay
        appointmentId={selectedId}
        onClose={() => setSelectedId(null)}
        onChanged={() => {
          queryClient.invalidateQueries({ queryKey: ["dashboard", "appointment-registry"] });
          queryClient.invalidateQueries({ queryKey: ["dashboard", "scheduling-analytics"] });
        }}
      />
    </section>
  );
}
