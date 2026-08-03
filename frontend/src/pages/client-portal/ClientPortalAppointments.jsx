import { CalendarDays, CheckCircle2, CircleAlert, Clock3, MapPin, Phone, UserRound, Video } from "lucide-react";
import { useEffect, useState } from "react";
import { getPortalAppointments, portalErrorMessage } from "../../api/clientPortalApi";
import ClientPortalEmptyState from "../../components/client-portal/ClientPortalEmptyState";
import ClientPortalHeader from "../../components/client-portal/ClientPortalHeader";
import ClientPortalSkeleton, { GlassCard } from "../../components/client-portal/ClientPortalSkeleton";
import { usePortalData } from "../../components/client-portal/ClientPortalLayout";
import { formatMoney } from "../../components/client-portal/ClientPaymentCard";

const STATUS_TONE = {
  Scheduled: "bg-sky-100 text-sky-700",
  Completed: "bg-emerald-100 text-emerald-700",
  Cancelled: "bg-slate-100 text-slate-600",
  NoShow: "bg-amber-100 text-amber-700",
};

const PAYMENT_LABEL = {
  Paid: "Paid",
  Refunded: "Refunded",
  AwaitingPayment: "Awaiting payment",
  Confirming: "Confirming payment",
};

function appointmentDate(value) {
  return new Intl.DateTimeFormat("en-CA", { weekday: "short", month: "short", day: "numeric", year: "numeric" }).format(new Date(value));
}

function appointmentTime(start, end) {
  const formatter = new Intl.DateTimeFormat("en-CA", { hour: "numeric", minute: "2-digit" });
  return `${formatter.format(new Date(start))} – ${formatter.format(new Date(end))}`;
}

function AppointmentCard({ appointment }) {
  const online = appointment.meetingMode === "Online" || appointment.meetingMode === "Video";
  return (
    <li>
      <GlassCard className="overflow-hidden p-0">
        <div className="flex items-start gap-4 p-5">
          <div className="flex h-12 w-12 shrink-0 flex-col items-center justify-center rounded-2xl bg-sky-100 text-sky-700">
            <span className="text-[10px] font-bold uppercase tracking-wide">{new Intl.DateTimeFormat("en", { month: "short" }).format(new Date(appointment.startsAt))}</span>
            <span className="text-lg font-bold leading-none">{new Date(appointment.startsAt).getDate()}</span>
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <h2 className="truncate text-[15px] font-semibold text-slate-950">{appointment.subject}</h2>
                <p className="mt-1 text-[12px] text-slate-500">{appointmentDate(appointment.startsAt)}</p>
              </div>
              <span className={["rounded-full px-2.5 py-1 text-[10px] font-semibold", STATUS_TONE[appointment.status] || "bg-slate-100 text-slate-600"].join(" ")}>
                {appointment.status === "NoShow" ? "No show" : appointment.status}
              </span>
            </div>

            <div className="mt-3 grid gap-2 text-[12px] text-slate-600 sm:grid-cols-2">
              <p className="flex items-center gap-2"><Clock3 className="h-3.5 w-3.5 text-slate-400" />{appointmentTime(appointment.startsAt, appointment.endsAt)}</p>
              {appointment.consultantName ? <p className="flex items-center gap-2"><UserRound className="h-3.5 w-3.5 text-slate-400" />{appointment.consultantName}</p> : null}
              {appointment.location ? (
                appointment.locationMapsUrl ? <a className="flex items-center gap-2 text-sky-700 hover:underline" href={appointment.locationMapsUrl} target="_blank" rel="noreferrer"><MapPin className="h-3.5 w-3.5" />{appointment.location}</a>
                  : <p className="flex items-center gap-2"><MapPin className="h-3.5 w-3.5 text-slate-400" />{appointment.location}</p>
              ) : null}
              {appointment.meetingPhoneNumber ? <a className="flex items-center gap-2 text-sky-700 hover:underline" href={`tel:${appointment.meetingPhoneNumber}`}><Phone className="h-3.5 w-3.5" />{appointment.meetingPhoneNumber}</a> : null}
            </div>

            {appointment.purpose ? <p className="mt-3 rounded-2xl bg-slate-50 px-3.5 py-2.5 text-[12px] leading-5 text-slate-600">{appointment.purpose}</p> : null}
            {appointment.status === "Cancelled" && appointment.cancellationReason ? <p className="mt-3 text-[12px] leading-5 text-slate-500">Cancellation reason: {appointment.cancellationReason}</p> : null}

            <div className="mt-4 flex flex-wrap items-center gap-2">
              {appointment.status === "Scheduled" && online && appointment.meetingUrl ? (
                <a href={appointment.meetingUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded-full bg-slate-950 px-3.5 py-2 text-[11px] font-semibold text-white transition hover:bg-slate-800 active:scale-[0.98]">
                  <Video className="h-3.5 w-3.5" /> Join meeting
                </a>
              ) : null}
              {appointment.payment ? (
                <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-[11px] font-semibold text-slate-600">
                  <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
                  {formatMoney(appointment.payment.amount)} · {PAYMENT_LABEL[appointment.payment.status] || appointment.payment.status}
                </span>
              ) : null}
              {appointment.referenceCode ? <span className="text-[10px] font-medium text-slate-400">Ref {appointment.referenceCode}</span> : null}
            </div>
          </div>
        </div>
      </GlassCard>
    </li>
  );
}

export default function ClientPortalAppointments() {
  const { overview } = usePortalData();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    getPortalAppointments()
      .then((result) => active && setData(result))
      .catch((reason) => active && setError(portalErrorMessage(reason, "Your appointments could not be loaded.")))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, []);

  if (loading) return <ClientPortalSkeleton rows={3} />;

  return (
    <div className="space-y-5">
      <ClientPortalHeader title="Appointments" subtitle="Your upcoming visits and complete appointment history" client={overview?.client} agency={overview?.agency} />
      {error ? <ClientPortalEmptyState icon={CircleAlert} title="We couldn't load your appointments" copy={error} /> : null}
      {!error && !data?.total ? <ClientPortalEmptyState icon={CalendarDays} title="No appointments yet" copy="When an appointment is booked with your agency, it will appear here." /> : null}
      {!error && data?.upcoming?.length ? (
        <section>
          <h2 className="px-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">Upcoming</h2>
          <ul className="mt-2.5 space-y-3">{data.upcoming.map((item) => <AppointmentCard key={item.id} appointment={item} />)}</ul>
        </section>
      ) : null}
      {!error && data?.history?.length ? (
        <section>
          <h2 className="px-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">History</h2>
          <ul className="mt-2.5 space-y-3">{data.history.map((item) => <AppointmentCard key={item.id} appointment={item} />)}</ul>
        </section>
      ) : null}
    </div>
  );
}
