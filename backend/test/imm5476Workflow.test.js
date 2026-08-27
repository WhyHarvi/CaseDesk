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
  assert.match(mapping, /"102R": false, "101R": false, "100R": false, "97R": true, "96R": false, "95R": false/);
});

test("IMM 5476 radio groups (e.g. the 'I am:' question) never let more than one option get baked in as checked", async () => {
  const [fields, renderer] = await Promise.all([
    source("../src/services/imm5476SignatureFields.js"),
    source("../src/services/pdfFormRenderService.js"),
  ]);
  // getFieldObjects() groups a radio group's entries by shared XFA name,
  // but that includes one non-widget group-level entry (type: "") alongside
  // the real type:"radiobutton" members — filtering with .every(...) over
  // the whole array (instead of filtering the members first) silently
  // treats every such group as "not a group" and skips it, which is what
  // let this bug through undetected.
  assert.match(fields, /const ids = entries\.filter\(\(entry\) => entry\.type === "radiobutton" && entry\.id\)\.map\(\(entry\) => entry\.id\)/);
  assert.doesNotMatch(fields, /entries\.every\(\(entry\) => entry\.type === "radiobutton"\)/);
  // Exactly one winner per group, resolved BEFORE any annotationStorage
  // call — pdf.js's saveDocument() bakes a "checked" appearance onto any
  // widget that ever receives a truthy call, even if a later call on a
  // sibling is meant to supersede it, so a group can never be safely
  // "corrected" after the fact — only ever set once, correctly, up front.
  assert.match(fields, /export async function applyFieldValues\(document, entries\)/);
  assert.match(fields, /if \(value\) radioWinner\.set\(siblings, fieldKey\)/);
  assert.match(fields, /document\.annotationStorage\.setValue\(winnerFieldKey, \{ value: true \}\)/);
  assert.match(fields, /if \(siblingId !== winnerFieldKey\) document\.annotationStorage\.setValue\(siblingId, \{ value: false \}\)/);
  // Both stamping entry points route every field through this, not just
  // the ones known to be radio-typed — a stale/duplicate CaseFormFieldValue
  // row for a radio field wouldn't necessarily arrive pre-labelled.
  assert.match(renderer, /await applyFieldValues\(document, entries\)/);
});

test("agencies can set their own government-form signature size instead of a single hardcoded fraction, and any staff member can adjust it", async () => {
  const [schema, fields, settingsController, routes, service, renderer] = await Promise.all([
    source("../prisma/schema.prisma"),
    source("../src/services/imm5476SignatureFields.js"),
    source("../src/controllers/governmentFormSettingsController.js"),
    source("../src/routes/accountSettingsRoutes.js"),
    source("../src/services/imm5476SignatureService.js"),
    source("../src/controllers/caseFormRenderController.js"),
  ]);
  assert.match(schema, /governmentFormSignatureScale\s+Float\?\s+@map\("government_form_signature_scale"\)/);
  // Clamped defensively — the UI control already restricts the range, but
  // resolveSignatureFillFraction is also the fallback path for an agency
  // that's never set a preference (null in the database).
  assert.match(fields, /export function resolveSignatureFillFraction\(rawValue\)/);
  assert.match(fields, /Math\.min\(MAX_SIGNATURE_FILL_FRACTION, Math\.max\(MIN_SIGNATURE_FILL_FRACTION, value\)\)/);
  assert.match(settingsController, /export async function getGovernmentFormSettings/);
  assert.match(settingsController, /export async function updateGovernmentFormSettings/);
  // Mounted on /api/account (requireAuth only), not /api/settings
  // (requireRole("admin")) — any authenticated staff member can view and
  // change this shared, agency-wide value, not just admins.
  assert.match(routes, /router\.get\("\/government-forms", rateLimit\(\{ windowMs: 60_000, max: 60 \}\), asyncHandler\(getGovernmentFormSettings\)\)/);
  assert.match(routes, /router\.put\("\/government-forms", rateLimit\(\{ windowMs: 60_000, max: 20 \}\), asyncHandler\(updateGovernmentFormSettings\)\)/);
  assert.match(settingsController, /req\.auth\.agencyId/);
  // Both places that stamp an applicant's or representative's ink onto the
  // PDF resolve the agency's own preference rather than a fixed constant.
  assert.match(service, /governmentFormSignatureScale: true/);
  assert.match(service, /resolveSignatureFillFraction\(agency\?\.governmentFormSignatureScale\)/);
  assert.match(renderer, /governmentFormSignatureScale: true/);
  assert.match(renderer, /fillFractionX: resolveSignatureFillFraction\(existing\.signatureScaleX \?\? existing\.signatureScale \?\? agency\?\.governmentFormSignatureScale\)/);
  assert.match(renderer, /fillFractionY: resolveSignatureFillFraction\(existing\.signatureScaleY \?\? existing\.signatureScale \?\? agency\?\.governmentFormSignatureScale\)/);
});

test("representatives with a saved legal first/last name skip the guess-from-full-name fallback on IMM 5476", async () => {
  const [schema, mapping, fillService, formController, fieldController, adminController, profileController] = await Promise.all([
    source("../prisma/schema.prisma"),
    source("../../frontend/src/components/case-profile/formFieldMappings/imm5476.js"),
    source("../src/services/caseFormFillService.js"),
    source("../src/controllers/caseFormController.js"),
    source("../src/controllers/caseFormFieldController.js"),
    source("../src/controllers/adminTeamMemberController.js"),
    source("../src/controllers/formSignatureProfileController.js"),
  ]);
  assert.match(schema, /firstName\s+String\?\s+@map\("first_name"\)/);
  assert.match(schema, /lastName\s+String\?\s+@map\("last_name"\)/);
  // The mapping passes explicit familyName/givenNames through to
  // normalizeIrccName the same way it already does for the applicant —
  // "explicit beats guessed" is only ever bypassed when both are empty.
  assert.match(mapping, /familyName: representative\.lastName,\s*\n\s*givenNames: representative\.firstName,\s*\n\s*fullName: representative\.fullName,/);
  // Every select that feeds a representative onto a form carries the fields.
  assert.match(fillService, /const representativeSelect = \{ fullName: true, firstName: true, lastName: true,/);
  assert.match(formController, /const representativeUserSelect = \{ id: true, fullName: true, firstName: true, lastName: true,/);
  assert.match(fieldController, /fullName: true,\s*\n\s*firstName: true,\s*\n\s*lastName: true,/);
  // The backend's own auto-stamp path (serveCaseFormFile) prefers the
  // explicit last name too, only guessing from fullName when it's blank.
  assert.match(formController, /const representativeLastName = String\(representative\?\.lastName \|\| ""\)\.trim\(\)/);
  assert.match(formController, /const representativeFamilyName = representativeLastName \|\|/);
  // Both places that can set these fields save them: admin-managed team
  // members, and a representative's own self-service profile.
  assert.match(adminController, /firstName: optionalText\(body\.firstName, 80\)/);
  assert.match(adminController, /firstName: input\.firstName,\s*\n\s*lastName: input\.lastName,/);
  assert.match(profileController, /firstName: clean\(req\.body\?\.firstName, 80\)/);
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
  assert.match(overlay, /Request client signature/);
  assert.match(overlay, /currentItem\?\.currentCopyType === "Original"/);
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
  const [controller, renderer, fields] = await Promise.all([
    source("../src/controllers/caseFormController.js"),
    source("../src/services/pdfFormRenderService.js"),
    source("../src/services/imm5476SignatureFields.js"),
  ]);
  assert.match(controller, /representativeUser: \{ select: \{ fullName: true, firstName: true, lastName: true, licenseNumber: true, formSignatureImage: true, formSignatureStrokes: true \} \}/);
  assert.match(controller, /stampXfaPdfFormValues\([\s\S]*preparedBuffer,[\s\S]*"547R": true/);
  // The "already signed?" ink-overlap check lives in exactly one shared
  // place (hasInkAnnotationInRect) so the render path and the client-signing
  // path can't drift apart on this logic again — see the next test.
  assert.match(fields, /export async function hasInkAnnotationInRect\(document, \{ pageIndex, rect \}\)/);
  assert.match(renderer, /const alreadySigned = await hasInkAnnotationInRect\(document, REPRESENTATIVE_SIGNATURE\)/);
  assert.match(renderer, /const signedDate = existingDate \|\| new Date\(\)\.toISOString\(\)\.slice\(0, 10\)/);
  assert.match(renderer, /if \(!alreadySigned\)/);
});

test("IMM 5476 crops signatures to their drawn ink and stretches that to fill most (not all) of the signature line, and retraces legacy uploaded images", async () => {
  const [fields, tracer, controller] = await Promise.all([
    source("../src/services/imm5476SignatureFields.js"),
    source("../src/services/signatureImageTrace.js"),
    source("../src/controllers/caseFormController.js"),
  ]);
  assert.match(fields, /fillFraction = DEFAULT_SIGNATURE_FILL_FRACTION\)/);
  assert.match(fields, /export function resolveSignatureFillFraction/);
  assert.match(fields, /const scaleX = targetWidth \/ drawnWidth/);
  assert.match(fields, /const scaleY = targetHeight \/ drawnHeight/);
  assert.match(fields, /const containedLeft = left \+ paddingX \+ \(boxWidth - targetWidth\) \/ 2/);
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
  // Radio-group members (e.g. the "I am:" question) are deliberately
  // skipped during rebuild, not replayed — see applyFieldValues's own
  // comment for why replaying a shared-name group's value onto every one
  // of its widgets corrupts the group. Safe here because this function's
  // only caller always immediately re-stamps the representative's required
  // selections right after the rebuild.
  assert.match(renderer, /if \(radioGroupSiblings\.has\(field\.id\)\) continue;/);
  assert.match(renderer, /await applyFieldValues\(originalDocument, entries\)/);
});

test("a client-signed or finalized IMM 5476 is served exactly as stored, even after the representative changes", async () => {
  const controller = await source("../src/controllers/caseFormController.js");
  assert.match(controller, /currentCopyType: true/);
  assert.match(controller, /const isSignedCopy = data\.currentCopyType === "ClientSigned" \|\| data\.currentCopyType === "Finalized"/);
  // The representative-refresh rebuild and re-stamp must both be gated off
  // once a client has signed — an applicant's ink signature is a PDF
  // annotation, not a field value, so rebuilding from the blank original or
  // re-stamping a different representative's info over it would silently
  // discard or misrepresent a signature the client already gave.
  assert.match(controller, /if \(isImm5476 && !isSignedCopy\) \{\s*\n\s*const embeddedSigner/);
  assert.match(controller, /const buffer = isImm5476 && !isSignedCopy\s*\n\s*\? await stampXfaPdfFormValues/);
});

test("browser autosaves cannot downgrade a client-signed form to in progress", async () => {
  const controller = await readFile(new URL("../src/controllers/caseFormController.js", import.meta.url), "utf8");
  const storeCopy = controller.slice(
    controller.indexOf("async function storeUploadedCaseFormCopy"),
    controller.indexOf("export async function uploadCaseForm"),
  );

  assert.match(storeCopy, /signatureRequests:[\s\S]*?status:\s*"Signed"/);
  assert.match(storeCopy, /existing\.signatureRequests\.length > 0/);
  assert.match(storeCopy, /SIGNED_FORM_IMMUTABLE/);
});

test("case form action menus measure and stay inside the viewport", async () => {
  const workspace = await source("../../frontend/src/components/case-profile/CaseFormsWorkspace.jsx");

  assert.match(workspace, /menuRef\.current\?\.getBoundingClientRect\(\)\.height/);
  assert.match(workspace, /window\.innerHeight - measuredHeight - padding/);
  assert.match(workspace, /window\.innerWidth - width - padding/);
  assert.match(workspace, /new ResizeObserver\(place\)/);
  assert.match(workspace, /createPortal\(/);
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
  assert.match(controller, /"561R": representativeFamilyName/);
  assert.match(controller, /"562R": representativeGivenNames/);
  assert.match(controller, /"94R": representative\?\.licenseNumber\?\.trim\(\) \|\| ""/);
  assert.match(controller, /"102R": false,[\s\S]*"101R": false,[\s\S]*"100R": false,[\s\S]*"97R": true,[\s\S]*"96R": false,[\s\S]*"95R": false/);
  assert.match(controller, /hasSavedSignature && !signatureEditor \? \{ strokes: signatureStrokes, name: representative\.fullName, fillFractionX: signatureFillFraction\.x, fillFractionY: signatureFillFraction\.y \} : null/);
});

test("editable IMM 5476 signatures can be resized directly on the PDF while signed copies stay immutable", async () => {
  const [schema, controller, routes, workspace, viewer] = await Promise.all([
    source("../prisma/schema.prisma"),
    source("../src/controllers/caseFormController.js"),
    source("../src/routes/caseFormRoutes.js"),
    source("../../frontend/src/components/case-profile/CaseFormsWorkspace.jsx"),
    source("../../frontend/src/components/case-profile/XfaPdfPreviewOverlay.jsx"),
  ]);
  assert.match(schema, /signatureScale\s+Float\?\s+@map\("signature_scale"\)/);
  assert.match(schema, /signatureScaleX\s+Float\?\s+@map\("signature_scale_x"\)/);
  assert.match(schema, /signatureScaleY\s+Float\?\s+@map\("signature_scale_y"\)/);
  assert.match(routes, /router\.get\("\/:id\/signature-editor", asyncHandler\(getCaseFormSignatureEditor\)\)/);
  assert.match(controller, /export async function getCaseFormSignatureEditor/);
  assert.match(controller, /\["ClientSigned", "Finalized"\]\.includes\(form\.currentCopyType\)/);
  assert.match(controller, /event: "SignatureResized"/);
  assert.match(workspace, /\?signatureEditor=1/);
  assert.match(workspace, /onSignatureTransformChange/);
  assert.match(viewer, /SignatureResizeLayer/);
  assert.match(viewer, /drag side handles for width/);
  assert.match(viewer, /W \{Math\.round\(scales\.x \* 100\)\}% · H \{Math\.round\(scales\.y \* 100\)\}%/);
  assert.match(viewer, /SIGNATURE_ANNOTATION_ID/);
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
  // The representative's signature is already baked into the source PDF by
  // the time the applicant signs (stamped when the filled copy was
  // generated/sent) — stamping it again unconditionally here drew a second
  // overlapping signature in the same box. Both marks are now guarded by the
  // same shared hasInkAnnotationInRect check pdfFormRenderService.js uses.
  assert.match(signer, /hasInkAnnotationInRect, readFieldValue, REPRESENTATIVE_SIGNATURE/);
  assert.match(signer, /if \(!\(await hasInkAnnotationInRect\(document, REPRESENTATIVE_SIGNATURE\)\)\) \{/);
  assert.match(signer, /if \(!\(await hasInkAnnotationInRect\(document, APPLICANT_SIGNATURE\)\)\) \{/);
});

test("signature stroke validation keeps only bounded normalized drawings", () => {
  assert.deepEqual(validatedSignatureStrokes([[[0.123456, 0.5], [1, 0]]]), [[[0.1235, 0.5], [1, 0]]]);
  assert.throws(() => validatedSignatureStrokes([[[1.01, 0.5]]]), /invalid/i);
  assert.throws(() => validatedSignatureStrokes([]), /Draw your signature/i);
});
