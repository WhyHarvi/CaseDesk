---
type: decision
status: implemented
risk: critical
---

# Manager Role Permissions Proposal

## Implementation note (post-proposal)

Implemented as proposed below, plus one addition not in the original scope:
a dedicated role-transition endpoint (`PATCH /admin/team-members/:id/role`,
admin-only) so an admin can move an existing consultant/frontdesk/manager
between those three roles without deleting and re-inviting the account.
`updateTeamMember`'s existing `ROLE_CHANGE_NOT_ALLOWED` guard is what this
endpoint is — it was a placeholder pointing at "a dedicated role-transition
workflow" before this existed.

The `requireRole(...)` audit for "should this admin+consultant/admin-only
route also admit manager" turned out to span far more than [[Authorization]]
and [[Users and Onboarding]] initially named: the same question applies to
`src/server.js`'s `staffUser`/`leadUser` gates (which wrap nearly every
mounted route) and `src/modules/leads/lead.routes.js` (lead dashboard,
reports, transfer requests, bulk reassignment — none of it was in the
original file inventory). Both were extended along the same admin-exclusive
/ admin+manager split documented below. Lead performance dashboard/reports
went to admin+manager (team-oversight bucket) with a new frontend
`ManagementRoute` guard, since `AdminRoute` was too narrow and loosening it
would have opened every genuinely admin-only page.

Open questions below were resolved as: incentive-role edit stays admin-only
(view opened to manager); financial-data capability defaults on for manager
(matches the admin-mirrored default, per-user override still available via
Portal Access).

## Context

`UserRole` (`prisma/schema.prisma:21`) already defines `manager`, but it is dead:
not one `requireRole()` call, one `defaultPortalAccess()` branch, or the
Team Members creation UI (`managedRoles` in `adminTeamMemberController.js:26`,
currently `Set(["consultant", "frontdesk"])`) references it. The only two
mentions in `backend/src` are a display-list in `communicationController.js`
and a comment calling it one of "a few unused roles."

Today's meaningfully wired roles, from weakest to strongest, per
[[Authorization]]:

- `client` — portal-only, scoped to their own case(s).
- `frontdesk` — workspace-wide **view** of clients/cases/leads; almost no
  mutation rights.
- `consultant` — the case-worker role. Defaults to `assigned`-only data
  scope; full case-tab access on their own cases; can mutate cases/clients
  they're assigned to.
- `admin` — everything, unconditionally (`portalAccessForRequest` and every
  `*AccessWhere` helper short-circuit to full access for `admin`).

Goal: a `manager` role that sits between `admin` and `consultant` — sees and
runs the whole team's work, but doesn't touch billing integrations, financial
finality actions, or account/security provisioning.

## Two independent gates to satisfy

1. **Portal access** (`backend/src/services/portalAccessService.js`) — pages,
   case tabs, data scope (`none`/`assigned`/`all`), capabilities. Already a
   generic, data-driven, per-role-default + per-user-override system. Adding
   a role here means adding one `defaultPortalAccess()` branch, not new
   conditional logic.
2. **`requireRole(...roles)`** (`backend/src/middleware/authorization.js:11`)
   — a hardcoded allowlist at ~50 individual route call sites. There is no
   data-driven layer here; every site that should admit `manager` needs
   `"manager"` added to its role list.

## Recommended permission set

### Portal access defaults (new `manager` branch in `defaultPortalAccess`)

Mirror `admin`'s shape exactly — all pages, all case tabs, all capabilities,
`data: { leads: "all", clients: "all", cases: "all" }`. A manager's value is
whole-team visibility; there's no case for `assigned`-only scope on this
role. Per-user overrides via `normalizePortalAccess` still work if an agency
wants to dial one manager back later.

### Extend to include `manager` (oversight & case operations)

Grouped by what capability they represent — same shape as the existing
`admin`+`consultant` pairs, just widened by one role:

- **Case lifecycle & content** — update/close/archive/unarchive/delete/restore,
  applicants CRUD, assessment, information sections, workflow (save + apply
  template + step update), ledger CRUD (`caseRoutes.js:157-233`).
- **Case collaboration governance** — access-request review/approve/decline,
  client-portal-policy get/put/reset (`caseRoutes.js:117-126`, `122-124`).
- **Client mutation** — update/archive/close (`clientRoutes.js:118-121`).
- **Appointments** — notes, follow-ups, advice draft/confirm
  (`appointmentRoutes.js:19-22`).
- **Billing operations short of finality** — invoice create, cash payment,
  manual payment, payment-schedule create/update/retry
  (`caseRoutes.js:244-327`). Explicitly **not** void/refund — see below.
- **Team oversight** (currently admin-only in `adminRoutes.js`) —
  `consultants/workload` (view) and `consultants/workload/reassign`, and
  `consultants/collaboration-requests` (list/approve). This is the
  signature manager action: reassigning work across the team.
- **Incentive visibility** — `incentives/summary/team`
  (`incentiveRoutes.js:11`), and `admin/incentive-role-members` as
  **read-only** (see open question below — the existing route also allows
  editing a member's incentive-role profile, which arguably belongs with
  team-member administration, not a straight view).
- **Team Members creation UI** — add `"manager"` to `managedRoles` in
  `adminTeamMemberController.js:26` so admins can actually create manager
  accounts and set their portal access from Settings → Team Members. This
  does **not** mean managers can create/disable other accounts themselves —
  that's a separate, admin-only surface (see below).

### Keep admin-exclusive

- **Account & security provisioning** — invite/disable/reset-password/role
  changes for team members, agency-wide client-portal-policy catalog config
  (`adminRoutes.js` team-member and policy routes). Provisioning is a tenant
  security boundary, not an operations one.
- **Incentive plan design & finality** — `incentivePlanRoutes.js` (plan
  authoring), `incentiveRoutes.js` period close, reapplication cycles,
  simulate, contest finalize. These change how everyone gets paid; keep them
  single-owner.
- **Financial finality / irreversible money movement** — invoice void,
  invoice-payment void, payment-schedule void (admin-only), refunds
  (admin+accountant only) (`caseRoutes.js:264-343`). Also standalone
  `paymentRoutes.js` create/update/delete and `paymentsOverviewRoutes.js`
  custom-ledgers — these bypass case context entirely.
- **Billing/scheduling integrations** — QuickBooks connect/config
  (`quickbooksRoutes.js`), Zoom (`zoomRoutes.js`). Credential-level, agency-
  wide, rare, high-blast-radius if misconfigured.
- **Settings taxonomy** — fee categories (`feeCategoryRoutes.js`), case-role
  vocabulary CRUD (`caseRoleRoutes.js`). These reshape how incentives/billing
  are computed agency-wide, not day-to-day operations.
- **`collaboration-backfill`** (`caseRoutes.js:107`) — one-off migration
  utility, not a standing capability.

## Implementation notes (for whoever picks this up)

Reuse the existing generic mechanisms rather than adding `role === "manager"`
branches scattered through controllers — the point of `portalAccessService`
and `requireRole` is that the role list is the only thing that changes:

1. `defaultPortalAccess()` — add a `manager` branch (copy of the `admin`
   branch body).
2. `requireRole(...)` call sites listed above — append `"manager"` to each
   array. Mechanical, but touches ~30 lines across `caseRoutes.js`,
   `clientRoutes.js`, `appointmentRoutes.js`, `adminRoutes.js`,
   `incentiveRoutes.js`.
3. `adminTeamMemberController.js` — add `"manager"` to `managedRoles`.
4. Frontend nav/route guards (`frontend/src/auth/AuthRoutes.jsx`,
   `frontend/src/auth/portalAccess.js`) — not a security boundary per
   [[Authorization]], but needed so the UI actually shows a manager the
   pages they now have access to.
5. Test coverage — this is a `risk: critical` area
   ([[Authorization]] change risk: "a missing agency, assignment, role, or
   policy predicate can expose another tenant's or another consultant's
   data"). Add manager cases to `backend/test/authorization.test.js` and
   sibling suites rather than assuming the widened arrays behave correctly.

**Effort estimate:** medium, not small — the underlying model doesn't need
to change (no new abstraction, no new data-scope concept), but the role
needs to be threaded through ~30-40 existing call sites plus tests. Most of
the risk is omission (a route that should admit `manager` gets missed, or
one that shouldn't gets included by copy-paste) rather than design
complexity.

## Open questions before implementing

- Should a manager be able to invite/disable staff, or is that admin-only in
  every case? (Recommendation above: admin-only.)
- Should `incentive-role-members` edit (assigning a case-incentive role to a
  user) go to managers, or only the view?
- Should managers be able to see **financial data agency-wide** by default
  (`financialData` capability = true, per the recommendation above), or
  should that be an admin-configured opt-in per manager?
