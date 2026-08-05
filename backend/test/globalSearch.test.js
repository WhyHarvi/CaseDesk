import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { globalSearch } from "../src/controllers/globalSearchController.js";

const source = (relativePath) =>
  readFile(new URL(relativePath, import.meta.url), "utf8");

test("global search ignores incomplete queries without touching the database", async () => {
  let payload;
  await globalSearch(
    {
      auth: { agencyId: "agency-1", userId: "user-1", role: "admin" },
      query: { q: " a " },
    },
    {
      json(value) {
        payload = value;
        return value;
      },
    },
  );

  assert.deepEqual(payload, {
    data: {
      query: "a",
      groups: [],
      total: 0,
      minimumCharacters: 2,
    },
  });
});

test("global search is authenticated and available only to staff roles", async () => {
  const [server, routes] = await Promise.all([
    source("../src/server.js"),
    source("../src/routes/globalSearchRoutes.js"),
  ]);

  assert.match(
    server,
    /app\.use\("\/api\/search", requireAuth, leadUser, globalSearchRoutes\)/,
  );
  assert.match(
    server,
    /const leadUser = requireRole\("admin", "consultant", "frontdesk"\)/,
  );
  assert.match(routes, /router\.get\("\/", asyncHandler\(globalSearch\)\)/);
});

test("record searches retain agency, assignment, and deleted-record scopes", async () => {
  const controller = await source(
    "../src/controllers/globalSearchController.js",
  );

  assert.match(controller, /agencyId: req\.auth\.agencyId/);
  assert.match(controller, /leadAccessWhere\(req\)/);
  assert.match(controller, /clientAccessWhere\(req\)/);
  assert.match(controller, /caseAccessWhere\(req\)/);
  assert.match(controller, /relatedRecordAccessWhere\(req\)/);
  assert.match(controller, /deletedAt: null/);
  assert.match(controller, /hasPortalPageAccess\(req, "clients"\)/);
  assert.match(controller, /hasPortalPageAccess\(req, "cases"\)/);
  assert.match(controller, /hasPortalCapability\(req, "internalNotes"\)/);

  for (const model of [
    "lead",
    "client",
    "case",
    "clientDocument",
    "writtenDocument",
    "note",
  ]) {
    assert.match(controller, new RegExp(`prisma\\.${model}\\.findMany`));
  }
});

test("global search UI uses an unclipped portal and opens every result", async () => {
  const [topBar, search, caseProfile, clientProfile] = await Promise.all([
    source("../../frontend/src/components/dashboard/DashboardTopBar.jsx"),
    source("../../frontend/src/components/search/GlobalSearch.jsx"),
    source("../../frontend/src/pages/CaseProfile.jsx"),
    source("../../frontend/src/pages/ClientProfile.jsx"),
  ]);

  assert.match(topBar, /<GlobalSearch \/>/);
  assert.match(search, /createPortal\(/);
  assert.match(search, /document\.body/);
  assert.match(search, /fixed z-\[1000\]/);
  assert.match(search, /onClick=\{\(\) => openResult\(item\)\}/);
  assert.match(search, /navigate\(item\.url\)/);
  assert.match(search, /event\.key === "ArrowDown"/);
  assert.match(search, /event\.key === "Enter"/);
  assert.match(search, /280/);
  assert.match(caseProfile, /overlay"\) === "notes"/);
  assert.match(caseProfile, /highlightNoteId=\{highlightedNoteId\}/);
  assert.match(clientProfile, /useFadingHighlight\(highlightedNoteId/);
  assert.match(clientProfile, /domIdPrefix: "client-note-"/);
});
