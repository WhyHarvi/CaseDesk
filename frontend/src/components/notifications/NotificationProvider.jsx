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
  getUnreadNotificationCount,
  markAllNotificationsRead,
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

export function NotificationProvider({ children }) {
  const { isAuthenticated, role, membership } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const [items, setItems] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [meta, setMeta] = useState({ page: 1, total: 0 });
  const [filter, setFilter] = useState("all");
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
          unread: activeFilter === "unread",
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
        const count = await getUnreadNotificationCount();
        if (stopped) return;
        setUnreadCount(count);
        channel?.postMessage({ type: "unread-count", count });
      } catch {
        /* polling failure is silent; next tick or focus retries */
      }
    };
    if (channel) {
      channel.onmessage = (event) => {
        if (
          event.data?.type === "unread-count" &&
          Number.isFinite(event.data.count)
        ) {
          setUnreadCount(event.data.count);
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
    const wasUnread = previous && !previous.readAt;
    if (read && wasUnread) setUnreadCount((count) => Math.max(0, count - 1));
    if (!read && previous?.readAt) setUnreadCount((count) => count + 1);
    try {
      await markNotificationRead(id, read);
    } catch {
      if (previous)
        setItems((current) =>
          current.map((item) => (item.id === id ? previous : item)),
        );
      if (read && wasUnread) setUnreadCount((count) => count + 1);
      if (!read && previous?.readAt)
        setUnreadCount((count) => Math.max(0, count - 1));
    } finally {
      pendingRef.current.delete(id);
    }
  }, []);

  const markAllRead = useCallback(async () => {
    const previousItems = items;
    const previousCount = unreadCount;
    const now = new Date().toISOString();
    setItems((current) =>
      current.map((item) => (item.readAt ? item : { ...item, readAt: now })),
    );
    setUnreadCount(0);
    try {
      await markAllNotificationsRead();
    } catch {
      setItems(previousItems);
      setUnreadCount(previousCount);
      setError("Could not mark everything as read. Please try again.");
    }
  }, [items, unreadCount]);

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
    const wasUnread = removed && !removed.readAt;
    if (wasUnread) setUnreadCount((count) => Math.max(0, count - 1));
    try {
      await dismissNotification(id);
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

  const openNotification = useCallback(
    (notification) => {
      if (!notification.readAt) markRead(notification.id, true);
      setPanelOpen(false);
      const raw = String(notification.actionUrl || "");
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
      openNotification,
      retry: () => loadPage(1, filterRef.current),
    }),
    [
      items,
      unreadCount,
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
