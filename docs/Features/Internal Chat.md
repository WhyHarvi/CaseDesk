---
type: feature
status: active
risk: medium
---

# Internal Chat

## Purpose
Provides staff direct/group threads with participants, messages, replies/actions, reactions, read receipts, attachments, and realtime updates.

## Depends On
- [[Authentication]]
- [[Users and Onboarding]]
- [[Supabase]]

## Used By
The shared staff application shell.

## Database Models
`InternalChatThread`, `InternalChatParticipant`, `InternalChatMessage`, `InternalChatMessageReaction`, and `InternalChatAttachment`.

## Backend
`backend/src/routes/internalChatRoutes.js`, `backend/src/controllers/internalChatController.js`, and `backend/src/services/internalChatAttachmentStorage.js`.

## Frontend
`frontend/src/pages/ChatsPage.jsx`, `frontend/src/components/chat/`, `frontend/src/api/internalChatApi.js`, and realtime/attachment hooks.

## Integrations
[[Supabase]] Realtime and Storage.

## Business Rules
Only active thread participants may read/send/react; read timestamps and soft message actions maintain state. Attachment metadata must match storage objects.

## Permissions
Authenticated staff only; participant and `agencyId` checks are the record boundary.

## Side Effects
Stores attachments, updates unread/read state, and emits realtime database changes.

## Change Risk
Medium, rising to high for participant queries or storage authorization.

## Tests
`backend/test/internalChat.test.js`, `chatAttachmentPipeline.test.js`, `chatMessageActions.test.js`, `chatReadReceipts.test.js`, and `chatRealtimeConfig.test.js`.
