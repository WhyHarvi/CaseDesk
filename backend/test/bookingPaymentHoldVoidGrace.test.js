import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = (relativePath) => readFile(new URL(relativePath, import.meta.url), "utf8");

// Extracts one function's own source text so an assertion can't accidentally
// match against a different function later in the same file — same
// technique already used elsewhere in this test suite for scoped checks.
function functionSlice(source, exportedSignature) {
  const start = source.indexOf(exportedSignature);
  if (start === -1) throw new Error(`could not find ${exportedSignature}`);
  const end = source.indexOf("\nexport ", start + exportedSignature.length);
  return source.slice(start, end === -1 ? source.length : end);
}

test("a first void attempt is deferred by VOID_GRACE_MS, not fired synchronously at expiry — releaseExpiredPaymentHolds only marks Expired and seeds a future retry time", async () => {
  const service = await source("../src/services/bookingPaymentHoldService.js");
  assert.match(service, /const VOID_GRACE_MS = 10 \* 60_000;/);

  const releaseFn = functionSlice(service, "export async function releaseExpiredPaymentHolds()");
  assert.match(releaseFn, /data: \{ status: "Expired", nextVoidAttemptAt: new Date\(Date\.now\(\) \+ VOID_GRACE_MS\) \}/);
  assert.doesNotMatch(releaseFn, /attemptVoid\(/, "the expiry sweep must not call attemptVoid directly anymore");

  const retryFn = functionSlice(service, "export async function retryFailedVoids()");
  assert.match(retryFn, /await attemptVoid\(hold\);/, "retryFailedVoids must still be the one place that actually voids");
});

test("the abandoned-booking client email is deferred until the void actually succeeds — the CRM lead/follow-up task is still created immediately", async () => {
  const service = await source("../src/services/bookingPaymentHoldService.js");

  const releaseFn = functionSlice(service, "export async function releaseExpiredPaymentHolds()");
  assert.match(releaseFn, /captureAbandonedPublicBookingLead\(hold\.agencyId, hold\.id, \{ sendEmail: false \}\)/);

  assert.match(service, /async function attemptVoid\(hold\) \{[\s\S]*?data: \{ voidedAt: new Date\(\) \} \}\);\s*\n\s*\/\/[\s\S]*?await captureAbandonedPublicBookingLead\(hold\.agencyId, hold\.id\)\.catch/);
});

test("captureAbandonedPublicBookingLead supports a sendEmail:false call without losing idempotency on the Lead itself", async () => {
  const leadBooking = await source("../src/modules/leads/lead.booking.js");
  assert.match(leadBooking, /export async function captureAbandonedPublicBookingLead\(agencyId, holdId, \{ sendEmail = true \} = \{\}\) \{/);
  // The early-return guard no longer bails out on hold.leadId — a second
  // call (to send the email) must still be able to reach the hold.
  assert.doesNotMatch(leadBooking, /if \(!hold \|\| hold\.leadId \|\|/);
  assert.match(leadBooking, /if \(hold\.leadId\) \{/);
  assert.match(leadBooking, /if \(result\.hold && sendEmail\) \{/);
});

test("the public checkout status view exposes whether a void is still pending, not the raw voidedAt timestamp", async () => {
  const controller = await source("../src/controllers/publicBookingController.js");
  assert.match(controller, /voidPending: hold\.status === "Expired" && !hold\.voidedAt,/);
});

test("the client-facing poller keeps checking through the void grace period instead of declaring the checkout dead the instant it first reads Expired", async () => {
  const page = await source("../../frontend/src/pages/PublicBookingPage.jsx");
  assert.match(page, /const MAX_VOID_PENDING_POLL_MS = 30 \* 60_000;/);
  // "Expired" must no longer be in the immediate-stop list — only the two
  // genuinely-terminal-with-no-grace-concept statuses are.
  assert.match(page, /result\.requiresStaffResolution \|\|\s*\n\s*\["Voided", "Failed"\]\.includes\(result\.status\)/);
  // ...and instead gets its own branch keyed on voidPending + a time cap.
  assert.match(page, /else if \(result\.status === "Expired"\) \{/);
  assert.match(page, /keepPolling =\s*\n\s*result\.voidPending &&\s*\n\s*Date\.now\(\) - pollingStartedAt < MAX_VOID_PENDING_POLL_MS;/);
  assert.match(page, /We're still confirming your payment/);
  // The "choose another time" recovery action stays available regardless
  // of voidPending — an in-flight revival is already handled safely
  // downstream (SLOT_CONFLICT_AT_CONFIRMATION -> notifyOrphanedPayment).
  assert.match(page, /\{\["Expired", "Voided", "Failed"\]\.includes\(\s*\n\s*pendingPayment\?\.status,\s*\n\s*\) \? \(\s*\n\s*<motion\.button/);
});

test("the admin-configurable payment-hold floor was raised from 5 to 10 minutes, on both the backend bound and the settings-panel input", async () => {
  const [controller, panel] = await Promise.all([
    source("../src/controllers/bookingController.js"),
    source("../../frontend/src/components/booking/SchedulingSettingsPanel.jsx"),
  ]);
  assert.match(controller, /boundedInt\(body\.consultFeeHoldMinutes, "Payment hold window", 10, 120\)/);
  assert.match(panel, /Hold window \(min\) <input type="number" min="10" max="120"/);
});

test("voided holds get one durable post-void payment check and a critical finance alert when money lands late", async () => {
  const [service, schema, migration] = await Promise.all([
    source("../src/services/bookingPaymentHoldService.js"),
    source("../prisma/schema.prisma"),
    source("../prisma/migrations/20260819030000_add_booking_hold_post_void_payment_check/migration.sql"),
  ]);

  const sweep = functionSlice(service, "export async function detectPaidAfterVoidHolds()");
  assert.match(sweep, /status: "Expired"/);
  assert.match(sweep, /postVoidPaymentCheckedAt: null/);
  assert.match(sweep, /findQuickBooksPaymentForInvoice\(hold\.agencyId, hold\.qbCustomerId, hold\.qbInvoiceId\)/);
  assert.match(sweep, /data: \{ postVoidPaymentCheckedAt: new Date\(\) \}/);
  assert.match(sweep, /notifyPaidAfterVoid\(hold, payment\)/);

  assert.match(service, /type: "booking_payment\.paid_after_void"/);
  assert.match(service, /severity: "critical"/);
  assert.match(service, /responseDeadlineMinutes: 10/);
  assert.match(service, /detectPaidAfterVoidHolds\(\)\.catch/);
  assert.match(schema, /postVoidPaymentCheckedAt\s+DateTime\?\s+@map\("post_void_payment_checked_at"\)/);
  assert.match(migration, /ADD COLUMN "post_void_payment_checked_at" TIMESTAMP\(3\)/);
});
