import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeCommunicationPhone,
  oomaSenderCandidates,
} from "../src/services/communicationAddressService.js";

test("communication phone matching canonicalizes Canadian formats", () => {
  assert.equal(normalizeCommunicationPhone("(226) 555-1234"), "+12265551234");
  assert.equal(normalizeCommunicationPhone("+1 226 555 1234"), "+12265551234");
  assert.equal(normalizeCommunicationPhone("not-a-phone"), null);
});

test("Ooma sender aliases include Zapier remote-number fields", () => {
  assert.deepEqual(
    oomaSenderCandidates({ remote_number: "+12265551234", from: "" }),
    ["+12265551234"],
  );
  assert.deepEqual(
    oomaSenderCandidates({ data: { remoteNumber: "+14165550100" } }),
    ["+14165550100"],
  );
});

test("Ooma recipient is only considered as an explicit inbound fallback", () => {
  const payload = { to: "+12265551234" };
  assert.deepEqual(oomaSenderCandidates(payload), []);
  assert.deepEqual(oomaSenderCandidates(payload, { allowToFallback: true }), [
    "+12265551234",
  ]);
});
