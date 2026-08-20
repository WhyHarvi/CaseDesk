import { createHttpError } from "../utils/http.js";

export const portalPageKeys = Object.freeze([
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
]);

export const portalCaseTabKeys = Object.freeze([
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
]);

export const portalCapabilityKeys = Object.freeze([
  "internalNotes",
  "financialData",
  "manageClientPortal",
]);

export const portalDataKeys = Object.freeze(["leads", "clients", "cases"]);
const dataScopes = new Set(["none", "assigned", "all"]);

const allTrue = (keys) => Object.fromEntries(keys.map((key) => [key, true]));
const allFalse = (keys) => Object.fromEntries(keys.map((key) => [key, false]));

export function defaultPortalAccess(role) {
  if (role === "admin") {
    return {
      version: 1,
      pages: allTrue(portalPageKeys),
      caseTabs: allTrue(portalCaseTabKeys),
      data: { leads: "all", clients: "all", cases: "all" },
      capabilities: allTrue(portalCapabilityKeys),
    };
  }
  if (role === "frontdesk") {
    return {
      version: 1,
      // Frontdesk needs to look up any client or case while working the
      // desk (walk-ins, phone calls, booking) — not just ones somehow
      // already "assigned" to them, which they normally never are. This is
      // view access, not edit: the write endpoints for existing clients and
      // cases (update/close/archive/delete, applicants, ledger, workflow)
      // stay role-gated to admin/consultant regardless of this data scope
      // — see clientRoutes.js and caseRoutes.js. Creating a brand-new
      // client or case (the front-desk intake flow) is unaffected, since
      // those endpoints were never scoped by data access in the first
      // place.
      pages: {
        ...allFalse(portalPageKeys),
        leads: true,
        clients: true,
        cases: true,
        calendar: true,
        caseEasyImport: true,
        // Off by default while the incentive-timeline feature is still
        // being validated against real staff activity — turn it back on
        // per-person from Settings > Team Members > Portal Access once
        // it's ready to roll out generally.
        incentives: false,
      },
      caseTabs: {
        ...allFalse(portalCaseTabKeys),
        profile: true,
      },
      data: { leads: "all", clients: "all", cases: "all" },
      capabilities: allFalse(portalCapabilityKeys),
    };
  }
  return {
    version: 1,
    pages: {
      ...allFalse(portalPageKeys),
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
      // Same reasoning as the frontdesk default above.
      incentives: false,
    },
    caseTabs: allTrue(portalCaseTabKeys),
    data: { leads: "assigned", clients: "assigned", cases: "assigned" },
    capabilities: {
      ...allFalse(portalCapabilityKeys),
      internalNotes: true,
      financialData: true,
      manageClientPortal: true,
    },
  };
}

function object(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};
}

export function normalizePortalAccess(role, value, legacyPermissions = {}) {
  const defaults = defaultPortalAccess(role);
  if (role === "admin") return defaults;
  const saved = object(value);
  const savedPages = object(saved.pages);
  const savedTabs = object(saved.caseTabs);
  const savedData = object(saved.data);
  const savedCapabilities = object(saved.capabilities);
  const normalized = {
    version: 1,
    pages: Object.fromEntries(
      portalPageKeys.map((key) => [
        key,
        typeof savedPages[key] === "boolean"
          ? savedPages[key]
          : defaults.pages[key],
      ]),
    ),
    caseTabs: Object.fromEntries(
      portalCaseTabKeys.map((key) => [
        key,
        typeof savedTabs[key] === "boolean"
          ? savedTabs[key]
          : defaults.caseTabs[key],
      ]),
    ),
    data: Object.fromEntries(
      portalDataKeys.map((key) => [
        key,
        dataScopes.has(savedData[key]) ? savedData[key] : defaults.data[key],
      ]),
    ),
    capabilities: Object.fromEntries(
      portalCapabilityKeys.map((key) => [
        key,
        typeof savedCapabilities[key] === "boolean"
          ? savedCapabilities[key]
          : defaults.capabilities[key],
      ]),
    ),
  };
  if (
    !Object.hasOwn(savedCapabilities, "manageClientPortal") &&
    typeof legacyPermissions.createClientPortal === "boolean"
  ) {
    normalized.capabilities.manageClientPortal =
      legacyPermissions.createClientPortal;
  }
  return normalized;
}

export function portalAccessForRequest(req) {
  const permissions = object(req.auth?.permissions);
  return normalizePortalAccess(
    req.auth?.role,
    permissions.portalAccess,
    permissions,
  );
}

export function hasPortalPageAccess(req, page) {
  if (!portalPageKeys.includes(page)) return false;
  return (
    req.auth?.role === "admin" ||
    portalAccessForRequest(req).pages[page] === true
  );
}

export function hasPortalCaseTabAccess(req, tab) {
  if (!portalCaseTabKeys.includes(tab)) return false;
  return (
    req.auth?.role === "admin" ||
    portalAccessForRequest(req).caseTabs[tab] === true
  );
}

export function hasPortalCapability(req, capability) {
  if (!portalCapabilityKeys.includes(capability)) return false;
  return (
    req.auth?.role === "admin" ||
    portalAccessForRequest(req).capabilities[capability] === true
  );
}

export function portalDataScope(req, domain) {
  if (req.auth?.role === "admin") return "all";
  return portalAccessForRequest(req).data[domain] || "none";
}

export function requirePortalPage(page) {
  return (req, res, next) =>
    hasPortalPageAccess(req, page)
      ? next()
      : res
          .status(403)
          .json({
            success: false,
            code: "PORTAL_ACCESS_DENIED",
            message:
              "Your workspace administrator has not enabled this area for your account.",
          });
}

export function requireAnyPortalPage(...pages) {
  return (req, res, next) =>
    pages.some((page) => hasPortalPageAccess(req, page))
      ? next()
      : res
          .status(403)
          .json({
            success: false,
            code: "PORTAL_ACCESS_DENIED",
            message:
              "Your workspace administrator has not enabled this area for your account.",
          });
}

export function requirePortalCaseTab(tab) {
  return (req, res, next) =>
    hasPortalCaseTabAccess(req, tab)
      ? next()
      : res
          .status(403)
          .json({
            success: false,
            code: "PORTAL_ACCESS_DENIED",
            message:
              "Your workspace administrator has not enabled this case area for your account.",
          });
}

export function requirePortalArea({
  pages = [],
  caseTabs = [],
  capabilities = [],
}) {
  return (req, res, next) => {
    const areaAllowed =
      pages.some((page) => hasPortalPageAccess(req, page)) ||
      caseTabs.some((tab) => hasPortalCaseTabAccess(req, tab));
    const capabilitiesAllowed = capabilities.every((capability) =>
      hasPortalCapability(req, capability),
    );
    return areaAllowed && capabilitiesAllowed
      ? next()
      : res
          .status(403)
          .json({
            success: false,
            code: "PORTAL_ACCESS_DENIED",
            message:
              "Your workspace administrator has not enabled this area for your account.",
          });
  };
}

export function requirePortalCapability(capability) {
  return (req, res, next) =>
    hasPortalCapability(req, capability)
      ? next()
      : res
          .status(403)
          .json({
            success: false,
            code: "PORTAL_ACCESS_DENIED",
            message:
              "Your workspace administrator has not enabled this action for your account.",
          });
}

export function assertPortalCaseTab(req, tab) {
  if (!hasPortalCaseTabAccess(req, tab)) {
    throw createHttpError(
      403,
      "Your workspace administrator has not enabled this case area for your account.",
      "PORTAL_ACCESS_DENIED",
    );
  }
}
