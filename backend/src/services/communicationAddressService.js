import { parsePhoneNumberFromString } from "libphonenumber-js";

const clean = (value, max = 320) =>
  String(value ?? "")
    .trim()
    .slice(0, max);

export function normalizeCommunicationPhone(value) {
  const source = clean(value, 80);
  if (!source) return null;
  const parsed = parsePhoneNumberFromString(source, "CA");
  return parsed?.isValid() ? parsed.number : null;
}

export function oomaSenderCandidates(payload = {}, { allowToFallback = false } = {}) {
  const nested =
    payload.data && typeof payload.data === "object" && !Array.isArray(payload.data)
      ? payload.data
      : {};
  const values = [
    payload.senderAddress,
    payload.from,
    payload.remote_number,
    payload.remoteNumber,
    payload.callerNumber,
    payload.caller_number,
    payload.contactNumber,
    payload.contact_number,
    payload.phoneNumber,
    payload.phone_number,
    payload.sender,
    nested.senderAddress,
    nested.from,
    nested.remote_number,
    nested.remoteNumber,
    nested.callerNumber,
    nested.phoneNumber,
    ...(allowToFallback ? [payload.to, nested.to] : []),
  ];
  return [...new Set(values.map((value) => clean(value)).filter(Boolean))];
}

