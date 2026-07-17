import { Link } from "react-router-dom";
import NotificationBell from "../notifications/NotificationBell";

export default function ClientPortalHeader({ title, subtitle, client, agency }) {
  const initials = (client?.fullName || client?.firstName || "You")
    .split(" ")
    .filter(Boolean)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return (
    <header className="flex items-center justify-between gap-3 py-4">
      <div className="min-w-0">
        {agency?.name ? (
          <p className="truncate text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">{agency.name}</p>
        ) : null}
        <h1 className="mt-0.5 truncate text-[26px] font-semibold leading-8 tracking-[-0.03em] text-slate-950">{title}</h1>
        {subtitle ? <p className="mt-0.5 truncate text-sm text-slate-500">{subtitle}</p> : null}
      </div>
      <div className="flex shrink-0 items-center gap-2.5">
        <NotificationBell variant="portal" />
        <Link
          to="/client-portal/profile"
          aria-label="Open your profile"
          className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-full bg-gradient-to-br from-sky-500 to-indigo-500 text-sm font-semibold text-white shadow-[0_10px_25px_rgba(56,130,246,0.35)] ring-2 ring-white/80 transition active:scale-95"
        >
          {initials}
        </Link>
      </div>
    </header>
  );
}
