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

test("IMM 5476 fills a separate country code and punctuation-free full telephone number", async () => {
  const mapping = await source("../../frontend/src/components/case-profile/formFieldMappings/imm5476.js");
  assert.match(mapping, /"80R": phone\.countryCode/);
  assert.match(mapping, /"79R": phone\.number/);
  assert.match(mapping, /trimmed\.replace\(\/\\D\/g, ""\)/);
  assert.match(mapping, /explicitCallingCode/);
  assert.match(mapping, /defaultCountryCode === "1" && digits\.length === 11/);
  assert.match(mapping, /countryCode: "1", number: digits\.slice\(1\)/);
});

test("IMM 5476 setup does not present an empty checklist or disabled generic actions", async () => {
  const overlay = await source("../../frontend/src/components/case-profile/FormFieldChecklistOverlay.jsx");
  assert.match(overlay, /progress && !isImm5476/);
  assert.match(overlay, /Representative selected/);
  assert.match(overlay, /will be applied automatically when you open IMM 5476/);
  assert.match(overlay, /isImm5476 && checklist\?\.available === false/);
  assert.match(overlay, />Done<\/button>/);
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

test("selecting an IMM 5476 representative immediately refreshes their saved form contact details", async () => {
  const [controller, overlay, workspace] = await Promise.all([
    source("../src/controllers/caseFormFieldController.js"),
    source("../../frontend/src/components/case-profile/FormFieldChecklistOverlay.jsx"),
    source("../../frontend/src/components/case-profile/CaseFormsWorkspace.jsx"),
  ]);
  assert.match(controller, /formOfficeEmail: true/);
  assert.match(controller, /include: \{ representativeUser: \{ select: representativeUserSelect \} \}/);
  assert.match(overlay, /onFormChanged\?\.\(response\.data\.data\)/);
  assert.match(workspace, /setChecklistTarget\(\(current\) => current\?\.id === updatedForm\.id/);
});

test("opening IMM 5476 applies the selected representative's saved signature and date without stacking duplicates", async () => {
  const [controller, renderer] = await Promise.all([
    source("../src/controllers/caseFormController.js"),
    source("../src/services/pdfFormRenderService.js"),
  ]);
  assert.match(controller, /representativeUser: \{ select: \{ fullName: true, formSignatureImage: true, formSignatureStrokes: true \} \}/);
  assert.match(controller, /stampXfaPdfFormValues\([\s\S]*preparedBuffer,[\s\S]*"547R": true/);
  assert.match(renderer, /const alreadySigned = annotations\.some/);
  assert.match(renderer, /const signedDate = existingDate \|\| new Date\(\)\.toISOString\(\)\.slice\(0, 10\)/);
  assert.match(renderer, /if \(!alreadySigned\)/);
});

test("IMM 5476 contains signatures at their natural aspect ratio and retraces legacy uploaded images", async () => {
  const [fields, tracer, controller] = await Promise.all([
    source("../src/services/imm5476SignatureFields.js"),
    source("../src/services/signatureImageTrace.js"),
    source("../src/controllers/caseFormController.js"),
  ]);
  assert.match(fields, /width = Math\.min\([\s\S]*height \* 3\)/);
  assert.match(fields, /const containedLeft = left \+ \(right - left - width\) \/ 2/);
  assert.match(tracer, /const normalizedInkAspect = \(inkWidth \/ inkHeight\) \/ 3/);
  assert.match(tracer, /export function isTracedImageSignature/);
  assert.match(controller, /isTracedImageSignature\(representative\.formSignatureStrokes\)/);
  assert.match(controller, /traceSignatureImageToStrokes/);
});

test("representative setup opens the newly updated IMM 5476 without a stale cached form", async () => {
  const [controller, overlay, workspace] = await Promise.all([
    source("../src/controllers/caseFormController.js"),
    source("../../frontend/src/components/case-profile/FormFieldChecklistOverlay.jsx"),
    source("../../frontend/src/components/case-profile/CaseFormsWorkspace.jsx"),
  ]);
  assert.match(controller, /Cache-Control", "private, no-store"/);
  assert.match(overlay, /setCurrentItem\(\(current\) => \(\{ \.\.\.current, \.\.\.response\.data\.data \}\)\)/);
  assert.match(overlay, /onOpenForm\(currentItem\)/);
  assert.match(workspace, /const imm5476 = returned\.find\(isImm5476Form\)/);
  assert.match(workspace, /onOpenForm=\{openFormFromSetup\}/);
});

test("changing representatives removes a prior representative's embedded signature and date", async () => {
  const [controller, renderer] = await Promise.all([
    source("../src/controllers/caseFormController.js"),
    source("../src/services/pdfFormRenderService.js"),
  ]);
  assert.match(controller, /const embeddedSigner = await imm5476RepresentativeSignatureName\(storedBuffer\)/);
  assert.match(controller, /copyType: "Original"/);
  assert.match(controller, /rebuildImm5476FromOriginal\(storedBuffer, originalBuffer\)/);
  assert.match(renderer, /field\.id === REPRESENTATIVE_SIGNATURE\.dateFieldId \|\| field\.id === APPLICANT_SIGNATURE\.dateFieldId/);
  assert.match(renderer, /originalDocument\.annotationStorage\.setValue\(field\.id, \{ value \}\)/);
});

test("preparing IMM 5476 fills the date beside both representative and client signatures", async () => {
  const renderer = await source("../src/services/pdfFormRenderService.js");
  assert.match(renderer, /const signedDate = existingDate \|\| new Date\(\)\.toISOString\(\)\.slice\(0, 10\)/);
  assert.match(renderer, /setValue\(REPRESENTATIVE_SIGNATURE\.dateFieldId, \{ value: signedDate \}\)/);
  assert.match(renderer, /setValue\(APPLICANT_SIGNATURE\.dateFieldId, \{ value: signedDate \}\)/);
});

test("opening a form reloads the authoritative representative and overwrites stale embedded representative names", async () => {
  const [controller, workspace] = await Promise.all([
    source("../src/controllers/caseFormController.js"),
    source("../../frontend/src/components/case-profile/CaseFormsWorkspace.jsx"),
  ]);
  assert.match(workspace, /const formsResponse = await api\.get\(`\/case-forms\?caseId=\$\{caseId\}`\)/);
  assert.match(workspace, /representative: representativeFor\(currentItem\)/);
  assert.match(controller, /"561R": representativeFamilyName, "562R": representativeGivenNames/);
  assert.match(controller, /hasSavedSignature \? \{ strokes: signatureStrokes, name: representative\.fullName \} : null/);
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
