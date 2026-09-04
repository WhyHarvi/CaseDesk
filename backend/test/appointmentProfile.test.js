import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  appointmentProfileAccessWhere,
  ensureAppointmentCompletionFollowUp,
  requireAppointmentProfile,
} from "../src/services/appointmentProfileService.js";
import { shouldAutoMarkAttendedFromNote } from "../src/controllers/appointmentProfileController.js";

const source = (relativePath) =>
  readFile(new URL(relativePath, import.meta.url), "utf8");

test("calendar client identity opens the connected client profile", async () => {
  const [calendar, profile] = await Promise.all([
    source("../../frontend/src/pages/CalendarPage.jsx"),
    source(
      "../../frontend/src/components/appointments/AppointmentProfileOverlay.jsx",
    ),
  ]);

  assert.match(calendar, /clientProfilePath = effectiveClient\?\.id/);
  assert.match(calendar, /to=\{clientProfilePath\}/);
  assert.match(calendar, /Open \$\{person\}'s client profile/);
  assert.match(profile, /`\/app\/clients\/\$\{appointment\.client\.id\}`/);
});

test("a client's appointments card defaults to All, with Upcoming/History alongside it, and every row keeps its status badge", async () => {
  const [card, controller] = await Promise.all([
    source("../../frontend/src/components/appointments/ClientAppointmentsCard.jsx"),
    source("../src/controllers/clientController.js"),
  ]);

  assert.match(card, /useState\("all"\)/);
  assert.match(card, /\[\["all", "All"\], \["upcoming", "Upcoming"\], \["history", "History"\]\]/);
  assert.match(card, /statusTone\[item\.status\]/);
  // scope=all is also the backend's own fallback, so a card that forgets to
  // send scope at all still shows everything rather than silently filtering.
  assert.match(controller, /const scope = \["upcoming", "history", "all"\]\.includes\(String\(req\.query\.scope\)\)\s*\? String\(req\.query\.scope\)\s*: "all";/);
});

test("client appointment shortcuts open the correct workflow, reveal it, and briefly identify the work area", async () => {
  const [card, overlay] = await Promise.all([
    source("../../frontend/src/components/appointments/ClientAppointmentsCard.jsx"),
    source("../../frontend/src/components/appointments/AppointmentProfileOverlay.jsx"),
  ]);

  const clientProfile = await source("../../frontend/src/pages/ClientProfile.jsx");
  assert.doesNotMatch(card, /Pre-consultation form|Advice &amp; handoff/);
  assert.match(clientProfile, /openAppointment\(workflowAppointmentId, "pre-consultation"\)/);
  assert.match(clientProfile, /openAppointment\(workflowAppointmentId, "advice-handoff", "notes"\)/);
  assert.match(clientProfile, /initialAction=\{selectedAppointment\.action\}/);
  assert.ok(clientProfile.indexOf("Pre-consultation form") < clientProfile.indexOf("<ClientAppointmentsCard"));
  assert.match(overlay, /initialAction === "advice-handoff" \? "notes"/);
  assert.match(overlay, /initialAction === "pre-consultation" \? "details"/);
  assert.match(overlay, /openAdviceComposer\(\)/);
  assert.match(overlay, /useFadingHighlight\(initialAction/);
  assert.match(overlay, /domIdPrefix: "appointment-action-"/);
  assert.match(overlay, /id="appointment-action-pre-consultation"/);
  assert.match(overlay, /id="appointment-action-advice-handoff"/);
  assert.ok(
    overlay.indexOf('id="appointment-action-advice-handoff"') < overlay.indexOf("Advice & handoff"),
    "the advice beacon belongs on the Advice & handoff card",
  );
  assert.match(overlay, /focus\(\{ preventScroll: true \}\)/);
});

test("appointment notes show the client query before an explicit note composer", async () => {
  const profile = await source(
    "../../frontend/src/components/appointments/AppointmentProfileOverlay.jsx",
  );
  const detailsStart = profile.indexOf('tab === "details"');
  const notesStart = profile.indexOf('tab === "notes"');
  const historyStart = profile.indexOf('tab === "history"');
  const detailsPanel = profile.slice(detailsStart, notesStart);
  const notesPanel = profile.slice(notesStart, historyStart);

  assert.ok(detailsStart >= 0 && notesStart > detailsStart && historyStart > notesStart);
  assert.doesNotMatch(detailsPanel, /Client query|Client’s reason/);
  assert.match(notesPanel, /Client query/);
  assert.ok(notesPanel.indexOf("Client query") < notesPanel.indexOf("Internal note"));
  assert.match(notesPanel, /onClick=\{cancelContextEdit\}/);
  assert.match(profile, /function cancelContextEdit\(\)[\s\S]*setPurpose\(appointment\?\.purpose \|\| appointment\?\.description \|\| ""\)[\s\S]*setInternalNotes\(appointment\?\.internalNotes \|\| ""\)[\s\S]*setEditingContext\(false\)/);
  assert.match(notesPanel, /setShowNoteComposer\(true\)/);
  assert.match(notesPanel, />Cancel</);
  assert.match(notesPanel, /Save note/);
});

test("a saved note by any permitted staff member auto-marks a started appointment attended without touching future or terminal appointments", async () => {
  const started = {
    id: "appointment-1",
    status: "Scheduled",
    assignedToId: "consultant-1",
    startsAt: "2026-08-27T14:00:00.000Z",
  };
  const input = { appointment: started, role: "consultant", userId: "consultant-1", now: new Date("2026-08-27T14:05:00.000Z") };

  assert.equal(shouldAutoMarkAttendedFromNote(input), true);
  assert.equal(shouldAutoMarkAttendedFromNote({ ...input, now: new Date("2026-08-27T13:59:00.000Z") }), false);
  assert.equal(shouldAutoMarkAttendedFromNote({ ...input, appointment: { ...started, status: "Cancelled" } }), false);
  assert.equal(shouldAutoMarkAttendedFromNote({ ...input, appointment: { ...started, status: "NoShow" } }), false);
  assert.equal(shouldAutoMarkAttendedFromNote({ ...input, userId: "consultant-2" }), true);
  assert.equal(shouldAutoMarkAttendedFromNote({ ...input, role: "admin" }), true);
  assert.equal(shouldAutoMarkAttendedFromNote({ ...input, role: "frontdesk" }), true);

  const [controller, bookingController, api, overlay] = await Promise.all([
    source("../src/controllers/appointmentProfileController.js"),
    source("../src/controllers/bookingController.js"),
    source("../../frontend/src/api/bookingApi.js"),
    source("../../frontend/src/components/appointments/AppointmentProfileOverlay.jsx"),
  ]);
  assert.match(controller, /expectedStatus: "Scheduled"/);
  assert.match(controller, /savedNewInternalNote[\s\S]*?shouldAutoMarkAttendedFromNote/);
  assert.match(bookingController, /where: \{ id: existing\.id, status: expectedStatus \}/);
  assert.match(api, /meta: response\.data\.meta \|\| \{\}/);
  assert.match(overlay, /created\?\.meta\?\.attendanceAutoMarked/);
});

test("reliable consultation activity shares one guarded attendance pipeline", async () => {
  const [attendance, profileController, routes, api, overlay, twilio, zoom, leadService] = await Promise.all([
    source("../src/services/appointmentAttendanceService.js"),
    source("../src/controllers/appointmentProfileController.js"),
    source("../src/routes/appointmentRoutes.js"),
    source("../../frontend/src/api/bookingApi.js"),
    source("../../frontend/src/components/appointments/AppointmentProfileOverlay.jsx"),
    source("../src/services/twilioCallService.js"),
    source("../src/controllers/zoomController.js"),
    source("../src/modules/leads/lead.service.js"),
  ]);

  assert.match(attendance, /expectedStatus: "Scheduled"/);
  assert.match(attendance, /MINIMUM_ATTENDED_CALL_SECONDS = 30/);
  assert.match(attendance, /if \(candidates\.length !== 1\) return false/);
  assert.match(profileController, /Assigned staff completed advice and handoff/);
  assert.match(profileController, /\["admin", "consultant"\]\.includes\(req\.auth\.role\)/);
  assert.match(profileController, /Client checked in at the front desk/);
  assert.match(routes, /router\.post\("\/:id\/check-in", requireRole\("admin", "frontdesk"\)/);
  assert.match(api, /export async function checkInAppointmentClient/);
  assert.match(overlay, /Check in client/);
  assert.match(overlay, /saved\.meta\?\.attendanceAutoMarkError/);
  assert.match(twilio, /autoMarkPhoneAppointmentFromCall\(result\.session\)/);
  assert.match(zoom, /event\.event === "meeting\.participant_joined"/);
  assert.match(zoom, /Consultant and client joined Zoom/);
  assert.match(leadService, /appointmentStatus === "Completed"\) await ensureAppointmentCompletionFollowUp/);

  // "One guarded pipeline" must hold for Complete Consultation too — it's
  // the one caller that sets an appointment's status directly rather than
  // through applyAppointmentStatusChange (bookingController.js). A bare
  // update() here (no expectedStatus re-check) would let it race a Twilio
  // call or Zoom join that completes the same appointment first, silently
  // overwriting whatever that already set — including reverting an
  // already-recorded cancellation — instead of surfacing the conflict.
  assert.match(leadService, /const currentAppointment = await tx\.appointment\.findFirst\(\{ where: \{ id: existing\.appointmentId, agencyId \} \}\);/);
  assert.match(leadService, /const claimed = await tx\.appointment\.updateMany\(\{\s*where: \{ id: existing\.appointmentId, status: currentAppointment\.status \},/);
  assert.match(leadService, /if \(!claimed\.count\) throw createHttpError\(409, "This appointment's status changed elsewhere just now — refresh and try again\."/);
});

test("dashboard upcoming appointments open the client profile or save an unlinked visitor", async () => {
  const [dashboard, controller] = await Promise.all([
    source("../../frontend/src/components/dashboard/DashboardWorkRow.jsx"),
    source("../src/controllers/dashboardController.js"),
  ]);
  assert.match(controller, /client: \{ select: \{ id: true, fullName: true \} \}/);
  assert.match(dashboard, /const client = item\.client \|\| item\.case\?\.client \|\| null/);
  assert.match(dashboard, /to=\{`\/app\/clients\/\$\{client\.id\}`\}/);
  assert.match(dashboard, /convertAppointmentToClient\(item\.id\)/);
  assert.match(dashboard, /Save as client/);
  assert.doesNotMatch(dashboard, /AppointmentProfileOverlay/);
});

test("calendar keeps no-show appointments in their original time slot", async () => {
  const calendar = await source("../../frontend/src/pages/CalendarPage.jsx");
  assert.match(calendar, /\["Scheduled", "Completed", "NoShow"\]\.includes\(item\.status\)/);
  assert.match(calendar, /item\.status === "NoShow" \? NO_SHOW_TONE/);
  assert.match(calendar, /No-show/);
});

test("a no-show appointment can be rescheduled through the normal protected flow", async () => {
  const [calendar, controller] = await Promise.all([
    source("../../frontend/src/pages/CalendarPage.jsx"),
    source("../src/controllers/bookingController.js"),
  ]);
  assert.match(calendar, /Reschedule missed appointment/);
  assert.match(controller, /status: \{ in: \["Scheduled", "NoShow"\] \}/);
  assert.match(controller, /existing\.status === "NoShow" \? \{ status: "Scheduled" \}/);
  assert.match(controller, /types: \["appointment\.no_show"\]/);
});

test("a no-show can be corrected to attended when the consultation happened outside the calendar", async () => {
  const [calendar, controller] = await Promise.all([
    source("../../frontend/src/pages/CalendarPage.jsx"),
    source("../src/controllers/bookingController.js"),
  ]);
  assert.match(calendar, /Mark as attended/);
  assert.match(calendar, /Correct the attendance record without changing the original appointment time/);
  assert.match(calendar, /appointment\.status === "NoShow"[\s\S]*onStatus\("Completed"\)[\s\S]*Reschedule missed appointment/);
  assert.match(controller, /correctingNoShowToCompleted = existing\.status === "NoShow" && status === "Completed"/);
  assert.match(controller, /existing\.status !== "Scheduled" && !correctingNoShowToCompleted/);
  assert.match(controller, /status === "Completed" && req\.auth\.role === "frontdesk"/);
});

test("appointment profile is visible across the staff calendar", () => {
  const where = appointmentProfileAccessWhere({ auth: { role: "consultant", userId: "user-1" } });
  assert.deepEqual(where, {});
});

test("appointment profile preserves legacy purpose and hides staff records from front desk", async () => {
  let capturedWhere;
  const db = {
    appointment: {
      findFirst: async ({ where }) => {
        capturedWhere = where;
        return {
          id: "appointment-1",
          description: "Discuss study permit options",
          purpose: null,
          internalNotes: "Staff context",
          notes: [{ id: "note-1" }],
          events: [
            { id: "event-1", type: "NOTE_ADDED" },
            { id: "event-2", type: "BOOKED" },
          ],
          followUps: [{ id: "follow-up-1" }],
        };
      },
    },
  };
  const result = await requireAppointmentProfile(
    { auth: { role: "frontdesk", agencyId: "agency-1", userId: "user-1" } },
    "appointment-1",
    db,
  );

  assert.equal(capturedWhere.agencyId, "agency-1");
  assert.equal(result.purpose, "Discuss study permit options");
  assert.equal(result.internalNotes, null);
  assert.deepEqual(result.notes, []);
  assert.deepEqual(result.clientNotes, []);
  assert.deepEqual(result.events, [{ id: "event-2", type: "BOOKED" }]);
  assert.deepEqual(result.followUps, []);
});

test("appointment profile combines profile notes with notes from every client appointment", async () => {
  let capturedWhere;
  const notes = [
    { id: "profile-note", appointmentId: null, caseId: null },
    { id: "appointment-note", appointmentId: "appointment-1", caseId: null },
  ];
  const db = {
    appointment: {
      findFirst: async () => ({
        id: "appointment-1",
        clientId: "client-1",
        description: null,
        purpose: null,
        internalNotes: null,
        notes: [notes[1]],
        followUps: [],
      }),
    },
    note: {
      findMany: async ({ where }) => {
        capturedWhere = where;
        return notes;
      },
    },
  };

  const result = await requireAppointmentProfile(
    { auth: { role: "admin", agencyId: "agency-1", userId: "user-1" } },
    "appointment-1",
    db,
  );

  assert.equal(capturedWhere.clientId, "client-1");
  assert.equal(capturedWhere.deletedAt, null);
  assert.deepEqual(capturedWhere.OR[0].appointmentId, { not: null });
  assert.equal(capturedWhere.OR[1].appointmentId, null);
  assert.equal(capturedWhere.OR[1].caseId, null);
  assert.deepEqual(result.clientNotes, notes);
});

test("appointment profile preserves notes for a visitor who is not a client yet", async () => {
  const notes = [{ id: "guest-note", appointmentId: "appointment-1", content: "Guest context" }];
  const db = {
    appointment: {
      findFirst: async () => ({
        id: "appointment-1",
        clientId: null,
        description: null,
        purpose: null,
        internalNotes: null,
        notes,
        followUps: [],
      }),
    },
    note: {
      findMany: async () => {
        throw new Error("Guest notes should come from the appointment include");
      },
    },
  };

  const result = await requireAppointmentProfile(
    { auth: { role: "admin", agencyId: "agency-1", userId: "user-1" } },
    "appointment-1",
    db,
  );

  assert.deepEqual(result.clientNotes, notes);
});

test("completed appointments create one traceable follow-up", async () => {
  const created = [];
  const db = {
    followUp: {
      findFirst: async () => null,
      create: async ({ data }) => {
        created.push(data);
        return { id: "follow-up-1", ...data };
      },
    },
    appointmentAdvice: { findUnique: async () => null },
  };
  const appointment = {
    id: "appointment-1",
    agencyId: "agency-1",
    clientId: "client-1",
    caseId: "case-1",
    assignedToId: "user-1",
    subject: "Study permit consultation",
  };

  const result = await ensureAppointmentCompletionFollowUp(db, appointment);

  assert.equal(result.appointmentId, "appointment-1");
  assert.equal(result.clientId, "client-1");
  assert.equal(result.caseId, "case-1");
  assert.equal(result.assignedUserId, "user-1");
  assert.equal(created.length, 1);
});

test("completed appointments reuse an existing pending follow-up", async () => {
  let createCalled = false;
  const existing = { id: "follow-up-existing", appointmentId: "appointment-1" };
  const db = {
    followUp: {
      findFirst: async () => existing,
      create: async () => {
        createCalled = true;
      },
    },
    appointmentAdvice: { findUnique: async () => { throw new Error("should short-circuit before checking advice"); } },
  };

  const result = await ensureAppointmentCompletionFollowUp(db, {
    id: "appointment-1",
    agencyId: "agency-1",
    clientId: "client-1",
    assignedToId: "user-1",
  });

  assert.equal(result, existing);
  assert.equal(createCalled, false);
});

// Regression: Advice & Handoff (appointmentAdviceService.js) creates its own
// task for this same appointment — a LeadFollowUp when the appointment is
// lead-linked, tracked via AppointmentAdvice.followUpId, which lives in a
// different table than this function's own dedupe check above. Without this,
// completing a consultation that already had advice recorded created a
// second, differently-worded "Follow up after {subject}" task for the same
// outcome, in addition to the specific "Call client regarding X advice" one.
test("completed appointments skip the generic follow-up when Advice & Handoff already created its own task for this appointment", async () => {
  for (const advice of [{ followUpId: "lead-follow-up-1", clientFollowUpId: null }, { followUpId: null, clientFollowUpId: "generic-follow-up-1" }]) {
    let createCalled = false;
    const db = {
      followUp: {
        findFirst: async () => null,
        create: async () => { createCalled = true; },
      },
      appointmentAdvice: { findUnique: async () => advice },
    };

    const result = await ensureAppointmentCompletionFollowUp(db, {
      id: "appointment-1",
      agencyId: "agency-1",
      clientId: "client-1",
      assignedToId: "user-1",
    });

    assert.equal(result, null);
    assert.equal(createCalled, false);
  }
});

test("pressing Escape while completing a consultation does not discard the in-progress notes", async () => {
  const [overlay, leadDetail] = await Promise.all([
    source(
      "../../frontend/src/components/appointments/AppointmentProfileOverlay.jsx",
    ),
    source("../../frontend/src/modules/leads/components/LeadDetailSheet.jsx"),
  ]);

  // The overlay's global Escape listener routes through requestClose(),
  // which guards on completingConsultation the same way it already guards
  // on `saving` — and, since this file's own note composer/edit fields
  // autosave on a debounce, also flushes any pending autosave before
  // closing, so Escape can't discard a note that just hadn't hit its
  // debounce yet either.
  assert.match(overlay, /if \(saving \|\| completingConsultation\) return;/);
  assert.match(overlay, /if \(event\.key === "Escape"\) requestClose\(\);/);
  assert.match(
    overlay,
    /const results = await Promise\.all\(\[\s*flushNewNoteAutosave\(\),\s*flushNoteEditAutosave\(\),\s*\]\);\s*if \(results\.every\(\(result\) => result !== false\)\) onClose\(\);/,
  );

  // Same bug, same fix, in the lead detail sheet's Escape listener: it
  // already guards on sibling sheets like bookingOpen/activeAction/
  // selectedAppointmentId, but was missing completingConsultation, so
  // Escape while writing consultation notes closed the entire lead detail
  // sheet instead of doing nothing.
  assert.match(
    leadDetail,
    /!qualificationPrompt && !closingFollowUp && !selectedAppointmentId && !completingConsultation && onClose\(\)/,
  );
});

test("consultation notes survive a browser reload the same way the New Appointment sheet and Client drawer do", async () => {
  const [sheet, overlay, leadDetail] = await Promise.all([
    source(
      "../../frontend/src/modules/leads/components/CompleteConsultationSheet.jsx",
    ),
    source(
      "../../frontend/src/components/appointments/AppointmentProfileOverlay.jsx",
    ),
    source("../../frontend/src/modules/leads/components/LeadDetailSheet.jsx"),
  ]);

  // The sheet mirrors its form into sessionStorage, keyed by consultation
  // id, and hydrates from it on mount instead of always starting blank.
  assert.match(
    sheet,
    /const CONSULTATION_DRAFT_STORAGE_KEY = "casedesk:consultation-complete-draft"/,
  );
  assert.match(sheet, /function readConsultationDraft\(\)/);
  assert.match(sheet, /function writeConsultationDraft\(draft\)/);
  assert.match(sheet, /function clearConsultationDraft\(\)/);
  assert.match(sheet, /export function getDraftConsultationId\(\)/);
  assert.match(
    sheet,
    /if \(draft\?\.consultationId === consultation\.id\) return draft\.form;/,
  );
  assert.match(
    sheet,
    /writeConsultationDraft\(\{ consultationId: consultation\.id, form \}\);/,
  );
  // A real close (Cancel, X, or the backdrop) discards the draft so it never
  // resurrects on the next unrelated "Complete consultation" click; only a
  // reload while the sheet is still open should bring it back.
  assert.match(sheet, /function closeAndDiscardDraft\(\)/);
  assert.match(sheet, /clearConsultationDraft\(\);\n\s*onSaved\(response\.data\.data\);/);

  // Both places that render the sheet only keep it open in plain React
  // state, which a reload wipes — so each restores completingConsultation
  // from the sessionStorage draft once its own data (consultations /
  // appointment) has loaded back in, reattaching the still-open sheet to
  // the right consultation.
  assert.match(overlay, /getDraftConsultationId\(\) === appointment\.leadConsultation\.id\) setCompletingConsultation\(true\)/);
  assert.match(leadDetail, /const match = consultations\.find\(\(item\) => item\.id === draftConsultationId\);/);
  assert.match(leadDetail, /if \(match\) setCompletingConsultation\(match\);/);
});
