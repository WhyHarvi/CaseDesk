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
  assert.match(controller, /searchWhenAllowed\(access\.clients/);
  assert.match(controller, /searchWhenAllowed\(access\.cases/);
  assert.match(controller, /searchWhenAllowed\(access\.documents/);
  assert.match(controller, /searchWhenAllowed\(access\.notes/);
  assert.match(controller, /hasPortalPageAccess\(req, "caseEasyImport"\)/);
  assert.match(controller, /searchWhenAllowed\(canSearchCaseEasy/);
  assert.match(controller, /prisma\.caseEasyImportContact\.findMany/);
  assert.match(controller, /label: "Case Easy imports"/);
  assert.match(controller, /view=contacts&contact=/);
  assert.match(controller, /global_search\.source_failed/);
  assert.match(controller, /SEARCH_UNAVAILABLE/);

  const clientSearch = controller.slice(
    controller.indexOf('searchWhenAllowed(access.clients, req, "clients"'),
    controller.indexOf('searchWhenAllowed(access.cases, req, "cases"'),
  );
  assert.doesNotMatch(clientSearch, /deletedAt/);

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
  assert.match(search, /response\.data\.data\?\.warning/);
  assert.match(search, /caseEasy: Database/);
  assert.match(caseProfile, /overlay"\) === "notes"/);
  assert.match(caseProfile, /highlightNoteId=\{highlightedNoteId\}/);
  assert.match(clientProfile, /useFadingHighlight\(highlightedNoteId/);
  assert.match(clientProfile, /domIdPrefix: "client-note-"/);
});

test("lead search surfaces Import Review leads too, clearly labeled and routed to the right list", async () => {
  const controller = await source("../src/controllers/globalSearchController.js");

  // Previously scoped to leadSegmentWhere() (defaults to "STANDARD"), so a
  // lead created by the Admissions bulk import was invisible to search no
  // matter how exactly someone typed their name or lead number — a real
  // report ("we are unable to see it through search bar" for a specific,
  // real, non-deleted lead). Removed the segment filter entirely and
  // labeled the result instead of hiding it.
  assert.doesNotMatch(controller, /\.\.\.leadSegmentWhere\(\)/);
  assert.match(controller, /const inReview = lead\.pipelineSegment === "IMPORT_REVIEW";/);
  assert.match(controller, /meta: join\(inReview \? "Import Review" : null, lead\.stage, lead\.status\)/);

  // The Leads list and Import Review list are separate routes, each
  // hardcoded to one segment (see LeadsPage) — a result has to link to
  // whichever one the lead actually lives in, or clicking it opens a list
  // that silently shows nothing for that lead.
  assert.match(controller, /const listPath = inReview \? "\/leads\/review" : "\/leads";/);
  assert.match(controller, /url: `\$\{listPath\}\?search=\$\{encodeURIComponent\(lead\.leadNumber\)\}`/);
});

test("client name search matches regardless of word order, and a converted Case Easy contact links straight to its client profile", async () => {
  const controller = await source("../src/controllers/globalSearchController.js");

  // A real Case Easy-imported client whose source firstName/lastName
  // columns were reversed ended up with fullName stored as "Singh
  // Jashandeep" — a plain, order-sensitive substring match on the whole
  // query string made that client invisible to search whenever the query
  // was typed in natural word order. Confirmed live: querying both
  // "Jashandeep Singh" and "Singh Jashandeep" now finds the client either
  // way (each word required to appear somewhere in fullName, independent
  // of order — the same idea caseEasySearchService.js already used for its
  // own contact search, applied here to every client-name lookup).
  assert.match(controller, /function fullNameSearchClause\(query, field = "fullName"\)/);
  assert.match(controller, /if \(terms\.length <= 1\) return \{ \[field\]: \{ contains: query, mode: "insensitive" \} \};/);
  assert.match(controller, /return \{ AND: terms\.map\(\(term\) => \(\{ \[field\]: \{ contains: term, mode: "insensitive" \} \}\)\) \};/);
  const fullNameClauseUses = controller.match(/fullNameSearchClause\(query(?:, "fullName")?\)/g) || [];
  assert.ok(fullNameClauseUses.length >= 6, `expected fullNameSearchClause to replace every client/user fullName filter, found ${fullNameClauseUses.length}`);
  assert.doesNotMatch(controller, /fullName: \{ contains: query, mode: "insensitive" \}/);

  // A contact already converted to a real client used to always link to
  // the Case Easy staging page — reaching the client's own profile took a
  // second click on a "Converted" badge there. Confirmed live: a converted
  // contact's search result now links directly to /app/clients/:id.
  assert.match(controller, /convertedClient: \{ select: \{ id: true, clientNumber: true \} \}/);
  assert.match(controller, /url: contact\.convertedClient\?\.id\s*\n\s*\? `\/app\/clients\/\$\{contact\.convertedClient\.id\}`/);
});
