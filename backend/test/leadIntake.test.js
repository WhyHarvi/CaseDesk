import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createHmac } from "node:crypto";
import { parseCsv } from "../src/modules/leads/lead.csv.js";
import { inferLeadColumnMapping, normalizeIncomingLead, parsePublicSubmission } from "../src/modules/leads/lead.intake.validation.js";
import { verifyWebsiteSignature } from "../src/modules/leads/lead.website.service.js";
import { adaptProviderPayload, providerEventId } from "../src/modules/leads/lead.provider.adapters.js";
import { enrichProviderPayload } from "../src/modules/leads/lead.provider.enrichment.js";
import { encryptSecret } from "../src/services/secretEncryption.js";
import { redact } from "../src/services/logger.js";
import { secureHeaders } from "../src/middleware/productionSecurity.js";
import { isLikelyCorrectedWebsiteSubmission } from "../src/modules/leads/lead.intake.worker.js";

test("CSV parsing preserves commas, quotes, and row boundaries", () => {
  const result = parseCsv('Full Name,Phone,Notes\r\n"Avery Singh","+1 416 555 0100","Study, then work"\r\n"Sam ""SJ"" Jones",+14165550101,Follow up');
  assert.deepEqual(result.headers, ["Full Name", "Phone", "Notes"]);
  assert.equal(result.rows[0].Notes, "Study, then work");
  assert.equal(result.rows[1]["Full Name"], 'Sam "SJ" Jones');
});

test("import mapping recognizes common headings and produces canonical lead data", () => {
  const headers = ["Name", "Mobile", "Email Address", "Service", "Notes"];
  const mapping = inferLeadColumnMapping(headers);
  assert.deepEqual(mapping, { fullName: "Name", phone: "Mobile", email: "Email Address", immigrationInterest: "Service", initialMessage: "Notes" });
  const result = normalizeIncomingLead({ Name: "  Avery Singh ", Mobile: "+1 (416) 555-0100", "Email Address": "AVERY@EXAMPLE.CA", Service: "Study Permit", Notes: "September intake" }, mapping);
  assert.deepEqual(result.errors, []);
  assert.equal(result.data.firstName, "Avery");
  assert.equal(result.data.lastName, "Singh");
  assert.equal(result.data.phoneNormalized, "+14165550100");
  assert.equal(result.data.emailNormalized, "avery@example.ca");
});

test("intake validation reports row errors without inventing a lead", () => {
  const result = normalizeIncomingLead({ firstName: "Avery", phone: "not-a-number" });
  assert.match(result.errors.join(" "), /Phone is invalid/);
  assert.throws(() => parsePublicSubmission({ firstName: "Avery", phone: "+14165550100", consent: false }, true), /Consent is required/);
  assert.equal(parsePublicSubmission({ website: "spam.example" }, true).bot, true);
});

test("Phase 5 intake tables are tenant scoped while public access stays behind the API", async () => {
  const sql = await readFile(new URL("../prisma/migrations/20260714200000_add_lead_intake_pipeline/migration.sql", import.meta.url), "utf8");
  for (const table of ["lead_intake_forms", "lead_import_batches", "lead_import_rows", "lead_incoming_events", "lead_duplicate_candidates"]) {
    assert.match(sql, new RegExp(`ALTER TABLE "${table}" ENABLE ROW LEVEL SECURITY`));
  }
  assert.match(sql, /lead_incoming_events_agency_id_idempotency_key_key/);
  assert.doesNotMatch(sql, /TO anon|TO public/);
});

test("website connector verifies HMAC signatures and rejects replays", () => {
  const rawBody = Buffer.from('{"firstName":"Avery","phone":"+14165550100"}');
  const secret = "test-signing-secret";
  const now = Date.parse("2026-07-14T18:00:00Z");
  const timestamp = Math.floor(now / 1000);
  const signature = createHmac("sha256", secret).update(`${timestamp}.`).update(rawBody).digest("hex");
  assert.doesNotThrow(() => verifyWebsiteSignature({ rawBody, timestamp, signature: `sha256=${signature}`, secret, now }));
  assert.throws(() => verifyWebsiteSignature({ rawBody, timestamp, signature: "sha256=" + "0".repeat(64), secret, now }), /signature is invalid/);
  assert.throws(() => verifyWebsiteSignature({ rawBody, timestamp: timestamp - 301, signature, secret, now }), /timestamp is missing or expired/);
});

test("website connections are admin-only tenant records linked to incoming events", async () => {
  const sql = await readFile(new URL("../prisma/migrations/20260714210000_add_website_lead_connections/migration.sql", import.meta.url), "utf8");
  assert.match(sql, /ALTER TABLE "lead_source_connections" ENABLE ROW LEVEL SECURITY/);
  assert.match(sql, /current_user_role\(\) = 'admin'/);
  assert.match(sql, /ADD COLUMN "source_connection_id"/);
  assert.match(sql, /lead_incoming_events_source_connection_id_created_at_idx/);
});

test("Phase 6 provider adapters normalize Meta, WhatsApp, Google, email, and phone payloads", () => {
  const meta = adaptProviderPayload("META", { entry: [{ changes: [{ value: { leadgen_id: "meta-1", lead: { field_data: [{ name: "full_name", values: ["Avery Singh"] }, { name: "phone_number", values: ["+14165550100"] }] } } }] }] });
  assert.equal(meta.fullName, "Avery Singh");
  assert.equal(meta.phone, "+14165550100");
  const whatsappPayload = { entry: [{ changes: [{ value: { contacts: [{ wa_id: "14165550101", profile: { name: "Sam Jones" } }], messages: [{ id: "wamid.1", from: "14165550101", text: { body: "Study permit" } }] } }] }] };
  assert.equal(adaptProviderPayload("WHATSAPP", whatsappPayload).initialMessage, "Study permit");
  assert.equal(providerEventId("WHATSAPP", whatsappPayload), "wamid.1");
  const google = adaptProviderPayload("GOOGLE_ADS", { user_column_data: [{ column_id: "FULL_NAME", string_value: "Jordan Lee" }, { column_id: "PHONE_NUMBER", string_value: "+14165550102" }] });
  assert.equal(google.fullName, "Jordan Lee");
  const email = adaptProviderPayload("EMAIL", { from: "Taylor Kim <taylor@example.ca>", bodyText: "Call me at +1 416 555 0103" });
  assert.equal(email.email, "taylor@example.ca");
  assert.match(email.phone, /416 555 0103/);
});

test("email intake permits email-only leads while other streams still require phone", () => {
  assert.deepEqual(normalizeIncomingLead({ fullName: "Taylor Kim", email: "taylor@example.ca" }, null, { allowEmailOnly: true }).errors, []);
  assert.match(normalizeIncomingLead({ fullName: "Taylor Kim", email: "taylor@example.ca" }).errors.join(" "), /Phone is required/);
});

test("a website visitor correcting a small email typo is sent to duplicate review", () => {
  const previous = {
    createdAt: "2026-08-14T21:30:47.118Z",
    ip: "142.186.38.184",
    firstName: "Sumairdhawan",
    lastName: null,
    emailNormalized: "sumairdhawan2467@gamil.com",
  };
  const corrected = {
    ...previous,
    createdAt: "2026-08-14T21:32:39.004Z",
    emailNormalized: "sumairdhawan2467@gmail.com",
  };
  assert.equal(isLikelyCorrectedWebsiteSubmission(corrected, previous), true);
  assert.equal(isLikelyCorrectedWebsiteSubmission({ ...corrected, ip: "203.0.113.20" }, previous), false);
  assert.equal(isLikelyCorrectedWebsiteSubmission({ ...corrected, firstName: "Another person" }, previous), false);
  assert.equal(isLikelyCorrectedWebsiteSubmission({ ...corrected, createdAt: "2026-08-14T22:30:00.000Z" }, previous), false);
});

test("the intake worker uses the shared agency contact lock before duplicate detection", async () => {
  const source = await readFile(new URL("../src/modules/leads/lead.intake.worker.js", import.meta.url), "utf8");
  const lockAt = source.indexOf("await lockAgencyContactIntake(tx, event.agencyId)");
  const duplicateAt = source.indexOf("const duplicates = await findDuplicates(tx, event, normalized.data)");
  assert.ok(lockAt >= 0 && duplicateAt > lockAt);
});

test("remaining Phase 6 providers are constrained and email-originated leads can begin without phone", async () => {
  const sql = await readFile(new URL("../prisma/migrations/20260714220000_enable_phase_6_lead_providers/migration.sql", import.meta.url), "utf8");
  for (const provider of ["META", "WHATSAPP", "GOOGLE_ADS", "EMAIL"]) assert.match(sql, new RegExp(`'${provider}'`));
  assert.match(sql, /ALTER COLUMN "phone" DROP NOT NULL/);
  assert.match(sql, /ALTER COLUMN "phone_normalized" DROP NOT NULL/);
});

test("Meta lead IDs are enriched asynchronously with an encrypted access token", async () => {
  const previousKey = process.env.MAIL_SETTINGS_ENCRYPTION_KEY;
  process.env.MAIL_SETTINGS_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
  try {
    const connection = { provider: "META", accessTokenEncrypted: encryptSecret("page-token") };
    const payload = { entry: [{ changes: [{ value: { leadgen_id: "lead-123" } }] }] };
    const enriched = await enrichProviderPayload(connection, payload, async (url) => {
      assert.match(url.toString(), /lead-123/);
      assert.equal(url.searchParams.get("access_token"), "page-token");
      return { ok: true, json: async () => ({ id: "lead-123", field_data: [{ name: "phone_number", values: ["+14165550100"] }] }) };
    });
    assert.equal(enriched.lead.id, "lead-123");
  } finally {
    if (previousKey === undefined) delete process.env.MAIL_SETTINGS_ENCRYPTION_KEY;
    else process.env.MAIL_SETTINGS_ENCRYPTION_KEY = previousKey;
  }
});

test("Meta enrichment credentials have their own encrypted database field", async () => {
  const sql = await readFile(new URL("../prisma/migrations/20260714230000_add_meta_lead_enrichment_token/migration.sql", import.meta.url), "utf8");
  assert.match(sql, /ADD COLUMN "access_token_encrypted" TEXT/);
});

test("production logs redact credentials and large payloads", () => {
  const result = redact({ authorization: "Bearer secret", nested: { accessToken: "token", safe: "visible" }, message: "x".repeat(2100) });
  assert.equal(result.authorization, "[REDACTED]");
  assert.equal(result.nested.accessToken, "[REDACTED]");
  assert.equal(result.nested.safe, "visible");
  assert.ok(result.message.length < 2100);
});

test("production API security headers are applied", () => {
  const headers = {};
  const res = { set: (values) => Object.assign(headers, values) };
  let continued = false;
  secureHeaders({}, res, () => { continued = true; });
  assert.equal(headers["X-Content-Type-Options"], "nosniff");
  assert.equal(headers["X-Frame-Options"], "DENY");
  assert.equal(headers["Cache-Control"], "no-store");
  assert.equal(continued, true);
});

test("Phase 7 adds durable rate limits and intake operations indexes", async () => {
  const sql = await readFile(new URL("../prisma/migrations/20260714240000_harden_lead_operations/migration.sql", import.meta.url), "utf8");
  assert.match(sql, /CREATE TABLE "api_rate_limit_buckets"/);
  assert.match(sql, /ENABLE ROW LEVEL SECURITY/);
  assert.match(sql, /lead_incoming_events_failed_review_idx/);
  assert.match(sql, /lead_incoming_events_agency_id_status_available_at_idx/);
});
