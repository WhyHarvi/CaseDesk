-- Diagnostic only — checks what the universal_invoice_cash_ledger migration
-- (20260812010000) should have created, without changing anything. Run this
-- in the Supabase SQL editor (or via psql) against the same database, and
-- share the output.

SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN ('cash_reconciliations', 'cash_transactions', 'cash_allocations', 'invoice_refunds', 'case_invoice_lines')
ORDER BY table_name;

SELECT column_name
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'case_invoices'
  AND column_name IN ('invoice_number', 'accounting_provider', 'subtotal_amount', 'tax_amount', 'tax_rate_percent', 'agency_snapshot', 'client_snapshot')
ORDER BY column_name;

SELECT migration_name, finished_at, rolled_back_at
FROM _prisma_migrations
WHERE migration_name = '20260812010000_universal_invoice_cash_ledger';
