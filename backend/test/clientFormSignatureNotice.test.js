import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { nextActionFor } from "../src/controllers/clientPortalController.js";

const source = (path) => readFile(new URL(path, import.meta.url), "utf8");

const baseCase = { id: "case-1", stage: "Application Preparing", status: "Open" };
const noAction = { documents: [], payment: { balance: 0, paidAmount: 0 }, assessment: null, agreements: [] };

// A real reported case: a client was sent an IMM 5476 to sign, but it
// showed up neither as an "action required" notification nor on the
// portal Home page. Two independent bugs, confirmed against real data —
// the notification existed but was stored as attentionLevel "update" (so
// invisible in the default bell view and never touched the badge count),
// and the Home page's "what you need to do next" card never queried
// CaseFormSignatureRequest at all, so even a correctly-flagged
// notification would have had nothing to point to on Home.
test("a pending IMM 5476 signature request is surfaced as action-required, both as a notification and on the portal Home card", async () => {
  const [signatureController, fieldController] = await Promise.all([
    source("../src/controllers/caseFormSignatureController.js"),
    source("../src/controllers/caseFormFieldController.js"),
  ]);

  const signatureNotifySection = signatureController.slice(
    signatureController.indexOf('type: "case_form.signature_requested"'),
    signatureController.indexOf("dedupeKey:"),
  );
  assert.match(signatureNotifySection, /severity: "warning",/);
  assert.match(signatureNotifySection, /attentionLevel: "action_required",/);

  // Same latent gap, same feature area, same fix — "please complete these
  // fields" was silently missing the same two lines.
  const fieldNotifySection = fieldController.slice(
    fieldController.indexOf('type: "case_form.client_request"'),
    fieldController.indexOf("dedupeKey:"),
  );
  assert.match(fieldNotifySection, /severity: "warning",/);
  assert.match(fieldNotifySection, /attentionLevel: "action_required",/);
});

test("nextActionFor surfaces a pending form signature request on the portal Home card", () => {
  const pending = nextActionFor({
    caseItem: baseCase,
    ...noAction,
    formSignatureRequests: [{ id: "req-1", message: null, caseForm: { title: "IMM 5476" } }],
  });
  assert.equal(pending.type, "form_signature");
  assert.match(pending.title, /Sign IMM 5476/);
  assert.equal(pending.actionUrl, "/client-portal/questionnaires");

  const none = nextActionFor({ caseItem: baseCase, ...noAction, formSignatureRequests: [] });
  assert.notEqual(none.type, "form_signature");
});

test("an unsigned retainer agreement still takes priority over a form signature request", () => {
  const result = nextActionFor({
    caseItem: baseCase,
    ...noAction,
    agreements: [{ title: "Retainer Agreement", correspondenceStatus: "Issued" }],
    formSignatureRequests: [{ id: "req-1", message: null, caseForm: { title: "IMM 5476" } }],
  });
  assert.equal(result.type, "agreement");
});

test("the portal Home action card renders a Review & sign button for a pending form signature request", async () => {
  const card = await source("../../frontend/src/components/client-portal/ClientNextActionCard.jsx");
  assert.match(card, /form_signature: \{ icon: PenLine, label: "Review & sign" \}/);
});

test("getPortalOverview queries pending CaseFormSignatureRequest rows and threads them into nextActionFor", async () => {
  const controller = await source("../src/controllers/clientPortalController.js");
  assert.match(controller, /prisma\.caseFormSignatureRequest\.findMany\(\{/);
  assert.match(controller, /status: \{ in: \["Sent", "Signing"\] \}/);
  assert.match(controller, /nextActionFor\(\{ caseItem, documents, payment, assessment, agreements, formSignatureRequests \}\)/);
});
