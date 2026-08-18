import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("email subject is required and word-capped before send, with a Nova shorten endpoint backing it", async () => {
  const [ollamaService, controller, routes, composer] = await Promise.all([
    source("../src/services/ollama.service.js"),
    source("../src/controllers/communicationController.js"),
    source("../src/routes/communicationRoutes.js"),
    source("../../frontend/src/components/case-profile/communication/CommunicationComposer.jsx"),
  ]);

  // Backend: a one-shot (non-chat) Ollama call, mirroring the existing
  // summarizeSupportIssue pattern, and never itself writing anything.
  assert.match(ollamaService, /export async function shortenSubjectLine\(\{ subject, maxWords \}\)/);
  assert.match(ollamaService, /think: false/);

  assert.match(controller, /import \{ shortenSubjectLine \} from "\.\.\/services\/ollama\.service\.js";/);
  assert.match(controller, /export const EMAIL_SUBJECT_MAX_WORDS = 10;/);
  assert.match(controller, /function subjectWordCount\(value\)/);

  // The real enforcement point is the send endpoint, not creation/draft-save
  // — a staff member must still be able to save an incomplete draft.
  const sendFnIndex = controller.indexOf("export async function sendCommunicationDraft");
  const nextExportIndex = controller.indexOf("\nexport ", sendFnIndex + 10);
  const sendFnBody = controller.slice(sendFnIndex, nextExportIndex === -1 ? undefined : nextExportIndex);
  assert.match(sendFnBody, /if \(existing\.channel === "Email"\) \{/);
  assert.match(sendFnBody, /throw createHttpError\(400, "Add a subject before sending this email\.", "SUBJECT_REQUIRED"\);/);
  assert.match(sendFnBody, /throw createHttpError\(\s*400,\s*`Keep the subject to \$\{EMAIL_SUBJECT_MAX_WORDS\} words or fewer \(currently \$\{words\}\)\.`,\s*"SUBJECT_TOO_LONG",?\s*\);/);

  assert.match(controller, /export async function shortenCommunicationSubject\(req, res\)/);
  assert.match(controller, /const suggestion = await shortenSubjectLine\(\{ subject, maxWords: EMAIL_SUBJECT_MAX_WORDS \}\);/);

  assert.match(routes, /shortenCommunicationSubject/);
  assert.match(routes, /router\.post\("\/subject\/shorten", asyncHandler\(shortenCommunicationSubject\)\);/);

  // Frontend: native `required` removed from the Subject input (it used to
  // block saving an incomplete draft via HTML5 validation, not just Send),
  // replaced by explicit send-time validation plus a live word counter and
  // an Ask Nova to shorten it flow.
  assert.doesNotMatch(composer, /Subject\s*\n\s*<input\s*\n\s*required/);
  assert.match(composer, /const EMAIL_SUBJECT_MAX_WORDS = 10;/);
  assert.match(composer, /const subjectWordCount = \(value\) =>/);
  assert.match(composer, /if \(intent !== "draft" && values\.channel === "Email"\) \{/);
  assert.match(composer, /Add a subject before sending this email\./);
  assert.match(composer, /Keep the subject to \$\{EMAIL_SUBJECT_MAX_WORDS\} words or fewer \(currently \$\{words\}\)\.`/);
  assert.match(composer, /Shorten with Nova/);
  assert.match(composer, /api\.post\("\/communications\/subject\/shorten", \{/);
  assert.match(composer, /Nova suggests:/);
  assert.match(composer, /const acceptSubjectSuggestion = \(\) => \{/);
});
