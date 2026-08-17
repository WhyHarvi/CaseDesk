import { Bell, Check, Download, Share, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { subscribeToPortalPush, unsubscribeFromPortalPush } from "../../api/clientPortalApi";

const DISMISS_KEY = "casedesk-portal-install-dismissed-at";
const DISMISS_DAYS = 7;

function isIos() {
  return /iphone|ipad|ipod/i.test(navigator.userAgent);
}

function isStandalone() {
  return window.matchMedia?.("(display-mode: standalone)").matches || navigator.standalone === true;
}

function recentlyDismissed() {
  const value = Number(localStorage.getItem(DISMISS_KEY) || 0);
  return value && Date.now() - value < DISMISS_DAYS * 24 * 60 * 60_000;
}

function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  return Uint8Array.from([...raw].map((char) => char.charCodeAt(0)));
}

// Two independent things this banner can ask for, shown one at a time:
// installing to the home screen, and (only once installed, on iOS — a
// platform requirement, not a choice) enabling push notifications. Neither
// step exists in isolation on iOS: Safari only allows push for a site
// that's already been added to the home screen, so "enable notifications"
// literally cannot come first there. Android has no such restriction —
// push works from a regular browser tab — so it skips straight to the
// notification step without ever needing the install step to succeed.
export default function InstallAppPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState(null);
  const [installed, setInstalled] = useState(() => isStandalone());
  const [notificationPermission, setNotificationPermission] = useState(
    typeof Notification !== "undefined" ? Notification.permission : "unsupported",
  );
  const [dismissed, setDismissed] = useState(recentlyDismissed);
  const [subscribing, setSubscribing] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    function onBeforeInstallPrompt(event) {
      event.preventDefault();
      setDeferredPrompt(event);
    }
    function onInstalled() {
      setInstalled(true);
      setDeferredPrompt(null);
    }
    window.addEventListener("beforeinstallprompt", onBeforeInstallPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstallPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  const dismiss = useCallback(() => {
    localStorage.setItem(DISMISS_KEY, String(Date.now()));
    setDismissed(true);
  }, []);

  async function installOnAndroid() {
    if (!deferredPrompt) return;
    await deferredPrompt.prompt();
    setDeferredPrompt(null);
  }

  async function enableNotifications() {
    setError("");
    setSubscribing(true);
    try {
      const permission = await Notification.requestPermission();
      setNotificationPermission(permission);
      if (permission !== "granted") return;
      const registration = await navigator.serviceWorker.ready;
      let subscription = await registration.pushManager.getSubscription();
      if (!subscription) {
        subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(import.meta.env.VITE_VAPID_PUBLIC_KEY),
        });
      }
      await subscribeToPortalPush(subscription.toJSON());
    } catch {
      setError("Notifications could not be turned on. You can try again anytime.");
    } finally {
      setSubscribing(false);
    }
  }

  const pushConfigured = Boolean(import.meta.env.VITE_VAPID_PUBLIC_KEY) && "serviceWorker" in navigator && "PushManager" in window;
  const needsInstall = !installed && (deferredPrompt || isIos());
  const needsNotifications = installed && pushConfigured && notificationPermission === "default";

  if (dismissed || (!needsInstall && !needsNotifications)) return null;

  return (
    <div className="lg:hidden mx-4 mt-[max(env(safe-area-inset-top),1rem)] rounded-2xl border border-brand-200 bg-white/95 p-4 shadow-[0_18px_45px_rgba(15,23,42,0.1)] backdrop-blur-xl" role="status">
      <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-brand-700 text-white">
          {needsInstall ? <Download className="h-[18px] w-[18px]" /> : <Bell className="h-[18px] w-[18px]" />}
        </span>
        <div className="min-w-0 flex-1">
          {needsInstall ? (
            <>
              <p className="text-sm font-semibold text-slate-900">Add CaseDesk to your phone</p>
              {isIos() && !deferredPrompt ? (
                <p className="mt-1 text-xs leading-5 text-slate-500">
                  Tap <Share className="mb-0.5 inline h-3.5 w-3.5" aria-hidden="true" /> Share, then "Add to Home Screen" — this stays open, sign in once and you're in.
                </p>
              ) : (
                <p className="mt-1 text-xs leading-5 text-slate-500">One tap to keep your case, documents, and messages a home-screen away.</p>
              )}
            </>
          ) : (
            <>
              <p className="text-sm font-semibold text-slate-900">Get notified here</p>
              <p className="mt-1 text-xs leading-5 text-slate-500">Turn on notifications for new messages, documents, and updates on your case.</p>
            </>
          )}
          {error ? <p className="mt-1.5 text-xs font-medium text-rose-600">{error}</p> : null}
          <div className="mt-3 flex items-center gap-2">
            {needsInstall && deferredPrompt ? (
              <button type="button" onClick={installOnAndroid} className="inline-flex h-9 items-center gap-1.5 rounded-full bg-brand-700 px-3.5 text-xs font-semibold text-white transition hover:bg-brand-800">
                <Download className="h-3.5 w-3.5" /> Install
              </button>
            ) : null}
            {needsNotifications ? (
              <button type="button" disabled={subscribing} onClick={enableNotifications} className="inline-flex h-9 items-center gap-1.5 rounded-full bg-brand-700 px-3.5 text-xs font-semibold text-white transition hover:bg-brand-800 disabled:opacity-50">
                <Bell className="h-3.5 w-3.5" /> {subscribing ? "Turning on…" : "Enable notifications"}
              </button>
            ) : null}
            <button type="button" onClick={dismiss} className="inline-flex h-9 items-center rounded-full px-3 text-xs font-semibold text-slate-500 transition hover:bg-slate-100">
              Not now
            </button>
          </div>
        </div>
        <button type="button" onClick={dismiss} className="shrink-0 rounded-full p-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700" aria-label="Dismiss">
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

// Called from the portal profile/settings page for a client who dismissed
// or missed the banner and wants to turn notifications on directly.
export async function enablePortalPushNotifications() {
  const permission = await Notification.requestPermission();
  if (permission !== "granted") return { granted: false };
  const registration = await navigator.serviceWorker.ready;
  let subscription = await registration.pushManager.getSubscription();
  if (!subscription) {
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(import.meta.env.VITE_VAPID_PUBLIC_KEY),
    });
  }
  await subscribeToPortalPush(subscription.toJSON());
  return { granted: true };
}

export async function disablePortalPushNotifications() {
  if (!("serviceWorker" in navigator)) return;
  const registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.getSubscription();
  if (!subscription) return;
  await unsubscribeFromPortalPush(subscription.endpoint);
  await subscription.unsubscribe();
}
