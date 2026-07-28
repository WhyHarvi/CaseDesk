import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { listSectionKeys } from "../src/modules/case-information/informationSectionCatalog.js";

// frontend/src/components/case-profile/applicantFactCatalog.js can't import
// this backend module directly (separate bundles), so nothing enforces its
// `sectionKey` values stay inside the 16 real section keys other than this
// test — read the frontend file as text and check every declared
// sectionKey against the backend's own list, so a typo or a renamed
// backend section key fails CI instead of silently breaking the "+ Add
// section" / requirement-level wiring for whichever fact used the stale key.
const catalogPath = fileURLToPath(new URL("../../frontend/src/components/case-profile/applicantFactCatalog.js", import.meta.url));

test("every fact catalog sectionKey is a real backend information section", () => {
  const source = readFileSync(catalogPath, "utf8");
  const declaredKeys = [...source.matchAll(/sectionKey:\s*"([^"]+)"/g)].map((match) => match[1]);
  assert.ok(declaredKeys.length > 0, "expected to find at least one sectionKey declaration in applicantFactCatalog.js");

  const validKeys = new Set(listSectionKeys());
  const unknown = declaredKeys.filter((key) => !validKeys.has(key));
  assert.deepEqual(unknown, [], `applicantFactCatalog.js references unknown section key(s): ${unknown.join(", ")}`);
});
