import { Bell, BellOff } from "lucide-react";
import { useEffect, useState } from "react";
import { disablePortalPushNotifications, enablePortalPushNotifications } from "./InstallAppPrompt";

// The settings-page counterpart to InstallAppPrompt's banner — for anyone
// who dismissed it, or wants to turn notifications back off later.
export default function PortalNotificationsSettingsPanel() {
  const supported = typeof Notification !== "undefined" && "serviceWorker" in navigator && "PushManager" in window;
  const [permission, setPermission] = useState(supported ? Notification.permission : "unsupported");
  const [subscribed, setSubscribed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!supported) return;
    navigator.serviceWorker.ready
      .then((registration) => registration.pushManager.getSubscription())
      .then((subscription) => setSubscribed(Boolean(subscription)))
      .catch(() => {});
  }, [supported]);

  async function toggle() {
    setError("");
    setBusy(true);
    try {
      if (subscribed) {
        await disablePortalPushNotifications();
        setSubscribed(false);
      } else {
        const result = await enablePortalPushNotifications();
        setPermission(Notification.permission);
        setSubscribed(result.granted);
        if (!result.granted) setError("Notifications are blocked in your browser's site settings — allow them there, then try again.");
      }
    } catch {
      setError("Something went wrong. Try again in a moment.");
    } finally {
      setBusy(false);
    }
  }

  if (!supported) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm leading-6 text-slate-500">
        Notifications aren't supported in this browser yet. Try Chrome or Safari — on iPhone, add CaseDesk to your Home Screen first.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-4">
        <div className="flex items-center gap-3">
          <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl ${subscribed ? "bg-emerald-50 text-emerald-600" : "bg-slate-100 text-slate-500"}`}>
            {subscribed ? <Bell className="h-[18px] w-[18px]" /> : <BellOff className="h-[18px] w-[18px]" />}
          </span>
          <div>
            <p className="text-sm font-semibold text-slate-900">Push notifications</p>
            <p className="text-xs text-slate-500">
              {subscribed ? "On for this device" : permission === "denied" ? "Blocked in your browser settings" : "Off for this device"}
            </p>
          </div>
        </div>
        <button
          type="button"
          disabled={busy || permission === "denied"}
          onClick={toggle}
          className={`h-9 rounded-full px-4 text-xs font-semibold transition disabled:opacity-50 ${subscribed ? "border border-slate-200 bg-white text-slate-700 hover:border-slate-300" : "bg-brand-700 text-white hover:bg-brand-800"}`}
        >
          {busy ? "Working…" : subscribed ? "Turn off" : "Turn on"}
        </button>
      </div>
      {error ? <p className="text-xs font-medium text-rose-600">{error}</p> : null}
    </div>
  );
}
