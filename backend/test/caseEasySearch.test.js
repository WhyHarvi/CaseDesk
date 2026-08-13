import assert from "node:assert/strict";
import test from "node:test";
import {
  buildCaseEasyContactSearchWhere,
  cleanCaseEasySearch,
} from "../src/services/caseEasySearchService.js";

test("Case Easy identity search cleans input and requires every name term", () => {
  assert.equal(cleanCaseEasySearch("  Gagandeep   Singh  "), "Gagandeep Singh");
  const where = buildCaseEasyContactSearchWhere("Gagandeep Singh");
  assert.equal(where.AND.length, 2);
  assert.ok(
    where.AND.every((term) =>
      term.OR.some((field) => Object.hasOwn(field, "firstName")),
    ),
  );
});

test("Case Easy identity search includes imported and converted identifiers", () => {
  const serialized = JSON.stringify(
    buildCaseEasyContactSearchWhere("00834 6479781987"),
  );
  for (const field of [
    "clientIdentifier",
    "clientNumber",
    "caseNumber",
    "email",
    "phone",
    "otherEmails",
    "companyName",
  ]) {
    assert.match(serialized, new RegExp(`\\"${field}\\"`));
  }
});

test("Case Easy identity search extracts digits from formatted phone terms", () => {
  const serialized = JSON.stringify(
    buildCaseEasyContactSearchWhere("(647) 978-1987"),
  );
  assert.match(serialized, /"contains":"647"/);
  assert.match(serialized, /"contains":"9781987"/);
});
