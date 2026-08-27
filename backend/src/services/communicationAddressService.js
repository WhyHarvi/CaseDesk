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
