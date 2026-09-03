---
type: system
status: active
risk: high
---

# Frontend Architecture

The frontend is a React 18 SPA built by Vite. `frontend/src/main.jsx` composes BrowserRouter, TanStack Query, authentication, notification, softphone, and error-recovery providers. `frontend/src/routes/AppRoutes.jsx` lazy-loads public, staff, developer, and [[Client Portal]] routes.

## Structure

- `frontend/src/pages/`: staff/public top-level screens.
- `frontend/src/modules/leads/`: the self-contained [[Leads]] UI.
- `frontend/src/components/case-profile/`: case-tab workspaces for [[Cases]].
- `frontend/src/components/client-portal/`: portal shell and cards.
- `frontend/src/api/`: focused API clients; `frontend/src/services/api.js` is the shared Axios client and auth-token injector.
- `frontend/src/auth/`: session state and navigation guards.
- `frontend/src/components/ui/`: shared Base UI/Tailwind primitives.
- `frontend/src/hooks/`: realtime chat, Nova, polling, autosave, and UI hooks.

## State and Data

TanStack Query handles server-state caching where adopted; many older pages call the shared Axios client directly. Supabase Realtime backs chat subscriptions. Route/page access is mirrored from backend portal permissions, while the API remains authoritative.

## Configuration

`VITE_API_URL`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, and `VITE_VAPID_PUBLIC_KEY`.

## Change Risk

High in `AppRoutes.jsx`, `AuthContext.jsx`, and `services/api.js`; feature-local components are generally medium. The build command is `npm run build` in `frontend/`.
