import assert from "node:assert/strict";
import test from "node:test";
import {
  caseDeskIntentPrompt,
  normalizeCaseDeskIntent,
  parseCaseDeskIntentContent,
  shouldExtractCaseDeskIntent,
} from "../src/services/aiIntentService.js";

function metricIntent(overrides = {}) {
  return {
    kind: "metric",
    domain: "performance",
    metric: "summary",
    subject: { type: "team_member", name: "Manpreet Kaur", role: null },
    status: null,
    period: "current_month",
    compare: "none",
    confidence: 0.94,
    needsClarification: false,
    ...overrides,
  };
}

test("structured Nova intents are reduced to the approved metric vocabulary", () => {
  assert.deepEqual(normalizeCaseDeskIntent(metricIntent()), metricIntent());
  assert.equal(normalizeCaseDeskIntent(metricIntent({ confidence: 0.59 })), null);
  assert.equal(normalizeCaseDeskIntent(metricIntent({ kind: "navigation" })), null);
  assert.equal(normalizeCaseDeskIntent(metricIntent({ domain: "database" })), null);
  assert.equal(normalizeCaseDeskIntent(metricIntent({ subject: { type: "team_member", name: "", role: null } })), null);
  assert.deepEqual(
    normalizeCaseDeskIntent(metricIntent({ subject: { type: "team_member", name: "Manpreet Kaur", role: "admin" } })).subject,
    { type: "team_member", name: "Manpreet Kaur", role: null },
  );
});

test("Nova extracts a valid JSON object even when Ollama surrounds it with text", () => {
  const parsed = parseCaseDeskIntentContent(`Result:\n${JSON.stringify(metricIntent({ period: "previous_month" }))}\nDone`);
  assert.equal(parsed.domain, "performance");
  assert.equal(parsed.subject.name, "Manpreet Kaur");
  assert.equal(parsed.period, "previous_month");
  assert.equal(parseCaseDeskIntentContent("not-json"), null);
});

test("intent extraction activates for analytical and contextual follow-ups but skips navigation", () => {
  assert.equal(shouldExtractCaseDeskIntent([
    { role: "user", content: "What are the incentives for Manpreet?" },
    { role: "assistant", content: "Here is Manpreet's performance summary." },
    { role: "user", content: "What about Harpreet?" },
  ]), true);
  assert.equal(shouldExtractCaseDeskIntent([{ role: "user", content: "Compare Manpreet's workload with last month" }]), true);
  assert.equal(shouldExtractCaseDeskIntent([{ role: "user", content: "Where do I edit a lead?" }]), false);
});

// Defense in depth alongside aiInsightService.js's own regex guard: even
// if a definitional question ("what does the overdue count mean?") slips
// past the analytical-signal check and reaches the LLM classifier, the
// classifier itself is told explicitly not to call that kind=metric.
test("the intent classifier prompt explicitly rules out definitional questions from kind=metric", () => {
  const prompt = caseDeskIntentPrompt({ currentPath: "/app/dashboard", role: "admin" });
  assert.match(prompt, /never kind=metric, even if it names a real domain/);
  assert.match(prompt, /Use kind=unknown for it\./);
});
