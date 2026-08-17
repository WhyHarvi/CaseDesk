import { randomBytes, randomUUID } from "node:crypto";
import path from "node:path";
import prisma from "./prisma/client.js";
import { sendEmailMessage } from "./communicationProviderService.js";
import { DOCUMENT_BUCKET, removeStorageFile, uploadStorageFile } from "./supabaseStorage.js";

const SUPPORT_RECIPIENT = "info.harwinder14@gmail.com";

const clean = (value, max = 1000) => String(value || "").trim().slice(0, max);
const escapeHtml = (value) => clean(value, 10_000)
  .replace(/&/g, "&amp;")
  .replace(/</g, "&lt;")
  .replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;")
  .replace(/'/g, "&#039;");

export function supportRecipient(environment = process.env) {
  return clean(environment.CASEDESK_SUPPORT_EMAIL || SUPPORT_RECIPIENT, 320);
}

function ticketNumber() {
  const date = new Date().toISOString().slice(0, 10).replaceAll("-", "");
  return `SUP-${date}-${randomBytes(3).toString("hex").toUpperCase()}`;
}

export async function createSupportTicket({ agencyId, user, values, screenshot }) {
  const id = randomUUID();
  const number = ticketNumber();
  const description = clean(values.description, 5000);
  const novaSummary = clean(values.novaSummary, 5000) || null;
  const pagePath = clean(values.pagePath, 500) || null;
  const errorCode = clean(values.errorCode, 120) || null;
  const errorMessage = clean(values.errorMessage, 1000) || null;
  let diagnostics = {};
  try { diagnostics = JSON.parse(values.diagnostics || "{}"); } catch { diagnostics = {}; }
  diagnostics = {
    browser: clean(diagnostics.browser, 300) || null,
    viewport: clean(diagnostics.viewport, 80) || null,
    occurredAt: clean(diagnostics.occurredAt, 80) || null,
    requestId: clean(diagnostics.requestId, 120) || null,
    status: Number(diagnostics.status) || null,
  };

  let screenshotStorageKey = null;
  if (screenshot?.buffer?.length) {
    const extension = screenshot.mimetype === "image/png" ? "png" : screenshot.mimetype === "image/webp" ? "webp" : "jpg";
    screenshotStorageKey = path.posix.join(agencyId, "support", id, `screenshot.${extension}`);
    await uploadStorageFile(DOCUMENT_BUCKET, screenshotStorageKey, screenshot.buffer, screenshot.mimetype);
  }

  try {
    await prisma.$executeRaw`
      INSERT INTO "support_tickets" (
        "id", "ticket_number", "agency_id", "reported_by_id", "description", "nova_summary",
        "page_path", "error_code", "error_message", "diagnostics", "screenshot_storage_key", "screenshot_mime_type"
      ) VALUES (
        ${id}, ${number}, ${agencyId}, ${user.id}, ${description}, ${novaSummary},
        ${pagePath}, ${errorCode}, ${errorMessage}, ${JSON.stringify(diagnostics)}::jsonb,
        ${screenshotStorageKey}, ${screenshot?.mimetype || null}
      )
    `;
  } catch (error) {
    if (screenshotStorageKey) await removeStorageFile(DOCUMENT_BUCKET, screenshotStorageKey).catch(() => {});
    throw error;
  }

  const subject = `[CaseDesk Support] ${number} · ${pagePath || "Application issue"}`;
  const text = [
    `Ticket: ${number}`,
    `Agency: ${clean(user.agencyName, 300) || agencyId}`,
    `Reported by: ${user.fullName} (${user.email})`,
    `Page: ${pagePath || "Not supplied"}`,
    errorCode ? `Error: ${errorCode}${errorMessage ? ` · ${errorMessage}` : ""}` : null,
    "",
    "Nova summary:",
    novaSummary || "Not generated",
    "",
    "User report:",
    description,
    "",
    `Diagnostics: ${JSON.stringify(diagnostics)}`,
  ].filter((line) => line !== null).join("\n");
  const html = `<h2>${escapeHtml(number)}</h2><p><strong>Agency:</strong> ${escapeHtml(user.agencyName || agencyId)}<br><strong>Reported by:</strong> ${escapeHtml(user.fullName)} (${escapeHtml(user.email)})<br><strong>Page:</strong> ${escapeHtml(pagePath || "Not supplied")}</p>${errorCode ? `<p><strong>Error:</strong> ${escapeHtml(errorCode)}${errorMessage ? ` · ${escapeHtml(errorMessage)}` : ""}</p>` : ""}<h3>Nova summary</h3><p>${escapeHtml(novaSummary || "Not generated").replace(/\n/g, "<br>")}</p><h3>User report</h3><p>${escapeHtml(description).replace(/\n/g, "<br>")}</p>`;

  try {
    await sendEmailMessage({
      agencyId,
      to: supportRecipient(),
      replyTo: user.email,
      subject,
      text,
      html,
      attachments: screenshot?.buffer?.length
        ? [{ filename: `casedesk-${number}-screenshot.png`, content: screenshot.buffer, contentType: screenshot.mimetype }]
        : [],
      headers: { "X-CaseDesk-Support-Ticket": number },
    });
    await prisma.$executeRaw`UPDATE "support_tickets" SET "delivery_status" = 'Delivered', "delivered_at" = NOW(), "updated_at" = NOW() WHERE "id" = ${id}`;
    return { id, ticketNumber: number, status: "Submitted", deliveryStatus: "Delivered", createdAt: new Date().toISOString() };
  } catch (error) {
    await prisma.$executeRaw`UPDATE "support_tickets" SET "delivery_status" = 'Failed', "delivery_error" = ${clean(error.message, 1000)}, "updated_at" = NOW() WHERE "id" = ${id}`;
    return { id, ticketNumber: number, status: "Submitted", deliveryStatus: "Failed", deliveryMessage: "The report was saved, but email delivery is pending mailbox recovery.", createdAt: new Date().toISOString() };
  }
}

export async function listUserSupportTickets(agencyId, userId) {
  return prisma.$queryRaw`
    SELECT "id", "ticket_number" AS "ticketNumber", "status", "description", "nova_summary" AS "novaSummary",
      "page_path" AS "pagePath", "error_code" AS "errorCode", "delivery_status" AS "deliveryStatus", "created_at" AS "createdAt"
    FROM "support_tickets"
    WHERE "agency_id" = ${agencyId} AND "reported_by_id" = ${userId}
    ORDER BY "created_at" DESC
    LIMIT 50
  `;
}
