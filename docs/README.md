---
type: index
status: active
---

# CaseDesk Architecture

This vault describes the current React, Express, Prisma, and PostgreSQL application. Source code remains authoritative.

## Core Systems

- [[Architecture]]
- [[System-Map]]
- [[Authentication]]
- [[Authorization]]
- [[Multi-Tenancy]]
- [[Frontend-Architecture]]
- [[Backend-Architecture]]
- [[API-Architecture]]

## Features

- [[Clients]] · [[Cases]] · [[Case Information]] · [[Leads]]
- [[Documents]] · [[Forms and Questionnaires]] · [[Agreements and Correspondence]]
- [[Billing and Payments]] · [[Payment Schedules]] · [[Appointments and Booking]]
- [[Communications]] · [[Follow-Ups and Reminders]] · [[Workflows and Tasks]]
- [[Client Portal]] · [[Users and Onboarding]] · [[Notifications]]
- [[Internal Chat]] · [[Incentives and Workload]] · [[Case Easy Import]]
- [[Dashboard and Search]] · [[Support and AI Assistant]]

## Integrations

- [[Supabase]] · [[QuickBooks Online]] · [[Twilio]] · [[Microsoft 365]]
- [[SMTP and IMAP]] · [[Zoom]] · [[Ollama]] · [[Web Push]] · [[Meta Lead Ads]]

## Database

- [[Database-Overview]]
- [[Agency]] · [[User]] · [[AgencyMember]] · [[Client]] · [[Case]] · [[Lead]]
- [[ClientDocument]] · [[CaseForm]] · [[Appointment]] · [[CommunicationConversation]]
- [[CaseInvoice]] · [[Payment]] · [[CasePaymentSchedule]] · [[Notification]]
- [[PortalAccessPolicy]] · [[ActivityLog]]

## Critical Dependency Chains

1. [[Supabase]] → [[Authentication]] → [[AgencyMember]] → [[Multi-Tenancy]] → every protected feature.
2. [[Clients]] → [[Cases]] → [[Case Information]] / [[Documents]] / [[Forms and Questionnaires]] / [[Billing and Payments]].
3. [[Billing and Payments]] → [[QuickBooks Online]] → payment approval, refund, invoice, incentive, and notification state.
4. [[Appointments and Booking]] → [[Zoom]] / [[Microsoft 365]] / [[SMTP and IMAP]] / [[Twilio]] → reminders and [[Notifications]].
5. [[Communications]] → outbox workers → [[Microsoft 365]] / [[SMTP and IMAP]] / [[Twilio]] → webhook reconciliation and audit records.
6. [[Leads]] → public/provider intake → assignment and consultation → [[Clients]] and [[Cases]].

## High-Risk Systems

- Critical: [[Authentication]], [[Authorization]], [[Multi-Tenancy]], [[Billing and Payments]], [[Client Portal]].
- High: [[Cases]], [[Leads]], [[Communications]], [[Appointments and Booking]], [[Forms and Questionnaires]], [[Notifications]], [[Incentives and Workload]].
- Medium: remaining operational features and integrations; see each note's frontmatter and Change Risk section.
