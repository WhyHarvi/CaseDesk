import { createHmac } from "node:crypto";

const value = (key) => String(process.env[key] || "").trim();
const base64url = (input) => Buffer.from(typeof input === "string" ? input : JSON.stringify(input)).toString("base64url");

export function supabaseRealtimeReady() {
  return Boolean(value("SUPABASE_URL") && value("SUPABASE_ANON_KEY") && value("SUPABASE_SERVICE_ROLE_KEY") && value("SUPABASE_REALTIME_JWT_SECRET"));
}

export function communicationTopic(agencyId, caseId) {
  return `case:${agencyId}:${caseId}`;
}

// Internal (staff-to-staff) chat threads use a separate "thread:" topic
// namespace and JWT claim from case chat's "case:" one — see the
// casedesk_internal_chat_read/write RLS policies — so an internal-chat
// token can never be replayed against a case topic or vice versa.
export function internalThreadTopic(agencyId, threadId) {
  return `thread:${agencyId}:${threadId}`;
}

export function createRealtimeToken({ userId, agencyId, caseId, threadId, role }) {
  const secret = value("SUPABASE_REALTIME_JWT_SECRET");
  if (!secret) return null;
  const now = Math.floor(Date.now() / 1000);
  const header = base64url({ alg: "HS256", typ: "JWT" });
  const payload = base64url({ sub: userId, role: "authenticated", app_role: role, agency_id: agencyId, case_id: caseId, thread_id: threadId, aud: "authenticated", iat: now, exp: now + 15 * 60 });
  const unsigned = `${header}.${payload}`;
  const signature = createHmac("sha256", secret).update(unsigned).digest("base64url");
  return `${unsigned}.${signature}`;
}

export function getRealtimeClientConfig({ userId, agencyId, caseId, threadId, role }) {
  if (!supabaseRealtimeReady()) return { configured: false };
  return {
    configured: true,
    url: value("SUPABASE_URL"),
    anonKey: value("SUPABASE_ANON_KEY"),
    token: createRealtimeToken({ userId, agencyId, caseId, threadId, role }),
    topic: threadId ? internalThreadTopic(agencyId, threadId) : communicationTopic(agencyId, caseId),
  };
}

async function broadcast(topic, event, payload) {
  if (!supabaseRealtimeReady()) return { delivered: false, reason: "Realtime is not configured" };
  const url = new URL(`/realtime/v1/api/broadcast/${encodeURIComponent(topic)}/events/${encodeURIComponent(event)}`, value("SUPABASE_URL"));
  url.searchParams.set("private", "true");
  const key = value("SUPABASE_SERVICE_ROLE_KEY");
  const response = await fetch(url, {
    method: "POST",
    headers: { apikey: key, authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error(`Supabase Realtime broadcast failed (${response.status})`);
  return { delivered: true };
}

export async function broadcastCaseCommunication({ agencyId, caseId, event = "message", payload }) {
  return broadcast(communicationTopic(agencyId, caseId), event, payload);
}

export async function broadcastInternalChatMessage({ agencyId, threadId, event = "message", payload }) {
  return broadcast(internalThreadTopic(agencyId, threadId), event, payload);
}

