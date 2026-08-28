import prisma from "../services/prisma/client.js";
import { verifyAccessToken } from "../services/supabaseAuth.js";

const configuredAuthCacheTtl = Number(process.env.AUTH_CONTEXT_CACHE_TTL_MS);
const AUTH_CONTEXT_CACHE_TTL_MS = Math.min(
  Math.max(Number.isFinite(configuredAuthCacheTtl) ? configuredAuthCacheTtl : 15_000, 0),
  60_000,
);
const AUTH_CONTEXT_CACHE_MAX_ENTRIES = Math.max(
  Number(process.env.AUTH_CONTEXT_CACHE_MAX_ENTRIES) || 1_000,
  1,
);
const authContextCache = new Map();

function fail(res, status, message, code) {
  return res.status(status).json({ success: false, message, code });
}

const AUTH_USER_SELECT = {
  id: true,
  agencyId: true,
  authUserId: true,
  fullName: true,
  email: true,
  role: true,
  status: true,
  mustChangePassword: true,
  phone: true,
  jobTitle: true,
  avatarPreset: true,
  memberships: {
    where: { isActive: true },
    select: {
      id: true,
      agencyId: true,
      userId: true,
      role: true,
      isActive: true,
      permissions: true,
      mustChangePassword: true,
      agency: {
        select: {
          id: true,
          name: true,
          status: true,
          onboardingStatus: true,
          accessStatus: true,
          avatarMimeType: true,
          updatedAt: true,
          timezone: true,
        },
      },
    },
    orderBy: { createdAt: "asc" },
  },
};

function trimAuthContextCache(now) {
  for (const [key, entry] of authContextCache) {
    if (entry.expiresAt <= now) authContextCache.delete(key);
  }
  while (authContextCache.size > AUTH_CONTEXT_CACHE_MAX_ENTRIES) {
    authContextCache.delete(authContextCache.keys().next().value);
  }
}

export function clearAuthContextCache(authUserId = null) {
  if (authUserId) authContextCache.delete(authUserId);
  else authContextCache.clear();
}

export async function loadAuthenticationContext(authUserId, { db = prisma, now = Date.now() } = {}) {
  const cached = authContextCache.get(authUserId);
  if (cached && cached.expiresAt > now) return cached.value;
  if (cached) authContextCache.delete(authUserId);

  // Cache the in-flight promise as well as its result. A page load commonly
  // fires several authenticated API requests together; coalescing them keeps
  // that burst to one users/membership lookup instead of one per request.
  const pending = db.user.findUnique({
    where: { authUserId },
    select: AUTH_USER_SELECT,
  });
  authContextCache.set(authUserId, { value: pending, expiresAt: now + AUTH_CONTEXT_CACHE_TTL_MS });
  trimAuthContextCache(now);
  try {
    const value = await pending;
    if (AUTH_CONTEXT_CACHE_TTL_MS === 0) authContextCache.delete(authUserId);
    else authContextCache.set(authUserId, { value, expiresAt: now + AUTH_CONTEXT_CACHE_TTL_MS });
    return value;
  } catch (error) {
    authContextCache.delete(authUserId);
    throw error;
  }
}

export async function requireAuth(req, res, next) {
  try {
    const authorization = req.header("authorization") || "";
    const match = authorization.match(/^Bearer\s+(.+)$/i);
    if (!match) return fail(res, 401, "Authentication is required.", "UNAUTHENTICATED");

    let authUser;
    try {
      authUser = await verifyAccessToken(match[1]);
    } catch {
      return fail(res, 401, "Authentication is required.", "UNAUTHENTICATED");
    }

    const appUser = await loadAuthenticationContext(authUser.id);
    if (!appUser) return fail(res, 403, "No application profile is linked to this account.", "MEMBERSHIP_NOT_FOUND");
    if (appUser.status === "invited") return fail(res, 403, "Complete your account setup to continue.", "ACCOUNT_SETUP_REQUIRED");
    if (appUser.status !== "active") return fail(res, 403, "This account is inactive.", "ACCOUNT_INACTIVE");

    const membership = appUser.memberships[0];
    if (!membership) return fail(res, 403, "No active workspace membership was found.", "MEMBERSHIP_NOT_FOUND");
    if (membership.agency.onboardingStatus !== "active") return fail(res, 403, "Complete your workspace setup to continue.", "ACCOUNT_SETUP_REQUIRED");
    if (membership.agency.status !== "active" || membership.agency.accessStatus === "blocked") return fail(res, 403, "This account is inactive.", "ACCOUNT_INACTIVE");
    if (!["developer", "admin", "consultant", "frontdesk", "client"].includes(membership.role)) {
      return fail(res, 403, "This account role is not supported.", "INVALID_ROLE");
    }

    req.accessToken = match[1];
    req.authProviderUser = authUser;
    req.auth = {
      authUserId: authUser.id,
      userId: appUser.id,
      agencyId: membership.agencyId,
      role: membership.role,
      membershipId: membership.id,
      permissions: membership.permissions || {},
      agencyAccessStatus: membership.agency.accessStatus,
      readOnly: membership.agency.accessStatus === "read_only",
    };
    // Keep the existing controllers compatible while identity now comes only
    // from the verified token and database membership.
    req.user = {
      id: appUser.id,
      agencyId: membership.agencyId,
      email: appUser.email,
      role: membership.role,
      fullName: appUser.fullName,
    };
    req.appUser = appUser;
    req.membership = membership;
    next();
  } catch (error) {
    next(error);
  }
}

export default requireAuth;
