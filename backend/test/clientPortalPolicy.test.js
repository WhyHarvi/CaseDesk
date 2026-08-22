import test from "node:test";
import assert from "node:assert/strict";
import { resolvePermissionFromPolicies } from "../src/services/clientPortalPolicyService.js";

const policy = ({ preset = "STANDARD", status = "ACTIVE", permissions = {}, vetoes = {}, validFrom = null, validUntil = null } = {}) => ({ preset, status, permissions, vetoes, validFrom, validUntil });
const resolve = (key, values = {}) => resolvePermissionFromPolicies({ key, agencyPolicy: policy(values.agency), casePolicy: values.casePolicy || null, clientPolicy: values.clientPolicy || null, now: values.now || new Date("2026-08-22T12:00:00Z") });

test("legacy accounts inherit the Standard agency policy without stored rows", () => {
  assert.equal(resolvePermissionFromPolicies({ key: "documents.upload", agencyPolicy: null, casePolicy: null, clientPolicy: null }).allowed, true);
  assert.equal(resolvePermissionFromPolicies({ key: "documents.view_internal", agencyPolicy: null, casePolicy: null, clientPolicy: null }).allowed, false);
});

test("case and client overrides resolve in order", () => {
  const result = resolve("documents.download_finalized", {
    casePolicy: policy({ permissions: { "documents.download_finalized": { value: "DENY" } } }),
    clientPolicy: policy({ permissions: { "documents.download_finalized": { value: "ALLOW" } } }),
  });
  assert.equal(result.allowed, true);
  assert.equal(result.source, "Client override");
});

test("force deny wins over force allow and all lower layers", () => {
  const result = resolve("payments.make_payment", {
    agency: { vetoes: { "payments.make_payment": { value: "FORCE_ALLOW" } } },
    clientPolicy: policy({ permissions: { "payments.make_payment": { value: "ALLOW" } }, vetoes: { "payments.make_payment": { value: "FORCE_DENY" } } }),
  });
  assert.equal(result.allowed, false);
  assert.equal(result.source, "ADMIN_VETO");
});

test("force allow enables a safe denied permission and removing it restores inheritance", () => {
  const agency = { permissions: { "appointments.cancel": { value: "DENY" } }, vetoes: { "appointments.cancel": { value: "FORCE_ALLOW" } } };
  assert.equal(resolve("appointments.cancel", { agency }).allowed, true);
  assert.equal(resolve("appointments.cancel", { agency: { ...agency, vetoes: {} } }).allowed, false);
});

test("immutable internal-document restriction cannot be force allowed", () => {
  const result = resolve("documents.view_internal", { agency: { permissions: { "documents.view_internal": { value: "ALLOW" } }, vetoes: { "documents.view_internal": { value: "FORCE_ALLOW" } } } });
  assert.equal(result.allowed, false);
  assert.equal(result.source, "SECURITY_CEILING");
});

test("expired temporary overrides are ignored", () => {
  const result = resolve("documents.upload", { casePolicy: policy({ permissions: { "documents.upload": { value: "DENY", validUntil: "2026-08-21T12:00:00Z" } } }) });
  assert.equal(result.allowed, true);
  assert.equal(result.source, "Agency default");
});

test("suspension overrides all capabilities and is recoverable", () => {
  assert.equal(resolve("general.access", { clientPolicy: policy({ status: "SUSPENDED" }) }).source, "PORTAL_SUSPENDED");
  assert.equal(resolve("general.access", { clientPolicy: policy({ status: "ACTIVE" }) }).allowed, true);
});

test("restricted status retains only essential capabilities", () => {
  assert.equal(resolve("documents.upload", { clientPolicy: policy({ status: "RESTRICTED" }) }).allowed, true);
  assert.equal(resolve("payments.make_payment", { clientPolicy: policy({ status: "RESTRICTED" }) }).allowed, false);
});

test("unknown permission keys fail closed", () => {
  assert.equal(resolve("internal.notes", {}).allowed, false);
  assert.equal(resolve("internal.notes", {}).source, "UNKNOWN_PERMISSION");
});
