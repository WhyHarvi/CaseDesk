import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  caseFormAccessWhere,
  caseFormChildAccessWhere,
} from "../src/services/caseFormAccessService.js";

const source = (relativePath) =>
  readFile(new URL(relativePath, import.meta.url), "utf8");

function request(role, userId, caseScope) {
  return {
    auth: {
      agencyId: "agency-1",
      userId,
      role,
      permissions: {
        portalAccess: { data: { cases: caseScope } },
      },
    },
    user: { agencyId: "agency-1", id: userId, role },
  };
}

test("case-form predicates preserve admin, assigned, supporting, and denied case scopes", () => {
  const admin = caseFormAccessWhere(
    request("admin", "admin-1", "all"),
    { id: "form-1" },
  );
  assert.deepEqual(admin, {
    id: "form-1",
    agencyId: "agency-1",
    case: { agencyId: "agency-1" },
  });

  const assigned = caseFormAccessWhere(
    request("consultant", "consultant-1", "assigned"),
    { id: "form-1" },
  );
  assert.equal(assigned.case.agencyId, "agency-1");
  assert.deepEqual(assigned.case.OR, [
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

  const denied = caseFormAccessWhere(
    request("consultant", "consultant-1", "none"),
    { id: "form-1" },
  );
  assert.deepEqual(denied.case, {
    agencyId: "agency-1",
    id: "__portal_access_denied__",
  });

  const child = caseFormChildAccessWhere(
    request("consultant", "consultant-1", "assigned"),
    { id: "version-1", caseFormId: "form-1" },
  );
  assert.equal(child.caseForm.agencyId, "agency-1");
  assert.deepEqual(child.caseForm.case, assigned.case);
  assert.equal(child.agencyId, "agency-1");
});

test("every staff-facing case-form controller uses the assigned-case predicate", async () => {
  const [controller, fields, renderer, signatures, requests] = await Promise.all([
    source("../src/controllers/caseFormController.js"),
    source("../src/controllers/caseFormFieldController.js"),
    source("../src/controllers/caseFormRenderController.js"),
    source("../src/controllers/caseFormSignatureController.js"),
    source("../src/services/caseFormClientRequestService.js"),
  ]);
  const staffControllers = [controller, fields, renderer, signatures].join("\n");

  assert.match(
    controller,
    /where: \{ id: caseId, agencyId: req\.user\.agencyId, \.\.\.caseAccessWhere\(req\) \}/,
  );
  assert.ok(
    (staffControllers.match(/caseFormAccessWhere\(req/g) || []).length >= 17,
    "all form loaders and ID-based operations must retain case access",
  );
  assert.match(controller, /caseFormChildAccessWhere\(req/);
  assert.doesNotMatch(
    staffControllers,
    /caseForm\.findFirst\(\{ where: \{ id: req\.params\.id, agencyId: req\.user\.agencyId \}/,
  );
  assert.match(
    requests,
    /where: \{ id, agencyId, caseFormId \}/,
    "reviewing a client request must keep it attached to the accessible form",
  );
});
