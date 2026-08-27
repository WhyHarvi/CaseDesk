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
const mappingsPath = fileURLToPath(new URL("../../frontend/src/components/case-profile/formAutofillMappings.js", import.meta.url));
const formsWorkspacePath = fileURLToPath(new URL("../../frontend/src/components/case-profile/CaseFormsWorkspace.jsx", import.meta.url));
const workspaceTabsPath = fileURLToPath(new URL("../../frontend/src/components/case-profile/CaseWorkspaceTabs.jsx", import.meta.url));
const questionnaireSectionPath = fileURLToPath(new URL("../../frontend/src/components/case-profile/ProfileQuestionnaireSection.jsx", import.meta.url));

test("every fact catalog sectionKey is a real backend information section", () => {
  const source = readFileSync(catalogPath, "utf8");
  const declaredKeys = [...source.matchAll(/sectionKey:\s*"([^"]+)"/g)].map((match) => match[1]);
  assert.ok(declaredKeys.length > 0, "expected to find at least one sectionKey declaration in applicantFactCatalog.js");

  const validKeys = new Set(listSectionKeys());
  const unknown = declaredKeys.filter((key) => !validKeys.has(key));
  assert.deepEqual(unknown, [], `applicantFactCatalog.js references unknown section key(s): ${unknown.join(", ")}`);
});

test("an IMM missing-field shortcut enables a case-type-hidden profile section and focuses the requested field", () => {
  const catalog = readFileSync(catalogPath, "utf8");
  const mappings = readFileSync(mappingsPath, "utf8");
  const formsWorkspace = readFileSync(formsWorkspacePath, "utf8");
  const workspaceTabs = readFileSync(workspaceTabsPath, "utf8");
  const questionnaireSection = readFileSync(questionnaireSectionPath, "utf8");

  assert.match(catalog, /uci:\s*\{[\s\S]*?sectionKey:\s*"canadianStatus"[\s\S]*?editTarget:\s*\{ tab:\s*"CANADIAN STATUS" \}/);
  assert.match(mappings, /profileField:\s*key/);
  assert.match(formsWorkspace, /entry\.profileTab,[\s\S]*?entry\.profileView,[\s\S]*?entry\.profileField/);
  assert.match(workspaceTabs, /requestedStatus\?\.isVisible === false[\s\S]*?setCaseInformationSectionEnabled\([\s\S]*?requestedTab\.sectionKey,[\s\S]*?true/);
  assert.match(workspaceTabs, /setProfileSectionRequest\(\{ tab, view, field, requestId: Date\.now\(\) \}\)/);
  assert.match(questionnaireSection, /setEditing\(true\)[\s\S]*?fieldRefs\.current\[field\]\?\.focus\(\)/);
});
