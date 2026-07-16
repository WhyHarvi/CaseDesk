import { decryptSecret } from "../../services/secretEncryption.js";
import { providerEventId } from "./lead.provider.adapters.js";

function hasMetaFields(payload = {}) {
  const value = payload.entry?.[0]?.changes?.[0]?.value;
  return Boolean(payload.field_data?.length || payload.lead?.field_data?.length || value?.lead?.field_data?.length);
}

export async function enrichProviderPayload(connection, payload, fetchImpl = fetch) {
  if (connection?.provider !== "META" || hasMetaFields(payload)) return payload;
  const leadId = providerEventId("META", payload);
  if (!leadId) return payload;
  if (!connection.accessTokenEncrypted) throw new Error("Meta access token is not configured for lead detail retrieval.");
  const base = String(process.env.META_GRAPH_API_BASE_URL || "https://graph.facebook.com").replace(/\/+$/, "");
  const url = new URL(`${base}/${encodeURIComponent(leadId)}`);
  url.searchParams.set("fields", "id,created_time,field_data,form_id,ad_id");
  url.searchParams.set("access_token", decryptSecret(connection.accessTokenEncrypted));
  const response = await fetchImpl(url, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(10_000) });
  if (!response.ok) {
    const details = await response.text().catch(() => "");
    throw new Error(`Meta lead retrieval failed (${response.status}): ${details.slice(0, 300)}`);
  }
  const lead = await response.json();
  return { ...payload, lead };
}
