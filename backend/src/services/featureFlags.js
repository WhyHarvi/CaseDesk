import prisma from "./prisma/client.js";

// A small registry of the flags that used to be (or still are) hardcoded
// consts scattered through the backend — e.g. lead.retainer.service.js's
// RETAINER_AUTOSEND_ENABLED. Centralizing the list here means the developer
// portal can enumerate and toggle them without each flag needing its own
// bespoke settings UI. Every flag keeps its original hardcoded value as
// `fallback` — a missing DeveloperSetting row (or a fresh environment with
// no migration run yet) behaves exactly like the old hardcoded const did.
export const FEATURE_FLAGS = [
  {
    key: "RETAINER_AUTOSEND_ENABLED",
    label: "Automatic retainer sending",
    description: "When a lead's first consultation is booked or confirmed, automatically create a client/case and email + text them a retainer to e-sign. Paused since it was flipped off in code.",
    fallback: false,
  },
];

const FLAG_BY_KEY = new Map(FEATURE_FLAGS.map((flag) => [flag.key, flag]));

// Short in-process cache — every call site of an autosend-style flag runs
// on a hot path (a booking just happened), so this avoids a DB round trip
// per trigger without needing a real cache layer for a handful of rows.
const CACHE_TTL_MS = 15_000;
let cache = null;
let cacheExpiresAt = 0;

async function loadAll() {
  if (cache && Date.now() < cacheExpiresAt) return cache;
  const rows = await prisma.developerSetting.findMany();
  cache = new Map(rows.map((row) => [row.key, row.value]));
  cacheExpiresAt = Date.now() + CACHE_TTL_MS;
  return cache;
}

function parseBoolean(value, fallback) {
  if (value === undefined || value === null) return fallback;
  return value === "true";
}

export async function isFeatureEnabled(key) {
  const flag = FLAG_BY_KEY.get(key);
  const fallback = flag ? flag.fallback : false;
  const values = await loadAll();
  return parseBoolean(values.get(key), fallback);
}

export async function listFeatureFlags() {
  const values = await loadAll();
  const rows = await prisma.developerSetting.findMany({ where: { key: { in: FEATURE_FLAGS.map((flag) => flag.key) } }, select: { key: true, updatedAt: true, updatedBy: { select: { fullName: true } } } });
  const rowByKey = new Map(rows.map((row) => [row.key, row]));
  return FEATURE_FLAGS.map((flag) => ({
    ...flag,
    enabled: parseBoolean(values.get(flag.key), flag.fallback),
    updatedAt: rowByKey.get(flag.key)?.updatedAt || null,
    updatedByName: rowByKey.get(flag.key)?.updatedBy?.fullName || null,
  }));
}

export async function setFeatureFlag(key, enabled, updatedById) {
  if (!FLAG_BY_KEY.has(key)) throw new Error(`Unknown feature flag: ${key}`);
  await prisma.developerSetting.upsert({
    where: { key },
    create: { key, value: String(Boolean(enabled)), updatedById },
    update: { value: String(Boolean(enabled)), updatedById },
  });
  cacheExpiresAt = 0; // next read repopulates rather than trusting a stale cache
}
