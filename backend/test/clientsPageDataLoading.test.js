import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = (relativePath) => readFile(new URL(relativePath, import.meta.url), "utf8");

// Real bug, same shape as the one just fixed on LeadsPage.jsx (2d932ff
// "Prevent lead reload request saturation"): the /clients list query and
// the /leads/staff catalog query fired together on mount with no
// sequencing. On a hard browser reload, everything else in the app is
// also mounting from scratch and firing its own initial requests at the
// same moment — firing these two together as well could saturate the
// production connection pool and leave the browser's own /clients request
// without a response, surfacing as "Unable to load clients."
test("Clients.jsx loads the staff catalog only after the client list query has finished, and the error state offers a retry instead of requiring a full page reload", async () => {
  const page = await source("../../frontend/src/pages/Clients.jsx");

  assert.doesNotMatch(page, /useEffect\(\(\) => \{\s*loadClients\(\);\s*loadUsers\(\);\s*\}, \[\]\);/);
  assert.match(page, /await loadClients\(\);\s*await loadUsers\(\);/);

  assert.match(page, /disabled=\{loading\} onClick=\{loadClients\}/);
  assert.match(page, /\{loading \? "Trying again…" : "Try again"\}/);
});
