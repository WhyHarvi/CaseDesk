# Consultant Appointment Scope Fix — Booking/Attendance Actions (2026-09-01)

## 1. Summary of the change

A consultant user (harpreet@chkimmigration.ca, CHK Immigration Services Inc.)
reported she could not create appointment notes, delete appointment notes, or
mark appointments as attended, despite the `consultant` role's backend
permissions already allowing all three.

Investigation found only one of the three was a real bug:

- **Create notes** — no restriction exists in code; not reproducible; no
  action taken.
- **Delete notes** — gated by an author-ownership rule
  (`note.userId === req.auth.userId` or `role === "admin"`) that applies
  identically to consultant and frontdesk roles. This is working as
  designed, not a role-permission gap, and was explicitly left unchanged
  (see "Explicitly not changed" below).
- **Mark attended (and related booking mutations)** — this was a real bug.
  Six call sites in `backend/src/controllers/bookingController.js`
  (`cancelBookingAppointment` x2 lookups, `rescheduleBookingAppointment` x2
  lookups, `convertAppointmentToClient`, `updateBookingAppointmentStatus`)
  hardcoded `req.auth.role === "consultant" ? { assignedToId: req.auth.userId }
  : {}` in their Prisma appointment lookups. This unconditionally restricted
  any consultant to only appointments assigned to them, regardless of their
  Portal Access data-scope setting. The reporting user had zero appointments
  assigned to her (all 141 appointments at her agency were assigned to two
  admins), combined with a Portal Access `data.cases: "all"` override that
  the hardcoded filter ignored entirely — so every mutation attempt 404'd.

**Root cause:** the appointment-scope check bypassed the existing
`portalDataScope()` helper that the rest of the codebase already uses for
this purpose (e.g. `caseAccessWhere` in `authorization.js`), and instead
re-implemented a simpler, non-overridable version of the same check inline
at each of the six call sites.

**Fix implemented:** each of the six conditions was changed from
`req.auth.role === "consultant" ? { assignedToId: req.auth.userId } : {}`
to
`req.auth.role === "consultant" && portalDataScope(req, "cases") !== "all"
? { assignedToId: req.auth.userId } : {}`,
using the existing `portalDataScope()` helper from
`backend/src/services/portalAccessService.js`. This brings booking/attendance
appointment lookups in line with how case-scope overrides are already
respected elsewhere in the codebase.

Files touched: `backend/src/controllers/bookingController.js` (+15/-6: the
six corrected conditions plus one new import), and a new test file,
`backend/test/bookingAppointmentScopeOverride.test.js` (17 new tests).
No other files were touched.

## 2. Explicitly NOT changed (and why)

Note-deletion behavior (author-ownership gate: only the note's author or an
admin can delete it) was deliberately left unchanged. This restriction
applies identically across consultant and frontdesk roles and is not a
role-permission gap — it is intended behavior. Widening it was out of scope
for this fix and was not requested by the underlying bug; it was
investigated and consciously ruled out, not overlooked.

"Create notes" was investigated and found not reproducible in code; no
change was made because there was nothing to fix.

## 3. User-facing vs internal

**User-facing (what a CaseDesk user might notice):**
- Any consultant whose agency admin has set their Portal Access case scope
  to `data.cases: "all"` (an explicit widening from the default) will now be
  able to cancel, reschedule, mark attended/no-show, and convert-to-client
  on appointments that are **not** assigned to them, matching the access
  level an admin already granted them for cases generally. Previously this
  group hit unexplained 404s / silent failures on these specific actions.
- Consultants on the default `"assigned"` case scope (the large majority)
  see **no behavior change** — they remain restricted to their own assigned
  appointments, as before.
- Admin and frontdesk roles are entirely unaffected; the fix only branches
  on `role === "consultant"`.
- Note creation and note deletion behavior are unchanged for all roles.

**Internal-only:**
- Six Prisma `where` clauses in `bookingController.js` now call the shared
  `portalDataScope()` helper instead of duplicating role logic inline.
- New test file exercising `portalDataScope()` directly and asserting the
  exact fixed condition is present (via source-text checks) at each of the
  six call sites, since no existing test infrastructure in this codebase
  mocks Prisma to fully invoke a controller handler end-to-end (confirmed by
  search — this is a pre-existing architectural gap, not something newly
  introduced or worked around here).

## 4. Blast radius

This is a change to **shared, global RBAC code**, not an agency-specific
patch — `bookingController.js` is used by every agency on CaseDesk, not
just CHK Immigration Services Inc. The change affects **any consultant, at
any agency, whose Portal Access has been explicitly widened to
`data.cases: "all"`** by an agency admin. Consultants left on the default
`"assigned"` scope are unaffected. The reported symptom was specific to
CHK Immigration Services Inc., but the underlying bug and the fix are not.

## 5. Rollback note

**Rollback risk: LOW.**
- Pure application-code change, no schema/data migration, no new
  dependencies.
- The diff is small and isolated to one file
  (`backend/src/controllers/bookingController.js`, six conditions + one
  import) plus one new, additive test file. No other files were touched by
  this change; unrelated pre-existing uncommitted changes from concurrent
  sessions elsewhere in the working tree were left untouched.
- Once committed, rollback is a straightforward single-commit revert and
  redeploy — no data to reverse, no forward-compatibility concerns (the
  change doesn't add or remove any stored fields).
- **Not yet committed or pushed** as of this writing — working tree only,
  pending the requesting engineer's review.

## 6. Verification performed prior to this changelog

- Confirmed via git-stash-based comparison that 2 pre-existing, unrelated
  test failures (`clientCreationActivity.test.js`, part of
  `consultantP0Authorization.test.js`) are **not** caused by this change —
  identical failures occur with and without the fix applied (root causes: a
  stale `NOTE_UPDATED` assertion and an unrelated `clientController.js`
  variable rename).
- New file `backend/test/bookingAppointmentScopeOverride.test.js`: 17/17
  tests pass — real invocations of `portalDataScope()` plus per-function
  source-text assertions confirming the fix is correctly integrated at each
  of the six call sites (not merely present somewhere in the file).
- Full existing suites re-run clean: `schedulingOperations.test.js` (62
  tests) + `appointmentAdvice.test.js` (19 tests) = 81/81 pass.
- Working tree diff confirmed isolated to exactly
  `backend/src/controllers/bookingController.js` and the new test file.

## 7. Manual verification checklist for before/after deploy

- [ ] Before deploy: confirm which consultants (across all agencies, not
      just CHK) currently have Portal Access `data.cases: "all"` set, so the
      newly-widened set of affected users is known in advance.
- [ ] After deploy: verify harpreet@chkimmigration.ca (or another affected
      CHK consultant) can now cancel, reschedule, mark attended/no-show, and
      convert-to-client on an appointment not assigned to her.
- [ ] After deploy: spot-check a consultant on the **default** `"assigned"`
      scope and confirm they are still blocked from booking actions on
      appointments not assigned to them — i.e. confirm no unintended access
      widening beyond the explicit `"all"` override group.
- [ ] After deploy: confirm admin and frontdesk role behavior on these same
      booking actions is unchanged.
- [ ] Confirm note creation and note deletion behavior are unchanged (no
      code path touched, but worth a quick spot-check since this was the
      original reported complaint).

## Changelog entry

```
## 2026-09-01 — Fix: consultant booking/attendance actions ignored widened case-scope override

Consultants with Portal Access data scope set to "all" (an explicit
agency-admin override, not the default) could not cancel, reschedule,
mark attended/no-show, or convert-to-client on appointments not
directly assigned to them, even though their case-scope setting should
have granted access. Six appointment lookups in
backend/src/controllers/bookingController.js (cancelBookingAppointment,
rescheduleBookingAppointment, convertAppointmentToClient,
updateBookingAppointmentStatus) hardcoded a consultant-only-sees-own-
appointments filter that did not check the existing portalDataScope()
override used elsewhere in the codebase. Fixed by adding the same
portalDataScope(req, "cases") !== "all" check used for case access
elsewhere. Consultants on the default "assigned" scope see no change.
Admin and frontdesk roles are unaffected. Note creation/deletion
behavior was investigated and left unchanged (deletion is correctly
gated by note authorship, not a role bug). Affects all agencies using
CaseDesk, not just the reporting agency (CHK Immigration Services
Inc.). Not yet committed/pushed as of this writing.
```

Files referenced (all absolute paths):
- `/Users/harvi/Emerks/casedesk/backend/src/controllers/bookingController.js`
- `/Users/harvi/Emerks/casedesk/backend/src/services/portalAccessService.js`
- `/Users/harvi/Emerks/casedesk/backend/test/bookingAppointmentScopeOverride.test.js`
- `/Users/harvi/Emerks/casedesk/backend/test/schedulingOperations.test.js`
- `/Users/harvi/Emerks/casedesk/backend/test/appointmentAdvice.test.js`
- `/Users/harvi/Emerks/casedesk/backend/test/clientCreationActivity.test.js` (pre-existing unrelated failure, confirmed not caused by this change)
- `/Users/harvi/Emerks/casedesk/backend/test/consultantP0Authorization.test.js` (pre-existing unrelated failure, confirmed not caused by this change)
