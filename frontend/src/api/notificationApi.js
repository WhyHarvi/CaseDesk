import api from "../services/api";

export async function getNotifications({ page = 1, limit = 25, unread = false, view = "action" } = {}) {
  const params = new URLSearchParams({ page: String(page), limit: String(limit) });
  params.set("view", view);
  if (unread) params.set("unread", "true");
  const response = await api.get(`/notifications?${params.toString()}`);
  return response.data;
}

export async function getUnreadNotificationCount() {
  const response = await api.get("/notifications/unread-count");
  return response.data.data.unread;
}

export async function getSidebarNotificationCounts(caseId = "") {
  const params = new URLSearchParams();
  if (caseId) params.set("caseId", caseId);
  const suffix = params.size ? `?${params.toString()}` : "";
  const response = await api.get(`/notifications/sidebar-counts${suffix}`);
  return response.data.data;
}

export async function markDestinationUpdatesRead(values) {
  const response = await api.post("/notifications/sidebar-counts/read", values);
  return response.data.data;
}

export async function markNotificationRead(id, read = true) {
  const response = await api.patch(`/notifications/${id}/read`, { read });
  return response.data.data;
}

export async function markAllNotificationsRead() {
  const response = await api.post("/notifications/read-all");
  return response.data.data;
}

export async function dismissNotification(id) {
  const response = await api.patch(`/notifications/${id}/dismiss`);
  return response.data.data;
}

export async function getNotificationPreferences() {
  const response = await api.get("/notifications/preferences");
  return response.data.data;
}

export async function updateNotificationPreference(category, values) {
  const response = await api.put(`/notifications/preferences/${category}`, values);
  return response.data.data;
}
