import assert from "node:assert/strict";
import test from "node:test";
import {
  notificationAllowedForMembership,
  resolveEligibleRecipientIdsFromMemberships,
} from "../src/services/notificationAccessService.js";
import { resolvePreferencesFromMap } from "../src/services/notificationService.js";
import {
  createSchedulerPassContext,
  dispatchNotificationJobs,
  groupRecipientIdsForDispatch,
} from "../src/services/notificationScheduler.js";

// Independent oracle mirroring the exact pre-batching implementation of
// eligibleNotificationRecipientIds (notificationAccessService.js), before it
// was refactored to share resolveEligibleRecipientIdsFromMemberships. Used
// below to prove the batched path resolves the identical SET of recipients
// as the original per-call query path would have, for the same underlying
// membership data — not just that both call the same helper.
function oldStyleEligibleIds(users, notification) {
  return users
    .filter((user) => notificationAllowedForMembership(user.memberships[0], notification))
    .map((user) => user.id);
}

function asSet(list) {
  return new Set(list);
}

test("batched eligibility resolves the same recipient set as the old per-call query path for a normal multi-recipient candidate", () => {
  const notification = {
    audienceKey: "work",
    type: "task.overdue",
    category: "work",
    actionUrl: "/app/cases/case-1?tab=tasks",
    destinationKey: "cases",
  };
  const users = [
    { id: "admin-1", memberships: [{ role: "admin", permissions: {} }] },
    { id: "admin-2", memberships: [{ role: "admin", permissions: {} }] },
    {
      id: "frontdesk-with-work-access",
      memberships: [{
        role: "frontdesk",
        permissions: { portalAccess: { pages: { followUps: true }, caseTabs: {}, capabilities: {} } },
      }],
    },
    {
      // Plain frontdesk defaults deny followUps/reminders/tasks access
      // (see portalAccessService.js's frontdesk default), so this user must
      // be excluded from a "work" category notification.
      id: "frontdesk-without-work-access",
      memberships: [{ role: "frontdesk", permissions: {} }],
    },
  ];
  const membershipsByUserId = new Map(users.map((user) => [user.id, user.memberships[0]]));
  const candidateIds = [...users.map((u) => u.id), "user-not-active-anymore"];

  const batched = resolveEligibleRecipientIdsFromMemberships({
    recipientIds: candidateIds,
    membershipsByUserId,
    notification,
  });
  const old = oldStyleEligibleIds(users, notification);

  assert.deepEqual(asSet(batched), asSet(old));
  assert.deepEqual(asSet(batched), asSet(["admin-1", "admin-2", "frontdesk-with-work-access"]));
  // The inactive/removed-membership candidate (absent from the pre-loaded
  // membership map, exactly as it would be absent from the old query's
  // result set) must be excluded, not silently treated as eligible.
  assert.ok(!batched.includes("user-not-active-anymore"));
});

test("batched eligibility resolves the same recipient set as the old path when a candidate falls back to agency admins", () => {
  const notification = {
    audienceKey: "communications",
    type: "communication.response_due",
    category: "communications",
    actionUrl: "/app/clients/client-1?conversation=conversation-1",
    destinationKey: "cases",
  };
  const users = [
    { id: "admin-1", memberships: [{ role: "admin", permissions: {} }] },
    { id: "admin-2", memberships: [{ role: "admin", permissions: {} }] },
  ];
  const membershipsByUserId = new Map(users.map((user) => [user.id, user.memberships[0]]));
  // Simulate an admin id that was resolved into the fallback list earlier in
  // the pass but has since been deactivated/removed before dispatch runs —
  // it must be excluded for the same reason a live per-call query would
  // have excluded it (no active membership row).
  const fallbackAdminIds = ["admin-1", "admin-2", "admin-3-deactivated-mid-pass"];

  const batched = resolveEligibleRecipientIdsFromMemberships({
    recipientIds: fallbackAdminIds,
    membershipsByUserId,
    notification,
  });
  const old = oldStyleEligibleIds(users, notification);

  assert.deepEqual(asSet(batched), asSet(old));
  assert.deepEqual(asSet(batched), asSet(["admin-1", "admin-2"]));
});

test("batched eligibility excludes inactive, no-permission, and removed users identically to the old path", () => {
  const notification = {
    audienceKey: "documents",
    type: "document.due_soon",
    category: "documents",
    actionUrl: "/client-portal/documents",
    destinationKey: null,
  };
  // Only a client-portal audience should reach a client role; a staff
  // audience like this one should never resolve to a client no matter what
  // membership data is loaded — covered implicitly since "documents"
  // (non-portal path) audience here resolves to DOCUMENTS, not CLIENT_PORTAL.
  const users = [
    {
      id: "frontdesk-with-doc-access",
      memberships: [{
        role: "frontdesk",
        permissions: { portalAccess: { pages: { documents: true }, caseTabs: {}, capabilities: {} } },
      }],
    },
    {
      id: "frontdesk-without-doc-access",
      memberships: [{
        role: "frontdesk",
        permissions: { portalAccess: { pages: {}, caseTabs: {}, capabilities: {} } },
      }],
    },
  ];
  const membershipsByUserId = new Map(users.map((user) => [user.id, user.memberships[0]]));
  const candidateIds = [
    "frontdesk-with-doc-access",
    "frontdesk-without-doc-access",
    "inactive-user-no-membership-row",
  ];

  const batched = resolveEligibleRecipientIdsFromMemberships({
    recipientIds: candidateIds,
    membershipsByUserId,
    notification,
  });
  const old = oldStyleEligibleIds(users, notification);

  assert.deepEqual(asSet(batched), asSet(old));
  assert.deepEqual(batched, ["frontdesk-with-doc-access"]);
});

// Independent oracle mirroring the exact pre-batching implementation of
// preferencesFor (notificationService.js): given every preference row for a
// user (here, only the two relevant categories, as the old per-call query
// itself only ever fetched "all" and the specific category), prefer the
// exact-category row over "all".
function oldStylePreferenceWinner(rows, category) {
  let winner;
  for (const row of [...rows].sort((a, b) => a.category.localeCompare(b.category))) {
    if (!winner || row.category === category) winner = row;
  }
  return winner;
}

test("batched preference resolution picks the same winning row as the old per-call query for opted-out, customized, and default users", () => {
  const category = "documents";
  const optedOutRow = { userId: "user-opted-out", category: "all", inAppEnabled: false, emailEnabled: false, smsEnabled: false };
  const customizedAllRow = { userId: "user-customized", category: "all", inAppEnabled: true, emailEnabled: false, smsEnabled: false };
  const customizedCategoryRow = { userId: "user-customized", category, inAppEnabled: true, emailEnabled: true, smsEnabled: false };

  // Global map as loadNotificationPreferencesByUser would build it — every
  // category the user has a row for, not just the two this call cares
  // about.
  const preferencesByUserId = new Map([
    ["user-opted-out", new Map([[optedOutRow.category, optedOutRow]])],
    ["user-customized", new Map([[customizedAllRow.category, customizedAllRow], [customizedCategoryRow.category, customizedCategoryRow]])],
  ]);
  const recipientIds = ["user-opted-out", "user-customized", "user-with-no-preference-row"];

  const batched = resolvePreferencesFromMap(recipientIds, preferencesByUserId, category);

  assert.equal(batched.get("user-opted-out"), optedOutRow);
  assert.equal(batched.get("user-customized"), oldStylePreferenceWinner([customizedAllRow, customizedCategoryRow], category));
  assert.equal(batched.get("user-customized"), customizedCategoryRow);
  assert.equal(batched.has("user-with-no-preference-row"), false);
});

test("groupRecipientIdsForDispatch collapses many candidates into one bucket per agency and one global user-id set", () => {
  const jobs = [
    { agencyId: "agency-a", recipientIds: ["u1", "u2"] },
    { agencyId: "agency-a", recipientIds: ["u2", "u3"] },
    { agencyId: "agency-a", recipientIds: ["u1"] },
    { agencyId: "agency-b", recipientIds: ["u4"] },
    { agencyId: "agency-b", recipientIds: [] },
    { agencyId: null, recipientIds: ["ignored-because-no-agency"] },
  ];

  const { recipientIdsByAgency, allUserIds } = groupRecipientIdsForDispatch(jobs);

  assert.equal(recipientIdsByAgency.size, 2);
  assert.deepEqual([...recipientIdsByAgency.get("agency-a")].sort(), ["u1", "u2", "u3"]);
  assert.deepEqual([...recipientIdsByAgency.get("agency-b")].sort(), ["u4"]);
  assert.deepEqual([...allUserIds].sort(), ["u1", "u2", "u3", "u4"]);
});

test("dispatchNotificationJobs resolves the three hot queries once per pass (O(agencies)), not once per candidate", async () => {
  // 6 candidates spread across 2 agencies — mirrors a multi-candidate,
  // multi-agency scheduler pass. Before batching, each of the three hot
  // queries this replaces (eligibility, preferences, push) would have run
  // once per candidate (6 times each); after batching it must be once per
  // agency for membership eligibility (2) and exactly once overall for the
  // two queries that are not agency-scoped.
  const jobs = [
    { agencyId: "agency-a", recipientIds: ["u1", "u2"], dedupeKey: "job-1" },
    { agencyId: "agency-a", recipientIds: ["u2", "u3"], dedupeKey: "job-2" },
    { agencyId: "agency-a", recipientIds: ["u1"], dedupeKey: "job-3" },
    { agencyId: "agency-b", recipientIds: ["u4"], dedupeKey: "job-4" },
    { agencyId: "agency-b", recipientIds: ["u4", "u5"], dedupeKey: "job-5" },
    { agencyId: "agency-b", recipientIds: ["u5"], dedupeKey: "job-6" },
  ];

  let membershipCalls = 0;
  let preferenceCalls = 0;
  let pushCalls = 0;
  const notifyCalls = [];

  await dispatchNotificationJobs(jobs, {
    loadMembershipsByAgency: async (recipientIdsByAgency) => {
      membershipCalls += 1;
      assert.equal(recipientIdsByAgency.size, 2, "one membership query per agency, not per candidate");
      const result = new Map();
      for (const [agencyId, ids] of recipientIdsByAgency) {
        result.set(agencyId, new Map([...ids].map((id) => [id, { role: "admin", permissions: {} }])));
      }
      return result;
    },
    loadPreferencesByUser: async (userIds) => {
      preferenceCalls += 1;
      assert.deepEqual([...userIds].sort(), ["u1", "u2", "u3", "u4", "u5"]);
      return new Map();
    },
    loadPushSubscribedUserIds: async (userIds) => {
      pushCalls += 1;
      assert.deepEqual([...userIds].sort(), ["u1", "u2", "u3", "u4", "u5"]);
      return new Set();
    },
    notify: async (job) => {
      notifyCalls.push(job);
      return [];
    },
  });

  assert.equal(membershipCalls, 1, "membership eligibility must be resolved once for the whole pass");
  assert.equal(preferenceCalls, 1, "preferences must be resolved once for the whole pass");
  assert.equal(pushCalls, 1, "push-subscription status must be resolved once for the whole pass");
  // notify (notifyUsers) itself is still called once per candidate job —
  // batching removes the repeated *queries* inside it, not the per-candidate
  // notification-creation call.
  assert.equal(notifyCalls.length, jobs.length);
  const agencyAJob = notifyCalls.find((job) => job.dedupeKey === "job-1");
  assert.deepEqual([...agencyAJob.precomputed.membershipsByUserId.keys()].sort(), ["u1", "u2", "u3"]);
  const agencyBJob = notifyCalls.find((job) => job.dedupeKey === "job-4");
  assert.deepEqual([...agencyBJob.precomputed.membershipsByUserId.keys()].sort(), ["u4", "u5"]);
});

test("dispatchNotificationJobs is a no-op when the pass produced no jobs", async () => {
  let called = false;
  await dispatchNotificationJobs([], {
    loadMembershipsByAgency: async () => { called = true; return new Map(); },
    loadPreferencesByUser: async () => { called = true; return new Map(); },
    loadPushSubscribedUserIds: async () => { called = true; return new Set(); },
    notify: async () => { called = true; return []; },
  });
  assert.equal(called, false);
});

test("the per-pass admin-fallback cache resolves each agency's admins once, not once per fallback-triggering candidate", async () => {
  let loadCalls = 0;
  const seenAgencies = [];
  const pass = createSchedulerPassContext({
    loadAdminRecipientIds: async (agencyId) => {
      loadCalls += 1;
      seenAgencies.push(agencyId);
      return agencyId === "agency-a" ? ["admin-1", "admin-2"] : ["admin-3"];
    },
  });

  // Simulates communicationSlaNotifications hitting the fallback twice for
  // the same conversation (once for "response", once for "resolution") plus
  // a second, unrelated candidate in the same agency, and one candidate in a
  // different agency.
  const first = await pass.cachedAdminRecipientIds("agency-a");
  const second = await pass.cachedAdminRecipientIds("agency-a");
  const third = await pass.cachedAdminRecipientIds("agency-a");
  const other = await pass.cachedAdminRecipientIds("agency-b");

  assert.equal(loadCalls, 2, "one load per distinct agency touched in the pass");
  assert.deepEqual(seenAgencies, ["agency-a", "agency-b"]);
  assert.deepEqual(first, ["admin-1", "admin-2"]);
  assert.deepEqual(second, ["admin-1", "admin-2"]);
  assert.deepEqual(third, ["admin-1", "admin-2"]);
  assert.deepEqual(other, ["admin-3"]);
});
