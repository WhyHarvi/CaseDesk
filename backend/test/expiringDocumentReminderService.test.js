import test from "node:test";
import assert from "node:assert/strict";
import {
  classifyExpiringDocumentType,
  EXPIRING_DOCUMENT_DEFINITIONS,
  extractExpiringDocumentRecords,
  EXPIRY_DEFAULT_TEMPLATES,
  renderExpiryReminderPreview,
} from "../src/services/expiringDocumentReminderService.js";

test("all supported expiration policies classify their display names", () => {
  assert.equal(EXPIRING_DOCUMENT_DEFINITIONS.length, 21);
  for (const definition of EXPIRING_DOCUMENT_DEFINITIONS) {
    assert.equal(classifyExpiringDocumentType(definition.name), definition.key, definition.name);
  }
});

test("expiry extraction reads canonical client and case profile data", () => {
  const client = { id: "client-1", fullName: "Alex", email: "alex@example.com", phone: null };
  const records = extractExpiringDocumentRecords({
    clientProfiles: [{
      client,
      data: { documents: [{ documentType: "Passport", documentNumber: "P123", expiryDate: "2027-02-10" }] },
    }],
    caseProfiles: [{
      client,
      caseId: "case-1",
      data: { currentStatus: "Study Permit", statusExpiry: "2027-06-30" },
    }],
  });
  assert.deepEqual(records.map((item) => item.documentKey).sort(), ["passport", "study-permit"]);
  assert.equal(records.find((item) => item.documentKey === "study-permit").caseId, "case-1");
});

test("canonical and legacy copies of one document are deduplicated", () => {
  const client = { id: "client-1", fullName: "Alex" };
  const records = extractExpiringDocumentRecords({
    clientProfiles: [{ client, data: { documents: [{ documentType: "Passport", expiryDate: "2027-02-10" }] } }],
    assessments: [{ client, caseId: "case-1", formData: { identityPermits: { documents: [{ documentType: "Passport", documentNumber: "P123", expiryDate: "2027-02-10" }] } } }],
  });
  assert.equal(records.length, 1);
  assert.equal(records[0].caseId, "case-1");
});

test("expiry preview resolves every placeholder", () => {
  const preview = renderExpiryReminderPreview({
    documentKey: "pr-card",
    leadDays: 183,
    ...EXPIRY_DEFAULT_TEMPLATES,
  }, "North Star Immigration");
  assert.match(preview.subject, /Permanent Resident Card/);
  assert.match(preview.message, /Alex Morgan/);
  assert.doesNotMatch(preview.message, /\{\{/);
});
