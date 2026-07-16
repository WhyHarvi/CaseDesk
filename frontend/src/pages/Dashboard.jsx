import { useEffect, useState } from "react";
import DashboardBottomRow from "../components/dashboard/DashboardBottomRow";
import DashboardWorkRow from "../components/dashboard/DashboardWorkRow";
import DashboardStats from "../components/dashboard/DashboardStats";
import PageContainer from "../components/layout/PageContainer";
import { useAuth } from "../auth/AuthContext";
import api from "../services/api";

export default function Dashboard() {
  const { role } = useAuth();
  const [dashboard, setDashboard] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    async function loadDashboard() {
      try {
        setLoading(true);
        const response = await api.get("/dashboard");
        setDashboard(response.data.data);
        setError("");
      } catch (requestError) {
        setError(requestError.response?.data?.message || "Unable to load dashboard data.");
      } finally {
        setLoading(false);
      }
    }

    loadDashboard();
  }, []);

  return (
    <PageContainer
      title="Dashboard"
      description="A quick view of agency activity, open work, and upcoming follow-ups."
    >
      {error ? (
        <div className="rounded-3xl border border-rose-200 bg-rose-50 px-5 py-4 text-sm text-rose-700">
          {error}
        </div>
      ) : null}

      <DashboardStats dashboard={dashboard} loading={loading} />

      <DashboardWorkRow dashboard={dashboard} loading={loading} role={role} />

      <DashboardBottomRow dashboard={dashboard} loading={loading} />
    </PageContainer>
  );
}
