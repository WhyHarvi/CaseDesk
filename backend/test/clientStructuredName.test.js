import assert from "node:assert/strict";
import test from "node:test";
import { clientPayload } from "../src/controllers/clientController.js";

test("structured client names generate the CRM display name", () => {
  const payload = clientPayload({ givenNames: "  Gagandeep   Singh ", familyName: " Dhillon " });
  assert.equal(payload.givenNames, "Gagandeep Singh");
  assert.equal(payload.familyName, "Dhillon");
  assert.equal(payload.fullName, "Gagandeep Singh Dhillon");
});

test("a client with one given name remains valid for the IRCC single-name flow", () => {
  const payload = clientPayload({ givenNames: "Cher", familyName: "" });
  assert.equal(payload.givenNames, "Cher");
  assert.equal(payload.familyName, null);
  assert.equal(payload.fullName, "Cher");
});

test("unrelated edits preserve confirmed structured names", () => {
  const payload = clientPayload(
    { preferredLanguage: "English" },
    { fullName: "Avery Van Singh", givenNames: "Avery", familyName: "Van Singh", status: "Active" },
  );
  assert.equal(payload.givenNames, "Avery");
  assert.equal(payload.familyName, "Van Singh");
  assert.equal(payload.fullName, "Avery Van Singh");
});

test("legacy fullName callers remain compatible without inventing structured parts", () => {
  const payload = clientPayload({ fullName: "Legacy Client" });
  assert.equal(payload.fullName, "Legacy Client");
  assert.equal(payload.givenNames, null);
  assert.equal(payload.familyName, null);
});

test("structured intake requires at least one name part", () => {
  assert.throws(
    () => clientPayload({ givenNames: "", familyName: "" }),
    /at least a given name or family name/i,
  );
});
