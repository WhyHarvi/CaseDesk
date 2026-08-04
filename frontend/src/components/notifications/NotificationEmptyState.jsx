import { BellOff } from "lucide-react";

export default function NotificationEmptyState({ filter }) {
  return (
    <div className="flex flex-col items-center px-6 py-14 text-center">
      <span className="flex h-14 w-14 items-center justify-center rounded-full bg-white/80 text-slate-400 shadow-[0_10px_25px_rgba(15,23,42,0.08)]">
        <BellOff className="h-6 w-6" />
      </span>
      <p className="mt-4 text-sm font-semibold text-slate-800">
        {filter === "action" ? "You’re all caught up" : filter === "updates" ? "No recent updates" : "No notifications"}
      </p>
      <p className="mt-1 max-w-[240px] text-[13px] leading-5 text-slate-500">
        {filter === "action"
          ? "Nothing needs your attention right now."
          : filter === "updates"
            ? "Quiet progress updates will appear here without increasing the urgent badge."
            : "Important actions and quieter progress updates will appear here."}
      </p>
    </div>
  );
}
