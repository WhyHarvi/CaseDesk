import { CalendarDays, ChevronRight, MapPin, Phone, Video } from "lucide-react";
import { Link } from "react-router-dom";

function formatTime(value) {
  return new Date(value).toLocaleTimeString("en-CA", { hour: "numeric", minute: "2-digit" });
}

export default function DashboardAppointments({ items = null, loading = false }) {
  const todayKey = new Date().toDateString();

  return (
    <section className="rounded-3xl border border-white/70 bg-white/80 p-5 shadow-[0_18px_45px_rgba(15,23,42,0.08)] backdrop-blur-xl">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-sky-50 text-sky-600">
            <CalendarDays className="h-[18px] w-[18px]" />
          </span>
          <div>
            <h2 className="text-sm font-semibold text-slate-900">Appointments</h2>
            <p className="text-xs text-slate-400">Your next scheduled meetings</p>
          </div>
        </div>
        <Link to="/app/calendar" className="flex items-center gap-1 text-xs font-semibold text-sky-700 transition hover:text-sky-800">
          Open calendar <ChevronRight className="h-3.5 w-3.5" />
        </Link>
      </div>

      {loading || items === null ? (
        <div className="mt-4 space-y-2">
          {[0, 1].map((key) => <div key={key} className="h-12 animate-pulse rounded-2xl bg-slate-100" />)}
        </div>
      ) : items.length ? (
        <div className="mt-3 divide-y divide-slate-100">
          {items.map((item) => {
            const isToday = new Date(item.startsAt).toDateString() === todayKey;
            return (
              <Link key={item.id} to="/app/calendar" className="flex items-center gap-3 py-2.5 transition hover:bg-slate-50/70">
                <div className="w-[74px] shrink-0 text-center">
                  <p className="text-sm font-semibold text-slate-900">{formatTime(item.startsAt)}</p>
                  <p className="text-[10px] font-medium uppercase tracking-wide text-slate-400">{isToday ? "Today" : "Tomorrow"}</p>
                </div>
                <span className={`h-8 w-[3px] shrink-0 rounded-full ${isToday ? "bg-sky-500" : "bg-slate-200"}`} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-slate-800">{item.case?.client?.fullName || item.client?.fullName || item.guestName || item.subject}</p>
                  <p className="truncate text-xs text-slate-400">{item.sessionType?.name || item.subject}{item.assignedTo ? ` · ${item.assignedTo.fullName}` : ""}</p>
                  {item.description ? <p className="mt-0.5 line-clamp-2 text-xs text-slate-500">{item.description}</p> : null}
                </div>
                {["Online", "Zoom"].includes(item.meetingMode) ? (
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-sky-50 text-sky-600" title={item.meetingMode === "Zoom" ? "Zoom video call" : "Jitsi video call"}>
                    <Video className="h-3.5 w-3.5" />
                  </span>
                ) : item.meetingMode === "Phone" ? (
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-emerald-50 text-emerald-600" title="Phone call">
                    <Phone className="h-3.5 w-3.5" />
                  </span>
                ) : (
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-400" title="In person">
                    <MapPin className="h-3.5 w-3.5" />
                  </span>
                )}
              </Link>
            );
          })}
        </div>
      ) : (
        <p className="mt-4 text-sm text-slate-400">Nothing booked for today or tomorrow.</p>
      )}
    </section>
  );
}
