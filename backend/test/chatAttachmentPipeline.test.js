import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = (relativePath) => readFile(new URL(relativePath, import.meta.url), "utf8");

test("a chat message can accept an empty body when an attachment is coming, but every other channel still requires content", async () => {
  const [communicationController, portalController, clientCommunicationController] = await Promise.all([
    source("../src/controllers/communicationController.js"),
    source("../src/controllers/portalController.js"),
    source("../src/controllers/clientCommunicationController.js"),
  ]);

  // Staff-side: the original "content is required" guard is still there in
  // full — hasAttachment only adds a narrow escape hatch, it doesn't
  // replace the check.
  assert.match(communicationController, /const hasAttachment = channel === "Chat" && req\.body\.hasAttachment === true;/);
  assert.match(communicationController, /if \(channel !== "Call" && !bodyText && !subject && !hasAttachment\)/);
  assert.match(communicationController, /throw createHttpError\(400, "Message content is required"\);/);

  // Portal + token-link: same shape, empty body only excused by the flag.
  assert.match(portalController, /const hasAttachment = req\.body\.hasAttachment === true;/);
  assert.match(portalController, /if \(!bodyText && !hasAttachment\)/);
  assert.match(clientCommunicationController, /const hasAttachment = req\.body\.hasAttachment === true;/);
  assert.match(clientCommunicationController, /if \(!bodyText && !hasAttachment\) throw createHttpError\(400, "Write a message before sending"\);/);
});

test("an attachment-pending chat message defers its realtime broadcast until the file actually finishes uploading", async () => {
  const [communicationController, portalController, clientCommunicationController, attachmentController, storageService] = await Promise.all([
    source("../src/controllers/communicationController.js"),
    source("../src/controllers/portalController.js"),
    source("../src/controllers/clientCommunicationController.js"),
    source("../src/controllers/communicationAttachmentController.js"),
    source("../src/services/communicationAttachmentStorage.js"),
  ]);

  // None of the three creation paths broadcast when hasAttachment is set —
  // a recipient must never see an empty bubble before the file appears.
  assert.match(communicationController, /if \(channel === "Chat" && caseItem && !hasAttachment\) \{/);
  assert.match(portalController, /if \(caseItem && !hasAttachment\)/);
  assert.match(clientCommunicationController, /if \(!hasAttachment\)\s*\n\s*await broadcastCaseCommunication/);

  // The broadcast that was skipped at creation time fires instead once the
  // attachment is stored — in the shared service, not duplicated per
  // controller.
  assert.doesNotMatch(attachmentController, /broadcastCaseCommunication/);
  assert.match(storageService, /if \(message\.channel === "Chat" && message\.caseId\) \{/);
  assert.match(storageService, /await broadcastCaseCommunication\(/);
});

test("the attachment status gate still requires Draft/Failed for Email and SMS, and only widens for a chat sender's own just-sent message within a grace window", async () => {
  const controller = await source("../src/controllers/communicationAttachmentController.js");
  const uploadFn = controller.slice(
    controller.indexOf("export async function uploadCommunicationAttachment"),
    controller.indexOf("export async function serveCommunicationAttachment"),
  );
  // The original gate is untouched — this is an additive OR, not a
  // replacement, so Email/SMS drafts keep working exactly as before.
  assert.match(uploadFn, /const chatAttachAllowed =\s*\n\s*message\.channel === "Chat" &&\s*\n\s*message\.status === "Sent" &&\s*\n\s*message\.senderUserId === req\.user\.id &&\s*\n\s*Date\.now\(\) - message\.createdAt\.getTime\(\) < CHAT_ATTACH_GRACE_MS;/);
  assert.match(uploadFn, /if \(!\["Draft", "Failed"\]\.includes\(message\.status\) && !chatAttachAllowed\)/);

  const deleteFn = controller.slice(controller.indexOf("export async function deleteCommunicationAttachment"));
  // Deleting an attachment was deliberately NOT widened — retracting a
  // sent chat attachment isn't in scope, only attaching one is.
  assert.match(deleteFn, /if \(!\["Draft", "Failed"\]\.includes\(data\.message\.status\)\)/);
});

test("the portal and token-link attachment endpoints are scoped to the requesting client/access and reuse the shared storage service, not a copy of it", async () => {
  const [portalController, portalRoutes, clientCommunicationController, clientCommunicationRoutes] = await Promise.all([
    source("../src/controllers/portalController.js"),
    source("../src/routes/portalRoutes.js"),
    source("../src/controllers/clientCommunicationController.js"),
    source("../src/routes/clientCommunicationRoutes.js"),
  ]);

  const portalUpload = portalController.slice(
    portalController.indexOf("export async function uploadPortalMessageAttachment"),
    portalController.indexOf("export async function servePortalMessageAttachment"),
  );
  assert.match(portalUpload, /clientId: link\.clientId,/);
  assert.match(portalUpload, /channel: "Chat",/);
  assert.match(portalUpload, /message\.senderUserId === req\.auth\.userId &&/);
  assert.match(portalUpload, /storeCommunicationAttachment\(\{/);
  assert.match(portalRoutes, /router\.post\("\/messages\/:id\/attachments", rateLimit\(\{ windowMs: 60_000, max: 10 \}\), receiveDocumentFile, asyncHandler\(uploadPortalMessageAttachment\)\);/);
  assert.match(portalRoutes, /router\.get\("\/messages\/:id\/attachments\/:attachmentId\/file", asyncHandler\(servePortalMessageAttachment\)\);/);

  const tokenUpload = clientCommunicationController.slice(
    clientCommunicationController.indexOf("export async function uploadClientChatAttachment"),
    clientCommunicationController.indexOf("export async function serveClientChatAttachment"),
  );
  assert.match(tokenUpload, /caseId: access\.caseId,/);
  assert.match(tokenUpload, /direction: "Inbound",/);
  assert.match(tokenUpload, /storeCommunicationAttachment\(\{/);
  assert.match(clientCommunicationRoutes, /router\.post\("\/:token\/messages\/:id\/attachments", receiveDocumentFile, asyncHandler\(uploadClientChatAttachment\)\);/);
  assert.match(clientCommunicationRoutes, /router\.get\("\/:token\/messages\/:id\/attachments\/:attachmentId\/file", asyncHandler\(serveClientChatAttachment\)\);/);

  // Neither new controller re-defines scanFile/inboundAllowedMimeTypes/
  // extensionOf locally — they only exist once, in the shared service.
  for (const fileSource of [portalController, clientCommunicationController]) {
    assert.doesNotMatch(fileSource, /function scanFile\(/);
    assert.doesNotMatch(fileSource, /const inboundAllowedMimeTypes = new Set/);
  }
});

test("chat message lists on the portal and token-link surfaces now include each message's attachments, matching the staff-side field shape", async () => {
  const [portalController, clientCommunicationController, communicationController] = await Promise.all([
    source("../src/controllers/portalController.js"),
    source("../src/controllers/clientCommunicationController.js"),
    source("../src/controllers/communicationController.js"),
  ]);
  const attachmentSelect = /attachmentRecords: \{\s*\n\s*select: \{ id: true, originalFilename: true, mimeType: true, fileSize: true, scanStatus: true, createdAt: true \},\s*\n\s*\},/;
  assert.match(portalController, attachmentSelect);
  assert.match(clientCommunicationController, attachmentSelect);
  // Staff side already had this — confirms the field name/shape actually
  // matches instead of inventing a second convention.
  assert.match(communicationController, /attachmentRecords: \{\s*\n\s*select: \{\s*\n\s*id: true,\s*\n\s*originalFilename: true,\s*\n\s*mimeType: true,\s*\n\s*fileSize: true,\s*\n\s*scanStatus: true,\s*\n\s*createdAt: true,\s*\n\s*\},\s*\n\s*\},/);
});
