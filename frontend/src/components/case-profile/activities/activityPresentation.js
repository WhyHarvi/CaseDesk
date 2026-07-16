import {
  BriefcaseBusiness,
  CalendarDays,
  CheckSquare2,
  FileText,
  History,
  MessageSquareText,
  StickyNote,
  UserRound,
  WalletCards,
} from "lucide-react";

const activityGroups = [
  { match: ["note"], icon: StickyNote, tone: "bg-amber-50 text-amber-700" },
  { match: ["document", "form", "correspondence"], icon: FileText, tone: "bg-sky-50 text-sky-700" },
  { match: ["task", "workflow", "assessment"], icon: CheckSquare2, tone: "bg-emerald-50 text-emerald-700" },
  { match: ["communication", "chat", "email", "sms"], icon: MessageSquareText, tone: "bg-violet-50 text-violet-700" },
  { match: ["applicant", "client", "profile"], icon: UserRound, tone: "bg-indigo-50 text-indigo-700" },
  { match: ["appointment"], icon: CalendarDays, tone: "bg-rose-50 text-rose-700" },
  { match: ["payment", "billing"], icon: WalletCards, tone: "bg-emerald-50 text-emerald-700" },
  { match: ["case"], icon: BriefcaseBusiness, tone: "bg-slate-100 text-slate-700" },
];

export function getActivityPresentation(action = "") {
  const normalized = action.toLowerCase();
  const group = activityGroups.find((item) => item.match.some((keyword) => normalized.includes(keyword)));
  return group || { icon: History, tone: "bg-slate-100 text-slate-600" };
}

export function humanizeAction(action = "Activity recorded") {
  return action
    .replace(/[._-]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}
