import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("client activity stays in a bounded card with its own scroll region", async () => {
  const profile = await readFile(
    new URL("../../frontend/src/pages/ClientProfile.jsx", import.meta.url),
    "utf8",
  );

  assert.match(
    profile,
    /flex h-\[28rem\] max-h-\[calc\(100dvh-3rem\)\] flex-col overflow-hidden p-6/,
  );
  assert.match(
    profile,
    /overflow-y-auto overscroll-contain pr-1 \[scrollbar-gutter:stable\]/,
  );
});
