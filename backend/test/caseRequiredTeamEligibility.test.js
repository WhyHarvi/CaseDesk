import assert from "node:assert/strict";
import test from "node:test";

import {
  listCollaborationStaff,
  requiredCaseTeamOptions,
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
  ]);
});
