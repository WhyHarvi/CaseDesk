---
type: feature
status: active
risk: medium
---

# Support and AI Assistant

## Purpose
Provides support-ticket capture with optional screenshots and the Nova assistant, which classifies intent and produces read-oriented operational insights from allowed CaseDesk data.

## Depends On
- [[Authentication]]
- [[Authorization]]
- [[Ollama]]

## Used By
The shared staff layout and dashboard workflows.

## Database Models
`SupportTicket`; Nova reads feature models through controller/service queries.

## Backend
`backend/src/routes/supportRoutes.js`, `supportController.js`, `supportTicketService.js`, screenshot upload middleware; `aiRoutes.js`, `aiController.js`, `aiIntentService.js`, `aiInsightService.js`, and `ollama.service.js`.

## Frontend
`frontend/src/components/chat/SupportDeskPanel.jsx`, `NovaChatPresentation.jsx`, `frontend/src/hooks/useNovaChat.js`, `frontend/src/services/supportCapture.js`, and support capture UI.

## Integrations
[[Ollama]] and [[Supabase]] storage for support screenshots.

## Business Rules
Screenshot uploads restrict MIME type and size. AI intent and insight services constrain supported questions/links; local model failure returns a controlled unavailable message.

## Permissions
Authenticated staff only. Any AI data query must retain the request's tenant and role/access constraints.

## Side Effects
Creates support tickets/screenshots; Nova is intended to be advisory/read-only.

## Change Risk
Medium, rising to critical if new AI actions or unscoped data retrieval are added.

## Tests
`backend/test/supportDesk.test.js`, `aiIntentService.test.js`, `aiInsightService.test.js`, `novaAccuracyEval.test.js`, and `ollamaService.test.js`.
