import {
  Bell,
  BriefcaseBusiness,
  CalendarClock,
  ClipboardList,
  FileText,
  ListChecks,
  MessageSquareText,
  ShieldCheck,
  Target,
  UsersRound,
  WalletCards,
} from "lucide-react";

export const CATEGORY_META = {
  clients: { icon: UsersRound, gradient: "from-cyan-400 to-sky-600", label: "Clients" },
  cases: { icon: BriefcaseBusiness, gradient: "from-sky-400 to-blue-600", label: "Cases" },
  leads: { icon: Target, gradient: "from-orange-400 to-rose-500", label: "Leads" },
  documents: { icon: FileText, gradient: "from-indigo-400 to-violet-600", label: "Documents" },
  appointments: { icon: CalendarClock, gradient: "from-rose-400 to-red-500", label: "Appointments" },
  payments: { icon: WalletCards, gradient: "from-emerald-400 to-green-600", label: "Payments" },
  communications: { icon: MessageSquareText, gradient: "from-emerald-400 to-teal-600", label: "Messages" },
  work: { icon: ClipboardList, gradient: "from-amber-400 to-orange-500", label: "Work" },
  questionnaires: { icon: ListChecks, gradient: "from-fuchsia-400 to-purple-600", label: "Questionnaires" },
  security: { icon: ShieldCheck, gradient: "from-slate-500 to-slate-700", label: "Security" },
};

export const DEFAULT_META = { icon: Bell, gradient: "from-slate-400 to-slate-600", label: "General" };

export function categoryMeta(category) {
  return CATEGORY_META[category] || DEFAULT_META;
}

export const SEVERITY_RING = {
  warning: "ring-2 ring-amber-300/70",
  critical: "ring-2 ring-rose-400/80",
};

export function formatRelativeTime(value) {
  if (!value) return "";
  const time = new Date(value).getTime();
  const diff = Date.now() - time;
  const minutes = Math.round(diff / 60_000);
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d`;
  return new Date(value).toLocaleDateString("en-CA", { month: "short", day: "numeric" });
}

export function formatFullTime(value) {
  if (!value) return "";
  return new Date(value).toLocaleString("en-CA", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}
