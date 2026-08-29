import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { extractUci } from "../src/services/uciCommunicationMatchingService.js";

const source = (relativePath) => readFile(new URL(relativePath, import.meta.url), "utf8");

test("extractUci recognizes IRCC's real-world UCI formatting (8 or 10 digits, various punctuation, case-insensitive), and never matches an unrelated number", () => {
  assert.equal(extractUci("Your UCI: 1234567890 is on file."), "1234567890");
  assert.equal(extractUci("UCI Number 12345678"), "12345678");
  assert.equal(extractUci("uci# 1234567890"), "1234567890");
  assert.equal(extractUci("Reference UCI:1234567890 for your application"), "1234567890");
  assert.equal(extractUci("no identifier mentioned here at all"), null);
  // A bare number with no "UCI" nearby must never match — that's exactly
  // the false-positive risk of auto-linking government correspondence to
  // the wrong client.
  assert.equal(extractUci("Application number 1234567890 was received."), null);
  assert.equal(extractUci(""), null);
  assert.equal(extractUci(null), null);
});

test("an incoming email nobody's own address matches (IRCC/RCIC correspondence, addressed TO the agency, never FROM the client) is reconciled automatically by UCI instead of sitting in the manual unmatched queue forever", async () => {
  const [service, notificationService] = await Promise.all([
    source("../src/services/uciCommunicationMatchingService.js"),
    source("../src/services/notificationService.js"),
  ]);

  // Mirrors the exact transaction shape of the existing manual
  // assignUnmatchedCommunication flow (conversation + message + resolve),
  // so an automatically-linked message looks identical to a staff member
  // manually reconciling it — same tables, same SLA due-date computation,
  // same audit trail.
  assert.match(service, /import \{ communicationResolutionDueAt, communicationResponseDueAt \} from "\.\/communicationSlaService\.js";/);
  assert.match(service, /await tx\.communicationConversation\.create/);
  assert.match(service, /await tx\.communicationMessage\.create/);
  assert.match(service, /await tx\.unmatchedCommunication\.update\(\{ where: \{ id: unmatched\.id \}, data: \{ resolvedAt: new Date\(\) \} \}\);/);
  assert.match(service, /action: "communication\.unmatched_assigned_by_uci"/);

  // Ambiguity (a profile linked to multiple cases, e.g. a family
  // application) resolves the same way a human would: prefer the open
  // case, else the most recently touched one.
  assert.match(service, /cases\.find\(\(item\) => item\.status !== "Closed"\) \|\| cases\.slice\(\)\.sort/);

  // Falls back to Client.uci when no ImmigrationProfile carries it, so a
  // UCI recorded only on the client record (not yet copied onto a
  // government form) still matches.
  assert.match(service, /prisma\.client\.findFirst\(\{ where: \{ agencyId, uci \}/);

  // Clicking the notification lands exactly where the rest of the app
  // already sends a conversation-scoped notification.
  assert.match(service, /actionUrl: `\/app\/clients\/\$\{client\.id\}\?conversation=\$\{conversation\.id\}`/);
  assert.match(notificationService, /actionUrl.*\/app\/clients\/\$\{clientId\}\?conversation=\$\{event\.conversationId\}/);
});

test("the UCI matching pass polls hourly, not on the fast client-communication cadence, since it never blocks anyone waiting to see mail arrive", async () => {
  const [service, server] = await Promise.all([
    source("../src/services/uciCommunicationMatchingService.js"),
    source("../src/server.js"),
  ]);
  assert.match(service, /const POLL_MS = 60 \* 60_000;/);
  assert.match(service, /export function startUciCommunicationMatchingWorker/);
  assert.match(service, /export function stopUciCommunicationMatchingWorker/);
  // Guards a batch, not the whole unmatched table, and skips a run that's
  // still in flight — same shape as every other worker this session
  // deliberately keeps lightweight.
  assert.match(service, /const BATCH_SIZE = 100;/);
  assert.match(service, /if \(running\) return 0;/);

  assert.match(server, /import \{ startUciCommunicationMatchingWorker, stopUciCommunicationMatchingWorker \} from "\.\/services\/uciCommunicationMatchingService\.js";/);
  assert.match(server, /startUciCommunicationMatchingWorker\(\);/);
  assert.match(server, /stopUciCommunicationMatchingWorker\(\);/);
});

// Real bug, caught live against the production database (not just reasoned
// about): unmatched_communications is a shared, multi-tenant table — a
// single oldest-first page capped at BATCH_SIZE let another agency's own
// backlog push a brand-new row out of the window entirely. Verified
// directly: with >100 unresolved rows already in the table, a row created
// fresh had resolvedAt still null after a run, because it was never even
// in the first page. Fixed by paginating through the entire backlog every
// run instead of stopping after one page.
test("the matching pass paginates through the whole unresolved backlog every run, not just one page — another agency's own volume must not push a fresh row out of the window", async () => {
  const service = await source("../src/services/uciCommunicationMatchingService.js");
  const fn = service.slice(service.indexOf("export async function autoLinkUciMatchedCommunications"), service.indexOf("export function startUciCommunicationMatchingWorker"));
  // Cursor pagination requires a unique, stable sort key — occurredAt can
  // collide across rows and isn't safe to page on.
  assert.match(fn, /orderBy: \{ id: "asc" \}/);
  assert.match(fn, /\.\.\.\(cursor \? \{ cursor: \{ id: cursor \}, skip: 1 \} : \{\}\),/);
  assert.match(fn, /if \(!page\.length\) break;/);
  assert.match(fn, /cursor = page\.at\(-1\)\.id;/);
});

test("the matching pass is cross-replica safe and does not fetch raw provider payloads while scanning", async () => {
  const service = await source("../src/services/uciCommunicationMatchingService.js");
  const fn = service.slice(service.indexOf("export async function autoLinkUciMatchedCommunications"), service.indexOf("export function startUciCommunicationMatchingWorker"));
  assert.match(fn, /acquireWorkerLease\("uci-communication-matching"/);
  assert.match(fn, /select: \{ id: true, subject: true, bodyText: true \}/);
  assert.doesNotMatch(fn.slice(fn.indexOf("const page ="), fn.indexOf("for (const candidate")), /rawPayload|recipients|senderAddress/);
  assert.match(fn, /prisma\.unmatchedCommunication\.findUnique/);
});
