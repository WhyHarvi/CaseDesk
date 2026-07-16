import { randomUUID } from "node:crypto";
import { createHttpError } from "../../utils/http.js";
import { normalizeEmail, normalizePhone } from "./lead.validation.js";

const clean = (value, max = 500) => {
  if (value === undefined || value === null) return null;
  const result = String(value).trim();
  return result ? result.slice(0, max) : null;
};

const aliases = {
  firstName: ["firstname", "first_name", "givenname", "given_name"],
  lastName: ["lastname", "last_name", "surname", "familyname", "family_name"],
  fullName: ["name", "fullname", "full_name", "contactname", "contact_name"],
  phone: ["phone", "telephone", "mobile", "cell", "phonenumber", "phone_number"],
  email: ["email", "emailaddress", "email_address"],
  country: ["country", "currentcountry", "current_country"],
  province: ["province", "state", "region"],
  preferredLanguage: ["language", "preferredlanguage", "preferred_language"],
  currentImmigrationStatus: ["status", "immigrationstatus", "immigration_status"],
  immigrationInterest: ["interest", "service", "immigrationinterest", "immigration_interest"],
  initialMessage: ["message", "notes", "comment", "comments", "initialmessage", "initial_message"],
  preferredContactTime: ["preferredcontacttime", "preferred_contact_time", "contacttime", "contact_time"],
};

const keyOf = (value) => String(value || "").trim().toLowerCase().replace(/[\s-]+/g, "_");

export function inferLeadColumnMapping(headers = []) {
  const mapping = {};
  for (const header of headers) {
    const key = keyOf(header);
    const match = Object.entries(aliases).find(([, values]) => values.includes(key));
    if (match && !mapping[match[0]]) mapping[match[0]] = header;
  }
  return mapping;
}

export function normalizeIncomingLead(payload = {}, mapping = null, { allowEmailOnly = false } = {}) {
  const value = (field) => mapping ? payload[mapping[field]] : payload[field];
  let firstName = clean(value("firstName"), 100);
  let lastName = clean(value("lastName"), 100);
  const fullName = clean(value("fullName"), 200);
  if (!firstName && fullName) {
    const parts = fullName.split(/\s+/);
    firstName = parts.shift() || null;
    lastName ||= parts.join(" ") || null;
  }

  const phone = clean(value("phone"), 40);
  const email = clean(value("email"), 320);
  const errors = [];
  let phoneNormalized = null;
  let emailNormalized = null;
  if (!phone) {
    if (!allowEmailOnly) errors.push("Phone is required.");
  } else {
    try { phoneNormalized = normalizePhone(phone); } catch { errors.push("Phone is invalid. Include a country code when outside Canada."); }
  }
  if (email) {
    try { emailNormalized = normalizeEmail(email); } catch { errors.push("Email is invalid."); }
  }
  if (allowEmailOnly && !phone && !email) errors.push("Phone or email is required.");
  if (!firstName && !lastName) errors.push("A first name, last name, or full name is required.");

  return {
    data: {
      firstName,
      lastName,
      phone,
      phoneNormalized,
      email,
      emailNormalized,
      country: clean(value("country"), 100),
      province: clean(value("province"), 100),
      preferredLanguage: clean(value("preferredLanguage"), 100),
      currentImmigrationStatus: clean(value("currentImmigrationStatus"), 150),
      immigrationInterest: clean(value("immigrationInterest"), 150),
      initialMessage: clean(value("initialMessage"), 5000),
      preferredContactTime: clean(value("preferredContactTime"), 150),
    },
    errors,
  };
}

export function parseIntakeForm(body = {}) {
  const required = (field, max = 100) => {
    const result = clean(body[field], max);
    if (!result) throw createHttpError(400, `${field} is required.`, "VALIDATION_ERROR");
    return result;
  };
  const minutes = Number(body.firstResponseMinutes ?? 15);
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > 10080) throw createHttpError(400, "firstResponseMinutes must be between 1 and 10080.", "VALIDATION_ERROR");
  return {
    name: required("name", 120),
    sourceId: required("sourceId"),
    campaignId: clean(body.campaignId, 100),
    ownerUserId: required("ownerUserId"),
    publicToken: randomUUID().replaceAll("-", "") + randomUUID().replaceAll("-", "").slice(0, 16),
    requireConsent: body.requireConsent !== false,
    firstResponseMinutes: minutes,
    successMessage: clean(body.successMessage, 500) || "Thank you. Our team will contact you shortly.",
  };
}

export function parsePublicSubmission(body = {}, requireConsent = true) {
  if (clean(body.website, 200)) return { bot: true };
  if (requireConsent && body.consent !== true) throw createHttpError(400, "Consent is required before submitting.", "CONSENT_REQUIRED");
  const normalized = normalizeIncomingLead(body);
  if (normalized.errors.length) throw createHttpError(400, normalized.errors.join(" "), "VALIDATION_ERROR");
  return { bot: false, rawPayload: {
    firstName: clean(body.firstName, 100), lastName: clean(body.lastName, 100), phone: clean(body.phone, 40),
    email: clean(body.email, 320), country: clean(body.country, 100), preferredLanguage: clean(body.preferredLanguage, 100),
    currentImmigrationStatus: clean(body.currentImmigrationStatus, 150), immigrationInterest: clean(body.immigrationInterest, 150),
    preferredContactTime: clean(body.preferredContactTime, 150), initialMessage: clean(body.initialMessage, 5000), consent: body.consent === true,
  } };
}
