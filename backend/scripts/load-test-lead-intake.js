import { createHmac, randomUUID } from "node:crypto";

if (process.env.LOAD_TEST_CONFIRM !== "true") throw new Error("Set LOAD_TEST_CONFIRM=true to acknowledge that this creates test intake events.");
const url = process.env.LOAD_TEST_WEBHOOK_URL;
const secret = process.env.LOAD_TEST_SIGNING_SECRET;
const total = Math.min(Math.max(Number(process.env.LOAD_TEST_REQUESTS) || 100, 1), 10_000);
const concurrency = Math.min(Math.max(Number(process.env.LOAD_TEST_CONCURRENCY) || 10, 1), 100);
if (!url || !secret) throw new Error("LOAD_TEST_WEBHOOK_URL and LOAD_TEST_SIGNING_SECRET are required.");

let cursor = 0, succeeded = 0, failed = 0;
const durations = [];
async function worker() {
  while (cursor < total) {
    const index = cursor++;
    const body = JSON.stringify({ fullName: `Load Test ${index}`, phone: `+1416555${String(index % 10000).padStart(4, "0")}`, initialMessage: "Authorized CaseDesk intake load test" });
    const timestamp = Math.floor(Date.now() / 1000);
    const signature = createHmac("sha256", secret).update(`${timestamp}.`).update(body).digest("hex");
    const started = performance.now();
    const response = await fetch(url, { method: "POST", headers: { "content-type": "application/json", "x-casedesk-timestamp": String(timestamp), "x-casedesk-signature": `sha256=${signature}`, "x-casedesk-event-id": `load-${randomUUID()}` }, body }).catch(() => null);
    durations.push(performance.now() - started);
    if (response?.ok) succeeded += 1; else failed += 1;
  }
}
await Promise.all(Array.from({ length: concurrency }, worker));
durations.sort((a, b) => a - b);
const percentile = (value) => Math.round(durations[Math.min(Math.floor(durations.length * value), durations.length - 1)] || 0);
console.log(JSON.stringify({ total, concurrency, succeeded, failed, p50Ms: percentile(0.5), p95Ms: percentile(0.95), p99Ms: percentile(0.99) }, null, 2));
if (failed) process.exitCode = 1;

