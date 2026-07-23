import { Plus, UserPlus } from "lucide-react";
import NotificationBell from "../notifications/NotificationBell";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../auth/AuthContext";
import GlobalSearch from "../search/GlobalSearch";

export default function DashboardTopBar({ leading }) {
  const navigate = useNavigate();
  const { role } = useAuth();
  const isFrontdesk = role === "frontdesk";

  return (
    <div className="flex flex-wrap items-center gap-3 lg:flex-nowrap lg:justify-between">
      <div className="flex w-full max-w-3xl flex-1 items-center gap-3">
        {leading}
        <GlobalSearch />
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

        <NotificationBell variant="topbar" />
      </div>
    </div>
  );
}
