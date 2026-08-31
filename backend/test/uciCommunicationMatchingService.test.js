import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  extractUci,
  matchesUciRescanWhere,
  partitionByUciPresence,
  uciRescanWhere,
} from "../src/services/uciCommunicationMatchingService.js";

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
  assert.match(service, /data: \{ resolvedAt: new Date\(\), extractedUci: uci, uciCheckedAt: new Date\(\), uciCheckFailedAt: null \},/);
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
// backlog push a brand-new row out of the window entirely. The original fix
// was to paginate through the entire backlog every run instead of stopping
// after one page. The incremental redesign keeps that same "walk the whole
// qualifying set every run" guarantee, but now scopes the query itself
// (uciRescanWhere) to rows that were never checked or whose last check
// failed — see the dedicated starvation-regression test below for why that
// is a stronger fix than pagination alone.
test("the matching pass paginates through the whole qualifying backlog every run, not just one page", async () => {
  const service = await source("../src/services/uciCommunicationMatchingService.js");
  const fn = service.slice(service.indexOf("export async function autoLinkUciMatchedCommunications"), service.indexOf("export function startUciCommunicationMatchingWorker"));
  assert.match(fn, /where: uciRescanWhere\(\)/);
  // Cursor pagination requires a unique, stable sort key — occurredAt can
  // collide across rows and isn't safe to page on.
  assert.match(fn, /orderBy: \{ id: "asc" \}/);
  assert.match(fn, /\.\.\.\(cursor \? \{ cursor: \{ id: cursor \}, skip: 1 \} : \{\}\),/);
  assert.match(fn, /if \(!page\.length\) break;/);
  assert.match(fn, /cursor = page\.at\(-1\)\.id;/);
});

test("the matching pass is cross-replica safe, bulk-marks no-UCI rows checked, and does not fetch raw provider payloads for the first-stage scan", async () => {
  const service = await source("../src/services/uciCommunicationMatchingService.js");
  const fn = service.slice(service.indexOf("export async function autoLinkUciMatchedCommunications"), service.indexOf("export function startUciCommunicationMatchingWorker"));
  assert.match(fn, /acquireWorkerLease\("uci-communication-matching"/);
  assert.match(fn, /select: \{ id: true, subject: true, bodyText: true \}/);
  assert.doesNotMatch(fn.slice(fn.indexOf("const page ="), fn.indexOf("const checkedNow")), /rawPayload|recipients|senderAddress/);
  // Rows without an extractable UCI are marked checked in one bulk write,
  // never given the wider per-row fetch linkOne needs.
  assert.match(fn, /partitionByUciPresence\(page\)/);
  assert.match(fn, /unmatchedCommunication\.updateMany\(\{\s*where: \{ id: \{ in: noUciIds \} \}/);
  assert.match(fn, /data: \{ extractedUci: null, uciCheckedAt: checkedNow, uciCheckFailedAt: null \}/);
  assert.match(fn, /prisma\.unmatchedCommunication\.findUnique/);
});

// This is the actual mechanism the starvation fix relies on: rows that were
// already checked contribute nothing to the query at all, so a huge
// already-checked backlog in one agency cannot occupy pagination "slots"
// that a brand-new row in another agency would otherwise need.
test("matchesUciRescanWhere mirrors the real query's WHERE clause exactly", () => {
  const where = uciRescanWhere();
  assert.deepEqual(where, {
    resolvedAt: null,
    channel: "Email",
    OR: [{ uciCheckedAt: null }, { uciCheckFailedAt: { not: null } }],
  });

  const neverChecked = { resolvedAt: null, channel: "Email", uciCheckedAt: null, uciCheckFailedAt: null };
  const checkedCleanly = { resolvedAt: null, channel: "Email", uciCheckedAt: new Date(), uciCheckFailedAt: null };
  const checkFailed = { resolvedAt: null, channel: "Email", uciCheckedAt: null, uciCheckFailedAt: new Date() };
  const checkedThenFailedOnRetry = { resolvedAt: null, channel: "Email", uciCheckedAt: new Date("2026-01-01"), uciCheckFailedAt: new Date() };
  const alreadyMatched = { resolvedAt: new Date(), channel: "Email", uciCheckedAt: null, uciCheckFailedAt: null };
  const nonEmailChannel = { resolvedAt: null, channel: "Sms", uciCheckedAt: null, uciCheckFailedAt: null };

  assert.equal(matchesUciRescanWhere(neverChecked), true, "never-checked rows must stay eligible");
  assert.equal(matchesUciRescanWhere(checkedCleanly), false, "cleanly-checked rows must not be rescanned forever");
  assert.equal(matchesUciRescanWhere(checkFailed), true, "an errored check must remain retryable");
  assert.equal(matchesUciRescanWhere(checkedThenFailedOnRetry), true, "a failed retry stays retryable even if it was once checked");
  assert.equal(matchesUciRescanWhere(alreadyMatched), false, "already-linked rows are excluded regardless of check state");
  assert.equal(matchesUciRescanWhere(nonEmailChannel), false, "UCI matching is Email-only, unchanged from before");
});

// Regression test for the documented production bug: a huge stale backlog
// in one agency must never be able to hide a brand-new, low-volume agency's
// unmatched row from the scan. Under the old design this required
// paginating through the *entire* backlog to eventually reach it. Under the
// incremental design, an already-checked backlog contributes zero rows to
// the candidate set at all, so it cannot compete for scan attention no
// matter how large it grows.
test("a newly-arrived message in a low-volume agency is not hidden behind another agency's huge already-checked backlog", () => {
  const now = new Date();
  const bigAgencyBacklog = Array.from({ length: 5_000 }, (_, index) => ({
    id: `big-agency-row-${index}`,
    resolvedAt: null,
    channel: "Email",
    uciCheckedAt: now, // already checked by an earlier pass or at ingestion
    uciCheckFailedAt: null,
  }));
  const freshRowInSmallAgency = {
    id: "small-agency-fresh-row",
    resolvedAt: null,
    channel: "Email",
    uciCheckedAt: null, // never checked — just arrived
    uciCheckFailedAt: null,
  };
  const table = [...bigAgencyBacklog, freshRowInSmallAgency];

  const candidateRows = table.filter(matchesUciRescanWhere);

  // The fresh row is found, and the entire 5,000-row already-checked
  // backlog contributes nothing to scan — it isn't merely "paginated past",
  // it never enters the candidate set.
  assert.deepEqual(candidateRows.map((row) => row.id), ["small-agency-fresh-row"]);
});

test("partitionByUciPresence separates rows worth a second fetch from rows that can be bulk-marked checked", () => {
  const rows = [
    { id: "has-uci-in-subject", subject: "Your UCI: 1234567890 is on file.", bodyText: null },
    { id: "has-uci-in-body", subject: "Update", bodyText: "UCI Number 87654321" },
    { id: "no-uci-at-all", subject: "Thanks for your inquiry", bodyText: "We'll be in touch soon." },
    { id: "empty-fields", subject: null, bodyText: null },
  ];

  const { noUciIds, candidateIdsWithUci } = partitionByUciPresence(rows);

  assert.deepEqual(candidateIdsWithUci, ["has-uci-in-subject", "has-uci-in-body"]);
  assert.deepEqual(noUciIds, ["no-uci-at-all", "empty-fields"]);
});

test("a failed link attempt is persisted distinctly from both 'already matched' and 'checked, nothing to do'", async () => {
  const service = await source("../src/services/uciCommunicationMatchingService.js");
  const linkOneFn = service.slice(service.indexOf("export async function linkOne"), service.indexOf("export async function autoLinkUciMatchedCommunications"));
  // Every clean "nothing to link" outcome marks uciCheckedAt (and clears any
  // prior failure flag) via the shared bookkeeping helper.
  assert.match(linkOneFn, /await markUciChecked\(unmatched\.id, null\);/); // no UCI extractable at all
  assert.match(linkOneFn, /await markUciChecked\(unmatched\.id, uci\);/); // UCI present, no linkable case/client/attributable user
  assert.match(service, /data: \{ extractedUci, uciCheckedAt: new Date\(\), uciCheckFailedAt: null \}/);
  // An unexpected error takes a different, distinguishable path: it sets
  // uciCheckFailedAt without touching uciCheckedAt, and rethrows so existing
  // callers keep their own logging/handling unchanged.
  assert.match(linkOneFn, /\} catch \(error\) \{/);
  assert.match(linkOneFn, /data: \{ extractedUci: uci, uciCheckFailedAt: new Date\(\) \} \}\)/);
  assert.match(linkOneFn, /throw error;/);
});

test("newly-ingested email is checked for a UCI match immediately at ingestion, not left for the next hourly pass", async () => {
  const controller = await source("../src/controllers/communicationWebhookController.js");
  assert.match(controller, /import \{ linkOne \} from "\.\.\/services\/uciCommunicationMatchingService\.js";/);
  const storeUnmatchedFn = controller.slice(controller.indexOf("async function storeUnmatched"), controller.indexOf("async function recordOptOut"));
  // Gated to Email, matching the hourly worker's own scope — no behavior
  // change for Sms/Chat/Call unmatched rows.
  assert.match(storeUnmatchedFn, /if \(channel === "Email"\) \{/);
  assert.match(storeUnmatchedFn, /await linkOne\(data\)\.catch/);
  // A failure here must not break the webhook's own response/return shape.
  assert.match(storeUnmatchedFn, /return \{ data, unmatched: true, duplicate: false \};/);
});

test("setting or changing an applicant's UCI triggers an immediate targeted recheck of previously-unmatched communications, via a real equality lookup", async () => {
  const [service, controller] = await Promise.all([
    source("../src/services/uciCommunicationMatchingService.js"),
    source("../src/controllers/caseApplicantController.js"),
  ]);

  // The lookup is a genuine indexed equality query against the persisted
  // extractedUci column — not a heuristic or hardcoded rule table.
  const recheckFn = service.slice(service.indexOf("export async function recheckUnmatchedCommunicationsForUci"));
  assert.match(recheckFn, /where: \{ agencyId, extractedUci: uci, resolvedAt: null, channel: "Email" \}/);
  assert.match(recheckFn, /await linkOne\(candidate\)/);

  assert.match(controller, /import \{ recheckUnmatchedCommunicationsForUci \} from "\.\.\/services\/uciCommunicationMatchingService\.js";/);
  assert.match(controller, /async function triggerUciRecheckIfChanged\(agencyId, uci\)/);
  // Create: any UCI on a brand-new applicant profile is by definition newly
  // set (there is no prior value to compare against).
  assert.match(controller, /await triggerUciRecheckIfChanged\(agencyId, data\.uci\);\s*\n\s*const \{ passwordHash, loginUsernameNormalized, \.\.\.safeProfile \} = profile;\s*\n\s*res\.status\(201\)/);
  // Update: only fires when the UCI actually changed, comparing the
  // freshly-computed value against the profile's previous one.
  assert.match(controller, /const uciChanged = Boolean\(data\.uci\) && data\.uci !== existing\.uci;/);
  assert.match(controller, /if \(uciChanged\) await triggerUciRecheckIfChanged\(agencyId, data\.uci\);/);
});
