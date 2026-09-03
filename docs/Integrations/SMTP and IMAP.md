---
type: integration
status: active
risk: high
---

# SMTP and IMAP

## Purpose
Alternative/default agency email delivery through Nodemailer SMTP and inbound mailbox synchronization through ImapFlow.

## Authentication Method
Host/port/secure plus username/password. Agency-stored passwords are encrypted; environment defaults may supply server-wide settings. IMAP can reuse SMTP credentials when explicit IMAP credentials are absent.

## Backend
`backend/src/services/agencyMailService.js`, `inboundMailSyncService.js`, `communicationProviderService.js`, `communicationOutboxService.js`, and feature notification services.

## Routes
Configured through account/settings controllers and consumed asynchronously; no public SMTP/IMAP webhook route.

## Database Models
`AgencyMailSettings`, communication message/outbox/delivery/audit models, and feature-specific delivery models.

## Features Relying On
[[Communications]], [[Appointments and Booking]], [[Notifications]], [[Follow-Ups and Reminders]], [[Users and Onboarding]], and [[Leads]].

## Failure Implications
Outbound work retries or records failure; inbound mail is delayed. Incorrect matching can leave messages in `UnmatchedCommunication` rather than attach them to the wrong tenant/client.

## Environment Variables
`SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM`, `IMAP_HOST`, `IMAP_PORT`, `IMAP_SECURE`, `IMAP_USER`, `IMAP_PASSWORD`, `MAIL_SETTINGS_ENCRYPTION_KEY`, `INBOUND_MAIL_SYNC_MS`.
