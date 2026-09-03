---
type: integration
status: active
risk: medium
---

# Ollama

## Purpose
Provides the language model used by the Nova assistant for intent classification and response generation over server-prepared insights.

## Authentication Method
HTTP endpoint with optional configurable authorization header/value and optional Cloudflare Access client headers.

## Backend
`backend/src/services/ollama.service.js`, `aiIntentService.js`, `aiInsightService.js`, `backend/src/routes/aiRoutes.js`, and `backend/src/controllers/aiController.js`.

## Database Models
No dedicated AI model; services read authorized operational data.

## Features Relying On
[[Support and AI Assistant]].

## Failure Implications
Nova reports model unavailability; core CRM workflows continue. New prompts/queries must not bypass tenant and role filtering.

## Environment Variables
`OLLAMA_BASE_URL`, `OLLAMA_MODEL`, `OLLAMA_TIMEOUT_MS`, `OLLAMA_INTENT_TIMEOUT_MS`, `OLLAMA_AUTH_HEADER`, `OLLAMA_AUTH_VALUE`, `OLLAMA_CF_ACCESS_CLIENT_ID`, `OLLAMA_CF_ACCESS_CLIENT_SECRET`.
