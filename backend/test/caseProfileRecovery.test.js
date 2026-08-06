import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("case deep links recover automatically without losing their tab or highlight URL", async () => {
  const [page, reminders] = await Promise.all([
    readFile(new URL("../../frontend/src/pages/CaseProfile.jsx", import.meta.url), "utf8"),
    readFile(new URL("../../frontend/src/components/case-profile/RemindersWorkspace.jsx", import.meta.url), "utf8"),
  ]);

  assert.match(page, /CASE_RECOVERY_DELAYS_MS/);
  assert.match(page, /isRecoverableCaseLoadError/);
  assert.match(page, /const get = recovery \? api\.getFresh : api\.get/);
  assert.match(page, /const caseResponse = await get\(`\/cases\/\$\{id\}`\)/);
  assert.match(page, /Retrying automatically/);
  assert.match(page, /Retry now/);
  assert.match(page, /generation !== loadGenerationRef\.current/);
  assert.match(page, /recoverablePanelFailure/);
  assert.doesNotMatch(page, /navigate\([^)]*tab=reminders/);
  assert.match(reminders, /highlightedReminder/);
  assert.match(reminders, /setView\(reminderView\(highlightedReminder\)\)/);
  assert.match(reminders, /ready: highlightReady/);
  assert.match(reminders, /deps: \[view, filtered\.length\]/);
});
