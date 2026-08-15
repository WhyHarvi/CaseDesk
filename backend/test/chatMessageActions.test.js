import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = (relativePath) => readFile(new URL(relativePath, import.meta.url), "utf8");

test("schema adds reply/edit to internal chat and a reaction table for each chat system", async () => {
  const schema = await source("../prisma/schema.prisma");
  assert.match(schema, /replyToId\s+String\?\s+@map\("reply_to_id"\)/);
  assert.match(schema, /editedAt\s+DateTime\?\s+@map\("edited_at"\)/);
  assert.match(schema, /model InternalChatMessageReaction \{/);
  assert.match(schema, /model CommunicationMessageReaction \{/);
  assert.match(schema, /@@unique\(\[messageId, userId, emoji\]\)/);
  // CommunicationMessage itself gets no editedAt column — client-chat
  // messages are part of the case record and never get a silent edit path.
  const communicationMessageBlock = schema.slice(schema.indexOf("model CommunicationMessage {"), schema.indexOf("model CommunicationMessageReaction"));
  assert.doesNotMatch(communicationMessageBlock, /editedAt/);
});

test("internal chat message edit and delete are sender-only", async () => {
  const controller = await source("../src/controllers/internalChatController.js");
  const updateFn = controller.slice(controller.indexOf("export async function updateMessage"), controller.indexOf("export async function deleteMessage"));
  assert.match(updateFn, /if \(message\.senderId !== req\.auth\.userId\) throw createHttpError\(403, "You can only edit your own messages", "FORBIDDEN"\);/);
  assert.match(updateFn, /data: \{ bodyText, editedAt: new Date\(\) \}/);

  const deleteFn = controller.slice(controller.indexOf("export async function deleteMessage"), controller.indexOf("export async function toggleReaction"));
  assert.match(deleteFn, /if \(message\.senderId !== req\.auth\.userId\) throw createHttpError\(403, "You can only delete your own messages", "FORBIDDEN"\);/);
  assert.match(deleteFn, /data: \{ deletedAt: new Date\(\) \}/);
});

test("internal chat reactions are a fixed tapback-style set, toggled per user per emoji", async () => {
  const controller = await source("../src/controllers/internalChatController.js");
  assert.match(controller, /const REACTION_EMOJI = new Set\(\["👍", "❤️", "😂", "😮", "😢", "🙏"\]\);/);
  const toggleFn = controller.slice(controller.indexOf("export async function toggleReaction"), controller.indexOf("export async function getThreadRealtimeConfig"));
  assert.match(toggleFn, /if \(!REACTION_EMOJI\.has\(emoji\)\) throw createHttpError\(400, "Unsupported reaction", "VALIDATION_ERROR"\);/);
  assert.match(toggleFn, /messageId_userId_emoji: \{ messageId: message\.id, userId: req\.auth\.userId, emoji \}/);
  assert.match(toggleFn, /await prisma\.internalChatMessageReaction\.delete/);
  assert.match(toggleFn, /await prisma\.internalChatMessageReaction\.create/);
});

test("internal chat createMessage accepts and validates a reply target within the same thread", async () => {
  const controller = await source("../src/controllers/internalChatController.js");
  const createFn = controller.slice(controller.indexOf("export async function createMessage"), controller.indexOf("async function rebroadcast"));
  assert.match(createFn, /const replyToId = clean\(req\.body\.replyToId, 100\) \|\| null;/);
  assert.match(createFn, /where: \{ id: replyToId, threadId: req\.params\.id, deletedAt: null \}/);
  assert.match(createFn, /throw createHttpError\(404, "The message you're replying to could not be found", "NOT_FOUND"\);/);
  assert.match(createFn, /replyToId,/);
});

test("internal chat messageInclude surfaces reply-to and reactions for the thread view", async () => {
  const controller = await source("../src/controllers/internalChatController.js");
  const includeBlock = controller.slice(controller.indexOf("const messageInclude ="), controller.indexOf("async function requireParticipant"));
  assert.match(includeBlock, /replyTo: \{/);
  assert.match(includeBlock, /reactions: \{ select: reactionSelect \}/);
});

test("internal chat routes expose edit, delete, and reactions", async () => {
  const routes = await source("../src/routes/internalChatRoutes.js");
  assert.match(routes, /router\.patch\("\/threads\/:id\/messages\/:messageId", rateLimit\(/);
  assert.match(routes, /router\.delete\("\/threads\/:id\/messages\/:messageId", asyncHandler\(deleteMessage\)\);/);
  assert.match(routes, /router\.post\("\/threads\/:id\/messages\/:messageId\/reactions", rateLimit\(/);
});

test("client chat reuses parentMessageId for reply (no new column) and adds reactions without an edit path", async () => {
  const [controller, routes] = await Promise.all([
    source("../src/controllers/communicationController.js"),
    source("../src/routes/communicationRoutes.js"),
  ]);
  const includeBlock = controller.slice(controller.indexOf("const messageInclude ="), controller.indexOf("function clean("));
  assert.match(includeBlock, /parentMessage: \{/);
  assert.match(includeBlock, /reactions: \{/);

  const reactionFn = controller.slice(
    controller.indexOf("export async function toggleCommunicationMessageReaction"),
    controller.indexOf("export async function bulkDeleteCommunication"),
  );
  assert.match(controller, /const reactionEmoji = new Set\(\["👍", "❤️", "😂", "😮", "😢", "🙏"\]\);/);
  assert.match(reactionFn, /messageId_userId_emoji: \{ messageId: message\.id, userId: req\.user\.id, emoji \}/);
  assert.match(reactionFn, /await audit\(req, \{/);

  assert.match(routes, /router\.post\("\/messages\/:id\/reactions", asyncHandler\(toggleCommunicationMessageReaction\)\);/);
  // No edit endpoint anywhere in this router — client-chat messages are
  // part of the case record and are never silently rewritten.
  assert.doesNotMatch(routes, /router\.patch\("\/messages\/:id"[^/]/);
});

test("the Chats page only ever shows edit for internal messages you sent, never for client chat", async () => {
  const page = await source("../../frontend/src/pages/ChatsPage.jsx");
  const fn = page.slice(page.indexOf("function canEditMessage"), page.indexOf("function canDeleteMessage"));
  assert.match(fn, /return selectedKind === "internal" && message\.senderId === myUserId/);

  const deleteFn = page.slice(page.indexOf("function canDeleteMessage"), page.indexOf("const replyTargetLabel"));
  assert.match(deleteFn, /return Boolean\(commPermissions\.canDelete\);/);
});

test("ChatMessageBubble supports reply, react, edit, and delete as optional props (inert unless a caller wires them)", async () => {
  const bubble = await source("../../frontend/src/components/chat/ChatMessageBubble.jsx");
  assert.match(bubble, /const REACTION_EMOJI = \["👍", "❤️", "😂", "😮", "😢", "🙏"\];/);
  assert.match(bubble, /function ReactionPicker/);
  assert.match(bubble, /function groupReactions/);
  assert.match(bubble, /const replySource = message\.replyTo \|\| message\.parentMessage;/);
  assert.match(bubble, /message\.editedAt \? <span className="italic">Edited<\/span> : null/);

  const composer = await source("../../frontend/src/components/chat/ChatComposer.jsx");
  assert.match(composer, /Replying to \{replyTargetLabel \|\| "message"\}/);
});

test("the floating quick-chat widget is mounted globally, opens to the recent-conversations list, and reuses existing endpoints (no new backend surface)", async () => {
  const [widget, layout] = await Promise.all([
    source("../../frontend/src/components/chat/FloatingChatWidget.jsx"),
    source("../../frontend/src/layouts/MainLayout.jsx"),
  ]);
  assert.match(layout, /import FloatingChatWidget from "\.\.\/components\/chat\/FloatingChatWidget";/);
  assert.match(layout, /<FloatingChatWidget \/>/);
  // Hidden on the full Chats page itself — showing a launcher on top of
  // the page it launches would be redundant.
  assert.match(widget, /if \(typeof document === "undefined" \|\| location\.pathname === "\/app\/chats"\) return null;/);
  // Opening always lands on the list, never jumps straight into a thread.
  assert.match(widget, /const \[view, setView\] = useState\("list"\);/);
  assert.doesNotMatch(widget, /casedesk:quickChat:lastConversation/);
  // No new API surface — same endpoints ChatsPage.jsx already calls.
  assert.match(widget, /from "\.\.\/\.\.\/api\/internalChatApi"/);
  assert.match(widget, /api\.get\("\/communications\/inbox\?scope=all&channel=Chat&limit=50"\)/);
  // Reuses the same sidebar "chats" unread total shown on the nav item.
  assert.match(widget, /const unreadTotal = sidebarCounts\?\.chats\?\.total \|\| 0;/);
});

test("the quick-chat list has a search box that filters the merged conversation list", async () => {
  const widget = await source("../../frontend/src/components/chat/FloatingChatWidget.jsx");
  assert.match(widget, /const \[listSearch, setListSearch\] = useState\(""\);/);
  const filterFn = widget.slice(widget.indexOf("const filteredItems = useMemo"), widget.indexOf("// Ambient new-message detection"));
  assert.match(filterFn, /mergedItems\.filter\(\(item\) => `\$\{item\.name\} \$\{item\.preview\}`\.toLowerCase\(\)\.includes\(query\)\)/);
  assert.match(widget, /placeholder="Search chats"/);
  assert.match(widget, /value=\{listSearch\}/);
});

test("the widget stays ambient (not gated by open) so the badge/sound/preview work while collapsed, but not on the Chats page itself", async () => {
  const widget = await source("../../frontend/src/components/chat/FloatingChatWidget.jsx");
  assert.match(widget, /const isChatsRoute = location\.pathname === "\/app\/chats";/);
  const pollFn = widget.slice(widget.indexOf("useEffect(() => {\n    if (isChatsRoute) return undefined;"), widget.indexOf("const mergedItems = useMemo"));
  assert.match(pollFn, /void loadLists\(\{ silent: true \}\);/);
  assert.match(pollFn, /\}, AMBIENT_LIST_POLL_MS\);/);
});

test("a rise in any conversation's unread count plays the receive sound and, while collapsed, shows a dismissable preview bubble", async () => {
  const widget = await source("../../frontend/src/components/chat/FloatingChatWidget.jsx");
  const detectFn = widget.slice(widget.indexOf("const knownUnreadRef"), widget.indexOf("function openFromPreview"));
  // First pass just records a baseline — it must not treat existing unread
  // conversations as "new" the moment the widget mounts.
  assert.match(detectFn, /if \(!initializedUnreadRef\.current\) \{/);
  // Never double-fires for the conversation the user is actively reading —
  // that path already has its own sound trigger further down.
  assert.match(detectFn, /const isActivelyOpen = open && view === "thread" && selectedKind === item\.kind && selectedId === item\.id;/);
  assert.match(detectFn, /if \(item\.unreadCount > previousCount && !isActivelyOpen\)/);
  assert.match(detectFn, /playReceivedSound\(\);/);
  assert.match(detectFn, /if \(!open\) \{/);
  assert.match(detectFn, /setIncomingPreview\(newest\);/);

  const previewBlock = widget.slice(widget.indexOf("{incomingPreview && !open ? ("), widget.indexOf("<motion.button\n        type=\"button\"\n        onClick={toggleOpen}"));
  // Framer, already the project's animation library, drives the enter/exit —
  // no new dependency needed for "smooth".
  assert.match(previewBlock, /type: "spring", stiffness: 420, damping: 30/);
  assert.match(previewBlock, /onClick={openFromPreview}/);
});

test("schema adds a group photo to InternalChatThread, and the migration matches it exactly", async () => {
  const schema = await source("../prisma/schema.prisma");
  const threadBlock = schema.slice(schema.indexOf("model InternalChatThread {"), schema.indexOf("model InternalChatParticipant"));
  assert.match(threadBlock, /avatarStorageKey\s+String\?\s+@map\("avatar_storage_key"\)/);
  assert.match(threadBlock, /avatarMimeType\s+String\?\s+@map\("avatar_mime_type"\)/);

  const migration = await source("../prisma/migrations/20260812110000_internal_chat_thread_avatar/migration.sql");
  assert.match(migration, /ALTER TABLE "internal_chat_threads" ADD COLUMN "avatar_storage_key" TEXT;/);
  assert.match(migration, /ALTER TABLE "internal_chat_threads" ADD COLUMN "avatar_mime_type" TEXT;/);
});

test("group rename/avatar/membership endpoints are groups-only, reusing the profile-avatar validation pattern", async () => {
  const controller = await source("../src/controllers/internalChatController.js");
  assert.match(controller, /AVATAR_BUCKET, DOCUMENT_BUCKET, downloadStorageFile, removeStorageFile, uploadStorageFile/);
  assert.match(controller, /function detectedImage\(buffer\) \{/);
  assert.match(controller, /throw createHttpError\(400, "The uploaded file is not a valid JPG, PNG, or WebP image\.", "INVALID_AVATAR"\);/);

  const guardFn = controller.slice(controller.indexOf("async function requireGroupThread"), controller.indexOf("export async function updateThread"));
  assert.match(guardFn, /if \(!thread\.isGroup\) throw createHttpError\(400, "Only groups can be renamed, get a photo, or have members added or removed", "VALIDATION_ERROR"\);/);

  const updateFn = controller.slice(controller.indexOf("export async function updateThread"), controller.indexOf("export async function serveThreadAvatar"));
  assert.match(updateFn, /const thread = await requireGroupThread\(req\);/);
  assert.match(updateFn, /if \(nextAvatar && thread\.avatarStorageKey\) await removeStorageFile\(AVATAR_BUCKET, thread\.avatarStorageKey\)\.catch\(\(\) => \{\}\);/);
  assert.match(updateFn, /res\.json\(\{ data: \{ id: updated\.id, name: updated\.name, hasAvatar: Boolean\(updated\.avatarStorageKey\) \} \}\);/);

  const serveFn = controller.slice(controller.indexOf("export async function serveThreadAvatar"), controller.indexOf("export async function addParticipants"));
  assert.match(serveFn, /if \(!thread\?\.avatarStorageKey\) throw createHttpError\(404, "This group has no photo", "NOT_FOUND"\);/);
});

test("adding participants dedupes against current members and validates same-agency active staff", async () => {
  const controller = await source("../src/controllers/internalChatController.js");
  const addFn = controller.slice(controller.indexOf("export async function addParticipants"), controller.indexOf("export async function removeParticipant"));
  assert.match(addFn, /const thread = await requireGroupThread\(req\);/);
  assert.match(addFn, /if \(!newIds\.length\) throw createHttpError\(409, "Everyone you selected is already in this group", "VALIDATION_ERROR"\);/);
  assert.match(addFn, /if \(validTargets\.length !== newIds\.length\) throw createHttpError\(404, "One or more colleagues could not be found", "NOT_FOUND"\);/);
});

test("removing a participant enforces a 2-person floor and 404s a non-member", async () => {
  const controller = await source("../src/controllers/internalChatController.js");
  const removeFn = controller.slice(controller.indexOf("export async function removeParticipant"), controller.indexOf("export async function createMessage"));
  assert.match(removeFn, /const thread = await requireGroupThread\(req\);/);
  assert.match(removeFn, /if \(remainingCount <= 2\) throw createHttpError\(409, "A group needs at least two people/);
  assert.match(removeFn, /if \(!participant\) throw createHttpError\(404, "That person is not in this group", "NOT_FOUND"\);/);
});

test("listThreads and getThread both surface hasAvatar, and every group mutation re-broadcasts", async () => {
  const controller = await source("../src/controllers/internalChatController.js");
  const listFn = controller.slice(controller.indexOf("export async function listThreads"), controller.indexOf("export async function createThread"));
  assert.match(listFn, /hasAvatar: Boolean\(row\.thread\.avatarStorageKey\),/);
  const getFn = controller.slice(controller.indexOf("export async function getThread"), controller.indexOf("async function requireGroupThread"));
  assert.match(getFn, /hasAvatar: Boolean\(thread\.avatarStorageKey\),/);

  assert.match(controller, /rebroadcast\(req, \{ id: updated\.id, occurredAt: updated\.updatedAt \}\);/);
  const addFn = controller.slice(controller.indexOf("export async function addParticipants"), controller.indexOf("export async function removeParticipant"));
  assert.match(addFn, /rebroadcast\(req, \{ id: thread\.id, occurredAt: new Date\(\) \}\);/);
  const removeFn = controller.slice(controller.indexOf("export async function removeParticipant"), controller.indexOf("export async function createMessage"));
  assert.match(removeFn, /rebroadcast\(req, \{ id: thread\.id, occurredAt: new Date\(\) \}\);/);
});

test("internal chat routes expose group rename/avatar and membership management, gated by the profile-avatar upload middleware", async () => {
  const routes = await source("../src/routes/internalChatRoutes.js");
  assert.match(routes, /import \{ receiveProfileAvatar \} from "\.\.\/middleware\/profileAvatarUpload\.js";/);
  assert.match(routes, /router\.patch\("\/threads\/:id", rateLimit\(\{ windowMs: 60_000, max: 20 \}\), receiveProfileAvatar, asyncHandler\(updateThread\)\);/);
  assert.match(routes, /router\.get\("\/threads\/:id\/avatar", asyncHandler\(serveThreadAvatar\)\);/);
  assert.match(routes, /router\.post\("\/threads\/:id\/participants", rateLimit\(\{ windowMs: 60_000, max: 20 \}\), asyncHandler\(addParticipants\)\);/);
  assert.match(routes, /router\.delete\("\/threads\/:id\/participants\/:userId", asyncHandler\(removeParticipant\)\);/);
});

test("frontend group-avatar cache supports eviction so a replaced photo doesn't stay stuck on the old one", async () => {
  const hook = await source("../../frontend/src/hooks/useThreadAvatarUrls.js");
  assert.match(hook, /function refresh\(id\) \{/);
  assert.match(hook, /return \[urlFor, refresh\];/);
});

test("GroupProfilePanel shows avatar/name/members, lets any participant add or remove people, and floors at 2", async () => {
  const panel = await source("../../frontend/src/components/chat/GroupProfilePanel.jsx");
  assert.match(panel, /updateInternalChatThread\(thread\.id, \{ avatarFile: file \}\)/);
  assert.match(panel, /onUpdated\?\.\(\{ avatarChanged: true \}\)/);
  assert.match(panel, /updateInternalChatThread\(thread\.id, \{ name: nextName \}\)/);
  assert.match(panel, /addInternalChatParticipants\(thread\.id, selectedToAdd\.map/);
  assert.match(panel, /removeInternalChatParticipant\(thread\.id, member\.id\)/);
  // Self-removal ("leave") and removing someone else share the same handler
  // and endpoint, distinguished only by whose id is passed.
  assert.match(panel, /const isSelf = member\.id === myUserId;/);
  assert.match(panel, /window\.confirm\(isSelf \? "Leave this group\?" : `Remove \$\{member\.fullName\} from this group\?`\)/);
});

test("ChatsPage wires real group avatars and opens GroupProfilePanel from the group name/avatar, groups only", async () => {
  const page = await source("../../frontend/src/pages/ChatsPage.jsx");
  assert.match(page, /import GroupProfilePanel from "\.\.\/components\/chat\/GroupProfilePanel";/);
  assert.match(page, /import \{ useThreadAvatarUrls \} from "\.\.\/hooks\/useThreadAvatarUrls";/);
  assert.match(page, /const \[threadAvatarUrl, refreshThreadAvatar\] = useThreadAvatarUrls\(avatarItems, fetchInternalChatThreadAvatarBlob\);/);

  // The header only makes the name/avatar clickable for internal groups —
  // DMs and client conversations render the same avatar+name as plain text.
  const headerStart = page.indexOf('activeDetail?.kind === "internal" && activeDetail.isGroup ? (\n                  <button');
  assert.notEqual(headerStart, -1, "the internal-group header branch must remain present");
  const headerBlock = page.slice(headerStart, page.indexOf("</header>", headerStart));
  assert.match(headerBlock, /onClick={\(\) => setGroupProfileOpen\(true\)}/);

  assert.match(page, /if \(avatarChanged\) refreshThreadAvatar\(selectedId\);/);
  assert.match(page, /<GroupProfilePanel\s/);
  assert.match(page, /groupProfileOpen && activeDetail\?\.kind === "internal" && activeDetail\.isGroup/);
});

test("message delete uses an in-app confirm popover, not window.confirm (which browsers silently suppress after repeated use)", async () => {
  const [bubble, page] = await Promise.all([
    source("../../frontend/src/components/chat/ChatMessageBubble.jsx"),
    source("../../frontend/src/pages/ChatsPage.jsx"),
  ]);
  assert.match(bubble, /function DeleteConfirmPopover\(\{ onConfirm, onCancel \}\)/);
  assert.match(bubble, /const \[confirmingDelete, setConfirmingDelete\] = useState\(false\);/);
  // The trash button opens the popover; onDeleteMessage only fires from the
  // popover's own Delete button, once the user has explicitly confirmed.
  const deleteBlock = bubble.slice(bubble.indexOf("{canDelete ? ("), bubble.indexOf("            ) : null}\n          </div>"));
  assert.match(deleteBlock, /onClick={\(\) => setConfirmingDelete\(\(current\) => !current\)}/);
  assert.match(deleteBlock, /onConfirm={\(\) => {\s*setConfirmingDelete\(false\);\s*onDeleteMessage\?\.\(message\);/);
  assert.doesNotMatch(bubble, /onClick={\(\) => onDeleteMessage\?\.\(message\)}/);
  assert.doesNotMatch(page, /window\.confirm\("Delete this message/);
});
