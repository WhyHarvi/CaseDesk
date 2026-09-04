import assert from "node:assert/strict";
import test from "node:test";
import { bundleCallsByTime, CALL_BUNDLE_WINDOW_MS } from "../src/controllers/callHistoryController.js";

const call = (id, number, startedAt, extra = {}) => ({
  id,
  remoteNumber: number,
  remoteNumberNormalized: number ? number.replace(/\D/g, "") : null,
  startedAt,
  durationSeconds: 30,
  resolution: "LINKED_CLIENT",
  followUp: null,
  ...extra,
});

test("same-number call attempts within 30 minutes become one interaction", () => {
  const bundles = bundleCallsByTime([
    call("newest", "+1 416 555 0100", "2026-09-04T15:20:00.000Z", { direction: "OUTBOUND" }),
    call("older", "+1 416 555 0100", "2026-09-04T15:00:00.000Z", { direction: "INBOUND", status: "MISSED", resolution: "UNRESOLVED", durationSeconds: 0, recordingUrl: "https://api.twilio.test/recording" }),
  ]);

  assert.equal(CALL_BUNDLE_WINDOW_MS, 30 * 60_000);
  assert.equal(bundles.length, 1);
  assert.equal(bundles[0].id, "newest");
  assert.deepEqual(bundles[0].bundle.attempts.map((item) => item.id), ["newest", "older"]);
  assert.equal(bundles[0].bundle.attemptCount, 2);
  assert.equal(bundles[0].bundle.totalDurationSeconds, 30);
  assert.equal(bundles[0].bundle.unresolvedCount, 1);
  assert.equal(bundles[0].bundle.newVoicemailCount, 1);
});

test("time-separated and private calls remain separate interactions", () => {
  const bundles = bundleCallsByTime([
    call("recent", "+1 416 555 0100", "2026-09-04T16:00:00.000Z"),
    call("old", "+1 416 555 0100", "2026-09-04T15:29:59.000Z"),
    call("private-1", null, "2026-09-04T15:20:00.000Z"),
    call("private-2", null, "2026-09-04T15:19:00.000Z"),
  ]);

  assert.equal(bundles.length, 4);
  assert.ok(bundles.every((item) => item.bundle.attemptCount === 1));
});

test("a played missed-call voicemail remains due until a successful callback is recorded", () => {
  const [bundle] = bundleCallsByTime([
    call("missed", "+1 416 555 0100", "2026-09-04T15:00:00.000Z", {
      direction: "INBOUND",
      status: "MISSED",
      recordingUrl: "https://api.twilio.test/recording",
      recordingPlayedAt: "2026-09-04T15:05:00.000Z",
      callback: { status: "DUE" },
    }),
  ]);

  assert.equal(bundle.bundle.newVoicemailCount, 0);
  assert.equal(bundle.bundle.callbackDueCount, 1);
  assert.equal(bundle.bundle.contactedBackCount, 0);
});

test("a later connected outbound call marks the missed call as contacted back", () => {
  const [bundle] = bundleCallsByTime([
    call("callback", "+1 416 555 0100", "2026-09-04T15:20:00.000Z", { direction: "OUTBOUND", status: "COMPLETED" }),
    call("missed", "+1 416 555 0100", "2026-09-04T15:00:00.000Z", {
      direction: "INBOUND",
      status: "MISSED",
      recordingPlayedAt: "2026-09-04T15:05:00.000Z",
      callback: { status: "CONTACTED_BACK", callId: "callback", contactedAt: "2026-09-04T15:20:00.000Z" },
    }),
  ]);

  assert.equal(bundle.bundle.callbackDueCount, 0);
  assert.equal(bundle.bundle.contactedBackCount, 1);
});
