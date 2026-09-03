---
type: database-model
status: active
risk: critical
---

# Payment

## Purpose
Legacy/simple case or client payment summary retained alongside the newer case-invoice/cash-ledger system.

## Important Fields
Tenant, optional client/case, Decimal fee/paid/balance, status, currency, notes, and timestamps.

## Relationships
Belongs to [[Agency]]; client/case links use `SetNull`; owns payment approvals.

## Features and Services
[[Billing and Payments]]. `backend/src/routes/paymentRoutes.js`, `paymentController.js`, approval services, and older case/client frontend consumers use it.

## Deletion and Rules
Agency deletion cascades; deleting client/case retains a detached payment. Do not confuse its API/shape with [[CaseInvoice]] or the payments-overview aggregation.
