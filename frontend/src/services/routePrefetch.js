import api from "./api";

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
  if (pathname === "/app/follow-ups") return [["/follow-ups"], ["/clients"], ["/cases"], ["/leads/staff"]];
  if (pathname === "/app/documents") return [["/client-documents"], ["/clients"], ["/cases"]];
  if (pathname === "/app/calendar") return [[calendarRange()], ["/booking/settings"], ...(role === "consultant" ? [] : [["/leads/staff"]])];
  if (pathname === "/app/workload") return [[role === "admin" ? "/admin/consultants/workload" : "/consultants/me/workload"]];
  if (pathname === "/leads") return [["/leads"], ["/leads/sources"], ["/leads/staff"]];
  if (pathname === "/lead-dashboard") return [["/leads/dashboard"], ["/leads/staff"]];
  if (pathname === "/app/team-members") return [["/admin/team-members"]];
  return [];
}

export function prefetchRoute(path, role) {
  for (const [url, config] of requestsFor(path, role)) {
    void api.get(url, config).catch(() => {});
  }
}
