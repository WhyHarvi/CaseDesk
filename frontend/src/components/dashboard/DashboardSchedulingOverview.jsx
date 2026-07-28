import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Clock3, Loader2, Mail, Phone, Search, UserCheck, X } from "lucide-react";
import { useEffect, useState } from "react";
import { convertAppointmentToClient, getAppointmentRegistry, getAppointmentRegistryDetail, getBookingWaitlist, getSchedulingAnalytics, updateBookingWaitlistEntry } from "../../api/bookingApi";

const card = "rounded-[1.4rem] border border-white/70 bg-white/80 p-5 shadow-[0_14px_40px_rgba(15,23,42,0.07)] backdrop-blur-xl";
const inputClass = "rounded-xl border border-slate-200/80 bg-white px-3 py-2 text-sm outline-none focus:border-sky-400";

export default function DashboardSchedulingOverview({ role, initial = null }) {
  const queryClient = useQueryClient();
  const [filters, setFilters] = useState({
    attendance: "all",
    range: "all",
    search: "",
    page: 1,
  });
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [selectedId, setSelectedId] = useState(null);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(filters.search), 250);
    return () => window.clearTimeout(timer);
  }, [filters.search]);

  const filtersAreDefault = filters.attendance === "all" && filters.range === "all" && !debouncedSearch && filters.page === 1;
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
    initialData: filters.range === "all" && initial?.analytics ? initial.analytics : undefined,
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
  const detailQuery = useQuery({
    queryKey: ["dashboard", "appointment-detail", selectedId],
    queryFn: () => getAppointmentRegistryDetail(selectedId),
    enabled: Boolean(selectedId),
    staleTime: 15_000,
  });
  const convertClient = useMutation({
    mutationFn: convertAppointmentToClient,
    onSuccess: (result, appointmentId) => {
      queryClient.setQueriesData({ queryKey: ["dashboard", "appointment-registry"] }, (current) =>
        current
          ? {
              ...current,
              data: current.data.map((appointment) =>
                appointment.id === appointmentId
                  ? {
                      ...appointment,
                      client: {
                        id: result.clientId,
                        fullName: appointment.guestName,
                        email: appointment.guestEmail,
                        phone: appointment.guestPhone,
                      },
                    }
                  : appointment,
              ),
            }
          : current,
      );
      queryClient.setQueryData(["dashboard", "appointment-detail", appointmentId], (current) =>
        current
          ? {
              ...current,
              client: {
                id: result.clientId,
                fullName: current.guestName,
                email: current.guestEmail,
                phone: current.guestPhone,
              },
            }
          : current,
      );
      queryClient.invalidateQueries({
        queryKey: ["dashboard", "appointment-registry"],
      });
    },
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

      {selectedId && detailQuery.data?.status === "Completed" && !detailQuery.data?.client ? (
        <div className="fixed bottom-4 right-4 z-[510] w-[calc(100%-2rem)] max-w-[calc(28rem-2rem)] rounded-2xl border border-emerald-100 bg-white/95 p-3 shadow-[0_20px_60px_rgba(15,23,42,0.2)] backdrop-blur-xl">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600">
              <UserCheck className="h-4 w-4" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-slate-900">Attended appointment</p>
              <p className="truncate text-xs text-slate-500">Save {detailQuery.data.guestName || "this visitor"} to your client list.</p>
            </div>
            <button type="button" disabled={convertClient.isPending} onClick={() => convertClient.mutate(selectedId)} className="shrink-0 rounded-full bg-emerald-600 px-3.5 py-2 text-xs font-semibold text-white transition hover:bg-emerald-700 disabled:opacity-50">
              {convertClient.isPending ? "Saving…" : "Save as client"}
            </button>
          </div>
          {convertClient.isError ? <p className="mt-2 text-xs font-medium text-rose-600">{convertClient.error?.response?.data?.message || "This visitor could not be saved as a client."}</p> : null}
        </div>
      ) : null}

      {selectedId ? (
        <div
          className="fixed inset-0 z-[500] flex justify-end bg-slate-950/25 backdrop-blur-[2px]"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setSelectedId(null);
          }}
        >
          <aside className="h-full w-full max-w-md overflow-y-auto border-l border-white/70 bg-white/95 p-5 shadow-[-30px_0_90px_rgba(15,23,42,0.2)] backdrop-blur-2xl">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-sky-600">Appointment details</p>
                <h3 className="mt-1 text-lg font-semibold text-slate-950">{detailQuery.data?.subject || "Loading appointment…"}</h3>
              </div>
              <button type="button" onClick={() => setSelectedId(null)} aria-label="Close appointment details" className="rounded-full p-2 text-slate-400 hover:bg-slate-100">
                <X className="h-5 w-5" />
              </button>
            </div>
            {detailQuery.isPending ? (
              <div className="flex items-center gap-2 py-12 text-sm text-slate-400">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading full history…
              </div>
            ) : detailQuery.data ? (
              (() => {
                const detail = detailQuery.data;
                const person = detail.client || {
                  fullName: detail.guestName,
                  email: detail.guestEmail,
                  phone: detail.guestPhone,
                };
                return (
                  <div className="mt-5 space-y-4">
                    <div className="rounded-2xl bg-slate-50 p-4">
                      <p className="font-semibold text-slate-900">{person?.fullName || "Unnamed visitor"}</p>
                      {person?.email ? (
                        <p className="mt-2 flex items-center gap-2 text-sm text-slate-500">
                          <Mail className="h-4 w-4" />
                          {person.email}
                        </p>
                      ) : null}
                      {person?.phone ? (
                        <p className="mt-1.5 flex items-center gap-2 text-sm text-slate-500">
                          <Phone className="h-4 w-4" />
                          {person.phone}
                        </p>
                      ) : null}
                    </div>
                    {detail.description ? (
                      <div className="rounded-2xl border border-sky-100 bg-sky-50/60 p-4">
                        <p className="text-xs font-semibold uppercase tracking-[0.12em] text-sky-700">What this is about</p>
                        <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-700">{detail.description}</p>
                      </div>
                    ) : null}
                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <div className="rounded-2xl border border-slate-100 p-3">
                        <p className="text-slate-400">When</p>
                        <p className="mt-1 font-semibold text-slate-800">
                          {new Intl.DateTimeFormat("en-CA", {
                            dateStyle: "medium",
                            timeStyle: "short",
                          }).format(new Date(detail.startsAt))}
                        </p>
                      </div>
                      <div className="rounded-2xl border border-slate-100 p-3">
                        <p className="text-slate-400">Reference</p>
                        <p className="mt-1 font-mono font-semibold text-slate-800">{detail.referenceCode || "—"}</p>
                      </div>
                      <div className="rounded-2xl border border-slate-100 p-3">
                        <p className="text-slate-400">Consultant</p>
                        <p className="mt-1 font-semibold text-slate-800">{detail.assignedTo?.fullName || "Unassigned"}</p>
                      </div>
                      <div className="rounded-2xl border border-slate-100 p-3">
                        <p className="text-slate-400">Confirmation</p>
                        <p className="mt-1 font-semibold text-slate-800">
                          {detail.confirmationStatus}
                          {detail.preparationCompletedAt ? " · Prepared" : ""}
                        </p>
                      </div>
                    </div>
                    {detail.sessionType?.preparationChecklist?.length ? (
                      <div className="rounded-2xl bg-amber-50/70 p-4">
                        <p className="text-xs font-semibold uppercase tracking-wide text-amber-700">Preparation</p>
                        {detail.sessionType.preparationChecklist.map((item) => (
                          <p key={item} className="mt-2 flex gap-2 text-sm text-slate-600">
                            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                            {item}
                          </p>
                        ))}
                      </div>
                    ) : null}
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-400">Delivery</p>
                      <div className="mt-2 space-y-2">
                        {detail.messageDeliveries?.length ? (
                          detail.messageDeliveries.map((delivery) => (
                            <div key={delivery.id} className="flex items-center justify-between rounded-xl border border-slate-100 px-3 py-2 text-xs">
                              <span className="capitalize text-slate-600">
                                {delivery.kind} · {delivery.channel}
                              </span>
                              <span className={delivery.status === "sent" ? "font-semibold text-emerald-600" : "font-semibold text-amber-600"}>{delivery.status}</span>
                            </div>
                          ))
                        ) : (
                          <p className="text-sm text-slate-400">No delivery records.</p>
                        )}
                      </div>
                    </div>
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-400">History</p>
                      <div className="mt-2 space-y-3">
                        {detail.events?.length ? (
                          detail.events.map((event) => (
                            <div key={event.id} className="flex gap-3">
                              <Clock3 className="mt-0.5 h-4 w-4 shrink-0 text-slate-300" />
                              <div>
                                <p className="text-sm font-medium text-slate-700">{event.summary}</p>
                                <p className="text-xs text-slate-400">
                                  {new Intl.DateTimeFormat("en-CA", {
                                    dateStyle: "medium",
                                    timeStyle: "short",
                                  }).format(new Date(event.createdAt))}
                                  {event.actor?.fullName ? ` · ${event.actor.fullName}` : ""}
                                </p>
                              </div>
                            </div>
                          ))
                        ) : (
                          <p className="text-sm text-slate-400">No recorded history yet.</p>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })()
            ) : (
              <p className="mt-6 text-sm text-rose-600">Appointment details could not be loaded.</p>
            )}
          </aside>
        </div>
      ) : null}
    </section>
  );
}
