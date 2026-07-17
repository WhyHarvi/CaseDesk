import { motion } from "framer-motion";
import { X } from "lucide-react";
import { SEVERITY_RING, categoryMeta, formatFullTime, formatRelativeTime } from "./notificationMeta";

export default function NotificationItem({ notification, onOpen, onDismiss }) {
  const meta = categoryMeta(notification.category);
  const Icon = meta.icon;
  const unread = !notification.readAt;
  const severityRing = SEVERITY_RING[notification.severity] || "";

  return (
    <motion.article
      layout
      initial={{ opacity: 0, y: 10, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, x: 44, transition: { duration: 0.18 } }}
      transition={{ type: "spring", stiffness: 420, damping: 34 }}
      className="group relative"
    >
      <button
        type="button"
        onClick={() => onOpen(notification)}
        title={formatFullTime(notification.createdAt)}
        className={`w-full rounded-[1.35rem] border p-3.5 text-left shadow-[0_10px_30px_rgba(15,23,42,0.08)] backdrop-blur-xl transition active:scale-[0.99] ${
          unread
            ? "border-white/80 bg-white/90 hover:bg-white"
            : "border-white/50 bg-white/55 hover:bg-white/75"
        }`}
      >
        <div className="flex items-start gap-3">
          <span
            className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-[0.85rem] bg-gradient-to-br text-white shadow-[0_6px_16px_rgba(15,23,42,0.18)] ${meta.gradient} ${severityRing}`}
          >
            <Icon className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline justify-between gap-2">
              <p className={`truncate text-[13px] ${unread ? "font-semibold text-slate-950" : "font-medium text-slate-700"}`}>
                {notification.title}
              </p>
              <span className="shrink-0 text-[11px] text-slate-400">{formatRelativeTime(notification.createdAt)}</span>
            </div>
            {notification.body ? (
              <p className="mt-0.5 line-clamp-2 text-[12.5px] leading-5 text-slate-500">{notification.body}</p>
            ) : null}
            {notification.actor?.fullName ? (
              <p className="mt-1 text-[11px] text-slate-400">{notification.actor.fullName}</p>
            ) : null}
          </div>
          {unread ? <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-sky-500" aria-label="Unread" /> : null}
        </div>
      </button>

      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          onDismiss(notification.id);
        }}
        aria-label="Clear notification"
        className="absolute -left-1.5 -top-1.5 z-10 flex h-6 w-6 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 opacity-0 shadow-md transition hover:text-slate-900 focus-visible:opacity-100 group-hover:opacity-100"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </motion.article>
  );
}
