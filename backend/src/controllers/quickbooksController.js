import prisma from "../services/prisma/client.js";
import { createHttpError } from "../utils/http.js";
import { recordActivity } from "../utils/prismaCrud.js";
import {
  buildAuthorizeUrl,
  buildOAuthState,
  createQuickBooksItem,
  exchangeAuthorizationCode,
  listQuickBooksAccounts,
  listQuickBooksItems,
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

export async function getQuickBooksItems(req, res) {
  const items = await listQuickBooksItems(req.auth.agencyId);
  res.json({ data: items });
}

export async function getQuickBooksAccounts(req, res) {
  const accounts = await listQuickBooksAccounts(req.auth.agencyId);
  res.json({ data: accounts });
}

export async function createQuickBooksMappingItem(req, res) {
  if (req.auth.role !== "admin") throw createHttpError(403, "Only workspace administrators can create QuickBooks items.", "FORBIDDEN");
  const name = String(req.body?.name || "").trim().slice(0, 100);
  const incomeAccountId = String(req.body?.incomeAccountId || "").trim();
  if (!name) throw createHttpError(400, "Item name is required.", "VALIDATION_ERROR");
  if (!incomeAccountId) throw createHttpError(400, "Choose an account for this item.", "VALIDATION_ERROR");

  // Never let the create call carry an account id the frontend merely typed —
  // confirm it exists in this workspace's own QuickBooks company first.
  const accounts = await listQuickBooksAccounts(req.auth.agencyId);
  if (!accounts.some((account) => account.id === incomeAccountId)) {
    throw createHttpError(400, "That account was not found in your QuickBooks company.", "VALIDATION_ERROR");
  }

  const item = await createQuickBooksItem(req.auth.agencyId, { name, incomeAccountId });
  await recordActivity({
    agencyId: req.auth.agencyId,
    userId: req.auth.userId,
    action: "quickbooks.item_created",
    details: `QuickBooks item "${item.name}" created`,
  }).catch(() => {});
  res.status(201).json({ data: item });
}

export async function getQuickBooksMapping(req, res) {
  const settings = await prisma.agencyQuickBooksSettings.findUnique({
    where: { agencyId: req.auth.agencyId },
    select: { feeItemId: true, feeItemName: true, disbursementItemId: true, disbursementItemName: true },
  });
  res.json({ data: settings || { feeItemId: null, feeItemName: null, disbursementItemId: null, disbursementItemName: null } });
}

export async function updateQuickBooksMapping(req, res) {
  if (req.auth.role !== "admin") throw createHttpError(403, "Only workspace administrators can change the payment mapping.", "FORBIDDEN");
  const feeItemId = req.body?.feeItemId !== undefined ? String(req.body.feeItemId || "").trim() || null : undefined;
  const disbursementItemId = req.body?.disbursementItemId !== undefined ? String(req.body.disbursementItemId || "").trim() || null : undefined;
  if (feeItemId === undefined && disbursementItemId === undefined) {
    throw createHttpError(400, "Nothing to update.", "VALIDATION_ERROR");
  }

  // Re-verify both ids against the live QuickBooks company on every save —
  // items get deleted/deactivated in QBO outside our control, and a stale
  // mapping must never silently keep invoicing against a dead item.
  const items = feeItemId || disbursementItemId ? await listQuickBooksItems(req.auth.agencyId) : [];
  const byId = new Map(items.map((item) => [item.id, item]));
  if (feeItemId && !byId.has(feeItemId)) throw createHttpError(400, "That fee item was not found in QuickBooks.", "VALIDATION_ERROR");
  if (disbursementItemId && !byId.has(disbursementItemId)) throw createHttpError(400, "That disbursement item was not found in QuickBooks.", "VALIDATION_ERROR");

  const existing = await prisma.agencyQuickBooksSettings.findUnique({ where: { agencyId: req.auth.agencyId } });
  if (!existing) throw createHttpError(409, "QuickBooks is not connected for this workspace.", "QBO_NOT_CONNECTED");

  const data = {
    ...(feeItemId !== undefined ? { feeItemId, feeItemName: feeItemId ? byId.get(feeItemId).name : null } : {}),
    ...(disbursementItemId !== undefined ? { disbursementItemId, disbursementItemName: disbursementItemId ? byId.get(disbursementItemId).name : null } : {}),
  };
  const settings = await prisma.agencyQuickBooksSettings.update({ where: { agencyId: req.auth.agencyId }, data });
  await recordActivity({
    agencyId: req.auth.agencyId,
    userId: req.auth.userId,
    action: "quickbooks.mapping_updated",
    details: "Payment account mapping updated",
  }).catch(() => {});
  res.json({ data: { feeItemId: settings.feeItemId, feeItemName: settings.feeItemName, disbursementItemId: settings.disbursementItemId, disbursementItemName: settings.disbursementItemName } });
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
