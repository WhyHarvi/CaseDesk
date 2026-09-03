import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { contestPrizeShares, contestWinners, rankRevenueCredits } from "../src/services/incentiveExpansionService.js";

const root = path.resolve(import.meta.dirname, "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

test("revenue ranking uses net revenue, paid cases, and earliest completion", () => {
  const ranking = rankRevenueCredits([
    { revenueOwnerId: "u2", revenueOwnerSnapshot: "Two", caseId: "c2", netAmount: 100, collectedAt: "2026-09-02T12:00:00Z" },
    { revenueOwnerId: "u1", revenueOwnerSnapshot: "One", caseId: "c1", netAmount: 120, collectedAt: "2026-09-01T12:00:00Z" },
    { revenueOwnerId: "u1", revenueOwnerSnapshot: "One", caseId: "c1", netAmount: -20, collectedAt: "2026-09-03T12:00:00Z" },
  ]);
  assert.deepEqual(ranking.map((row) => row.userId), ["u2", "u1"]);
  assert.equal(ranking[1].netRevenue, 100);
});

test("joint winners split flat and percentage prizes deterministically", () => {
  const ranking = [
    { userId: "b", netRevenue: 1000, paidCaseCount: 2, reachedAt: new Date("2026-09-02") },
    { userId: "a", netRevenue: 1000, paidCaseCount: 2, reachedAt: new Date("2026-09-02") },
  ];
  const winners = contestWinners(ranking);
  assert.equal(winners.length, 2);
  assert.deepEqual(contestPrizeShares({ prizeType: "FLAT", prizeValue: 101, winners }).map((row) => row.prizeAmount), [50.5, 50.5]);
  assert.deepEqual(contestPrizeShares({ prizeType: "PERCENT_OF_WINNER_REVENUE", prizeValue: 10, winners }).map((row) => row.prizeAmount), [50, 50]);
});

test("milestone hooks and admin-only expansion routes are wired", () => {
  const routes = read("src/routes/incentiveRoutes.js");
  assert.match(routes, /post\("\/period\/close", requireRole\("admin"\)/);
  assert.match(routes, /post\("\/contest\/finalize", requireRole\("admin"\)/);
  assert.match(read("src/controllers/caseController.js"), /creditStudyPermitMilestone/);
  assert.match(read("src/controllers/followUpController.js"), /POST_SUBMISSION_FOLLOW_UP_TYPE/);
  assert.match(read("src/services/incentiveExpansionService.js"), /effectiveTriggerRef = `\$\{cycle\.id\}/);
});

test("simulation is read-only and milestone settings expose all three events", () => {
  const service = read("src/services/incentiveExpansionService.js");
  const simulation = service.slice(service.indexOf("export async function simulateIncentivePlan"), service.indexOf("export async function getRevenueContest"));
  assert.doesNotMatch(simulation, /\.create\(|\.update\(|\.delete\(/);
  const editor = read("../frontend/src/components/settings/IncentivePlansSettingsPanel.jsx");
  for (const event of ["COLLEGE_APPLICATION_SUBMITTED", "STUDY_PERMIT_APPLICATION_SUBMITTED", "POST_SUBMISSION_FOLLOW_UP_COMPLETED"]) assert.match(editor, new RegExp(event));
});
