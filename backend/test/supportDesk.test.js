import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { supportRecipient } from "../src/services/supportTicketService.js";

const source = (relativePath) => readFile(new URL(relativePath, import.meta.url), "utf8");

test("support reports are durable, tenant scoped, and delivered to the configured developer recipient", async () => {
  const [migration, service] = await Promise.all([
    source("../prisma/migrations/20260817223000_add_support_tickets/migration.sql"),
    source("../src/services/supportTicketService.js"),
  ]);
  assert.match(migration, /CREATE TABLE "support_tickets"/);
  assert.match(migration, /FOREIGN KEY \("agency_id"\) REFERENCES "agencies"/);
  assert.match(migration, /ENABLE ROW LEVEL SECURITY/);
  assert.match(service, /WHERE "agency_id" = \$\{agencyId\} AND "reported_by_id" = \$\{userId\}/);
  assert.equal(supportRecipient({}), "info.harwinder14@gmail.com");
  assert.equal(supportRecipient({ CASEDESK_SUPPORT_EMAIL: "developer@example.com" }), "developer@example.com");
});

test("support API is staff-only, rate limited, and accepts a bounded screenshot", async () => {
  const [server, routes, upload] = await Promise.all([
    source("../src/server.js"),
    source("../src/routes/supportRoutes.js"),
    source("../src/middleware/supportScreenshotUpload.js"),
  ]);
  assert.match(server, /app\.use\("\/api\/support", requireAuth, staffUser, supportRoutes\)/);
  assert.match(routes, /rateLimit\(\{ windowMs: 60_000, max: 5 \}\)/);
  assert.match(upload, /fileSize: 2 \* 1024 \* 1024/);
  assert.match(upload, /image\/jpeg/);
});

test("Chats and its floating widget expose Help while automatic captures stay local until submission", async () => {
  const [chats, widget, panel, capture, api] = await Promise.all([
    source("../../frontend/src/pages/ChatsPage.jsx"),
    source("../../frontend/src/components/chat/FloatingChatWidget.jsx"),
    source("../../frontend/src/components/chat/SupportDeskPanel.jsx"),
    source("../../frontend/src/services/supportCapture.js"),
    source("../../frontend/src/services/api.js"),
  ]);
  assert.match(chats, /name: "Help & Support"/);
  assert.match(chats, /<SupportDeskPanel/);
  assert.match(widget, /name: "Help & Support"/);
  assert.match(widget, /<SupportDeskPanel compact \/>/);
  assert.match(capture, /html2canvas\(document\.body/);
  assert.match(capture, /input, textarea, \[data-support-private\], canvas/);
  assert.match(capture, /automatic: error\.code !== "USER_REPORTED"/);
  assert.doesNotMatch(capture, /api\.post|fetch\(/);
  assert.match(api, /status >= 500/);
  assert.match(api, /notify: false/);
  assert.match(panel, /Summarize with Nova/);
  assert.match(panel, /Nova summarizes your written report and does not inspect the screenshot/);
  assert.match(panel, /disabled=\{Boolean\(busy\)\}/);
  assert.match(panel, /Review the image before sending/);
});

test("a manual support screenshot does not show the automatic error-capture notice", async () => {
  const notice = await source("../../frontend/src/components/support/SupportCaptureNotice.jsx");
  assert.match(notice, /event\.detail\?\.automatic && event\.detail\?\.notify/);
});

test("Nova support diagnosis remains text-only and never receives the screenshot", async () => {
  const [controller, ollama] = await Promise.all([
    source("../src/controllers/supportController.js"),
    source("../src/services/ollama.service.js"),
  ]);
  assert.match(controller, /summarizeSupportIssue\(context\)/);
  assert.doesNotMatch(controller, /req\.file.*summarizeSupportIssue/);
  assert.match(ollama, /You summarize CaseDesk software bug reports for a developer/);
  assert.doesNotMatch(ollama.slice(ollama.indexOf("export async function summarizeSupportIssue")), /images:/);
});
