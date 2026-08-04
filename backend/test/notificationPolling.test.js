import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  claimNotificationPollLease,
  notificationLeaseKey,
  releaseNotificationPollLease,
} from "../../frontend/src/services/notificationPolling.js";

function memoryStorage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
  };
}

test("only one visible browser tab owns the notification polling lease", () => {
  const storage = memoryStorage();
  const key = notificationLeaseKey("membership-1");

  assert.equal(
    claimNotificationPollLease({
      storage,
      key,
      owner: "tab-a",
      now: 1_000,
      ttlMs: 1_000,
    }),
    true,
  );
  assert.equal(
    claimNotificationPollLease({
      storage,
      key,
      owner: "tab-b",
      now: 1_500,
      ttlMs: 1_000,
    }),
    false,
  );
  assert.equal(
    claimNotificationPollLease({
      storage,
      key,
      owner: "tab-b",
      now: 2_001,
      ttlMs: 1_000,
    }),
    true,
  );

  releaseNotificationPollLease({ storage, key, owner: "tab-a" });
  assert.match(storage.getItem(key), /tab-b/);
  releaseNotificationPollLease({ storage, key, owner: "tab-b" });
  assert.equal(storage.getItem(key), null);
});

test("notification polling pauses when hidden and cleans up every resource", async () => {
  const provider = await readFile(
    new URL(
      "../../frontend/src/components/notifications/NotificationProvider.jsx",
      import.meta.url,
    ),
    "utf8",
  );

  assert.match(provider, /document\.visibilityState !== "visible"/);
  assert.match(provider, /claimNotificationPollLease/);
  assert.match(provider, /BroadcastChannel/);
  assert.match(provider, /window\.removeEventListener\("storage"/);
  assert.match(provider, /releaseLease\(\)/);
  assert.match(provider, /channel\?\.close\(\)/);
});
