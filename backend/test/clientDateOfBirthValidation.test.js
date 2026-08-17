import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { clientPayload } from "../src/controllers/clientController.js";

test("client DOB accepts only a strict real YYYY-MM-DD calendar date", () => {
  assert.equal(clientPayload({ givenNames: "Aman", dateOfBirth: "1990-05-23" }).dateOfBirth.toISOString(), "1990-05-23T00:00:00.000Z");
  assert.throws(() => clientPayload({ givenNames: "Aman", dateOfBirth: "05/23/1990" }), /must use YYYY-MM-DD/);
  assert.throws(() => clientPayload({ givenNames: "Aman", dateOfBirth: "1990-02-30" }), /real calendar date/);
  assert.throws(() => clientPayload({ givenNames: "Aman", dateOfBirth: "1899-12-31" }), /from 1900 onward/);
  assert.throws(() => clientPayload({ givenNames: "Aman", dateOfBirth: "2999-01-01" }), /cannot be in the future/);
});

test("add-client DOB UI preserves bad input and highlights the field inline", async () => {
  const clientsPage = await readFile(new URL("../../frontend/src/pages/Clients.jsx", import.meta.url), "utf8");
  assert.match(clientsPage, /placeholder="YYYY-MM-DD"/);
  assert.match(clientsPage, /aria-invalid=\{Boolean\(dobError\)\}/);
  assert.match(clientsPage, /Correct the highlighted date of birth before saving/);
  assert.match(clientsPage, /Date of birth cannot be in the future/);
});
