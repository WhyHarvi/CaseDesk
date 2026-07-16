import { Bell, Plus, Search, UserPlus } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../auth/AuthContext";

export default function DashboardTopBar({ leading }) {
  const navigate = useNavigate();
  const { role } = useAuth();
  const isFrontdesk = role === "frontdesk";
  const [searchQuery, setSearchQuery] = useState("");

  return (
    <div className="flex flex-wrap items-center gap-3 lg:flex-nowrap lg:justify-between">
      <div className="flex w-full max-w-3xl flex-1 items-center gap-3">
        {leading}
        <label className="flex h-14 flex-1 items-center gap-3 rounded-2xl border border-slate-200/70 bg-white/80 px-5 shadow-sm backdrop-blur-sm transition-all duration-200 focus-within:border-sky-300 focus-within:ring-2 focus-within:ring-sky-200">
          <Search className="h-5 w-5 shrink-0 text-slate-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder="Search clients, cases, documents, notes..."
            className="w-full border-0 bg-transparent p-0 text-base text-slate-700 outline-none placeholder:text-slate-400"
          />
          <span className="hidden rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-medium text-slate-400 sm:inline-flex">
            /
          </span>
        </label>
      </div>

      <div className="flex w-full flex-wrap items-center justify-end gap-3 lg:w-auto lg:flex-nowrap">
        {!isFrontdesk ? <>
        <button
          type="button"
          onClick={() => navigate("/app/clients")}
          className="inline-flex h-11 items-center gap-2 rounded-2xl border border-slate-200 bg-white/80 px-4 text-sm font-medium text-slate-700 shadow-sm transition-all duration-200 hover:bg-slate-50"
        >
          <UserPlus className="h-4.5 w-4.5" />
          <span>Add Client</span>
        </button>

        <button
          type="button"
          onClick={() => navigate("/app/cases")}
          className="inline-flex h-11 items-center gap-2 rounded-2xl bg-sky-600 px-4 text-sm font-medium text-white shadow-sm shadow-sky-200 transition-all duration-200 hover:bg-sky-700"
        >
          <Plus className="h-4.5 w-4.5" />
          <span>New Case</span>
        </button>
        </> : null}

        <button
          type="button"
          className="relative flex h-11 w-11 items-center justify-center rounded-full border border-slate-200/70 bg-white/80 text-slate-500 shadow-sm transition-all duration-200 hover:bg-slate-50 hover:text-slate-700"
          aria-label="Notifications"
        >
          <Bell className="h-5 w-5" />
          <span className="absolute right-0.5 top-0.5 inline-flex min-h-5 min-w-5 items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-semibold text-white">
            3
          </span>
        </button>
      </div>
    </div>
  );
}
