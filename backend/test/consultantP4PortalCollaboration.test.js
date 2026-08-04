import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { documentStoragePath } from "../src/services/documentStorage.js";

const source = (relativePath) => readFile(new URL(relativePath, import.meta.url), "utf8");

test("portal document operations require linked ownership and client visibility", async () => {
  const [controller, routes] = await Promise.all([
    source("../src/controllers/portalController.js"),
    source("../src/routes/portalRoutes.js"),
  ]);
  assert.match(controller, /clientId: link\.clientId,[\s\S]*visibility: "Client"/);
  assert.match(controller, /updatedAt: existing\.updatedAt,[\s\S]*status: \{ notIn: \["Approved", "Finalized", "NotRequired"\] \}/);
  assert.match(controller, /hasFile: Boolean\(storageKey\)/);
  assert.match(controller, /data\.map\([\s\S]*\(\{ storageKey, \.\.\.item \}\)[\s\S]*\.\.\.item,[\s\S]*hasFile:/);
  assert.match(routes, /documents\/:id\/upload/);
  assert.match(routes, /documents\/:id\/file/);
  assert.match(routes, /rateLimit\(\{ windowMs: 60_000, max: 10 \}\)/);
});

test("document storage rejects traversal and preserves tenant-prefixed object keys", () => {
  assert.throws(() => documentStoragePath("../../outside.pdf"), /Invalid storage path/);
  assert.equal(documentStoragePath("agency/case/file.pdf"), "agency/case/file.pdf");
});

test("client instructions are separate from internal document notes", async () => {
  const [schema, migration, controller, page] = await Promise.all([
    source("../prisma/schema.prisma"),
    source("../prisma/migrations/20260715210000_add_client_document_instructions/migration.sql"),
    source("../src/controllers/portalController.js"),
    source("../../frontend/src/pages/Documents.jsx"),
  ]);
  assert.match(schema, /clientInstructions\s+String\?\s+@map\("client_instructions"\)/);
  assert.match(migration, /ADD COLUMN "client_instructions" TEXT/);
  assert.match(controller, /clientInstructions: true/);
  assert.doesNotMatch(controller.slice(controller.indexOf("export async function portalDocuments"), controller.indexOf("export async function uploadPortalDocument")), /notes: true/);
  assert.match(page, /This is visible to the client/);
  assert.match(page, />Internal notes</);
});

test("portal messages expose chat only and never internal communication", async () => {
  const [controller, routes] = await Promise.all([
    source("../src/controllers/portalController.js"),
    source("../src/routes/portalRoutes.js"),
  ]);
  const listSection = controller.slice(controller.indexOf("export async function portalMessages"), controller.indexOf("export async function createPortalMessage"));
  assert.match(listSection, /clientId: link\.clientId,[\s\S]*caseId: generalChat \? null : selectedCaseId,[\s\S]*channel: "Chat"/);
  assert.match(listSection, /GENERAL_CHAT_ID/);
  assert.match(listSection, /direction: \{ in: \["Inbound", "Outbound"\] \}/);
  assert.match(listSection, /deletedAt: null/);
  assert.doesNotMatch(listSection, /bodyHtml|attachments|metadata/);
  assert.match(controller, /provider: "AuthenticatedPortal"/);
  assert.match(controller, /state: "WaitingOnAgency"/);
  assert.match(routes, /router\.post\("\/messages", rateLimit/);
});

test("portal exposes the complete client appointment and billing history", async () => {
  const [controller, routes, api, appointments, payments] = await Promise.all([
    source("../src/controllers/clientPortalController.js"),
    source("../src/routes/clientPortalRoutes.js"),
    source("../../frontend/src/api/clientPortalApi.js"),
    source("../../frontend/src/pages/client-portal/ClientPortalAppointments.jsx"),
    source("../../frontend/src/pages/client-portal/ClientPortalPayments.jsx"),
  ]);
  assert.match(controller, /buildClientBillingLedger/);
  assert.match(controller, /transactions: \[\.\.\.ledger\.transactions\]\.reverse\(\)/);
  assert.match(controller, /export async function getPortalAppointments/);
  assert.match(routes, /router\.get\("\/appointments", asyncHandler\(getPortalAppointments\)\)/);
  assert.match(api, /client-portal\/appointments/);
  assert.match(appointments, /Your upcoming visits and complete appointment history/);
  assert.match(payments, /data\.transactions\.map/);
});

test("portal UI provides file exchange and messaging through the current modular pages", async () => {
  const [home, documents, api, chat] = await Promise.all([
    source("../../frontend/src/pages/client-portal/ClientPortalHome.jsx"),
    source("../../frontend/src/components/client-portal/ClientDocumentCard.jsx"),
    source("../../frontend/src/api/clientPortalApi.js"),
    source("../../frontend/src/pages/client-portal/ClientPortalChat.jsx"),
  ]);
  assert.match(home, /Documents we still need/);
  assert.match(documents, /uploadPortalDocument\(document\.id, file\)/);
  assert.match(api, /client-portal\/documents\/\$\{documentId\}\/upload/);
  assert.match(api, /client-portal\/documents\/\$\{documentId\}\/file/);
  assert.match(api, /\.post\("\/portal\/messages"/);
  assert.match(chat, /sendPortalChatMessage/);
});

test("mobile portal chat controls use an input-safe font size", async () => {
  const [chat, legacyChat] = await Promise.all([
    source("../../frontend/src/pages/client-portal/ClientPortalChat.jsx"),
    source("../../frontend/src/pages/ClientChatPortal.jsx"),
  ]);
  const composer = chat.slice(chat.indexOf("<textarea"), chat.indexOf("/>", chat.indexOf("<textarea")));
  const caseSelector = chat.slice(chat.indexOf("<select"), chat.indexOf("</select>"));
  const legacyComposer = legacyChat.slice(legacyChat.indexOf("<textarea"), legacyChat.indexOf("/>", legacyChat.indexOf("<textarea")));

  assert.match(composer, /text-base/);
  assert.match(caseSelector, /text-base/);
  assert.match(legacyComposer, /text-base/);
  assert.doesNotMatch(`${composer}${caseSelector}${legacyComposer}`, /text-xs|text-sm|text-\[(?:1[0-5])px\]/);
});

test("case E-Sign centre reuses the portal agreement lifecycle without manual signing bypasses", async () => {
  const [portalController, correspondenceController, writtenController, toolbar, profile, overlay, workspace] = await Promise.all([
    source("../src/controllers/clientPortalController.js"),
    source("../src/controllers/correspondenceController.js"),
    source("../src/controllers/writtenDocumentController.js"),
    source("../../frontend/src/components/case-profile/CaseProfileSummary.jsx"),
    source("../../frontend/src/pages/CaseProfile.jsx"),
    source("../../frontend/src/components/case-profile/ESignCenterOverlay.jsx"),
    source("../../frontend/src/components/case-profile/AgreementsLettersWorkspace.jsx"),
  ]);

  assert.match(portalController, /correspondenceKind: "Agreement"/);
  assert.match(portalController, /case: \{ deletedAt: null, archivedAt: null \}/);
  assert.match(correspondenceController, /Signed status is created only when the client completes the e-signature/);
  assert.match(correspondenceController, /Invite this client to the portal before sending an agreement for signature/);
  assert.match(writtenController, /Issued and signed documents are locked/);
  assert.match(toolbar, /item === "E-Sign"/);
  assert.match(profile, /ESignCenterOverlay/);
  assert.match(overlay, /AgreementsLettersWorkspace caseItem=\{caseItem\} eSignMode/);
  assert.match(workspace, /Awaiting client signature/);
  assert.doesNotMatch(workspace, /<option value="Signed">Signed<\/option>/);
});

test("client E-Sign supports typed and touch-drawn signatures rendered into the signed agreement", async () => {
  const [portalController, agreementCard, signaturePad, portalApi] = await Promise.all([
    source("../src/controllers/clientPortalController.js"),
    source("../../frontend/src/components/client-portal/ClientAgreementCard.jsx"),
    source("../../frontend/src/components/client-portal/SignaturePad.jsx"),
    source("../../frontend/src/api/clientPortalApi.js"),
  ]);

  assert.match(signaturePad, /onPointerDown=\{startDrawing\}/);
  assert.match(signaturePad, /touch-none/);
  assert.match(signaturePad, /toDataURL\("image\/png"\)/);
  assert.match(agreementCard, /Type signature/);
  assert.match(agreementCard, /Draw signature/);
  assert.match(agreementCard, /signatureMethod === "drawn" && !signatureImage/);
  assert.match(portalApi, /signatureMethod/);
  assert.match(portalApi, /signatureImage/);
  assert.match(portalController, /data:image\\\/png;base64/);
  assert.match(portalController, /buffer\.length > 400_000/);
  assert.match(portalController, /alt="Hand-drawn signature/);
  assert.match(portalController, /signatureMethod, signatureImage/);
  assert.match(portalController, /signatureMethod \}/);
});

test("case Manage Permissions controls owner and collaborator access without stranding active work", async () => {
  const [controller, routes, toolbar, profile, overlay] = await Promise.all([
    source("../src/controllers/caseController.js"),
    source("../src/routes/caseRoutes.js"),
    source("../../frontend/src/components/case-profile/CaseProfileSummary.jsx"),
    source("../../frontend/src/pages/CaseProfile.jsx"),
    source("../../frontend/src/components/case-profile/CasePermissionsOverlay.jsx"),
  ]);

  assert.match(routes, /\/:id\/permissions",[\s\S]*requireRole\("admin"\)/);
  assert.match(controller, /memberships: \{ some: \{ agencyId: req\.auth\.agencyId, role: "consultant", isActive: true \} \}/);
  assert.match(controller, /assignmentType: "supporting"/);
  assert.match(controller, /Reassign.*active work item/);
  assert.match(controller, /case\.permissions_updated/);
  assert.match(toolbar, /item === "Manage Permissions"/);
  assert.match(toolbar, /canManagePermissions/);
  assert.match(profile, /CasePermissionsOverlay/);
  assert.match(overlay, /Primary case owner/);
  assert.match(overlay, /Collaborating consultants/);
  assert.match(overlay, /Client portal access is managed separately through the Portal Access card/);
});

test("case options do not duplicate the existing portal access invitation controls", async () => {
  const [options, summary] = await Promise.all([
    source("../../frontend/src/components/case-profile/caseProfileUtils.js"),
    source("../../frontend/src/components/case-profile/CaseProfileSummary.jsx"),
  ]);
  assert.doesNotMatch(options, /"Send Invite"/);
  assert.match(summary, /<PortalAccessCard/);
});

test("private case chat migration restores scoped Supabase Realtime policies", async () => {
  const migration = await source("../prisma/migrations/20260716220000_restore_realtime_case_chat_policies/migration.sql");
  assert.match(migration, /to_regclass\('realtime\.messages'\)/);
  assert.match(migration, /RAISE EXCEPTION/);
  assert.match(migration, /CREATE POLICY "casedesk_private_case_chat_read"/);
  assert.match(migration, /FOR SELECT\s+TO authenticated/);
  assert.match(migration, /CREATE POLICY "casedesk_private_case_chat_write"/);
  assert.match(migration, /FOR INSERT\s+TO authenticated/);
  assert.match(migration, /SELECT auth\.jwt\(\) ->> 'agency_id'/);
  assert.match(migration, /SELECT auth\.jwt\(\) ->> 'case_id'/);
  assert.match(migration, /realtime\.topic\(\)/);
});
