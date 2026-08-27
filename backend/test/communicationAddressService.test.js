import assert from "node:assert/strict";
import test from "node:test";
import { normalizeCommunicationPhone } from "../src/services/communicationAddressService.js";

test("communication phone matching canonicalizes Canadian formats", () => {
  assert.equal(normalizeCommunicationPhone("(226) 555-1234"), "+12265551234");
  assert.equal(normalizeCommunicationPhone("+1 226 555 1234"), "+12265551234");
  assert.equal(normalizeCommunicationPhone("not-a-phone"), null);
});
