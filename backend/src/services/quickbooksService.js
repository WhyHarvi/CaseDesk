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

// Browser-facing QuickBooks Online app URLs (app.qbo.intuit.com), not the
// API host above — opens directly on the transaction screen for a staff
// member already logged into the agency's QuickBooks company. CaseDesk
// never calls a refund API itself; this is navigation only, so staff can
// issue the refund in QuickBooks in a couple of clicks instead of
// searching for the transaction.
export function quickBooksAppUrl(kind, txnId) {
  if (!txnId) return null;
  const path = {
    invoice: "invoice",
    refundreceipt: "refundreceipt",
    recvpayment: "recvpayment",
  }[kind] || "recvpayment";
  return `https://app.qbo.intuit.com/app/${path}?txnId=${encodeURIComponent(txnId)}`;
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

// Verifies Intuit's `intuit-signature` header: base64 HMAC-SHA256 of the
// raw request body, keyed with the app's Webhook Verifier Token (a
// separate secret from the OAuth client secret, set in Intuit's developer
// dashboard alongside the webhook endpoint URL).
export function verifyIntuitWebhookSignature(rawBody, signatureHeader) {
  const token = process.env.QBO_WEBHOOK_VERIFIER_TOKEN;
  if (!token || !signatureHeader) return false;
  const expected = createHmac("sha256", token).update(rawBody).digest("base64");
  const expectedBuffer = Buffer.from(expected);
  const suppliedBuffer = Buffer.from(String(signatureHeader));
  if (expectedBuffer.length !== suppliedBuffer.length) return false;
  return timingSafeEqual(expectedBuffer, suppliedBuffer);
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

  const existingForRealm = await prisma.agencyQuickBooksSettings.findUnique({ where: { realmId }, select: { agencyId: true } });
  if (existingForRealm && existingForRealm.agencyId !== agencyId) {
    throw createHttpError(409, "This QuickBooks company is already connected to another CaseDesk workspace.", "QBO_REALM_TAKEN");
  }

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
export async function qboRequest(agencyId, { method = "GET", path, query, body, requestId } = {}) {
  const { realmId, accessToken, apiBase } = await getQuickBooksClient(agencyId);
  const url = new URL(`${apiBase}/v3/company/${realmId}${path}`);
  url.searchParams.set("minorversion", "75");
  if (query) url.searchParams.set("query", query);
  const response = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
      ...(requestId ? { "Request-Id": String(requestId).slice(0, 50) } : {}),
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const faultCode = payload?.Fault?.Error?.[0]?.code || null;
    logger.warn("quickbooks.request_failed", { agencyId, path, status: response.status, fault: faultMessage(payload), faultCode });
    const error = createHttpError(
      response.status === 401 ? 409 : 502,
      faultMessage(payload) || "QuickBooks did not accept that request.",
      response.status === 401 ? "QBO_RECONNECT_REQUIRED" : "QBO_REQUEST_FAILED",
    );
    // Intuit's fault code, not the HTTP status, is what actually
    // distinguishes "this record genuinely doesn't exist" (610) from every
    // other failure (rate limit, 5xx, a malformed request) — callers that
    // treat "not found" as a meaningful signal (see getQuickBooksInvoice)
    // need this to avoid conflating a transient outage with a deleted
    // invoice.
    error.qboFaultCode = faultCode;
    throw error;
  }
  return payload;
}

export async function getQuickBooksInvoicePdf(agencyId, qbInvoiceId) {
  const { realmId, accessToken, apiBase } = await getQuickBooksClient(agencyId);
  const url = new URL(`${apiBase}/v3/company/${realmId}/invoice/${qbInvoiceId}/pdf`);
  url.searchParams.set("minorversion", "75");
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/pdf" },
  });
  if (!response.ok) {
    logger.warn("quickbooks.pdf_failed", { agencyId, qbInvoiceId, status: response.status });
    throw createHttpError(502, "QuickBooks could not produce this invoice PDF.", "QBO_REQUEST_FAILED");
  }
  return Buffer.from(await response.arrayBuffer());
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

// QBO's query language is SQL-like; string literals are single-quoted and
// a literal quote inside a value must be doubled to stay a literal.
function escapeQueryLiteral(value) {
  return String(value).replace(/'/g, "''");
}

export async function findQuickBooksCustomerByEmail(agencyId, email) {
  const normalizedEmail = String(email || "").trim().toLowerCase();
  if (!normalizedEmail) return null;
  const payload = await qboRequest(agencyId, {
    path: "/query",
    query: `SELECT Id, SyncToken, DisplayName, PrimaryEmailAddr, Active FROM Customer WHERE PrimaryEmailAddr = '${escapeQueryLiteral(normalizedEmail)}' MAXRESULTS 10`,
  });
  const matches = (payload.QueryResponse?.Customer || [])
    .filter((customer) => customer.Active !== false)
    .filter((customer) => String(customer.PrimaryEmailAddr?.Address || "").trim().toLowerCase() === normalizedEmail)
    .map(mapQuickBooksCustomer);
  if (matches.length > 1) {
    throw createHttpError(
      409,
      `More than one active QuickBooks customer uses ${normalizedEmail}. Merge or correct those customers in QuickBooks, then retry.`,
      "QBO_CUSTOMER_AMBIGUOUS",
    );
  }
  return matches[0] || null;
}

export async function getQuickBooksCustomer(agencyId, customerId) {
  if (!customerId) return null;
  // QBO inconsistently returns fault 2010 (instead of 610) for some stale
  // customer ids. An exact query gives an unambiguous empty result while
  // still throwing on authentication, rate-limit and service failures, so
  // outages can never be mistaken for permission to re-link a client.
  const payload = await qboRequest(agencyId, {
    path: "/query",
    query: `SELECT Id, SyncToken, DisplayName, PrimaryEmailAddr, Active FROM Customer WHERE Id = '${escapeQueryLiteral(customerId)}' MAXRESULTS 1`,
  });
  const customer = payload.QueryResponse?.Customer?.[0] || null;
  if (!customer || customer.Active === false) return null;
  return mapQuickBooksCustomer(customer);
}

function mapQuickBooksCustomer(customer) {
  return {
    id: customer.Id,
    syncToken: customer.SyncToken,
    displayName: customer.DisplayName,
    email: customer.PrimaryEmailAddr?.Address || null,
    active: customer.Active !== false,
  };
}

export function isQuickBooksDuplicateNameError(error) {
  return error?.qboFaultCode === "6240"
    || String(error?.message || "").toLowerCase().includes("duplicate name");
}

function customerFieldPayload({ displayName, email, phone, addressLine1 }) {
  return {
    DisplayName: displayName,
    ...(email ? { PrimaryEmailAddr: { Address: email } } : {}),
    ...(phone ? { PrimaryPhone: { FreeFormNumber: phone } } : {}),
    ...(addressLine1 ? { BillAddr: { Line1: addressLine1 } } : {}),
  };
}

export async function createQuickBooksCustomer(agencyId, fields) {
  const payload = await qboRequest(agencyId, {
    method: "POST",
    path: "/customer",
    body: customerFieldPayload(fields),
  });
  return mapQuickBooksCustomer(payload.Customer);
}

export async function updateQuickBooksCustomer(agencyId, { id, syncToken, ...fields }) {
  const payload = await qboRequest(agencyId, {
    method: "POST",
    path: "/customer",
    body: { Id: id, SyncToken: syncToken, sparse: true, ...customerFieldPayload(fields) },
  });
  return mapQuickBooksCustomer(payload.Customer);
}

function mapQuickBooksInvoice(invoice) {
  return {
    id: invoice.Id,
    syncToken: invoice.SyncToken,
    docNumber: invoice.DocNumber || null,
    totalAmount: Number(invoice.TotalAmt ?? 0),
    totalTax: Number(invoice.TxnTaxDetail?.TotalTax ?? 0),
    balance: Number(invoice.Balance ?? 0),
    dueDate: invoice.DueDate || null,
    transactionDate: invoice.TxnDate || null,
    createdAt: invoice.MetaData?.CreateTime || invoice.TxnDate || null,
    updatedAt: invoice.MetaData?.LastUpdatedTime || null,
    currency: invoice.CurrencyRef?.value || "CAD",
    isVoided: String(invoice.PrivateNote || "").trim().toLowerCase() === "voided"
      || String(invoice.TxnStatus || "").trim().toLowerCase() === "voided",
    // Only present once the invoice has been sent — QuickBooks Payments
    // being enabled is necessary but not sufficient; QBO doesn't generate
    // the hosted "Pay now" page at creation time, only on send (confirmed
    // empirically: a freshly created invoice has no InvoiceLink even with
    // Payments fully active, and calling QBO's own /send endpoint on it
    // populates one immediately). See createQuickBooksInvoice.
    invoiceLink: invoice.InvoiceLink || null,
  };
}

// Once a QuickBooks company has real sales-tax tracking turned on (its own
// TaxAgency/TaxCode/TaxRate records exist), QBO rejects any invoice line
// with no TaxCodeRef at all — "Make sure all your transactions have a
// GST/HST rate before you save" — even when the item and customer are both
// already marked non-taxable. Omitting the tax code isn't the same as
// declaring "no tax applies"; QBO needs that stated explicitly. This
// resolves the company's own built-in non-taxable code by name so every
// non-taxable line still carries one. A company with sales tax tracking
// never turned on at all (no TaxCode rows exist) has nothing to resolve —
// that's the original no-tax-setup case, left to omit TaxCodeRef exactly
// as before.
const NON_TAXABLE_TAX_CODE_NAMES = ["Out of Scope", "Zero-rated", "Exempt"];

export async function resolveNonTaxableTaxCodeId(agencyId) {
  const payload = await qboRequest(agencyId, {
    path: "/query",
    query: "SELECT Id, Name FROM TaxCode WHERE Active = true MAXRESULTS 1000",
  });
  const codes = payload.QueryResponse?.TaxCode || [];
  if (!codes.length) return null;
  for (const name of NON_TAXABLE_TAX_CODE_NAMES) {
    const match = codes.find((code) => String(code.Name || "").toLowerCase() === name.toLowerCase());
    if (match) return match.Id;
  }
  return null;
}

export function buildQuickBooksInvoiceLines({
  invoiceLines,
  taxableTaxCodeId,
  nonTaxableTaxCodeId,
  discountAmount = 0,
}) {
  const fixedDiscount = Math.max(0, Number(discountAmount) || 0);
  const discountItem = invoiceLines.find((line) => line.taxable) || invoiceLines[0];
  return [
    ...invoiceLines.map((line) => {
      const lineAmount = Number(line.amount);
      const taxCodeId = line.taxable && taxableTaxCodeId ? taxableTaxCodeId : nonTaxableTaxCodeId;
      return {
        Amount: lineAmount,
        DetailType: "SalesItemLineDetail",
        Description: line.description,
        SalesItemLineDetail: {
          ItemRef: { value: line.itemId },
          Qty: Number(line.quantity || 1),
          UnitPrice: Number(line.unitAmount ?? lineAmount),
          ...(taxCodeId ? { TaxCodeRef: { value: taxCodeId } } : {}),
        },
      };
    }),
    ...(fixedDiscount > 0 && discountItem ? [{
      // Canadian Automated Sales Tax has been observed applying a native
      // DiscountLineDetail before HST even when ApplyTaxAfterDiscount=false.
      // A negative, explicitly non-taxable professional-fee line removes
      // that ambiguity: $500 taxable + $65 HST - $65 non-taxable = $500.
      Amount: -fixedDiscount,
      DetailType: "SalesItemLineDetail",
      Description: "Agreed fee discount",
      SalesItemLineDetail: {
        ItemRef: { value: discountItem.itemId },
        Qty: 1,
        UnitPrice: -fixedDiscount,
        ...(nonTaxableTaxCodeId ? { TaxCodeRef: { value: nonTaxableTaxCodeId } } : {}),
      },
    }] : []),
  ];
}

export async function createQuickBooksInvoice(agencyId, {
  customerId,
  itemId,
  description,
  amount,
  dueDate,
  requestId,
  invoiceNumber,
  lines,
  taxableTaxCodeId,
  expectedTotal,
  discountAmount = 0,
  globalTaxCalculation = "TaxExcluded",
}) {
  const invoiceLines = Array.isArray(lines) && lines.length
    ? lines
    : [{ itemId, description, amount, taxable: false }];
  const fixedDiscount = Math.max(0, Number(discountAmount) || 0);
  const needsNonTaxableCode = fixedDiscount > 0 || invoiceLines.some((line) => !(line.taxable && taxableTaxCodeId));
  const nonTaxableCodeId = needsNonTaxableCode ? await resolveNonTaxableTaxCodeId(agencyId) : null;
  if (fixedDiscount > 0 && !nonTaxableCodeId) {
    throw createHttpError(
      409,
      "QuickBooks needs an active non-taxable sales-tax code (Out of Scope, Zero-rated, or Exempt) before CaseDesk can apply an after-tax discount. Check the QuickBooks sales-tax setup and retry the invoice.",
      "QBO_NON_TAXABLE_CODE_REQUIRED",
    );
  }
  const payload = await qboRequest(agencyId, {
    method: "POST",
    path: "/invoice",
    requestId,
    body: {
      CustomerRef: { value: customerId },
      ...(invoiceNumber ? { DocNumber: invoiceNumber } : {}),
      ...(dueDate ? { DueDate: dueDate } : {}),
      GlobalTaxCalculation: globalTaxCalculation,
      ...(fixedDiscount > 0 ? { ApplyTaxAfterDiscount: false } : {}),
      AllowOnlineCreditCardPayment: true,
      AllowOnlineACHPayment: true,
      Line: buildQuickBooksInvoiceLines({
        invoiceLines,
        taxableTaxCodeId,
        nonTaxableTaxCodeId: nonTaxableCodeId,
        discountAmount: fixedDiscount,
      }),
    },
  });
  const invoice = payload.Invoice;
  const mappedInvoice = mapQuickBooksInvoice(invoice);

  // Tax is accounting data, not presentation-only arithmetic. Refuse to
  // persist an invoice when the live QuickBooks total differs from the
  // CaseDesk total; immediately void the newly-created QBO transaction so a
  // tax-code mapping problem cannot leave an incorrect receivable behind.
  if (Number.isFinite(Number(expectedTotal)) && Math.abs(mappedInvoice.totalAmount - Number(expectedTotal)) > 0.01) {
    try {
      await voidQuickBooksInvoice(agencyId, { id: mappedInvoice.id, syncToken: mappedInvoice.syncToken });
    } catch (voidError) {
      logger.error("quickbooks.invoice_total_mismatch_void_failed", {
        agencyId,
        invoiceId: mappedInvoice.id,
        expectedTotal: Number(expectedTotal),
        actualTotal: mappedInvoice.totalAmount,
        error: voidError.message,
      });
    }
    throw createHttpError(
      409,
      `QuickBooks calculated $${mappedInvoice.totalAmount.toFixed(2)}, but CaseDesk calculated $${Number(expectedTotal).toFixed(2)}. Check the QuickBooks sales-tax mapping before invoicing.`,
      "QBO_INVOICE_TOTAL_MISMATCH",
    );
  }

  // QuickBooks only provisions the hosted "Pay now" InvoiceLink once the
  // invoice is sent, never at creation. CaseDesk delivers the link to the
  // client itself (its own notification flow, not QuickBooks' email), so
  // "sending" here targets a reserved, non-deliverable address purely to
  // trigger link generation — nothing is actually emailed to anyone.
  try {
    const sendResult = await qboRequest(agencyId, {
      method: "POST",
      path: `/invoice/${invoice.Id}/send?sendTo=${encodeURIComponent(`qbo-link-trigger+${invoice.Id}@example.com`)}`,
    });
    return mapQuickBooksInvoice(sendResult.Invoice);
  } catch (error) {
    logger.warn("quickbooks.invoice_link_trigger_failed", { agencyId, invoiceId: invoice.Id, error: error.message });
    return mapQuickBooksInvoice(invoice);
  }
}

// Consultation pricing is displayed to the visitor as one final amount —
// e.g. exactly $100 — and that's what gets invoiced, non-taxable, same as
// every other CaseDesk-created QuickBooks invoice before tax-code mapping
// was attempted here. Assigning a real QBO sales-tax code so the tax
// portion of that total is recorded correctly is real, worthwhile future
// work, but requiring it up front was blocking public booking outright for
// any agency that hasn't (or can't, e.g. QuickBooks' Automated Sales Tax
// mode doesn't expose a manual tax-code list at all) picked one — so this
// no longer hard-requires it. See QuickBooksMappingCard.jsx for the
// now-optional tax-code picker this used to require.
export async function createQuickBooksConsultationInvoice(agencyId, values) {
  const settings = await prisma.agencyQuickBooksSettings.findUnique({
    where: { agencyId },
    select: { status: true },
  });
  if (!settings || settings.status !== "connected") {
    throw createHttpError(409, "Connect QuickBooks in Settings before creating consultation invoices.", "QBO_NOT_CONNECTED");
  }
  return createQuickBooksInvoice(agencyId, values);
}

export async function listQuickBooksTaxCodes(agencyId) {
  const payload = await qboRequest(agencyId, {
    path: "/query",
    query: "SELECT * FROM TaxCode MAXRESULTS 1000",
  });
  return (payload.QueryResponse?.TaxCode || [])
    .filter((taxCode) => taxCode.Active !== false && taxCode.Taxable !== false)
    .map((taxCode) => ({
      id: taxCode.Id,
      name: taxCode.Name,
      description: taxCode.Description || null,
    }))
    .sort((left, right) => left.name.localeCompare(right.name));
}

export async function getQuickBooksSalesTaxStatus(agencyId) {
  const payload = await qboRequest(agencyId, { path: "/preferences" });
  const usingSalesTax = payload.Preferences?.TaxPrefs?.UsingSalesTax;
  return { usingSalesTax: typeof usingSalesTax === "boolean" ? usingSalesTax : null };
}

// Batched refresh for the invoices already known to CaseDesk — one round
// trip regardless of how many invoices a case has accumulated. Note:
// InvoiceLink is not a queryable column in QBO's SQL-like Query API (only
// in the direct entity GET/POST response) — selecting it here throws, so
// it's deliberately omitted and only ever captured at creation time.
export async function getQuickBooksInvoicesByIds(agencyId, ids) {
  if (!ids.length) return [];
  const list = ids.map((id) => `'${escapeQueryLiteral(id)}'`).join(",");
  const payload = await qboRequest(agencyId, {
    path: "/query",
    query: `SELECT Id, SyncToken, DocNumber, TotalAmt, Balance, DueDate, PrivateNote FROM Invoice WHERE Id IN (${list}) MAXRESULTS 300`,
  });
  return (payload.QueryResponse?.Invoice || []).map(mapQuickBooksInvoice);
}

// Direct entity GET (not the batched Query API) — the only way to read a
// fresh Balance/SyncToken/InvoiceLink for one invoice, used by the webhook
// worker to re-verify payment live rather than trusting the notification.
export async function getQuickBooksInvoice(agencyId, id) {
  try {
    const payload = await qboRequest(agencyId, { path: `/invoice/${id}` });
    return mapQuickBooksInvoice(payload.Invoice);
  } catch (error) {
    // Only Intuit's own "Object Not Found" fault (610) means the invoice is
    // genuinely gone — callers (the webhook worker, expiry sweep) treat a
    // null return as license to void a pending payment hold. Collapsing
    // every other failure (rate limit, 5xx, timeout) into the same null
    // would let a transient QuickBooks outage void a hold whose invoice is
    // still perfectly valid — or, worse, already paid.
    if (error.code === "QBO_REQUEST_FAILED" && error.qboFaultCode === "610") return null;
    throw error;
  }
}

// Direct entity GET for a Payment, resolving which invoice(s) it was
// applied to via its LinkedTxn lines.
export async function getQuickBooksPayment(agencyId, id) {
  const payload = await qboRequest(agencyId, { path: `/payment/${id}` });
  const payment = payload.Payment;
  const invoiceIds = (payment.Line || [])
    .flatMap((line) => line.LinkedTxn || [])
    .filter((txn) => txn.TxnType === "Invoice")
    .map((txn) => txn.TxnId);
  return {
    id: payment.Id,
    syncToken: payment.SyncToken,
    totalAmount: Number(payment.TotalAmt ?? 0),
    invoiceIds: [...new Set(invoiceIds)],
    paymentReference: payment.PaymentRefNum || null,
    methodId: payment.PaymentMethodRef?.value || null,
    transactionDate: payment.TxnDate || null,
  };
}

export async function updateQuickBooksPaymentDetails(agencyId, {
  id,
  paymentReference,
  paymentMethodId,
  transactionDate,
}) {
  const current = await getQuickBooksPayment(agencyId, id);
  const payload = await qboRequest(agencyId, {
    method: "POST",
    path: "/payment",
    body: {
      Id: current.id,
      SyncToken: current.syncToken,
      sparse: true,
      ...(paymentReference ? { PaymentRefNum: String(paymentReference).slice(0, 21) } : {}),
      ...(paymentMethodId ? { PaymentMethodRef: { value: paymentMethodId } } : {}),
      ...(transactionDate ? { TxnDate: transactionDate } : {}),
    },
  });
  return mapQuickBooksPaymentForLedger(payload.Payment);
}

function mapQuickBooksRefundReceipt(receipt) {
  const itemIds = (receipt.Line || [])
    .map((line) => line.SalesItemLineDetail?.ItemRef?.value)
    .filter(Boolean);
  return {
    id: receipt.Id,
    syncToken: receipt.SyncToken,
    docNumber: receipt.DocNumber || null,
    customerId: receipt.CustomerRef?.value || null,
    customerName: receipt.CustomerRef?.name || null,
    totalAmount: Number(receipt.TotalAmt ?? 0),
    itemIds: [...new Set(itemIds)],
    paymentRefNum: receipt.PaymentRefNum || null,
    transactionDate: receipt.TxnDate || null,
    createdAt: receipt.MetaData?.CreateTime || receipt.TxnDate || null,
    updatedAt: receipt.MetaData?.LastUpdatedTime || null,
    cardStatus: receipt.CreditCardPayment?.CreditChargeResponse?.Status || null,
    cardTransactionId:
      receipt.CreditCardPayment?.CreditChargeResponse?.CCTransId || null,
    paymentMethodName: receipt.PaymentMethodRef?.name || null,
    currency: receipt.CurrencyRef?.value || "CAD",
  };
}

export async function getQuickBooksRefundReceipt(agencyId, id) {
  const payload = await qboRequest(agencyId, { path: `/refundreceipt/${id}` });
  return mapQuickBooksRefundReceipt(payload.RefundReceipt);
}

export async function listQuickBooksRefundReceiptsSince(agencyId, since) {
  const date = new Date(since);
  const from = Number.isNaN(date.getTime()) ? new Date(Date.now() - 30 * 86_400_000) : date;
  const day = from.toISOString().slice(0, 10);
  const payload = await qboRequest(agencyId, {
    path: "/query",
    query: `SELECT * FROM RefundReceipt WHERE TxnDate >= '${escapeQueryLiteral(day)}' MAXRESULTS 1000`,
  });
  return (payload.QueryResponse?.RefundReceipt || []).map(mapQuickBooksRefundReceipt);
}

async function queryAllQuickBooksCustomerTransactions(agencyId, entityName, customerId) {
  if (!customerId) return [];
  const rows = [];
  const pageSize = 1000;
  // QBO caps one query page at 1,000 rows. Keep paging so a long-standing
  // client account never loses its oldest payments or refunds from a
  // statement just because it crossed that limit.
  for (let startPosition = 1; startPosition <= 10_000; startPosition += pageSize) {
    const payload = await qboRequest(agencyId, {
      path: "/query",
      query: `SELECT * FROM ${entityName} WHERE CustomerRef = '${escapeQueryLiteral(customerId)}' STARTPOSITION ${startPosition} MAXRESULTS ${pageSize}`,
    });
    const page = payload.QueryResponse?.[entityName] || [];
    rows.push(...page);
    if (page.length < pageSize) break;
  }
  return rows;
}

function mapQuickBooksPaymentForLedger(payment) {
  const allocations = (payment.Line || []).flatMap((line) => {
    const invoiceLinks = (line.LinkedTxn || []).filter((txn) => txn.TxnType === "Invoice");
    if (!invoiceLinks.length) return [];
    // QBO normally emits one invoice link per payment line. Dividing is a
    // defensive fallback for an unusual multi-link line and preserves the
    // exact line total rather than multiplying it across invoices.
    const allocatedAmount = Number(line.Amount || 0) / invoiceLinks.length;
    return invoiceLinks.map((txn) => ({ invoiceId: txn.TxnId, amount: allocatedAmount }));
  });
  return {
    id: payment.Id,
    totalAmount: Number(payment.TotalAmt || 0),
    unappliedAmount: Number(payment.UnappliedAmt || 0),
    transactionDate: payment.TxnDate || null,
    createdAt: payment.MetaData?.CreateTime || payment.TxnDate || null,
    updatedAt: payment.MetaData?.LastUpdatedTime || null,
    paymentReference: payment.PaymentRefNum || null,
    methodId: payment.PaymentMethodRef?.value || null,
    methodName: payment.PaymentMethodRef?.name || null,
    cardStatus: payment.CreditCardPayment?.CreditChargeResponse?.Status || null,
    currency: payment.CurrencyRef?.value || "CAD",
    allocations,
  };
}

export async function listQuickBooksPaymentsForCustomer(agencyId, customerId) {
  const rows = await queryAllQuickBooksCustomerTransactions(agencyId, "Payment", customerId);
  return rows.map(mapQuickBooksPaymentForLedger);
}

// QuickBooks creates the Payment itself when a client pays through the
// hosted invoice link — CaseDesk only finds out the invoice's balance
// dropped to zero, never which Payment record did it, so qbPaymentId was
// never captured for online payments (only the staff-recorded walk-in
// cash/e-transfer path creates the Payment directly and already knows its
// id). Without qbPaymentId, "Refund in QuickBooks" could only link to the
// Invoice screen, which doesn't pre-fill a refund — this resolves the
// actual Payment so that link lands on the Receive Payment screen instead,
// where QuickBooks' own Refund action is pre-filled with the right
// customer and amount.
export async function findQuickBooksPaymentForInvoice(agencyId, customerId, invoiceId) {
  if (!customerId || !invoiceId) return null;
  const payments = await listQuickBooksPaymentsForCustomer(agencyId, customerId);
  return payments.find((payment) => payment.allocations.some((allocation) => allocation.invoiceId === invoiceId)) || null;
}

export async function findQuickBooksPaymentIdForInvoice(agencyId, customerId, invoiceId) {
  const payment = await findQuickBooksPaymentForInvoice(agencyId, customerId, invoiceId);
  return payment?.id || null;
}

export async function listQuickBooksInvoicesForCustomer(agencyId, customerId) {
  const rows = await queryAllQuickBooksCustomerTransactions(agencyId, "Invoice", customerId);
  return rows.map(mapQuickBooksInvoice);
}

export async function listQuickBooksRefundReceiptsForCustomer(agencyId, customerId) {
  const rows = await queryAllQuickBooksCustomerTransactions(agencyId, "RefundReceipt", customerId);
  return rows.map(mapQuickBooksRefundReceipt);
}

// Voids an abandoned/expired invoice so it doesn't sit Open in QuickBooks
// forever once a payment hold expires unpaid. A void preserves the
// transaction's audit trail; a hard delete would permanently remove it
// and can strand a late QuickBooks payment as unapplied.
export async function voidQuickBooksInvoice(agencyId, { id, syncToken }) {
  await qboRequest(agencyId, {
    method: "POST",
    path: "/invoice?operation=void",
    body: { Id: id, SyncToken: syncToken },
  });
}

// Removes the Receive Payment transaction itself — distinct from a refund.
// This says "this payment record never should have posted" and reopens
// the invoice's balance with no implication money moved; a refund says
// real money is being returned. Correcting a duplicate/mistaken payment
// entry is this, not a refund.
//
// QuickBooks' own Payment void operation (operation=void) is not a general
// reversal — confirmed live against a real e-transfer payment, it rejects
// with "You can't void this credit card amount because this transaction
// doesn't have an outstanding credit card amount." Void is reserved for
// cancelling a pending *credit card* charge before it settles. Deleting
// the transaction outright is QuickBooks' actual mechanism for erasing a
// non-card payment record that should never have existed. Reads a fresh
// SyncToken first since the one CaseDesk stored at creation time goes
// stale the moment QuickBooks touches the payment again for any reason.
export async function deleteQuickBooksPayment(agencyId, { id }) {
  const current = await getQuickBooksPayment(agencyId, id);
  await qboRequest(agencyId, {
    method: "POST",
    path: "/payment?operation=delete",
    body: { Id: current.id, SyncToken: current.syncToken },
  });
}

export async function findOrCreateQuickBooksPaymentMethod(agencyId, name) {
  const normalizedName = String(name || "").trim().slice(0, 50);
  if (!normalizedName) throw createHttpError(400, "A payment method is required.", "VALIDATION_ERROR");
  const findExisting = async () => {
    const payload = await qboRequest(agencyId, {
      path: "/query",
      query: "SELECT * FROM PaymentMethod MAXRESULTS 1000",
    });
    return (payload.QueryResponse?.PaymentMethod || []).find(
      (method) => method.Active !== false && String(method.Name || "").trim().toLowerCase() === normalizedName.toLowerCase(),
    );
  };
  const existing = await findExisting();
  if (existing) return { id: existing.Id, name: existing.Name };
  try {
    const payload = await qboRequest(agencyId, {
      method: "POST",
      path: "/paymentmethod",
      body: { Name: normalizedName, Type: "NON_CREDIT_CARD" },
    });
    return { id: payload.PaymentMethod.Id, name: payload.PaymentMethod.Name };
  } catch (error) {
    if (!isQuickBooksDuplicateNameError(error)) throw error;
    const raced = await findExisting();
    if (raced) return { id: raced.Id, name: raced.Name };
    throw error;
  }
}

export async function createQuickBooksReceivePayment(agencyId, {
  customerId,
  invoiceId,
  amount,
  paymentMethodId,
  paymentReference,
  transactionDate,
  privateNote,
  requestId,
}) {
  const payload = await qboRequest(agencyId, {
    method: "POST",
    path: "/payment",
    requestId,
    body: {
      CustomerRef: { value: customerId },
      TotalAmt: amount,
      ...(paymentMethodId ? { PaymentMethodRef: { value: paymentMethodId } } : {}),
      ...(paymentReference ? { PaymentRefNum: String(paymentReference).slice(0, 21) } : {}),
      ...(transactionDate ? { TxnDate: transactionDate } : {}),
      ...(privateNote ? { PrivateNote: String(privateNote).slice(0, 4000) } : {}),
      Line: [{ Amount: amount, LinkedTxn: [{ TxnId: invoiceId, TxnType: "Invoice" }] }],
    },
  });
  return mapQuickBooksPaymentForLedger(payload.Payment);
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
