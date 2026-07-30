import { createHttpError } from "../../utils/http.js";
import { parsePhoneNumberFromString } from "libphonenumber-js";
import { localDateTimeToUtc } from "../../services/bookingAvailabilityService.js";
import { LEAD_CONSULTATION_OUTCOMES, LEAD_CONSULTATION_STATUSES, LEAD_INITIAL_PAYMENT_STATUSES, LEAD_PRIORITIES, LEAD_QUALIFICATION_OUTCOMES, LEAD_RETAINER_STATUSES, LEAD_STAGES, LEAD_STATUSES, LEAD_TEMPERATURES } from "./lead.constants.js";

const text = (value, field, { required = false, max = 500 } = {}) => {
  if (value === undefined || value === null || value === "") {
    if (required) throw createHttpError(400, `${field} is required.`, "VALIDATION_ERROR");
    return null;
  }
  if (typeof value !== "string") throw createHttpError(400, `${field} must be text.`, "VALIDATION_ERROR");
  const normalized = value.trim();
  if (required && !normalized) throw createHttpError(400, `${field} is required.`, "VALIDATION_ERROR");
  if (normalized.length > max) throw createHttpError(400, `${field} is too long.`, "VALIDATION_ERROR");
  return normalized || null;
};

const enumValue = (value, field, values, fallback) => {
  const resolved = value ?? fallback;
  if (!values.includes(resolved)) throw createHttpError(400, `${field} is invalid.`, "VALIDATION_ERROR");
  return resolved;
};

const dateValue = (value, field, { required = false } = {}) => {
  if (value === undefined || value === null || value === "") {
    if (required) throw createHttpError(400, `${field} is required.`, "VALIDATION_ERROR");
    return null;
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw createHttpError(400, `${field} must be a valid date.`, "VALIDATION_ERROR");
  return parsed;
};

export function normalizeEmail(value) {
  const email = text(value, "email", { max: 320 });
  if (!email) return null;
  const normalized = email.toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
    throw createHttpError(400, "email is invalid.", "VALIDATION_ERROR");
  }
  return normalized;
}

export function normalizePhone(value) {
  const phone = text(value, "phone", { required: true, max: 40 });
  const parsed = parsePhoneNumberFromString(phone, "CA");
  if (!parsed?.isValid()) throw createHttpError(400, "phone is invalid.", "VALIDATION_ERROR");
  return parsed.number;
}

export function parseCreateLead(body = {}) {
  const phone = text(body.phone, "phone", { required: true, max: 40 });
  const email = text(body.email, "email", { max: 320 });
  const ownerUserId = text(body.ownerUserId, "ownerUserId", { required: true, max: 100 });
  const originalSourceId = text(body.originalSourceId, "originalSourceId", { required: true, max: 100 });
  const nextActionDescription = text(body.nextActionDescription, "nextActionDescription", { required: true, max: 500 });
  const nextActionAt = dateValue(body.nextActionAt, "nextActionAt", { required: true });

  return {
    firstName: text(body.firstName, "firstName", { max: 100 }),
    lastName: text(body.lastName, "lastName", { max: 100 }),
    phone,
    phoneNormalized: normalizePhone(phone),
    email,
    emailNormalized: normalizeEmail(email),
    country: text(body.country, "country", { max: 100 }),
    province: text(body.province, "province", { max: 100 }),
    preferredLanguage: text(body.preferredLanguage, "preferredLanguage", { max: 100 }),
    currentImmigrationStatus: text(body.currentImmigrationStatus, "currentImmigrationStatus", { max: 150 }),
    immigrationInterest: text(body.immigrationInterest, "immigrationInterest", { max: 150 }),
    ownerUserId,
    originalSourceId,
    campaignId: text(body.campaignId, "campaignId", { max: 100 }),
    initialMessage: text(body.initialMessage, "initialMessage", { max: 5000 }),
    priority: enumValue(body.priority, "priority", LEAD_PRIORITIES, "NORMAL"),
    temperature: enumValue(body.temperature, "temperature", LEAD_TEMPERATURES, "COLD"),
    nextActionType: text(body.nextActionType, "nextActionType", { required: true, max: 100 }),
    nextActionDescription,
    nextActionAt,
    nextActionOwnerId: text(body.nextActionOwnerId, "nextActionOwnerId", { max: 100 }) || ownerUserId,
    firstContactDueAt: dateValue(body.firstContactDueAt, "firstContactDueAt"),
  };
}

export function parseLeadListQuery(query = {}) {
  const page = Math.max(Number(query.page) || 1, 1);
  const limit = Math.min(Math.max(Number(query.limit) || 25, 1), 100);
  const status = query.status ? enumValue(query.status, "status", LEAD_STATUSES) : null;
  const stage = query.stage ? enumValue(query.stage, "stage", LEAD_STAGES) : null;
  const sortBy = ["createdAt", "updatedAt", "nextActionAt", "leadNumber"].includes(query.sortBy) ? query.sortBy : "createdAt";
  const sortDirection = query.sortDirection === "asc" ? "asc" : "desc";
  return {
    page,
    limit,
    status,
    stage,
    sortBy,
    sortDirection,
    search: text(query.search, "search", { max: 200 }) || "",
    sourceId: text(query.sourceId, "sourceId", { max: 100 }),
  };
}

const optionalBoolean = (value, field) => {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "boolean") throw createHttpError(400, `${field} must be true or false.`, "VALIDATION_ERROR");
  return value;
};

const optionalNumber = (value, field, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) => {
  if (value === undefined || value === null || value === "") return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) throw createHttpError(400, `${field} is invalid.`, "VALIDATION_ERROR");
  return parsed;
};

export function parseLeadQualification(body = {}) {
  const outcome = enumValue(body.outcome, "outcome", LEAD_QUALIFICATION_OUTCOMES);
  const notes = text(body.notes, "notes", { max: 5000 });
  if (["NOT_ELIGIBLE", "SERVICE_NOT_OFFERED"].includes(outcome) && !notes) {
    throw createHttpError(400, "notes are required for this qualification outcome.", "VALIDATION_ERROR");
  }
  return {
    immigrationService: text(body.immigrationService, "immigrationService", { required: true, max: 150 }),
    currentCountry: text(body.currentCountry, "currentCountry", { max: 100 }),
    currentImmigrationStatus: text(body.currentImmigrationStatus, "currentImmigrationStatus", { max: 150 }),
    statusExpiryDate: dateValue(body.statusExpiryDate, "statusExpiryDate"),
    preferredDestination: text(body.preferredDestination, "preferredDestination", { max: 150 }),
    education: text(body.education, "education", { max: 1000 }),
    workExperience: text(body.workExperience, "workExperience", { max: 2000 }),
    languageTest: text(body.languageTest, "languageTest", { max: 500 }),
    previousRefusals: optionalBoolean(body.previousRefusals, "previousRefusals"),
    familyStatus: text(body.familyStatus, "familyStatus", { max: 500 }),
    estimatedBudget: optionalNumber(body.estimatedBudget, "estimatedBudget", { min: 0, max: 100000000 }),
    preferredConsultationAt: dateValue(body.preferredConsultationAt, "preferredConsultationAt"),
    urgency: body.urgency ? enumValue(body.urgency, "urgency", LEAD_PRIORITIES) : null,
    notes,
    eligibilityConfidence: optionalNumber(body.eligibilityConfidence, "eligibilityConfidence", { min: 0, max: 100 }),
    outcome,
  };
}

export function parseCreateConsultation(body = {}) {
  const timezone = text(body.timezone, "timezone", { max: 100 }) || "America/Toronto";
  try { new Intl.DateTimeFormat("en-CA", { timeZone: timezone }).format(new Date()); }
  catch { throw createHttpError(400, "timezone is invalid.", "VALIDATION_ERROR"); }
  const consultationDate = (value, field) => {
    const raw = String(value || "");
    const local = raw.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?$/);
    if (local) {
      return localDateTimeToUtc(local[1], Number(local[2]) * 60 + Number(local[3]), timezone);
    }
    return dateValue(value, field, { required: true });
  };
  const startAt = consultationDate(body.startAt, "startAt");
  const endAt = consultationDate(body.endAt, "endAt");
  if (endAt <= startAt) throw createHttpError(400, "endAt must be later than startAt.", "VALIDATION_ERROR");
  if (endAt.getTime() - startAt.getTime() !== 30 * 60_000) {
    throw createHttpError(400, "Consultation appointments must be 30 minutes.", "VALIDATION_ERROR");
  }
  const meetingUrl = text(body.meetingUrl, "meetingUrl", { max: 1000 });
  if (meetingUrl) {
    try { new URL(meetingUrl); } catch { throw createHttpError(400, "meetingUrl is invalid.", "VALIDATION_ERROR"); }
  }
  return {
    consultantUserId: text(body.consultantUserId, "consultantUserId", { required: true, max: 100 }),
    startAt,
    endAt,
    timezone,
    appointmentType: enumValue(body.appointmentType, "appointmentType", ["IN_PERSON", "PHONE", "VIDEO", "JITSI", "ZOOM"]),
    fee: optionalNumber(body.fee, "fee", { min: 0, max: 1000000 }),
    paymentStatus: enumValue(body.paymentStatus, "paymentStatus", ["UNPAID", "PAID", "WAIVED", "REFUNDED"], "UNPAID"),
    locationId: text(body.locationId, "locationId", { max: 100 }),
    location: text(body.location, "location", { max: 500 }),
    meetingUrl,
    notes: text(body.notes, "notes", { max: 5000 }),
  };
}

export function parseUpdateConsultation(body = {}) {
  const status = enumValue(body.status, "status", LEAD_CONSULTATION_STATUSES);
  const outcome = body.outcome ? enumValue(body.outcome, "outcome", LEAD_CONSULTATION_OUTCOMES) : null;
  if (status === "COMPLETED" && !outcome) throw createHttpError(400, "outcome is required for a completed consultation.", "VALIDATION_ERROR");
  return { status, outcome, notes: text(body.notes, "notes", { max: 5000 }) };
}

export function parseCommercialStatus(body = {}) {
  const retainerStatus = body.retainerStatus === undefined ? undefined : enumValue(body.retainerStatus, "retainerStatus", LEAD_RETAINER_STATUSES);
  const initialPaymentStatus = body.initialPaymentStatus === undefined ? undefined : enumValue(body.initialPaymentStatus, "initialPaymentStatus", LEAD_INITIAL_PAYMENT_STATUSES);
  if (retainerStatus === undefined && initialPaymentStatus === undefined) {
    throw createHttpError(400, "A retainer or initial-payment status is required.", "VALIDATION_ERROR");
  }
  return { retainerStatus, initialPaymentStatus, notes: text(body.notes, "notes", { max: 5000 }) };
}

export function parseLeadConversion(body = {}) {
  return {
    fullName: text(body.fullName, "fullName", { required: true, max: 200 }),
    caseType: text(body.caseType, "caseType", { required: true, max: 200 }),
    caseStage: text(body.caseStage, "caseStage", { max: 100 }) || "Intake",
    caseNextAction: text(body.caseNextAction, "caseNextAction", { required: true, max: 500 }),
    actualValue: optionalNumber(body.actualValue, "actualValue", { min: 0, max: 100000000 }),
    notes: text(body.notes, "notes", { max: 5000 }),
  };
}

const FRONTDESK_ACTIVITY_TYPES = ["INCOMING_CALL", "OUTGOING_CALL", "MISSED_CALL", "WHATSAPP_RECEIVED", "WHATSAPP_SENT", "SMS_RECEIVED", "SMS_SENT", "EMAIL_RECEIVED", "EMAIL_SENT", "INTERNAL_NOTE"];
const ACTIVITY_DIRECTIONS = ["INBOUND", "OUTBOUND", "INTERNAL"];
const ACTIVITY_CHANNELS = ["PHONE", "OOMA", "WHATSAPP", "SMS", "EMAIL", "SOCIAL", "WEBSITE", "IN_PERSON", "SYSTEM", "OTHER"];
const LOST_REASONS = ["NO_RESPONSE", "NOT_INTERESTED", "NOT_ELIGIBLE", "PRICE_CONCERN", "SELECTED_ANOTHER_CONSULTANT", "CONSULTATION_NO_SHOW", "AGREEMENT_NOT_SIGNED", "PAYMENT_NOT_COMPLETED", "SERVICE_NOT_OFFERED", "WRONG_CONTACT_INFORMATION", "DUPLICATE", "DO_NOT_CONTACT", "OTHER"];

export function parseLeadActivity(body = {}) {
  const durationSeconds = optionalNumber(body.durationSeconds, "durationSeconds", { min: 0, max: 86_400 });
  return {
    activityType: enumValue(body.activityType, "activityType", FRONTDESK_ACTIVITY_TYPES),
    direction: body.direction ? enumValue(body.direction, "direction", ACTIVITY_DIRECTIONS) : null,
    channel: body.channel ? enumValue(body.channel, "channel", ACTIVITY_CHANNELS) : null,
    outcome: text(body.outcome, "outcome", { max: 160 }),
    title: text(body.title, "title", { required: true, max: 200 }),
    description: text(body.description, "description", { max: 5000 }),
    durationSeconds: durationSeconds === null ? null : Math.round(durationSeconds),
    occurredAt: dateValue(body.occurredAt, "occurredAt") || new Date(),
  };
}

export function parseLeadFollowUp(body = {}) {
  return {
    assignedUserId: text(body.assignedUserId, "assignedUserId", { required: true, max: 100 }),
    type: text(body.type, "type", { required: true, max: 100 }),
    description: text(body.description, "description", { required: true, max: 1000 }),
    dueAt: dateValue(body.dueAt, "dueAt", { required: true }),
  };
}

export function parseLeadFollowUpOutcome(body = {}) {
  return {
    status: enumValue(body.status, "status", ["COMPLETED", "CANCELLED"]),
    completionOutcome: text(body.completionOutcome, "completionOutcome", { required: true, max: 500 }),
  };
}

export function parseLeadAssignment(body = {}) {
  return {
    ownerUserId: text(body.ownerUserId, "ownerUserId", { required: true, max: 100 }),
    reason: text(body.reason, "reason", { required: true, max: 500 }),
  };
}

export function parseLeadNurture(body = {}) {
  const nurtureUntil = dateValue(body.nurtureUntil, "nurtureUntil", { required: true });
  if (nurtureUntil <= new Date()) throw createHttpError(400, "nurtureUntil must be in the future.", "VALIDATION_ERROR");
  return { nurtureUntil, reason: text(body.reason, "reason", { required: true, max: 1000 }) };
}

export function parseLeadLost(body = {}) {
  return {
    reasonCode: enumValue(body.reasonCode, "reasonCode", LOST_REASONS),
    notes: text(body.notes, "notes", { required: true, max: 2000 }),
    lastContactAt: dateValue(body.lastContactAt, "lastContactAt"),
    attemptCount: Math.round(optionalNumber(body.attemptCount, "attemptCount", { min: 0, max: 100 }) || 0),
    reactivationAllowed: optionalBoolean(body.reactivationAllowed, "reactivationAllowed") || false,
    reactivationAt: dateValue(body.reactivationAt, "reactivationAt"),
  };
}
