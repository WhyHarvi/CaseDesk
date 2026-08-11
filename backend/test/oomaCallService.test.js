import assert from "node:assert/strict";
import test from "node:test";
import {
  isOomaCallPayload,
  normalizeOomaCallPayload,
} from "../src/services/oomaCallService.js";

test("Ooma incoming and ended Zap events normalize into one durable call identity", () => {
  const started = normalizeOomaCallPayload({
    event: "call_started",
    callId: "ooma-call-42",
    providerEventId: "event-1",
    direction: "INBOUND",
    from: "(416) 555-0100",
    to: "+16475550199",
    staffEmail: "Consultant@Example.ca",
    occurredAt: "2026-08-11T15:00:00.000Z",
  });
  const ended = normalizeOomaCallPayload({
    event: "call_ended",
    callId: "ooma-call-42",
    providerEventId: "event-2",
    direction: "INBOUND",
    remoteNumber: "+14165550100",
    durationSeconds: 75,
    disposition: "answered",
    occurredAt: "2026-08-11T15:01:15.000Z",
  });

  assert.equal(started.providerCallId, ended.providerCallId);
  assert.equal(started.status, "RINGING");
  assert.equal(started.remoteNumberNormalized, "+14165550100");
  assert.equal(started.staffEmail, "consultant@example.ca");
  assert.equal(ended.eventType, "ENDED");
  assert.equal(ended.status, "COMPLETED");
  assert.equal(ended.durationSeconds, 75);
});

test("Ooma missed, outbound, and recording events retain their CRM meaning", () => {
  const missed = normalizeOomaCallPayload({ event: "call_missed", callId: "missed-1", from: "+14165550101" });
  const outbound = normalizeOomaCallPayload({ event: "new_outgoing_call", callId: "out-1", from: "+16475550199", to: "+14165550102" });
  const recording = normalizeOomaCallPayload({ event: "call_recording", callId: "out-1", recordingUrl: "https://example.test/calls/out-1.mp3" });

  assert.equal(missed.direction, "INBOUND");
  assert.equal(missed.status, "MISSED");
  assert.equal(outbound.direction, "OUTBOUND");
  assert.equal(outbound.remoteNumberNormalized, "+14165550102");
  assert.equal(recording.eventType, "RECORDING_AVAILABLE");
  assert.equal(recording.status, null);
  assert.equal(recording.recordingUrl, "https://example.test/calls/out-1.mp3");
});

test("Ooma SMS webhooks never enter the call-session pipeline", () => {
  assert.equal(isOomaCallPayload({ event: "sms_received", channel: "sms", callId: "not-a-call", body: "Hello" }), false);
  assert.equal(isOomaCallPayload({ event: "call_ended", channel: "call", callId: "real-call" }), true);
  assert.equal(isOomaCallPayload({ event: "new_incoming_call", callId: "real-call" }), true);
});
