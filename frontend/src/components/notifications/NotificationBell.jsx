import { Bell } from "lucide-react";
import { useNotifications } from "./NotificationProvider";

const VARIANTS = {
  topbar:
    "relative flex h-11 w-11 items-center justify-center rounded-full border border-slate-200/70 bg-white/80 text-slate-500 shadow-sm transition-all duration-200 hover:bg-slate-50 hover:text-slate-700",
  portal:
    "relative flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-white/80 bg-white/80 text-slate-600 shadow-[0_10px_25px_rgba(15,23,42,0.08)] backdrop-blur transition active:scale-95",
  chat:
    "relative flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-slate-500 transition hover:bg-slate-100 active:scale-95",
};

export default function NotificationBell({ variant = "topbar" }) {
  const { unreadCount, panelOpen, openPanel, closePanel } = useNotifications();
  const label = unreadCount > 0 ? `Notifications, ${unreadCount} unread` : "Notifications";

  return (
    <button
      type="button"
      onClick={() => (panelOpen ? closePanel() : openPanel())}
      aria-label={label}
      className={VARIANTS[variant] || VARIANTS.topbar}
    >
      <Bell className="h-5 w-5" />
      {unreadCount > 0 ? (
        <span className="absolute -right-0.5 -top-0.5 inline-flex min-h-[18px] min-w-[18px] items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-semibold leading-none text-white shadow-[0_2px_6px_rgba(225,29,72,0.5)]">
          {unreadCount > 99 ? "99+" : unreadCount}
        </span>
      ) : null}
    </button>
  );
}
