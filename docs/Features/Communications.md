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

An authenticated-portal Chat message is durably delivered by being saved — the client's portal inbox query (`portalController.js`) reads by `channel: "Chat"` only, not by `provider`. `communicationProviderStatus().Chat.sendConfigured` (from `supabaseRealtimeReady()`) reflects only whether *live* Realtime push is wired up, not whether the message can be sent at all — the case-profile composer (`CommunicationComposer.jsx`) used to hard-block its Send button on this for Chat too, so a Realtime-config gap anywhere disabled portal messaging agency-wide from the case profile, while the client-profile composer (`ClientCommunicationCard.jsx`, which never checked this) kept working — the send-ability mismatch between the two was the actual symptom. Fixed by excluding Chat from that gate. Both composers should send `portalAudience: true` for a new Chat conversation so it's tagged `AuthenticatedPortal` and the `activePortal` precondition in `createCommunicationMessage` actually runs.

## Permissions
Requires Communication case-tab access and record predicates. Client chat has link/policy controls. Webhooks use secrets/signatures rather than staff auth.

## Side Effects
Provider sends, delivery/audit records, unread state, attachments, SLA notifications, and activity logs.

## Change Risk
High due to privacy, cross-channel delivery, webhook trust, and tenant matching.

## Tests
`backend/test/clientCommunicationPolicyService.test.js`, `communicationAddressService.test.js`, `communicationSubjectRequirement.test.js`, `uciCommunicationMatchingService.test.js`, `agencyTwilioSms.test.js`, and `personalMailbox.test.js`.
