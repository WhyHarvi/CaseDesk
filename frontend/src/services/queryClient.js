import { QueryClient } from "@tanstack/react-query";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60_000,
      gcTime: 30 * 60_000,
      retry: (failureCount, error) => {
        const status = error?.response?.status;
        return failureCount < 2 && (!status || status >= 500);
      },
      refetchOnWindowFocus: false,
      refetchOnReconnect: true,
    },
    mutations: { retry: false },
  },
});

let activeApiScope = "anonymous";

export function setApiCacheScope(userId, agencyId) {
  const next = userId ? `${userId}:${agencyId || "no-agency"}` : "anonymous";
  if (next !== activeApiScope) queryClient.clear();
  activeApiScope = next;
}

export function getApiCacheScope() {
  return activeApiScope;
}

const NO_CACHE_PATHS = [
  "/auth/",
  "/notifications",
  "/public/",
  "/client-communication/",
  "/communications/",
  "/internal-chat/",
  "/ooma-calls",
  "/twilio-calls",
];

function pathOnly(url) {
  return String(url || "").split("?")[0];
}

export function shouldCacheGet(url, config = {}) {
  if (config.cache === false || config.responseType === "blob") return false;
  const path = pathOnly(url);
  return !NO_CACHE_PATHS.some((prefix) => path.startsWith(prefix));
}

export function staleTimeFor(url) {
  const path = pathOnly(url);
  if (path.includes("/settings") || path.includes("/staff") || path.includes("/team")) return 5 * 60_000;
  // Incentive figures are expensive to compute (per-case attribution and
  // timeline projection) and don't need to track real-time activity —
  // explicit invalidation below (payments/cases/incentive-plans mutating)
  // already refreshes them promptly when something that actually changes
  // the numbers happens, so this mainly protects against recomputing on
  // every plain page revisit.
  if (path.includes("/incentives") || path.includes("/incentive-plans")) return 2 * 60_000;
  if (path.includes("/dashboard") || path.includes("/workload") || path.includes("/reports")) return 30_000;
  if (path.includes("/calendar") || path.includes("/appointments")) return 30_000;
  if (path.includes("/clients") || path.includes("/cases") || path.includes("/documents") || path.includes("/follow-ups") || path.includes("/payments") || path.includes("/leads")) return 90_000;
  return 60_000;
}

export function apiQueryKey(scope, url, config = {}) {
  return [
    "api",
    scope || "anonymous",
    String(url),
    config.params || null,
    config.responseType || "json",
  ];
}

const RELATED_PATHS = {
  appointments: ["appointments", "calendar", "booking", "dashboard", "workload", "cases"],
  booking: ["appointments", "calendar", "booking", "dashboard", "workload"],
  clients: ["clients", "cases", "dashboard", "workload", "documents", "follow-ups", "payments"],
  // Case mutations cover role-assignment changes (RCIC/Case Worker/Frontdesk)
  // and case creation/reassignment, both of which change who incentive
  // credit follows — "incentives" rides along the same way "workload"
  // already does for the same reason.
  cases: ["cases", "clients", "dashboard", "workload", "documents", "follow-ups", "payments", "appointments", "incentives"],
  "follow-ups": ["follow-ups", "cases", "clients", "dashboard", "workload"],
  documents: ["documents", "client-documents", "written-documents", "cases", "clients", "dashboard", "workload"],
  "client-documents": ["documents", "client-documents", "written-documents", "cases", "clients", "dashboard", "workload"],
  "written-documents": ["documents", "client-documents", "written-documents", "cases", "clients", "dashboard", "workload"],
  // Recording/voiding a payment is exactly what moves the incentive ledger
  // and pipeline numbers — without this, a just-recorded payment wouldn't
  // show up until the 2-minute stale time lapsed on its own.
  payments: ["payments", "cases", "clients", "dashboard", "incentives"],
  leads: ["leads", "dashboard", "workload", "clients", "cases"],
  "ooma-calls": ["ooma-calls", "leads", "clients", "communications", "follow-ups", "dashboard", "workload"],
  "twilio-calls": ["twilio-calls", "ooma-calls", "leads", "clients", "communications", "follow-ups"],
  settings: ["settings", "booking", "staff", "team"],
  // Empty, not absent — the heartbeat ping fires up to once a minute per
  // active user and invalidates nothing of its own. An absent key here
  // falls through to the "no related list = invalidate everything"
  // fallback below, which would otherwise blow away every cached query in
  // the app on every ping.
  workload: [],
  incentives: ["incentives"],
  // Saving/activating/deactivating a plan changes future attribution and
  // formulas — scoped to incentives/settings rather than falling through to
  // "no related list = invalidate everything" (the pre-existing default for
  // any resource prefix not listed here).
  "incentive-plans": ["incentives", "incentive-plans", "settings"],
};

function resourceFor(url) {
  return pathOnly(url).split("/").filter(Boolean)[0] || "";
}

export function invalidateApiCache(url, scope) {
  const related = RELATED_PATHS[resourceFor(url)];
  const filters = {
    predicate: (query) => {
      const [kind, queryScope, queryUrl] = query.queryKey;
      if (kind !== "api" || queryScope !== scope) return false;
      if (!related) return true;
      const queryPath = pathOnly(queryUrl);
      return related.some((segment) => queryPath.includes(`/${segment}`));
    },
  };

  // Active screens refetch immediately after a successful write. Inactive
  // entries are removed so the next visit cannot render an obsolete snapshot.
  const activeRefetch = queryClient.invalidateQueries({ ...filters, refetchType: "active" });
  queryClient.removeQueries({ ...filters, type: "inactive" });
  if (["booking", "appointments", "calendar"].includes(resourceFor(url))) {
    const schedulingDashboard = { predicate: (query) => query.queryKey[0] === "dashboard" && ["appointment-registry", "appointment-detail", "scheduling-analytics", "booking-waitlist"].includes(query.queryKey[1]) };
    queryClient.invalidateQueries({ ...schedulingDashboard, refetchType: "active" });
    queryClient.removeQueries({ ...schedulingDashboard, type: "inactive" });
  }
  return activeRefetch;
}

export function clearApiCache() {
  queryClient.clear();
  activeApiScope = "anonymous";
}
