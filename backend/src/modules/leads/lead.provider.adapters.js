const text = (value, max = 5000) => String(value ?? "").trim().slice(0, max) || null;

function object(value) { return value && typeof value === "object" && !Array.isArray(value) ? value : {}; }
function valuesByName(items = []) {
  return Object.fromEntries((Array.isArray(items) ? items : []).map((item) => {
    const key = String(item.name || item.column_id || item.user_column_name || "").toLowerCase().replace(/[^a-z0-9]/g, "");
    const value = Array.isArray(item.values) ? item.values[0] : item.string_value ?? item.value;
    return [key, value];
  }).filter(([key]) => key));
}
function first(fields, names) { for (const name of names) if (fields[name] !== undefined) return fields[name]; return null; }
function phoneFrom(value) { return text(value)?.match(/(?:\+?\d[\d\s().-]{7,}\d)/)?.[0] || null; }

function direct(payload) {
  const lead = object(payload.lead);
  return Object.keys(lead).length ? lead : payload;
}

export function adaptProviderPayload(provider, rawPayload = {}) {
  const payload = object(rawPayload);
  if (provider === "META") {
    const entry = object(payload.entry?.[0]);
    const change = object(entry.changes?.[0]);
    const lead = object(change.value?.lead || payload.lead || payload);
    const fields = valuesByName(lead.field_data || payload.field_data);
    return {
      fullName: text(first(fields, ["fullname", "name"]) || lead.fullName || lead.full_name),
      firstName: text(first(fields, ["firstname"]) || lead.firstName || lead.first_name), lastName: text(first(fields, ["lastname"]) || lead.lastName || lead.last_name),
      phone: text(first(fields, ["phonenumber", "phone", "mobilephone"]) || lead.phone), email: text(first(fields, ["email"]) || lead.email),
      country: text(first(fields, ["country"]) || lead.country), immigrationInterest: text(first(fields, ["service", "immigrationinterest", "interest"]) || lead.immigrationInterest),
      initialMessage: text(first(fields, ["message", "comments", "notes"]) || lead.initialMessage),
    };
  }
  if (provider === "WHATSAPP") {
    const value = object(payload.entry?.[0]?.changes?.[0]?.value);
    const message = object(value.messages?.[0] || payload.message || payload);
    const contact = object(value.contacts?.[0] || payload.contact);
    return { fullName: text(contact.profile?.name || payload.fullName), phone: text(message.from || contact.wa_id || payload.phone || payload.from), email: text(payload.email), initialMessage: text(message.text?.body || message.button?.text || payload.text || payload.message), immigrationInterest: text(payload.immigrationInterest) };
  }
  if (provider === "GOOGLE_ADS") {
    const fields = valuesByName(payload.user_column_data || payload.lead?.user_column_data);
    return { fullName: text(first(fields, ["fullname", "name"])), firstName: text(first(fields, ["firstname"])), lastName: text(first(fields, ["lastname"])), phone: text(first(fields, ["phone", "phonenumber"])), email: text(first(fields, ["email"])), country: text(first(fields, ["country"])), immigrationInterest: text(first(fields, ["service", "immigrationinterest"])), initialMessage: text(first(fields, ["message", "comments"])) };
  }
  if (provider === "EMAIL") {
    const body = text(payload.bodyText || payload.text || payload.body || payload.message);
    const from = text(payload.from || payload.senderAddress || payload.email);
    const email = from?.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0] || text(payload.email);
    const fullName = text(payload.fullName || from?.replace(/<[^>]+>/, "").replace(email || "", "").replace(/["']/g, ""));
    return { fullName, phone: text(payload.phone || phoneFrom(body)), email, immigrationInterest: text(payload.immigrationInterest || payload.subject), initialMessage: body };
  }
  if (provider === "OOMA") {
    const source = direct(payload);
    return { fullName: text(source.fullName || source.callerName || source.name), phone: text(source.phone || source.from || source.callerNumber || source.senderAddress), email: text(source.email), immigrationInterest: text(source.immigrationInterest), initialMessage: text(source.body || source.text || source.message || source.notes) };
  }
  return direct(payload);
}

export const providerChannel = (provider) => ({ META: "META_LEAD_FORM", WHATSAPP: "WHATSAPP_BUSINESS", GOOGLE_ADS: "GOOGLE_ADS_LEAD_FORM", EMAIL: "EMAIL_INTAKE", OOMA: "PHONE_PROVIDER", WEBSITE: "WEBSITE_CONNECTOR" }[provider] || "OTHER");

export function providerEventId(provider, payload = {}) {
  if (provider === "META") return payload.entry?.[0]?.changes?.[0]?.value?.leadgen_id || payload.leadgen_id;
  if (provider === "WHATSAPP") return payload.entry?.[0]?.changes?.[0]?.value?.messages?.[0]?.id || payload.message?.id;
  if (provider === "GOOGLE_ADS") return payload.lead_id || payload.lead?.lead_id;
  if (provider === "EMAIL") return payload.messageId || payload.providerMessageId || payload.emailMessageId;
  if (provider === "OOMA") return payload.callId || payload.messageId || payload.providerMessageId;
  return payload.externalId || payload.providerRecordId || payload.id;
}
