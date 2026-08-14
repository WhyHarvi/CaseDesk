import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { validatedSignatureStrokes } from "../src/utils/signatureStrokes.js";

const source = async (relative) => readFile(new URL(relative, import.meta.url), "utf8");

test("IMM 5476 appointment mapping forces the A/B/E purpose and respects the IRCC single-name rule", async () => {
  const mapping = await source("../../frontend/src/components/case-profile/formFieldMappings/imm5476.js");
  assert.match(mapping, /"547R": true/);
  assert.match(mapping, /if \(explicitGiven\) return \{ familyName: explicitGiven, givenNames: "", singleName: true \}/);
  assert.match(mapping, /representative\.licenseNumber/);
});

test("IMM 5476 representatives come from licensed profiles and never fall back to the case assignee", async () => {
  const [controller, service, workspace] = await Promise.all([
    source("../src/controllers/caseFormFieldController.js"),
    source("../src/services/caseFormFillService.js"),
    source("../../frontend/src/components/case-profile/CaseFormsWorkspace.jsx"),
  ]);
  assert.match(controller, /licenseNumber: \{ not: null \}/);
  assert.match(service, /isImm5476\(caseForm\) \? null : caseItem\?\.assignedUserId/);
  assert.match(workspace, /if \(normalizedNumber === "IMM5476"\) return item\?\.representativeUser \|\| null/);
  assert.match(workspace, /hasMappedFields\(item\) \|\| isImm5476Form\(item\)/);
  assert.match(workspace, /"Select representative"/);
});

test("client IMM 5476 signing is draw-only and the backend creates the signed PDF", async () => {
  const [portal, signer, pad] = await Promise.all([
    source("../../frontend/src/pages/client-portal/ClientPortalQuestionnaires.jsx"),
    source("../src/services/imm5476SignatureService.js"),
    source("../../frontend/src/components/client-portal/SignaturePad.jsx"),
  ]);
  assert.match(portal, /Secure draw-only signature request/);
  assert.match(portal, /The rest of the form is locked/);
  assert.match(pad, /onStrokesChange/);
  assert.match(signer, /pdfjs_internal_editor_casedesk-representative/);
  assert.match(signer, /pdfjs_internal_editor_casedesk-applicant/);
  assert.match(signer, /copyType: "ClientSigned"/);
});

test("signature stroke validation keeps only bounded normalized drawings", () => {
  assert.deepEqual(validatedSignatureStrokes([[[0.123456, 0.5], [1, 0]]]), [[[0.1235, 0.5], [1, 0]]]);
  assert.throws(() => validatedSignatureStrokes([[[1.01, 0.5]]]), /invalid/i);
  assert.throws(() => validatedSignatureStrokes([]), /Draw your signature/i);
});
