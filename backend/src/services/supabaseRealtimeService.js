import { createHmac } from "node:crypto";

const value = (key) => String(process.env[key] || "").trim();
const base64url = (input) => Buffer.from(typeof input === "string" ? input : JSON.stringify(input)).toString("base64url");

export function supabaseRealtimeReady() {
  return Boolean(value("SUPABASE_URL") && value("SUPABASE_ANON_KEY") && value("SUPABASE_SERVICE_ROLE_KEY") && value("SUPABASE_REALTIME_JWT_SECRET"));
}

export function communicationTopic(agencyId, caseId) {
  return `case:${agencyId}:${caseId}`;
}

export function createRealtimeToken({ userId, agencyId, caseId, role }) {
  const secret = value("SUPABASE_REALTIME_JWT_SECRET");
  if (!secret) return null;
  const now = Math.floor(Date.now() / 1000);
  const header = base64url({ alg: "HS256", typ: "JWT" });
  const payload = base64url({ sub: userId, role: "authenticated", app_role: role, agency_id: agencyId, case_id: caseId, aud: "authenticated", iat: now, exp: now + 15 * 60 });
  const unsigned = `${header}.${payload}`;
  const signature = createHmac("sha256", secret).update(unsigned).digest("base64url");
  return `${unsigned}.${signature}`;
}

export function getRealtimeClientConfig({ userId, agencyId, caseId, role }) {
  if (!supabaseRealtimeReady()) return { configured: false };
  return {
    configured: true,
    url: value("SUPABASE_URL"),
    anonKey: value("SUPABASE_ANON_KEY"),
    token: createRealtimeToken({ userId, agencyId, caseId, role }),
    topic: communicationTopic(agencyId, caseId),
  };
}

export async function broadcastCaseCommunication({ agencyId, caseId, event = "message", payload }) {
  if (!supabaseRealtimeReady()) return { delivered: false, reason: "Realtime is not configured" };
  const topic = communicationTopic(agencyId, caseId);
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

