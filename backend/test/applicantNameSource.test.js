import assert from "node:assert/strict";
import test from "node:test";
import { resolveIrccApplicantName } from "../../frontend/src/components/case-profile/applicantFactCatalog.js";

const context = ({ client = {}, applicantIdentity = {} } = {}) => ({
  client,
  formData: { profileQuestionnaires: { applicantIdentity } },
});

test("Client Intake name fields override the questionnaire as one pair", () => {
  const name = resolveIrccApplicantName(context({
    client: { familyName: "Virpal Kaur", givenNames: "", fullName: "Virpal Kaur" },
    applicantIdentity: { familyName: "", givenNames: "Virpal Kaur" },
  }));

  assert.deepEqual(name, {
    familyName: "Virpal Kaur",
    givenNames: "",
    singleName: false,
    source: "client",
    inferred: false,
  });
});

test("questionnaire names are used as a complete pair only when Client Intake has neither", () => {
  const name = resolveIrccApplicantName(context({
    client: { fullName: "Legacy Display Name" },
    applicantIdentity: { familyName: "Kaur", givenNames: "Virpal" },
  }));

  assert.equal(name.familyName, "Kaur");
  assert.equal(name.givenNames, "Virpal");
  assert.equal(name.source, "questionnaire");
});

test("a given-only intake name follows IRCC's single-name rule without borrowing a questionnaire family name", () => {
  const name = resolveIrccApplicantName(context({
    client: { givenNames: "Cher" },
    applicantIdentity: { familyName: "Conflicting questionnaire value" },
  }));

  assert.equal(name.familyName, "Cher");
  assert.equal(name.givenNames, "");
  assert.equal(name.singleName, true);
  assert.equal(name.source, "client");
});
