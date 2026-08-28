import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("note autosave queues immutable snapshots and flushes when focus leaves", async () => {
  const hook = await readFile(new URL("../../frontend/src/hooks/useDebouncedAutosave.js", import.meta.url), "utf8");
  const appointment = await readFile(new URL("../../frontend/src/components/appointments/AppointmentProfileOverlay.jsx", import.meta.url), "utf8");
  const client = await readFile(new URL("../../frontend/src/pages/ClientProfile.jsx", import.meta.url), "utf8");

  assert.match(hook, /queuedValueRef/);
  assert.match(hook, /onSaveRef\.current\(queuedSnapshot\)/);
  assert.match(hook, /const wait = runnerRef\.current \? 0 : delay/);
  assert.match(hook, /return \{ flush \}/);

  assert.match(appointment, /contentSnapshot \?\? note/);
  assert.match(appointment, /contentSnapshot \?\? editingNoteContent/);
  assert.match(appointment, /flushNewNoteAutosave/);
  assert.match(appointment, /flushNoteEditAutosave/);
  assert.match(appointment, /async function requestClose\(\)/);
  assert.doesNotMatch(appointment, /onClick=\{onClose\}/);

  assert.match(client, /contentSnapshot \?\? noteFormState\.content/);
  assert.match(client, /flushNoteAutosave/);
  assert.match(client, /async function closeNoteForm\(\)/);
});
