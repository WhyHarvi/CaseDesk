import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { normalizeFollowUpPayload } from "../src/controllers/followUpController.js";

const source = (relativePath) => readFile(new URL(relativePath, import.meta.url), "utf8");

test("follow-up edits normalize terminal status and support clearing optional values", () => {
  const existing = {
    status: "Completed",
    completedAt: new Date("2026-08-01T16:00:00.000Z"),
    dueDate: new Date("2026-08-03T16:00:00.000Z"),
    reminderAt: new Date("2026-08-03T16:00:00.000Z"),
  };
  const reopened = normalizeFollowUpPayload({
    title: "  Call the client  ",
    description: "",
    dueDate: null,
    status: "Pending",
    completedAt: "",
  }, existing);

  assert.equal(reopened.title, "Call the client");
  assert.equal(reopened.description, null);
  assert.equal(reopened.dueDate, null);
  assert.equal(reopened.reminderAt, null);
  assert.equal(reopened.completedAt, null);
});

test("follow-up completion always gets a completion timestamp", () => {
  const completed = normalizeFollowUpPayload({ title: "Review file", status: "Completed" });
  assert.equal(completed.status, "Completed");
  assert.ok(completed.completedAt instanceof Date);
});

test("follow-up title validation is explicit", () => {
  assert.throws(
    () => normalizeFollowUpPayload({ title: "   " }),
    (error) => error.statusCode === 400 && error.code === "VALIDATION_ERROR",
  );
  assert.throws(
    () => normalizeFollowUpPayload({ title: "Call client", priority: "Urgent" }),
    (error) => error.statusCode === 400 && error.message === "Follow-up priority is invalid.",
  );
  assert.throws(
    () => normalizeFollowUpPayload({ title: "Call client", status: null }),
    (error) => error.statusCode === 400 && error.message === "Follow-up status is invalid.",
  );
});

test("follow-up editor persists every visible field and loads complete scoped options", async () => {
  const [schema, migration, controller, routes, page] = await Promise.all([
    source("../prisma/schema.prisma"),
    source("../prisma/migrations/20260805180000_follow_up_editable_fields/migration.sql"),
    source("../src/controllers/followUpController.js"),
    source("../src/routes/followUpRoutes.js"),
    source("../../frontend/src/pages/FollowUps.jsx"),
  ]);

  assert.match(schema, /followUpType\s+String\s+@default\("General follow-up"\)/);
  assert.match(schema, /priority\s+String\s+@default\("Medium"\)/);
  assert.match(migration, /ADD COLUMN "follow_up_type"/);
  assert.match(migration, /ADD COLUMN "priority"/);
  assert.match(controller, /followUpType: fieldParsers\.enumField/);
  assert.match(controller, /priority: fieldParsers\.enumField/);
  assert.match(controller, /role: \{ in: \["admin", "consultant", "frontdesk"\] \}/);
  assert.match(routes, /router\.get\("\/options"/);
  assert.match(page, /followUpType: formState\.followUpType/);
  assert.match(page, /priority: formState\.priority/);
  assert.match(page, /description: formState\.description\.trim\(\) \|\| null/);
  assert.match(page, /get\("\/follow-ups\/options"\)/);
  assert.doesNotMatch(page, /delete payload\.(?:description|dueDate|assignedUserId|caseId)/);
});
