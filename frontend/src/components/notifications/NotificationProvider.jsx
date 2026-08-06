import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../../auth/AuthContext";
import { homePathForRole } from "../../auth/AuthRoutes";
import {
  dismissNotification,
  getNotifications,
  getSidebarNotificationCounts,
  markAllNotificationsRead,
  markDestinationUpdatesRead,
  markNotificationRead,
} from "../../api/notificationApi";
import {
  NOTIFICATION_POLL_MS,
  claimNotificationPollLease,
  createNotificationPollOwner,
  notificationChannelName,
  notificationLeaseKey,
  releaseNotificationPollLease,
} from "../../services/notificationPolling";

const NotificationContext = createContext(null);

// actionUrls the backend can emit that have no matching frontend route yet
const PATH_REWRITES = {};

export function actionPathForNotification(notification) {
  const metadata = notification?.metadata || {};
  const type = String(notification?.type || "");
  const refundReceiptId =
    metadata.refundReceiptId ||
    (notification?.entityType === "quickBooksRefundReceipt"
      ? notification.entityId
      : null);
  if (
    refundReceiptId &&
    [
      "booking_payment.refund_unmatched",
      "booking_payment.refund_ambiguous",
    ].includes(type)
  ) {
    return `/app/payments?source=booking_payment&refund=${encodeURIComponent(refundReceiptId)}`;
  }
  const holdId =
    metadata.holdId ||
    metadata.paymentHoldId ||
    (notification?.entityType === "bookingPaymentHold"
      ? notification.entityId
      : null);
  if (type === "booking_payment.orphaned" && holdId) {
    return `/app/payments?source=booking_payment&hold=${encodeURIComponent(holdId)}`;
  }
  if (type.startsWith("booking_payment.refunded") && metadata.appointmentId) {
    return `/app/calendar?appointment=${encodeURIComponent(metadata.appointmentId)}`;
  }
  if (notification?.entityType === "appointment" && notification.entityId) {
    return `/app/calendar?appointment=${encodeURIComponent(notification.entityId)}`;
  }
  if (notification?.entityType === "bookingPaymentHold" && holdId) {
    return `/app/payments?source=booking_payment&hold=${encodeURIComponent(holdId)}`;
  }
  if (notification?.entityType === "lead" && notification.entityId) {
    return `/leads?lead=${encodeURIComponent(notification.entityId)}`;
  }
  return String(notification?.actionUrl || "");
}

export function NotificationProvider({ children }) {
  const { isAuthenticated, role, membership } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const [items, setItems] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [sidebarCounts, setSidebarCounts] = useState({});
  const [meta, setMeta] = useState({ page: 1, total: 0 });
  const [filter, setFilter] = useState("action");
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const [panelOpen, setPanelOpen] = useState(false);
  const pendingRef = useRef(new Set());
  const pollOwnerRef = useRef(createNotificationPollOwner());
  const filterRef = useRef(filter);
  filterRef.current = filter;

  const loadPage = useCallback(
    async (page, activeFilter, { append = false } = {}) => {
      const setBusy = append ? setLoadingMore : setLoading;
      setBusy(true);
      setError("");
      try {
        const response = await getNotifications({
          page,
          view: activeFilter,
        });
        setItems((current) =>
          append ? [...current, ...response.data] : response.data,
        );
        setMeta({ page: response.meta.page, total: response.meta.total });
        setUnreadCount(response.meta.unread);
      } catch {
        setError("Notifications could not be loaded.");
      } finally {
        setBusy(false);
      }
    },
    [],
  );

  useEffect(() => {
    if (!isAuthenticated) {
      setItems([]);
      setUnreadCount(0);
      setSidebarCounts({});
      setPanelOpen(false);
      return undefined;
    }
    let stopped = false;
    const owner = pollOwnerRef.current;
    const scope = membership?.id || "session";
    const leaseKey = notificationLeaseKey(scope);
    let storage = null;
    let channel = null;
    try {
      storage = window.localStorage;
    } catch {
      /* cross-tab coordination is unavailable in restricted storage modes */
    }
    try {
      channel =
        typeof window.BroadcastChannel === "function"
          ? new window.BroadcastChannel(notificationChannelName(scope))
          : null;
    } catch {
      /* polling continues without cross-tab count broadcasts */
    }

    const releaseLease = () =>
      releaseNotificationPollLease({ storage, key: leaseKey, owner });
    const refreshUnreadCount = async () => {
      if (stopped || document.visibilityState !== "visible") return;
      const ownsLease = claimNotificationPollLease({
        storage,
        key: leaseKey,
        owner,
      });
      if (!ownsLease) return;
      try {
        const result = await getSidebarNotificationCounts();
        if (stopped) return;
        setUnreadCount(result.unread || 0);
        setSidebarCounts(result.destinations || {});
        channel?.postMessage({ type: "sidebar-counts", unread: result.unread || 0, destinations: result.destinations || {} });
      } catch {
        /* polling failure is silent; next tick or focus retries */
      }
    };
    if (channel) {
      channel.onmessage = (event) => {
        if (
          event.data?.type === "sidebar-counts" &&
          Number.isFinite(event.data.unread)
        ) {
          setUnreadCount(event.data.unread);
          setSidebarCounts(event.data.destinations || {});
        }
      };
    }
    void refreshUnreadCount();
    const interval = window.setInterval(
      () => void refreshUnreadCount(),
      NOTIFICATION_POLL_MS,
    );
    const onVisible = () => {
      if (document.visibilityState === "visible") void refreshUnreadCount();
      else releaseLease();
    };
    const onFocus = () => void refreshUnreadCount();
    const onLeaseChanged = (event) => {
      if (
        event.key === leaseKey &&
        !event.newValue &&
        document.visibilityState === "visible"
      ) {
        void refreshUnreadCount();
      }
    };
    window.addEventListener("focus", onFocus);
    window.addEventListener("storage", onLeaseChanged);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      stopped = true;
      window.clearInterval(interval);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("storage", onLeaseChanged);
      document.removeEventListener("visibilitychange", onVisible);
      releaseLease();
      channel?.close();
    };
  }, [isAuthenticated, membership?.id]);

  const openPanel = useCallback(() => {
    setPanelOpen(true);
    loadPage(1, filterRef.current);
  }, [loadPage]);

  const closePanel = useCallback(() => setPanelOpen(false), []);

  const changeFilter = useCallback(
    (nextFilter) => {
      setFilter(nextFilter);
      loadPage(1, nextFilter);
    },
    [loadPage],
  );

  const loadMore = useCallback(() => {
    loadPage(meta.page + 1, filterRef.current, { append: true });
  }, [loadPage, meta.page]);

  const markRead = useCallback(async (id, read = true) => {
    if (pendingRef.current.has(id)) return;
    pendingRef.current.add(id);
    let previous;
    setItems((current) =>
      current.map((item) => {
        if (item.id !== id) return item;
        previous = item;
        return {
          ...item,
          readAt: read ? item.readAt || new Date().toISOString() : null,
        };
      }),
    );
    const wasUnread = previous && !previous.readAt && previous.attentionLevel === "action_required";
    if (read && wasUnread) setUnreadCount((count) => Math.max(0, count - 1));
    if (!read && previous?.readAt) setUnreadCount((count) => count + 1);
    try {
      await markNotificationRead(id, read);
      if (read && previous?.destinationKey) {
        setSidebarCounts((current) => {
          const count = current[previous.destinationKey];
          if (!count) return current;
          const kind = previous.attentionLevel === "action_required" ? "actions" : "updates";
          const nextKind = Math.max(0, count[kind] - 1);
          return { ...current, [previous.destinationKey]: { ...count, [kind]: nextKind, total: Math.max(0, count.total - 1) } };
        });
      }
    } catch {
      if (previous)
        setItems((current) =>
          current.map((item) => (item.id === id ? previous : item)),
        );
      if (read && wasUnread) setUnreadCount((count) => count + 1);
      if (!read && previous?.readAt && previous.attentionLevel === "action_required")
        setUnreadCount((count) => Math.max(0, count - 1));
    } finally {
      pendingRef.current.delete(id);
    }
  }, []);

  const markAllRead = useCallback(async () => {
    const previousItems = items;
    const previousCount = unreadCount;
    const previousSidebarCounts = sidebarCounts;
    const now = new Date().toISOString();
    setItems((current) =>
      current.map((item) => (item.readAt ? item : { ...item, readAt: now })),
    );
    setUnreadCount(0);
    setSidebarCounts((current) => Object.fromEntries(Object.entries(current).map(([key, count]) => [key, { ...count, actions: 0, updates: 0, total: 0 }])));
    try {
      await markAllNotificationsRead();
    } catch {
      setItems(previousItems);
      setUnreadCount(previousCount);
      setSidebarCounts(previousSidebarCounts);
      setError("Could not mark everything as read. Please try again.");
    }
  }, [items, sidebarCounts, unreadCount]);

  const dismiss = useCallback(async (id) => {
    if (pendingRef.current.has(id)) return;
    pendingRef.current.add(id);
    let removed;
    let removedIndex = -1;
    setItems((current) => {
      removedIndex = current.findIndex((item) => item.id === id);
      removed = current[removedIndex];
      return current.filter((item) => item.id !== id);
    });
    const wasUnread = removed && !removed.readAt && removed.attentionLevel === "action_required";
    if (wasUnread) setUnreadCount((count) => Math.max(0, count - 1));
    try {
      await dismissNotification(id);
      if (removed?.destinationKey) {
        setSidebarCounts((current) => {
          const count = current[removed.destinationKey];
          if (!count) return current;
          const kind = removed.attentionLevel === "action_required" ? "actions" : "updates";
          const nextKind = Math.max(0, count[kind] - 1);
          return { ...current, [removed.destinationKey]: { ...count, [kind]: nextKind, total: Math.max(0, count.total - 1) } };
        });
      }
      setMeta((current) => ({
        ...current,
        total: Math.max(0, current.total - 1),
      }));
    } catch {
      if (removed) {
        setItems((current) => {
          const next = [...current];
          next.splice(Math.min(removedIndex, next.length), 0, removed);
          return next;
        });
      }
      if (wasUnread) setUnreadCount((count) => count + 1);
      setError("Could not clear that notification. Please try again.");
    } finally {
      pendingRef.current.delete(id);
    }
  }, []);

  const acknowledgeDestination = useCallback(async (destinationKey, extra = {}) => {
    const current = sidebarCounts[destinationKey];
    if (!extra.caseId && !current?.total) return;
    if (!extra.caseId) {
      setSidebarCounts((counts) => ({
        ...counts,
        [destinationKey]: { ...counts[destinationKey], actions: 0, updates: 0, total: 0 },
      }));
      setUnreadCount((count) => Math.max(0, count - (current?.actions || 0)));
    }
    try {
      await markDestinationUpdatesRead({ destinationKey, ...extra });
      if (extra.caseId) {
        const result = await getSidebarNotificationCounts();
        setSidebarCounts(result.destinations || {});
        setUnreadCount(result.unread || 0);
      }
    } catch {
      try {
        const result = await getSidebarNotificationCounts();
        setSidebarCounts(result.destinations || {});
        setUnreadCount(result.unread || 0);
      } catch { /* the next poll will reconcile the badge */ }
    }
  }, [sidebarCounts]);

  const openNotification = useCallback(
    (notification) => {
      if (!notification.readAt) markRead(notification.id, true);
      setPanelOpen(false);
      const raw = actionPathForNotification(notification);
      const safe = raw.startsWith("/") && !raw.startsWith("//");
      const path = safe
        ? PATH_REWRITES[raw] || raw
        : homePathForRole(role, membership?.permissions);
      const clientSafe =
        role === "client" && !path.startsWith("/client-portal")
          ? "/client-portal"
          : path;
      navigate(clientSafe);
    },
    [markRead, membership?.permissions, navigate, role],
  );

  // Close the panel on route changes triggered elsewhere
  useEffect(() => {
    setPanelOpen(false);
  }, [location.pathname]);

  const value = useMemo(
    () => ({
      items,
      unreadCount,
      sidebarCounts,
      meta,
      hasMore: items.length < meta.total,
      filter,
      loading,
      loadingMore,
      error,
      panelOpen,
      openPanel,
      closePanel,
      changeFilter,
      loadMore,
      markRead,
      markAllRead,
      dismiss,
      acknowledgeDestination,
      openNotification,
      retry: () => loadPage(1, filterRef.current),
    }),
    [
      items,
      unreadCount,
      sidebarCounts,
      meta,
      filter,
      loading,
      loadingMore,
      error,
      panelOpen,
      openPanel,
      closePanel,
      changeFilter,
      loadMore,
      markRead,
      markAllRead,
      dismiss,
      acknowledgeDestination,
      openNotification,
      loadPage,
    ],
  );

  return (
    <NotificationContext.Provider value={value}>
      {children}
    </NotificationContext.Provider>
  );
}

export function useNotifications() {
  const value = useContext(NotificationContext);
  if (!value)
    throw new Error(
      "useNotifications must be used inside NotificationProvider",
    );
  return value;
}
