import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import DashboardBottomRow from "../components/dashboard/DashboardBottomRow";
import DashboardWorkRow from "../components/dashboard/DashboardWorkRow";
import DashboardStats from "../components/dashboard/DashboardStats";
import DashboardSchedulingOverview from "../components/dashboard/DashboardSchedulingOverview";
import DashboardDocumentsDrawer from "../components/dashboard/DashboardDocumentsDrawer";
import DashboardListDrawer from "../components/dashboard/DashboardListDrawer";
import PageContainer from "../components/layout/PageContainer";
import { useAuth } from "../auth/AuthContext";
import api from "../services/api";
import { apiQueryKey, getApiCacheScope, staleTimeFor } from "../services/queryClient";

const DASHBOARD_PATH = "/dashboard";
const DASHBOARD_REFRESH_MS = 60_000;

export default function Dashboard() {
  const { role } = useAuth();
  const [activeDrawer, setActiveDrawer] = useState(null);
  const [schedulingFocusSignal, setSchedulingFocusSignal] = useState(0);
  const scope = getApiCacheScope();
  const dashboardQuery = useQuery({
    queryKey: apiQueryKey(scope, DASHBOARD_PATH),
    queryFn: ({ signal }) => api.get(DASHBOARD_PATH, { cache: false, signal }),
    select: (response) => response.data.data,
    staleTime: staleTimeFor(DASHBOARD_PATH),
    refetchInterval: DASHBOARD_REFRESH_MS,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: "always",
    refetchOnReconnect: "always",
  });
  const dashboard = dashboardQuery.data;
  const loading = dashboardQuery.isPending;
  const error = dashboardQuery.error?.response?.data?.message
    || (dashboardQuery.error ? "Unable to load dashboard data." : "");

  return (
    <PageContainer
      title="Dashboard"
      description="A quick view of workspace activity, open work, and upcoming follow-ups."
    >
      {error ? (
        <div className="rounded-3xl border border-rose-200 bg-rose-50 px-5 py-4 text-sm text-rose-700">
          {error}
        </div>
      ) : null}

      <DashboardStats
        dashboard={dashboard}
        loading={loading}
        onOpenDrawer={setActiveDrawer}
        onFocusScheduling={() => setSchedulingFocusSignal((count) => count + 1)}
      />

      <DashboardWorkRow dashboard={dashboard} loading={loading} role={role} onDashboardChanged={() => dashboardQuery.refetch()} />

      <DashboardBottomRow dashboard={dashboard} loading={loading} />

      <DashboardSchedulingOverview role={role} initial={dashboard?.scheduling || null} focusSignal={schedulingFocusSignal} />

      <DashboardDocumentsDrawer
        open={activeDrawer === "documents"}
        onClose={() => setActiveDrawer(null)}
        dashboard={dashboard}
      />
      <DashboardListDrawer
        open={activeDrawer === "tasksToday" || activeDrawer === "tasksOverdue" || activeDrawer === "followUpsToday"}
        onClose={() => setActiveDrawer(null)}
        kind={activeDrawer}
        dashboard={dashboard}
      />
    </PageContainer>
  );
}
