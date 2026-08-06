import { CalendarDays, ClipboardList, CreditCard, FileText, House, MessagesSquare } from "lucide-react";
import { NavLink } from "react-router-dom";
import { useNotifications } from "../notifications/NotificationProvider";

const items = [
  { label: "Home", to: "/client-portal", icon: House, end: true, badgeKey: "portalHome" },
  { label: "Docs", to: "/client-portal/documents", icon: FileText, badgeKey: "portalDocuments" },
  { label: "Forms", to: "/client-portal/questionnaires", icon: ClipboardList, badgeKey: "portalForms" },
  { label: "Visits", to: "/client-portal/appointments", icon: CalendarDays, badgeKey: "portalAppointments" },
  { label: "Pay", to: "/client-portal/payments", icon: CreditCard, badgeKey: "portalPayments" },
  { label: "Chat", to: "/client-portal/chat", icon: MessagesSquare, badgeKey: "portalChat" },
];

export default function ClientPortalBottomNav() {
  const { sidebarCounts, acknowledgeDestination } = useNotifications();
  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 flex justify-center px-3 pb-[max(env(safe-area-inset-bottom),0.75rem)]" aria-label="Portal navigation">
      <div className="flex w-full max-w-[520px] items-center justify-between rounded-[1.6rem] border border-white/70 bg-white/80 px-2 py-1.5 shadow-[0_18px_50px_rgba(15,23,42,0.16)] backdrop-blur-2xl">
        {items.map((item) => {
          const Icon = item.icon;
          const count = sidebarCounts[item.badgeKey];
          return (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              onClick={() => {
                void acknowledgeDestination(item.badgeKey);
              }}
              className={({ isActive }) =>
                [
                  "flex min-w-0 flex-1 flex-col items-center gap-1 rounded-2xl px-1 py-2 text-[10px] font-semibold transition-all duration-200 active:scale-95",
                  isActive ? "text-sky-700" : "text-slate-400 hover:text-slate-600",
                ].join(" ")
              }
            >
              {({ isActive }) => (
                <>
                  <span className={["relative flex h-8 w-14 items-center justify-center rounded-full transition-all duration-200", isActive ? "bg-sky-100" : "bg-transparent"].join(" ")}>
                    <Icon className="h-[18px] w-[18px]" />
                    {count?.total ? <span aria-label={`${count.total} unread items`} className={`absolute -right-0.5 -top-1 inline-flex h-[17px] min-w-[17px] items-center justify-center rounded-full px-1 text-[9px] font-bold tabular-nums text-white ring-2 ring-white ${count.actions ? "bg-rose-500" : "bg-sky-500"}`}>{count.total > 99 ? "99+" : count.total}</span> : null}
                  </span>
                  <span className="truncate">{item.label}</span>
                </>
              )}
            </NavLink>
          );
        })}
      </div>
    </nav>
  );
}
