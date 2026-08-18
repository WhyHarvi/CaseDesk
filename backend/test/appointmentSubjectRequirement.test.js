import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("appointment subject is required and capped at 10 words, with a Nova shorten endpoint backing it", async () => {
  const [controller, routes, api, calendarPage] = await Promise.all([
    source("../src/controllers/bookingController.js"),
    source("../src/routes/bookingRoutes.js"),
    source("../../frontend/src/api/bookingApi.js"),
    source("../../frontend/src/pages/CalendarPage.jsx"),
  ]);

  assert.match(controller, /export const APPOINTMENT_SUBJECT_MAX_WORDS = 10;/);
  assert.match(controller, /function appointmentSubjectWordCount\(value\)/);

  const createFnIndex = controller.indexOf("export async function createBookingAppointment");
  const nextExportIndex = controller.indexOf("\nexport ", createFnIndex + 10);
  const createFnBody = controller.slice(createFnIndex, nextExportIndex);
  assert.match(createFnBody, /throw createHttpError\(400, "Add a subject for this appointment\.", "SUBJECT_REQUIRED"\);/);
  assert.match(createFnBody, /throw createHttpError\(\s*400,\s*`Keep the subject to \$\{APPOINTMENT_SUBJECT_MAX_WORDS\} words or fewer \(currently \$\{subjectWords\}\)\.`,\s*"SUBJECT_TOO_LONG",?\s*\);/);
  // The require-a-subject check must run before the silent fallback default
  // is ever reached, otherwise a blank subject would still slip through as
  // the session type's name instead of being rejected.
  assert.ok(!/\|\| \(sessionType \? sessionType\.name : "Appointment"\)/.test(createFnBody));

  assert.match(controller, /export async function shortenAppointmentSubject\(req, res\)/);
  assert.match(controller, /maxWords: APPOINTMENT_SUBJECT_MAX_WORDS/);

  assert.match(routes, /shortenAppointmentSubject/);
  assert.match(routes, /router\.post\("\/appointments\/subject\/shorten", asyncHandler\(shortenAppointmentSubject\)\);/);

  assert.match(api, /export async function shortenAppointmentSubject\(subject\)/);
  assert.match(api, /"\/booking\/appointments\/subject\/shorten"/);

  // Frontend: label is no longer "(optional)", the field is validated
  // client-side too (not just at the server), and a live word counter plus
  // Nova-assist mirror the same pattern used for the email composer.
  assert.doesNotMatch(calendarPage, /Subject \(optional\)/);
  assert.match(calendarPage, /const APPOINTMENT_SUBJECT_MAX_WORDS = 10;/);
  assert.match(calendarPage, /if \(!trimmedSubject\) \{ setError\("Add a subject for this appointment\."\); return; \}/);
  assert.match(calendarPage, /Keep the subject to \$\{APPOINTMENT_SUBJECT_MAX_WORDS\} words or fewer \(currently \$\{subjectWords\}\)\.`\)/);
  assert.match(calendarPage, /Shorten with Nova/);
  assert.match(calendarPage, /Nova suggests:/);
  // The field is never silently pre-filled from the session type — the
  // staff member must type a real subject; the placeholder only explains
  // what's expected.
  assert.match(calendarPage, /placeholder="What's this appointment about\? \(e\.g\. Initial consultation\)"/);
  assert.doesNotMatch(calendarPage, /subject: c\.subject\.trim\(\) \? c\.subject : nextType/);
});

test("shortenSubjectLine guarantees the word cap even when the model overshoots on the first try", async () => {
  const ollamaService = await source("../src/services/ollama.service.js");

  assert.match(ollamaService, /async function requestShortenedSubject\(subject, maxWords, emphasize\)/);
  assert.match(ollamaService, /export async function shortenSubjectLine\(\{ subject, maxWords \}\)/);
  const fnIndex = ollamaService.indexOf("export async function shortenSubjectLine");
  const fnBody = ollamaService.slice(fnIndex);
  // Retries with a sharper instruction (more than once — a single retry
  // still overshot in practice), then a deterministic truncation as the
  // last resort — the function must never hand back something over the
  // limit it was asked for, since the send/create endpoints trust it as-is.
  assert.match(fnBody, /for \(let attempt = 0; attempt < 2 && countWords\(result\) > maxWords; attempt \+= 1\) \{\s*result = await requestShortenedSubject\(subject, maxWords, true\);/);
  assert.match(fnBody, /const sliced = result\.trim\(\)\.split\(\/\\s\+\/\)\.filter\(Boolean\)\.slice\(0, maxWords\);\s*\n\s*result = trimTrailingFillers\(sliced\)\.join\(" "\);/);

  // A hard word-count slice can land mid-phrase and leave a dangling
  // connector ("...PR pathways and", "...stay in Canada after") — the
  // fallback must trim those off generically (prepositions/conjunctions/
  // articles/auxiliaries), not via a hand-picked list of examples that
  // grows one dangling word at a time as new ones get reported.
  assert.match(ollamaService, /function trimTrailingFillers\(words\)/);
  assert.match(ollamaService, /"after", "against", "along", "among",/);
  assert.match(ollamaService, /"is", "are", "was", "were", "be", "been", "being", "am",/);
});

test("shortening never trades away the specific detail for a vaguer general phrase", async () => {
  const ollamaService = await source("../src/services/ollama.service.js");

  // Real regression: asked to shorten a subject naming a refugee claim
  // refusal, the model came back with "Client seeks alternatives to stay
  // in Canada" — technically within the word cap, but useless to a
  // consultant scanning the calendar, since it silently dropped the one
  // detail that actually mattered. The prompt now explicitly forbids that
  // trade — cut connectors before cutting a specific case detail.
  assert.match(ollamaService, /keep the specific, load-bearing details/);
  assert.match(ollamaService, /Never replace a specific detail with a vaguer general one just to save words\./);
});
