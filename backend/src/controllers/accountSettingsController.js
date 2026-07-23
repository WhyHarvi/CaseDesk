import prisma from "../services/prisma/client.js";

const SECURITY_ACTIONS = [
  "USER_LOGIN",
  "USER_LOGOUT",
  "PASSWORD_CHANGED",
  "PASSWORD_RESET_REQUESTED",
  "MEMBER_INVITATION_ACCEPTED",
  "CLIENT_PORTAL_INVITED",
];

const CATEGORY_PATTERNS = {
  security: ["USER_", "PASSWORD_", "INVITATION", "ACCESS_", "PERMISSION"],
  clients: ["client.", "client_", "CLIENT_PORTAL"],
  cases: ["case.", "case_", "workflow", "task.", "follow_up"],
  documents: ["document", "case_form", "questionnaire", "correspondence", "written_document", "shared_library"],
  appointments: ["appointment", "booking"],
  communications: ["communication", "mail", "ooma", "message"],
  settings: ["settings.", "agency_", "TEAM_MEMBER", "CONSULTANT_"],
};

function dateValue(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function securityEventLabel(action) {
  const labels = {
    USER_LOGIN: "Signed in",
    USER_LOGOUT: "Signed out",
    PASSWORD_CHANGED: "Password changed",
    PASSWORD_RESET_REQUESTED: "Password reset requested",
    MEMBER_INVITATION_ACCEPTED: "Account activated",
    CLIENT_PORTAL_INVITED: "Portal access created",
  };
  return labels[action] || action.replace(/[._]/g, " ").replace(/\b\w/g, (character) => character.toUpperCase());
}

export async function getAccountSecurity(req, res) {
  const [lastPasswordEvent, recentSecurity] = await Promise.all([
    prisma.activityLog.findFirst({
      where: { agencyId: req.auth.agencyId, userId: req.auth.userId, action: "PASSWORD_CHANGED" },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    }),
    prisma.activityLog.findMany({
      where: { agencyId: req.auth.agencyId, userId: req.auth.userId, action: { in: SECURITY_ACTIONS } },
      orderBy: { createdAt: "desc" },
      take: 6,
      select: { id: true, action: true, details: true, createdAt: true },
    }),
  ]);
  const authUser = req.authProviderUser || {};
  const factors = Array.isArray(authUser.factors) ? authUser.factors : [];
  res.json({
    data: {
      account: {
        fullName: req.appUser.fullName,
        email: req.appUser.email,
        role: req.auth.role,
        status: req.appUser.status,
        workspaceName: req.membership.agency.name,
        workspaceAccess: req.membership.agency.accessStatus,
        emailConfirmedAt: dateValue(authUser.email_confirmed_at || authUser.confirmed_at),
        lastSignInAt: dateValue(authUser.last_sign_in_at),
        lastPasswordChangedAt: lastPasswordEvent?.createdAt || null,
        mustChangePassword: Boolean(req.appUser.mustChangePassword || req.membership.mustChangePassword),
      },
      authentication: {
        provider: "Email and password",
        minimumPasswordLength: 10,
        mfaEnabled: factors.some((factor) => factor.status === "verified"),
        verifiedFactorCount: factors.filter((factor) => factor.status === "verified").length,
      },
      recentSecurity: recentSecurity.map((event) => ({ ...event, label: securityEventLabel(event.action) })),
    },
  });
}

function categoryWhere(category) {
  const patterns = CATEGORY_PATTERNS[category];
  if (!patterns) return {};
  return {
    OR: patterns.map((pattern) => ({
      action: { contains: pattern, mode: "insensitive" },
    })),
  };
}

export async function getAccountActivity(req, res) {
  const page = Math.max(Number(req.query.page) || 1, 1);
  const limit = Math.min(Math.max(Number(req.query.limit) || 15, 1), 50);
  const requestedScope = String(req.query.scope || "mine").toLowerCase();
  const scope = req.auth.role === "admin" && requestedScope === "workspace" ? "workspace" : "mine";
  const category = String(req.query.category || "all").toLowerCase();
  const range = String(req.query.range || "30").toLowerCase();
  const search = String(req.query.search || "").trim().slice(0, 120);
  const since = range === "7" ? new Date(Date.now() - 7 * 86_400_000) : range === "30" ? new Date(Date.now() - 30 * 86_400_000) : null;
  const filters = [
    { agencyId: req.auth.agencyId },
    ...(scope === "mine" ? [{ userId: req.auth.userId }] : []),
    ...(since ? [{ createdAt: { gte: since } }] : []),
    ...(category === "all" ? [] : [categoryWhere(category)]),
    ...(search ? [{
      OR: [
        { action: { contains: search, mode: "insensitive" } },
        { details: { contains: search, mode: "insensitive" } },
        { user: { fullName: { contains: search, mode: "insensitive" } } },
        { client: { fullName: { contains: search, mode: "insensitive" } } },
        { case: { caseType: { contains: search, mode: "insensitive" } } },
      ],
    }] : []),
  ];
  const where = { AND: filters };
  const [items, total] = await Promise.all([
    prisma.activityLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
      select: {
        id: true,
        action: true,
        details: true,
        entityType: true,
        entityId: true,
        createdAt: true,
        user: { select: { id: true, fullName: true } },
        client: { select: { id: true, fullName: true } },
        case: { select: { id: true, caseType: true, stage: true } },
      },
    }),
    prisma.activityLog.count({ where }),
  ]);
  res.json({
    data: items,
    meta: {
      page,
      limit,
      total,
      totalPages: Math.max(Math.ceil(total / limit), 1),
      scope,
      canViewWorkspace: req.auth.role === "admin",
    },
  });
}
