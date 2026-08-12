import api from "../services/api";

export function getMyColleagues(query = "") {
  return api
    .get(`/internal-chat/colleagues${query ? `?q=${encodeURIComponent(query)}` : ""}`)
    .then((response) => response.data.data);
}

export function getInternalChatThreads() {
  return api.get("/internal-chat/threads").then((response) => response.data.data);
}

export function createInternalChatThread({ participantUserIds, name }) {
  return api
    .post("/internal-chat/threads", { participantUserIds, name })
    .then((response) => response.data.data);
}

export function getInternalChatThread(threadId) {
  return api.get(`/internal-chat/threads/${threadId}?limit=200`).then((response) => response.data.data);
}

export function getInternalChatRealtimeConfig(threadId) {
  return api.get(`/internal-chat/threads/${threadId}/realtime`).then((response) => response.data.data);
}

export function markInternalChatThreadRead(threadId) {
  return api.post(`/internal-chat/threads/${threadId}/read`).catch(() => {});
}

export function sendInternalChatMessage(threadId, { bodyText, clientMessageId, hasAttachment, replyToId }) {
  return api
    .post(`/internal-chat/threads/${threadId}/messages`, { bodyText, clientMessageId, hasAttachment, replyToId }, { timeout: 20_000 })
    .then((response) => response.data.data);
}

export function updateInternalChatMessage(threadId, messageId, bodyText) {
  return api
    .patch(`/internal-chat/threads/${threadId}/messages/${messageId}`, { bodyText })
    .then((response) => response.data.data);
}

export function deleteInternalChatMessage(threadId, messageId) {
  return api.delete(`/internal-chat/threads/${threadId}/messages/${messageId}`);
}

export function toggleInternalChatReaction(threadId, messageId, emoji) {
  return api
    .post(`/internal-chat/threads/${threadId}/messages/${messageId}/reactions`, { emoji })
    .then((response) => response.data.data);
}

export function uploadInternalChatAttachment(threadId, messageId, file) {
  const data = new FormData();
  data.append("file", file);
  return api
    .post(`/internal-chat/threads/${threadId}/messages/${messageId}/attachments`, data, { timeout: 60_000 })
    .then((response) => response.data.data);
}

export function fetchInternalChatAttachmentBlob(threadId, attachmentId) {
  return api
    .get(`/internal-chat/threads/${threadId}/attachments/${attachmentId}/file`, { responseType: "blob" })
    .then((response) => response.data);
}

// name and/or avatarFile — either can be omitted to leave that part alone.
export function updateInternalChatThread(threadId, { name, avatarFile } = {}) {
  const data = new FormData();
  if (name !== undefined) data.append("name", name);
  if (avatarFile) data.append("avatar", avatarFile);
  return api.patch(`/internal-chat/threads/${threadId}`, data, { timeout: 60_000 }).then((response) => response.data.data);
}

export function fetchInternalChatThreadAvatarBlob(threadId) {
  return api.get(`/internal-chat/threads/${threadId}/avatar`, { responseType: "blob" }).then((response) => response.data);
}

export function addInternalChatParticipants(threadId, userIds) {
  return api.post(`/internal-chat/threads/${threadId}/participants`, { userIds });
}

export function removeInternalChatParticipant(threadId, userId) {
  return api.delete(`/internal-chat/threads/${threadId}/participants/${userId}`);
}

export function internalChatErrorMessage(reason, fallback) {
  return reason?.response?.data?.message || fallback;
}
