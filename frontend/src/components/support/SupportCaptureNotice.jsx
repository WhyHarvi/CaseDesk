import { LifeBuoy, X } from "lucide-react";
import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";

export default function SupportCaptureNotice() {
  const navigate = useNavigate();
  const location = useLocation();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const show = () => setVisible(true);
    window.addEventListener("casedesk:support-captured", show);
    return () => window.removeEventListener("casedesk:support-captured", show);
  }, []);

  if (!visible || location.pathname === "/app/chats") return null;

  return (
    <div className="fixed bottom-5 right-5 z-[900] w-[min(360px,calc(100vw-2rem))] border border-rose-200 bg-white p-4 shadow-[0_20px_60px_rgba(15,23,42,0.2)]">
      <div className="flex items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-rose-50 text-rose-600"><LifeBuoy className="h-4 w-4" /></span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-slate-900">CaseDesk captured this error</p>
          <p className="mt-1 text-xs leading-5 text-slate-500">Review the screenshot and send a report from Help &amp; Support.</p>
        </div>
        <button type="button" onClick={() => setVisible(false)} aria-label="Dismiss" className="text-slate-400 hover:text-slate-700"><X className="h-4 w-4" /></button>
      </div>
      <button type="button" onClick={() => navigate(`/app/chats?kind=support&thread=help&from=${encodeURIComponent(location.pathname)}`)} className="mt-3 inline-flex h-10 w-full items-center justify-center gap-2 bg-rose-600 px-4 text-sm font-semibold text-white"><LifeBuoy className="h-4 w-4" />Report problem</button>
    </div>
  );
}
