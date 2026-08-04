import { randomUUID } from "node:crypto";
import { parsePhoneNumberFromString } from "libphonenumber-js";
import { createHttpError } from "../utils/http.js";
import { zoomConfigured } from "./zoomService.js";

export const MEETING_MODES = Object.freeze({
  IN_PERSON: "InPerson",
  PHONE: "Phone",
  JITSI: "Online",
  ZOOM: "Zoom",
});

export const MEETING_MODE_VALUES = Object.freeze(Object.values(MEETING_MODES));

export function normalizeMeetingMode(value, fallback = MEETING_MODES.IN_PERSON) {
  const mode = String(value || "");
  return MEETING_MODE_VALUES.includes(mode) ? mode : fallback;
}

export function isRemoteMeetingMode(mode) {
  return [MEETING_MODES.PHONE, MEETING_MODES.JITSI, MEETING_MODES.ZOOM].includes(mode);
}

// Every appointment format occupies the assigned consultant's complete time
// slot. A phone call therefore conflicts with in-person, Jitsi, and Zoom
// appointments just as those formats conflict with one another.
export function meetingModesInSameCapacityGroup(_mode) {
  return MEETING_MODE_VALUES;
}

export function meetingModeLabel(mode) {
  if (mode === MEETING_MODES.PHONE) return "Phone call";
  if (mode === MEETING_MODES.JITSI) return "Jitsi video call";
  if (mode === MEETING_MODES.ZOOM) return "Zoom video call";
  return "In person";
}

export function normalizeBookingPhone(value, field = "Phone number") {
  const raw = String(value || "").trim();
  if (!raw) return null;
  const parsed = parsePhoneNumberFromString(raw, "CA");
  if (!parsed?.isValid()) {
    throw createHttpError(400, `${field} is invalid. Include the area code and country code when outside Canada.`, "VALIDATION_ERROR");
  }
  return parsed.number;
}

export function meetingModeEnabled(settings, mode) {
  if (mode === MEETING_MODES.PHONE) return settings?.phoneBookingEnabled === true;
  if (mode === MEETING_MODES.JITSI) return settings?.onlineBookingEnabled !== false;
  if (mode === MEETING_MODES.ZOOM) return settings?.zoomBookingEnabled === true && zoomConfigured();
  return mode === MEETING_MODES.IN_PERSON;
}

export function assertMeetingModeConfigured({ settings, sessionType = null, mode, guestPhone = null }) {
  if (!MEETING_MODE_VALUES.includes(mode)) {
    throw createHttpError(400, "Choose a valid appointment format.", "VALIDATION_ERROR");
  }
  if (!meetingModeEnabled(settings, mode)) {
    throw createHttpError(409, `${meetingModeLabel(mode)} booking is currently unavailable.`, "MEETING_MODE_DISABLED");
  }
  if (sessionType?.allowedMeetingModes?.length && !sessionType.allowedMeetingModes.includes(mode)) {
    throw createHttpError(400, "That appointment format is unavailable for this session type.", "VALIDATION_ERROR");
  }
  if (mode === MEETING_MODES.PHONE) {
    if (!settings?.phoneCallerId) {
      throw createHttpError(409, "Phone appointments are not configured yet.", "PHONE_NOT_CONFIGURED");
    }
    if (!normalizeBookingPhone(guestPhone, "Client phone number")) {
      throw createHttpError(400, "A valid phone number is required so the office can call you.", "PHONE_REQUIRED");
    }
  }
  return mode;
}

export function jitsiMeetingLink() {
  return `https://meet.jit.si/CaseDesk-${randomUUID().replace(/-/g, "").slice(0, 14)}`;
}

export function appointmentMeetingFields({ mode, settings, existing = null }) {
  if (mode === MEETING_MODES.PHONE) {
    return {
      meetingMode: mode,
      meetingUrl: null,
      meetingPhoneNumber: existing?.meetingMode === mode && existing?.meetingPhoneNumber
        ? existing.meetingPhoneNumber
        : settings.phoneCallerId,
      meetingProvider: null,
      meetingProviderId: null,
      meetingProviderHostId: null,
      meetingSyncStatus: "NotRequired",
      meetingSyncError: null,
    };
  }
  if (mode === MEETING_MODES.JITSI) {
    return {
      meetingMode: mode,
      meetingUrl: existing?.meetingMode === mode && existing?.meetingUrl ? existing.meetingUrl : jitsiMeetingLink(),
      meetingPhoneNumber: null,
      meetingProvider: "Jitsi",
      meetingProviderId: null,
      meetingProviderHostId: null,
      meetingSyncStatus: "Ready",
      meetingSyncError: null,
    };
  }
  if (mode === MEETING_MODES.ZOOM) {
    return {
      meetingMode: mode,
      meetingUrl: existing?.meetingMode === mode ? existing.meetingUrl : null,
      meetingPhoneNumber: null,
      meetingProvider: "Zoom",
      meetingProviderId: existing?.meetingMode === mode ? existing.meetingProviderId : null,
      meetingProviderHostId: existing?.meetingMode === mode ? existing.meetingProviderHostId : null,
      meetingSyncStatus: "Pending",
      meetingSyncError: null,
    };
  }
  return {
    meetingMode: MEETING_MODES.IN_PERSON,
    meetingUrl: null,
    meetingPhoneNumber: null,
    meetingProvider: null,
    meetingProviderId: null,
    meetingProviderHostId: null,
    meetingSyncStatus: "NotRequired",
    meetingSyncError: null,
  };
}

export function paymentHoldMeetingFields({ mode, settings }) {
  return {
    meetingMode: mode,
    meetingPhoneNumber: mode === MEETING_MODES.PHONE ? settings.phoneCallerId : null,
    meetingProvider: mode === MEETING_MODES.JITSI ? "Jitsi" : mode === MEETING_MODES.ZOOM ? "Zoom" : null,
  };
}
