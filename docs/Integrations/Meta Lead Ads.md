---
type: integration
status: active
risk: high
---

# Meta Lead Ads

## Purpose
Accepts Meta lead webhook events and enriches them through the Graph API before the universal lead-intake worker processes them.

## Authentication Method
Each `LeadSourceConnection` has a public token, provider verification secret, and encrypted access token. GET challenge verification and POST provider signature/token validation occur in the provider route/controller path.

## Backend
`backend/src/modules/leads/lead.provider.routes.js`, `lead.website.controller.js`, `lead.provider.adapters.js`, `lead.provider.enrichment.js`, `lead.intake.service.js`, and `lead.intake.worker.js`.

## Routes and Webhooks
`/api/lead-connectors/:provider/:token/events` with public rate limits.

## Database Models
`LeadSourceConnection`, `LeadIncomingEvent`, [[Lead]], and source/activity models.

## Features Relying On
[[Leads]]. The same intake abstraction also names WhatsApp, Google Ads, email, and website providers, but only Meta has a provider-specific remote enrichment implementation in current code.

## Failure Implications
Events remain pending/failed for worker retry or manual investigation; duplicate provider event IDs must not create duplicate leads.

## Environment Variables
`META_GRAPH_API_BASE_URL`, `MAIL_SETTINGS_ENCRYPTION_KEY`, `LEAD_INTAKE_POLL_MS`, `LEAD_INTAKE_BATCH_SIZE`.
