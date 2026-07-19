import prisma from "../services/prisma/client.js";
import { createHttpError } from "../utils/http.js";
import { recordActivity } from "../utils/prismaCrud.js";
import {
  buildAuthorizeUrl,
  buildOAuthState,
  exchangeAuthorizationCode,
  parseOAuthState,
  quickBooksConfigured,
  revokeConnection,
  saveConnection,
} from "../services/quickbooksService.js";

function frontendBase() {
  return String(process.env.FRONTEND_URL || "http://localhost:5173").split(",")[0].trim().replace(/\/$/, "");
}

function settingsUrl(result) {
  return `${frontendBase()}/app/settings?section=payments-fees&qbo=${result}`;
}

export async function getQuickBooksStatus(req, res) {
  const settings = await prisma.agencyQuickBooksSettings.findUnique({
    where: { agencyId: req.auth.agencyId },
    select: { environment: true, companyName: true, realmId: true, status: true, lastError: true, createdAt: true, updatedAt: true, refreshTokenExpiresAt: true },
  });
  res.json({
    data: {
      configured: quickBooksConfigured(),
      connected: Boolean(settings && settings.status === "connected"),
      status: settings?.status || "disconnected",
      companyName: settings?.companyName || null,
      environment: settings?.environment || null,
      connectedAt: settings?.createdAt || null,
      lastError: settings?.lastError || null,
      refreshTokenExpiresAt: settings?.refreshTokenExpiresAt || null,
    },
  });
}

export async function startQuickBooksConnect(req, res) {
  if (req.auth.role !== "admin") throw createHttpError(403, "Only workspace administrators can connect QuickBooks.", "FORBIDDEN");
  if (!quickBooksConfigured()) {
    throw createHttpError(503, "QuickBooks credentials are not configured on the server yet.", "QBO_NOT_CONFIGURED");
  }
  const state = buildOAuthState(req.auth.agencyId, req.auth.userId);
  res.json({ data: { url: buildAuthorizeUrl(state) } });
}

// Intuit redirects the admin's browser here — no auth header available, the
// signed state carries (and proves) the workspace identity.
export async function quickBooksCallback(req, res) {
  const { code, state, realmId, error } = req.query;
  if (error) return res.redirect(settingsUrl("denied"));
  const parsed = parseOAuthState(state);
  if (!parsed || !code || !realmId) return res.redirect(settingsUrl("invalid"));
  try {
    const tokens = await exchangeAuthorizationCode(String(code));
    await saveConnection({ agencyId: parsed.agencyId, userId: parsed.userId, realmId: String(realmId), tokens });
    await recordActivity({
      agencyId: parsed.agencyId,
      userId: parsed.userId,
      action: "quickbooks.connected",
      details: "QuickBooks company connected",
    }).catch(() => {});
    return res.redirect(settingsUrl("connected"));
  } catch (reason) {
    return res.redirect(settingsUrl(`error&message=${encodeURIComponent(String(reason.message || "Connection failed").slice(0, 140))}`));
  }
}

export async function disconnectQuickBooks(req, res) {
  if (req.auth.role !== "admin") throw createHttpError(403, "Only workspace administrators can disconnect QuickBooks.", "FORBIDDEN");
  await revokeConnection(req.auth.agencyId);
  await recordActivity({
    agencyId: req.auth.agencyId,
    userId: req.auth.userId,
    action: "quickbooks.disconnected",
    details: "QuickBooks company disconnected",
  }).catch(() => {});
  res.json({ data: { disconnected: true } });
}
