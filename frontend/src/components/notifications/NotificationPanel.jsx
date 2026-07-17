import { AnimatePresence, motion } from "framer-motion";
import { CheckCheck, ChevronDown, ChevronLeft, Loader2, SlidersHorizontal, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../auth/AuthContext";
import { useNotifications } from "./NotificationProvider";
import NotificationEmptyState from "./NotificationEmptyState";
import NotificationItem from "./NotificationItem";
import NotificationPreferencesPanel from "./NotificationPreferencesPanel";
import NotificationSkeleton from "./NotificationSkeleton";

function PanelBody({ view, setView, isClient }) {
  const {
    items,
    unreadCount,
    filter,
    loading,
    loadingMore,
    error,
    hasMore,
    changeFilter,
    loadMore,
    markAllRead,
    dismiss,
    openNotification,
    closePanel,
    retry,
  } = useNotifications();
  const navigate = useNavigate();

  if (view === "preferences") {
    return (
      <>
        <header className="flex items-center gap-2 px-5 pb-3 pt-5">
          <button
            type="button"
            onClick={() => setView("list")}
            className="flex h-8 w-8 items-center justify-center rounded-full text-slate-500 transition hover:bg-white/80 hover:text-slate-900"
            aria-label="Back to notifications"
          >
            <ChevronLeft className="h-[18px] w-[18px]" />
          </button>
          <h2 className="text-base font-semibold text-slate-950">Notification preferences</h2>
        </header>
        <div className="flex-1 overflow-y-auto px-5 pb-6">
          <NotificationPreferencesPanel compact isClient={isClient} />
        </div>
      </>
    );
  }

  return (
    <>
      <header className="px-5 pb-3 pt-5">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-baseline gap-2">
            <h2 className="text-lg font-semibold tracking-tight text-slate-950">Notifications</h2>
            {unreadCount > 0 ? (
              <span className="rounded-full bg-sky-100 px-2 py-0.5 text-[11px] font-semibold text-sky-700">
                {unreadCount > 99 ? "99+" : unreadCount} new
              </span>
            ) : null}
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => (isClient ? setView("preferences") : (closePanel(), navigate("/app/settings?section=notifications")))}
              aria-label="Notification preferences"
              className="flex h-8 w-8 items-center justify-center rounded-full text-slate-500 transition hover:bg-white/80 hover:text-slate-900"
            >
              <SlidersHorizontal className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={closePanel}
              aria-label="Close notifications"
              className="flex h-8 w-8 items-center justify-center rounded-full text-slate-500 transition hover:bg-white/80 hover:text-slate-900"
            >
              <X className="h-[18px] w-[18px]" />
            </button>
          </div>
        </div>

        <div className="mt-3 flex items-center justify-between gap-2">
          <div className="flex rounded-full border border-white/70 bg-white/60 p-0.5 backdrop-blur">
            {["all", "unread"].map((key) => (
              <button
                key={key}
                type="button"
                onClick={() => changeFilter(key)}
                className={`rounded-full px-3.5 py-1.5 text-xs font-semibold capitalize transition ${
                  filter === key ? "bg-slate-950 text-white shadow" : "text-slate-500 hover:text-slate-800"
                }`}
              >
                {key}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={markAllRead}
            disabled={unreadCount === 0}
            className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold text-slate-500 transition hover:bg-white/80 hover:text-slate-900 disabled:opacity-40"
          >
            <CheckCheck className="h-3.5 w-3.5" /> Mark all read
          </button>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto px-4 pb-6 pt-1">
        {error ? (
          <div className="rounded-2xl border border-rose-100 bg-rose-50/90 p-4 text-center">
            <p className="text-sm text-rose-700">{error}</p>
            <button type="button" onClick={retry} className="mt-2 rounded-full bg-rose-600 px-4 py-1.5 text-xs font-semibold text-white">
              Try again
            </button>
          </div>
        ) : loading ? (
          <NotificationSkeleton />
        ) : items.length === 0 ? (
          <NotificationEmptyState filter={filter} />
        ) : (
          <div className="space-y-2.5">
            <AnimatePresence initial={false}>
              {items.map((notification) => (
                <NotificationItem
                  key={notification.id}
                  notification={notification}
                  onOpen={openNotification}
                  onDismiss={dismiss}
                />
              ))}
            </AnimatePresence>
            {hasMore ? (
              <button
                type="button"
                onClick={loadMore}
                disabled={loadingMore}
                className="flex w-full items-center justify-center gap-1.5 rounded-full border border-white/70 bg-white/70 py-2.5 text-xs font-semibold text-slate-600 backdrop-blur transition hover:bg-white disabled:opacity-60"
              >
                {loadingMore ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ChevronDown className="h-3.5 w-3.5" />}
                {loadingMore ? "Loading…" : "Show more"}
              </button>
            ) : null}
          </div>
        )}
      </div>
    </>
  );
}

export default function NotificationPanel() {
  const { panelOpen, closePanel } = useNotifications();
  const { role } = useAuth();
  const isClient = role === "client";
  const [view, setView] = useState("list");
  const panelRef = useRef(null);

  useEffect(() => {
    if (panelOpen) {
      setView("list");
      window.setTimeout(() => panelRef.current?.focus(), 60);
    }
  }, [panelOpen]);

  useEffect(() => {
    if (!panelOpen) return undefined;
    function onKeyDown(event) {
      if (event.key === "Escape") closePanel();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [panelOpen, closePanel]);

  if (typeof document === "undefined") return null;

  const sheet = isClient;

  return createPortal(
    <AnimatePresence>
      {panelOpen ? (
        <motion.div
          key="notification-overlay"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.16 }}
          className={`fixed inset-0 z-[300] bg-slate-950/20 backdrop-blur-[2px] ${sheet ? "flex items-end justify-center" : ""}`}
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closePanel();
          }}
        >
          <motion.aside
            ref={panelRef}
            tabIndex={-1}
            role="dialog"
            aria-modal="true"
            aria-label="Notifications"
            initial={sheet ? { y: "100%" } : { x: 40, opacity: 0, scale: 0.98 }}
            animate={sheet ? { y: 0 } : { x: 0, opacity: 1, scale: 1 }}
            exit={sheet ? { y: "100%" } : { x: 40, opacity: 0, scale: 0.98 }}
            transition={{ type: "spring", stiffness: 380, damping: 36 }}
            className={
              sheet
                ? "flex max-h-[88dvh] min-h-[55dvh] w-full max-w-[520px] flex-col overflow-hidden rounded-t-[1.9rem] border border-white/70 bg-gradient-to-b from-white/95 to-slate-50/95 pb-[max(env(safe-area-inset-bottom),0.5rem)] shadow-[0_-20px_70px_rgba(15,23,42,0.28)] backdrop-blur-2xl outline-none"
                : "fixed bottom-3 right-3 top-3 flex w-[min(430px,calc(100vw-24px))] flex-col overflow-hidden rounded-[1.9rem] border border-white/70 bg-gradient-to-b from-white/92 to-slate-50/92 shadow-[0_30px_90px_rgba(15,23,42,0.28)] backdrop-blur-2xl outline-none"
            }
          >
            {sheet ? <div className="mx-auto mt-2.5 h-1.5 w-11 shrink-0 rounded-full bg-slate-300/80" /> : null}
            <PanelBody view={view} setView={setView} isClient={isClient} />
          </motion.aside>
        </motion.div>
      ) : null}
    </AnimatePresence>,
    document.body,
  );
}
