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
`frontend/src/components/chat/SupportDeskPanel.jsx`, `NovaChatPresentation.jsx`, `NovaCatMascot.jsx`, `FloatingChatWidget.jsx`, `frontend/src/hooks/useNovaChat.js`, `frontend/src/utils/novaCelebrate.js`, `frontend/src/services/supportCapture.js`, and support capture UI.

## Integrations
[[Ollama]] and [[Supabase]] storage for support screenshots.

## Business Rules
Screenshot uploads restrict MIME type and size. AI intent and insight services constrain supported questions/links; local model failure returns a controlled unavailable message.

The Nova cat is a presentation-only shortcut to the existing Nova conversation. It behaves like a lightweight desktop pet: it occasionally walks along the lower screen edge, stretches, naps, plays with yarn, nods, or dances, and greets the signed-in staff member by name on mount. Staff can drag it to a preferred position (a hard, fast drag flips it into a brief headstand), use arrow keys as the non-drag alternative, press Home to return it beside quick chat, and pause or resume autonomous movement. Its saved position remains local to the browser. Its movement pause is an account-level preference: it is cached locally for immediate navigation/reload continuity, broadcast across same-browser tabs, and reconciled from `GET/PATCH /ai/preferences` on focus and every five seconds so the same account converges across browsers and computers. While paused, Nova sleeps at her stopped position with closed eyes, open paws, slow breathing, and a snoring indicator; pausing also suppresses greetings, celebrations, proactive nods, quip rotation, and autonomous movement while leaving Nova clickable and draggable. Motion is disabled for reduced-motion preferences. It is hidden while quick chat or its incoming-message preview is open, on the full Chats page, and behind inactive curtains, so it does not cover active CRM work.

On a client or case profile page it becomes page-aware: `GET /ai/proactive-insight` accepts an explicit `entityType`/`entityId` from the frontend (never re-parsed from the path server-side) and, after verifying tenant + record access, walks a fixed priority chain (overdue follow-up, missing/changes-requested documents, overdue/outstanding payment, incomplete forms, upcoming appointment, workflow blocker, otherwise a positive/neutral insight) to surface one real fact about that specific client/case. Other pages (documents, payments, leads) keep the earlier page-level, access-scoped counts, silent when there's nothing to flag. Every insight carries a `persona` string ("Client assistant," "Document reviewer," etc.) that changes only presentation — bubble wording, an icon badge, and the suggested-prompt chip offered when the chat panel opens — never which AI actions are available. A given insight (by its stable id) surfaces once with a brief "nod" and is then remembered as seen (`localStorage`) rather than re-interrupting on every page visit.

`api.js`'s shared `mutate()` function also recognizes a handful of specific successful mutations (new client, lead converted, appointment booked, case marked Submitted, a manually recorded payment) and fires a `casedesk:nova-celebrate` window event; the cat reacts with a distinct pose and message regardless of which component triggered the mutation.

## Permissions
Authenticated staff only. Any AI data query must retain the request's tenant and role/access constraints.

## Side Effects
Creates support tickets/screenshots; Nova is intended to be advisory/read-only.

## Change Risk
Medium, rising to critical if new AI actions or unscoped data retrieval are added.

## Tests
`backend/test/supportDesk.test.js`, `novaMascot.test.js`, `aiIntentService.test.js`, `aiInsightService.test.js`, `novaAccuracyEval.test.js`, and `ollamaService.test.js`.
