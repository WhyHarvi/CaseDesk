export const NOTIFICATION_POLL_MS = 45_000;
export const NOTIFICATION_LEASE_TTL_MS = 2 * NOTIFICATION_POLL_MS + 5_000;

export function notificationLeaseKey(scope = "session") {
  return `casedesk.notifications.poller.v1:${scope}`;
}

export function notificationChannelName(scope = "session") {
  return `casedesk.notifications.v1:${scope}`;
}

export function createNotificationPollOwner() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `tab-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function readLease(storage, key) {
  try {
    const parsed = JSON.parse(storage?.getItem(key) || "null");
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

export function claimNotificationPollLease({
  storage,
  key,
  owner,
  now = Date.now(),
  ttlMs = NOTIFICATION_LEASE_TTL_MS,
}) {
  if (!storage) return true;
  try {
    const current = readLease(storage, key);
    if (
      current?.owner &&
      current.owner !== owner &&
      Number(current.expiresAt) > now
    ) {
      return false;
    }
    storage.setItem(key, JSON.stringify({ owner, expiresAt: now + ttlMs }));
    return readLease(storage, key)?.owner === owner;
  } catch {
    // Privacy settings can disable localStorage. Polling remains functional,
    // but cross-tab coordination is unavailable in that browser.
    return true;
  }
}

export function releaseNotificationPollLease({ storage, key, owner }) {
  if (!storage) return;
  try {
    if (readLease(storage, key)?.owner === owner) storage.removeItem(key);
  } catch {
    /* localStorage is best-effort coordination only */
  }
}
