---
type: system-map
status: active
risk: critical
---

# System Map

```mermaid
graph TD
  UI[React Frontend] --> API[Express API]
  API --> Auth[Authentication]
  Auth --> SB[Supabase Auth]
  Auth --> Tenant[Agency Membership / Tenant Scope]
  Tenant --> DB[(PostgreSQL via Prisma)]
  API --> Clients
  Clients --> Cases
  Leads --> Clients
  Leads --> Cases
  Cases --> CaseInfo[Case Information]
  Cases --> Documents
  Cases --> Forms
  Cases --> Workflows
  Cases --> Billing
  Cases --> Appointments
  Cases --> Communications
  Cases --> Portal[Client Portal]
  Billing --> QBO[QuickBooks Online]
  Billing --> Incentives
  Cases --> Incentives
  Appointments --> Zoom
  Appointments --> M365[Microsoft 365]
  Communications --> M365
  Communications --> SMTP[SMTP / IMAP]
  Communications --> Twilio
  Documents --> Storage[Supabase Storage]
  Forms --> Storage
  Portal --> Realtime[Supabase Realtime]
  Leads --> Meta[Meta Lead Ads]
  API --> Workers[Background Workers]
  Workers --> Notifications
  Notifications --> WebPush[Web Push]
  Notifications --> Communications
  API --> AI[Ollama / Nova]
```

## Graph Notes

[[Frontend-Architecture]] · [[API-Architecture]] · [[Authentication]] · [[Multi-Tenancy]] · [[Database-Overview]] · [[Clients]] · [[Cases]] · [[Case Information]] · [[Leads]] · [[Documents]] · [[Forms and Questionnaires]] · [[Workflows and Tasks]] · [[Billing and Payments]] · [[Incentives and Workload]] · [[Appointments and Booking]] · [[Communications]] · [[Client Portal]] · [[Notifications]] · [[Supabase]] · [[QuickBooks Online]] · [[Twilio]] · [[Microsoft 365]] · [[SMTP and IMAP]] · [[Zoom]] · [[Meta Lead Ads]] · [[Web Push]] · [[Ollama]]

## Worker Topology

`backend/src/server.js` starts form revision, communication outbox/inbound/maintenance, lead intake/reactivation/stale/overdue, workload, booking reminder/payment-hold, payment schedule, QuickBooks webhook, appointment meeting/calendar/no-show, notification scheduler/delivery, automated reminder, case-information drift, incentive retry, Zoom maintenance, and UCI communication matching workers. Most use database state and several use `backend/src/services/workerLeaseService.js` to avoid duplicate work across processes.
