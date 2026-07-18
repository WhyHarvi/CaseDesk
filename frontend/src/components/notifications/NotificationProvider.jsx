import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
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

const NotificationContext = createContext(null);
const POLL_MS = 45_000;

// actionUrls the backend can emit that have no matching frontend route yet
const PATH_REWRITES = {};

export function NotificationProvider({ children }) {
  const { isAuthenticated, role } = useAuth();
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
  const filterRef = useRef(filter);
  filterRef.current = filter;

  const refreshUnreadCount = useCallback(async () => {
    try {
      setUnreadCount(await getUnreadNotificationCount());
    } catch {
      /* polling failure is silent; next tick retries */
    }
  }, []);

  const loadPage = useCallback(async (page, activeFilter, { append = false } = {}) => {
    const setBusy = append ? setLoadingMore : setLoading;
    setBusy(true);
    setError("");
    try {
      const response = await getNotifications({ page, unread: activeFilter === "unread" });
      setItems((current) => (append ? [...current, ...response.data] : response.data));
      setMeta({ page: response.meta.page, total: response.meta.total });
      setUnreadCount(response.meta.unread);
    } catch {
      setError("Notifications could not be loaded.");
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    if (!isAuthenticated) {
      setItems([]);
      setUnreadCount(0);
      setPanelOpen(false);
      return undefined;
    }
    refreshUnreadCount();
    const interval = window.setInterval(refreshUnreadCount, POLL_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") refreshUnreadCount();
    };
    window.addEventListener("focus", refreshUnreadCount);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", refreshUnreadCount);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [isAuthenticated, refreshUnreadCount]);

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
        return { ...item, readAt: read ? item.readAt || new Date().toISOString() : null };
      }),
    );
    const wasUnread = previous && !previous.readAt;
    if (read && wasUnread) setUnreadCount((count) => Math.max(0, count - 1));
    if (!read && previous?.readAt) setUnreadCount((count) => count + 1);
    try {
      await markNotificationRead(id, read);
    } catch {
      if (previous) setItems((current) => current.map((item) => (item.id === id ? previous : item)));
      if (read && wasUnread) setUnreadCount((count) => count + 1);
      if (!read && previous?.readAt) setUnreadCount((count) => Math.max(0, count - 1));
    } finally {
      pendingRef.current.delete(id);
    }
  }, []);

  const markAllRead = useCallback(async () => {
    const previousItems = items;
    const previousCount = unreadCount;
    const now = new Date().toISOString();
    setItems((current) => current.map((item) => (item.readAt ? item : { ...item, readAt: now })));
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
      setMeta((current) => ({ ...current, total: Math.max(0, current.total - 1) }));
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
      const path = safe ? PATH_REWRITES[raw] || raw : homePathForRole(role);
      const clientSafe = role === "client" && !path.startsWith("/client-portal") ? "/client-portal" : path;
      navigate(clientSafe);
    },
    [markRead, navigate, role],
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
    [items, unreadCount, meta, filter, loading, loadingMore, error, panelOpen, openPanel, closePanel, changeFilter, loadMore, markRead, markAllRead, dismiss, openNotification, loadPage],
  );

  return <NotificationContext.Provider value={value}>{children}</NotificationContext.Provider>;
}

export function useNotifications() {
  const value = useContext(NotificationContext);
  if (!value) throw new Error("useNotifications must be used inside NotificationProvider");
  return value;
}
