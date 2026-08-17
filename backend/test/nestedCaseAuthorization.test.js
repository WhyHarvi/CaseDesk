import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  caseLinkedRecordAccessWhere,
  relatedRecordAccessWhere,
  relatedRecordParentAccessWhere,
} from "../src/middleware/authorization.js";
import { normalizePortalAccess } from "../src/services/portalAccessService.js";

const source = (relativePath) =>
  readFile(new URL(relativePath, import.meta.url), "utf8");

function request(role, userId, { clients = "assigned", cases = "assigned" } = {}) {
  const agencyId = "agency-1";
  return {
    auth: {
      role,
      userId,
      agencyId,
      permissions: {
        portalAccess: normalizePortalAccess(role, {
          data: { clients, cases },
        }),
      },
    },
    user: { id: userId, role, agencyId },
  };
}

test("case-linked children cannot inherit access through a different case on the same client", () => {
  const req = request("consultant", "consultant-1");
  const where = relatedRecordAccessWhere(req);

  assert.deepEqual(where.OR[0].caseId, { not: null });
  assert.equal(where.OR[0].case.agencyId, "agency-1");
  assert.deepEqual(where.OR[0].case.OR, [
    { assignedUserId: "consultant-1" },
    {
      assignments: {
        some: {
          consultantUserId: "consultant-1",
          status: "active",
        },
      },
    },
  ]);
  assert.equal(where.OR[1].caseId, null);
  assert.equal(where.OR[1].client.agencyId, "agency-1");
  assert.ok(
    where.OR[1].client.OR.some(
      (branch) => branch.assignedUserId === "consultant-1",
    ),
  );
  assert.equal(
    where.OR.some((branch) => branch.client && branch.caseId !== null),
    false,
    "client access must never authorize a record that is attached to a case",
  );
});

test("admin and explicit all/none scopes remain compatible with nested predicates", () => {
  assert.deepEqual(relatedRecordAccessWhere(request("admin", "admin-1")), {});

  const all = relatedRecordAccessWhere(
    request("consultant", "consultant-1", { clients: "all", cases: "all" }),
  );
  assert.deepEqual(all.OR[0].case, { agencyId: "agency-1" });
  assert.deepEqual(all.OR[1].client, { agencyId: "agency-1" });

  const denied = caseLinkedRecordAccessWhere(
    request("consultant", "consultant-1", { cases: "none" }),
  );
  assert.deepEqual(denied.case, {
    agencyId: "agency-1",
    id: "__portal_access_denied__",
  });
});

test("attachment parent access carries the same case/client boundary", () => {
  const req = request("consultant", "consultant-1");
  const parent = relatedRecordParentAccessWhere(req);
  assert.equal(parent.agencyId, "agency-1");
  assert.deepEqual(parent.OR, relatedRecordAccessWhere(req).OR);
});

test("documents, folders, Writer, and correspondence use assignment-aware predicates", async () => {
  const [documents, folders, writer, correspondence, billing, library] = await Promise.all([
    source("../src/controllers/clientDocumentController.js"),
    source("../src/controllers/documentFolderController.js"),
    source("../src/controllers/writtenDocumentController.js"),
    source("../src/controllers/correspondenceController.js"),
    source("../src/controllers/caseBillingRetainerController.js"),
    source("../src/controllers/sharedLibraryController.js"),
  ]);

  assert.ok((documents.match(/relatedRecordAccessWhere\(req\)/g) || []).length >= 6);
  assert.match(documents, /requireAccessibleDocumentParent/);
  assert.match(documents, /requireAccessibleFolder/);
  assert.match(folders, /\.\.\.caseAccessWhere\(req\)/);
  assert.ok((folders.match(/caseLinkedRecordAccessWhere\(req\)/g) || []).length >= 2);
  assert.ok((writer.match(/caseLinkedRecordAccessWhere\(req\)/g) || []).length >= 3);
  assert.match(writer, /\.\.\.caseAccessWhere\(req\)/);
  assert.match(correspondence, /caseAccessPredicate: caseAccessWhere\(req\)/);
  assert.match(correspondence, /caseLinkedRecordAccessWhere\(req\)/);
  assert.match(billing, /\.\.\.caseAccessWhere\(req\)/);
  assert.match(billing, /caseAccessPredicate: caseAccessWhere\(req\)/);
  assert.match(library, /\.\.\.caseAccessWhere\(req\)/);
});

test("communications, inbox analytics, attachments, and chat links retain record scope", async () => {
  const [communications, attachments, operations, clientChat] = await Promise.all([
    source("../src/controllers/communicationController.js"),
    source("../src/controllers/communicationAttachmentController.js"),
    source("../src/controllers/communicationOperationsController.js"),
    source("../src/controllers/clientCommunicationController.js"),
  ]);

  assert.ok((communications.match(/relatedRecordAccessWhere\(req\)/g) || []).length >= 12);
  assert.match(communications, /AND: \[\s*relatedRecordAccessWhere\(req\)/);
  assert.match(communications, /messageOwnershipWhere\(req, communicationPermissions\)/);
  assert.match(attachments, /messageParentAccessWhere\(req, communicationPermissions\)/);
  assert.match(operations, /\.\.\.relatedRecordAccessWhere\(req\)/);
  assert.match(operations, /caseId is required to view communication audit history/);
  assert.match(operations, /conversationId: \{ in: conversationIds \}/);
  assert.match(clientChat, /\.\.\.caseAccessWhere\(req\)/);
});
