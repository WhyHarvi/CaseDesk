import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = (relativePath) => readFile(new URL(relativePath, import.meta.url), "utf8");

test("case document upload accepts multiple files in one pick, uploaded sequentially", async () => {
  const workspace = await source("../../frontend/src/components/case-profile/DocumentsWorkspace.jsx");

  assert.match(workspace, /<input ref=\{myDocumentInput\} type="file" accept=\{acceptedDocumentTypes\} multiple/);
  assert.match(workspace, /async function uploadMyDocuments\(files\)/);
  // PDFs and other files carry different size limits (PDFs get compressed
  // client-side first), so the flat 25MB check moved into a shared
  // exceedsCaseUploadLimit helper both this batch path and the single-file
  // upload() above call — kept in sync instead of two divergent checks.
  assert.match(workspace, /const exceedsCaseUploadLimit = \(file\) => isPdfUpload\(file\)/);
  assert.match(workspace, /const oversized = queued\.filter\(exceedsCaseUploadLimit\)/);
  // Sequential, not Promise.all — a batch upload must not fire every file at
  // the storage backend simultaneously, and progress needs to stay honest
  // for a single file at a time.
  assert.match(workspace, /for \(const \[index, file\] of toUpload\.entries\(\)\) \{/);
  assert.match(workspace, /await onUploadMyDocument\(file, setMyDocumentProgress, openWorkingFolder \|\| undefined\)/);
  // Oversized files are skipped, not fatal to the rest of the batch.
  assert.match(workspace, /if \(!toUpload\.length\) return;/);
  assert.match(workspace, /myDocumentTotal > 1 \? `Uploading \$\{myDocumentIndex\} of \$\{myDocumentTotal\} — \$\{myDocumentProgress\}%`/);
});

test("consultants can organize My Documents into folders, scoped to one case and one level deep", async () => {
  const [schema, migration, folderController, documentController, routes, workspace, caseProfile] = await Promise.all([
    source("../prisma/schema.prisma"),
    source("../prisma/migrations/20260808173600_document_folders/migration.sql"),
    source("../src/controllers/documentFolderController.js"),
    source("../src/controllers/clientDocumentController.js"),
    source("../src/routes/clientDocumentRoutes.js"),
    source("../../frontend/src/components/case-profile/DocumentsWorkspace.jsx"),
    source("../../frontend/src/pages/CaseProfile.jsx"),
  ]);

  assert.match(schema, /model DocumentFolder \{/);
  assert.match(schema, /@@unique\(\[caseId, name\]\)/);
  assert.match(schema, /folderId\s+String\?\s+@map\("folder_id"\)/);
  assert.match(migration, /CREATE TABLE "document_folders"/);
  assert.match(migration, /ADD COLUMN "folder_id" TEXT/);

  // A folder only ever organizes a consultant's own internal working files —
  // never a client-requested document, and never across cases.
  assert.match(folderController, /async function requireCase\(req, caseId\)/);
  assert.match(documentController, /if \(visibility !== "Internal"\) throw createHttpError\(400, "Only internal working files can be filed into a folder"/);
  assert.match(documentController, /caseId: existing\.caseId/);
  // Deleting a folder is blocked while it still has files in it — nothing
  // silently orphans or cascades away a real document.
  assert.match(folderController, /if \(existing\._count\.documents > 0\)/);

  assert.match(routes, /router\.get\("\/folders", asyncHandler\(listDocumentFolders\)\)/);
  assert.match(routes, /router\.post\("\/folders", asyncHandler\(createDocumentFolder\)\)/);

  assert.match(workspace, /const \[openWorkingFolder, setOpenWorkingFolder\] = useState\(null\)/);
  assert.match(workspace, /function moveDocumentToFolder\(document, folderId\)/);
  assert.match(workspace, /myDocuments\.filter\(\(item\) => item\.folderId === openWorkingFolder\)/);
  // The My Documents tile's own count must stay the grand total regardless
  // of which sub-folder is currently open, not the filtered view's count.
  assert.match(workspace, /count: myDocumentsTotalCount/);

  assert.match(caseProfile, /async function uploadMyCaseDocument\(file, onProgress, folderId\)/);
  assert.match(caseProfile, /if \(folderId\) formData\.append\("folderId", folderId\)/);
});

test("every case workspace tab uses the page scroller — none of them fight it with their own bounded, independently-scrolling box", async () => {
  const tabs = await source("../../frontend/src/components/case-profile/CaseWorkspaceTabs.jsx");

  // Used to be limited to DOCUMENTS/APPOINTMENTS/BILLING via a
  // usesPageScroll allowlist; every other tab (PROFILE, REMINDERS,
  // QUESTIONNAIRES, FORMS, TASKS, AGREEMENTS & LETTERS, COMMUNICATION) got a
  // viewport-height-capped shell with its own overflow-y-auto — a second,
  // competing scrollbar nested inside the page's own scroll, which is what
  // made the mouse wheel feel like it was fighting itself. None of those
  // tabs' own content needs a bounded height, so the fix removes the
  // conditional entirely rather than growing the allowlist.
  assert.doesNotMatch(tabs, /usesPageScroll/);
  assert.doesNotMatch(tabs, /workspaceContentRef/);
  assert.doesNotMatch(tabs, /workspaceShellRef/);
  assert.doesNotMatch(tabs, /h-\[calc\(100dvh-7rem\)\] min-h-\[36rem\] max-h-\[56rem\] overflow-hidden/);
  assert.doesNotMatch(tabs, /min-h-0 flex-1 overflow-y-auto overscroll-contain/);
  // The workspace shell and its content area both stay in normal document
  // flow now, letting MainLayout's <main> be the only scroll container.
  assert.match(tabs, /<article className="flex flex-col overflow-clip rounded-\[2rem\]/);
  assert.match(tabs, /<div className="overflow-visible bg-white px-5 py-5">/);
});
