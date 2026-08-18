import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("staff can correct a bad appointment subject after the fact, frontdesk included, under the same word cap as booking", async () => {
  const [controller, routes, overlay, api] = await Promise.all([
    source("../src/controllers/appointmentProfileController.js"),
    source("../src/routes/appointmentRoutes.js"),
    source("../../frontend/src/components/appointments/AppointmentProfileOverlay.jsx"),
    source("../../frontend/src/api/bookingApi.js"),
  ]);

  // Real incident: a staff member pasted a whole e-transfer confirmation
  // ("Transfer Details / Date / Reference Number / Sent From / Amount")
  // into an appointment's Subject field instead of the payment reference
  // field, and there was no way to fix it afterward without going into the
  // database directly. This closes that gap.
  assert.match(controller, /import \{ APPOINTMENT_SUBJECT_MAX_WORDS \} from "\.\/bookingController\.js";/);
  const fnIndex = controller.indexOf("export async function updateAppointmentProfileContext");
  const fnBody = controller.slice(fnIndex);
  assert.match(fnBody, /if \(!trimmedSubject\) throw createHttpError\(400, "Add a subject for this appointment\.", "SUBJECT_REQUIRED"\);/);
  assert.match(fnBody, /throw createHttpError\(\s*400,\s*`Keep the subject to \$\{APPOINTMENT_SUBJECT_MAX_WORDS\} words or fewer \(currently \$\{subjectWords\}\)\.`,\s*"SUBJECT_TOO_LONG",?\s*\);/);
  // Subject is only touched when the caller actually sent one — omitting it
  // (e.g. a purpose/notes-only save) must leave the existing subject alone.
  assert.match(fnBody, /let subject = existing\.subject;/);
  assert.match(fnBody, /if \(Object\.hasOwn\(req\.body \|\| \{\}, "subject"\)\) \{/);

  // Frontdesk was excluded from this route before — they're exactly the
  // role that does walk-in intake and would need to fix their own entry.
  assert.match(routes, /router\.patch\("\/:id\/profile", requireRole\("admin", "consultant", "frontdesk"\), asyncHandler\(updateAppointmentProfileContext\)\);/);

  // Frontend: an inline edit control on the subject itself (not folded into
  // the separate "Edit context" purpose/notes editor), with the same
  // required + word-cap + Nova-shorten UX as the booking sheet, gated to
  // the same canWrite roles (which already included frontdesk).
  assert.match(overlay, /const APPOINTMENT_SUBJECT_MAX_WORDS = 10;/);
  assert.match(overlay, /const \[editingSubject, setEditingSubject\] = useState\(false\);/);
  assert.match(overlay, /if \(!trimmed\) \{ setError\("Add a subject for this appointment\."\); return; \}/);
  assert.match(overlay, /updateAppointmentProfileContext\(appointment\.id, \{ subject: trimmed \}\)/);
  assert.match(overlay, /Shorten with Nova/);
  assert.match(overlay, /canWrite = \["admin", "consultant", "frontdesk"\]\.includes\(role\);/);

  assert.match(api, /export async function shortenAppointmentSubject\(subject\)/);
});
