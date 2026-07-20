import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import prisma from "./prisma/client.js";
import { logger } from "./logger.js";
import { createHttpError } from "../utils/http.js";
import { decryptSecret, encryptSecret } from "./secretEncryption.js";

const AUTHORIZE_URL = "https://appcenter.intuit.com/connect/oauth2";
const TOKEN_URL = "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer";
const REVOKE_URL = "https://developer.api.intuit.com/v2/oauth2/tokens/revoke";
const STATE_TTL_MS = 10 * 60_000;

export function quickBooksConfigured() {
  return Boolean(process.env.QBO_CLIENT_ID && process.env.QBO_CLIENT_SECRET && process.env.QBO_REDIRECT_URI);
}

function environment() {
  return process.env.QBO_ENVIRONMENT === "sandbox" ? "sandbox" : "production";
}

export function quickBooksApiBase() {
  return environment() === "sandbox"
    ? "https://sandbox-quickbooks.api.intuit.com"
    : "https://quickbooks.api.intuit.com";
}

function stateSecret() {
  return String(process.env.MAIL_SETTINGS_ENCRYPTION_KEY || process.env.QBO_CLIENT_SECRET || "casedesk");
}

// Stateless OAuth state: agencyId + userId + expiry, HMAC-signed.
export function buildOAuthState(agencyId, userId) {
  const payload = `${agencyId}.${userId}.${Date.now() + STATE_TTL_MS}.${randomUUID().slice(0, 8)}`;
  const signature = createHmac("sha256", stateSecret()).update(payload).digest("hex").slice(0, 32);
  return Buffer.from(`${payload}.${signature}`).toString("base64url");
}

export function parseOAuthState(state) {
  try {
    const raw = Buffer.from(String(state || ""), "base64url").toString();
    const parts = raw.split(".");
    if (parts.length !== 5) return null;
    const [agencyId, userId, expiry, nonce, signature] = parts;
    const payload = `${agencyId}.${userId}.${expiry}.${nonce}`;
    const expected = createHmac("sha256", stateSecret()).update(payload).digest("hex").slice(0, 32);
    if (signature.length !== expected.length || !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;
    if (Number(expiry) < Date.now()) return null;
    return { agencyId, userId };
  } catch {
    return null;
  }
}

export function buildAuthorizeUrl(state) {
  const params = new URLSearchParams({
    client_id: process.env.QBO_CLIENT_ID,
    response_type: "code",
    scope: "com.intuit.quickbooks.accounting",
    redirect_uri: process.env.QBO_REDIRECT_URI,
    state,
  });
  return `${AUTHORIZE_URL}?${params.toString()}`;
}

function basicAuthHeader() {
  return `Basic ${Buffer.from(`${process.env.QBO_CLIENT_ID}:${process.env.QBO_CLIENT_SECRET}`).toString("base64")}`;
}

async function tokenRequest(body) {
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: basicAuthHeader(),
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: new URLSearchParams(body).toString(),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw createHttpError(502, payload.error_description || payload.error || "QuickBooks token exchange failed.", "QBO_TOKEN_ERROR");
  }
  return payload;
}

export async function exchangeAuthorizationCode(code) {
  return tokenRequest({ grant_type: "authorization_code", code, redirect_uri: process.env.QBO_REDIRECT_URI });
}

function tokenRow(agencyId, tokens, extra = {}) {
  const now = Date.now();
  return {
    agencyId,
    environment: environment(),
    accessTokenEncrypted: encryptSecret(tokens.access_token),
    refreshTokenEncrypted: encryptSecret(tokens.refresh_token),
    accessTokenExpiresAt: new Date(now + (tokens.expires_in || 3600) * 1000),
    refreshTokenExpiresAt: new Date(now + (tokens.x_refresh_token_expires_in || 100 * 24 * 3600) * 1000),
    status: "connected",
    lastError: null,
    ...extra,
  };
}

export async function saveConnection({ agencyId, userId, realmId, tokens }) {
  let companyName = null;
  try {
    const response = await fetch(`${quickBooksApiBase()}/v3/company/${realmId}/companyinfo/${realmId}?minorversion=75`, {
      headers: { Authorization: `Bearer ${tokens.access_token}`, Accept: "application/json" },
    });
    const payload = await response.json().catch(() => ({}));
    companyName = payload?.CompanyInfo?.CompanyName || null;
  } catch { /* company name is cosmetic */ }

  const data = tokenRow(agencyId, tokens, { realmId, companyName, connectedById: userId });
  return prisma.agencyQuickBooksSettings.upsert({
    where: { agencyId },
    create: data,
    update: data,
  });
}

/**
 * Returns a ready-to-use client { realmId, accessToken, apiBase } for the
 * agency, transparently refreshing (and persisting the rotated refresh
 * token) when the access token is near expiry.
 */
export async function getQuickBooksClient(agencyId) {
  const settings = await prisma.agencyQuickBooksSettings.findUnique({ where: { agencyId } });
  if (!settings || settings.status !== "connected") {
    throw createHttpError(409, "QuickBooks is not connected for this workspace.", "QBO_NOT_CONNECTED");
  }
  let accessToken = decryptSecret(settings.accessTokenEncrypted);
  if (settings.accessTokenExpiresAt.getTime() - Date.now() < 5 * 60_000) {
    try {
      const tokens = await tokenRequest({ grant_type: "refresh_token", refresh_token: decryptSecret(settings.refreshTokenEncrypted) });
      await prisma.agencyQuickBooksSettings.update({
        where: { agencyId },
        data: tokenRow(agencyId, tokens),
      });
      accessToken = tokens.access_token;
    } catch (error) {
      await prisma.agencyQuickBooksSettings.update({
        where: { agencyId },
        data: { status: "error", lastError: `Token refresh failed: ${error.message}`.slice(0, 500) },
      }).catch(() => {});
      logger.warn("quickbooks.refresh_failed", { agencyId, reason: error.message });
      throw createHttpError(409, "The QuickBooks connection has expired. Reconnect it in Settings.", "QBO_RECONNECT_REQUIRED");
    }
  }
  return { realmId: settings.realmId, accessToken, apiBase: quickBooksApiBase() };
}

// Every QBO fault response, regardless of HTTP status, nests here.
function faultMessage(payload) {
  const error = payload?.Fault?.Error?.[0];
  return error ? `${error.Message}${error.Detail ? `: ${error.Detail}` : ""}` : null;
}

/**
 * Authenticated QuickBooks API request. Centralizes token refresh, error
 * normalization, and JSON parsing so callers never touch fetch() directly —
 * one place to get retries/auth right instead of N places to get it wrong.
 */
export async function qboRequest(agencyId, { method = "GET", path, query, body } = {}) {
  const { realmId, accessToken, apiBase } = await getQuickBooksClient(agencyId);
  const url = new URL(`${apiBase}/v3/company/${realmId}${path}`);
  url.searchParams.set("minorversion", "75");
  if (query) url.searchParams.set("query", query);
  const response = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    logger.warn("quickbooks.request_failed", { agencyId, path, status: response.status, fault: faultMessage(payload) });
    throw createHttpError(
      response.status === 401 ? 409 : 502,
      faultMessage(payload) || "QuickBooks did not accept that request.",
      response.status === 401 ? "QBO_RECONNECT_REQUIRED" : "QBO_REQUEST_FAILED",
    );
  }
  return payload;
}

const SALES_ITEM_TYPES = new Set(["Service", "NonInventory"]);

export async function listQuickBooksItems(agencyId) {
  const payload = await qboRequest(agencyId, {
    path: "/query",
    query: "SELECT Id, Name, Active, Type, IncomeAccountRef FROM Item WHERE Active = true MAXRESULTS 300",
  });
  return (payload.QueryResponse?.Item || [])
    .filter((item) => SALES_ITEM_TYPES.has(item.Type))
    .map((item) => ({
      id: item.Id,
      name: item.Name,
      incomeAccountId: item.IncomeAccountRef?.value || null,
      incomeAccountName: item.IncomeAccountRef?.name || null,
    }));
}

export async function listQuickBooksAccounts(agencyId) {
  const payload = await qboRequest(agencyId, {
    path: "/query",
    query: "SELECT Id, Name, AccountType, Classification, Active FROM Account WHERE Active = true MAXRESULTS 300",
  });
  return (payload.QueryResponse?.Account || []).map((account) => ({
    id: account.Id,
    name: account.Name,
    accountType: account.AccountType,
    classification: account.Classification,
  }));
}

export async function createQuickBooksItem(agencyId, { name, incomeAccountId }) {
  const payload = await qboRequest(agencyId, {
    method: "POST",
    path: "/item",
    body: { Name: name, Type: "Service", IncomeAccountRef: { value: incomeAccountId } },
  });
  const item = payload.Item;
  return { id: item.Id, name: item.Name, incomeAccountId: item.IncomeAccountRef?.value || null, incomeAccountName: item.IncomeAccountRef?.name || null };
}

export async function revokeConnection(agencyId) {
  const settings = await prisma.agencyQuickBooksSettings.findUnique({ where: { agencyId } });
  if (!settings) return;
  try {
    await fetch(REVOKE_URL, {
      method: "POST",
      headers: { Authorization: basicAuthHeader(), "Content-Type": "application/json" },
      body: JSON.stringify({ token: decryptSecret(settings.refreshTokenEncrypted) }),
    });
  } catch (error) {
    logger.warn("quickbooks.revoke_failed", { agencyId, reason: error.message });
  }
  await prisma.agencyQuickBooksSettings.delete({ where: { agencyId } });
}
