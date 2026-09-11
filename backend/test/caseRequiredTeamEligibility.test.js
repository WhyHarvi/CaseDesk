import assert from "node:assert/strict";
import test from "node:test";

import {
  listCollaborationStaff,
  requiredCaseTeamOptions,
  userCanManageCaseCollaboration,
} from "../src/services/caseRequiredTeamService.js";

function fakeDb() {
  const userQueries = [];
  return {
    userQueries,
    agencyCaseRole: {
      async upsert({ create }) {
        return { id: `${create.code}-role`, agencyId: create.agencyId, ...create };
      },
    },
    user: {
      async findMany(query) {
        userQueries.push(query);
        return [];
      },
    },
  };
}

test("required case-team options include active administrators", async () => {
  const db = fakeDb();

  await requiredCaseTeamOptions("agency-1", db);

  assert.equal(db.userQueries.length, 2);
  for (const query of db.userQueries) {
    assert.deepEqual(query.where.memberships.some.role.in, [
      "admin",
      "consultant",
      "frontdesk",
      "manager",
    ]);
  }
});

test("collaboration staff includes active administrators", async () => {
  const db = fakeDb();

  await listCollaborationStaff("agency-1", db);

  assert.deepEqual(db.userQueries[0].where.memberships.some.role.in, [
    "admin",
    "consultant",
    "frontdesk",
    "manager",
  ]);
});

test("managers can manage case collaboration without needing an RCIC assignment", async () => {
  const db = {
    teamIncentiveRoleAssignment: {
      async findFirst() {
        throw new Error("manager authorization must not depend on an RCIC lookup");
      },
    },
    caseRoleAssignment: {
      async findFirst() {
        throw new Error("manager authorization must not depend on a case-role lookup");
      },
    },
  };

  assert.equal(
    await userCanManageCaseCollaboration({
      agencyId: "agency-1",
      userId: "manager-1",
      role: "manager",
      caseId: "case-1",
    }, db),
    true,
  );
});

test("front desk still cannot manage case collaboration", async () => {
  assert.equal(
    await userCanManageCaseCollaboration({
      agencyId: "agency-1",
      userId: "frontdesk-1",
      role: "frontdesk",
      caseId: "case-1",
    }, {}),
    false,
  );
});
