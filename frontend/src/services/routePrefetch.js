import api from "./api";

const warmupHandles = new Set();
let warmupGeneration = 0;

function preloadRouteModule(path) {
  const pathname = String(path || "").split("?")[0];
  const loaders = {
    "/app/dashboard": () => import("../pages/Dashboard"),
    "/app/clients": () => import("../pages/Clients"),
    "/app/cases": () => import("../pages/Cases"),
    "/app/follow-ups": () => import("../pages/FollowUps"),
    "/app/documents": () => import("../pages/Documents"),
    "/app/calendar": () => import("../pages/CalendarPage"),
    "/app/workload": () => import("../pages/Workload"),
    "/app/team-members": () => import("../pages/TeamMembers"),
    "/app/settings": () => import("../pages/Settings"),
    "/leads": () => import("../modules/leads/pages/LeadsPage"),
    "/lead-dashboard": () => import("../modules/leads/pages/LeadDashboardPage"),
  };
  void loaders[pathname]?.().catch(() => {});
}

function calendarRange() {
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const start = new Date(monthStart);
  start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
  const end = new Date(start);
  end.setDate(end.getDate() + 42);
  const params = new URLSearchParams({ from: start.toISOString(), to: end.toISOString() });
  return `/booking/calendar?${params.toString()}`;
}

function requestsFor(path, role) {
  const pathname = String(path || "").split("?")[0];
  if (pathname === "/app/dashboard") return [["/dashboard"]];
  if (pathname === "/app/clients") return [["/clients?limit=100"], ["/leads/staff"]];
  if (pathname === "/app/cases") return [["/cases", { params: { view: "active" } }], ["/clients"], ["/leads/staff"], ["/client-documents"], ["/payments"]];
  if (pathname === "/app/follow-ups") return [
    ["/follow-ups/combined"],
    ["/follow-ups/options"],
  ];
  if (pathname === "/app/documents") return [["/client-documents"], ["/clients"], ["/cases"]];
  if (pathname === "/app/calendar") return [[calendarRange()], ["/booking/settings"], ...(role === "consultant" ? [] : [["/leads/staff"]])];
  if (pathname === "/app/workload") return [[role === "admin" ? "/admin/consultants/workload" : "/consultants/me/workload"]];
  if (pathname === "/leads") return [["/leads"], ["/leads/sources"], ["/leads/staff"]];
  if (pathname === "/lead-dashboard") return [["/leads/dashboard"], ["/leads/staff"]];
  if (pathname === "/app/team-members") return [["/admin/team-members"]];
  return [];
}

export function prefetchRoute(path, role) {
  preloadRouteModule(path);
  for (const [url, config] of requestsFor(path, role)) {
    void api.get(url, config).catch(() => {});
  }
}

function scheduleWarmup(callback, delay) {
  const handle = window.setTimeout(() => {
    warmupHandles.delete(handle);
    if ("requestIdleCallback" in window) {
      const idleRecord = { idleHandle: null };
      idleRecord.idleHandle = window.requestIdleCallback((deadline) => {
        warmupHandles.delete(idleRecord);
        callback(deadline);
      }, { timeout: 2_000 });
      warmupHandles.add(idleRecord);
    } else {
      callback();
    }
  }, delay);
  warmupHandles.add(handle);
}

export function cancelAppWarmup() {
  warmupGeneration += 1;
  for (const handle of warmupHandles) {
    if (typeof handle === "number") window.clearTimeout(handle);
    else if (handle && "idleHandle" in handle && "cancelIdleCallback" in window) window.cancelIdleCallback(handle.idleHandle);
  }
  warmupHandles.clear();
}

export function warmAppCache(role) {
  cancelAppWarmup();
  const generation = warmupGeneration;
  const home = role === "frontdesk" ? "/leads" : "/app/dashboard";
  // Authentication already releases the current route, whose page fetches
  // its own data immediately. Starting the home route's API requests here
  // created an unrelated request burst on hard reloads (for example a
  // consultant opening /leads also fetched /dashboard). Only preload the
  // route code; sidebar intent prefetch remains responsible for API data.
  preloadRouteModule(home);

  // Deliberately minimal: with real-world API latency, bulk-warming every
  // route saturates the browser's 6-connections-per-origin budget and slows
  // the page the user is actually on. Sidebar hover/focus prefetch covers
  // the rest right before navigation.
  scheduleWarmup(() => {
    if (generation === warmupGeneration) preloadRouteModule("/app/calendar");
  }, 1500);
}
