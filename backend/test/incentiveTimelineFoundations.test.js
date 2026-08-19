import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = (relativePath) => readFile(new URL(relativePath, import.meta.url), "utf8");

test("CaseStageHistory mirrors LeadStageHistory as a case-side stage audit trail", async () => {
  const [schema, migration] = await Promise.all([
    source("../prisma/schema.prisma"),
    source("../prisma/migrations/20260819000000_add_case_stage_history/migration.sql"),
  ]);

  assert.match(schema, /model CaseStageHistory \{[\s\S]*?previousStage String\?\s+@map\("previous_stage"\)/);
  assert.match(schema, /model CaseStageHistory \{[\s\S]*?newStage\s+String\s+@map\("new_stage"\)/);
  assert.match(schema, /model CaseStageHistory \{[\s\S]*?@@index\(\[agencyId, caseId, createdAt\]\)/);
  assert.match(migration, /CREATE TABLE "case_stage_history"/);
  assert.match(migration, /ALTER TABLE "case_stage_history" ADD CONSTRAINT "case_stage_history_case_id_fkey"/);
});

test("updateCase writes a CaseStageHistory row inside the same transaction as the case update, only on an actual stage change", async () => {
  const controller = await source("../src/controllers/caseController.js");
  const updateCaseIndex = controller.indexOf("export async function updateCase(");
  const transactionIndex = controller.indexOf("prisma.$transaction(async (tx) => {", updateCaseIndex);
  const historyWriteIndex = controller.indexOf("tx.caseStageHistory.create(", transactionIndex);

  // The history write must be inside the transaction (so it's durable even
  // if evaluation logic added later fails) and must come after tx.case.update
  // so it has data.id to reference, but before the transaction returns.
  assert.ok(transactionIndex !== -1, "expected updateCase to still use a $transaction");
  assert.ok(historyWriteIndex > transactionIndex, "CaseStageHistory write must be inside the transaction");
  const caseUpdateIndex = controller.indexOf("tx.case.update(", transactionIndex);
  assert.ok(historyWriteIndex > caseUpdateIndex, "CaseStageHistory write must come after tx.case.update");

  const historyBlock = controller.slice(historyWriteIndex, historyWriteIndex + 260);
  assert.match(historyBlock, /previousStage: existing\.stage,/);
  assert.match(historyBlock, /newStage: payload\.stage,/);
  assert.match(historyBlock, /changedById: req\.auth\.userId,/);

  const guardBlock = controller.slice(transactionIndex, historyWriteIndex);
  assert.match(guardBlock, /if \(Object\.hasOwn\(payload, "stage"\) && payload\.stage !== existing\.stage\) \{/);
});

test("resolveHolders lets the per-case role overlay override the global team assignment, role by role, instead of always using only the global list", async () => {
  const service = await source("../src/services/incentiveCreditingService.js");

  // Both sources are read for every call now, not just the global one.
  assert.match(service, /prisma\.caseRoleAssignment\.findMany\(\{\s*\n\s*where: \{\s*\n\s*agencyId,\s*\n\s*caseId,\s*\n\s*status: "active",/);

  // Overlay wins whenever it has holders; otherwise fall back to global —
  // never merged together for the same role.
  assert.match(service, /const overlay = overlayByCaseRoleId\.get\(caseRoleId\);/);
  assert.match(service, /byCaseRoleId\.set\(caseRoleId, overlay\?\.userIds\.length \? overlay : globalByCaseRoleId\.get\(caseRoleId\)\);/);

  // The three functions the timeline-bonus evaluator needs to reuse are
  // exported now, not module-private.
  assert.match(service, /export async function resolvePlan\(/);
  assert.match(service, /export async function resolveHolders\(/);
  assert.match(service, /export function computeSplits\(/);
});
