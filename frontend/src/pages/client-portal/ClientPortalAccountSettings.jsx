import { Activity, ShieldCheck } from "lucide-react";
import { useState } from "react";
import ClientPortalHeader from "../../components/client-portal/ClientPortalHeader";
import { usePortalData } from "../../components/client-portal/ClientPortalLayout";
import SecuritySettingsPanel from "../../components/settings/SecuritySettingsPanel";
import ActivityLogsSettingsPanel from "../../components/settings/ActivityLogsSettingsPanel";

export default function ClientPortalAccountSettings() {
  const { overview } = usePortalData();
  const [section, setSection] = useState("security");
  return (
    <div className="space-y-4">
      <ClientPortalHeader title="Settings" subtitle="Security and account activity" client={overview?.client} agency={overview?.agency} />
      <section className="rounded-[28px] border border-white/70 bg-white/80 p-4 shadow-[0_16px_45px_rgba(28,45,74,0.08)] backdrop-blur-2xl sm:p-6">
        <div className="mb-6 inline-flex rounded-full bg-slate-100 p-1">
          <button type="button" onClick={() => setSection("security")} className={`inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-[12px] font-semibold transition ${section === "security" ? "bg-white text-slate-950 shadow-sm" : "text-slate-500"}`}><ShieldCheck className="h-3.5 w-3.5" /> Security</button>
          <button type="button" onClick={() => setSection("activity")} className={`inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-[12px] font-semibold transition ${section === "activity" ? "bg-white text-slate-950 shadow-sm" : "text-slate-500"}`}><Activity className="h-3.5 w-3.5" /> Activity Logs</button>
        </div>
        {section === "security" ? <SecuritySettingsPanel compact /> : <ActivityLogsSettingsPanel compact />}
      </section>
    </div>
  );
}
