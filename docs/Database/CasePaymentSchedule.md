---
type: database-model
status: active
risk: critical
---

# CasePaymentSchedule

## Purpose
Case-level agreement for a set of billable installments.

## Important Fields
Tenant, unique `caseId`, client, signing date, discount amount, creator, and timestamps.

## Relationships
Belongs to [[Agency]], [[Case]], [[Client]], optional creator; owns `CasePaymentInstallment` rows.

## Features and Services
[[Payment Schedules]], [[Billing and Payments]], and [[QuickBooks Online]]. Modified by `paymentScheduleController.js` and `paymentScheduleService.js` worker.

## Deletion and Rules
Agency/case/client deletion cascades the schedule/installments. One schedule per case. Installment and invoice state must change transactionally/idempotently where possible.
