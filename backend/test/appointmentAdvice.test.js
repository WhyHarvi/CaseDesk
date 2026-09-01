import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = (relativePath) => readFile(new URL(relativePath, import.meta.url), "utf8");

test("the schema backs the advice model: one per appointment, a fixed set of role links, and the two new lead-activity types", async () => {
  const schema = await source("../prisma/schema.prisma");
  const model = schema.slice(schema.indexOf("model AppointmentAdvice {"), schema.indexOf("model LeadLostDetail {"));
  assert.match(model, /appointmentId\s+String\s+@unique @map\("appointment_id"\)/);
  assert.match(model, /followUpId\s+String\?\s+@unique @map\("follow_up_id"\)/);
  assert.match(model, /clientFollowUpId\s+String\?\s+@unique @map\("client_follow_up_id"\)/);
  assert.match(model, /categories\s+String\[\]/);
  assert.match(model, /additionalAssignedUserIds\s+String\[\]\s+@default\(\[\]\) @map\("additional_assigned_user_ids"\)/);
  assert.match(model, /outcome\s+AppointmentAdviceOutcome\s+@default\(PENDING\)/);
  assert.match(schema, /enum AppointmentAdviceOutcome \{\s*PENDING\s*PROCEEDING\s*CONSIDERING\s*DECLINED\s*\}/);
  const activityEnum = schema.slice(schema.indexOf("enum LeadActivityType {"), schema.indexOf("enum LeadActivityDirection {"));
  assert.match(activityEnum, /ADVICE_RECORDED/);
  assert.match(activityEnum, /ADVICE_OUTCOME_RECORDED/);
});

test("draft saves never touch the lead — only confirmAppointmentAdvice does, and it never creates a second lead or follow-up on a repeat save", async () => {
  const service = await source("../src/services/appointmentAdviceService.js");

  const draftFn = service.slice(service.indexOf("export async function saveAppointmentAdviceDraft"), service.indexOf("// \"Save and assign\""));
  assert.doesNotMatch(draftFn, /moveLeadOwnership/);
  assert.doesNotMatch(draftFn, /leadFollowUp\.create/);
  assert.match(draftFn, /tx\.appointmentAdvice\.update/);
  assert.match(draftFn, /tx\.appointmentAdvice\.create/);

  const confirmFn = service.slice(service.indexOf("export async function confirmAppointmentAdvice"), service.indexOf("// The lead-curtain"));
  // Upsert by appointmentId (the model's @unique column) — never a second
  // AppointmentAdvice row for the same appointment.
  assert.match(confirmFn, /tx\.appointmentAdvice\.upsert\(\{\s*where: \{ appointmentId: appointment\.id \}/);
  // The existing linked follow-up is updated in place, not recreated, when
  // this appointment's advice already has one from an earlier confirm.
  assert.match(confirmFn, /followUp = existing\?\.followUpId\s*\n\s*\? await tx\.leadFollowUp\.update/);
  assert.match(confirmFn, /: await tx\.leadFollowUp\.create/);
  // Reassignment reuses the same shared ownership-move helper the rest of
  // the app uses for reassigning a lead — not a bespoke owner update here.
  assert.match(confirmFn, /moveLeadOwnership\(tx, \{/);
  assert.match(confirmFn, /ownerUserId: assignedUserId/);
  // If there's no linked lead at all, every lead-side side effect is
  // skipped — the advice still saves against the appointment alone.
  assert.match(confirmFn, /if \(appointment\.leadId\) \{/);
});

test("when the appointment has no lead (a client booked directly, or a bare walk-in), confirming advice falls back to a generic FollowUp instead of silently skipping the handoff", async () => {
  const service = await source("../src/services/appointmentAdviceService.js");
  const confirmFn = service.slice(service.indexOf("export async function confirmAppointmentAdvice"), service.indexOf("// The lead-curtain"));
  assert.match(confirmFn, /\} else \{/);
  // Update-in-place on repeat saves, same as the lead branch's followUpId reuse.
  assert.match(confirmFn, /clientFollowUp = existing\?\.clientFollowUpId\s*\n\s*\? await tx\.followUp\.update/);
  assert.match(confirmFn, /: await tx\.followUp\.create/);
  // clientId/caseId pass through as-is (both nullable on FollowUp) so this
  // works whether or not a Client is actually attached to the appointment.
  assert.match(confirmFn, /clientId: appointment\.clientId,\s*\n\s*caseId: appointment\.caseId,/);
  assert.match(confirmFn, /if \(!existing\?\.clientFollowUpId\) \{/);
  assert.match(confirmFn, /data: \{ clientFollowUpId: clientFollowUp\.id \}, include: adviceInclude/);
  // The assigned employee still gets notified even without a lead.
  assert.match(confirmFn, /\} else if \(result\.clientFollowUp\) \{/);
  assert.match(confirmFn, /type: "follow_up\.assigned"/);
  assert.match(confirmFn, /actionUrl: `\/app\/follow-ups\?highlight=\$\{encodeURIComponent\(result\.clientFollowUp\.id\)\}`/);
});

test("converting a guest appointment to a client backfills appointmentAdvice.clientId the same way it already backfills notes and follow-ups", async () => {
  const controller = await source("../src/controllers/bookingController.js");
  const convertFn = controller.slice(controller.indexOf("export async function convertAppointmentToClient"), controller.indexOf("export async function applyAppointmentStatusChange"));
  assert.match(convertFn, /tx\.note\.updateMany\(\{ where: \{ appointmentId: appointment\.id, clientId: null \}, data: \{ clientId: created\.id \} \}\)/);
  assert.match(convertFn, /tx\.followUp\.updateMany\(\{ where: \{ appointmentId: appointment\.id, clientId: null \}, data: \{ clientId: created\.id \} \}\)/);
  assert.match(convertFn, /tx\.appointmentAdvice\.updateMany\(\{ where: \{ appointmentId: appointment\.id, clientId: null \}, data: \{ clientId: created\.id \} \}\)/);
});

test("confirming advice validates every required field before touching the database, and returns the advice with its (just-created or just-updated) followUpId, not a stale pre-update snapshot", async () => {
  const service = await source("../src/services/appointmentAdviceService.js");
  const confirmFn = service.slice(service.indexOf("export async function confirmAppointmentAdvice"), service.indexOf("// The lead-curtain"));
  assert.match(confirmFn, /if \(!adviceText\) throw createHttpError\(400, "Enter the advice given to the client\."/);
  assert.match(confirmFn, /if \(!categories\.length\) throw createHttpError\(400, "Choose at least one category\."/);
  assert.match(confirmFn, /if \(!assignedUserId\) throw createHttpError\(400, "Select who should contact the client\."/);
  assert.match(confirmFn, /if \(!followUpDate \|\| Number\.isNaN\(followUpDate\.getTime\(\)\)\) throw createHttpError\(400, "Choose a follow-up date\."/);
  // The bug this guards: advice.followUpId must be re-read after the
  // separate update() that sets it, or the function returns the earlier
  // upsert()'s snapshot which still shows followUpId: null.
  assert.match(confirmFn, /advice = await tx\.appointmentAdvice\.update\(\{ where: \{ id: advice\.id \}, data: \{ followUpId: followUp\.id \}, include: adviceInclude \}\)/);
});

test("recording a call result closes the linked follow-up (if still pending) with a real completion outcome, and never rewrites the consultant's original advice text or categories", async () => {
  const service = await source("../src/services/appointmentAdviceService.js");
  const outcomeFn = service.slice(service.indexOf("export async function recordAppointmentAdviceOutcome"));
  assert.match(outcomeFn, /if \(!OUTCOME_LABEL\[outcome\]\) throw createHttpError\(400, "Choose a valid call result\."/);
  assert.match(outcomeFn, /data: \{ outcome, outcomeRecordedAt: new Date\(\), outcomeRecordedById: actorId \}/);
  assert.doesNotMatch(outcomeFn, /adviceText:/);
  assert.doesNotMatch(outcomeFn, /categories:/);
  assert.match(outcomeFn, /if \(followUp && followUp\.status === "PENDING"\) \{/);
  assert.match(outcomeFn, /status: "COMPLETED", completionOutcome: OUTCOME_LABEL\[outcome\], completedAt: new Date\(\), completedById: actorId/);
  assert.match(outcomeFn, /await syncLeadNextAction\(tx, lead\.id\)/);
});

test("syncLeadNextAction is exported for reuse outside lead.service.js — appointmentAdviceService needs it after reassigning owner and after closing the handoff follow-up", async () => {
  const leadService = await source("../src/modules/leads/lead.service.js");
  assert.match(leadService, /export async function syncLeadNextAction\(tx, leadId\)/);
});

test("the appointment-side routes require admin/consultant, matching notes and follow-ups on the same appointment", async () => {
  const routes = await source("../src/routes/appointmentRoutes.js");
  assert.match(routes, /router\.post\("\/:id\/advice\/draft", requireRole\("admin", "consultant"\), asyncHandler\(saveAppointmentAdviceDraftController\)\)/);
  assert.match(routes, /router\.post\("\/:id\/advice\/confirm", requireRole\("admin", "consultant"\), asyncHandler\(confirmAppointmentAdviceController\)\)/);
});

test("the lead-side outcome route is nested under the lead, matching the follow-up route convention", async () => {
  const routes = await source("../src/modules/leads/lead.routes.js");
  assert.match(routes, /router\.post\("\/:id\/advice\/:adviceId\/outcome", asyncHandler\(recordAppointmentAdviceOutcome\)\)/);
});

test("advice is bundled into the appointment profile payload and gated by the same internalNotes capability as notes, never shown to a client-facing view", async () => {
  const profileService = await source("../src/services/appointmentProfileService.js");
  assert.match(profileService, /advice: \{\s*include: \{/);
  assert.match(profileService, /advice: canAccessInternalNotes \? await withAdditionalAssignedUsers\(db, data\.advice\) : null,/);
});

test("additionalAssignedUserIds is deduped, capped, and never includes the primary assignee — a co-assignee needs its own real task owner check the same as the primary", async () => {
  const service = await source("../src/services/appointmentAdviceService.js");
  assert.match(service, /const MAX_ADDITIONAL_ASSIGNEES = 5;/);
  const cleanFn = service.slice(service.indexOf("function cleanAdditionalAssignedUserIds"), service.indexOf("async function resolveAdditionalAssignedUsers"));
  assert.match(cleanFn, /\[\.\.\.new Set\(cleaned\)\]\.filter\(\(id\) => id !== primaryUserId\)\.slice\(0, MAX_ADDITIONAL_ASSIGNEES\)/);
});

test("confirming advice validates every additional assignee is real, active agency staff — same integrity check as the primary — and notifies every assignee, not just the primary", async () => {
  const service = await source("../src/services/appointmentAdviceService.js");
  const confirmFn = service.slice(service.indexOf("export async function confirmAppointmentAdvice"), service.indexOf("// The lead-curtain"));
  assert.match(confirmFn, /const additionalAssignees = await Promise\.all\(\s*\n\s*additionalAssignedUserIds\.map\(\(id\) => requireLeadStaff\(tx, agencyId, id\)\),/);
  assert.match(confirmFn, /update: \{ assignedUserId, additionalAssignedUserIds, categories, adviceText, followUpDate \},/);
  assert.match(confirmFn, /const allAssigneeIds = \[\.\.\.new Set\(\[result\.advice\.assignedUserId, \.\.\.\(result\.advice\.additionalAssignedUserIds \|\| \[\]\)\]\)\];/);
  assert.match(confirmFn, /recipientIds: allAssigneeIds,/g);
  const notifyCalls = confirmFn.match(/recipientIds: allAssigneeIds,/g) || [];
  assert.equal(notifyCalls.length, 2, "both the lead-linked and client-linked notification paths must notify every assignee");
});

test("saveAppointmentAdviceDraft and recordAppointmentAdviceOutcome both resolve additionalAssignedUserIds into display-ready {id, fullName} objects, same as the primary assignedUser relation", async () => {
  const service = await source("../src/services/appointmentAdviceService.js");
  const draftFn = service.slice(service.indexOf("export async function saveAppointmentAdviceDraft"), service.indexOf("// \"Save and assign\""));
  assert.match(draftFn, /return \{ \.\.\.advice, additionalAssignedUsers: await resolveAdditionalAssignedUsers\(tx, agencyId, additionalAssignedUserIds\) \};/);
  const outcomeFn = service.slice(service.indexOf("export async function recordAppointmentAdviceOutcome"));
  assert.match(outcomeFn, /return \{ \.\.\.updated, additionalAssignedUsers: await resolveAdditionalAssignedUsers\(tx, agencyId, updated\.additionalAssignedUserIds\) \};/);
});

test("getLead includes appointmentAdvice, newest first, so the lead curtain can find the latest unresolved handoff", async () => {
  const leadService = await source("../src/modules/leads/lead.service.js");
  const fnStart = leadService.indexOf("export async function getLead(req) {");
  const fnBody = leadService.slice(fnStart, leadService.indexOf("\nexport async function listLeadSources"));
  assert.match(fnBody, /appointmentAdvice: \{\s*orderBy: \{ createdAt: "desc" \}/);
});

test("the appointment curtain's Advice & handoff section sits directly below Internal note, autosaves the draft, and never clears the form on a failed save", async () => {
  const overlay = await source("../../frontend/src/components/appointments/AppointmentProfileOverlay.jsx");
  const internalNoteIndex = overlay.indexOf("Internal note");
  const adviceIndex = overlay.indexOf("Advice &amp; handoff".replace("&amp;", "&"));
  assert.ok(internalNoteIndex > -1 && adviceIndex > internalNoteIndex, "Advice & handoff must be rendered after Internal note");
  // Categories are no longer a fixed list — they're sourced from the same
  // live, agency-wide case-type catalog real Case records use, with a
  // free-text escape hatch for anything the catalog doesn't anticipate.
  assert.match(overlay, /import MultiCaseTypeCombobox from "\.\.\/ui\/MultiCaseTypeCombobox";/);
  assert.match(overlay, /<MultiCaseTypeCombobox\s*\n\s*value=\{adviceCategories\}\s*\n\s*onChange=\{setAdviceCategories\}\s*\n\s*options=\{adviceCaseTypeOptions\}\s*\n\s*aliases=\{adviceCaseTypeAliases\}/);
  assert.match(overlay, /api\.get\("\/cases\/case-types", \{ cache: false \}\)/);
  assert.match(overlay, /useDebouncedAutosave\(\{\s*value: adviceDraftKey,\s*savedValue: savedAdviceKey,\s*enabled: showAdviceComposer && !adviceSaving,\s*onSave: saveAdviceDraft,/);
  // Failed confirm must only ever set the error — never touch the fields
  // the consultant already typed.
  const confirmFn = overlay.slice(overlay.indexOf("async function confirmAdvice"), overlay.indexOf("useDebouncedAutosave({\n    value: note"));
  assert.doesNotMatch(confirmFn, /catch[\s\S]*?setAdviceText|catch[\s\S]*?setAdviceCategories/);
  assert.match(confirmFn, /setAdviceError\(requestError\.response\?\.data\?\.message \|\| "The advice could not be saved\."\)/);
});

test("the lead curtain highlights the latest unresolved advice near the top of Overview, reuses the existing Call button (not a new dial path), and offers all three call results", async () => {
  const sheet = await source("../../frontend/src/modules/leads/components/LeadDetailSheet.jsx");
  assert.match(sheet, /const activeAdvice = \(lead\.appointmentAdvice \|\| \[\]\)\.find\(\(item\) => item\.outcome === "PENDING"\);/);
  assert.match(sheet, /Consultant advised: \{activeAdvice\.categories\.join\(", "\)\}/);
  assert.match(sheet, /onClick=\{startCall\}/);
  assert.match(sheet, /recordAdviceOutcome\(activeAdvice\.id, "PROCEEDING"\)/);
  assert.match(sheet, /recordAdviceOutcome\(activeAdvice\.id, "CONSIDERING"\)/);
  assert.match(sheet, /recordAdviceOutcome\(activeAdvice\.id, "DECLINED"\)/);
  // Reassigning who's assigned must go through the lead-owner endpoint the
  // rest of this file already uses — not a separate advice-only reassign
  // path — so "assigned employee" and "lead owner" can never drift apart.
  assert.match(sheet, /async function recordAdviceOutcome\(adviceId, outcome\) \{/);
});

test("the advice composer lets admin/consultant assign additional co-assignees beyond the primary, and the saved-advice card lists everyone assigned, not just the primary", async () => {
  const overlay = await source("../../frontend/src/components/appointments/AppointmentProfileOverlay.jsx");
  assert.match(overlay, /const \[adviceAdditionalAssignedUserIds, setAdviceAdditionalAssignedUserIds\] = useState\(\[\]\);/);
  assert.match(overlay, /setAdviceAdditionalAssignedUserIds\(data\.advice\?\.additionalAssignedUserIds \|\| \[\]\);/);
  // Picking a new primary can never leave that same person double-booked as
  // a co-assignee too.
  assert.match(overlay, /setAdviceAdditionalAssignedUserIds\(\(current\) => current\.filter\(\(id\) => id !== nextPrimary\)\);/);
  assert.match(overlay, /additionalAssignedUserIds: adviceAdditionalAssignedUserIds,/);
  assert.match(overlay, /Assigned to \{\[savedAdvice\.assignedUser\?\.fullName, \.\.\.\(savedAdvice\.additionalAssignedUsers \|\| \[\]\)\.map\(\(user\) => user\.fullName\)\]\.filter\(Boolean\)\.join\(", "\) \|\| "—"\}/);
});

test("the Advice & handoff follow-up date masks free-typed digits into YYYY-MM-DD and rejects an impossible calendar date, instead of a bare type=\"date\" input that let through nonsense like a 5-digit year or a 299 day", async () => {
  const overlay = await source("../../frontend/src/components/appointments/AppointmentProfileOverlay.jsx");
  assert.match(overlay, /import \{ calendarDateError, formatDateInput \} from "\.\.\/\.\.\/utils\/dateInputFormat\.js";/);
  assert.doesNotMatch(overlay, /type="date" value=\{adviceFollowUpDate\}/);
  assert.match(
    overlay,
    /onChange=\{\(event\) => setAdviceFollowUpDate\(formatDateInput\(event\.target\.value, event\.nativeEvent\?\.inputType\)\)\}/,
  );
  const confirmFn = overlay.slice(overlay.indexOf("async function confirmAdvice"), overlay.indexOf("useDebouncedAutosave({\n    value: note"));
  assert.match(confirmFn, /const followUpDateError = calendarDateError\(adviceFollowUpDate, "follow-up date"\);/);
  assert.match(confirmFn, /if \(followUpDateError\) \{ setAdviceError\(followUpDateError\); return; \}/);

  const dateFormat = await source("../../frontend/src/utils/dateInputFormat.js");
  assert.match(dateFormat, /const digits = raw\.replace\(\/\\D\/g, ""\)\.slice\(0, 8\);/);
});

test("completing a consultation claims the appointment's status change atomically, the same way every other attendance-marking path does, instead of a bare update that could silently overwrite a concurrent change (e.g. a call or Zoom join completing it first, or reverting an already-recorded cancellation)", async () => {
  const leadService = await source("../src/modules/leads/lead.service.js");
  const fnStart = leadService.indexOf("export async function updateConsultation(req, db = prisma) {");
  const fnBody = leadService.slice(fnStart, leadService.indexOf("\nexport", fnStart + 1));
  assert.match(fnBody, /const currentAppointment = await tx\.appointment\.findFirst\(\{ where: \{ id: existing\.appointmentId, agencyId \} \}\);/);
  assert.match(fnBody, /const claimed = await tx\.appointment\.updateMany\(\{\s*\n\s*where: \{ id: existing\.appointmentId, status: currentAppointment\.status \},/);
  assert.match(fnBody, /if \(!claimed\.count\) throw createHttpError\(409, "This appointment's status changed elsewhere just now — refresh and try again\."/);
});

test("syncLeadNextAction leaves an OPEN lead's next-action fields untouched when there's no remaining pending follow-up, instead of nulling them out — nulling would violate the leads_open_next_action_check DB constraint and crash the whole transaction", async () => {
  const leadService = await source("../src/modules/leads/lead.service.js");
  const fnStart = leadService.indexOf("export async function syncLeadNextAction(tx, leadId) {");
  const fnBody = leadService.slice(fnStart, leadService.indexOf("\n}\n", fnStart) + 3);
  assert.match(fnBody, /if \(!next\) return next;/);
  assert.doesNotMatch(fnBody, /next\?\.type \|\| null/);
});
