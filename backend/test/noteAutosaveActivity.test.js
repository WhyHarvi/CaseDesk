import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("note autosave does not emit repeated update activity and legacy noise is hidden", async () => {
  const noteController = await readFile(new URL("../src/controllers/noteController.js", import.meta.url), "utf8");
  const clientController = await readFile(new URL("../src/controllers/clientController.js", import.meta.url), "utf8");

  assert.doesNotMatch(noteController, /activityEntity:\s*"note"/);
  assert.doesNotMatch(noteController, /type:\s*"NOTE_UPDATED"/);
  assert.match(noteController, /action:\s*"note\.created"/);
  assert.match(clientController, /activityLogs\.filter\(\(item\) => item\.action !== "note\.updated"\)/);
});
