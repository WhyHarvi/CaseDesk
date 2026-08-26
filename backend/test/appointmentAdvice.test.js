import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = (relativePath) => readFile(new URL(relativePath, import.meta.url), "utf8");

test("the schema backs the advice model: one per appointment, a fixed set of role links, and the two new lead-activity types", async () => {
  const schema = await source("../prisma/schema.prisma");
  const model = schema.slice(schema.indexOf("model AppointmentAdvice {"), schema.indexOf("model LeadLostDetail {"));
  assert.match(model, /appointmentId\s+String\s+@unique @map\("appointment_id"\)/);
  assert.match(model, /followUpId\s+String\?\s+@unique @map\("follow_up_id"\)/);
  assert.match(model, /categories\s+String\[\]/);
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
  assert.match(profileService, /advice: canAccessInternalNotes \? data\.advice : null,/);
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
