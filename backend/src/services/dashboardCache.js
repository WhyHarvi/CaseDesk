const DEFAULT_TTL_MS = 5 * 60_000;
const MAX_ENTRIES = 500;
const entries = new Map();

function ttlMs() {
  const configured = Number(process.env.DASHBOARD_CACHE_TTL_MS);
  return Number.isFinite(configured) && configured >= 10_000
    ? Math.min(configured, 30 * 60_000)
    : DEFAULT_TTL_MS;
}

export function dashboardCacheKey(auth) {
  return `${auth.agencyId}:${auth.userId}:${auth.role}`;
}

export function getCachedDashboard(key, now = Date.now()) {
  const entry = entries.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= now) {
    entries.delete(key);
    return null;
  }
  return entry.data;
}

export function setCachedDashboard(key, data, now = Date.now()) {
  if (entries.size >= MAX_ENTRIES && !entries.has(key)) {
    const oldestKey = entries.keys().next().value;
    if (oldestKey) entries.delete(oldestKey);
  }
  entries.delete(key);
  entries.set(key, { data, expiresAt: now + ttlMs() });
}

export function invalidateDashboardCache(agencyId) {
  if (!agencyId) return;
  const prefix = `${agencyId}:`;
  for (const key of entries.keys()) {
    if (key.startsWith(prefix)) entries.delete(key);
  }
}

export function clearDashboardCache() {
  entries.clear();
}
