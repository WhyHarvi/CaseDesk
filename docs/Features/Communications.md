---
type: feature
status: active
risk: high
---

# Communications

## Purpose
Provides case/client conversations across email, SMS, portal chat, and call-linked activity, including messages, attachments, reactions, consent, templates, automation, SLA tracking, retention, unmatched inbound items, audit, and an outbox.

## Depends On
- [[Clients]]
- [[Cases]]
- [[Authorization]]
- [[Multi-Tenancy]]

## Used By
[[Leads]], [[Appointments and Booking]], [[Client Portal]], [[Follow-Ups and Reminders]], and [[Notifications]].

## Database Models
[[CommunicationConversation]], `CommunicationMessage`, `CommunicationAttachment`, `CommunicationOutbox`, `CommunicationDeliveryEvent`, `CommunicationPermission`, `CommunicationConsent`, `CommunicationTemplate`, `CommunicationAutomationRule`, `CommunicationSlaPolicy`, `CommunicationAuditEvent`, `CommunicationRetentionPolicy`, `ClientCommunicationAccess`, and `UnmatchedCommunication`.

## Backend
Communication route/controller families and `backend/src/services/communication*`, `agencyMailService.js`, `microsoftMailboxService.js`, `twilioSmsSyncService.js`, and `uciCommunicationMatchingService.js`. Outbox, inbound sync, maintenance, and UCI matching workers start with the server.

## Frontend
`frontend/src/components/case-profile/CommunicationWorkspace.jsx`, its `communication/` subcomponents, client communication cards, and `frontend/src/pages/ClientChatPortal.jsx`.

## Integrations
[[Microsoft 365]], [[SMTP and IMAP]], [[Twilio]], and [[Supabase]] Realtime/Storage.

## Business Rules
Outbound work is durable/idempotent through the outbox. Consent, address validation, channel permission, subject requirements, attachment status, and client policy are checked before send. Webhooks reconcile provider delivery; inbound mail is matched to tenant/client/case or retained unmatched.

## Permissions
Requires Communication case-tab access and record predicates. Client chat has link/policy controls. Webhooks use secrets/signatures rather than staff auth.

## Side Effects
Provider sends, delivery/audit records, unread state, attachments, SLA notifications, and activity logs.

## Change Risk
High due to privacy, cross-channel delivery, webhook trust, and tenant matching.

## Tests
`backend/test/clientCommunicationPolicyService.test.js`, `communicationAddressService.test.js`, `communicationSubjectRequirement.test.js`, `uciCommunicationMatchingService.test.js`, `agencyTwilioSms.test.js`, and `personalMailbox.test.js`.
