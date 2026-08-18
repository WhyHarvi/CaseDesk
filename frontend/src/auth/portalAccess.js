export const portalPageKeys = [
  "dashboard",
  "leads",
  "leadIntake",
  "clients",
  "cases",
  "followUps",
  "calendar",
  "documents",
  "payments",
  "workload",
  "caseEasyImport",
  "incentives",
];
export const portalCaseTabKeys = [
  "profile",
  "reminders",
  "questionnaires",
  "documents",
  "forms",
  "tasks",
  "agreementsLetters",
  "appointments",
  "communication",
  "billing",
];
export const portalCapabilityKeys = [
  "internalNotes",
  "financialData",
  "manageClientPortal",
];
export const portalDataKeys = ["leads", "clients", "cases"];

const all = (keys, value) =>
  Object.fromEntries(keys.map((key) => [key, value]));

export function defaultPortalAccess(role) {
  if (role === "admin")
    return {
      version: 1,
      pages: all(portalPageKeys, true),
      caseTabs: all(portalCaseTabKeys, true),
      data: { leads: "all", clients: "all", cases: "all" },
      capabilities: all(portalCapabilityKeys, true),
    };
  if (role === "frontdesk")
    return {
      version: 1,
      pages: {
        ...all(portalPageKeys, false),
        leads: true,
        calendar: true,
        caseEasyImport: true,
        incentives: true,
      },
      caseTabs: all(portalCaseTabKeys, false),
      data: { leads: "all", clients: "none", cases: "none" },
      capabilities: all(portalCapabilityKeys, false),
    };
  return {
    version: 1,
    pages: {
      ...all(portalPageKeys, false),
      dashboard: true,
      leads: true,
      leadIntake: true,
      clients: true,
      cases: true,
      followUps: true,
      calendar: true,
      documents: true,
      workload: true,
      caseEasyImport: true,
      incentives: true,
    },
    caseTabs: all(portalCaseTabKeys, true),
    data: { leads: "assigned", clients: "assigned", cases: "assigned" },
    capabilities: {
      ...all(portalCapabilityKeys, false),
      internalNotes: true,
      financialData: true,
      manageClientPortal: true,
    },
  };
}

export function getPortalAccess(role, permissions = {}) {
  if (role === "admin") return defaultPortalAccess(role);
  const defaults = defaultPortalAccess(role);
  const saved = permissions?.portalAccess || {};
  return {
    version: 1,
    pages: { ...defaults.pages, ...(saved.pages || {}) },
    caseTabs: { ...defaults.caseTabs, ...(saved.caseTabs || {}) },
    data: { ...defaults.data, ...(saved.data || {}) },
    capabilities: {
      ...defaults.capabilities,
      ...(typeof permissions?.createClientPortal === "boolean"
        ? { manageClientPortal: permissions.createClientPortal }
        : {}),
      ...(saved.capabilities || {}),
    },
  };
}

export const canAccessPage = (role, permissions, page) =>
  role === "admin" || getPortalAccess(role, permissions).pages[page] === true;
export const canAccessCaseTab = (role, permissions, tab) =>
  role === "admin" || getPortalAccess(role, permissions).caseTabs[tab] === true;
export const hasCapability = (role, permissions, capability) =>
  role === "admin" ||
  getPortalAccess(role, permissions).capabilities[capability] === true;

export function homePathForAccess(role, permissions = {}) {
  if (role === "client") return "/client-portal";
  const access = getPortalAccess(role, permissions);
  const paths = [
    ["dashboard", "/app/dashboard"],
    ["leads", "/leads"],
    ["clients", "/app/clients"],
    ["cases", "/app/cases"],
    ["followUps", "/app/follow-ups"],
    ["calendar", "/app/calendar"],
    ["documents", "/app/documents"],
    ["workload", "/app/workload"],
    ["caseEasyImport", "/app/case-easy-import"],
  ];
  return paths.find(([key]) => access.pages[key])?.[1] || "/app/settings";
}
