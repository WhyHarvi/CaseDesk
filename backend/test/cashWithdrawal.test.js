import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

test("cash withdrawals are durable, idempotent negative ledger movements", async () => {
  const [schema, migration, service] = await Promise.all([
    read("prisma/schema.prisma"),
    read("prisma/migrations/20260814120000_cash_withdrawal_idempotency/migration.sql"),
    read("src/services/paymentsOverviewService.js"),
  ]);

  assert.match(schema, /idempotencyKey\s+String\?/);
  assert.match(schema, /@@unique\(\[agencyId, idempotencyKey\]\)/);
  assert.match(migration, /ADD COLUMN IF NOT EXISTS "idempotency_key"/);
  assert.match(service, /type: "Withdrawal"/);
  assert.match(service, /amount: -numericAmount/);
  assert.match(service, /"INSUFFICIENT_CASH"/);
  assert.match(service, /"CASH_PERIOD_CLOSED"/);
  assert.match(service, /cash\.withdrawal_posted/);
});

test("cash withdrawal API is admin-only and the UI requires explicit confirmation", async () => {
  const [controller, routes, api, page] = await Promise.all([
    read("src/controllers/paymentsOverviewController.js"),
    read("src/routes/paymentsOverviewRoutes.js"),
    read("../frontend/src/api/paymentsOverviewApi.js"),
    read("../frontend/src/pages/Payments.jsx"),
  ]);

  assert.match(controller, /postCashWithdrawal[\s\S]*requireAdmin\(req\)/);
  assert.match(routes, /post\("\/cash-withdrawals", asyncHandler\(postCashWithdrawal\)\)/);
  assert.match(api, /withdrawCashLedger/);
  assert.match(page, /I confirm this cash has physically left the drawer\./);
  assert.match(page, /variance === null/);
  assert.match(page, /row\.type === "Withdrawal" \? "Cash withdrawal"/);
});
