import { PhoneIncoming, UserRoundSearch, X } from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../auth/AuthContext";
import { getPortalAccess } from "../../auth/portalAccess";
import api from "../../services/api";

function name(call) {
  return call?.client?.fullName || [call?.lead?.firstName, call?.lead?.lastName].filter(Boolean).join(" ") || "Unknown caller";
}

export default function IncomingOomaCallAlert() {
  const navigate = useNavigate();
  const { appUser, membership } = useAuth();
  const [call, setCall] = useState(null);
  const access = getPortalAccess(appUser?.role || membership?.role, membership?.permissions);
  const enabled = appUser?.role === "admin" || access?.pages?.leads === true;

  useEffect(() => {
    if (!enabled) return undefined;
    let active = true;
    let timer = null;
    const check = async () => {
      try {
        const response = await api.get("/ooma-calls/attention", { timeout: 8_000 });
        if (!active) return;
        // Agencies that have never actually connected Ooma still get a
        // settings row with enabled/callsEnabled defaulted to true, so the
        // backend tells us explicitly whether there's a real integration to
        // poll for. Once we learn there isn't, stop polling entirely instead
        // of hitting this endpoint every 5s forever for nothing.
        if (response.data.configured === false) {
          setCall(null);
          if (timer) { window.clearInterval(timer); timer = null; }
          return;
        }
        const next = response.data.data || null;
        const dismissed = next ? window.sessionStorage.getItem("dismissedOomaCall") : null;
        setCall(next && dismissed !== next.id ? next : null);
      } catch {
        if (active) setCall(null);
      }
    };
    check();
    timer = window.setInterval(check, 5_000);
    return () => { active = false; if (timer) window.clearInterval(timer); };
  }, [enabled]);

  if (!call) return null;
  const known = Boolean(call.client || call.lead);
  return (
    <aside className="fixed bottom-5 right-5 z-[70] w-[calc(100%-2.5rem)] max-w-sm overflow-hidden rounded-3xl border border-sky-200/80 bg-white/95 shadow-[0_24px_80px_rgba(2,132,199,0.24)] backdrop-blur-xl" role="status" aria-live="polite">
      <div className="h-1 bg-gradient-to-r from-sky-400 via-cyan-400 to-emerald-400" />
      <div className="p-4">
        <div className="flex items-start gap-3">
          <span className="relative flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-sky-600 text-white"><span className="absolute inset-0 animate-ping rounded-full bg-sky-400/35" /><PhoneIncoming className="relative h-5 w-5" /></span>
          <div className="min-w-0 flex-1"><p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-sky-600">Incoming Ooma call</p><p className="mt-1 truncate text-base font-semibold text-slate-950">{name(call)}</p><p className="mt-0.5 truncate text-sm text-slate-500">{call.remoteNumber || "Private number"}{call.handledBy?.fullName ? ` · ${call.handledBy.fullName}` : ""}</p></div>
          <button type="button" onClick={() => { window.sessionStorage.setItem("dismissedOomaCall", call.id); setCall(null); }} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-500 hover:bg-slate-200" aria-label="Dismiss incoming call"><X className="h-3.5 w-3.5" /></button>
        </div>
        {!known ? <div className="mt-3 flex items-center gap-2 rounded-2xl bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800"><UserRoundSearch className="h-4 w-4" />No matching client or lead. The call is waiting in the call inbox.</div> : null}
        <button type="button" onClick={() => navigate(`/calls?call=${encodeURIComponent(call.id)}`)} className="mt-3 flex h-10 w-full items-center justify-center rounded-2xl bg-slate-950 text-sm font-semibold text-white transition hover:bg-slate-800">Open call record</button>
      </div>
    </aside>
  );
}
