import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("a newly created case opens its case profile while payment intake keeps its dedicated handoff", async () => {
  const casesPage = await readFile(new URL("../../frontend/src/pages/Cases.jsx", import.meta.url), "utf8");
  assert.match(casesPage, /afterCreateActionRef\.current === "professional-payment"[\s\S]*?navigate\(`\/app\/clients\/\$\{encodeURIComponent\(payload\.clientId\)\}`/);
  assert.match(casesPage, /setToast\(\{ type: "success", message: "Case created successfully" \}\);[\s\S]*?navigate\(`\/app\/cases\/\$\{encodeURIComponent\(savedCase\.id\)\}`\)/);
});
