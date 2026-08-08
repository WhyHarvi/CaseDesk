import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = (relativePath) => readFile(new URL(relativePath, import.meta.url), "utf8");

test("case document upload accepts multiple files in one pick, uploaded sequentially", async () => {
  const workspace = await source("../../frontend/src/components/case-profile/DocumentsWorkspace.jsx");

  assert.match(workspace, /<input ref=\{myDocumentInput\} type="file" accept=\{acceptedDocumentTypes\} multiple/);
  assert.match(workspace, /async function uploadMyDocuments\(files\)/);
  assert.match(workspace, /const oversized = queued\.filter\(\(file\) => file\.size > 25 \* 1024 \* 1024\)/);
  // Sequential, not Promise.all — a batch upload must not fire every file at
  // the storage backend simultaneously, and progress needs to stay honest
  // for a single file at a time.
  assert.match(workspace, /for \(const \[index, file\] of toUpload\.entries\(\)\) \{/);
  assert.match(workspace, /await onUploadMyDocument\(file, setMyDocumentProgress\)/);
  // Oversized files are skipped, not fatal to the rest of the batch.
  assert.match(workspace, /if \(!toUpload\.length\) return;/);
  assert.match(workspace, /myDocumentTotal > 1 \? `Uploading \$\{myDocumentIndex\} of \$\{myDocumentTotal\} — \$\{myDocumentProgress\}%`/);
});
