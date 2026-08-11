import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = (relativePath) => readFile(new URL(relativePath, import.meta.url), "utf8");

test("internal chat has its own purpose-built models, not a bolt-on to client communication", async () => {
  const schema = await source("../prisma/schema.prisma");
  assert.match(schema, /model InternalChatThread \{/);
  assert.match(schema, /model InternalChatParticipant \{/);
  assert.match(schema, /model InternalChatMessage \{/);
  assert.match(schema, /model InternalChatAttachment \{/);
  // The per-participant read-receipt field is the whole reason this is a
  // join table and not a single column on the thread.
  assert.match(schema, /lastReadAt DateTime\?\s+@map\("last_read_at"\)/);
  assert.match(schema, /@@unique\(\[threadId, userId\]\)/);
});

test("internal chat realtime uses its own thread: topic namespace, separate from case chat", async () => {
  const service = await source("../src/services/supabaseRealtimeService.js");
  assert.match(service, /export function internalThreadTopic\(agencyId, threadId\) \{/);
  assert.match(service, /`thread:\$\{agencyId\}:\$\{threadId\}`/);
  // createRealtimeToken/getRealtimeClientConfig are extended, not replaced —
  // existing case-chat callers (which never pass threadId) must keep
  // resolving to the case-scoped topic exactly as before.
  assert.match(service, /topic: threadId \? internalThreadTopic\(agencyId, threadId\) : communicationTopic\(agencyId, caseId\)/);
  assert.match(service, /export async function broadcastInternalChatMessage/);

  const rls = await source("../prisma/migrations/20260812001000_internal_chat_realtime_policies/migration.sql");
  assert.match(rls, /CREATE POLICY "casedesk_internal_chat_read"/);
  assert.match(rls, /CREATE POLICY "casedesk_internal_chat_write"/);
  assert.match(rls, /'thread:' \|\|/);
  assert.match(rls, /auth\.jwt\(\) ->> 'thread_id'/);
});

test("only active same-agency staff (not clients) can be messaged or added to a thread", async () => {
  const controller = await source("../src/controllers/internalChatController.js");
  assert.match(controller, /const staffRoles = new Set\(\["admin", "consultant", "frontdesk"\]\);/);

  const colleagues = controller.slice(
    controller.indexOf("export async function listMyColleagues"),
    controller.indexOf("export async function listThreads"),
  );
  assert.match(colleagues, /status: "active",/);
  assert.match(colleagues, /id: \{ not: req\.auth\.userId \}/);
  assert.match(colleagues, /role: \{ in: \[\.\.\.staffRoles\] \}/);

  const create = controller.slice(
    controller.indexOf("export async function createThread"),
    controller.indexOf("export async function getThread"),
  );
  assert.match(create, /validTargets\.length !== requestedIds\.length/);
  assert.match(create, /agencyId: req\.auth\.agencyId,\s*\n\s*status: "active",/);
});

test("a 1:1 DM is found-or-created (never duplicated) while 3+ participants always become a group", async () => {
  const controller = await source("../src/controllers/internalChatController.js");
  const create = controller.slice(
    controller.indexOf("export async function createThread"),
    controller.indexOf("export async function getThread"),
  );
  assert.match(create, /const isGroup = allParticipantIds\.length > 2;/);
  assert.match(create, /isGroup: false,[\s\S]{0,200}AND: allParticipantIds\.map/);
  assert.match(create, /if \(existing\) return res\.json\(\{ data: existing \}\);/);
});

test("only a thread's own participants can read or post to it — everyone else gets a 404, not a 403", async () => {
  const controller = await source("../src/controllers/internalChatController.js");
  assert.match(controller, /async function requireParticipant\(req, threadId\) \{/);
  const fn = controller.slice(
    controller.indexOf("async function requireParticipant"),
    controller.indexOf("function displayName"),
  );
  // 404, not 403 — matches the existing scopedCase/scopedConversation
  // convention of not revealing that a resource exists to a non-member.
  assert.match(fn, /throw createHttpError\(404, "Conversation not found", "NOT_FOUND"\);/);
  assert.match(controller, /await requireParticipant\(req, req\.params\.id\);/);
});

test("group read receipts require every other participant to have read a message, not just one", async () => {
  const controller = await source("../src/controllers/internalChatController.js");
  const getThread = controller.slice(
    controller.indexOf("export async function getThread"),
    controller.indexOf("export async function createMessage"),
  );
  // The per-participant lastReadAt is returned to the client so it can
  // compute the "read by everyone" tick — the server doesn't collapse it
  // into a single boolean, since the correct blue-tick rule needs the
  // full per-person breakdown.
  assert.match(getThread, /participants: thread\.participants\.map\(\(item\) => \(\{ \.\.\.item\.user, lastReadAt: item\.lastReadAt \}\)\)/);
});

test("an attachment-only message is allowed with an empty body and defers its broadcast until the file lands", async () => {
  const [controller, storage] = await Promise.all([
    source("../src/controllers/internalChatController.js"),
    source("../src/services/internalChatAttachmentStorage.js"),
  ]);
  const createMessage = controller.slice(
    controller.indexOf("export async function createMessage"),
    controller.indexOf("export async function getThreadRealtimeConfig"),
  );
  assert.match(createMessage, /if \(!bodyText && !hasAttachment\) throw createHttpError\(400, "Message content is required"/);
  assert.match(createMessage, /if \(!hasAttachment\) \{/);
  assert.match(storage, /await broadcastInternalChatMessage\(\{/);
  // Reuses the scanning primitives rather than re-implementing them.
  assert.match(storage, /import \{ extensionOf, scanFile \} from "\.\/communicationAttachmentStorage\.js";/);
});

test("a chat message just created here can accept an attachment within the shared grace window, own-message only", async () => {
  const controller = await source("../src/controllers/internalChatController.js");
  const upload = controller.slice(
    controller.indexOf("export async function uploadThreadAttachment"),
    controller.indexOf("export async function serveThreadAttachment"),
  );
  assert.match(upload, /message\.senderId === req\.auth\.userId && Date\.now\(\) - message\.createdAt\.getTime\(\) < CHAT_ATTACH_GRACE_MS/);
  assert.match(controller, /import \{ CHAT_ATTACH_GRACE_MS, storeInternalChatAttachment \} from "\.\.\/services\/internalChatAttachmentStorage\.js";/);
});

test("a new team chat message notifies every other participant through the generic notification system", async () => {
  const controller = await source("../src/controllers/internalChatController.js");
  const createMessage = controller.slice(
    controller.indexOf("export async function createMessage"),
    controller.indexOf("export async function getThreadRealtimeConfig"),
  );
  assert.match(createMessage, /type: "internal_chat\.message_received",/);
  assert.match(createMessage, /destinationKey: "teamChat",/);
  assert.match(createMessage, /dedupeKey: `thread:\$\{req\.params\.id\}:unread`,/);
  assert.match(createMessage, /aggregate: true,/);
  // Notification failures must never fail the message send itself.
  assert.match(createMessage, /\}\)\.catch\(\(\) => \{\}\);/);

  const notificationService = await source("../src/services/notificationService.js");
  assert.match(notificationService, /"teamChat",/);
  assert.match(notificationService, /\["\/team-chat", "teamChat"\],/);
});

test("internal chat is mounted for staff roles only, alongside the rest of the internal API", async () => {
  const server = await source("../src/server.js");
  assert.match(server, /import internalChatRoutes from "\.\/routes\/internalChatRoutes\.js";/);
  assert.match(server, /app\.use\("\/api\/internal-chat", requireAuth, staffUser, internalChatRoutes\);/);
});

test("internal chat routes cover the full colleague/thread/message/attachment surface", async () => {
  const routes = await source("../src/routes/internalChatRoutes.js");
  assert.match(routes, /router\.get\("\/colleagues", asyncHandler\(listMyColleagues\)\);/);
  assert.match(routes, /router\.get\("\/threads", asyncHandler\(listThreads\)\);/);
  assert.match(routes, /router\.post\("\/threads", rateLimit\(/);
  assert.match(routes, /router\.get\("\/threads\/:id", asyncHandler\(getThread\)\);/);
  assert.match(routes, /router\.get\("\/threads\/:id\/realtime", asyncHandler\(getThreadRealtimeConfig\)\);/);
  assert.match(routes, /router\.post\("\/threads\/:id\/read", asyncHandler\(markThreadRead\)\);/);
  assert.match(routes, /router\.post\("\/threads\/:id\/messages", rateLimit\(/);
  assert.match(routes, /threads\/:id\/messages\/:messageId\/attachments",\s*\n\s*rateLimit\(/);
  assert.match(routes, /router\.get\("\/threads\/:id\/attachments\/:attachmentId\/file", asyncHandler\(serveThreadAttachment\)\);/);
});
