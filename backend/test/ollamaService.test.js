import assert from "node:assert/strict";
import test from "node:test";
import { askCaseDeskAI } from "../src/services/ollama.service.js";

test("Nova uses fast non-thinking chat responses and preserves page context", async (t) => {
  const originalFetch = globalThis.fetch;
  const originalBaseUrl = process.env.OLLAMA_BASE_URL;
  const originalModel = process.env.OLLAMA_MODEL;
  let request;

  process.env.OLLAMA_BASE_URL = "https://nova.example.test/";
  process.env.OLLAMA_MODEL = "qwen3:8b";
  globalThis.fetch = async (url, options) => {
    request = { url, options, body: JSON.parse(options.body) };
    return new Response(JSON.stringify({
      model: "qwen3:8b",
      message: { role: "assistant", content: "Open Settings, then Scheduling." },
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  };

  t.after(() => {
    globalThis.fetch = originalFetch;
    if (originalBaseUrl === undefined) delete process.env.OLLAMA_BASE_URL;
    else process.env.OLLAMA_BASE_URL = originalBaseUrl;
    if (originalModel === undefined) delete process.env.OLLAMA_MODEL;
    else process.env.OLLAMA_MODEL = originalModel;
  });

  const result = await askCaseDeskAI(
    [{ role: "user", content: "Where do I change appointment hours?" }],
    { currentPath: "/app/calendar", role: "admin" },
  );

  assert.equal(request.url, "https://nova.example.test/api/chat");
  assert.equal(request.body.model, "qwen3:8b");
  assert.equal(request.body.stream, false);
  assert.equal(request.body.think, false);
  assert.match(request.body.messages[0].content, /Current user role: admin/);
  assert.match(request.body.messages[0].content, /Current page: \/app\/calendar/);
  assert.equal(result.content, "Open Settings, then Scheduling.");
});
