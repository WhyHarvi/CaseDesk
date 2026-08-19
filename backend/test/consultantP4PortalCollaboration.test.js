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

test("staff can answer portal chats from the client-profile side curtain", async () => {
  const [profile, drawer, controller, routes, portalAccess] = await Promise.all([
    source("../../frontend/src/pages/ClientProfile.jsx"),
    source("../../frontend/src/components/clients/ClientCommunicationCard.jsx"),
    source("../src/controllers/communicationController.js"),
    source("../src/routes/communicationRoutes.js"),
    source("../../frontend/src/components/clients/PortalAccessCard.jsx"),
  ]);
  assert.match(profile, /label="Portal chat"/);
  assert.match(profile, /QUICK_ACTION_TONES/);
  assert.match(profile, /tone="whatsapp"/);
  assert.match(profile, /tone="chat"/);
  assert.match(profile, /setChatOpen\(true\)/);
  assert.match(profile, /initialConversationId=\{initialChatConversationId\}/);
  assert.match(drawer, /fixed inset-0[\s\S]*justify-end/);
  assert.match(drawer, /bg-\[#d9fdd3\]/);
  assert.match(drawer, /\/communications\/conversations\/\$\{conversationId\}/);
  assert.match(drawer, /conversationId: conversation\.id/);
  assert.match(drawer, /channel: "Chat"/);
  assert.match(drawer, /direction: "Outbound"/);
  assert.match(drawer, /Type a reply/);
  assert.match(controller, /if \(!caseItem && !conversationContext && !clientItem\)/);
  assert.match(controller, /const clientId = caseItem\?\.clientId \|\| conversationContext\?\.clientId \|\| clientItem\.id/);
  assert.match(controller, /clientAccessWhere\(req\)/);
  assert.match(controller, /if \(!conversation && channel === "Chat"\)/);
  assert.match(drawer, /New portal message/);
  assert.match(drawer, /Start a portal conversation/);
  assert.match(drawer, /onSend=\{sendFirstMessage\}/);
  assert.match(drawer, /clientId,/);
  assert.match(drawer, /caseId: targetCaseId \|\| undefined/);
  assert.match(drawer, /portalAudience: true/);
  assert.match(drawer, /portal-chat-status/);
  assert.match(drawer, /Portal access is required/);
  assert.match(profile, /canManagePortal=\{canManageClientPortal\}/);
  assert.match(profile, /client-portal-access/);
  assert.match(portalAccess, /id="client-portal-access"/);
  assert.match(routes, /clients\/:clientId\/portal-chat-status/);
  assert.match(controller, /export async function getPortalChatStatus/);
  assert.match(controller, /status: "active"/);
  assert.match(controller, /PORTAL_ACCESS_REQUIRED/);
  assert.match(controller, /provider: "AuthenticatedPortal"/);
});

test("portal exposes the complete client appointment and billing history", async () => {
  const [controller, routes, api, appointments, payments, publicBooking, publicBookingController, paymentHolds] = await Promise.all([
    source("../src/controllers/clientPortalController.js"),
    source("../src/routes/clientPortalRoutes.js"),
    source("../../frontend/src/api/clientPortalApi.js"),
    source("../../frontend/src/pages/client-portal/ClientPortalAppointments.jsx"),
    source("../../frontend/src/pages/client-portal/ClientPortalPayments.jsx"),
    source("../../frontend/src/pages/PublicBookingPage.jsx"),
    source("../src/controllers/publicBookingController.js"),
    source("../src/services/bookingPaymentHoldService.js"),
  ]);
  assert.match(controller, /buildClientBillingLedger/);
  assert.match(controller, /transactions: \[\.\.\.ledger\.transactions\]\.reverse\(\)/);
  assert.match(controller, /export async function getPortalAppointments/);
  assert.match(routes, /router\.get\("\/appointments", asyncHandler\(getPortalAppointments\)\)/);
  assert.match(routes, /appointments\/booking-session/);
  assert.match(api, /client-portal\/appointments/);
  assert.match(appointments, /Your upcoming visits and complete appointment history/);
  assert.match(controller, /publicBookingEnabled/);
  assert.match(controller, /\/b\/\$\{encodeURIComponent\(bookingSettings\.publicSlug\)\}/);
  assert.match(appointments, /Book appointment/);
  assert.match(appointments, /portalReturnTo: "\/client-portal\/appointments"/);
  assert.match(appointments, /createPortalBookingSession/);
  assert.match(controller, /export async function createPortalBookingSession/);
  assert.match(controller, /verifiedAt: now/);
  assert.match(controller, /verificationToken/);
  assert.match(publicBooking, /portalBookingClient/);
  assert.match(publicBooking, /Back to client portal/);
  assert.match(publicBookingController, /clientId: existingClient\?\.id \|\| null/);
  assert.match(paymentHolds, /clientId,/);
  assert.match(paymentHolds, /resolveQuickBooksCustomerForBooking\(agencyId, \{/);
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
  // The textarea used to be duplicated per chat surface; it's now the one
  // shared ChatComposer, so checking it once covers all three surfaces —
  // confirmed below by checking each page actually renders it.
  const [composerSource, chat, legacyChat, drawer] = await Promise.all([
    source("../../frontend/src/components/chat/ChatComposer.jsx"),
    source("../../frontend/src/pages/client-portal/ClientPortalChat.jsx"),
    source("../../frontend/src/pages/ClientChatPortal.jsx"),
    source("../../frontend/src/components/clients/ClientCommunicationCard.jsx"),
  ]);
  const composer = composerSource.slice(composerSource.indexOf("<textarea"), composerSource.indexOf("/>", composerSource.indexOf("<textarea")));
  const caseSelector = chat.slice(chat.indexOf("<select"), chat.indexOf("</select>"));

  assert.match(composer, /text-base/);
  assert.match(caseSelector, /text-base/);
  assert.doesNotMatch(`${composer}${caseSelector}`, /text-xs|text-sm|text-\[(?:1[0-5])px\]/);
  assert.match(chat, /<ChatComposer/);
  assert.match(legacyChat, /<ChatComposer/);
  assert.match(drawer, /<ChatComposer/);
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

test("My Documents can safely delete editable Writer documents and their saved files", async () => {
  const [controller, routes, clientDocuments, workspace] = await Promise.all([
    source("../src/controllers/writtenDocumentController.js"),
    source("../src/routes/writtenDocumentRoutes.js"),
    source("../src/controllers/clientDocumentController.js"),
    source("../../frontend/src/components/case-profile/DocumentsWorkspace.jsx"),
  ]);

  const deletion = controller.slice(
    controller.indexOf("export async function deleteWrittenDocument"),
    controller.indexOf("export async function updateWrittenDocumentDraft"),
  );
  assert.match(routes, /router\.delete\("\/:id", asyncHandler\(deleteWrittenDocument\)\)/);
  assert.match(deletion, /agencyId: req\.user\.agencyId/);
  assert.match(deletion, /clientDocumentId: req\.params\.id/);
  assert.match(deletion, /issuedClientDocumentId: req\.params\.id/);
  assert.match(deletion, /if \(!existing\) return res\.status\(204\)\.send\(\)/);
  assert.match(deletion, /requireEditableDocument\(existing\)/);
  assert.match(deletion, /tx\.writtenDocument\.deleteMany/);
  assert.match(deletion, /correspondenceStatus: \{ notIn: \["Issued", "Signed", "Finalized"\] \}/);
  assert.match(deletion, /tx\.clientDocument\.deleteMany/);
  assert.match(deletion, /removeDocumentFile\(storageKey\)/);
  assert.match(deletion, /action: "written_document\.deleted"/);
  assert.match(clientDocuments, /writtenDocument:[\s\S]*correspondenceStatus: true/);
  assert.match(workspace, /title="Delete written document"/);
  assert.match(workspace, /api\.delete\(`\/written-documents\/\$\{writer\.id\}`\)/);
  assert.match(workspace, /await onRefreshDocuments\?\.\(\)/);
  assert.match(workspace, /Writer draft, its version history, and the stored Word file/);
  assert.match(workspace, /lockedWrittenDocumentStatuses/);
});

test("client E-Sign requires a touch-drawn signature rendered into the signed agreement", async () => {
  const [portalController, agreementCard, signaturePad, portalApi] = await Promise.all([
    source("../src/controllers/clientPortalController.js"),
    source("../../frontend/src/components/client-portal/ClientAgreementCard.jsx"),
    source("../../frontend/src/components/client-portal/SignaturePad.jsx"),
    source("../../frontend/src/api/clientPortalApi.js"),
  ]);

  assert.match(signaturePad, /onPointerDown=\{startDrawing\}/);
  assert.match(signaturePad, /touch-none/);
  assert.match(signaturePad, /toDataURL\("image\/png"\)/);
  assert.doesNotMatch(agreementCard, /Type signature/);
  assert.match(agreementCard, /Sign with your finger or stylus/);
  assert.match(agreementCard, /signatureMethod: "drawn"/);
  assert.match(agreementCard, /!signatureImage/);
  assert.match(portalApi, /signatureMethod/);
  assert.match(portalApi, /signatureImage/);
  assert.match(portalController, /data:image\\\/png;base64/);
  assert.match(portalController, /buffer\.length > 400_000/);
  assert.match(portalController, /alt="Hand-drawn signature/);
  assert.match(portalController, /signatureMethod, signatureImage/);
  assert.match(portalController, /signatureMethod \}/);
});

test("case Collaboration controls owner and collaborator access without stranding active work", async () => {
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
  assert.match(toolbar, /label="Collaboration" onClick=\{onOpenPermissions\}/);
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

test("the global Documents tab can actually view a document's uploaded file, not just its metadata", async () => {
  const page = await source("../../frontend/src/pages/Documents.jsx");

  // The page previously only offered Edit (metadata) and Delete — there was
  // no way to see the uploaded file itself, even though ClientDocument
  // records carry a storageKey most of the time. Reused the same preview
  // pipeline (buildDocumentPreview) and file endpoint the case-profile
  // document workspace already relies on, rather than inventing a second one.
  assert.match(page, /import \{ buildDocumentPreview, releaseDocumentPreview \} from "\.\.\/components\/case-profile\/documentPreview";/);
  assert.match(page, /async function openPreview\(documentItem\) \{/);
  assert.match(page, /if \(!documentItem\.storageKey\) \{\s*setPreview\(\{ kind: "no-file", name: documentItem\.originalFilename \|\| documentItem\.documentName \}\);/);
  assert.match(page, /const response = await api\.get\(`\/client-documents\/\$\{documentItem\.id\}\/file`, \{ responseType: "blob", timeout: 60000 \}\);/);
  assert.match(page, /const rendered = await buildDocumentPreview\(response\.data, documentItem\);/);

  // Both the table row and grid card can trigger it — clicking the
  // document name/icon, and an explicit View button for discoverability.
  assert.match(page, /function DocumentRow\(\{ item, highlighted, onView, onEdit, onDelete, deletingId, previewLoadingId \}\)/);
  assert.match(page, /function DocumentGridCard\(\{ item, highlighted, onView, onEdit, onDelete, deletingId, previewLoadingId \}\)/);
  assert.match(page, /onClick=\{\(\) => onView\(item\.raw\)\}/);
  assert.match(page, /aria-label=\{`View \$\{item\.documentName\}`\}/);

  // Downloading pulls the same file the preview just rendered, via the
  // existing ?download=1 disposition switch on the file endpoint.
  assert.match(page, /const response = await api\.get\(`\/client-documents\/\$\{preview\.documentId\}\/file\?download=1`, \{ responseType: "blob", timeout: 60000 \}\);/);
});
