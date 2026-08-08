import assert from "node:assert/strict";
import test from "node:test";
import { canonicalCaseType, isKnownCaseTypeKey, listCaseTypeKeys, resolveCaseTypeKey } from "../src/modules/case-information/caseTypeCatalog.js";

test("resolves an exact case type match", () => {
  assert.equal(resolveCaseTypeKey("Study Permit"), "study permit");
});

test("normalizes Study and Study Permit to one canonical case type", () => {
  assert.equal(canonicalCaseType("Study"), "Study Permit");
  assert.equal(canonicalCaseType("  study   permit "), "Study Permit");
  assert.equal(canonicalCaseType("Custom Humanitarian Matter"), "Custom Humanitarian Matter");
});

test("resolves via a known alias", () => {
  assert.equal(resolveCaseTypeKey("Express Entry"), "pr - express entry - pnp");
  assert.equal(resolveCaseTypeKey("PGWP"), "work permit / open work permit");
});

test("falls back to a substring match for real-world free text not in the alias list", () => {
  // Confirmed live against dev data: "Study Permit Extension" is a real
  // case type that doesn't exact-or-alias-match anything.
  assert.equal(resolveCaseTypeKey("Study Permit Extension"), "study permit");
});

test("is case- and whitespace-insensitive", () => {
  assert.equal(resolveCaseTypeKey("  study   PERMIT  "), "study permit");
});

test("returns null for genuinely unclassified free text, never a false match", () => {
  assert.equal(resolveCaseTypeKey("Totally Made Up Type"), null);
  assert.equal(resolveCaseTypeKey(""), null);
  assert.equal(resolveCaseTypeKey(null), null);
  assert.equal(resolveCaseTypeKey(undefined), null);
});

test("listCaseTypeKeys returns all 8 known buckets", () => {
  const keys = listCaseTypeKeys();
  assert.equal(keys.length, 8);
  assert.ok(keys.includes("pr - express entry - pnp"));
  assert.ok(keys.includes("spousal and family sponsorship"));
});

test("isKnownCaseTypeKey distinguishes resolved keys from unresolved input", () => {
  assert.equal(isKnownCaseTypeKey(resolveCaseTypeKey("Express Entry")), true);
  assert.equal(isKnownCaseTypeKey(null), false);
  assert.equal(isKnownCaseTypeKey("not-a-real-key"), false);
});
